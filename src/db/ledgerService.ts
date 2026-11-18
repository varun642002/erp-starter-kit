import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { db } from './index.ts';
import { CashBookError, addEntry, deleteEntry, getEntry } from './cashBookService.ts';
import { businessDate } from '../routes/context.ts';

export class LedgerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const VOUCHER_TYPES = ['Sale', 'Invoice', 'Receipt', 'Service Receipt', 'Expense', 'Salary', 'Cash In', 'Cash Out'] as const;
export const LEDGER_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;
export const EXPENSE_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'] as const;
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Transport',
  'Fuel',
  'Repairs & maintenance',
  'Office supplies',
  'Telephone & internet',
  'Tea & refreshments',
  'Marketing',
  'Taxes & fees',
  'Insurance',
  'Other'
] as const;
export const LEDGER_ROLES = ['Super Admin', 'Business Owner', 'Accountant', 'Branch Manager', 'Branch Person'];

// Rows written by the expenses endpoint carry this id prefix so only they can be deleted from here.
const EXPENSE_ID_PREFIX = 'lexp-';
const DAYBOOK_LIMIT = 5000;
const LINES_LIMIT = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => round2(Number(v) || 0);

export interface Range {
  from: string;
  to: string;
}

function assertDate(value: string, field: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new LedgerError(`${field} must be in YYYY-MM-DD format.`);
  }
  return value;
}

export function resolveRange(fromRaw: unknown, toRaw: unknown): Range {
  const today = businessDate();
  const from = typeof fromRaw === 'string' && fromRaw ? assertDate(fromRaw, 'from') : `${today.slice(0, 8)}01`;
  const to = typeof toRaw === 'string' && toRaw ? assertDate(toRaw, 'to') : today;
  if (from > to) throw new LedgerError('The start date cannot be after the end date.');
  return { from, to };
}

// ---------- SQL building blocks ----------

const branchCond = (col: string, branch: string): SQL => (branch === 'all' ? sql`true` : sql`${sql.raw(col)} = ${branch}`);

// sales.created_at is a UTC timestamp; the business date is the IST calendar day.
const SALE_DATE = sql`to_char((s.created_at at time zone 'UTC') at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

function normMethod(col: string): SQL {
  const c = sql.raw(col);
  return sql`(case when lower(trim(${c})) = 'cash' then 'Cash' when lower(trim(${c})) = 'upi' then 'UPI' when lower(${c}) like '%card%' then 'Card' else 'Bank Transfer' end)`;
}

const SALE_PAID = sql`(lower(s.payment_status) = 'paid' and not (lower(s.payment_method) like '%credit%' and lower(s.payment_method) not like '%card%'))`;
const INVOICE_LIVE = sql`d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled')`;
// Old bills entered from the bill files count as sales but never as money to collect or money received.
const INVOICE_OPEN = sql`d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and not d.is_historical`;

// Document payments and payroll also write cash_entries rows; those mirrors are excluded so money is counted once.
const CASH_ENTRY_MIRROR = sql`(ce.category = 'Customer collection' and coalesce(ce.description, '') like 'Payment %')`;

// Every money event in one shape. cash = true means money actually moved; false rows are on-account billing.
function vouchers(): SQL {
  return sql`(
    select 'sale-' || s.id as ref, ${SALE_DATE} as vdate, s.branch_id as branch_id, 'Sale'::text as vtype,
      s.sale_number as number, s.customer_name as party,
      (case when ${SALE_PAID} then 'Quick sale' else 'Quick sale on account' end) as description,
      (case when ${SALE_PAID} then ${normMethod('s.payment_method')} else 'Credit' end) as method,
      s.grand_total::float8 as debit, 0::float8 as credit, ${SALE_PAID} as cash, s.created_at as ts
    from sales s
    union all
    select 'inv-' || d.id, d.doc_date, d.branch_id, 'Invoice', d.doc_number, d.customer_name,
      'Tax invoice' || coalesce(', due ' || d.due_date, ''), 'Credit', d.grand_total::float8, 0::float8, false, d.created_at
    from documents d where ${INVOICE_OPEN} and d.source_machine_sale_id is null
    union all
    select 'rcp-' || p.id, p.paid_on, d.branch_id, 'Receipt', d.doc_number, d.customer_name,
      (case when p.method = 'Return credit' then 'Credit for returned goods' else 'Payment against invoice' end) || coalesce(', ref ' || nullif(p.reference, ''), ''),
      (case when p.method = 'Return credit' then 'Credit' else ${normMethod('p.method')} end),
      p.amount::float8, 0::float8, (p.method <> 'Return credit'), p.created_at
    from document_payments p join documents d on d.id = p.document_id where ${INVOICE_OPEN} and d.source_machine_sale_id is null
    union all
    select 'msp-' || p.id, p.paid_on, m.branch_id, 'Sale', m.sale_number, m.customer_name,
      'Machine sale - ' || m.machine_name || coalesce(', ref ' || nullif(p.reference, ''), ''), ${normMethod('p.method')},
      p.amount::float8, 0::float8, true, p.created_at
    from machine_sale_payments p join machine_sales m on m.id = p.sale_id where m.status <> 'Cancelled'
    union all
    select 'mss-' || m.id, coalesce(m.subsidy_received_date, m.booking_date), m.branch_id, 'Sale', m.sale_number, m.customer_name,
      'Machine sale - subsidy received' || coalesce(' (' || nullif(m.subsidy_scheme, '') || ')', ''), 'Bank Transfer',
      m.subsidy_amount::float8, 0::float8, true, m.updated_at
    from machine_sales m
    where m.status <> 'Cancelled' and m.sale_type = 'subsidy' and m.subsidy_status = 'Received' and m.subsidy_amount > 0
    union all
    select 'msd-' || x.id, x.booking_date, x.branch_id, 'Sale', x.sale_number, x.customer_name,
      'Machine sale on account - ' || x.machine_name, 'Credit', x.rem::float8, 0::float8, false, x.created_at
    from (
      select m.*, greatest(
        m.sale_price
        - coalesce((select sum(p.amount) from machine_sale_payments p where p.sale_id = m.id), 0)
        - (case when m.sale_type = 'subsidy' and m.subsidy_status = 'Received' then m.subsidy_amount else 0 end), 0) as rem
      from machine_sales m where m.status <> 'Cancelled' and not m.is_historical
    ) x where x.rem > 0.005
    union all
    select 'svc-' || p.id, p.paid_on, j.branch_id, 'Service Receipt', j.job_number, j.customer_name,
      'Job card payment' || coalesce(' - ' || nullif(j.machine_model, ''), ''), ${normMethod('p.method')},
      p.amount::float8, 0::float8, true, p.created_at
    from job_card_payments p join job_cards j on j.id = p.job_card_id
    union all
    select 'ce-' || ce.id, ce.entry_date, ce.branch_id,
      (case when ce.category = 'Expense' and ce.type = 'out' then 'Expense'
            when ce.category = 'Salary' and ce.type = 'out' then 'Salary'
            when ce.category = 'Customer collection' and ce.type = 'in' then 'Receipt'
            when ce.type = 'in' then 'Cash In' else 'Cash Out' end),
      '', '',
      (case when ce.category = 'Expense' then coalesce(ce.description, '') else ce.category || coalesce(' - ' || nullif(ce.description, ''), '') end),
      ${normMethod('ce.method')},
      (case when ce.type = 'in' then ce.amount else 0 end)::float8, (case when ce.type = 'in' then 0 else ce.amount end)::float8,
      true, ce.created_at
    from cash_entries ce where not ${CASH_ENTRY_MIRROR}
  )`;
}

type VoucherRow = {
  ref: string;
  vdate: string;
  branch_id: string | null;
  vtype: string;
  number: string;
  party: string;
  description: string;
  method: string;
  debit: number;
  credit: number;
  cash: boolean;
};

// ---------- expense text format ----------

const EXPENSE_RE = /^(.+?) - ([^:]*?)(?:: ([\s\S]*))?$/;

export function parseExpense(description: string | null | undefined) {
  const text = description || '';
  const m = EXPENSE_RE.exec(text);
  const known = m ? (EXPENSE_CATEGORIES as readonly string[]).includes(m[1]) : false;
  if (m && known) {
    const vendor = m[2].trim();
    return { category: m[1], vendor: vendor === '-' ? '' : vendor, note: (m[3] || '').trim() };
  }
  return { category: 'Other', vendor: '', note: text.trim() };
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// ---------- day book ----------

export interface DaybookQuery extends Range {
  branch: string;
  q?: string;
  types?: string[];
}

export async function getDaybook(p: DaybookQuery) {
  const types = (p.types || []).filter((t) => (VOUCHER_TYPES as readonly string[]).includes(t));
  const typeCond = types.length ? sql`and v.vtype in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const q = p.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const qCond = like ? sql`and (v.number ilike ${like} or v.party ilike ${like} or v.description ilike ${like} or v.method ilike ${like})` : sql``;
  const where = sql`${branchCond('v.branch_id', p.branch)} and v.vdate >= ${p.from} and v.vdate <= ${p.to} ${typeCond} ${qCond}`;

  const [rowsRes, totalsRes] = await Promise.all([
    // Newest first. The balance is the running cash and bank balance from the start of the period, worked out over the
    // whole period before the newest rows are picked, so it stays right even when older rows are cut off.
    db.execute<VoucherRow & { bal: number }>(sql`select v.ref, v.vdate, v.branch_id, v.vtype, v.number, v.party, v.description, v.method, v.debit, v.credit, v.cash,
        (sum(case when v.cash then v.debit - v.credit else 0 end) over (order by v.vdate asc, v.ts asc, v.ref asc))::float8 as bal
      from ${vouchers()} v where ${where} order by v.vdate desc, v.ts desc, v.ref desc limit ${DAYBOOK_LIMIT + 1}`),
    db.execute<{ count: number; debit: number; credit: number; money_in: number; money_out: number }>(
      sql`select count(*)::int as count, coalesce(sum(v.debit), 0)::float8 as debit, coalesce(sum(v.credit), 0)::float8 as credit,
        coalesce(sum(case when v.cash then v.debit else 0 end), 0)::float8 as money_in,
        coalesce(sum(case when v.cash then v.credit else 0 end), 0)::float8 as money_out
      from ${vouchers()} v where ${where}`
    )
  ]);

  const truncated = rowsRes.rows.length > DAYBOOK_LIMIT;
  const rows = rowsRes.rows.slice(0, DAYBOOK_LIMIT).map((r) => {
    let party = r.party;
    let description = r.description;
    if (r.vtype === 'Expense') {
      const e = parseExpense(r.description);
      party = e.vendor;
      description = e.note ? `${e.category}: ${e.note}` : e.category;
    }
    const balance = round2(Number(r.bal) || 0);
    return {
      ref: r.ref,
      date: r.vdate,
      branchId: r.branch_id,
      type: r.vtype,
      number: r.number,
      party,
      description,
      method: r.method,
      debit: num(r.debit),
      credit: num(r.credit),
      balance,
      onAccount: !r.cash
    };
  });

  const t = totalsRes.rows[0];
  return {
    from: p.from,
    to: p.to,
    branch: p.branch,
    rows,
    truncated,
    totals: {
      count: Number(t?.count ?? 0),
      debit: num(t?.debit),
      credit: num(t?.credit),
      moneyIn: num(t?.money_in),
      moneyOut: num(t?.money_out),
      net: round2(num(t?.money_in) - num(t?.money_out))
    }
  };
}

// ---------- cash & bank ----------

export async function getCashBank(p: Range & { branch: string }) {
  const cond = sql`v.cash and ${branchCond('v.branch_id', p.branch)}`;
  const [totalsRes, linesRes] = await Promise.all([
    db.execute<{ method: string; opening: number; receipts: number; payments: number; count: number }>(
      sql`select v.method,
        coalesce(sum(case when v.vdate < ${p.from} then v.debit - v.credit else 0 end), 0)::float8 as opening,
        coalesce(sum(case when v.vdate >= ${p.from} then v.debit else 0 end), 0)::float8 as receipts,
        coalesce(sum(case when v.vdate >= ${p.from} then v.credit else 0 end), 0)::float8 as payments,
        count(*) filter (where v.vdate >= ${p.from})::int as count
      from ${vouchers()} v where ${cond} and v.vdate <= ${p.to} group by v.method`
    ),
    db.execute<VoucherRow & { ts: string }>(
      sql`select v.ref, v.vdate, v.branch_id, v.vtype, v.number, v.party, v.description, v.method, v.debit, v.credit, v.cash
      from ${vouchers()} v where ${cond} and v.vdate >= ${p.from} and v.vdate <= ${p.to}
      order by v.vdate asc, v.ts asc, v.ref asc limit ${LINES_LIMIT * LEDGER_METHODS.length}`
    )
  ]);

  const byMethod = new Map(totalsRes.rows.map((r) => [r.method, r]));
  const methods = LEDGER_METHODS.map((method) => {
    const t = byMethod.get(method);
    const opening = num(t?.opening);
    const receipts = num(t?.receipts);
    const payments = num(t?.payments);
    let balance = opening;
    const all = linesRes.rows
      .filter((r) => r.method === method)
      .map((r) => {
        balance = round2(balance + Number(r.debit) - Number(r.credit));
        let party = r.party;
        let description = r.description;
        if (r.vtype === 'Expense') {
          const e = parseExpense(r.description);
          party = e.vendor;
          description = e.note ? `${e.category}: ${e.note}` : e.category;
        }
        return {
          ref: r.ref,
          date: r.vdate,
          branchId: r.branch_id,
          type: r.vtype,
          number: r.number,
          party,
          description,
          receipt: num(r.debit),
          payment: num(r.credit),
          balance
        };
      });
    const truncated = all.length > LINES_LIMIT;
    return {
      method,
      opening,
      receipts,
      payments,
      closing: round2(opening + receipts - payments),
      count: Number(t?.count ?? 0),
      lines: all.slice(0, LINES_LIMIT),
      truncated
    };
  });

  const sum = (pick: (m: (typeof methods)[number]) => number) => round2(methods.reduce((a, m) => a + pick(m), 0));
  return {
    from: p.from,
    to: p.to,
    branch: p.branch,
    methods,
    totals: { opening: sum((m) => m.opening), receipts: sum((m) => m.receipts), payments: sum((m) => m.payments), closing: sum((m) => m.closing) }
  };
}

// ---------- customers ----------

type InvoiceRow = {
  id: string;
  doc_number: string;
  doc_date: string;
  due_date: string | null;
  grand_total: number;
  branch_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  master_name: string | null;
  master_phone: string | null;
  paid: number;
  last_paid: string | null;
};

function customerKey(r: Pick<InvoiceRow, 'customer_id' | 'customer_name'>): string {
  return r.customer_id ? r.customer_id : `name:${r.customer_name.trim().toLowerCase()}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export type AgeBucket = 'b0_30' | 'b31_60' | 'b61_90' | 'b90_plus';

// Days past due; invoices not yet due fall in the first bucket.
function bucketFor(dueOrDate: string, today: string): AgeBucket {
  const days = daysBetween(dueOrDate, today);
  if (days <= 30) return 'b0_30';
  if (days <= 60) return 'b31_60';
  if (days <= 90) return 'b61_90';
  return 'b90_plus';
}

function invoiceRows(cond: SQL) {
  return db.execute<InvoiceRow>(sql`
    select d.id, d.doc_number, d.doc_date, d.due_date, d.grand_total::float8 as grand_total, d.branch_id, d.customer_id,
      d.customer_name, d.customer_phone, c.company_name as master_name, c.phone as master_phone,
      coalesce(p.paid, 0)::float8 as paid, p.last_paid
    from documents d
    left join customers c on c.id = d.customer_id
    left join (select document_id, sum(amount) as paid, max(paid_on) as last_paid from document_payments group by document_id) p on p.document_id = d.id
    where ${INVOICE_OPEN} and ${cond}
    order by d.doc_date asc, d.doc_number asc`);
}

export async function getCustomerBalances(p: { branch: string; q?: string }) {
  const today = businessDate();
  const { rows } = await invoiceRows(branchCond('d.branch_id', p.branch));

  type Acc = {
    key: string;
    customerId: string | null;
    name: string;
    phone: string | null;
    branchIds: Set<string>;
    invoiceCount: number;
    invoiced: number;
    paid: number;
    lastInvoiceDate: string | null;
    lastPaymentDate: string | null;
    ageing: Record<AgeBucket, number>;
    overdue: number;
    openInvoices: { number: string; dueDate: string | null; balance: number }[];
  };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const key = customerKey(r);
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        customerId: r.customer_id,
        name: r.master_name || r.customer_name,
        phone: null,
        branchIds: new Set(),
        invoiceCount: 0,
        invoiced: 0,
        paid: 0,
        lastInvoiceDate: null,
        lastPaymentDate: null,
        ageing: { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
        overdue: 0,
        openInvoices: []
      };
      map.set(key, a);
    }
    a.phone = a.phone || r.master_phone || r.customer_phone || null;
    a.branchIds.add(r.branch_id);
    a.invoiceCount += 1;
    a.invoiced += r.grand_total;
    a.paid += r.paid;
    if (!a.lastInvoiceDate || r.doc_date > a.lastInvoiceDate) a.lastInvoiceDate = r.doc_date;
    if (r.last_paid && (!a.lastPaymentDate || r.last_paid > a.lastPaymentDate)) a.lastPaymentDate = r.last_paid;
    const balance = Math.max(0, round2(r.grand_total - r.paid));
    if (balance > 0.005) {
      const due = r.due_date || r.doc_date;
      a.ageing[bucketFor(due, today)] += balance;
      if (due < today) a.overdue += balance;
      a.openInvoices.push({ number: r.doc_number, dueDate: r.due_date, balance });
    }
  }

  const q = p.q?.trim().toLowerCase();
  const list = [...map.values()]
    .map((a) => {
      const outstanding = a.openInvoices.reduce((s, i) => s + i.balance, 0);
      return {
        key: a.key,
        customerId: a.customerId,
        name: a.name,
        phone: a.phone,
        branchIds: [...a.branchIds],
        invoiceCount: a.invoiceCount,
        invoiced: round2(a.invoiced),
        paid: round2(a.paid),
        outstanding: round2(outstanding),
        overdue: round2(a.overdue),
        lastInvoiceDate: a.lastInvoiceDate,
        lastPaymentDate: a.lastPaymentDate,
        ageing: {
          b0_30: round2(a.ageing.b0_30),
          b31_60: round2(a.ageing.b31_60),
          b61_90: round2(a.ageing.b61_90),
          b90_plus: round2(a.ageing.b90_plus)
        },
        openInvoices: a.openInvoices.map((i) => ({ ...i, balance: round2(i.balance) }))
      };
    })
    .filter((c) => c.outstanding > 0.005)
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        c.openInvoices.some((i) => i.number.toLowerCase().includes(q))
    )
    .sort((a, b) => b.outstanding - a.outstanding);

  const total = (pick: (c: (typeof list)[number]) => number) => round2(list.reduce((s, c) => s + pick(c), 0));
  return {
    asOf: today,
    branch: p.branch,
    customers: list,
    totals: {
      count: list.length,
      outstanding: total((c) => c.outstanding),
      overdue: total((c) => c.overdue),
      b0_30: total((c) => c.ageing.b0_30),
      b31_60: total((c) => c.ageing.b31_60),
      b61_90: total((c) => c.ageing.b61_90),
      b90_plus: total((c) => c.ageing.b90_plus)
    }
  };
}

export async function getCustomerStatement(p: Range & { branch: string; customerKey: string }) {
  const today = businessDate();
  const keyCond = p.customerKey.startsWith('name:')
    ? sql`d.customer_id is null and lower(trim(d.customer_name)) = ${p.customerKey.slice(5)}`
    : sql`d.customer_id = ${p.customerKey}`;
  const cond = sql`${keyCond} and ${branchCond('d.branch_id', p.branch)}`;

  const [{ rows: invoices }, paymentsRes] = await Promise.all([
    invoiceRows(cond),
    db.execute<{ id: number; doc_number: string; paid_on: string; amount: number; method: string; reference: string | null; created_at: string }>(
      sql`select p.id, d.doc_number, p.paid_on, p.amount::float8 as amount, p.method, p.reference, p.created_at
      from document_payments p join documents d on d.id = p.document_id
      where ${INVOICE_OPEN} and ${cond} order by p.paid_on asc, p.id asc`
    )
  ]);
  if (invoices.length === 0) throw new LedgerError('Customer not found.', 404);

  const first = invoices[0];
  const name = invoices.find((i) => i.master_name)?.master_name || first.customer_name;
  const phone = invoices.map((i) => i.master_phone || i.customer_phone).find(Boolean) || null;

  let opening = 0;
  type Line = { date: string; order: number; seq: number; type: 'Invoice' | 'Receipt'; number: string; description: string; debit: number; credit: number };
  const lines: Line[] = [];
  invoices.forEach((i, idx) => {
    if (i.doc_date < p.from) opening += i.grand_total;
    else if (i.doc_date <= p.to) {
      lines.push({
        date: i.doc_date,
        order: 0,
        seq: idx,
        type: 'Invoice',
        number: i.doc_number,
        description: i.due_date ? `Tax invoice, due ${i.due_date}` : 'Tax invoice',
        debit: round2(i.grand_total),
        credit: 0
      });
    }
  });
  paymentsRes.rows.forEach((pay) => {
    if (pay.paid_on < p.from) opening -= pay.amount;
    else if (pay.paid_on <= p.to) {
      lines.push({
        date: pay.paid_on,
        order: 1,
        seq: pay.id,
        type: 'Receipt',
        number: pay.doc_number,
        description: `Payment by ${pay.method}${pay.reference ? `, ref ${pay.reference}` : ''}`,
        debit: 0,
        credit: round2(pay.amount)
      });
    }
  });
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.seq - b.seq);

  let balance = round2(opening);
  const out = lines.map((l) => {
    balance = round2(balance + l.debit - l.credit);
    return { date: l.date, type: l.type, number: l.number, description: l.description, debit: l.debit, credit: l.credit, balance };
  });

  const open = invoices
    .map((i) => ({ number: i.doc_number, dueDate: i.due_date, balance: Math.max(0, round2(i.grand_total - i.paid)), due: i.due_date || i.doc_date }))
    .filter((i) => i.balance > 0.005);
  const ageing: Record<AgeBucket, number> = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 };
  for (const i of open) ageing[bucketFor(i.due, today)] += i.balance;

  return {
    from: p.from,
    to: p.to,
    asOf: today,
    customer: {
      key: p.customerKey,
      customerId: first.customer_id,
      name,
      phone,
      branchIds: [...new Set(invoices.map((i) => i.branch_id))]
    },
    openingBalance: round2(opening),
    totalDebit: round2(out.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(out.reduce((s, l) => s + l.credit, 0)),
    closingOutstanding: balance,
    outstandingToday: round2(open.reduce((s, i) => s + i.balance, 0)),
    ageing: { b0_30: round2(ageing.b0_30), b31_60: round2(ageing.b31_60), b61_90: round2(ageing.b61_90), b90_plus: round2(ageing.b90_plus) },
    openInvoices: open.map((i) => ({ number: i.number, dueDate: i.dueDate, balance: round2(i.balance) })),
    lines: out
  };
}

// ---------- expenses ----------

type ExpenseSqlRow = {
  id: string;
  branch_id: string;
  entry_date: string;
  amount: number;
  method: string;
  description: string | null;
  created_by: string | null;
};

export async function listExpenses(p: Range & { branch: string; category?: string }) {
  const { rows } = await db.execute<ExpenseSqlRow>(
    sql`select ce.id, ce.branch_id, ce.entry_date, ce.amount::float8 as amount, ce.method, ce.description, ce.created_by
    from cash_entries ce
    where ce.category = 'Expense' and ce.type = 'out' and ce.entry_date >= ${p.from} and ce.entry_date <= ${p.to}
      and ${branchCond('ce.branch_id', p.branch)}
    order by ce.entry_date desc, ce.created_at desc limit 2000`
  );
  const want = p.category && p.category !== 'all' ? p.category : null;
  const list = rows
    .map((r) => {
      const e = parseExpense(r.description);
      return {
        id: r.id,
        branchId: r.branch_id,
        date: r.entry_date,
        category: e.category,
        vendor: e.vendor,
        description: e.note,
        method: r.method,
        amount: num(r.amount),
        createdBy: r.created_by,
        deletable: r.id.startsWith(EXPENSE_ID_PREFIX)
      };
    })
    .filter((r) => !want || r.category === want);

  const byCat = new Map<string, number>();
  for (const r of list) byCat.set(r.category, (byCat.get(r.category) || 0) + r.amount);
  return {
    from: p.from,
    to: p.to,
    branch: p.branch,
    rows: list,
    total: round2(list.reduce((s, r) => s + r.amount, 0)),
    byCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    categories: EXPENSE_CATEGORIES
  };
}

export interface NewExpenseInput {
  branchId: string;
  date?: unknown;
  category?: unknown;
  vendor?: unknown;
  amount?: unknown;
  method?: unknown;
  description?: unknown;
  createdBy?: string;
}

export async function addExpense(input: NewExpenseInput) {
  const today = businessDate();
  const date = typeof input.date === 'string' && input.date ? assertDate(input.date, 'date') : today;
  if (date > today) throw new LedgerError('Expenses cannot be dated in the future.');

  const category = clean(input.category, 60);
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    throw new LedgerError(`Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}.`);
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new LedgerError('Amount must be greater than zero.');
  const method = typeof input.method === 'string' && input.method ? input.method : 'Cash';
  if (!(EXPENSE_METHODS as readonly string[]).includes(method)) throw new LedgerError(`Method must be one of: ${EXPENSE_METHODS.join(', ')}.`);

  // ':' is the vendor/description separator in the stored text, so it cannot appear inside the vendor.
  const vendor = clean(input.vendor, 80).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  const note = clean(input.description, 200);

  const branchCheck = await db.execute<{ id: string }>(sql`select id from branches where id = ${input.branchId}`);
  if (branchCheck.rows.length === 0) throw new LedgerError('Unknown branch.');

  const text = `${category} - ${vendor || '-'}${note ? `: ${note}` : ''}`;
  const entry = await addEntry(
    {
      branchId: input.branchId,
      date,
      type: 'out',
      category: 'Expense',
      amount,
      method,
      description: text,
      createdBy: input.createdBy
    },
    `${EXPENSE_ID_PREFIX}${randomUUID()}`
  );
  const e = parseExpense(entry.description);
  return {
    id: entry.id,
    branchId: entry.branchId,
    date: entry.entryDate,
    category: e.category,
    vendor: e.vendor,
    description: e.note,
    method: entry.method,
    amount: num(entry.amount),
    createdBy: entry.createdBy,
    deletable: true
  };
}

export async function removeExpense(id: string, who: { isOwner: boolean; branchId: string }) {
  const entry = await getEntry(id);
  if (!entry || !entry.id.startsWith(EXPENSE_ID_PREFIX) || entry.category !== 'Expense') {
    throw new LedgerError('Expense not found, or it was not recorded from the ledger.', 404);
  }
  if (!who.isOwner) {
    if (entry.branchId !== who.branchId) throw new LedgerError('You can only delete expenses of your own branch.', 403);
    if (entry.entryDate !== businessDate()) throw new LedgerError('Only an owner can delete an expense dated before today.', 403);
  }
  await deleteEntry(id);
}

// Owner clean-up: removes every ledger expense (category 'Expense', money out) for a branch or all branches.
// Cash handovers, salaries, salary advances and supplier payments have their own categories and are never touched.
export async function clearExpenses(p: { branch: string; dryRun: boolean }) {
  const cond = sql`category = 'Expense' and type = 'out' and ${branchCond('branch_id', p.branch)}`;
  const { rows } = await db.execute<{ n: number; total: number; first: string | null; last: string | null }>(
    sql`select count(*)::int as n, coalesce(sum(amount), 0)::float8 as total, min(entry_date)::text as first, max(entry_date)::text as last
        from cash_entries where ${cond}`
  );
  const found = { count: Number(rows[0]?.n) || 0, total: round2(num(rows[0]?.total)), first: rows[0]?.first || null, last: rows[0]?.last || null };
  if (p.dryRun || found.count === 0) return { ...found, deleted: 0 };
  const del = await db.execute<{ id: string }>(sql`delete from cash_entries where ${cond} returning id`);
  return { ...found, deleted: del.rows.length };
}

// ---------- profit & loss ----------

type BranchVal = { b: string; v: number };

async function sumByBranch(query: SQL): Promise<Map<string, number>> {
  const { rows } = await db.execute<BranchVal>(query);
  return new Map(rows.map((r) => [r.b, Number(r.v) || 0]));
}

export async function getProfitLoss(p: Range & { branch: string }) {
  const { from, to, branch } = p;
  const saleRange = sql`${SALE_DATE} >= ${from} and ${SALE_DATE} <= ${to}`;
  const docRange = sql`d.doc_date >= ${from} and d.doc_date <= ${to}`;
  const jobRange = sql`j.received_on >= ${from} and j.received_on <= ${to} and j.status <> 'Cancelled'`;

  const [quick, taxable, service, cogsSale, cogsDoc, cogsJob, expenseRes, branchRes] = await Promise.all([
    sumByBranch(sql`select coalesce(s.branch_id, 'unassigned') as b, sum(greatest(s.grand_total - s.gst, 0))::float8 as v
      from sales s where ${saleRange} and ${branchCond('s.branch_id', branch)} group by 1`),
    sumByBranch(sql`select d.branch_id as b, sum(d.taxable_amount)::float8 as v
      from documents d where ${INVOICE_LIVE} and ${docRange} and ${branchCond('d.branch_id', branch)} group by 1`),
    sumByBranch(sql`select j.branch_id as b, sum(j.total)::float8 as v
      from job_cards j where ${jobRange} and ${branchCond('j.branch_id', branch)} group by 1`),
    sumByBranch(sql`select coalesce(s.branch_id, 'unassigned') as b, sum(si.quantity * coalesce(pr.purchase_price, 0))::float8 as v
      from sale_items si join sales s on s.id = si.sale_id left join products pr on pr.id = si.product_id
      where ${saleRange} and ${branchCond('s.branch_id', branch)} group by 1`),
    sumByBranch(sql`select d.branch_id as b, sum(di.quantity * coalesce(pr.purchase_price, 0))::float8 as v
      from document_items di join documents d on d.id = di.document_id left join products pr on pr.id = di.product_id
      where ${INVOICE_LIVE} and ${docRange} and ${branchCond('d.branch_id', branch)} group by 1`),
    sumByBranch(sql`select j.branch_id as b, sum(jp.quantity * coalesce(pr.purchase_price, 0))::float8 as v
      from job_card_parts jp join job_cards j on j.id = jp.job_card_id left join products pr on pr.id = jp.product_id
      where ${jobRange} and ${branchCond('j.branch_id', branch)} group by 1`),
    db.execute<{ branch_id: string; category: string; description: string | null; amount: number }>(
      sql`select ce.branch_id, ce.category, ce.description, ce.amount::float8 as amount
      from cash_entries ce
      where ce.type = 'out' and ce.category not in ('Bank deposit', 'Bank withdrawal', 'Owner/Partner', 'Salary advance')
        and ce.entry_date >= ${from} and ce.entry_date <= ${to} and ${branchCond('ce.branch_id', branch)}`
    ),
    db.execute<{ id: string; name: string }>(sql`select id, name from branches order by id`)
  ]);

  type BranchPnl = { quickSales: number; gstInvoices: number; service: number; cogs: number; expenses: number };
  const perBranch = new Map<string, BranchPnl>();
  const slot = (id: string) => {
    let s = perBranch.get(id);
    if (!s) {
      s = { quickSales: 0, gstInvoices: 0, service: 0, cogs: 0, expenses: 0 };
      perBranch.set(id, s);
    }
    return s;
  };
  for (const [b, v] of quick) slot(b).quickSales += v;
  for (const [b, v] of taxable) slot(b).gstInvoices += v;
  for (const [b, v] of service) slot(b).service += v;
  for (const m of [cogsSale, cogsDoc, cogsJob]) for (const [b, v] of m) slot(b).cogs += v;

  const expenseLines = new Map<string, { label: string; group: 'Expense' | 'Salary' | 'Other'; amount: number }>();
  for (const r of expenseRes.rows) {
    const amount = Number(r.amount) || 0;
    let label: string;
    let group: 'Expense' | 'Salary' | 'Other';
    if (r.category === 'Expense') {
      label = parseExpense(r.description).category;
      group = 'Expense';
    } else if (r.category === 'Salary') {
      label = 'Salaries';
      group = 'Salary';
    } else {
      label = 'Other operating outflows';
      group = 'Other';
    }
    const line = expenseLines.get(label) || { label, group, amount: 0 };
    line.amount += amount;
    expenseLines.set(label, line);
    slot(r.branch_id).expenses += amount;
  }

  const names = new Map(branchRes.rows.map((b) => [b.id, b.name]));
  const scopeIds = branch === 'all' ? branchRes.rows.map((b) => b.id) : [branch];
  for (const id of scopeIds) slot(id);
  const ids = [...perBranch.keys()].filter((id) => scopeIds.includes(id) || (branch === 'all' && id === 'unassigned'));
  ids.sort((a, b) => a.localeCompare(b));

  const rows = ids.map((id) => {
    const s = perBranch.get(id)!;
    const income = s.quickSales + s.gstInvoices + s.service;
    const gross = income - s.cogs;
    return {
      branchId: id,
      branchName: id === 'unassigned' ? 'Unassigned' : names.get(id) || id,
      quickSales: round2(s.quickSales),
      gstInvoices: round2(s.gstInvoices),
      service: round2(s.service),
      income: round2(income),
      cogs: round2(s.cogs),
      grossProfit: round2(gross),
      expenses: round2(s.expenses),
      netProfit: round2(gross - s.expenses)
    };
  }).filter((r) => r.branchId !== 'unassigned' || r.income !== 0 || r.cogs !== 0 || r.expenses !== 0);

  const sum = (pick: (r: (typeof rows)[number]) => number) => round2(rows.reduce((a, r) => a + pick(r), 0));
  const income = sum((r) => r.income);
  const cogs = sum((r) => r.cogs);
  const grossProfit = round2(income - cogs);
  const expenseTotal = sum((r) => r.expenses);

  return {
    from,
    to,
    branch,
    income: {
      quickSales: sum((r) => r.quickSales),
      gstInvoices: sum((r) => r.gstInvoices),
      service: sum((r) => r.service),
      total: income
    },
    cogs,
    grossProfit,
    grossMarginPct: income > 0 ? round2((grossProfit / income) * 100) : 0,
    expenses: {
      lines: [...expenseLines.values()].map((l) => ({ ...l, amount: round2(l.amount) })).sort((a, b) => b.amount - a.amount),
      total: expenseTotal
    },
    netProfit: round2(grossProfit - expenseTotal),
    byBranch: rows
  };
}

// ---------- summary ----------

async function periodFigures(range: Range, branch: string) {
  const saleRange = sql`${SALE_DATE} >= ${range.from} and ${SALE_DATE} <= ${range.to}`;
  const [sales, collections, expenses] = await Promise.all([
    db.execute<{ total: number }>(sql`select (
        (select coalesce(sum(s.grand_total), 0) from sales s where ${saleRange} and ${branchCond('s.branch_id', branch)})
      + (select coalesce(sum(d.grand_total), 0) from documents d where ${INVOICE_LIVE} and d.doc_date >= ${range.from} and d.doc_date <= ${range.to} and ${branchCond('d.branch_id', branch)})
      + (select coalesce(sum(j.total), 0) from job_cards j where j.status <> 'Cancelled' and j.received_on >= ${range.from} and j.received_on <= ${range.to} and ${branchCond('j.branch_id', branch)})
    )::float8 as total`),
    db.execute<{ total: number }>(sql`select coalesce(sum(v.debit), 0)::float8 as total
      from ${vouchers()} v where v.cash and v.vtype in ('Receipt', 'Service Receipt')
        and v.vdate >= ${range.from} and v.vdate <= ${range.to} and ${branchCond('v.branch_id', branch)}`),
    db.execute<{ total: number }>(sql`select coalesce(sum(ce.amount), 0)::float8 as total from cash_entries ce
      where ce.type = 'out' and ce.category not in ('Bank deposit', 'Bank withdrawal', 'Owner/Partner', 'Salary advance')
        and ce.entry_date >= ${range.from} and ce.entry_date <= ${range.to} and ${branchCond('ce.branch_id', branch)}`)
  ]);
  return { sales: num(sales.rows[0]?.total), collections: num(collections.rows[0]?.total), expenses: num(expenses.rows[0]?.total) };
}

export async function getSummary(branch: string) {
  const today = businessDate();
  const monthStart = `${today.slice(0, 8)}01`;
  const [day, month, recv] = await Promise.all([
    periodFigures({ from: today, to: today }, branch),
    periodFigures({ from: monthStart, to: today }, branch),
    db.execute<{ outstanding: number; overdue: number; open_invoices: number }>(
      sql`select coalesce(sum(greatest(d.grand_total - coalesce(p.paid, 0), 0)), 0)::float8 as outstanding,
        coalesce(sum(case when d.due_date is not null and d.due_date < ${today} then greatest(d.grand_total - coalesce(p.paid, 0), 0) else 0 end), 0)::float8 as overdue,
        (count(*) filter (where d.grand_total - coalesce(p.paid, 0) > 0.005))::int as open_invoices
      from documents d
      left join (select document_id, sum(amount) as paid from document_payments group by document_id) p on p.document_id = d.id
      where ${INVOICE_OPEN} and ${branchCond('d.branch_id', branch)}`
    )
  ]);
  const r = recv.rows[0];
  return {
    branch,
    today,
    monthStart,
    day,
    month,
    receivables: { outstanding: num(r?.outstanding), overdue: num(r?.overdue), openInvoices: Number(r?.open_invoices ?? 0) }
  };
}

export { CashBookError };
