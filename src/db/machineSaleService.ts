import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, lte, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from './index.ts';
import { branches, customers, products, warehouses } from './schema.ts';
import { machineSaleEvents, machineSalePayments, machineSales } from './schema.machineSales.ts';
import { cancelMachineSaleInvoice, deleteMachineSaleInvoice, ensureMachineSaleInvoice, syncMachineSaleInvoice } from './documentService.ts';
import { StockError, applyStockDelta, type Actor, type Tx } from './stockService.ts';
import { businessDate } from '../routes/context.ts';

export const SALE_TYPES = ['normal', 'subsidy'] as const;
export const SUBSIDY_STATUSES = ['Applied', 'Sanctioned', 'Received', 'Rejected'] as const;

export class MachineSaleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const SALE_STATUSES = ['Booked', 'Ready for Delivery', 'Dispatched', 'Delivered', 'Cancelled'] as const;
export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Finance'] as const;
export const COMPANY_IDS = ['main', 'second'] as const;

// Every role that may read and work on machine sales of its own branch.
const SALES_ROLES = ['Branch Manager', 'Branch Person', 'Salesperson', 'Sales Manager', 'Cashier', 'Accountant', 'Warehouse Manager'];
// Roles that may dispatch, deliver or cancel.
const FLOW_ROLES = ['Branch Manager', 'Warehouse Manager', 'Sales Manager'];
const EDITABLE: string[] = ['Booked', 'Ready for Delivery'];

type SaleRow = typeof machineSales.$inferSelect;
type SaleInsert = typeof machineSales.$inferInsert;
type Exec = typeof db | Tx;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- parsing ----------

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function optText(v: unknown, field: string, max = 200): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new MachineSaleError(`${field} is too long (maximum ${max} characters)`);
  return s;
}

function reqText(v: unknown, field: string, max = 200): string {
  const s = optText(v, field, max);
  if (!s) throw new MachineSaleError(`${field} is required`);
  return s;
}

function optDate(v: unknown, field: string): string | null {
  const s = optText(v, field, 10);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()))) {
    throw new MachineSaleError(`${field} must be YYYY-MM-DD`);
  }
  return s;
}

function amountOf(v: unknown, field: string): number {
  const n = toNum(v);
  if (!Number.isFinite(n) || n < 0) throw new MachineSaleError(`${field} must be a number of 0 or more`);
  return round2(n);
}

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  const s = String(v ?? '');
  if (!(list as readonly string[]).includes(s)) throw new MachineSaleError(`${field} must be one of ${list.join(', ')}`);
  return s as T;
}

// The mobile number on a machine sale decides who the customer is. A number that already belongs to a customer
// links the sale to that customer; a new number adds the person to the customer list straight away.
const last10 = (phone: string) => phone.replace(/\D/g, '').slice(-10);

async function ensureCustomer(
  tx: Tx,
  c: { customerId: string | null; name: string; phone: string; address: string | null; gstin: string | null; branchId: string }
): Promise<{ id: string; created: boolean }> {
  if (c.customerId) {
    const [byId] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.customerId));
    if (byId) return { id: byId.id, created: false };
  }
  const digits = last10(c.phone);
  if (digits.length === 10) {
    const [byPhone] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(sql`right(regexp_replace(${customers.phone}, '\\D', '', 'g'), 10) = ${digits}`)
      .limit(1);
    if (byPhone) return { id: byPhone.id, created: false };
  }
  // next display code: CUST-001, CUST-002 ...
  const [{ n }] = (await tx.execute(
    sql`select coalesce(max(substring(customer_id from '[0-9]+$')::int), 0) as n from customers where customer_id like 'CUST-%'`
  )).rows as { n: number | string }[];
  const code = `CUST-${String(Number(n) + 1).padStart(3, '0')}`;
  // a customer picked on screen that only exists on the devices keeps its own id, so it is not created twice
  const id = c.customerId || `cust-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await tx.insert(customers).values({
    id,
    customerId: code,
    companyName: c.name,
    name: c.name,
    phone: digits.length === 10 ? digits : c.phone,
    address: c.address,
    state: 'Tamil Nadu',
    gstin: c.gstin && c.gstin !== 'UNREGISTERED' ? c.gstin : null,
    branchId: c.branchId,
    creditLimit: 200000,
    creditPeriodDays: 30,
    outstandingBalance: 0,
    rating: 'A',
    lastTransactionDate: businessDate()
  });
  return { id, created: true };
}

function checkPhone(v: string): string {
  if ((v.match(/\d/g) ?? []).length < 10) throw new MachineSaleError('customerPhone must have at least 10 digits');
  return v;
}

// Shared by create (all fields) and edit (only the fields that were sent).
function parseFields(input: Record<string, any>): Partial<SaleInsert> {
  const out: Record<string, any> = {};
  const has = (k: string) => input[k] !== undefined;
  const text = (k: string, max = 200, upper = false) => {
    if (!has(k)) return;
    const s = optText(input[k], k, max);
    out[k] = s && upper ? s.toUpperCase() : s;
  };
  const amount = (k: string) => {
    if (has(k)) out[k] = input[k] === '' || input[k] === null ? 0 : amountOf(input[k], k);
  };

  text('customerId', 100);
  text('customerName', 150);
  text('customerPhone', 30);
  text('customerAddress', 500);
  text('customerGstin', 30, true);
  text('productId', 100);
  text('machineName', 200);
  text('model', 150);
  text('sku', 100);
  // Upper-cased so the uniqueness check is case-insensitive.
  text('serialNumber', 100, true);
  text('engineNumber', 100, true);
  text('chassisNumber', 100, true);
  text('financier', 150);
  text('deliveryAddress', 500);
  text('pdiNotes', 1000);
  text('handoverNotes', 1000);
  text('documentNumber', 100);

  amount('listPrice');
  amount('discount');
  amount('salePrice');
  if (has('gstRate')) {
    const r = toNum(input.gstRate === '' || input.gstRate === null ? 0 : input.gstRate);
    if (!Number.isInteger(r) || r < 0 || r > 28) throw new MachineSaleError('gstRate must be a whole number between 0 and 28');
    out.gstRate = r;
  }
  amount('loanAmount');
  text('subsidyScheme', 200);
  amount('subsidyAmount');
  text('subsidyApplicationNo', 100);
  if (has('saleType')) out.saleType = oneOf(input.saleType, SALE_TYPES, 'saleType');
  if (has('subsidyStatus')) {
    out.subsidyStatus = input.subsidyStatus ? oneOf(input.subsidyStatus, SUBSIDY_STATUSES, 'subsidyStatus') : null;
  }
  if (has('subsidyReceivedDate')) out.subsidyReceivedDate = optDate(input.subsidyReceivedDate, 'subsidyReceivedDate');

  if (has('paymentMode')) out.paymentMode = oneOf(input.paymentMode, PAYMENT_MODES, 'paymentMode');
  if (has('companyId')) out.companyId = oneOf(input.companyId, COMPANY_IDS, 'companyId');
  if (has('bookingDate')) out.bookingDate = optDate(input.bookingDate, 'bookingDate');
  if (has('expectedDeliveryDate')) out.expectedDeliveryDate = optDate(input.expectedDeliveryDate, 'expectedDeliveryDate');
  if (has('warrantyMonths')) {
    const n = toNum(input.warrantyMonths);
    if (!Number.isInteger(n) || n < 0 || n > 120) throw new MachineSaleError('warrantyMonths must be a whole number from 0 to 120');
    out.warrantyMonths = n;
  }
  if (typeof out.customerPhone === 'string') checkPhone(out.customerPhone);
  return out as Partial<SaleInsert>;
}

// ---------- persistence helpers ----------

function isUniqueViolation(e: any): boolean {
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const DUPLICATE_MESSAGES: Record<string, string> = {
  uq_machine_sales_serial: 'This serial number is already on another active machine sale',
  uq_machine_sales_engine: 'This engine number is already on another active machine sale',
  uq_machine_sales_chassis: 'This chassis number is already on another active machine sale'
};

function rethrowDuplicate(e: any): void {
  const name: string | undefined = e?.constraint ?? e?.cause?.constraint;
  if (name && DUPLICATE_MESSAGES[name]) throw new MachineSaleError(DUPLICATE_MESSAGES[name], 409);
}

// Sale numbers are sequential per year; a concurrent request can take the same one, so the whole
// transaction is retried (a unique violation aborts it, so it cannot be retried in place).
async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      rethrowDuplicate(e);
      if (!isUniqueViolation(e)) throw e;
      if (attempt >= 4) throw new MachineSaleError('Could not generate a unique sale number, please retry', 409);
    }
  }
}

async function nextSaleNumber(tx: Tx): Promise<string> {
  const stem = `MS-${businessDate().slice(0, 4)}-`;
  const result = await tx.execute(
    sql`select coalesce(max(substring(sale_number from '[0-9]+$')::int), 0) as n
        from machine_sales where sale_number like ${stem + '%'}`
  );
  const n = Number((result.rows[0] as { n: number | string }).n);
  return `${stem}${String(n + 1).padStart(4, '0')}`;
}

// Summed from the payment rows so the figure can never drift from the receipts.
const paidSql = sql<number>`(case when ${sql.raw('"machine_sales"."is_historical"')} then ${sql.raw('"machine_sales"."sale_price"')} else coalesce((select sum(${machineSalePayments.amount}) from ${machineSalePayments} where ${machineSalePayments.saleId} = ${sql.raw('"machine_sales"."id"')}), 0) end)`;

async function paidOf(exec: Exec, saleId: string): Promise<number> {
  const [r] = await exec
    .select({ sum: sql<number>`coalesce(sum(${machineSalePayments.amount}), 0)` })
    .from(machineSalePayments)
    .where(eq(machineSalePayments.saleId, saleId));
  return round2(Number(r?.sum ?? 0));
}

// What the government scheme covers; a rejected subsidy falls back on the customer.
export function subsidyCover(row: Pick<SaleRow, 'saleType' | 'subsidyAmount' | 'subsidyStatus'>): number {
  return row.saleType === 'subsidy' && row.subsidyStatus !== 'Rejected' ? row.subsidyAmount || 0 : 0;
}

// The tax contained in a GST-inclusive price.
const gstIncluded = (price: number, rate: number): number => (rate > 0 ? round2(price - price / (1 + rate / 100)) : 0);

export function customerPayable(row: Pick<SaleRow, 'salePrice' | 'saleType' | 'subsidyAmount' | 'subsidyStatus'>): number {
  return Math.max(0, round2(row.salePrice - subsidyCover(row)));
}

function present(row: SaleRow, paid: number) {
  const paidAmount = round2(Number(paid));
  const payable = customerPayable(row);
  const cover = subsidyCover(row);
  return {
    ...row,
    advancePaid: paidAmount,
    paidAmount,
    customerPayable: payable,
    balance: Math.max(0, round2(payable - paidAmount)),
    subsidyDue: row.saleType === 'subsidy' && row.subsidyStatus !== 'Received' ? cover : 0
  };
}

async function addEvent(tx: Tx, saleId: string, stage: string, user: string, notes?: string | null) {
  await tx.insert(machineSaleEvents).values({ saleId, stage, user, notes: notes ?? null, date: new Date() });
}

function assertAccess(sale: SaleRow | undefined, actor: Actor): SaleRow {
  if (!sale) throw new MachineSaleError('Machine sale not found', 404);
  if (!actor.isOwner && sale.branchId !== actor.branchId) throw new MachineSaleError('Access denied for this branch', 403);
  return sale;
}

function assertRole(actor: Actor, allowed: string[], action: string) {
  if (actor.isOwner || allowed.includes(actor.role)) return;
  throw new MachineSaleError(`Your role cannot ${action}`, 403);
}

async function lockSale(tx: Tx, id: string, actor: Actor): Promise<SaleRow> {
  const [sale] = await tx.select().from(machineSales).where(eq(machineSales.id, id)).for('update');
  return assertAccess(sale, actor);
}

function requireStatus(sale: SaleRow, allowed: string[], action: string) {
  if (!allowed.includes(sale.status)) {
    throw new MachineSaleError(`Cannot ${action} a machine sale that is ${sale.status}`, 409);
  }
}

// Stock errors keep their status but use this module's error type.
async function moveStock(tx: Tx, args: Parameters<typeof applyStockDelta>[1]) {
  try {
    return await applyStockDelta(tx, args);
  } catch (e) {
    if (e instanceof StockError) throw new MachineSaleError(e.message, e.status);
    throw e;
  }
}

async function assertUniqueMachineIds(
  tx: Tx,
  ids: { serialNumber?: string | null; engineNumber?: string | null; chassisNumber?: string | null },
  excludeId?: string
) {
  const checks: [string, string, AnyPgColumn][] = [];
  if (ids.serialNumber) checks.push(['Serial number', ids.serialNumber, machineSales.serialNumber]);
  if (ids.engineNumber) checks.push(['Engine number', ids.engineNumber, machineSales.engineNumber]);
  if (ids.chassisNumber) checks.push(['Chassis number', ids.chassisNumber, machineSales.chassisNumber]);
  for (const [label, value, column] of checks) {
    const [dup] = await tx
      .select({ saleNumber: machineSales.saleNumber })
      .from(machineSales)
      .where(and(eq(column, value), ne(machineSales.status, 'Cancelled'), excludeId ? ne(machineSales.id, excludeId) : undefined))
      .limit(1);
    if (dup) throw new MachineSaleError(`${label} ${value} is already on machine sale ${dup.saleNumber}`, 409);
  }
}

async function loadDetail(id: string) {
  const [sale] = await db.select().from(machineSales).where(eq(machineSales.id, id));
  if (!sale) throw new MachineSaleError('Machine sale not found', 404);
  const [payments, events] = await Promise.all([
    db.select().from(machineSalePayments).where(eq(machineSalePayments.saleId, id)).orderBy(asc(machineSalePayments.id)),
    db.select().from(machineSaleEvents).where(eq(machineSaleEvents.saleId, id)).orderBy(asc(machineSaleEvents.id))
  ]);
  const paid = sale.isHistorical ? sale.salePrice : payments.reduce((s, p) => s + p.amount, 0);
  return { ...present(sale, paid), payments, events };
}

// ---------- reads ----------

export interface ListFilters {
  status?: string;
  q?: string;
  customerId?: string;
  from?: string;
  to?: string;
  // Partial match on serial, engine or chassis number.
  serial?: string;
  // 'with' = a serial number is recorded, 'without' = not yet entered.
  serialState?: string;
  // 'paid' = nothing left to collect, 'unpaid' = nothing received yet, 'part' = some received, some due.
  payment?: string;
}

function branchCondition(scope: string, actor: Actor) {
  const effective = actor.isOwner ? scope : actor.branchId;
  return effective && effective !== 'all' ? eq(machineSales.branchId, effective) : undefined;
}

export async function listMachineSales(scope: string, filters: ListFilters, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'view machine sales');
  const conds = [];
  const branchCond = branchCondition(scope, actor);
  if (branchCond) conds.push(branchCond);

  const status = filters.status?.trim();
  if (status && status.toLowerCase() !== 'all') {
    if (!(SALE_STATUSES as readonly string[]).includes(status)) throw new MachineSaleError('Unknown status filter');
    conds.push(eq(machineSales.status, status));
  }
  if (filters.customerId) conds.push(eq(machineSales.customerId, filters.customerId));
  const from = optDate(filters.from, 'from');
  const to = optDate(filters.to, 'to');
  if (from) conds.push(gte(machineSales.bookingDate, from));
  if (to) conds.push(lte(machineSales.bookingDate, to));
  const serial = filters.serial?.trim();
  if (serial) {
    const like = `%${serial.replace(/[\\%_]/g, '\\$&')}%`;
    conds.push(
      or(
        ilike(machineSales.serialNumber, like),
        ilike(machineSales.engineNumber, like),
        ilike(machineSales.chassisNumber, like)
      )!
    );
  }
  const serialState = filters.serialState?.trim().toLowerCase();
  if (serialState === 'with') {
    conds.push(sql`coalesce(${machineSales.serialNumber}, '') <> ''`);
  } else if (serialState === 'without') {
    conds.push(sql`coalesce(${machineSales.serialNumber}, '') = ''`);
  }
  const payment = filters.payment?.trim().toLowerCase();
  if (payment === 'paid' || payment === 'unpaid' || payment === 'part') {
    const cover = sql`(case when ${machineSales.saleType} = 'subsidy' and coalesce(${machineSales.subsidyStatus}, '') <> 'Rejected' then ${machineSales.subsidyAmount} else 0 end)`;
    const due = sql`(${machineSales.salePrice} - ${cover} - ${paidSql})`;
    if (payment === 'paid') conds.push(sql`${due} <= 0.005`);
    else if (payment === 'unpaid') conds.push(sql`${paidSql} = 0 and ${due} > 0.005`);
    else conds.push(sql`${paidSql} > 0 and ${due} > 0.005`);
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conds.push(
      or(
        ilike(machineSales.saleNumber, like),
        ilike(machineSales.customerName, like),
        ilike(machineSales.customerPhone, like),
        ilike(machineSales.machineName, like),
        ilike(machineSales.model, like),
        ilike(machineSales.serialNumber, like),
        ilike(machineSales.engineNumber, like),
        ilike(machineSales.chassisNumber, like),
        ilike(machineSales.documentNumber, like)
      )!
    );
  }
  const rows = await db
    .select({ sale: machineSales, paid: paidSql })
    .from(machineSales)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(machineSales.createdAt))
    .limit(500);
  return rows.map((r) => present(r.sale, r.paid));
}

export async function getMachineSale(id: string, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'view machine sales');
  const detail = await loadDetail(id);
  assertAccess(detail, actor);
  return detail;
}

// Old bills with no date written on them are kept together under this placeholder date; the screens show it as "No date".
export const NO_DATE = '1900-01-01';

// Financial year (April to March) of a booking date, as the year it starts in.
const FY_START = sql`(case when substr(${machineSales.bookingDate}, 6, 2)::int >= 4 then substr(${machineSales.bookingDate}, 1, 4)::int else substr(${machineSales.bookingDate}, 1, 4)::int - 1 end)`;

export interface YearSummary {
  fy: number; // the year it starts in: 2015 means 2015-2016
  label: string;
  units: number;
  value: number;
  avgPrice: number;
  topModel: string | null;
  topModelUnits: number;
}

// How many machines were sold in each financial year and for how much, and in which months machines usually sell.
export async function getYearSummary(scope: string, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'view machine sales');
  const live = and(ne(machineSales.status, 'Cancelled'), branchCondition(scope, actor));
  const where = and(live, ne(machineSales.bookingDate, NO_DATE));
  const rows = await db
    .select({
      fy: FY_START,
      units: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${machineSales.salePrice}), 0)::float8`
    })
    .from(machineSales)
    .where(where)
    .groupBy(FY_START)
    .orderBy(FY_START);
  const models = await db
    .select({
      fy: FY_START,
      model: sql<string>`coalesce(nullif(${machineSales.model}, ''), ${machineSales.machineName})`,
      units: sql<number>`count(*)::int`
    })
    .from(machineSales)
    .where(where)
    .groupBy(FY_START, sql`coalesce(nullif(${machineSales.model}, ''), ${machineSales.machineName})`);
  const top = new Map<number, { model: string; units: number }>();
  for (const m of models) {
    const fy = Number(m.fy);
    const cur = top.get(fy);
    if (!cur || m.units > cur.units) top.set(fy, { model: m.model, units: m.units });
  }
  const years: YearSummary[] = rows.map((r) => {
    const fy = Number(r.fy);
    const units = Number(r.units);
    const value = round2(Number(r.value));
    return { fy, label: `${fy}-${fy + 1}`, units, value, avgPrice: units ? round2(value / units) : 0, topModel: top.get(fy)?.model ?? null, topModelUnits: top.get(fy)?.units ?? 0 };
  });
  const months = await db
    .select({ month: sql<number>`substr(${machineSales.bookingDate}, 6, 2)::int`, units: sql<number>`count(*)::int` })
    .from(machineSales)
    .where(where)
    .groupBy(sql`substr(${machineSales.bookingDate}, 6, 2)::int`);
  const monthly = Array.from({ length: 12 }, (_, i) => Number(months.find((m) => Number(m.month) === i + 1)?.units ?? 0));
  const [nd] = await db
    .select({ units: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${machineSales.salePrice}), 0)::float8` })
    .from(machineSales)
    .where(and(live, eq(machineSales.bookingDate, NO_DATE)));
  const noDate = { units: Number(nd?.units ?? 0), value: round2(Number(nd?.value ?? 0)) };
  return {
    years,
    monthly,
    noDate,
    totalUnits: years.reduce((s, y) => s + y.units, 0) + noDate.units,
    totalValue: round2(years.reduce((s, y) => s + y.value, 0) + noDate.value)
  };
}

export async function getSummary(scope: string, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'view machine sales');
  const today = businessDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const open = sql`${machineSales.status} in ('Booked', 'Ready for Delivery', 'Dispatched')`;
  const [r] = await db
    .select({
      booked: sql<number>`count(*) filter (where ${machineSales.status} = 'Booked')::int`,
      readyForDelivery: sql<number>`count(*) filter (where ${machineSales.status} = 'Ready for Delivery')::int`,
      dispatched: sql<number>`count(*) filter (where ${machineSales.status} = 'Dispatched')::int`,
      deliveredThisMonth: sql<number>`count(*) filter (where ${machineSales.status} = 'Delivered' and ${machineSales.deliveredDate} >= ${monthStart})::int`,
      outstandingBalance: sql<number>`coalesce(sum(greatest(${machineSales.salePrice} - (case when ${machineSales.saleType} = 'subsidy' and coalesce(${machineSales.subsidyStatus}, '') <> 'Rejected' then ${machineSales.subsidyAmount} else 0 end) - ${paidSql}, 0)) filter (where ${machineSales.status} <> 'Cancelled'), 0)::float8`,
      subsidyPending: sql<number>`coalesce(sum(${machineSales.subsidyAmount}) filter (where ${machineSales.status} <> 'Cancelled' and ${machineSales.saleType} = 'subsidy' and coalesce(${machineSales.subsidyStatus}, '') not in ('Received', 'Rejected')), 0)::float8`,
      dueToday: sql<number>`count(*) filter (where ${open} and ${machineSales.expectedDeliveryDate} = ${today})::int`,
      overdue: sql<number>`count(*) filter (where ${open} and ${machineSales.expectedDeliveryDate} < ${today})::int`
    })
    .from(machineSales)
    .where(branchCondition(scope, actor));
  return {
    booked: Number(r?.booked ?? 0),
    readyForDelivery: Number(r?.readyForDelivery ?? 0),
    dispatched: Number(r?.dispatched ?? 0),
    deliveredThisMonth: Number(r?.deliveredThisMonth ?? 0),
    outstandingBalance: round2(Number(r?.outstandingBalance ?? 0)),
    subsidyPending: round2(Number(r?.subsidyPending ?? 0)),
    dueToday: Number(r?.dueToday ?? 0),
    overdue: Number(r?.overdue ?? 0)
  };
}

// ---------- writes ----------

async function prefillFromProduct(tx: Tx, f: Record<string, any>) {
  if (!f.productId) return;
  const [p] = await tx.select({ name: products.name, sku: products.sku }).from(products).where(eq(products.id, f.productId));
  if (!p) throw new MachineSaleError('Selected product was not found', 404);
  if (!f.machineName) f.machineName = p.name;
  if (!f.sku) f.sku = p.sku;
}

export async function createMachineSale(input: Record<string, any>, branchId: string, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'create machine sales');
  if (!actor.isOwner && branchId !== actor.branchId) throw new MachineSaleError('Access denied for this branch', 403);

  const f = parseFields(input) as Record<string, any>;
  const customerName = reqText(f.customerName, 'customerName', 150);
  const customerPhone = checkPhone(reqText(f.customerPhone, 'customerPhone', 30));
  if (f.salePrice === undefined || !(f.salePrice > 0)) throw new MachineSaleError('salePrice must be greater than 0');
  const salePrice: number = f.salePrice;
  const discount: number = f.discount ?? 0;
  const listPrice: number = f.listPrice && f.listPrice > 0 ? f.listPrice : round2(salePrice + discount);
  const loanAmount: number = f.loanAmount ?? 0;
  if (loanAmount > salePrice) throw new MachineSaleError('loanAmount cannot exceed the sale price');
  const gstRate: number = f.gstRate ?? 0;
  const gstAmount = gstIncluded(salePrice, gstRate);

  const saleType: string = f.saleType ?? 'normal';
  const subsidyAmount: number = saleType === 'subsidy' ? f.subsidyAmount ?? 0 : 0;
  if (saleType === 'subsidy') {
    if (!f.subsidyScheme) throw new MachineSaleError('Enter the subsidy scheme name');
    if (!(subsidyAmount > 0)) throw new MachineSaleError('Enter the subsidy amount');
    if (subsidyAmount >= salePrice) throw new MachineSaleError('Subsidy must be less than the sale price');
  }
  const payable = round2(salePrice - subsidyAmount);

  let advance: { amount: number; method: string; reference: string | null; paidOn: string } | null = null;
  const adv = input.advance;
  if (adv && typeof adv === 'object' && adv.amount !== undefined && adv.amount !== null && adv.amount !== '') {
    const amount = amountOf(adv.amount, 'advance.amount');
    if (amount > 0) {
      if (amount > payable + 0.005) throw new MachineSaleError('Advance cannot exceed the amount the customer has to pay');
      advance = {
        amount,
        method: adv.method === undefined || adv.method === '' ? 'Cash' : oneOf(adv.method, PAYMENT_MODES, 'advance.method'),
        reference: optText(adv.reference, 'advance.reference', 100),
        paidOn: optDate(adv.paidOn, 'advance.paidOn') || businessDate()
      };
    }
  }

  // Secondary advance: part of the advance paid another way (for example UPI first, the rest in cash).
  let advance2: { amount: number; method: string; reference: string | null; paidOn: string } | null = null;
  const adv2 = input.advance2;
  if (adv2 && typeof adv2 === 'object' && adv2.amount !== undefined && adv2.amount !== null && adv2.amount !== '') {
    const amount = amountOf(adv2.amount, 'advance2.amount');
    if (amount > 0) {
      if (!advance) throw new MachineSaleError('Enter the first advance before a secondary payment');
      const method = adv2.method === undefined || adv2.method === '' ? 'Cash' : oneOf(adv2.method, PAYMENT_MODES, 'advance2.method');
      if (method === advance.method) throw new MachineSaleError('The secondary payment must be a different method from the first payment');
      if (advance.amount + amount > payable + 0.005) throw new MachineSaleError('The two advance payments together cannot exceed the amount the customer has to pay');
      advance2 = { amount, method, reference: optText(adv2.reference, 'advance2.reference', 100), paidOn: advance.paidOn };
    }
  }
  const advanceTotal = round2((advance?.amount ?? 0) + (advance2?.amount ?? 0));

  let customerCreated = false;
  const id = await withNumberRetry(() =>
    db.transaction(async (tx) => {
      customerCreated = false;
      const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
      if (!branch) throw new MachineSaleError('Branch not found', 404);

      const filled = { ...f };
      await prefillFromProduct(tx, filled);
      const machineName = reqText(filled.machineName, 'machineName', 200);
      await assertUniqueMachineIds(tx, filled);

      const linked = await ensureCustomer(tx, {
        customerId: filled.customerId ?? null,
        name: customerName,
        phone: customerPhone,
        address: filled.customerAddress ?? null,
        gstin: filled.customerGstin ?? null,
        branchId
      });
      customerCreated = linked.created;

      const saleNumber = await nextSaleNumber(tx);
      const saleId = `ms-${randomUUID()}`;
      await tx.insert(machineSales).values({
        id: saleId,
        saleNumber,
        branchId,
        companyId: filled.companyId ?? 'main',
        status: 'Booked',
        customerId: linked.id,
        customerName,
        customerPhone,
        customerAddress: filled.customerAddress ?? null,
        customerGstin: filled.customerGstin ?? null,
        productId: filled.productId ?? null,
        machineName,
        model: filled.model ?? null,
        sku: filled.sku ?? null,
        serialNumber: filled.serialNumber ?? null,
        engineNumber: filled.engineNumber ?? null,
        chassisNumber: filled.chassisNumber ?? null,
        listPrice,
        discount,
        salePrice,
        gstRate,
        gstAmount,
        advancePaid: advanceTotal,
        paymentMode: filled.paymentMode ?? 'Cash',
        financier: filled.financier ?? null,
        loanAmount,
        saleType,
        subsidyScheme: saleType === 'subsidy' ? filled.subsidyScheme ?? null : null,
        subsidyAmount,
        subsidyStatus: saleType === 'subsidy' ? filled.subsidyStatus ?? 'Applied' : null,
        subsidyApplicationNo: saleType === 'subsidy' ? filled.subsidyApplicationNo ?? null : null,
        bookingDate: filled.bookingDate ?? businessDate(),
        expectedDeliveryDate: filled.expectedDeliveryDate ?? null,
        deliveryAddress: filled.deliveryAddress ?? null,
        pdiNotes: filled.pdiNotes ?? null,
        handoverNotes: filled.handoverNotes ?? null,
        warrantyMonths: filled.warrantyMonths ?? 12,
        documentNumber: filled.documentNumber ?? null,
        createdBy: actor.name
      });
      if (advance) {
        await tx.insert(machineSalePayments).values({
          saleId,
          amount: advance.amount,
          method: advance.method,
          paidOn: advance.paidOn,
          reference: advance.reference,
          receivedBy: actor.name
        });
      }
      if (advance2) {
        await tx.insert(machineSalePayments).values({
          saleId,
          amount: advance2.amount,
          method: advance2.method,
          paidOn: advance2.paidOn,
          reference: advance2.reference,
          receivedBy: actor.name
        });
      }
      await addEvent(
        tx,
        saleId,
        'Booked',
        actor.name,
        `${saleNumber} for ${customerName}${advance ? `, advance ${money(advanceTotal)}${advance2 ? ` (${advance.method} ${money(advance.amount)} + ${advance2.method} ${money(advance2.amount)})` : ''}` : ''}`
      );
      if (linked.created) await addEvent(tx, saleId, 'Customer added', actor.name, `${customerName} (${customerPhone}) was new and was added to the customer list`);
      // The invoice is made when the sale is paid for: here when an advance is taken at booking, otherwise with the
      // first payment or at delivery.
      if (advance) await makeInvoice(tx, saleId, actor.name);
      return saleId;
    })
  );
  const detail = await loadDetail(id);
  return customerCreated ? { ...detail, customerCreated: true } : detail;
}

export async function updateMachineSale(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'edit machine sales');
  const f = parseFields(input) as Record<string, any>;
  for (const k of ['customerName', 'customerPhone', 'machineName', 'salePrice', 'bookingDate']) {
    if (k in f && (f[k] === null || f[k] === undefined)) throw new MachineSaleError(`${k} cannot be empty`);
  }
  if ('salePrice' in f && !(f.salePrice > 0)) throw new MachineSaleError('salePrice must be greater than 0');

  try {
    await db.transaction(async (tx) => {
      const sale = await lockSale(tx, id, actor);
      // Owners and managers can correct a sale at any stage (a wrong price, a customer detail, a serial number);
      // everyone else only while it is still being prepared. A cancelled sale is closed.
      const canCorrectLater = actor.isOwner || FLOW_ROLES.includes(actor.role);
      if (sale.status === 'Cancelled' || (!EDITABLE.includes(sale.status) && !canCorrectLater)) {
        throw new MachineSaleError(`Cannot edit a machine sale that is ${sale.status}`, 409);
      }
      if (sale.stockDeducted && typeof input.productId === 'string' && input.productId !== (sale.productId ?? '')) {
        throw new MachineSaleError('The machine has already left stock. Delete this sale and book it again to change the machine.', 409);
      }
      const paid = await paidOf(tx, id);

      const set: Record<string, any> = { ...f };
      if (typeof set.customerPhone === 'string' && last10(set.customerPhone) !== last10(sale.customerPhone)) {
        const linked = await ensureCustomer(tx, {
          customerId: null,
          name: set.customerName ?? sale.customerName,
          phone: set.customerPhone,
          address: set.customerAddress ?? sale.customerAddress,
          gstin: set.customerGstin ?? sale.customerGstin,
          branchId: sale.branchId
        });
        set.customerId = linked.id;
      }
      if ('productId' in set && set.productId) {
        const merged = { productId: set.productId, machineName: set.machineName ?? sale.machineName, sku: set.sku ?? sale.sku };
        await prefillFromProduct(tx, merged);
        if (!('machineName' in set)) set.machineName = merged.machineName;
        if (!('sku' in set) || !set.sku) set.sku = merged.sku;
      }

      if (set.saleType === 'normal') {
        set.subsidyAmount = 0;
        set.subsidyScheme = null;
        set.subsidyStatus = null;
        set.subsidyApplicationNo = null;
        set.subsidyReceivedDate = null;
      } else if (set.saleType === 'subsidy' && !('subsidyStatus' in set) && !sale.subsidyStatus) {
        set.subsidyStatus = 'Applied';
      }
      const next = { ...sale, ...set } as SaleRow;
      if ('gstRate' in set || 'salePrice' in set) set.gstAmount = gstIncluded(next.salePrice, next.gstRate);
      if (next.saleType === 'subsidy') {
        if (!next.subsidyScheme) throw new MachineSaleError('Enter the subsidy scheme name');
        if (!(next.subsidyAmount > 0)) throw new MachineSaleError('Enter the subsidy amount');
        if (next.subsidyAmount >= next.salePrice) throw new MachineSaleError('Subsidy must be less than the sale price');
      }
      const nextPayable = customerPayable(next);
      if (nextPayable < paid - 0.005) {
        throw new MachineSaleError(`The customer's share cannot be less than the ${money(paid)} already received`);
      }
      if (next.loanAmount > next.salePrice) throw new MachineSaleError('loanAmount cannot exceed the sale price');

      await assertUniqueMachineIds(
        tx,
        {
          serialNumber: 'serialNumber' in set ? set.serialNumber : null,
          engineNumber: 'engineNumber' in set ? set.engineNumber : null,
          chassisNumber: 'chassisNumber' in set ? set.chassisNumber : null
        },
        id
      );

      const changed = Object.keys(set).filter((k) => (sale as Record<string, any>)[k] !== set[k]);
      await tx
        .update(machineSales)
        .set({ ...set, advancePaid: paid, updatedAt: new Date() })
        .where(eq(machineSales.id, id));
      if (changed.length) await addEvent(tx, id, 'Updated', actor.name, `Changed: ${changed.join(', ')}`);
      // an invoice that exists follows the sale
      if (sale.invoiceId) await makeInvoice(tx, id, actor.name);
    });
  } catch (e) {
    rethrowDuplicate(e);
    throw e;
  }
  return loadDetail(id);
}

export async function addPayment(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'record payments');
  const amount = amountOf(input.amount, 'amount');
  if (amount <= 0) throw new MachineSaleError('amount must be greater than 0');
  const method = input.method === undefined || input.method === '' ? 'Cash' : oneOf(input.method, PAYMENT_MODES, 'method');
  const paidOn = optDate(input.paidOn, 'paidOn') || businessDate();
  const reference = optText(input.reference, 'reference', 100);

  // Secondary payment: part of this payment taken another way, recorded as its own payment.
  let second: { amount: number; method: string; reference: string | null } | null = null;
  const sec = input.secondary;
  if (sec && typeof sec === 'object' && sec.amount !== undefined && sec.amount !== null && sec.amount !== '') {
    const amount2 = amountOf(sec.amount, 'secondary.amount');
    if (amount2 > 0) {
      const method2 = sec.method === undefined || sec.method === '' ? 'Cash' : oneOf(sec.method, PAYMENT_MODES, 'secondary.method');
      if (method2 === method) throw new MachineSaleError('The secondary payment must be a different method from the first payment');
      second = { amount: amount2, method: method2, reference: optText(sec.reference, 'secondary.reference', 100) };
    }
  }
  const total = round2(amount + (second?.amount ?? 0));

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.status === 'Cancelled') throw new MachineSaleError('Cannot take payment on a Cancelled machine sale');
    const paid = await paidOf(tx, id);
    const balance = round2(customerPayable(sale) - paid);
    if (balance <= 0) throw new MachineSaleError('No balance is due on this machine sale');
    if (total > balance + 0.005) throw new MachineSaleError(`Amount exceeds the balance of ${money(balance)}`);
    await tx.insert(machineSalePayments).values({ saleId: id, amount, method, paidOn, reference, receivedBy: actor.name });
    if (second) {
      await tx.insert(machineSalePayments).values({ saleId: id, amount: second.amount, method: second.method, paidOn, reference: second.reference, receivedBy: actor.name });
    }
    // The first payment makes the invoice; later payments appear on it.
    await makeInvoice(tx, id, actor.name);
    await tx
      .update(machineSales)
      .set({ advancePaid: round2(paid + total), updatedAt: new Date() })
      .where(eq(machineSales.id, id));
    await addEvent(
      tx,
      id,
      'Payment',
      actor.name,
      second
        ? `${money(total)}: ${money(amount)} by ${method} + ${money(second.amount)} by ${second.method}`
        : `${money(amount)} by ${method}${reference ? ` (${reference})` : ''}`
    );
  });
  return loadDetail(id);
}

// A direct sale: the customer buys the machine at the counter and takes it away, with no booking in between. It is
// one action by the person selling, so the booking, inspection, dispatch and handover steps are all done in one go.
// If a later step fails (for example the machine is not in stock) the sale stays booked at that step and the message
// says where, so nothing is lost and it can be finished from the Machine Sales list.
export async function completeDirectSale(id: string, input: Record<string, any>, actor: Actor) {
  // the steps below are normally for managers; the person at the counter may do them for their own direct sale
  const flowActor: Actor = actor.isOwner || FLOW_ROLES.includes(actor.role) ? actor : { ...actor, role: 'Branch Manager' };
  const deliveredDate = optDate(input.deliveredDate, 'deliveredDate') || businessDate();
  const [sale] = await db.select().from(machineSales).where(eq(machineSales.id, id));
  const stage = async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof MachineSaleError) {
        throw new MachineSaleError(`The sale was saved, but could not be completed at "${label}": ${e.message}. Finish it from the Machine Sales list.`, e.status);
      }
      throw e;
    }
  };
  await stage('inspection', () => markReady(id, { pdiDone: true, pdiNotes: 'Direct sale: sold at the counter' }, flowActor));
  await stage('dispatch', () => dispatchMachineSale(id, {}, flowActor));
  return stage('handover', () =>
    deliverMachineSale(
      id,
      { receivedByName: sale?.customerName || 'Customer', deliveredDate, handoverNotes: 'Direct sale: handed over at the counter' },
      flowActor
    )
  );
}

// Owners and branch managers can correct or remove a payment that was entered wrongly. The sale's paid total, its
// invoice and the cash book (which reads these payments) all follow.
const PAYMENT_EDIT_ROLES = ['Branch Manager'];

export async function updateSalePayment(id: string, paymentId: number, input: Record<string, any>, actor: Actor) {
  assertRole(actor, PAYMENT_EDIT_ROLES, 'edit machine sale payments');
  const amount = amountOf(input.amount, 'amount');
  if (amount <= 0) throw new MachineSaleError('amount must be greater than 0');
  const method = input.method === undefined || input.method === '' ? 'Cash' : oneOf(input.method, PAYMENT_MODES, 'method');
  const paidOn = optDate(input.paidOn, 'paidOn') || businessDate();
  const reference = optText(input.reference, 'reference', 100);

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.status === 'Cancelled') throw new MachineSaleError('This machine sale is cancelled');
    const [pay] = await tx.select().from(machineSalePayments).where(and(eq(machineSalePayments.id, paymentId), eq(machineSalePayments.saleId, id)));
    if (!pay) throw new MachineSaleError('Payment not found', 404);
    const paid = await paidOf(tx, id);
    const payable = customerPayable(sale);
    const newPaid = round2(paid - pay.amount + amount);
    if (newPaid > payable + 0.005) {
      throw new MachineSaleError(`The payments would add up to ${money(newPaid)}, more than the ${money(payable)} the customer has to pay`);
    }
    await tx.update(machineSalePayments).set({ amount, method, paidOn, reference }).where(eq(machineSalePayments.id, paymentId));
    await tx.update(machineSales).set({ advancePaid: newPaid, updatedAt: new Date() }).where(eq(machineSales.id, id));
    await syncMachineSaleInvoice(tx, id);
    await addEvent(tx, id, 'Payment edited', actor.name, `${money(pay.amount)} ${pay.method} changed to ${money(amount)} ${method}`);
  });
  return loadDetail(id);
}

export async function deleteSalePayment(id: string, paymentId: number, actor: Actor) {
  assertRole(actor, PAYMENT_EDIT_ROLES, 'remove machine sale payments');
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.status === 'Cancelled') throw new MachineSaleError('This machine sale is cancelled');
    const [pay] = await tx.select().from(machineSalePayments).where(and(eq(machineSalePayments.id, paymentId), eq(machineSalePayments.saleId, id)));
    if (!pay) throw new MachineSaleError('Payment not found', 404);
    await tx.delete(machineSalePayments).where(eq(machineSalePayments.id, paymentId));
    await tx.update(machineSales).set({ advancePaid: round2((await paidOf(tx, id))), updatedAt: new Date() }).where(eq(machineSales.id, id));
    await syncMachineSaleInvoice(tx, id);
    await addEvent(tx, id, 'Payment removed', actor.name, `${money(pay.amount)} by ${pay.method} (${pay.paidOn}) was removed`);
  });
  return loadDetail(id);
}

export async function markReady(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, SALES_ROLES, 'mark machine sales ready');
  if (input.pdiDone !== true && input.pdiDone !== 'true') {
    throw new MachineSaleError('Complete the PDI checklist (pdiDone) before marking the machine ready');
  }
  const pdiNotes = optText(input.pdiNotes, 'pdiNotes', 1000);

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    requireStatus(sale, ['Booked'], 'mark ready');
    await tx
      .update(machineSales)
      .set({ status: 'Ready for Delivery', pdiDone: true, pdiNotes: pdiNotes ?? sale.pdiNotes, updatedAt: new Date() })
      .where(eq(machineSales.id, id));
    await addEvent(tx, id, 'Ready for Delivery', actor.name, pdiNotes ? `PDI done: ${pdiNotes}` : 'PDI done');
  });
  return loadDetail(id);
}

export async function dispatchMachineSale(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, FLOW_ROLES, 'dispatch machine sales');
  const vehicleNo = optText(input.vehicleNo, 'vehicleNo', 30)?.toUpperCase() ?? null;
  const driverName = optText(input.driverName, 'driverName', 100);
  const driverPhone = optText(input.driverPhone, 'driverPhone', 30);
  const deliveryAddress = optText(input.deliveryAddress, 'deliveryAddress', 500);
  const requestedWh = optText(input.warehouseId, 'warehouseId', 100);

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    requireStatus(sale, ['Ready for Delivery'], 'dispatch');

    let warehouseId: string | null = null;
    if (requestedWh) {
      const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, requestedWh));
      if (!wh) throw new MachineSaleError('Warehouse not found', 404);
      if (!actor.isOwner && wh.branchId !== sale.branchId) {
        throw new MachineSaleError('Warehouse does not belong to this sale branch');
      }
      warehouseId = wh.id;
    } else if (sale.productId) {
      const [first] = await tx.select().from(warehouses).where(eq(warehouses.branchId, sale.branchId)).orderBy(asc(warehouses.id)).limit(1);
      if (!first) throw new MachineSaleError('This branch has no warehouse to take the machine stock from');
      warehouseId = first.id;
    }

    let stockDeducted = false;
    if (sale.productId && warehouseId) {
      await moveStock(tx, {
        productId: sale.productId,
        warehouseId,
        availableDelta: -1,
        type: 'machine-sale',
        refType: 'machine-sale',
        refId: sale.id,
        note: `${sale.saleNumber} dispatched to ${sale.customerName}`,
        user: actor.name
      });
      stockDeducted = true;
    }

    await tx
      .update(machineSales)
      .set({
        status: 'Dispatched',
        vehicleNo: vehicleNo ?? sale.vehicleNo,
        driverName: driverName ?? sale.driverName,
        driverPhone: driverPhone ?? sale.driverPhone,
        deliveryAddress: deliveryAddress ?? sale.deliveryAddress,
        warehouseId,
        stockDeducted,
        updatedAt: new Date()
      })
      .where(eq(machineSales.id, id));
    const parts = [];
    if (vehicleNo ?? sale.vehicleNo) parts.push(`Vehicle ${vehicleNo ?? sale.vehicleNo}`);
    if (driverName ?? sale.driverName) parts.push(`Driver ${driverName ?? sale.driverName}`);
    if (stockDeducted) parts.push('Stock deducted');
    await addEvent(tx, id, 'Dispatched', actor.name, parts.length ? parts.join(', ') : null);
  });
  return loadDetail(id);
}

// Generates (once) the invoice of a delivered machine sale and links it to the sale. It runs inside a savepoint,
// so if the invoice cannot be made the rest of the transaction still commits.
async function makeInvoice(tx: Tx, id: string, by: string): Promise<{ id: string; docNumber: string } | null> {
  try {
    const out = await tx.transaction(async (inner) => {
      const inv = await ensureMachineSaleInvoice(inner as unknown as Tx, id, by);
      await inner
        .update(machineSales)
        .set({ invoiceId: inv.id, documentNumber: inv.docNumber, updatedAt: new Date() })
        .where(eq(machineSales.id, id));
      return inv;
    });
    if (out.created) await addEvent(tx, id, 'Invoice generated', by, out.docNumber);
    return { id: out.id, docNumber: out.docNumber };
  } catch (e: any) {
    console.error('Machine sale invoice could not be generated:', e);
    await addEvent(tx, id, 'Invoice not generated', by, String(e?.message || 'unknown error').slice(0, 250));
    return null;
  }
}

// For a sale whose invoice is missing (for example if it could not be made when it was booked).
export async function generateMachineSaleInvoice(id: string, actor: Actor) {
  assertRole(actor, FLOW_ROLES, 'generate machine sale invoices');
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    requireStatus(sale, ['Booked', 'Ready for Delivery', 'Dispatched', 'Delivered'], 'generate an invoice for');
    const inv = await makeInvoice(tx, id, actor.name);
    if (!inv) throw new MachineSaleError('The invoice could not be generated. See the sale history for the reason.', 500);
  });
  return loadDetail(id);
}

export async function deliverMachineSale(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, FLOW_ROLES, 'record machine deliveries');
  const receivedByName = reqText(input.receivedByName, 'receivedByName', 150);
  const handoverNotes = optText(input.handoverNotes, 'handoverNotes', 1000);
  const deliveredDate = optDate(input.deliveredDate, 'deliveredDate') || businessDate();
  const warrantyStart = optDate(input.warrantyStart, 'warrantyStart') || deliveredDate;

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    requireStatus(sale, ['Dispatched'], 'deliver');
    const balance = Math.max(0, round2(customerPayable(sale) - (await paidOf(tx, id))));
    await tx
      .update(machineSales)
      .set({
        status: 'Delivered',
        deliveredDate,
        warrantyStart,
        receivedByName,
        handoverNotes: handoverNotes ?? sale.handoverNotes,
        updatedAt: new Date()
      })
      .where(eq(machineSales.id, id));
    await addEvent(
      tx,
      id,
      'Delivered',
      actor.name,
      `Received by ${receivedByName}${balance > 0 ? `, balance ${money(balance)} outstanding` : ''}`
    );
    // The sale is done: its invoice is generated automatically. A failure here never undoes the delivery.
    await makeInvoice(tx, id, actor.name);
  });
  return loadDetail(id);
}

// Removes a machine sale completely: its payments, history and invoice go with it, and a machine that already
// left stock is put back. For a sale that was entered by mistake; use Cancel to keep the record.
export async function deleteMachineSale(id: string, actor: Actor) {
  if (!(actor.isOwner || actor.role === 'Branch Manager')) {
    throw new MachineSaleError('Only the owner or a branch manager can delete a machine sale', 403);
  }
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.stockDeducted && sale.productId && sale.warehouseId) {
      await moveStock(tx, {
        productId: sale.productId,
        warehouseId: sale.warehouseId,
        availableDelta: 1,
        type: 'machine-sale',
        refType: 'machine-sale',
        refId: sale.id,
        note: `${sale.saleNumber} deleted, machine returned to stock`,
        user: actor.name
      });
    }
    await deleteMachineSaleInvoice(tx, id);
    await tx.delete(machineSales).where(eq(machineSales.id, id)); // payments and history go with it
  });
  return { deleted: true as const };
}

export async function cancelMachineSale(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, FLOW_ROLES, 'cancel machine sales');
  const reason = reqText(input.reason, 'reason', 500);

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.status === 'Delivered') throw new MachineSaleError('A delivered machine sale cannot be cancelled');
    requireStatus(sale, ['Booked', 'Ready for Delivery', 'Dispatched'], 'cancel');

    if (sale.stockDeducted && sale.productId && sale.warehouseId) {
      await moveStock(tx, {
        productId: sale.productId,
        warehouseId: sale.warehouseId,
        availableDelta: 1,
        type: 'machine-sale',
        refType: 'machine-sale',
        refId: sale.id,
        note: `${sale.saleNumber} cancelled, machine returned to stock`,
        user: actor.name
      });
    }
    const paid = await paidOf(tx, id);
    await tx
      .update(machineSales)
      .set({ status: 'Cancelled', cancelReason: reason, stockDeducted: false, updatedAt: new Date() })
      .where(eq(machineSales.id, id));
    await cancelMachineSaleInvoice(tx, id);
    // Refunds are not modelled; the note tells the next person money is still held.
    await addEvent(tx, id, 'Cancelled', actor.name, paid > 0 ? `${reason} (${money(paid)} received, settle refund separately)` : reason);
  });
  return loadDetail(id);
}

// Moves a government subsidy through Applied, Sanctioned and Received (or Rejected).
export async function updateSubsidy(id: string, input: Record<string, any>, actor: Actor) {
  assertRole(actor, FLOW_ROLES, 'update subsidies');
  const status = oneOf(input.status, SUBSIDY_STATUSES, 'status');
  const applicationNo = optText(input.applicationNo, 'applicationNo', 100);
  const receivedDate = optDate(input.receivedDate, 'receivedDate');
  const notes = optText(input.notes, 'notes', 300);

  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id, actor);
    if (sale.saleType !== 'subsidy') throw new MachineSaleError('This is a normal sale without a subsidy');
    if (sale.status === 'Cancelled') throw new MachineSaleError('This machine sale is cancelled');
    if (status === 'Rejected') {
      const paid = await paidOf(tx, id);
      // The customer now owes the full price; nothing to block, but make the change visible.
      void paid;
    }
    await tx
      .update(machineSales)
      .set({
        subsidyStatus: status,
        subsidyApplicationNo: applicationNo ?? sale.subsidyApplicationNo,
        subsidyReceivedDate: status === 'Received' ? receivedDate || businessDate() : null,
        updatedAt: new Date()
      })
      .where(eq(machineSales.id, id));
    await syncMachineSaleInvoice(tx, id);
    await addEvent(
      tx,
      id,
      `Subsidy ${status}`,
      actor.name,
      [sale.subsidyScheme, money(sale.subsidyAmount), notes].filter(Boolean).join(' - ')
    );
  });
  return loadDetail(id);
}
