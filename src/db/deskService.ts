import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate, newId } from '../routes/context.ts';
import { getAllBranchesSummary, getDaySummary, assertOpen, CashBookError } from './cashBookService.ts';
import { cashEntries } from './schema.cashBook.ts';
import { getCashInHand } from './cashHandoverService.ts';
import { getPendingPayments } from './messageService.ts';
import { getStockPlan } from './analyticsPlan.ts';

const branchSql = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);

// ---------------------------------------------------------------------------------------------- Today

export interface DeskToday {
  date: string;
  scopeLabel: string;
  sales: { total: number; cash: number; upi: number; bank: number; credit: number; count: number; serviceCollections: number };
  cashExpected: number;
  cashInHand: number;
  closedToday: boolean | null; // null when more than one branch is in view
  notClosedYesterday: { branchId: string; name: string; phone: string | null; manager: string | null }[];
  dues: { count: number; total: number; top: { name: string; number: string; balance: number; daysOverdue: number; source: string }[] };
  stock: { count: number; items: { name: string; stock: number; unit: string; daysLeft: number; order: string }[] };
  jobs: { open: number; ready: number };
  handovers: { count: number; out: number; in: number };
}

export async function getDeskToday(scope: string): Promise<DeskToday> {
  const today = businessDate();
  const yesterday = addDays(today, -1);
  const all = !scope || scope === 'all';

  const branchRows = (await db.execute(sql`select id, name, phone, manager from branches order by id`)).rows as { id: string; name: string; phone: string | null; manager: string | null }[];
  const scopeLabel = all ? 'All branches' : branchRows.find((b) => b.id === scope)?.name || scope;

  let sales: DeskToday['sales'];
  let cashExpected: number;
  let closedToday: boolean | null;
  if (all) {
    const t = (await getAllBranchesSummary(today)).totals;
    sales = { total: t.cashSales + t.upiSales + t.bankCardSales + t.creditSales, cash: t.cashSales, upi: t.upiSales, bank: t.bankCardSales, credit: t.creditSales, count: 0, serviceCollections: t.serviceCollections };
    cashExpected = t.expectedCash;
    closedToday = null;
  } else {
    const d = await getDaySummary(scope, today);
    sales = { total: d.cashSales + d.upiSales + d.bankCardSales + d.creditSales, cash: d.cashSales, upi: d.upiSales, bank: d.bankCardSales, credit: d.creditSales, count: d.salesCount, serviceCollections: d.serviceCollections };
    cashExpected = d.expectedCash;
    closedToday = d.isClosed;
  }

  const closedYesterday = new Set(
    ((await db.execute(sql`select branch_id from cash_closings where business_date = ${yesterday}`)).rows as any[]).map((r) => r.branch_id)
  );
  const hasHistory = new Set(((await db.execute(sql`select distinct branch_id from cash_closings`)).rows as any[]).map((r) => r.branch_id));
  // only branches that close their cash at all are expected to have closed yesterday
  const notClosedYesterday = branchRows.filter((b) => (all || b.id === scope) && hasHistory.has(b.id) && !closedYesterday.has(b.id)).map((b) => ({ branchId: b.id, name: b.name, phone: b.phone || null, manager: b.manager || null }));

  const inHand = (await getCashInHand(scope)).reduce((s, r) => s + r.cashInHand, 0);

  const pending = await getPendingPayments(scope);
  const dues = {
    count: pending.length,
    total: Math.round(pending.reduce((s, p) => s + p.balance, 0)),
    top: pending.slice(0, 5).map((p) => ({ name: p.customerName, number: p.invoiceNumber, balance: p.balance, daysOverdue: p.daysOverdue, source: p.source }))
  };

  let stock: DeskToday['stock'] = { count: 0, items: [] };
  try {
    const plan = await getStockPlan(all ? 'all' : scope);
    const lines = plan.orders.flatMap((o) => o.lines).sort((a, b) => a.daysLeft - b.daysLeft);
    stock = { count: lines.length, items: lines.slice(0, 6).map((l) => ({ name: l.name, stock: l.stock, unit: l.unit, daysLeft: l.daysLeft, order: l.label })) };
  } catch (e) {
    console.warn('desk today: stock plan not available:', (e as Error).message);
  }

  const jobRow = (
    await db.execute(sql`select
        count(*) filter (where status not in ('Delivered', 'Cancelled'))::int as open,
        count(*) filter (where status = 'Ready')::int as ready
      from job_cards where true ${branchSql('branch_id', scope)}`)
  ).rows[0] as any;

  const ho = (
    await db.execute(sql`select
        count(*)::int as n,
        coalesce(sum(amount) filter (where ${all ? sql`true` : sql`from_branch_id = ${scope}`}), 0)::float8 as out_amt,
        coalesce(sum(amount) filter (where ${all ? sql`true` : sql`to_branch_id = ${scope}`}), 0)::float8 as in_amt
      from cash_handovers where handover_date = ${today} ${all ? sql`` : sql`and (from_branch_id = ${scope} or to_branch_id = ${scope})`}`)
  ).rows[0] as any;

  return {
    date: today,
    scopeLabel,
    sales,
    cashExpected,
    cashInHand: Math.round(inHand * 100) / 100,
    closedToday,
    notClosedYesterday,
    dues,
    stock,
    jobs: { open: Number(jobRow?.open) || 0, ready: Number(jobRow?.ready) || 0 },
    handovers: { count: Number(ho?.n) || 0, out: Number(ho?.out_amt) || 0, in: Number(ho?.in_amt) || 0 }
  };
}

// ------------------------------------------------------------------------------------- Staff checks

export interface BigDiscount {
  saleId: string;
  saleNumber: string;
  branchName: string;
  createdBy: string | null;
  createdAt: string;
  customerName: string;
  discount: number;
  percent: number;
  grandTotal: number;
}

export async function getBigDiscounts(scope: string, days = 7, percent = 15): Promise<{ days: number; percent: number; items: BigDiscount[] }> {
  days = Math.min(90, Math.max(1, Math.round(days)));
  percent = Math.min(90, Math.max(1, Math.round(percent)));
  const res = await db.execute(sql`
    select * from (
      select s.id, s.sale_number, coalesce(b.name, s.branch_id) as branch_name, s.created_by, s.created_at, s.customer_name, s.grand_total::float8 as grand_total,
        (coalesce(s.discount, 0) + coalesce((select sum(si.discount) from sale_items si where si.sale_id = s.id), 0))::float8 as disc,
        s.subtotal::float8 as subtotal
      from sales s left join branches b on b.id = s.branch_id
      where s.created_at >= now() - (${days} * interval '1 day') ${branchSql('s.branch_id', scope)}
    ) x
    where x.disc > 0 and x.subtotal + x.disc > 0 and x.disc * 100.0 / (x.subtotal + x.disc) >= ${percent}
    order by x.disc desc limit 40`);
  return {
    days,
    percent,
    items: (res.rows as any[]).map((r) => ({
      saleId: r.id,
      saleNumber: r.sale_number,
      branchName: r.branch_name,
      createdBy: r.created_by || null,
      createdAt: new Date(r.created_at).toISOString(),
      customerName: r.customer_name,
      discount: Math.round(Number(r.disc)),
      percent: Math.round((Number(r.disc) * 100) / (Number(r.subtotal) + Number(r.disc))),
      grandTotal: Math.round(Number(r.grand_total))
    }))
  };
}

// ----------------------------------------------------------------------------------------- Backups

export interface BackupStatus {
  available: boolean;
  note?: string;
  instance: string;
  runs: { id: string; status: string; type: string; at: string | null; error: string | null }[];
  lastGoodAt: string | null;
}

// The automatic Cloud SQL backups, read with the service's own Google identity (works on Cloud Run only).
export async function getBackupStatus(): Promise<BackupStatus> {
  const instance = process.env.CLOUD_SQL_INSTANCE || '';
  const project = process.env.GOOGLE_CLOUD_PROJECT || '';
  try {
    const tokRes = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
    if (!tokRes.ok) throw new Error('no service identity');
    const token = ((await tokRes.json()) as any).access_token;
    const r = await fetch(`https://sqladmin.googleapis.com/sql/v1beta4/projects/${project}/instances/${instance}/backupRuns?maxResults=10`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Google answered ${r.status}`);
    const runs = (j.items || []).map((x: any) => ({
      id: String(x.id),
      status: x.status,
      type: x.type,
      at: x.endTime || x.startTime || x.windowStartTime || null,
      error: x.error?.message || null
    }));
    const good = runs.find((x: any) => x.status === 'SUCCESSFUL');
    return { available: true, instance, runs, lastGoodAt: good?.at || null };
  } catch (e: any) {
    return { available: false, note: `The backup list could not be read from here (${e?.message || 'unknown'}). Backups still run every night.`, instance, runs: [], lastGoodAt: null };
  }
}

// ----------------------------------------------------------------------------- Orders to suppliers

export const ORDER_STATUSES = ['Ordered', 'Received', 'Cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export async function ensureSupplierOrderTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists supplier_orders (
      id text primary key,
      order_no text not null,
      supplier_name text not null,
      supplier_phone text,
      branch_id text,
      status text not null default 'Ordered',
      expected_date text,
      lines jsonb not null default '[]'::jsonb,
      note text,
      created_by text,
      created_at timestamptz not null default now(),
      status_changed_by text,
      status_changed_at timestamptz
    )`);
  await db.execute(sql`create index if not exists idx_supplier_orders_status on supplier_orders (status, created_at)`);
}

export interface OrderLine {
  productId?: string | null;
  name: string;
  sku?: string | null;
  qty: number;
  unit?: string | null;
  label?: string | null;
}
export interface SupplierOrder {
  id: string;
  orderNo: string;
  supplierName: string;
  supplierPhone: string | null;
  branchId: string | null;
  branchName: string | null;
  status: OrderStatus;
  expectedDate: string | null;
  lines: OrderLine[];
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
}

const presentOrder = (r: any): SupplierOrder => ({
  id: r.id,
  orderNo: r.order_no,
  supplierName: r.supplier_name,
  supplierPhone: r.supplier_phone || null,
  branchId: r.branch_id || null,
  branchName: r.branch_name || null,
  status: r.status,
  expectedDate: r.expected_date || null,
  lines: Array.isArray(r.lines) ? r.lines : [],
  note: r.note || null,
  createdBy: r.created_by || null,
  createdAt: new Date(r.created_at).toISOString(),
  statusChangedBy: r.status_changed_by || null,
  statusChangedAt: r.status_changed_at ? new Date(r.status_changed_at).toISOString() : null
});

export async function listSupplierOrders(scope: string, status?: string, limit = 80): Promise<SupplierOrder[]> {
  const cap = Math.min(Math.max(Math.floor(limit) || 80, 1), 300);
  const st = status && (ORDER_STATUSES as readonly string[]).includes(status) ? sql`and o.status = ${status}` : sql``;
  const res = await db.execute(sql`
    select o.*, b.name as branch_name from supplier_orders o left join branches b on b.id = o.branch_id
    where true ${branchSql('o.branch_id', scope)} ${st}
    order by o.created_at desc limit ${cap}`);
  return (res.rows as any[]).map(presentOrder);
}

export async function createSupplierOrder(
  input: { supplierName: string; supplierPhone?: string | null; branchId?: string | null; expectedDate?: string | null; note?: string; lines: OrderLine[] },
  by: string
): Promise<SupplierOrder> {
  const supplierName = String(input.supplierName || '').trim().slice(0, 120);
  if (!supplierName) throw new CashBookError('Name the supplier.');
  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((l) => ({
      productId: l.productId || null,
      name: String(l.name || '').trim().slice(0, 200),
      sku: l.sku ? String(l.sku).slice(0, 80) : null,
      qty: Math.max(0, Number(l.qty) || 0),
      unit: l.unit ? String(l.unit).slice(0, 20) : null,
      label: l.label ? String(l.label).slice(0, 80) : null
    }))
    .filter((l) => l.name && l.qty > 0);
  if (lines.length === 0) throw new CashBookError('An order needs at least one item.');
  if (lines.length > 200) throw new CashBookError('An order can have at most 200 items.');
  const expected = input.expectedDate && /^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate) ? input.expectedDate : null;
  const id = newId('so');
  const today = businessDate();
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from supplier_orders where created_at::date = now()::date`)).rows as any[];
  const orderNo = `PO-${today.replace(/-/g, '')}-${String(Number(n) + 1).padStart(2, '0')}`;
  await db.execute(sql`
    insert into supplier_orders (id, order_no, supplier_name, supplier_phone, branch_id, expected_date, lines, note, created_by)
    values (${id}, ${orderNo}, ${supplierName}, ${input.supplierPhone || null}, ${input.branchId || null}, ${expected}, ${JSON.stringify(lines)}::jsonb, ${(input.note || '').trim().slice(0, 300) || null}, ${by.slice(0, 100) || null})`);
  return (await listSupplierOrders('all', undefined, 300)).find((o) => o.id === id)!;
}

export async function setSupplierOrderStatus(id: string, status: string, by: string): Promise<SupplierOrder> {
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) throw new CashBookError('Unknown status.');
  const res = await db.execute(sql`update supplier_orders set status = ${status}, status_changed_by = ${by.slice(0, 100)}, status_changed_at = now() where id = ${id} returning id`);
  if (!res.rows.length) throw new CashBookError('Order not found.', 404);
  return (await listSupplierOrders('all', undefined, 300)).find((o) => o.id === id)!;
}

// ------------------------------------------------------------------------------- Paying suppliers

export async function ensureSupplierPaymentTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists supplier_payments (
      id text primary key,
      payment_no text not null,
      supplier_id text not null,
      supplier_name text not null,
      amount double precision not null,
      method text not null default 'Cash',
      branch_id text,
      paid_on text not null,
      reference text,
      note text,
      created_by text,
      created_at timestamptz not null default now()
    )`);
  await db.execute(sql`create index if not exists idx_supplier_payments_supplier on supplier_payments (supplier_id, created_at)`);
}

export interface SupplierPayment {
  id: string;
  paymentNo: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  method: string;
  branchId: string | null;
  branchName: string | null;
  paidOn: string;
  reference: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

const presentPayment = (r: any): SupplierPayment => ({
  id: r.id,
  paymentNo: r.payment_no,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  amount: Number(r.amount),
  method: r.method,
  branchId: r.branch_id || null,
  branchName: r.branch_name || null,
  paidOn: r.paid_on,
  reference: r.reference || null,
  note: r.note || null,
  createdBy: r.created_by || null,
  createdAt: new Date(r.created_at).toISOString()
});

export async function listSupplierPayments(supplierId?: string, limit = 60): Promise<SupplierPayment[]> {
  const cap = Math.min(Math.max(Math.floor(limit) || 60, 1), 300);
  const cond = supplierId ? sql`where p.supplier_id = ${supplierId}` : sql``;
  const res = await db.execute(sql`
    select p.*, b.name as branch_name from supplier_payments p left join branches b on b.id = p.branch_id
    ${cond} order by p.created_at desc limit ${cap}`);
  return (res.rows as any[]).map(presentPayment);
}

const PAY_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];
const PAYMENT_CATEGORY = 'Supplier payment';

// A payment to a supplier. Paid in cash, it also goes out of the chosen branch's cash book today, so the cash in hand
// comes down. The supplier's saved balance in the database comes down too (the screen keeps its own copy and updates it).
export async function createSupplierPayment(
  input: { supplierId: string; supplierName: string; amount: number; method: string; branchId?: string | null; reference?: string; note?: string },
  by: string
): Promise<SupplierPayment> {
  const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new CashBookError('Enter the amount paid.');
  if (amount > 1_000_000_000) throw new CashBookError('That amount looks too large. Check it and try again.');
  const supplierId = String(input.supplierId || '').trim();
  const supplierName = String(input.supplierName || '').trim().slice(0, 120);
  if (!supplierId || !supplierName) throw new CashBookError('Choose the supplier.');
  const method = PAY_METHODS.includes(input.method) ? input.method : 'Cash';
  const isCash = method === 'Cash';
  let branchId: string | null = input.branchId && input.branchId !== 'all' ? String(input.branchId) : null;
  if (isCash) {
    if (!branchId) throw new CashBookError('Choose the branch the cash was paid from.');
    const found = (await db.execute(sql`select id from branches where id = ${branchId}`)).rows;
    if (!found.length) throw new CashBookError('That branch was not found.', 404);
    await assertOpen(branchId, businessDate());
  } else if (branchId) {
    const found = (await db.execute(sql`select id from branches where id = ${branchId}`)).rows;
    if (!found.length) branchId = null;
  }
  const today = businessDate();
  const id = newId('sp');
  const reference = (input.reference || '').trim().slice(0, 80) || null;
  const note = (input.note || '').trim().slice(0, 300) || null;
  const createdBy = by.slice(0, 100) || null;
  await db.transaction(async (tx) => {
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from supplier_payments where paid_on = ${today}`)).rows as any[];
    const paymentNo = `SP-${today.replace(/-/g, '')}-${String(Number(n) + 1).padStart(2, '0')}`;
    await tx.execute(sql`
      insert into supplier_payments (id, payment_no, supplier_id, supplier_name, amount, method, branch_id, paid_on, reference, note, created_by)
      values (${id}, ${paymentNo}, ${supplierId}, ${supplierName}, ${amount}, ${method}, ${branchId}, ${today}, ${reference}, ${note}, ${createdBy})`);
    if (isCash && branchId) {
      await tx.insert(cashEntries).values({
        id: `ce-${id}`,
        branchId,
        entryDate: today,
        type: 'out',
        category: PAYMENT_CATEGORY,
        amount,
        method: 'Cash',
        description: `${paymentNo}: paid to ${supplierName}.${reference ? ` Ref ${reference}.` : ''}`.slice(0, 300),
        createdBy
      });
    }
    await tx.execute(sql`update suppliers set outstanding_payable = greatest(0, outstanding_payable - ${amount}) where id = ${supplierId}`);
  });
  return (await listSupplierPayments(undefined, 300)).find((p) => p.id === id)!;
}

// Cancels a payment made by mistake: the cash book entry goes and the saved balance goes back up.
export async function deleteSupplierPayment(id: string): Promise<SupplierPayment> {
  const p = (await listSupplierPayments(undefined, 300)).find((x) => x.id === id);
  if (!p) throw new CashBookError('Payment not found.', 404);
  const entry = (await db.execute(sql`select branch_id, entry_date from cash_entries where id = ${`ce-${id}`}`)).rows[0] as any;
  if (entry) await assertOpen(entry.branch_id, entry.entry_date);
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from cash_entries where id = ${`ce-${id}`}`);
    await tx.execute(sql`delete from supplier_payments where id = ${id}`);
    await tx.execute(sql`update suppliers set outstanding_payable = outstanding_payable + ${p.amount} where id = ${p.supplierId}`);
  });
  return p;
}
