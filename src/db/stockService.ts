import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { products, suppliers, warehouses, warehouseStocks } from './schema.ts';
import {
  goodsReceiptItems,
  goodsReceipts,
  stockAdjustments,
  stockMovements,
  stockTransferEvents,
  stockTransferItems,
  stockTransferOrders
} from './schema.stock.ts';
import { businessDate } from '../routes/context.ts';

export class StockError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StockRow = typeof warehouseStocks.$inferSelect;

export const HEAD_BRANCH_ID = 'branch-1';
export const HEAD_WAREHOUSE_ID = 'wh-1';

export const MOVEMENT_TYPES = [
  'receipt',
  'transfer-out',
  'transfer-in',
  'adjustment',
  'sale',
  'service-part',
  'document-sale',
  'sale-return',
  'machine-sale',
  'branch-receipt',
  'transfer-damage',
  'transfer-short',
  'opening'
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const QUALITY_STATUSES = ['Passed', 'Partial Discrepancy', 'Rejected'] as const;
export const ADJUSTMENT_TYPES = ['Increase', 'Decrease', 'Recount'] as const;
export const TRANSFER_STATUSES = ['Requested', 'Approved', 'In Transit', 'Received', 'Cancelled'] as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const uid = (prefix: string) => `${prefix}-${randomUUID()}`;

// ---------- permissions ----------

export interface Actor {
  role: string;
  branchId: string;
  isOwner: boolean;
  name: string;
}

const HEAD_OFFICE_ROLES = ['Warehouse Manager', 'Warehouse Staff', 'Branch Manager'];
const BRANCH_STOCK_ROLES = ['Branch Manager', 'Branch Person', 'Warehouse Manager', 'Warehouse Staff'];

// Owners, plus the stock roles of the Head Office branch.
export const canManageHeadOffice = (a: Actor) => a.isOwner || (a.branchId === HEAD_BRANCH_ID && HEAD_OFFICE_ROLES.includes(a.role));
// Owners, plus the stock roles of that specific branch.
export const canActOnBranch = (a: Actor, branchId: string | null) =>
  a.isOwner || (!!branchId && a.branchId === branchId && BRANCH_STOCK_ROLES.includes(a.role));
export const canEditProducts = (a: Actor) => a.isOwner || a.role === 'Warehouse Manager';

// ---------- parsing helpers ----------

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

export function optText(v: unknown, max = 500): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new StockError(`Text is too long (maximum ${max} characters)`);
  return s;
}

function reqText(v: unknown, field: string, max = 200): string {
  const s = optText(v, max);
  if (!s) throw new StockError(`${field} is required`);
  return s;
}

function posInt(v: unknown, field: string): number {
  const n = toNum(v);
  if (!Number.isInteger(n) || n <= 0) throw new StockError(`${field} must be a positive whole number`);
  return n;
}

function nonNegInt(v: unknown, field: string): number {
  const n = toNum(v);
  if (!Number.isInteger(n) || n < 0) throw new StockError(`${field} must be a whole number of 0 or more`);
  return n;
}

function optDate(v: unknown, field: string): string | null {
  const s = optText(v, 10);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()))) {
    throw new StockError(`${field} must be YYYY-MM-DD`);
  }
  return s;
}

function isUniqueViolation(e: any): boolean {
  return e?.code === '23505' || e?.cause?.code === '23505';
}

// Numbers are sequential per year; a concurrent request can take the same one, so the whole
// transaction is retried (a unique violation aborts it, so it cannot be retried in place).
async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (attempt >= 4) throw new StockError('Could not generate a unique number, please retry', 409);
    }
  }
}

async function nextNumber(tx: Tx, prefix: 'GRN' | 'TR' | 'ADJ', table: string, column: string): Promise<string> {
  const stem = `${prefix}-${businessDate().slice(0, 4)}-`;
  const result = await tx.execute(
    sql`select coalesce(max(substring(${sql.raw(column)} from '[0-9]+$')::int), 0) as n
        from ${sql.raw(table)} where ${sql.raw(column)} like ${stem + '%'}`
  );
  const n = Number((result.rows[0] as { n: number | string }).n);
  return `${stem}${String(n + 1).padStart(4, '0')}`;
}

// ---------- the single stock mutation primitive ----------

export interface StockDeltaArgs {
  productId: string;
  warehouseId: string;
  availableDelta?: number;
  reservedDelta?: number;
  inTransitDelta?: number;
  type: MovementType;
  refType?: string;
  refId?: string;
  note?: string;
  user: string;
  // Only used when the stock row is created by this call.
  location?: { rack?: string | null; row?: string | null; shelf?: string | null; bin?: string | null };
}

async function ensureStockRow(tx: Tx, productId: string, warehouseId: string, location?: StockDeltaArgs['location']) {
  await tx
    .insert(warehouseStocks)
    .values({
      productId,
      warehouseId,
      rack: location?.rack ?? null,
      row: location?.row ?? null,
      shelf: location?.shelf ?? null,
      bin: location?.bin ?? null
    })
    .onConflictDoUpdate({
      target: [warehouseStocks.productId, warehouseStocks.warehouseId],
      set: { updatedAt: new Date() }
    });
}

// Every stock change goes through here: guarded update plus one ledger row, in the caller's transaction.
export async function applyStockDelta(tx: Tx, a: StockDeltaArgs): Promise<StockRow & { balanceAfter: number }> {
  const dA = a.availableDelta ?? 0;
  const dR = a.reservedDelta ?? 0;
  const dT = a.inTransitDelta ?? 0;
  if (![dA, dR, dT].every(Number.isInteger)) throw new StockError('Stock quantities must be whole numbers');
  if (dA === 0 && dR === 0 && dT === 0) throw new StockError('No stock change requested');

  const [wh] = await tx.select({ branchId: warehouses.branchId }).from(warehouses).where(eq(warehouses.id, a.warehouseId));
  if (!wh) throw new StockError('Warehouse not found', 404);
  const [prod] = await tx.select({ name: products.name }).from(products).where(eq(products.id, a.productId));
  if (!prod) throw new StockError('Product not found', 404);

  await ensureStockRow(tx, a.productId, a.warehouseId, a.location);

  const guards = [eq(warehouseStocks.productId, a.productId), eq(warehouseStocks.warehouseId, a.warehouseId)];
  if (dA < 0) guards.push(sql`${warehouseStocks.available} + ${dA} >= 0`);
  if (dR < 0) guards.push(sql`${warehouseStocks.reserved} + ${dR} >= 0`);
  if (dT < 0) guards.push(sql`${warehouseStocks.inTransit} + ${dT} >= 0`);

  const [row] = await tx
    .update(warehouseStocks)
    .set({
      available: sql`${warehouseStocks.available} + ${dA}`,
      reserved: sql`${warehouseStocks.reserved} + ${dR}`,
      inTransit: sql`${warehouseStocks.inTransit} + ${dT}`,
      updatedAt: new Date()
    })
    .where(and(...guards))
    .returning();

  if (!row) {
    const [cur] = await tx
      .select()
      .from(warehouseStocks)
      .where(and(eq(warehouseStocks.productId, a.productId), eq(warehouseStocks.warehouseId, a.warehouseId)));
    if (cur && dA < 0 && cur.available + dA < 0) {
      throw new StockError(`Insufficient stock for ${prod.name}: ${cur.available} available, ${-dA} requested`, 409);
    }
    if (cur && dT < 0 && cur.inTransit + dT < 0) {
      throw new StockError(`Insufficient stock for ${prod.name}: ${cur.inTransit} in transit, ${-dT} requested`, 409);
    }
    if (cur && dR < 0 && cur.reserved + dR < 0) {
      throw new StockError(`Insufficient stock for ${prod.name}: ${cur.reserved} reserved, ${-dR} requested`, 409);
    }
    throw new StockError(`Stock for ${prod.name} changed, please retry`, 409);
  }

  await tx.insert(stockMovements).values({
    id: uid('mov'),
    productId: a.productId,
    warehouseId: a.warehouseId,
    branchId: wh.branchId,
    type: a.type,
    availableDelta: dA,
    reservedDelta: dR,
    inTransitDelta: dT,
    balanceAfter: row.available,
    refType: a.refType ?? null,
    refId: a.refId ?? null,
    note: a.note ?? null,
    createdBy: a.user,
    createdAt: new Date()
  });

  return { ...row, balanceAfter: row.available };
}

// ---------- goods receipts ----------

type ReceiptRow = typeof goodsReceipts.$inferSelect;
type ReceiptItemRow = typeof goodsReceiptItems.$inferSelect;

function presentReceipt(r: ReceiptRow, items: ReceiptItemRow[]) {
  return {
    id: r.id,
    grnNumber: r.grnNumber,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierInvoiceNumber: r.supplierInvoiceNumber ?? undefined,
    warehouseId: r.warehouseId,
    receivedDate: r.receivedDate,
    receivedBy: r.receivedBy,
    challanNumber: r.challanNumber,
    items: items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      receivedQuantity: i.receivedQuantity,
      damagedQuantity: i.damagedQuantity,
      acceptedQuantity: i.acceptedQuantity,
      rate: i.rate,
      notes: i.notes ?? undefined
    })),
    verifiedBy: r.verifiedBy,
    qualityStatus: r.qualityStatus,
    notes: r.notes ?? undefined,
    isStockUpdated: true
  };
}

export async function createReceipt(input: Record<string, any>, actor: Actor) {
  if (!canManageHeadOffice(actor)) throw new StockError('Only Head Office stock staff can record goods received', 403);

  const supplierId = reqText(input.supplierId, 'supplierId');
  const challanNumber = reqText(input.challanNumber, 'challanNumber', 100);
  const receivedBy = reqText(input.receivedBy, 'receivedBy', 100);
  const verifiedBy = reqText(input.verifiedBy, 'verifiedBy', 100);
  const supplierInvoiceNumber = optText(input.supplierInvoiceNumber, 100);
  const notes = optText(input.notes, 1000);
  const receivedDate = optDate(input.receivedDate, 'receivedDate') || businessDate();
  const qualityStatus = String(input.qualityStatus ?? '');
  if (!(QUALITY_STATUSES as readonly string[]).includes(qualityStatus)) {
    throw new StockError(`qualityStatus must be one of ${QUALITY_STATUSES.join(', ')}`);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) throw new StockError('Add at least one item');
  if (input.items.length > 200) throw new StockError('A receipt can have at most 200 items');
  const lines = input.items.map((raw: any, i: number) => {
    const n = i + 1;
    const productId = reqText(raw?.productId, `Item ${n}: productId`);
    const receivedQuantity = posInt(raw?.receivedQuantity, `Item ${n}: receivedQuantity`);
    const damagedQuantity =
      raw?.damagedQuantity === undefined || raw?.damagedQuantity === '' ? 0 : nonNegInt(raw.damagedQuantity, `Item ${n}: damagedQuantity`);
    if (damagedQuantity > receivedQuantity) throw new StockError(`Item ${n}: damaged quantity cannot exceed the received quantity`);
    const rate = raw?.rate === undefined || raw?.rate === null || raw?.rate === '' ? null : toNum(raw.rate);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new StockError(`Item ${n}: rate must be 0 or more`);
    return { productId, receivedQuantity, damagedQuantity, rate, notes: optText(raw?.notes, 500) };
  });

  const id = await withNumberRetry(() =>
    db.transaction(async (tx) => {
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId));
      if (!supplier) throw new StockError('Supplier not found', 404);

      const productRows = await tx
        .select()
        .from(products)
        .where(inArray(products.id, [...new Set(lines.map((l: { productId: string }) => l.productId))]));
      const byId = new Map(productRows.map((p) => [p.id, p]));
      for (const l of lines) if (!byId.has(l.productId)) throw new StockError(`Product not found: ${l.productId}`, 404);

      const grnNumber = await nextNumber(tx, 'GRN', 'goods_receipts', 'grn_number');
      const receiptId = uid('grn');
      await tx.insert(goodsReceipts).values({
        id: receiptId,
        grnNumber,
        supplierId,
        supplierName: supplier.companyName,
        supplierInvoiceNumber,
        challanNumber,
        warehouseId: HEAD_WAREHOUSE_ID,
        receivedDate,
        receivedBy,
        verifiedBy,
        qualityStatus,
        notes
      });

      let payable = 0;
      const resolved = lines.map((l: (typeof lines)[number]) => {
        const p = byId.get(l.productId)!;
        const acceptedQuantity = l.receivedQuantity - l.damagedQuantity;
        const rate = l.rate ?? p.purchasePrice;
        payable += acceptedQuantity * rate;
        return { ...l, p, acceptedQuantity, rate };
      });
      await tx.insert(goodsReceiptItems).values(
        resolved.map((r: (typeof resolved)[number]) => ({
          receiptId,
          productId: r.productId,
          productName: r.p.name,
          sku: r.p.sku,
          unit: r.p.unit,
          receivedQuantity: r.receivedQuantity,
          damagedQuantity: r.damagedQuantity,
          acceptedQuantity: r.acceptedQuantity,
          rate: r.rate,
          notes: r.notes
        }))
      );

      // Sorted so concurrent receipts lock stock rows in the same order.
      for (const r of [...resolved].sort((a: { productId: string }, b: { productId: string }) => a.productId.localeCompare(b.productId))) {
        if (r.acceptedQuantity <= 0) continue;
        await applyStockDelta(tx, {
          productId: r.productId,
          warehouseId: HEAD_WAREHOUSE_ID,
          availableDelta: r.acceptedQuantity,
          type: 'receipt',
          refType: 'goods-receipt',
          refId: receiptId,
          note: `${grnNumber} from ${supplier.companyName}`,
          user: actor.name
        });
      }

      payable = round2(payable);
      if (payable > 0) {
        await tx
          .update(suppliers)
          .set({ outstandingPayable: sql`${suppliers.outstandingPayable} + ${payable}` })
          .where(eq(suppliers.id, supplierId));
      }
      return receiptId;
    })
  );
  return getReceipt(id);
}

async function getReceipt(id: string) {
  const [r] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
  if (!r) throw new StockError('Receipt not found', 404);
  const items = await db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.receiptId, id)).orderBy(asc(goodsReceiptItems.id));
  return presentReceipt(r, items);
}

export async function listReceipts(scope: string, filters: { q?: string; from?: string; to?: string }) {
  // Receipts only ever happen at the Head Office.
  if (scope !== 'all' && scope !== HEAD_BRANCH_ID) return [];
  const conds = [];
  const from = optDate(filters.from, 'from');
  const to = optDate(filters.to, 'to');
  if (from) conds.push(gte(goodsReceipts.receivedDate, from));
  if (to) conds.push(lte(goodsReceipts.receivedDate, to));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conds.push(
      or(
        ilike(goodsReceipts.grnNumber, like),
        ilike(goodsReceipts.supplierName, like),
        ilike(goodsReceipts.challanNumber, like),
        ilike(goodsReceipts.supplierInvoiceNumber, like)
      )!
    );
  }
  const rows = await db
    .select()
    .from(goodsReceipts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(goodsReceipts.createdAt))
    .limit(500);
  if (rows.length === 0) return [];
  const items = await db
    .select()
    .from(goodsReceiptItems)
    .where(inArray(goodsReceiptItems.receiptId, rows.map((r) => r.id)))
    .orderBy(asc(goodsReceiptItems.id));
  return rows.map((r) =>
    presentReceipt(
      r,
      items.filter((i) => i.receiptId === r.id)
    )
  );
}

// ---------- transfers ----------

type TransferRow = typeof stockTransferOrders.$inferSelect;
type TransferItemRow = typeof stockTransferItems.$inferSelect;
type TransferEventRow = typeof stockTransferEvents.$inferSelect;

function presentTransfer(t: TransferRow, items: TransferItemRow[], events: TransferEventRow[]) {
  return {
    id: t.id,
    transferNumber: t.transferNumber,
    fromBranchId: t.fromBranchId,
    fromWarehouseId: t.fromWarehouseId,
    toBranchId: t.toBranchId,
    toWarehouseId: t.toWarehouseId,
    requestedBy: t.requestedBy,
    approvedBy: t.approvedBy ?? undefined,
    dispatchedBy: t.dispatchedBy ?? undefined,
    receivedBy: t.receivedBy ?? undefined,
    requestDate: t.requestDate,
    dispatchDate: t.dispatchDate ?? undefined,
    receivedDate: t.receivedDate ?? undefined,
    vehicleNumber: t.vehicleNumber ?? undefined,
    driverName: t.driverName ?? undefined,
    driverPhone: t.driverPhone ?? undefined,
    items: items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      requestedQty: i.requestedQty,
      dispatchedQty: i.dispatchedQty,
      receivedQty: i.receivedQty,
      damagedQty: i.damagedQty,
      shortQty: i.shortQty,
      unitCost: i.unitCost
    })),
    status: t.status,
    notes: t.notes ?? undefined,
    timeline: events.map((e) => ({ stage: e.stage, date: e.date.toISOString(), user: e.user, notes: e.notes ?? undefined }))
  };
}

async function hydrateTransfers(rows: TransferRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, events] = await Promise.all([
    db.select().from(stockTransferItems).where(inArray(stockTransferItems.transferId, ids)).orderBy(asc(stockTransferItems.id)),
    db.select().from(stockTransferEvents).where(inArray(stockTransferEvents.transferId, ids)).orderBy(asc(stockTransferEvents.id))
  ]);
  return rows.map((r) =>
    presentTransfer(
      r,
      items.filter((i) => i.transferId === r.id),
      events.filter((e) => e.transferId === r.id)
    )
  );
}

export async function getTransfer(id: string, scope = 'all') {
  const [row] = await db.select().from(stockTransferOrders).where(eq(stockTransferOrders.id, id));
  if (!row) throw new StockError('Transfer not found', 404);
  if (scope !== 'all' && row.fromBranchId !== scope && row.toBranchId !== scope) {
    throw new StockError('Access denied for this branch', 403);
  }
  return (await hydrateTransfers([row]))[0];
}

export async function listTransfers(scope: string, filters: { status?: string }) {
  const conds = [];
  if (scope !== 'all') conds.push(or(eq(stockTransferOrders.fromBranchId, scope), eq(stockTransferOrders.toBranchId, scope))!);
  const status = filters.status?.trim();
  if (status && status.toLowerCase() !== 'all') {
    if (!(TRANSFER_STATUSES as readonly string[]).includes(status)) throw new StockError('Unknown status filter');
    conds.push(eq(stockTransferOrders.status, status));
  }
  const rows = await db
    .select()
    .from(stockTransferOrders)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockTransferOrders.createdAt))
    .limit(500);
  return hydrateTransfers(rows);
}

async function addEvent(tx: Tx, transferId: string, stage: string, user: string, notes?: string | null) {
  await tx.insert(stockTransferEvents).values({ transferId, stage, user, notes: notes ?? null, date: new Date() });
}

async function lockTransfer(tx: Tx, id: string): Promise<TransferRow> {
  const [t] = await tx.select().from(stockTransferOrders).where(eq(stockTransferOrders.id, id)).for('update');
  if (!t) throw new StockError('Transfer not found', 404);
  return t;
}

function requireStatus(t: TransferRow, expected: string, action: string) {
  if (t.status !== expected) throw new StockError(`Only ${expected} transfers can be ${action} (this one is ${t.status})`, 409);
}

const byProduct = <T extends { productId: string }>(rows: T[]) => [...rows].sort((a, b) => a.productId.localeCompare(b.productId));

export async function createTransfer(input: Record<string, any>, actor: Actor) {
  const toBranchId = reqText(input.toBranchId, 'toBranchId', 100);
  if (toBranchId === HEAD_BRANCH_ID) throw new StockError('Destination must be a different branch from the Head Office');
  if (!canActOnBranch(actor, toBranchId)) throw new StockError('You cannot request stock for this branch', 403);
  const notes = optText(input.notes, 1000);

  if (!Array.isArray(input.items) || input.items.length === 0) throw new StockError('Add at least one item');
  if (input.items.length > 200) throw new StockError('A transfer can have at most 200 items');
  const wanted = new Map<string, number>();
  input.items.forEach((raw: any, i: number) => {
    const productId = reqText(raw?.productId, `Item ${i + 1}: productId`);
    wanted.set(productId, (wanted.get(productId) ?? 0) + posInt(raw?.requestedQty, `Item ${i + 1}: requestedQty`));
  });

  const id = await withNumberRetry(() =>
    db.transaction(async (tx) => {
      const destWarehouses = await tx.select().from(warehouses).where(eq(warehouses.branchId, toBranchId)).orderBy(asc(warehouses.id));
      if (destWarehouses.length === 0) throw new StockError('Destination branch has no warehouse', 400);
      const requestedWh = optText(input.toWarehouseId, 100);
      const toWarehouse = requestedWh ? destWarehouses.find((w) => w.id === requestedWh) : destWarehouses[0];
      if (!toWarehouse) throw new StockError('Warehouse does not belong to the destination branch');

      const productRows = await tx.select().from(products).where(inArray(products.id, [...wanted.keys()]));
      const byId = new Map(productRows.map((p) => [p.id, p]));
      for (const productId of wanted.keys()) if (!byId.has(productId)) throw new StockError(`Product not found: ${productId}`, 404);

      const transferNumber = await nextNumber(tx, 'TR', 'stock_transfer_orders', 'transfer_number');
      const transferId = uid('tr');
      await tx.insert(stockTransferOrders).values({
        id: transferId,
        transferNumber,
        fromBranchId: HEAD_BRANCH_ID,
        fromWarehouseId: HEAD_WAREHOUSE_ID,
        toBranchId,
        toWarehouseId: toWarehouse.id,
        status: 'Requested',
        requestedBy: actor.name,
        requestDate: businessDate(),
        notes
      });
      await tx.insert(stockTransferItems).values(
        [...wanted.entries()].map(([productId, requestedQty]) => {
          const p = byId.get(productId)!;
          return { transferId, productId, productName: p.name, sku: p.sku, unit: p.unit, requestedQty, unitCost: p.purchasePrice };
        })
      );
      await addEvent(tx, transferId, 'Requested', actor.name, notes);
      return transferId;
    })
  );
  return getTransfer(id);
}

export async function approveTransfer(id: string, actor: Actor) {
  if (!canManageHeadOffice(actor)) throw new StockError('Only Head Office stock staff can approve transfers', 403);
  await db.transaction(async (tx) => {
    const t = await lockTransfer(tx, id);
    requireStatus(t, 'Requested', 'approved');
    await tx.update(stockTransferOrders).set({ status: 'Approved', approvedBy: actor.name }).where(eq(stockTransferOrders.id, id));
    await addEvent(tx, id, 'Approved', actor.name);
  });
  return getTransfer(id);
}

export async function dispatchTransfer(id: string, input: Record<string, any>, actor: Actor) {
  if (!canManageHeadOffice(actor)) throw new StockError('Only Head Office stock staff can dispatch transfers', 403);
  const vehicleNumber = optText(input.vehicleNumber, 30)?.toUpperCase() ?? null;
  const driverName = optText(input.driverName, 100);
  const driverPhone = optText(input.driverPhone, 30);

  await db.transaction(async (tx) => {
    const t = await lockTransfer(tx, id);
    requireStatus(t, 'Approved', 'dispatched');
    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));

    for (const it of byProduct(items)) {
      const common = { productId: it.productId, refType: 'transfer', refId: id, user: actor.name };
      await applyStockDelta(tx, {
        ...common,
        warehouseId: t.fromWarehouseId,
        availableDelta: -it.requestedQty,
        type: 'transfer-out',
        note: `${t.transferNumber} to ${t.toWarehouseId}`
      });
      await applyStockDelta(tx, {
        ...common,
        warehouseId: t.toWarehouseId,
        inTransitDelta: it.requestedQty,
        type: 'transfer-in',
        note: `${t.transferNumber} dispatched, in transit`
      });
      await tx.update(stockTransferItems).set({ dispatchedQty: it.requestedQty }).where(eq(stockTransferItems.id, it.id));
    }

    await tx
      .update(stockTransferOrders)
      .set({ status: 'In Transit', dispatchedBy: actor.name, dispatchDate: businessDate(), vehicleNumber, driverName, driverPhone })
      .where(eq(stockTransferOrders.id, id));
    await addEvent(tx, id, 'In Transit', actor.name, vehicleNumber ? `Vehicle ${vehicleNumber}` : null);
  });
  return getTransfer(id);
}

export async function receiveTransfer(id: string, input: Record<string, any>, actor: Actor) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new StockError('items are required');

  await db.transaction(async (tx) => {
    const t = await lockTransfer(tx, id);
    if (!canActOnBranch(actor, t.toBranchId)) throw new StockError('Only the receiving branch can receive this transfer', 403);
    requireStatus(t, 'In Transit', 'received');
    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));

    const given = new Map<string, { receivedQty: number; damagedQty: number }>();
    input.items.forEach((raw: any, i: number) => {
      const productId = reqText(raw?.productId, `Item ${i + 1}: productId`);
      if (!items.some((it) => it.productId === productId)) throw new StockError(`Product ${productId} is not on this transfer`);
      if (given.has(productId)) throw new StockError(`Product ${productId} is listed more than once`);
      const receivedQty = nonNegInt(raw?.receivedQty, `Item ${i + 1}: receivedQty`);
      const damagedQty = raw?.damagedQty === undefined || raw?.damagedQty === '' ? 0 : nonNegInt(raw.damagedQty, `Item ${i + 1}: damagedQty`);
      given.set(productId, { receivedQty, damagedQty });
    });

    let totalDamaged = 0;
    let totalShort = 0;
    for (const it of byProduct(items)) {
      const g = given.get(it.productId);
      if (!g) throw new StockError(`Missing received quantity for ${it.productName}`);
      if (g.receivedQty + g.damagedQty > it.dispatchedQty) {
        throw new StockError(`Received plus damaged for ${it.productName} exceeds the dispatched quantity of ${it.dispatchedQty}`);
      }
      const shortQty = it.dispatchedQty - g.receivedQty - g.damagedQty;
      totalDamaged += g.damagedQty;
      totalShort += shortQty;

      const common = { productId: it.productId, warehouseId: t.toWarehouseId, refType: 'transfer', refId: id, user: actor.name };
      if (g.receivedQty > 0) {
        await applyStockDelta(tx, {
          ...common,
          availableDelta: g.receivedQty,
          inTransitDelta: -g.receivedQty,
          type: 'transfer-in',
          note: `${t.transferNumber} received`
        });
      }
      if (g.damagedQty > 0) {
        await applyStockDelta(tx, {
          ...common,
          inTransitDelta: -g.damagedQty,
          type: 'transfer-damage',
          note: `${t.transferNumber} damaged in transit`
        });
      }
      if (shortQty > 0) {
        await applyStockDelta(tx, {
          ...common,
          inTransitDelta: -shortQty,
          type: 'transfer-short',
          note: `${t.transferNumber} short received`
        });
      }
      await tx
        .update(stockTransferItems)
        .set({ receivedQty: g.receivedQty, damagedQty: g.damagedQty, shortQty })
        .where(eq(stockTransferItems.id, it.id));
    }

    await tx
      .update(stockTransferOrders)
      .set({ status: 'Received', receivedBy: actor.name, receivedDate: businessDate() })
      .where(eq(stockTransferOrders.id, id));
    const parts = [];
    if (totalDamaged > 0) parts.push(`${totalDamaged} damaged`);
    if (totalShort > 0) parts.push(`${totalShort} short`);
    await addEvent(tx, id, 'Received', actor.name, parts.length ? parts.join(', ') : null);
  });
  return getTransfer(id);
}

export async function cancelTransfer(id: string, actor: Actor) {
  await db.transaction(async (tx) => {
    const t = await lockTransfer(tx, id);
    if (!canManageHeadOffice(actor) && !canActOnBranch(actor, t.toBranchId)) {
      throw new StockError('You cannot cancel this transfer', 403);
    }
    if (t.status !== 'Requested' && t.status !== 'Approved') {
      throw new StockError(`Only Requested or Approved transfers can be cancelled (this one is ${t.status})`, 409);
    }
    await tx.update(stockTransferOrders).set({ status: 'Cancelled' }).where(eq(stockTransferOrders.id, id));
    await addEvent(tx, id, 'Cancelled', actor.name);
  });
  return getTransfer(id);
}

// ---------- adjustments ----------

type AdjustmentRow = typeof stockAdjustments.$inferSelect;

function presentAdjustment(a: AdjustmentRow) {
  return {
    id: a.id,
    adjustmentNumber: a.adjustmentNumber,
    warehouseId: a.warehouseId,
    productId: a.productId,
    productName: a.productName,
    sku: a.sku,
    unit: a.unit,
    adjustmentType: a.adjustmentType,
    oldStock: a.oldStock,
    adjustedQty: a.adjustedQty,
    newStock: a.newStock,
    unitCost: a.unitCost,
    totalCostImpact: a.totalCostImpact,
    reason: a.reason,
    adjustedBy: a.adjustedBy,
    date: a.date
  };
}

export async function createAdjustment(input: Record<string, any>, actor: Actor) {
  const warehouseId = reqText(input.warehouseId, 'warehouseId', 100);
  const productId = reqText(input.productId, 'productId', 100);
  const type = String(input.adjustmentType ?? '');
  if (!(ADJUSTMENT_TYPES as readonly string[]).includes(type)) {
    throw new StockError(`adjustmentType must be one of ${ADJUSTMENT_TYPES.join(', ')}`);
  }
  const quantity = type === 'Recount' ? nonNegInt(input.quantity, 'quantity') : posInt(input.quantity, 'quantity');
  const reason = reqText(input.reason, 'reason', 500);

  const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!wh) throw new StockError('Warehouse not found', 404);
  if (!canActOnBranch(actor, wh.branchId)) throw new StockError('You cannot adjust stock for this warehouse', 403);

  const id = await withNumberRetry(() =>
    db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, productId));
      if (!product) throw new StockError('Product not found', 404);

      await ensureStockRow(tx, productId, warehouseId);
      const [current] = await tx
        .select({ available: warehouseStocks.available })
        .from(warehouseStocks)
        .where(and(eq(warehouseStocks.productId, productId), eq(warehouseStocks.warehouseId, warehouseId)))
        .for('update');
      const oldStock = current.available;
      const delta = type === 'Increase' ? quantity : type === 'Decrease' ? -quantity : quantity - oldStock;

      const adjustmentNumber = await nextNumber(tx, 'ADJ', 'stock_adjustments', 'adjustment_number');
      const adjustmentId = uid('adj');
      if (delta !== 0) {
        await applyStockDelta(tx, {
          productId,
          warehouseId,
          availableDelta: delta,
          type: 'adjustment',
          refType: 'adjustment',
          refId: adjustmentId,
          note: `${adjustmentNumber} ${type}: ${reason}`,
          user: actor.name
        });
      }
      await tx.insert(stockAdjustments).values({
        id: adjustmentId,
        adjustmentNumber,
        warehouseId,
        productId,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        adjustmentType: type,
        oldStock,
        adjustedQty: delta,
        newStock: oldStock + delta,
        unitCost: product.purchasePrice,
        totalCostImpact: round2(delta * product.purchasePrice),
        reason,
        adjustedBy: actor.name,
        date: businessDate()
      });
      return adjustmentId;
    })
  );
  const [row] = await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
  return presentAdjustment(row);
}

// Many products of one warehouse in one request. Each product is saved on its own, so one bad row never
// blocks the others; the answer lists what was saved and what was refused, with the reason.
export async function createAdjustmentsBatch(input: Record<string, any>, actor: Actor) {
  const warehouseId = reqText(input.warehouseId, 'warehouseId', 100);
  const reason = reqText(input.reason, 'reason', 500);
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw new StockError('Add at least one product');
  if (items.length > 500) throw new StockError('Update at most 500 products at a time');

  const done: string[] = [];
  const failed: { productId: string; error: string }[] = [];
  for (const it of items) {
    const productId = String(it?.productId ?? '');
    try {
      await createAdjustment({ warehouseId, reason, productId, adjustmentType: it?.adjustmentType, quantity: it?.quantity }, actor);
      done.push(productId);
    } catch (e: any) {
      failed.push({ productId, error: e instanceof StockError ? e.message : 'Could not update this product' });
    }
  }
  return { done, failed };
}

export async function listAdjustments(scope: string, filters: { warehouseId?: string; productId?: string }) {
  const conds = [];
  if (scope !== 'all') conds.push(eq(warehouses.branchId, scope));
  if (filters.warehouseId) conds.push(eq(stockAdjustments.warehouseId, filters.warehouseId));
  if (filters.productId) conds.push(eq(stockAdjustments.productId, filters.productId));
  const rows = await db
    .select({ a: stockAdjustments })
    .from(stockAdjustments)
    .innerJoin(warehouses, eq(warehouses.id, stockAdjustments.warehouseId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(500);
  return rows.map((r) => presentAdjustment(r.a));
}

// ---------- ledger ----------

export async function listMovements(
  scope: string,
  filters: { productId?: string; warehouseId?: string; from?: string; to?: string; limit?: unknown }
) {
  const conds = [];
  if (scope !== 'all') conds.push(eq(stockMovements.branchId, scope));
  if (filters.productId) conds.push(eq(stockMovements.productId, filters.productId));
  if (filters.warehouseId) conds.push(eq(stockMovements.warehouseId, filters.warehouseId));
  const from = optDate(filters.from, 'from');
  const to = optDate(filters.to, 'to');
  if (from) conds.push(gte(stockMovements.createdAt, new Date(`${from}T00:00:00+05:30`)));
  if (to) conds.push(lte(stockMovements.createdAt, new Date(`${to}T23:59:59.999+05:30`)));
  const requested = filters.limit === undefined || filters.limit === '' ? 100 : toNum(filters.limit);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 100;

  const rows = await db
    .select({ m: stockMovements, productName: products.name })
    .from(stockMovements)
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
  return rows.map(({ m, productName }) => ({
    id: m.id,
    productId: m.productId,
    productName: productName ?? m.productId,
    warehouseId: m.warehouseId,
    branchId: m.branchId ?? '',
    type: m.type,
    availableDelta: m.availableDelta,
    reservedDelta: m.reservedDelta,
    inTransitDelta: m.inTransitDelta,
    balanceAfter: m.balanceAfter,
    refType: m.refType ?? '',
    refId: m.refId ?? '',
    note: m.note ?? '',
    createdBy: m.createdBy ?? '',
    createdAt: m.createdAt.toISOString()
  }));
}

// ---------- opening stock CSV import ----------

export interface OpeningRowResult {
  rowNumber: number;
  sku: string;
  productName?: string;
  warehouseId?: string;
  current?: number;
  next?: number;
  error?: string;
}

// Changes stock for many products by SKU from a CSV. 'set' makes the on-hand quantity equal the CSV value
// (safe to re-run), 'add' adds the CSV value on top, 'remove' takes it off. Nothing is applied unless every
// row is valid. kind 'opening' is the first load of quantities; kind 'update' is a stock correction that needs
// a reason and is recorded as stock adjustments, with the same permissions as adjusting stock one by one.
export async function importOpeningStock(input: Record<string, any>, actor: Actor) {
  const mode: 'set' | 'add' | 'remove' = input.mode === 'add' ? 'add' : input.mode === 'remove' ? 'remove' : 'set';
  const dryRun = input.dryRun === true;
  const kind: 'opening' | 'update' = input.kind === 'update' ? 'update' : 'opening';
  const reason =
    kind === 'update' ? (dryRun ? optText(input.reason, 500) || 'Stock update' : reqText(input.reason, 'reason', 500)) : '';
  const rows: any[] = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new StockError('No rows to import');
  if (rows.length > 5000) throw new StockError('Import at most 5000 rows at a time');

  const allProducts = await db.select({ id: products.id, sku: products.sku, name: products.name }).from(products);
  const bySku = new Map(allProducts.map((p) => [p.sku.trim().toLowerCase(), p]));
  const allWarehouses = await db.select({ id: warehouses.id, name: warehouses.name, branchId: warehouses.branchId }).from(warehouses);
  const whByKey = new Map<string, (typeof allWarehouses)[number]>();
  for (const w of allWarehouses) {
    whByKey.set(w.id.toLowerCase(), w);
    whByKey.set(w.name.trim().toLowerCase(), w);
  }

  // A row without a warehouse goes to the Head Office, or to the user's own branch for a branch stock user.
  const ownBranchWh = allWarehouses.find((w) => w.branchId === actor.branchId);
  const defaultWarehouseId = kind === 'update' && !actor.isOwner && ownBranchWh ? ownBranchWh.id : HEAD_WAREHOUSE_ID;

  const results: OpeningRowResult[] = [];
  const seen = new Set<string>();
  const planned: { productId: string; warehouseId: string; qty: number; location: Record<string, string | null>; idx: number }[] = [];

  rows.forEach((raw, i) => {
    const rowNumber = i + 1;
    const sku = String(raw?.sku ?? '').trim();
    const res: OpeningRowResult = { rowNumber, sku };
    results.push(res);
    if (!sku) return void (res.error = 'SKU is required');
    const product = bySku.get(sku.toLowerCase());
    if (!product) return void (res.error = 'SKU not found in Inventory (add the product first)');
    res.productName = product.name;

    const qty = toNum(raw?.quantity);
    if (!Number.isInteger(qty) || qty < 0) return void (res.error = 'Quantity must be a whole number, 0 or more');

    const whKey = String(raw?.warehouse ?? '').trim().toLowerCase();
    const wh = whKey ? whByKey.get(whKey) : whByKey.get(defaultWarehouseId);
    if (!wh) return void (res.error = `Warehouse "${raw?.warehouse}" not found`);
    res.warehouseId = wh.id;
    if (kind === 'update') {
      if (!canActOnBranch(actor, wh.branchId)) return void (res.error = 'You cannot update stock for this warehouse');
    } else {
      if (wh.id !== HEAD_WAREHOUSE_ID && !actor.isOwner) return void (res.error = 'Only the owner can load stock outside the Head Office');
      if (wh.id === HEAD_WAREHOUSE_ID && !canManageHeadOffice(actor)) return void (res.error = 'You cannot load Head Office stock');
    }

    const key = `${product.id}|${wh.id}`;
    if (seen.has(key)) return void (res.error = 'Duplicate SKU for this warehouse in the file');
    seen.add(key);
    planned.push({
      productId: product.id,
      warehouseId: wh.id,
      qty,
      location: {
        rack: optText(raw?.rack, 40),
        row: optText(raw?.row, 40),
        shelf: optText(raw?.shelf, 40),
        bin: optText(raw?.bin, 40)
      },
      idx: i
    });
  });

  let errors = results.filter((r) => r.error).length;
  const current = new Map<string, number>();
  if (planned.length) {
    const stocks = await db
      .select({ productId: warehouseStocks.productId, warehouseId: warehouseStocks.warehouseId, available: warehouseStocks.available })
      .from(warehouseStocks)
      .where(inArray(warehouseStocks.productId, planned.map((p) => p.productId)));
    for (const s of stocks) current.set(`${s.productId}|${s.warehouseId}`, s.available);
  }
  for (const p of planned) {
    const cur = current.get(`${p.productId}|${p.warehouseId}`) ?? 0;
    results[p.idx].current = cur;
    const next = mode === 'add' ? cur + p.qty : mode === 'remove' ? cur - p.qty : p.qty;
    results[p.idx].next = next;
    if (next < 0) results[p.idx].error = `Cannot go below 0 (now ${cur})`;
  }
  errors = results.filter((r) => r.error).length;

  if (dryRun || errors > 0) {
    return { applied: false, mode, total: rows.length, errors, changed: 0, rows: results };
  }

  let changed = 0;
  const productRows =
    kind === 'update'
      ? await db
          .select({ id: products.id, name: products.name, sku: products.sku, unit: products.unit, purchasePrice: products.purchasePrice })
          .from(products)
          .where(inArray(products.id, planned.map((p) => p.productId)))
      : [];
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const adjustmentType = mode === 'add' ? 'Increase' : mode === 'remove' ? 'Decrease' : 'Recount';

  await withNumberRetry(() =>
    db.transaction(async (tx) => {
      changed = 0;
      for (const p of [...planned].sort((a, b) => `${a.warehouseId}${a.productId}`.localeCompare(`${b.warehouseId}${b.productId}`))) {
        const cur = current.get(`${p.productId}|${p.warehouseId}`) ?? 0;
        const delta = mode === 'add' ? p.qty : mode === 'remove' ? -p.qty : p.qty - cur;
        if (delta === 0) continue;

        if (kind === 'opening') {
          await applyStockDelta(tx, {
            productId: p.productId,
            warehouseId: p.warehouseId,
            availableDelta: delta,
            type: 'opening',
            refType: 'opening-import',
            refId: 'csv',
            note: mode === 'add' ? 'Opening stock (added)' : 'Opening stock (set)',
            user: actor.name,
            location: p.location
          });
        } else {
          const product = productById.get(p.productId);
          const adjustmentNumber = await nextNumber(tx, 'ADJ', 'stock_adjustments', 'adjustment_number');
          const adjustmentId = uid('adj');
          await applyStockDelta(tx, {
            productId: p.productId,
            warehouseId: p.warehouseId,
            availableDelta: delta,
            type: 'adjustment',
            refType: 'adjustment',
            refId: adjustmentId,
            note: `${adjustmentNumber} ${adjustmentType} (CSV): ${reason}`,
            user: actor.name,
            location: p.location
          });
          await tx.insert(stockAdjustments).values({
            id: adjustmentId,
            adjustmentNumber,
            warehouseId: p.warehouseId,
            productId: p.productId,
            productName: product?.name ?? '',
            sku: product?.sku ?? '',
            unit: product?.unit ?? '',
            adjustmentType,
            oldStock: cur,
            adjustedQty: delta,
            newStock: cur + delta,
            unitCost: product?.purchasePrice ?? 0,
            totalCostImpact: round2(delta * (product?.purchasePrice ?? 0)),
            reason,
            adjustedBy: actor.name,
            date: businessDate()
          });
        }
        changed++;
      }
    })
  );
  return { applied: true, mode, total: rows.length, errors: 0, changed, rows: results };
}

// Adds stock straight into one warehouse (a branch buying locally, or any stock that did not come by transfer).
// Each line is a ledger entry of type branch-receipt, so it stays traceable.
export async function addStockDirect(input: Record<string, any>, actor: Actor) {
  const warehouseId = reqText(input.warehouseId, 'warehouseId', 100);
  const reference = optText(input.reference, 150);
  const note = optText(input.note, 500);

  if (!Array.isArray(input.items) || input.items.length === 0) throw new StockError('Add at least one item');
  if (input.items.length > 200) throw new StockError('At most 200 items at a time');
  const seen = new Set<string>();
  const lines = input.items.map((raw: any, i: number) => {
    const n = i + 1;
    const productId = reqText(raw?.productId, `Item ${n}: productId`);
    if (seen.has(productId)) throw new StockError(`Item ${n}: the same product is listed twice`);
    seen.add(productId);
    return { productId, quantity: posInt(raw?.quantity, `Item ${n}: quantity`) };
  });

  const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!wh) throw new StockError('Warehouse not found', 404);
  if (!canActOnBranch(actor, wh.branchId)) throw new StockError('You cannot add stock to this warehouse', 403);

  const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, lines.map((l: { productId: string }) => l.productId)));
  const have = new Set(found.map((p) => p.id));
  for (const l of lines) if (!have.has(l.productId)) throw new StockError(`Product not found: ${l.productId}`, 404);

  const refId = uid('bra');
  await db.transaction(async (tx) => {
    for (const l of [...lines].sort((a: { productId: string }, b: { productId: string }) => a.productId.localeCompare(b.productId))) {
      await applyStockDelta(tx, {
        productId: l.productId,
        warehouseId,
        availableDelta: l.quantity,
        type: 'branch-receipt',
        refType: 'branch-receipt',
        refId,
        note: [reference ? `Ref ${reference}` : null, note].filter(Boolean).join(' - ') || 'Stock added directly to branch',
        user: actor.name
      });
    }
  });
  return { ok: true, warehouseId, items: lines.length, units: lines.reduce((s: number, l: { quantity: number }) => s + l.quantity, 0) };
}
