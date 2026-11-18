import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { StockError, applyStockDelta, type Actor, type Tx } from './stockService.ts';
import { businessDate } from '../routes/context.ts';

// Product returns: a customer brings back something from an earlier bill (a counter sale or a tax invoice).
// The person picks the customer's bought line, says how many came back and whether the goods are damaged.
//  - Not damaged: the goods go back on the shelf, into the warehouse the stock was taken from.
//  - Damaged: the return is recorded, but nothing is added to stock.
// A line can never be returned more than was sold (earlier returns of the same line are counted).

export const RETURN_CONDITIONS = ['Not damaged', 'Damaged'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function ensureReturnsTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists product_returns (
      id text primary key,
      return_number text not null unique,
      return_date text not null,
      branch_id text,
      warehouse_id text,
      customer_id text,
      customer_name text not null,
      customer_phone text,
      source_type text not null,
      source_id text not null,
      source_number text not null,
      line_id text not null,
      product_id text not null,
      product_name text not null,
      sku text,
      unit text,
      unit_factor double precision not null default 1,
      quantity double precision not null,
      stock_quantity integer not null,
      refund_value double precision not null default 0,
      condition text not null,
      reason text,
      restocked boolean not null default false,
      stock_note text,
      processed_by text,
      created_at timestamptz not null default now()
    )`);
  await db.execute(sql`create index if not exists idx_product_returns_line on product_returns (source_type, line_id)`);
  await db.execute(sql`create index if not exists idx_product_returns_branch on product_returns (branch_id, created_at)`);
  // What was done with damaged goods afterwards: Held (default) | Sent to supplier | Repaired | Scrapped
  await db.execute(sql`alter table product_returns add column if not exists damage_status text not null default 'Held'`);
  await db.execute(sql`alter table product_returns add column if not exists damage_note text`);
  await db.execute(sql`alter table product_returns add column if not exists damage_updated_by text`);
  await db.execute(sql`alter table product_returns add column if not exists damage_updated_at timestamptz`);
  // What the return did to the customer's money: taken off the bill's balance, kept as credit, or paid back in cash
  await db.execute(sql`alter table product_returns add column if not exists balance_reduced double precision not null default 0`);
  await db.execute(sql`alter table product_returns add column if not exists credit_added double precision not null default 0`);
  await db.execute(sql`alter table product_returns add column if not exists cash_refunded double precision not null default 0`);
  await db.execute(sql`alter table product_returns add column if not exists refund_method text`);
  // Credit a customer holds with us: positive rows are added by returns, negative rows are used against an invoice
  await db.execute(sql`
    create table if not exists customer_credits (
      id text primary key,
      customer_key text not null,
      customer_id text,
      customer_name text not null,
      customer_phone text,
      branch_id text,
      amount double precision not null,
      kind text not null,
      return_id text,
      document_id text,
      note text,
      created_by text,
      created_at timestamptz not null default now()
    )`);
  await db.execute(sql`create index if not exists idx_customer_credits_key on customer_credits (customer_key)`);
}

const istDate = (d: Date | string) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));

export interface PurchaseLine {
  sourceType: 'sale' | 'invoice';
  sourceId: string;
  lineId: string;
  number: string;
  date: string;
  branchId: string | null;
  branchName: string | null;
  customerKey: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  unitFactor: number;
  quantity: number;
  returned: number;
  remaining: number;
  unitValue: number; // what the customer paid for one unit, tax included
  stockTracked: boolean; // false: the bill never took stock, so a return cannot put anything back
  billBalance: number; // what the customer still owes on this invoice (0 for counter sales)
}

// The customer's bought lines, newest first. Non-owners only see their own branch.
export async function listPurchases(scope: string, q?: string, limit = 250): Promise<PurchaseLine[]> {
  const cap = Math.min(Math.max(Math.trunc(limit) || 250, 1), 500);
  const like = q && q.trim() ? `%${q.trim().toLowerCase()}%` : null;
  const branchSales = scope && scope !== 'all' ? sql`and s.branch_id = ${scope}` : sql``;
  const branchDocs = scope && scope !== 'all' ? sql`and d.branch_id = ${scope}` : sql``;
  const searchSales = like
    ? sql`and (lower(s.customer_name) like ${like} or lower(coalesce(c.phone, '')) like ${like} or lower(si.product_name) like ${like} or lower(coalesce(si.sku, '')) like ${like} or lower(s.sale_number) like ${like})`
    : sql``;
  const searchDocs = like
    ? sql`and (lower(d.customer_name) like ${like} or lower(coalesce(d.customer_phone, '')) like ${like} or lower(di.description) like ${like} or lower(coalesce(di.sku, '')) like ${like} or lower(d.doc_number) like ${like})`
    : sql``;

  const saleRows = (
    await db.execute(sql`
      select si.id::text as line_id, s.id as source_id, s.sale_number as number, s.created_at as at, s.branch_id, b.name as branch_name,
             s.customer_id, s.customer_name, c.phone as phone, si.product_id, si.product_name, si.sku, si.unit, si.unit_factor,
             si.quantity::float8 as quantity, si.line_total::float8 as line_total
      from sale_items si
      join sales s on s.id = si.sale_id
      left join customers c on c.id = s.customer_id
      left join branches b on b.id = s.branch_id
      where si.product_id is not null ${branchSales} ${searchSales}
      order by s.created_at desc, si.id desc limit ${cap}`)
  ).rows as any[];

  const docRows = (
    await db.execute(sql`
      select di.id::text as line_id, d.id as source_id, d.doc_number as number, d.doc_date as at, d.branch_id, b.name as branch_name,
             d.customer_id, d.customer_name, d.customer_phone as phone, di.product_id, di.description as product_name, di.sku, di.unit,
             di.quantity::float8 as quantity, di.line_total::float8 as line_total, d.stock_deducted, (d.grand_total - d.paid_amount)::float8 as bill_balance
      from document_items di
      join documents d on d.id = di.document_id
      left join branches b on b.id = d.branch_id
      where d.doc_type = 'invoice' and d.status in ('Issued', 'Partially Paid', 'Paid') and d.source_machine_sale_id is null and di.product_id is not null ${branchDocs} ${searchDocs}
      order by d.doc_date desc, di.id desc limit ${cap}`)
  ).rows as any[];

  const returnedRows = (
    await db.execute(sql`select source_type, line_id, sum(quantity)::float8 as q from product_returns group by source_type, line_id`)
  ).rows as any[];
  const returnedBy = new Map(returnedRows.map((r) => [`${r.source_type}|${r.line_id}`, Number(r.q)]));

  const lines: PurchaseLine[] = [];
  const push = (type: 'sale' | 'invoice', r: any, factor: number, stockTracked: boolean) => {
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) return;
    const returned = returnedBy.get(`${type}|${r.line_id}`) ?? 0;
    lines.push({
      sourceType: type,
      sourceId: r.source_id,
      lineId: r.line_id,
      number: r.number,
      date: istDate(r.at),
      branchId: r.branch_id,
      branchName: r.branch_name,
      customerKey: r.customer_id || `${String(r.customer_name).toLowerCase()}|${r.phone || ''}`,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.phone || null,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      unit: r.unit || 'Piece',
      unitFactor: factor,
      quantity: qty,
      returned,
      remaining: Math.max(0, qty - returned),
      unitValue: round2((Number(r.line_total) || 0) / qty),
      stockTracked,
      billBalance: type === 'invoice' ? Math.max(0, round2(Number(r.bill_balance) || 0)) : 0
    });
  };
  for (const r of saleRows) push('sale', r, Number(r.unit_factor) || 1, true);
  for (const r of docRows) push('invoice', r, 1, !!r.stock_deducted);
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return lines.slice(0, cap);
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  returnDate: string;
  branchId: string | null;
  branchName: string | null;
  customerName: string;
  customerPhone: string | null;
  sourceType: string;
  sourceNumber: string;
  productId: string;
  productName: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  stockQuantity: number;
  refundValue: number;
  condition: string;
  reason: string | null;
  restocked: boolean;
  damageStatus: string;
  damageNote: string | null;
  balanceReduced: number;
  creditAdded: number;
  cashRefunded: number;
  refundMethod: string | null;
  stockNote: string | null;
  processedBy: string | null;
  createdAt: string;
}

const present = (r: any): ReturnRecord => ({
  id: r.id,
  returnNumber: r.return_number,
  returnDate: r.return_date,
  branchId: r.branch_id,
  branchName: r.branch_name ?? null,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  sourceType: r.source_type,
  sourceNumber: r.source_number,
  productId: r.product_id,
  productName: r.product_name,
  sku: r.sku,
  unit: r.unit,
  quantity: Number(r.quantity),
  stockQuantity: Number(r.stock_quantity),
  refundValue: Number(r.refund_value),
  condition: r.condition,
  reason: r.reason,
  restocked: !!r.restocked,
  damageStatus: r.damage_status || 'Held',
  damageNote: r.damage_note ?? null,
  balanceReduced: Number(r.balance_reduced || 0),
  creditAdded: Number(r.credit_added || 0),
  cashRefunded: Number(r.cash_refunded || 0),
  refundMethod: r.refund_method ?? null,
  stockNote: r.stock_note,
  processedBy: r.processed_by,
  createdAt: new Date(r.created_at).toISOString()
});

export async function listReturns(scope: string, q?: string, limit = 200, condition?: string): Promise<ReturnRecord[]> {
  const cap = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500);
  const branch = scope && scope !== 'all' ? sql`and r.branch_id = ${scope}` : sql``;
  const like = q && q.trim() ? `%${q.trim().toLowerCase()}%` : null;
  const cond = condition && (RETURN_CONDITIONS as readonly string[]).includes(condition) ? sql`and r.condition = ${condition}` : sql``;
  const search = like
    ? sql`and (lower(r.customer_name) like ${like} or lower(r.product_name) like ${like} or lower(r.return_number) like ${like} or lower(r.source_number) like ${like} or lower(coalesce(r.customer_phone, '')) like ${like})`
    : sql``;
  const rows = (
    await db.execute(sql`
      select r.*, b.name as branch_name from product_returns r left join branches b on b.id = r.branch_id
      where true ${branch} ${cond} ${search} order by r.created_at desc limit ${cap}`)
  ).rows as any[];
  return rows.map(present);
}

function whole(n: unknown, label: string): number {
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new StockError(`${label} must be more than zero`);
  if (!Number.isInteger(v)) throw new StockError(`${label} must be a whole number`);
  return v;
}

async function nextReturnNumber(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product_returns_number'))`);
  const stem = `RET-${businessDate().slice(0, 4)}-`;
  const r = (await tx.execute(sql`select coalesce(max(substring(return_number from '[0-9]+$')::int), 0) as n from product_returns where return_number like ${stem + '%'}`)).rows as any[];
  return `${stem}${String(Number(r[0]?.n || 0) + 1).padStart(4, '0')}`;
}

// Which warehouse the goods came out of: the one that lost the most on that bill, else the bill's recorded warehouse,
// else the first warehouse of the branch.
async function restockWarehouse(tx: Tx, a: { sourceType: string; sourceId: string; productId: string; branchId: string | null; lineWarehouse?: string | null }): Promise<string | null> {
  if (a.lineWarehouse) return a.lineWarehouse;
  const refTypes = a.sourceType === 'sale' ? ['sale', 'sale-edit'] : ['document'];
  const moved = (
    await tx.execute(sql`
      select warehouse_id, sum(available_delta)::int as d from stock_movements
      where ref_type in (${sql.join(refTypes.map((t) => sql`${t}`), sql`, `)}) and ref_id = ${a.sourceId} and product_id = ${a.productId}
      group by warehouse_id order by sum(available_delta) asc limit 1`)
  ).rows as any[];
  if (moved[0]?.warehouse_id) return moved[0].warehouse_id;
  if (!a.branchId) return null;
  const wh = (await tx.execute(sql`select id from warehouses where branch_id = ${a.branchId} order by id limit 1`)).rows as any[];
  return wh[0]?.id ?? null;
}

const customerKeyOf = (customerId: string | null, name: string, phone: string | null) => customerId || `${String(name).toLowerCase()}|${phone || ''}`;

// A 'Return credit' payment takes value off an invoice's balance without any money moving, so the day book and the
// cash book do not count it as received.
export const RETURN_CREDIT_METHOD = 'Return credit';
async function applyReturnCredit(tx: Tx, documentId: string, amount: number, reference: string, by: string) {
  const d = ((await tx.execute(sql`select grand_total::float8 as g, paid_amount::float8 as p from documents where id = ${documentId} for update`)).rows as any[])[0];
  const paid = round2(d.p + amount);
  await tx.execute(sql`insert into document_payments (document_id, amount, method, paid_on, reference, received_by) values (${documentId}, ${amount}, ${RETURN_CREDIT_METHOD}, ${businessDate()}, ${reference}, ${by})`);
  await tx.execute(sql`update documents set paid_amount = ${paid}, status = ${paid >= d.g - 0.01 ? 'Paid' : 'Partially Paid'}, updated_at = now() where id = ${documentId}`);
}

export async function createReturn(input: Record<string, any>, actor: Actor): Promise<ReturnRecord> {
  const sourceType = String(input.sourceType || '');
  if (sourceType !== 'sale' && sourceType !== 'invoice') throw new StockError('Choose a bill to return from');
  const sourceId = String(input.sourceId || '').slice(0, 100);
  const lineId = String(input.lineId || '').slice(0, 40);
  if (!sourceId || !/^\d+$/.test(lineId)) throw new StockError('Choose the product to return');
  const quantity = whole(input.quantity, 'The quantity returned');
  const condition = String(input.condition || '') as ReturnCondition;
  if (!(RETURN_CONDITIONS as readonly string[]).includes(condition)) throw new StockError('Say whether the goods are damaged or not damaged');
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  const settlement = input.settlement === 'refund' ? 'refund' : input.settlement === 'credit' ? 'credit' : null;
  const refundMethod = ['Cash', 'UPI', 'Bank Transfer'].includes(String(input.refundMethod)) ? String(input.refundMethod) : 'Cash';

  const id = await db.transaction(async (tx) => {
    // one return at a time per bill line, so two people cannot return the same goods twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`return:${sourceType}:${lineId}`}))`);

    let line: {
      number: string;
      branchId: string | null;
      customerId: string | null;
      customerName: string;
      phone: string | null;
      productId: string;
      productName: string;
      sku: string | null;
      unit: string;
      factor: number;
      quantity: number;
      lineTotal: number;
      lineWarehouse: string | null;
      stockTracked: boolean;
    };
    if (sourceType === 'sale') {
      const r = (
        await tx.execute(sql`
          select s.sale_number, s.branch_id, s.customer_id, s.customer_name, c.phone, si.product_id, si.product_name, si.sku, si.unit, si.unit_factor,
                 si.quantity::float8 as quantity, si.line_total::float8 as line_total
          from sale_items si join sales s on s.id = si.sale_id left join customers c on c.id = s.customer_id
          where si.id = ${Number(lineId)} and s.id = ${sourceId}`)
      ).rows as any[];
      if (!r[0] || !r[0].product_id) throw new StockError('That sale line was not found', 404);
      line = { number: r[0].sale_number, branchId: r[0].branch_id, customerId: r[0].customer_id, customerName: r[0].customer_name, phone: r[0].phone, productId: r[0].product_id, productName: r[0].product_name, sku: r[0].sku, unit: r[0].unit || 'Piece', factor: Number(r[0].unit_factor) || 1, quantity: Number(r[0].quantity), lineTotal: Number(r[0].line_total), lineWarehouse: null, stockTracked: true };
    } else {
      const r = (
        await tx.execute(sql`
          select d.doc_number, d.branch_id, d.customer_id, d.customer_name, d.customer_phone, d.status, d.stock_deducted, di.product_id, di.description, di.sku, di.unit,
                 di.quantity::float8 as quantity, di.line_total::float8 as line_total, di.warehouse_id
          from document_items di join documents d on d.id = di.document_id
          where di.id = ${Number(lineId)} and d.id = ${sourceId} and d.doc_type = 'invoice' and d.source_machine_sale_id is null`)
      ).rows as any[];
      if (!r[0] || !r[0].product_id) throw new StockError('That invoice line was not found', 404);
      if (!['Issued', 'Partially Paid', 'Paid'].includes(r[0].status)) throw new StockError('Only an issued invoice can have a return');
      line = { number: r[0].doc_number, branchId: r[0].branch_id, customerId: r[0].customer_id, customerName: r[0].customer_name, phone: r[0].customer_phone, productId: r[0].product_id, productName: r[0].description, sku: r[0].sku, unit: r[0].unit || 'Piece', factor: 1, quantity: Number(r[0].quantity), lineTotal: Number(r[0].line_total), lineWarehouse: r[0].warehouse_id, stockTracked: !!r[0].stock_deducted };
    }

    if (!actor.isOwner && actor.branchId !== line.branchId) throw new StockError('You can only record returns for your own branch', 403);

    const done = (await tx.execute(sql`select coalesce(sum(quantity), 0)::float8 as q from product_returns where source_type = ${sourceType} and line_id = ${lineId}`)).rows as any[];
    const already = Number(done[0]?.q || 0);
    const left = line.quantity - already;
    if (quantity > left + 1e-9) {
      throw new StockError(left <= 0 ? 'All of this product on that bill has already been returned' : `Only ${left} ${line.unit} of this product can still be returned (${line.quantity} were sold, ${already} already returned)`);
    }
    const stockQty = quantity * line.factor;
    if (!Number.isInteger(stockQty)) throw new StockError('That quantity does not make a whole number of items in stock');

    const returnId = `ret-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const returnNumber = await nextReturnNumber(tx);

    let restocked = false;
    let warehouseId: string | null = null;
    let stockNote: string | null = null;
    if (condition === 'Damaged') {
      stockNote = 'Damaged: kept out of stock, on the damaged products list';
    } else if (!line.stockTracked) {
      stockNote = 'Stock was never taken for this bill, so nothing was added back';
    } else {
      warehouseId = await restockWarehouse(tx, { sourceType, sourceId, productId: line.productId, branchId: line.branchId, lineWarehouse: line.lineWarehouse });
      if (!warehouseId) throw new StockError('No warehouse is set up for this branch, so the goods cannot be put back in stock.');
      await applyStockDelta(tx, {
        productId: line.productId,
        warehouseId,
        availableDelta: stockQty,
        type: 'sale-return',
        refType: 'return',
        refId: returnId,
        note: `Return ${returnNumber} of ${line.number}${reason ? `: ${reason}` : ''}`,
        user: actor.name
      });
      restocked = true;
      stockNote = 'Added back to stock';
    }

    const refund = round2((line.lineTotal / line.quantity) * quantity);

    // The customer's money: first off what they still owe on this invoice, then credit or a cash refund for the rest
    let balanceReduced = 0;
    let creditAdded = 0;
    let cashRefunded = 0;
    let usedMethod: string | null = null;
    if (sourceType === 'invoice' && refund > 0.005) {
      const d = ((await tx.execute(sql`select doc_number, grand_total::float8 as g, paid_amount::float8 as p from documents where id = ${sourceId} for update`)).rows as any[])[0];
      const owing = round2(d.g - d.p);
      if (owing > 0.5) {
        balanceReduced = round2(Math.min(refund, owing));
        await applyReturnCredit(tx, sourceId, balanceReduced, `Return ${returnNumber}`, actor.name);
      }
    }
    const rest = round2(refund - balanceReduced);
    if (rest > 0.5) {
      if (!settlement) throw new StockError('Choose what to do with the value of the goods: keep it as credit for the customer, or refund it.');
      const custKey = customerKeyOf(line.customerId, line.customerName, line.phone);
      if (settlement === 'credit') {
        creditAdded = rest;
        await tx.execute(sql`
          insert into customer_credits (id, customer_key, customer_id, customer_name, customer_phone, branch_id, amount, kind, return_id, note, created_by)
          values (${`cc-${returnId}`}, ${custKey}, ${line.customerId}, ${line.customerName}, ${line.phone}, ${line.branchId}, ${rest}, 'return', ${returnId}, ${`Return ${returnNumber} of ${line.number}`}, ${actor.name})`);
      } else {
        cashRefunded = rest;
        usedMethod = refundMethod;
        if (!line.branchId) throw new StockError('This bill has no branch, so a refund cannot be recorded in the cash book.');
        await tx.execute(sql`
          insert into cash_entries (id, branch_id, entry_date, type, category, amount, method, description, created_by)
          values (${`cash-ret-${returnId}`}, ${line.branchId}, ${businessDate()}, 'out', 'Customer refund', ${rest}, ${refundMethod}, ${`Return ${returnNumber}: refund to ${line.customerName} for ${line.productName}`}, ${actor.name})`);
      }
    }
    await tx.execute(sql`
      insert into product_returns (id, return_number, return_date, branch_id, warehouse_id, customer_id, customer_name, customer_phone, source_type, source_id, source_number,
        line_id, product_id, product_name, sku, unit, unit_factor, quantity, stock_quantity, refund_value, condition, reason, restocked, stock_note, processed_by,
        balance_reduced, credit_added, cash_refunded, refund_method)
      values (${returnId}, ${returnNumber}, ${businessDate()}, ${line.branchId}, ${warehouseId}, ${line.customerId}, ${line.customerName}, ${line.phone}, ${sourceType}, ${sourceId}, ${line.number},
        ${lineId}, ${line.productId}, ${line.productName}, ${line.sku}, ${line.unit}, ${line.factor}, ${quantity}, ${stockQty}, ${refund}, ${condition}, ${reason}, ${restocked}, ${stockNote}, ${actor.name},
        ${balanceReduced}, ${creditAdded}, ${cashRefunded}, ${usedMethod})`);
    return returnId;
  });

  const row = (await db.execute(sql`select r.*, b.name as branch_name from product_returns r left join branches b on b.id = r.branch_id where r.id = ${id}`)).rows as any[];
  return present(row[0]);
}

// ---------- what happens to damaged goods ----------
export const DAMAGE_STATUSES = ['Held', 'Sent to supplier', 'Repaired', 'Scrapped'] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

// Moves a damaged return on: sent back to the supplier, repaired (the goods go back into stock) or scrapped.
// Repaired and Scrapped are final. Sent to supplier can still become Repaired or Scrapped when the goods come back.
export async function setDamageStatus(id: string, input: Record<string, any>, actor: Actor): Promise<ReturnRecord> {
  const status = String(input.status || '') as DamageStatus;
  if (!(['Sent to supplier', 'Repaired', 'Scrapped'] as string[]).includes(status)) throw new StockError('Choose Sent to supplier, Repaired or Scrapped');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`damage:${id}`}))`);
    const rows = (await tx.execute(sql`select * from product_returns where id = ${id}`)).rows as any[];
    const r = rows[0];
    if (!r) throw new StockError('Return not found', 404);
    if (r.condition !== 'Damaged') throw new StockError('Only damaged returns can be marked');
    if (!actor.isOwner && actor.branchId !== r.branch_id) throw new StockError('You can only update returns for your own branch', 403);
    const current = r.damage_status || 'Held';
    if (current === 'Repaired' || current === 'Scrapped') throw new StockError(`This was already marked ${current}`);
    if (current === status) throw new StockError(`This is already marked ${status}`);

    let stockNote: string | null = r.stock_note;
    let restocked = !!r.restocked;
    let warehouseId: string | null = r.warehouse_id;
    if (status === 'Repaired') {
      warehouseId = await restockWarehouse(tx, { sourceType: r.source_type, sourceId: r.source_id, productId: r.product_id, branchId: r.branch_id, lineWarehouse: null });
      if (!warehouseId) throw new StockError('No warehouse is set up for this branch, so the goods cannot be put back in stock.');
      await applyStockDelta(tx, {
        productId: r.product_id,
        warehouseId,
        availableDelta: Number(r.stock_quantity),
        type: 'sale-return',
        refType: 'return-repaired',
        refId: id,
        note: `Repaired goods from return ${r.return_number} back in stock${note ? `: ${note}` : ''}`,
        user: actor.name
      });
      restocked = true;
      stockNote = 'Repaired, added back to stock';
    } else if (status === 'Scrapped') {
      stockNote = 'Damaged: scrapped';
    } else {
      stockNote = 'Damaged: sent to the supplier';
    }
    await tx.execute(sql`
      update product_returns set damage_status = ${status}, damage_note = ${note}, damage_updated_by = ${actor.name}, damage_updated_at = now(),
        restocked = ${restocked}, warehouse_id = ${warehouseId}, stock_note = ${stockNote}
      where id = ${id}`);
  });

  const row = (await db.execute(sql`select r.*, b.name as branch_name from product_returns r left join branches b on b.id = r.branch_id where r.id = ${id}`)).rows as any[];
  return present(row[0]);
}

// ---------- credit a customer holds with us ----------

export interface CreditBalance {
  customerKey: string;
  customerName: string;
  customerPhone: string | null;
  balance: number;
}

// Customers who have credit left, by customer key (the same key the purchases list uses).
export async function listCredits(): Promise<CreditBalance[]> {
  const rows = (
    await db.execute(sql`
      select customer_key, max(customer_name) as name, max(customer_phone) as phone, sum(amount)::float8 as balance
      from customer_credits group by customer_key having sum(amount) > 0.5 order by sum(amount) desc`)
  ).rows as any[];
  return rows.map((r) => ({ customerKey: r.customer_key, customerName: r.name, customerPhone: r.phone, balance: round2(Number(r.balance)) }));
}

export interface OpenInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  branchId: string;
  total: number;
  balance: number;
}

// Invoices of one customer that still have money owing (machine sale invoices are left out: they follow the machine sale).
export async function openInvoicesFor(scope: string, customerKey: string): Promise<OpenInvoice[]> {
  const branch = scope && scope !== 'all' ? sql`and d.branch_id = ${scope}` : sql``;
  const rows = (
    await db.execute(sql`
      select d.id, d.doc_number, d.doc_date, d.due_date, d.branch_id, d.grand_total::float8 as total, (d.grand_total - d.paid_amount)::float8 as bal
      from documents d
      where d.doc_type = 'invoice' and d.status in ('Issued', 'Partially Paid') and d.source_machine_sale_id is null
        and coalesce(d.customer_id, lower(d.customer_name) || '|' || coalesce(d.customer_phone, '')) = ${customerKey}
        and d.grand_total - d.paid_amount > 0.5 ${branch}
      order by d.doc_date asc`)
  ).rows as any[];
  return rows.map((r) => ({ id: r.id, number: r.doc_number, date: r.doc_date, dueDate: r.due_date, branchId: r.branch_id, total: round2(r.total), balance: round2(r.bal) }));
}

// Use a customer's credit against one of their open invoices.
export async function applyCredit(input: Record<string, any>, actor: Actor): Promise<{ balance: number; invoice: OpenInvoice | null }> {
  const customerKey = String(input.customerKey || '').slice(0, 200);
  const documentId = String(input.documentId || '').slice(0, 100);
  const amount = round2(Number(input.amount));
  if (!customerKey || !documentId) throw new StockError('Choose the customer and the invoice');
  if (!Number.isFinite(amount) || amount <= 0) throw new StockError('The amount must be more than zero');

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit:${customerKey}`}))`);
    const have = ((await tx.execute(sql`select coalesce(sum(amount), 0)::float8 as b, max(customer_name) as name, max(customer_phone) as phone, max(customer_id) as cid from customer_credits where customer_key = ${customerKey}`)).rows as any[])[0];
    if (round2(have.b) < amount - 0.005) throw new StockError(`This customer has only ${round2(have.b)} of credit`);
    const d = ((await tx.execute(sql`
      select id, doc_number, branch_id, status, source_machine_sale_id, grand_total::float8 as g, paid_amount::float8 as p,
             coalesce(customer_id, lower(customer_name) || '|' || coalesce(customer_phone, '')) as ckey
      from documents where id = ${documentId} and doc_type = 'invoice' for update`)).rows as any[])[0];
    if (!d) throw new StockError('Invoice not found', 404);
    if (d.ckey !== customerKey) throw new StockError('That invoice belongs to a different customer');
    if (d.source_machine_sale_id) throw new StockError('Credit cannot be applied to a machine sale invoice here');
    if (d.status !== 'Issued' && d.status !== 'Partially Paid') throw new StockError(`Credit cannot be applied to a ${d.status} invoice`);
    if (!actor.isOwner && actor.branchId !== d.branch_id) throw new StockError('You can only update invoices of your own branch', 403);
    const owing = round2(d.g - d.p);
    if (amount > owing + 0.005) throw new StockError(`The invoice only has ${owing} left to pay`);

    await applyReturnCredit(tx, documentId, amount, 'Customer credit', actor.name);
    await tx.execute(sql`
      insert into customer_credits (id, customer_key, customer_id, customer_name, customer_phone, branch_id, amount, kind, document_id, note, created_by)
      values (${`cc-use-${Date.now()}-${Math.floor(Math.random() * 100000)}`}, ${customerKey}, ${have.cid}, ${have.name}, ${have.phone}, ${d.branch_id}, ${-amount}, 'used', ${documentId}, ${`Used on ${d.doc_number}`}, ${actor.name})`);
  });

  const balance = ((await db.execute(sql`select coalesce(sum(amount), 0)::float8 as b from customer_credits where customer_key = ${customerKey}`)).rows as any[])[0].b;
  const left = (await openInvoicesFor('all', customerKey)).find((i) => i.id === documentId) ?? null;
  return { balance: round2(balance), invoice: left };
}
