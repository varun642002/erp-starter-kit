import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { branchesWithDistricts, seasonOutlook } from './seasonService.ts';

// Stock planning from real sales speed: what to order (grouped by supplier), what is not moving, what to move between
// branches, and which items must never run out.

const round = (n: number) => Math.round(n);
const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);

export interface OrderLine {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  unit: string;
  perMonth: number;
  daysLeft: number;
  orderQty: number;
  label: string;
  abc: 'A' | 'B' | 'C';
}
export interface SupplierOrder {
  supplierName: string;
  supplierPhone: string | null;
  lines: OrderLine[];
  message: string;
}
export interface SlowItem {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  unit: string;
  value: number;
  valueBasis: 'purchase price' | 'selling price' | 'not priced';
  daysSinceSale: number | null; // null = not sold in all the records
}
export interface TransferIdea {
  productId: string;
  name: string;
  sku: string;
  fromBranch: string;
  toBranch: string;
  qty: number;
  unit: string;
  reason: string;
}
export interface AbcItem {
  productId: string;
  name: string;
  sku: string;
  revenue: number;
  sharePercent: number;
  cumulativePercent: number;
  abc: 'A' | 'B' | 'C';
  stock: number;
  unit: string;
  daysLeft: number | null;
}
export interface StockPlan {
  generatedAt: string;
  leadDays: number;
  coverDays: number;
  seasonFactor: number;
  historyDays: number;
  orders: SupplierOrder[];
  orderLineCount: number;
  slow: { items: SlowItem[]; reliable: boolean; basis: string; totalValue: number };
  transfers: TransferIdea[];
  abc: AbcItem[];
}

const toBox = (qty: number, p: { unit: string; alternate_unit: string | null; conversion_factor: number | null }) => {
  const f = p.alternate_unit && Number(p.conversion_factor) > 1 ? Number(p.conversion_factor) : 0;
  if (!f || qty <= 0) return { qty, label: `${qty} ${p.unit}` };
  const boxes = Math.ceil(qty / f);
  return { qty: boxes * f, label: `${boxes} ${String(p.alternate_unit).toLowerCase()}${boxes === 1 ? '' : 'es'} (${boxes * f} ${p.unit})` };
};

export async function getStockPlan(scope: string, leadDays = 7, coverDays = 30): Promise<StockPlan> {
  leadDays = Math.min(60, Math.max(0, Math.round(leadDays)));
  coverDays = Math.min(120, Math.max(7, Math.round(coverDays)));
  const today = businessDate();
  let seasonFactor = 1;
  try {
    seasonFactor = (await seasonOutlook(scope)).next30Factor;
  } catch {
    seasonFactor = 1;
  }

  const branches = await branchesWithDistricts();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const sold = (await db.execute(sql`
    select s.branch_id as bid, si.product_id as pid, sum(si.quantity * si.unit_factor)::float as qty, sum(si.line_total)::float as rev,
           max(s.created_at) as last_at, min(s.created_at) as first_at
    from sale_items si join sales s on s.id = si.sale_id
    where si.product_id is not null and s.created_at >= now() - interval '90 days' ${branchFilter('s.branch_id', scope)}
    group by s.branch_id, si.product_id`)).rows as any[];
  const stockRows = (await db.execute(sql`
    select w.branch_id as bid, ws.product_id as pid, sum(ws.available)::float as stock
    from warehouse_stocks ws join warehouses w on w.id = ws.warehouse_id
    where true ${branchFilter('w.branch_id', scope)}
    group by w.branch_id, ws.product_id`)).rows as any[];
  const prods = (await db.execute(sql`
    select id, sku, name, unit, alternate_unit, conversion_factor, purchase_price, selling_price, min_stock
    from products where is_archived = false and status <> 'Archived'`)).rows as any[];
  const lastSale = (await db.execute(sql`
    select si.product_id as pid, max(s.created_at) as last_at
    from sale_items si join sales s on s.id = si.sale_id where si.product_id is not null ${branchFilter('s.branch_id', scope)} group by si.product_id`)).rows as any[];
  const supplierRows = (await db.execute(sql`
    select distinct on (gi.product_id) gi.product_id as pid, g.supplier_id as sid, g.supplier_name as sname
    from goods_receipt_items gi join goods_receipts g on g.id = gi.receipt_id
    order by gi.product_id, g.received_date desc`)).rows as any[];
  const supplierPhones = (await db.execute(sql`select id, phone from suppliers`)).rows as any[];
  const firstSaleRow = (await db.execute(sql`select min(created_at) as first_at from sales`)).rows[0] as any;
  const historyDays = firstSaleRow?.first_at ? Math.max(0, Math.floor((Date.now() - new Date(firstSaleRow.first_at).getTime()) / 86400000)) : 0;

  const prodOf = new Map(prods.map((p) => [p.id, p]));
  const stockBy = new Map<string, Map<string, number>>(); // product -> branch -> stock
  for (const r of stockRows) {
    if (!stockBy.has(r.pid)) stockBy.set(r.pid, new Map());
    stockBy.get(r.pid)!.set(r.bid, Number(r.stock));
  }
  const stockTotal = (pid: string) => [...(stockBy.get(pid)?.values() ?? [])].reduce((a, b) => a + b, 0);

  // selling speed per product (all scope) and per product per branch
  const windowDays = (first: string | Date) => Math.min(90, Math.max(14, Math.ceil((Date.now() - new Date(first).getTime()) / 86400000)));
  const rate = new Map<string, { qty: number; rev: number; perDay: number }>();
  const rateBranch = new Map<string, number>(); // `${pid}|${bid}` -> per day
  for (const r of sold) {
    const perDay = Number(r.qty) / windowDays(r.first_at);
    const cur = rate.get(r.pid) || { qty: 0, rev: 0, perDay: 0 };
    cur.qty += Number(r.qty);
    cur.rev += Number(r.rev);
    cur.perDay += perDay;
    rate.set(r.pid, cur);
    rateBranch.set(`${r.pid}|${r.bid}`, perDay);
  }

  // ---- ABC: top products by revenue over the last 90 days ----
  const ranked = [...rate.entries()].filter(([pid]) => prodOf.has(pid)).sort((a, b) => b[1].rev - a[1].rev);
  const totalRev = ranked.reduce((s, [, v]) => s + v.rev, 0);
  let cum = 0;
  const abcOf = new Map<string, 'A' | 'B' | 'C'>();
  const abc: AbcItem[] = [];
  for (const [pid, v] of ranked) {
    const share = totalRev ? (v.rev / totalRev) * 100 : 0;
    const before = cum;
    cum += share;
    const cls: 'A' | 'B' | 'C' = before < 80 ? 'A' : before < 95 ? 'B' : 'C';
    abcOf.set(pid, cls);
    const p = prodOf.get(pid);
    const stock = stockTotal(pid);
    abc.push({
      productId: pid,
      name: p.name,
      sku: p.sku,
      revenue: round(v.rev),
      sharePercent: Math.round(share * 10) / 10,
      cumulativePercent: Math.round(cum * 10) / 10,
      abc: cls,
      stock: round(stock),
      unit: p.unit,
      daysLeft: v.perDay > 0 ? Math.floor(stock / v.perDay) : null
    });
  }

  // ---- reorder list, grouped by supplier ----
  const supplierOf = new Map(supplierRows.map((r) => [r.pid, r]));
  const phoneOf = new Map(supplierPhones.map((r) => [r.id, r.phone as string | null]));
  const groups = new Map<string, SupplierOrder>();
  let lineCount = 0;
  for (const [pid, v] of rate) {
    const p = prodOf.get(pid);
    if (!p || v.qty < 3) continue;
    const perDay = v.perDay * seasonFactor;
    const stock = Math.max(0, stockTotal(pid));
    const daysLeft = perDay > 0 ? stock / perDay : Infinity;
    const trigger = stock <= perDay * (leadDays + 7) || stock <= Number(p.min_stock);
    if (!trigger) continue;
    const need = Math.ceil(perDay * (leadDays + coverDays) - stock);
    if (need <= 0) continue;
    const q = toBox(need, p);
    const sup = supplierOf.get(pid);
    const name = sup?.sname || 'No supplier on record';
    if (!groups.has(name)) groups.set(name, { supplierName: name, supplierPhone: sup ? phoneOf.get(sup.sid) ?? null : null, lines: [], message: '' });
    groups.get(name)!.lines.push({
      productId: pid,
      sku: p.sku,
      name: p.name,
      stock: round(stock),
      unit: p.unit,
      perMonth: round(perDay * 30),
      daysLeft: Number.isFinite(daysLeft) ? Math.floor(daysLeft) : 999,
      orderQty: q.qty,
      label: q.label,
      abc: abcOf.get(pid) || 'C'
    });
    lineCount++;
  }
  const orders = [...groups.values()]
    .map((g) => {
      g.lines.sort((a, b) => a.daysLeft - b.daysLeft);
      g.message = [
        g.supplierName === 'No supplier on record' ? 'Hello, please send the following:' : `Hello ${g.supplierName}, please send the following:`,
        ...g.lines.map((l) => `- ${l.name}: ${l.label}`),
        'Please confirm the price and the delivery date. Thank you. Acme Agro Equipment'
      ].join('\n');
      return g;
    })
    .sort((a, b) => (a.supplierName === 'No supplier on record' ? 1 : 0) - (b.supplierName === 'No supplier on record' ? 1 : 0) || b.lines.length - a.lines.length);

  // ---- slow and dead stock ----
  const lastSaleOf = new Map(lastSale.map((r) => [r.pid, new Date(r.last_at).getTime()]));
  const slowItems: SlowItem[] = [];
  const idleAfter = Math.min(60, Math.max(14, historyDays));
  for (const p of prods) {
    const stock = stockTotal(p.id);
    if (stock <= 0) continue;
    const last = lastSaleOf.get(p.id);
    const since = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const idle = since === null ? historyDays >= 14 : since >= idleAfter;
    if (!idle) continue;
    const pp = Number(p.purchase_price) || 0;
    const sp = Number(p.selling_price) || 0;
    slowItems.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      stock: round(stock),
      unit: p.unit,
      value: round(stock * (pp || sp)),
      valueBasis: pp ? 'purchase price' : sp ? 'selling price' : 'not priced',
      daysSinceSale: since
    });
  }
  slowItems.sort((a, b) => b.value - a.value || b.stock - a.stock);

  // ---- move stock between branches instead of buying more ----
  const transfers: TransferIdea[] = [];
  if (scope === 'all') {
    for (const [pid, perBranch] of stockBy) {
      const p = prodOf.get(pid);
      if (!p) continue;
      const rows = [...perBranch.entries()].map(([bid, stock]) => ({ bid, stock, perDay: (rateBranch.get(`${pid}|${bid}`) || 0) * seasonFactor }));
      for (const bid of branchName.keys()) if (!perBranch.has(bid)) rows.push({ bid, stock: 0, perDay: (rateBranch.get(`${pid}|${bid}`) || 0) * seasonFactor });
      const needy = rows.filter((r) => r.perDay > 0 && r.stock / r.perDay < leadDays + 14).sort((a, b) => a.stock / a.perDay - b.stock / b.perDay);
      const donors = rows.filter((r) => r.stock > 0 && r.stock - r.perDay * 60 >= 3).sort((a, b) => b.stock - a.stock);
      for (const n of needy) {
        const need = Math.ceil(n.perDay * (leadDays + coverDays) - n.stock);
        const donor = donors.find((d) => d.bid !== n.bid && d.stock - d.perDay * 60 >= 3);
        if (!donor || need <= 0) continue;
        const surplus = Math.floor(donor.stock - donor.perDay * 60);
        let qty = Math.min(surplus, need);
        const f = p.alternate_unit && Number(p.conversion_factor) > 1 ? Number(p.conversion_factor) : 0;
        if (f && qty >= f) qty = Math.floor(qty / f) * f;
        if (qty < 3) continue;
        donor.stock -= qty;
        transfers.push({
          productId: pid,
          name: p.name,
          sku: p.sku,
          fromBranch: branchName.get(donor.bid) || donor.bid,
          toBranch: branchName.get(n.bid) || n.bid,
          qty,
          unit: p.unit,
          reason: `${branchName.get(n.bid) || n.bid} has about ${Math.max(0, Math.floor(n.stock / n.perDay))} days left; ${branchName.get(donor.bid) || donor.bid} holds more than it sells in 60 days`
        });
      }
    }
    transfers.sort((a, b) => b.qty - a.qty);
  }

  return {
    generatedAt: new Date().toISOString(),
    leadDays,
    coverDays,
    seasonFactor,
    historyDays,
    orders,
    orderLineCount: lineCount,
    slow: {
      items: slowItems.slice(0, 25),
      reliable: historyDays >= 60,
      basis: historyDays >= 60 ? `No sale for ${idleAfter} days or more` : `Only ${historyDays} days of sales are on record, so "not sold" may just mean "not sold yet"`,
      totalValue: slowItems.reduce((s, i) => s + i.value, 0)
    },
    transfers: transfers.slice(0, 20),
    abc: abc.slice(0, 15)
  };
}
export { addDays };
