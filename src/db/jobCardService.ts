import { and, asc, desc, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { customers, warehouses, warehouseStocks, products, warranties } from './schema.ts';
import { jobCards, jobCardParts, jobCardPayments, jobCardServices } from './schema.jobCards.ts';
import { businessDate, newId } from '../routes/context.ts';
import { StockError, applyStockDelta } from './stockService.ts';
import { getService } from './serviceCatalog.ts';

// Services on a job card live in their own small table, created on first use (and at server start).
export async function ensureJobCardServicesTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists job_card_services (
      id serial primary key,
      job_card_id text not null references job_cards(id) on delete cascade,
      service_id text,
      name text not null,
      machine_type text,
      cost double precision not null,
      created_at timestamp not null default now()
    )`);
  await db.execute(sql`create index if not exists idx_job_card_services_job on job_card_services (job_card_id)`);
}
let servicesTableReady: Promise<void> | null = null;
const ensureServices = () => (servicesTableReady ??= ensureJobCardServicesTable().catch((e) => {
  servicesTableReady = null;
  throw e;
}));

export class JobCardError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const JOB_STATUSES = ['Received', 'Diagnosing', 'Awaiting Parts', 'In Progress', 'Ready', 'Delivered', 'Cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;

const FLOW: JobStatus[] = ['Received', 'Diagnosing', 'Awaiting Parts', 'In Progress', 'Ready', 'Delivered'];
const FINAL: JobStatus[] = ['Delivered', 'Cancelled'];
const NOT_OVERDUE: JobStatus[] = ['Ready', 'Delivered', 'Cancelled'];

type JobCardRow = typeof jobCards.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function withBalance(card: JobCardRow) {
  const balance = card.isWarranty ? 0 : Math.max(0, round2(card.total - card.paidAmount));
  return { ...card, balance };
}

function assertAccess(card: JobCardRow | undefined, scope: string): JobCardRow {
  if (!card) throw new JobCardError('Job card not found', 404);
  if (scope !== 'all' && card.branchId !== scope) throw new JobCardError('Access denied for this branch', 403);
  return card;
}

async function lockCard(tx: Tx, id: string, scope: string): Promise<JobCardRow> {
  const [card] = await tx.select().from(jobCards).where(eq(jobCards.id, id)).for('update');
  return assertAccess(card, scope);
}

function assertOpen(card: JobCardRow, action: string) {
  if (FINAL.includes(card.status as JobStatus)) {
    throw new JobCardError(`Cannot ${action} a ${card.status} job card`);
  }
}

async function recomputeTotals(tx: Tx, card: JobCardRow): Promise<JobCardRow> {
  const [agg] = await tx
    .select({ sum: sql<number>`coalesce(sum(${jobCardParts.amount}), 0)` })
    .from(jobCardParts)
    .where(eq(jobCardParts.jobCardId, card.id));
  const partsTotal = round2(Number(agg?.sum ?? 0));
  const [svc] = await tx
    .select({ sum: sql<number>`coalesce(sum(${jobCardServices.cost}), 0)` })
    .from(jobCardServices)
    .where(eq(jobCardServices.jobCardId, card.id));
  const servicesTotal = round2(Number(svc?.sum ?? 0));
  const labourCharge = round2(card.labourHours * card.labourRate);
  const total = card.isWarranty ? 0 : Math.max(0, round2(labourCharge + partsTotal + servicesTotal - card.discount));
  const [updated] = await tx
    .update(jobCards)
    .set({ labourCharge, partsTotal, total, updatedAt: new Date() })
    .where(eq(jobCards.id, card.id))
    .returning();
  return updated;
}

// Stock changes go through the shared ledger helper; its errors keep the job-card error shape.
async function moveStock(tx: Tx, args: Parameters<typeof applyStockDelta>[1]) {
  try {
    return await applyStockDelta(tx, args);
  } catch (e) {
    if (e instanceof StockError) throw new JobCardError(e.message, e.status);
    throw e;
  }
}

function num(value: unknown, field: string, opts: { min?: number } = {}): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < (opts.min ?? 0)) throw new JobCardError(`${field} must be a valid non-negative number`);
  return n;
}

function optText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function optDate(value: unknown, field: string): string | null {
  const s = optText(value);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new JobCardError(`${field} must be YYYY-MM-DD`);
  return s;
}

function isUniqueViolation(e: any): boolean {
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export interface ListFilters {
  status?: string;
  q?: string;
}

export async function listJobCards(scope: string, filters: ListFilters = {}) {
  const conds = [];
  if (scope !== 'all') conds.push(eq(jobCards.branchId, scope));
  if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
    if (!(JOB_STATUSES as readonly string[]).includes(filters.status)) throw new JobCardError('Unknown status filter');
    conds.push(eq(jobCards.status, filters.status));
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conds.push(
      or(
        ilike(jobCards.jobNumber, like),
        ilike(jobCards.customerName, like),
        ilike(jobCards.customerPhone, like),
        ilike(jobCards.serialNumber, like),
        ilike(jobCards.machineModel, like)
      )!
    );
  }
  const rows = await db
    .select()
    .from(jobCards)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(jobCards.createdAt))
    .limit(500);
  return rows.map(withBalance);
}

export async function getJobCard(id: string, scope: string) {
  await ensureServices();
  const [card] = await db.select().from(jobCards).where(eq(jobCards.id, id));
  assertAccess(card, scope);
  const [parts, payments, services] = await Promise.all([
    db.select().from(jobCardParts).where(eq(jobCardParts.jobCardId, id)).orderBy(asc(jobCardParts.id)),
    db.select().from(jobCardPayments).where(eq(jobCardPayments.jobCardId, id)).orderBy(asc(jobCardPayments.id)),
    db.select().from(jobCardServices).where(eq(jobCardServices.jobCardId, id)).orderBy(asc(jobCardServices.id))
  ]);
  const servicesTotal = round2(services.reduce((s, x) => s + x.cost, 0));
  return { ...withBalance(card), parts, payments, services, servicesTotal };
}

export async function getSummary(scope: string) {
  const branchCond = scope !== 'all' ? eq(jobCards.branchId, scope) : undefined;
  const grouped = await db
    .select({ status: jobCards.status, count: sql<number>`count(*)::int` })
    .from(jobCards)
    .where(branchCond)
    .groupBy(jobCards.status);
  const counts: Record<string, number> = {};
  for (const s of JOB_STATUSES) counts[s] = 0;
  for (const g of grouped) counts[g.status] = Number(g.count);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const open = total - counts.Delivered - counts.Cancelled;

  const today = businessDate();
  const [overdueRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobCards)
    .where(
      and(
        branchCond,
        notInArray(jobCards.status, NOT_OVERDUE),
        sql`${jobCards.promisedDate} is not null and ${jobCards.promisedDate} < ${today}`
      )
    );
  return { counts, total, open, overdue: Number(overdueRow?.count ?? 0) };
}

export async function lookupSerial(serial: string) {
  const s = serial.trim();
  if (!s) throw new JobCardError('serial is required');
  const [row] = await db
    .select({
      serialNumber: warranties.serialNumber,
      productId: warranties.productId,
      productName: warranties.productName,
      customerId: warranties.customerId,
      customerName: warranties.customerName,
      customerPhone: customers.phone,
      purchaseDate: warranties.purchaseDate,
      warrantyExpiryDate: warranties.warrantyExpiryDate
    })
    .from(warranties)
    .leftJoin(customers, eq(customers.id, warranties.customerId))
    .where(sql`lower(${warranties.serialNumber}) = lower(${s})`)
    .limit(1);
  if (!row) return { found: false as const };
  return { found: true as const, ...row, inWarranty: row.warrantyExpiryDate >= businessDate() };
}

export interface NewJobCardInput {
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  machineModel?: string;
  serialNumber?: string;
  complaint?: string;
  promisedDate?: string;
  technician?: string;
  labourRate?: number | string;
  isWarranty?: boolean;
}

export async function createJobCard(input: NewJobCardInput, branchId: string, createdBy: string) {
  const customerName = optText(input.customerName);
  const complaint = optText(input.complaint);
  if (!customerName) throw new JobCardError('customerName is required');
  if (!complaint) throw new JobCardError('complaint is required');
  const labourRate = input.labourRate === undefined || input.labourRate === '' ? 0 : num(input.labourRate, 'labourRate');
  const promisedDate = optDate(input.promisedDate, 'promisedDate');
  const today = businessDate();
  const year = today.slice(0, 4);

  for (let attempt = 0; attempt < 5; attempt++) {
    const jobNumber = `JC-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      const [created] = await db
        .insert(jobCards)
        .values({
          id: newId('jc'),
          jobNumber,
          branchId,
          customerId: optText(input.customerId),
          customerName,
          customerPhone: optText(input.customerPhone),
          machineModel: optText(input.machineModel),
          serialNumber: optText(input.serialNumber),
          complaint,
          technician: optText(input.technician),
          isWarranty: !!input.isWarranty,
          labourRate,
          receivedOn: today,
          promisedDate,
          createdBy
        })
        .returning();
      return withBalance(created);
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 4) throw e;
    }
  }
  throw new JobCardError('Could not generate a unique job number, please retry', 500);
}

export async function updateJobCard(id: string, patch: Record<string, unknown>, scope: string) {
  await ensureServices();
  return db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    assertOpen(card, 'edit');
    const set: Partial<typeof jobCards.$inferInsert> = {};
    if ('diagnosis' in patch) set.diagnosis = optText(patch.diagnosis);
    if ('technician' in patch) set.technician = optText(patch.technician);
    if ('labourHours' in patch) set.labourHours = num(patch.labourHours, 'labourHours');
    if ('labourRate' in patch) set.labourRate = num(patch.labourRate, 'labourRate');
    if ('discount' in patch) set.discount = num(patch.discount, 'discount');
    if ('promisedDate' in patch) set.promisedDate = optDate(patch.promisedDate, 'promisedDate');
    if ('isWarranty' in patch) set.isWarranty = !!patch.isWarranty;
    if ('complaint' in patch) {
      const c = optText(patch.complaint);
      if (!c) throw new JobCardError('complaint cannot be empty');
      set.complaint = c;
    }
    const [updated] = await tx.update(jobCards).set(set).where(eq(jobCards.id, id)).returning();
    return withBalance(await recomputeTotals(tx, updated));
  });
}

export async function addPart(
  id: string,
  input: { productId?: string; quantity?: unknown; warehouseId?: string },
  scope: string
) {
  const quantity = Number(input.quantity);
  if (!input.productId) throw new JobCardError('productId is required');
  if (!Number.isInteger(quantity) || quantity <= 0) throw new JobCardError('quantity must be a positive whole number');
  await ensureServices();

  return db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    assertOpen(card, 'change parts on');

    const [product] = await tx.select().from(products).where(eq(products.id, input.productId!));
    if (!product) throw new JobCardError('Product not found', 404);

    const stockRows = await tx
      .select({
        id: warehouseStocks.id,
        warehouseId: warehouseStocks.warehouseId,
        available: warehouseStocks.available
      })
      .from(warehouseStocks)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStocks.warehouseId))
      .where(
        and(
          eq(warehouseStocks.productId, product.id),
          eq(warehouses.branchId, card.branchId),
          input.warehouseId ? eq(warehouseStocks.warehouseId, input.warehouseId) : undefined
        )
      )
      .orderBy(desc(warehouseStocks.available));

    if (input.warehouseId) {
      const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, input.warehouseId));
      if (!wh || wh.branchId !== card.branchId) throw new JobCardError('Warehouse does not belong to this job card branch');
    }
    const stock = stockRows[0];
    if (!stock || stock.available < quantity) {
      throw new JobCardError(
        `Insufficient stock for ${product.name}: ${stock ? stock.available : 0} available, ${quantity} requested`
      );
    }

    // Guarded decrement so concurrent jobs can never drive stock negative.
    await moveStock(tx, {
      productId: product.id,
      warehouseId: stock.warehouseId,
      availableDelta: -quantity,
      type: 'service-part',
      refType: 'job-card',
      refId: id,
      note: `Part used on ${card.jobNumber}`,
      user: card.createdBy || 'system'
    });

    await tx.insert(jobCardParts).values({
      jobCardId: id,
      productId: product.id,
      warehouseId: stock.warehouseId,
      productName: product.name,
      sku: product.sku,
      quantity,
      rate: product.sellingPrice,
      amount: round2(product.sellingPrice * quantity)
    });
    await recomputeTotals(tx, card);
  }).then(() => getJobCard(id, scope));
}

async function restoreStock(tx: Tx, part: typeof jobCardParts.$inferSelect, card: JobCardRow) {
  if (!part.productId || !part.warehouseId) return;
  await moveStock(tx, {
    productId: part.productId,
    warehouseId: part.warehouseId,
    availableDelta: part.quantity,
    type: 'service-part',
    refType: 'job-card',
    refId: part.jobCardId,
    note: `Part returned from ${card.jobNumber}`,
    user: card.createdBy || 'system'
  });
}

export async function removePart(id: string, partId: number, scope: string) {
  if (!Number.isInteger(partId)) throw new JobCardError('Invalid part id');
  await ensureServices();
  await db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    assertOpen(card, 'change parts on');
    const [part] = await tx
      .select()
      .from(jobCardParts)
      .where(and(eq(jobCardParts.id, partId), eq(jobCardParts.jobCardId, id)));
    if (!part) throw new JobCardError('Part not found on this job card', 404);
    await restoreStock(tx, part, card);
    await tx.delete(jobCardParts).where(eq(jobCardParts.id, partId));
    await recomputeTotals(tx, card);
  });
  return getJobCard(id, scope);
}

// Charge a service from the price list on the job card. The cost can be changed for this job only (a different
// amount agreed with the customer); it defaults to the listed cost.
export async function addService(id: string, input: { serviceId?: string; cost?: unknown }, scope: string) {
  if (!input.serviceId) throw new JobCardError('serviceId is required');
  await ensureServices();
  const service = await getService(input.serviceId);
  if (!service) throw new JobCardError('That service is not in the list', 404);
  if (!service.active) throw new JobCardError('That service is switched off');
  const cost = input.cost === undefined || input.cost === '' || input.cost === null ? service.cost : round2(num(input.cost, 'cost'));

  await db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    assertOpen(card, 'add a service to');
    await tx.insert(jobCardServices).values({
      jobCardId: id,
      serviceId: service.id,
      name: service.name,
      machineType: service.machineType,
      cost
    });
    await recomputeTotals(tx, card);
  });
  return getJobCard(id, scope);
}

export async function removeService(id: string, lineId: number, scope: string) {
  if (!Number.isInteger(lineId)) throw new JobCardError('Invalid service id');
  await ensureServices();
  await db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    assertOpen(card, 'remove a service from');
    const removed = await tx
      .delete(jobCardServices)
      .where(and(eq(jobCardServices.id, lineId), eq(jobCardServices.jobCardId, id)))
      .returning({ id: jobCardServices.id });
    if (!removed.length) throw new JobCardError('Service not found on this job card', 404);
    await recomputeTotals(tx, card);
  });
  return getJobCard(id, scope);
}

export async function addPayment(
  id: string,
  input: { amount?: unknown; method?: string },
  scope: string,
  receivedBy: string
) {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new JobCardError('amount must be greater than 0');
  const method = input.method || 'Cash';
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new JobCardError(`method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  await db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    if (card.status === 'Cancelled') throw new JobCardError('Cannot take payment on a Cancelled job card');
    const { balance } = withBalance(card);
    if (balance <= 0) throw new JobCardError('No balance is due on this job card');
    if (amount > balance + 0.005) throw new JobCardError(`Amount exceeds the balance of ${balance.toFixed(2)}`);
    await tx.insert(jobCardPayments).values({ jobCardId: id, amount, method, paidOn: businessDate(), receivedBy });
    await tx
      .update(jobCards)
      .set({ paidAmount: round2(card.paidAmount + amount), updatedAt: new Date() })
      .where(eq(jobCards.id, id));
  });
  return getJobCard(id, scope);
}

function transitionAllowed(from: JobStatus, to: JobStatus): boolean {
  if (FINAL.includes(from)) return false;
  if (to === 'Cancelled') return true;
  const i = FLOW.indexOf(from);
  const j = FLOW.indexOf(to);
  if (i < 0 || j < 0) return false;
  if (j === i + 1) return true;
  // Awaiting Parts is only needed when parts are missing, so it may be skipped.
  return from === 'Diagnosing' && to === 'In Progress';
}

export async function changeStatus(id: string, status: string, scope: string) {
  if (!(JOB_STATUSES as readonly string[]).includes(status)) throw new JobCardError('Unknown status');
  const next = status as JobStatus;
  await db.transaction(async (tx) => {
    const card = await lockCard(tx, id, scope);
    const from = card.status as JobStatus;
    if (!transitionAllowed(from, next)) throw new JobCardError(`Cannot move a job card from ${from} to ${next}`);

    const set: Partial<typeof jobCards.$inferInsert> = { status: next, updatedAt: new Date() };
    if (next === 'Delivered') {
      if (!card.isWarranty && withBalance(card).balance > 0) {
        throw new JobCardError('Collect the full balance before delivering this job card');
      }
      set.deliveredOn = businessDate();
    }
    if (next === 'Cancelled') {
      const parts = await tx.select().from(jobCardParts).where(eq(jobCardParts.jobCardId, id));
      for (const part of parts) await restoreStock(tx, part, card);
    }
    await tx.update(jobCards).set(set).where(eq(jobCards.id, id));
  });
  return getJobCard(id, scope);
}
