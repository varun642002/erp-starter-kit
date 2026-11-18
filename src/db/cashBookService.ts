import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { branches, sales } from './schema.ts';
import { jobCardPayments, jobCards } from './schema.jobCards.ts';
import { cashClosings, cashEntries } from './schema.cashBook.ts';
import { bucketOf, expectedCash as expectedCashOf, round2 } from './cashMath.ts';

export class CashBookError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CashEntryRow = typeof cashEntries.$inferSelect;
export type CashClosingRow = typeof cashClosings.$inferSelect;

export interface DaySummary {
  branchId: string;
  date: string;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  bankCardSales: number;
  creditSales: number;
  salesCount: number;
  serviceCollections: number;
  serviceCash: number;
  serviceUpi: number;
  serviceBank: number;
  manualCashIn: number;
  manualCashOut: number;
  manualOtherIn: number;
  manualOtherOut: number;
  expectedCash: number;
  entries: CashEntryRow[];
  isClosed: boolean;
  closing: CashClosingRow | null;
}

export interface BranchSummaryRow extends Omit<DaySummary, 'entries'> {
  branchName: string;
  countedCash: number | null;
  variance: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new CashBookError('Date must be in YYYY-MM-DD format.');
  }
}

async function computeDay(branchId: string, date: string): Promise<DaySummary> {
  // created_at is a timestamp without zone holding UTC; convert to IST before taking the date.
  const salesOnDate = sql`((${sales.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date`;

  const [saleRows, serviceRows, entries, closingRows, openingRows] = await Promise.all([
    // A sale paid two ways counts its first payment under the first method and the rest under the second; the sale
    // itself is counted once.
    db
      .execute<{ method: string; status: string; total: number; count: number }>(
        sql`select method, status, coalesce(sum(amount), 0)::float8 as total, coalesce(sum(cnt), 0)::int as count from (
              select s.payment_method as method, s.payment_status as status, (s.grand_total - coalesce(s.payment_amount_2, 0)) as amount, 1 as cnt
                from sales s where s.branch_id = ${branchId} and ((s.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
              union all
              select s.payment_method_2, s.payment_status, s.payment_amount_2, 0
                from sales s where s.branch_id = ${branchId} and s.payment_method_2 is not null and s.payment_amount_2 > 0
                  and ((s.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
            ) x group by method, status`
      )
      .then((r) => r.rows),
    db
      .select({
        method: jobCardPayments.method,
        total: sql<number>`coalesce(sum(${jobCardPayments.amount}), 0)`
      })
      .from(jobCardPayments)
      .innerJoin(jobCards, eq(jobCardPayments.jobCardId, jobCards.id))
      .where(and(eq(jobCards.branchId, branchId), eq(jobCardPayments.paidOn, date)))
      .groupBy(jobCardPayments.method),
    db
      .select()
      .from(cashEntries)
      .where(and(eq(cashEntries.branchId, branchId), eq(cashEntries.entryDate, date)))
      .orderBy(desc(cashEntries.createdAt)),
    db
      .select()
      .from(cashClosings)
      .where(and(eq(cashClosings.branchId, branchId), eq(cashClosings.businessDate, date)))
      .limit(1),
    db
      .select({ countedCash: cashClosings.countedCash })
      .from(cashClosings)
      .where(and(eq(cashClosings.branchId, branchId), lt(cashClosings.businessDate, date)))
      .orderBy(desc(cashClosings.businessDate))
      .limit(1)
  ]);

  // Machine sales are sales too: money received that day goes to cash / UPI / bank sales by method, and what was
  // left unpaid on the day it was booked is credit sales.
  const msPayRows = await db.execute<{ method: string; total: number }>(
    sql`select p.method as method, coalesce(sum(p.amount), 0)::float8 as total
      from machine_sale_payments p join machine_sales m on m.id = p.sale_id
      where m.branch_id = ${branchId} and p.paid_on = ${date} and m.status <> 'Cancelled' group by p.method`
  );
  // Money taken on tax invoices from the Invoices module that day. Invoices raised for a machine sale are left out
  // (their payments are the machine sale payments above) and so are old bills entered from the bill files.
  const docPayRows = await db.execute<{ method: string; total: number }>(
    sql`select p.method as method, coalesce(sum(p.amount), 0)::float8 as total
      from document_payments p join documents d on d.id = p.document_id
      where d.branch_id = ${branchId} and p.paid_on = ${date} and d.doc_type = 'invoice'
        and d.source_machine_sale_id is null and not d.is_historical group by p.method`
  );
  const msSubsidy = await db.execute<{ total: number }>(
    sql`select coalesce(sum(m.subsidy_amount), 0)::float8 as total from machine_sales m
      where m.branch_id = ${branchId} and m.status <> 'Cancelled' and m.sale_type = 'subsidy' and m.subsidy_status = 'Received'
        and coalesce(m.subsidy_received_date, m.booking_date) = ${date}`
  );
  const msBooked = await db.execute<{ count: number; rem: number }>(
    sql`select count(*)::int as count, coalesce(sum(x.rem), 0)::float8 as rem from (
        select greatest(m.sale_price
          - coalesce((select sum(p.amount) from machine_sale_payments p where p.sale_id = m.id), 0)
          - (case when m.sale_type = 'subsidy' and m.subsidy_status = 'Received' then m.subsidy_amount else 0 end), 0) as rem
        from machine_sales m where m.branch_id = ${branchId} and m.booking_date = ${date} and m.status <> 'Cancelled' and not m.is_historical) x`
  );

  let cashSales = 0;
  let upiSales = 0;
  let bankCardSales = 0;
  let creditSales = 0;
  let salesCount = 0;
  for (const r of [...msPayRows.rows, ...docPayRows.rows]) {
    const total = Number(r.total) || 0;
    const bucket = bucketOf(r.method, false);
    if (bucket === 'cash') cashSales += total;
    else if (bucket === 'upi') upiSales += total;
    else bankCardSales += total;
  }
  bankCardSales += Number(msSubsidy.rows[0]?.total) || 0;
  creditSales += Number(msBooked.rows[0]?.rem) || 0;
  salesCount += Number(msBooked.rows[0]?.count) || 0;
  for (const r of saleRows) {
    const total = Number(r.total) || 0;
    salesCount += Number(r.count) || 0;
    const paid = (r.status || '').toLowerCase() === 'paid';
    const bucket = paid ? bucketOf(r.method, true) : 'credit';
    if (bucket === 'cash') cashSales += total;
    else if (bucket === 'upi') upiSales += total;
    else if (bucket === 'bank') bankCardSales += total;
    else creditSales += total;
  }

  let serviceCash = 0;
  let serviceUpi = 0;
  let serviceBank = 0;
  for (const r of serviceRows) {
    const total = Number(r.total) || 0;
    const bucket = bucketOf(r.method, false);
    if (bucket === 'cash') serviceCash += total;
    else if (bucket === 'upi') serviceUpi += total;
    else serviceBank += total;
  }

  let manualCashIn = 0;
  let manualCashOut = 0;
  let manualOtherIn = 0;
  let manualOtherOut = 0;
  for (const e of entries) {
    const isCash = bucketOf(e.method, false) === 'cash';
    if (e.type === 'in') {
      if (isCash) manualCashIn += e.amount;
      else manualOtherIn += e.amount;
    } else if (isCash) manualCashOut += e.amount;
    else manualOtherOut += e.amount;
  }

  const openingCash = openingRows[0]?.countedCash ?? 0;
  const closing = closingRows[0] ?? null;

  const live: DaySummary = {
    branchId,
    date,
    openingCash: round2(openingCash),
    cashSales: round2(cashSales),
    upiSales: round2(upiSales),
    bankCardSales: round2(bankCardSales),
    creditSales: round2(creditSales),
    salesCount,
    serviceCollections: round2(serviceCash + serviceUpi + serviceBank),
    serviceCash: round2(serviceCash),
    serviceUpi: round2(serviceUpi),
    serviceBank: round2(serviceBank),
    manualCashIn: round2(manualCashIn),
    manualCashOut: round2(manualCashOut),
    manualOtherIn: round2(manualOtherIn),
    manualOtherOut: round2(manualOtherOut),
    expectedCash: expectedCashOf(openingCash, cashSales, serviceCash, manualCashIn, manualCashOut),
    entries,
    isClosed: !!closing,
    closing
  };

  if (!closing) return live;

  // A closed day shows the frozen snapshot so later sales or edits cannot change what was signed off.
  return {
    ...live,
    openingCash: closing.openingCash,
    cashSales: closing.cashSales,
    upiSales: closing.upiSales,
    bankCardSales: closing.bankCardSales,
    creditSales: closing.creditSales,
    serviceCollections: closing.serviceCollections,
    serviceCash: round2(closing.expectedCash - closing.openingCash - closing.cashSales - closing.manualCashIn + closing.manualCashOut),
    manualCashIn: closing.manualCashIn,
    manualCashOut: closing.manualCashOut,
    expectedCash: closing.expectedCash
  };
}

export async function getDaySummary(branchId: string, date: string): Promise<DaySummary> {
  assertDate(date);
  return computeDay(branchId, date);
}

export async function getAllBranchesSummary(date: string) {
  assertDate(date);
  const branchList = await db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.id);
  const rows: BranchSummaryRow[] = await Promise.all(
    branchList.map(async (b) => {
      const { entries: _entries, ...rest } = await computeDay(b.id, date);
      return {
        ...rest,
        branchName: b.name,
        countedCash: rest.closing ? rest.closing.countedCash : null,
        variance: rest.closing ? rest.closing.variance : null
      };
    })
  );

  const sum = (pick: (r: BranchSummaryRow) => number) => round2(rows.reduce((acc, r) => acc + pick(r), 0));
  const totals = {
    openingCash: sum((r) => r.openingCash),
    cashSales: sum((r) => r.cashSales),
    upiSales: sum((r) => r.upiSales),
    bankCardSales: sum((r) => r.bankCardSales),
    creditSales: sum((r) => r.creditSales),
    serviceCollections: sum((r) => r.serviceCollections),
    manualCashIn: sum((r) => r.manualCashIn),
    manualCashOut: sum((r) => r.manualCashOut),
    expectedCash: sum((r) => r.expectedCash),
    countedCash: sum((r) => r.countedCash ?? 0),
    variance: sum((r) => r.variance ?? 0),
    closedBranches: rows.filter((r) => r.isClosed).length,
    totalBranches: rows.length
  };

  return { date, rows, totals };
}

export async function assertOpen(branchId: string, date: string): Promise<void> {
  const [closing] = await db
    .select({ id: cashClosings.id })
    .from(cashClosings)
    .where(and(eq(cashClosings.branchId, branchId), eq(cashClosings.businessDate, date)))
    .limit(1);
  if (closing) throw new CashBookError(`The cash book for ${date} is already closed. Ask an owner to reopen it first.`, 409);
}

export interface NewEntryInput {
  branchId: string;
  date: string;
  type: 'in' | 'out';
  category: string;
  amount: number;
  method: string;
  description?: string;
  createdBy?: string;
}

export async function addEntry(input: NewEntryInput, id: string): Promise<CashEntryRow> {
  assertDate(input.date);
  await assertOpen(input.branchId, input.date);
  const [row] = await db
    .insert(cashEntries)
    .values({
      id,
      branchId: input.branchId,
      entryDate: input.date,
      type: input.type,
      category: input.category,
      amount: round2(input.amount),
      method: input.method,
      description: input.description || null,
      createdBy: input.createdBy || null
    })
    .returning();
  return row;
}

export async function getEntry(id: string): Promise<CashEntryRow | null> {
  const [row] = await db.select().from(cashEntries).where(eq(cashEntries.id, id)).limit(1);
  return row ?? null;
}

export async function deleteEntry(id: string): Promise<CashEntryRow> {
  const entry = await getEntry(id);
  if (!entry) throw new CashBookError('Cash entry not found.', 404);
  await assertOpen(entry.branchId, entry.entryDate);
  await db.delete(cashEntries).where(eq(cashEntries.id, id));
  return entry;
}

export async function closeDay(
  branchId: string,
  date: string,
  countedCash: number,
  notes: string | undefined,
  closedBy: string | undefined,
  id: string
): Promise<CashClosingRow> {
  assertDate(date);
  const summary = await computeDay(branchId, date);
  if (summary.isClosed) throw new CashBookError(`The cash book for ${date} is already closed.`, 409);

  // The unique (branch, date) index makes concurrent closes lose cleanly.
  const [row] = await db
    .insert(cashClosings)
    .values({
      id,
      branchId,
      businessDate: date,
      openingCash: summary.openingCash,
      cashSales: summary.cashSales,
      upiSales: summary.upiSales,
      bankCardSales: summary.bankCardSales,
      creditSales: summary.creditSales,
      serviceCollections: summary.serviceCollections,
      manualCashIn: summary.manualCashIn,
      manualCashOut: summary.manualCashOut,
      expectedCash: summary.expectedCash,
      countedCash: round2(countedCash),
      variance: round2(countedCash - summary.expectedCash),
      notes: notes || null,
      closedBy: closedBy || null
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new CashBookError(`The cash book for ${date} is already closed.`, 409);
  return row;
}

export async function reopenDay(branchId: string, date: string): Promise<CashClosingRow> {
  assertDate(date);
  const [row] = await db
    .delete(cashClosings)
    .where(and(eq(cashClosings.branchId, branchId), eq(cashClosings.businessDate, date)))
    .returning();
  if (!row) throw new CashBookError(`No closing found for ${date}.`, 404);
  return row;
}

export async function listClosings(branchId: string | 'all', limit = 30): Promise<CashClosingRow[]> {
  const capped = Math.min(Math.max(Math.floor(limit) || 30, 1), 200);
  const query = db.select().from(cashClosings);
  const filtered = branchId === 'all' ? query : query.where(eq(cashClosings.branchId, branchId));
  return filtered.orderBy(desc(cashClosings.businessDate), desc(cashClosings.closedAt)).limit(capped);
}
