import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { branches, customers, invoices, products, saleItems, sales, warehouses } from './schema.ts';
import { factorFor } from '../utils/units.ts';
import { stockMovements } from './schema.stock.ts';
import { StockError, applyStockDelta } from './stockService.ts';
import { trimSequence } from './sequence.ts';
import { businessDate } from '../routes/context.ts';

// Quick sale history: every counter sale with its customer and the products bought. Everyone can read their
// own branch; only the Super Admin can correct or remove a sale (stock is put back to match).

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer'];

export interface QuickSaleFilters {
  q?: string;
  customerId?: string;
  from?: string; // YYYY-MM-DD, shop time
  to?: string;
  limit?: number;
}

const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
const endOf = (ymd: string) => new Date(`${ymd}T23:59:59.999+05:30`);

async function withItems<T extends { id: string }>(rows: T[]) {
  const ids = rows.map((r) => r.id);
  const items = ids.length ? await db.select().from(saleItems).where(inArray(saleItems.saleId, ids)).orderBy(saleItems.id) : [];
  return rows.map((r) => ({ ...r, items: items.filter((it) => it.saleId === r.id) }));
}

const baseSelect = {
  id: sales.id,
  saleNumber: sales.saleNumber,
  createdAt: sales.createdAt,
  branchId: sales.branchId,
  branchName: branches.name,
  createdBy: sales.createdBy,
  customerId: sales.customerId,
  customerName: sales.customerName,
  customerPhone: customers.phone,
  customerAlternatePhone: customers.alternatePhone,
  customerCode: customers.customerId,
  customerAddress: customers.address,
  customerCity: customers.city,
  subtotal: sales.subtotal,
  discount: sales.discount,
  gst: sales.gst,
  grandTotal: sales.grandTotal,
  paymentMethod: sales.paymentMethod,
  secondaryPaymentMethod: sales.paymentMethod2,
  secondaryPaymentAmount: sales.paymentAmount2,
  paymentStatus: sales.paymentStatus,
  invoiceId: invoices.id,
  invoiceNumber: invoices.invoiceNumber
};

export async function listQuickSales(scope: string, filters: QuickSaleFilters) {
  const conds = [];
  if (scope && scope !== 'all') conds.push(eq(sales.branchId, scope));
  if (filters.customerId) conds.push(eq(sales.customerId, filters.customerId));
  if (filters.from) conds.push(gte(sales.createdAt, startOf(filters.from)));
  if (filters.to) conds.push(lte(sales.createdAt, endOf(filters.to)));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const digits = q.replace(/\D/g, '');
    conds.push(
      or(
        ilike(sales.saleNumber, like),
        ilike(sales.customerName, like),
        digits.length >= 4 ? ilike(customers.phone, `%${digits}%`) : sql`false`,
        sql`exists (select 1 from sale_items si where si.sale_id = ${sales.id} and (si.product_name ilike ${like} or si.sku ilike ${like}))`
      )!
    );
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 300, 1), 1000);
  const rows = await db
    .select(baseSelect)
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(invoices, eq(invoices.salesOrderId, sales.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sales.createdAt))
    .limit(limit);
  return withItems(rows);
}

export async function getQuickSale(id: string) {
  const rows = await db
    .select(baseSelect)
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(invoices, eq(invoices.salesOrderId, sales.id))
    .where(eq(sales.id, id))
    .limit(1);
  if (!rows.length) return null;
  return (await withItems(rows))[0];
}

interface EditItem {
  productId: string | null;
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  hsnCode: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
}

function parseItems(raw: unknown): EditItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new StockError('A sale needs at least one product');
  if (raw.length > 100) throw new StockError('A sale can have at most 100 products');
  return raw.map((r: any, i: number) => {
    const quantity = Number(r?.quantity);
    const unitPrice = Number(r?.unitPrice);
    const discount = Number(r?.discount ?? 0);
    const name = String(r?.productName ?? '').trim();
    if (!name) throw new StockError(`Product ${i + 1}: name is missing`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new StockError(`${name}: quantity must be a whole number above 0`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new StockError(`${name}: price cannot be negative`);
    if (!Number.isFinite(discount) || discount < 0) throw new StockError(`${name}: discount cannot be negative`);
    return {
      productId: r?.productId ? String(r.productId) : null,
      productName: name.slice(0, 300),
      sku: r?.sku ? String(r.sku).slice(0, 100) : null,
      serialNumber: r?.serialNumber ? String(r.serialNumber).slice(0, 100) : null,
      hsnCode: r?.hsnCode ? String(r.hsnCode).slice(0, 20) : null,
      unit: r?.unit ? String(r.unit).slice(0, 30) : null,
      quantity,
      unitPrice: round2(unitPrice),
      discount: round2(discount)
    };
  });
}

// Super Admin: correct a sale. Stock follows the change product by product, and the invoice made for the sale is
// brought in line with it.
export async function updateQuickSale(id: string, input: Record<string, any>, actorName: string) {
  const items = parseItems(input.items);
  const paymentMethod = input.paymentMethod === undefined ? undefined : String(input.paymentMethod);
  if (paymentMethod !== undefined && !PAYMENT_METHODS.includes(paymentMethod)) {
    throw new StockError(`Payment method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  // New sale date (YYYY-MM-DD, India time): an earlier day is fine, a future one is not.
  let newDate: string | undefined;
  if (input.saleDate !== undefined && input.saleDate !== null && input.saleDate !== '') {
    newDate = String(input.saleDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(Date.parse(`${newDate}T00:00:00Z`))) {
      throw new StockError('The sale date is not a valid date');
    }
    if (newDate > businessDate()) throw new StockError('The sale date cannot be in the future');
  }
  // Secondary payment: leave it alone when the field is missing, clear it when empty, otherwise set method and amount.
  const touchesSecondary = input.secondaryPaymentMethod !== undefined;
  const secondMethodIn = touchesSecondary && input.secondaryPaymentMethod ? String(input.secondaryPaymentMethod) : null;
  const secondAmountIn = secondMethodIn ? Math.round(Number(input.secondaryPaymentAmount) * 100) / 100 : 0;
  if (secondMethodIn && !PAYMENT_METHODS.includes(secondMethodIn)) {
    throw new StockError(`Secondary payment must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  const overallDiscount = input.discount === undefined ? undefined : Number(input.discount);
  if (overallDiscount !== undefined && (!Number.isFinite(overallDiscount) || overallDiscount < 0)) {
    throw new StockError('Discount cannot be negative');
  }

  await db.transaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
    if (!sale) throw new StockError('Sale not found', 404);

    // customer: keep, rename, or switch to another customer in the directory
    let customerId = sale.customerId;
    let customerName = sale.customerName;
    if (input.customerId !== undefined && input.customerId !== sale.customerId) {
      const [c] = await tx.select().from(customers).where(eq(customers.id, String(input.customerId)));
      if (!c) throw new StockError('That customer was not found', 404);
      customerId = c.id;
      customerName = c.companyName || c.name || sale.customerName;
    } else if (input.customerName !== undefined) {
      const n = String(input.customerName).trim();
      if (!n) throw new StockError('Customer name cannot be empty');
      customerName = n.slice(0, 200);
    }

    const oldItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
    const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.refType, 'sale'), eq(stockMovements.refId, id)));
    const warehouseOf = new Map<string, string>();
    for (const m of movements) if (!warehouseOf.has(m.productId)) warehouseOf.set(m.productId, m.warehouseId);
    const [branchWarehouse] = sale.branchId
      ? await tx.select().from(warehouses).where(eq(warehouses.branchId, sale.branchId)).orderBy(warehouses.id).limit(1)
      : [];

    // Stock is counted in the product's own unit: a line of 2 boxes of 18 takes 36 pieces.
    const lineProducts = items.length
      ? await tx.select().from(products).where(inArray(products.id, [...new Set(items.filter((it) => it.productId).map((it) => it.productId as string))]))
      : [];
    const productById = new Map(lineProducts.map((p) => [p.id, p]));
    const factors = items.map((it) => {
      if (!it.productId) return 1;
      const product = productById.get(it.productId);
      const f = product ? factorFor(product, it.unit) : null;
      if (f === null) throw new StockError(`${it.productName} is not sold in ${it.unit}`);
      return f;
    });

    const oldQty = new Map<string, number>();
    for (const it of oldItems) if (it.productId) oldQty.set(it.productId, (oldQty.get(it.productId) ?? 0) + it.quantity * (it.unitFactor || 1));
    const newQty = new Map<string, number>();
    items.forEach((it, i) => {
      if (it.productId) newQty.set(it.productId, (newQty.get(it.productId) ?? 0) + it.quantity * factors[i]);
    });

    // stock: a smaller quantity puts units back, a larger one takes more (and fails if there is not enough)
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])].sort();
    for (const productId of productIds) {
      const delta = (oldQty.get(productId) ?? 0) - (newQty.get(productId) ?? 0);
      if (delta === 0) continue;
      const warehouseId = warehouseOf.get(productId) ?? branchWarehouse?.id;
      if (!warehouseId) throw new StockError('No warehouse is set up for this branch.');
      await applyStockDelta(tx, {
        productId,
        warehouseId,
        availableDelta: delta,
        type: 'adjustment',
        refType: 'sale-edit',
        refId: id,
        note: `Sale ${sale.saleNumber} corrected`,
        user: actorName
      });
    }

    await tx.delete(saleItems).where(eq(saleItems.saleId, id));
    let subtotal = 0;
    for (const [idx, it] of items.entries()) {
      const lineTotal = Math.max(0, round2(it.quantity * it.unitPrice - it.discount));
      subtotal += lineTotal;
      await tx.insert(saleItems).values({
        saleId: id,
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        serialNumber: it.serialNumber,
        quantity: it.quantity,
        unit: it.unit,
        unitFactor: factors[idx],
        unitPrice: it.unitPrice,
        discount: it.discount,
        gst: 0,
        lineTotal,
        hsnCode: it.hsnCode
      });
    }
    subtotal = round2(subtotal);
    const discount = overallDiscount ?? sale.discount;
    const grandTotal = Math.max(0, Math.round(subtotal - discount));

    // Only a real change of day moves the sale; the time of day is kept for today, noon for an earlier day.
    const dateChanged = !!newDate && newDate !== businessDate(sale.createdAt);
    const createdAt = dateChanged ? (newDate === businessDate() ? new Date() : new Date(`${newDate}T12:00:00+05:30`)) : sale.createdAt;

    const firstMethod = paymentMethod ?? sale.paymentMethod;
    const secondMethod = touchesSecondary ? secondMethodIn : sale.paymentMethod2;
    let secondAmount = touchesSecondary ? secondAmountIn : sale.paymentAmount2;
    if (secondMethod) {
      if (secondMethod === firstMethod) throw new StockError('The secondary payment must be a different method from the first payment');
      if (!Number.isFinite(secondAmount) || secondAmount <= 0 || secondAmount >= grandTotal) {
        throw new StockError('The secondary payment amount must be more than 0 and less than the bill total');
      }
    } else {
      secondAmount = 0;
    }

    await tx
      .update(sales)
      .set({
        customerId,
        customerName,
        paymentMethod: firstMethod,
        paymentMethod2: secondMethod,
        paymentAmount2: secondAmount,
        subtotal,
        discount,
        gst: 0,
        grandTotal,
        createdAt
      })
      .where(eq(sales.id, id));
    await tx
      .update(invoices)
      .set({
        customerId,
        customerName,
        subtotal,
        totalDiscount: discount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        grandTotal,
        paidAmount: grandTotal,
        balanceAmount: 0,
        ...(dateChanged ? { invoiceDate: newDate!, dueDate: newDate! } : {})
      })
      .where(eq(invoices.salesOrderId, id));
  });
  return getQuickSale(id);
}

// Super Admin: remove a sale. Every unit it took out of stock goes back, and its invoice is removed with it.
export async function deleteQuickSale(id: string, actorName: string) {
  return db.transaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
    if (!sale) throw new StockError('Sale not found', 404);

    const movements = await tx
      .select()
      .from(stockMovements)
      .where(and(inArray(stockMovements.refType, ['sale', 'sale-edit']), eq(stockMovements.refId, id)));
    const net = new Map<string, { productId: string; warehouseId: string; delta: number }>();
    for (const m of movements) {
      const key = `${m.productId}|${m.warehouseId}`;
      const cur = net.get(key) ?? { productId: m.productId, warehouseId: m.warehouseId, delta: 0 };
      cur.delta += m.availableDelta;
      net.set(key, cur);
    }
    // What the sale's lines hold today, in the product's own unit (2 boxes of 18 = 36). A sale made while an item was
    // still counted in boxes has older, smaller ledger entries, so the lines are the truth for how much goes back.
    const soldNow = new Map<string, number>();
    for (const it of await tx.select().from(saleItems).where(eq(saleItems.saleId, id))) {
      if (it.productId) soldNow.set(it.productId, (soldNow.get(it.productId) ?? 0) + it.quantity * (it.unitFactor || 1));
    }
    const perProduct = new Map<string, number>();
    for (const n of net.values()) perProduct.set(n.productId, (perProduct.get(n.productId) ?? 0) + n.delta);
    for (const n of net.values()) {
      const total = perProduct.get(n.productId) ?? 0;
      const sold = soldNow.get(n.productId);
      // only reshape when the ledger says stock was taken out and the lines say more than the ledger shows
      if (sold !== undefined && total < 0 && sold > -total && n.delta < 0 && n.delta === total) n.delta = -sold;
    }
    for (const n of [...net.values()].sort((a, b) => `${a.productId}${a.warehouseId}`.localeCompare(`${b.productId}${b.warehouseId}`))) {
      if (n.delta === 0) continue;
      await applyStockDelta(tx, {
        productId: n.productId,
        warehouseId: n.warehouseId,
        availableDelta: -n.delta,
        type: 'adjustment',
        refType: 'sale-void',
        refId: id,
        note: `Sale ${sale.saleNumber} deleted, stock returned`,
        user: actorName
      });
    }

    const removedInvoices = await tx.delete(invoices).where(eq(invoices.salesOrderId, id)).returning({ id: invoices.id });
    await tx.delete(sales).where(eq(sales.id, id));
    // numbers that are not used any more at the end of the series go back, so the next sale continues one by one
    const m = /^QS-(\d{4})-\d{5}$/.exec(sale.saleNumber);
    if (m) {
      await trimSequence(tx, 'quicksale-sale', m[1], 'sales', 'sale_number', 'QS');
      await trimSequence(tx, 'quicksale-invoice', m[1], 'invoices', 'invoice_number', 'INV');
    }
    return { id, saleNumber: sale.saleNumber, invoiceIds: removedInvoices.map((r) => r.id) };
  });
}

// Totals of the counter (quick) sales for the dashboards, per branch. Collected is what was paid at the counter.
export async function quickSaleSummary(scope: string) {
  const rows = await db
    .select({
      branchId: sales.branchId,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${sales.grandTotal}), 0)::float`,
      collected: sql<number>`coalesce(sum(case when ${sales.paymentStatus} = 'Paid' then ${sales.grandTotal} else 0 end), 0)::float`
    })
    .from(sales)
    .where(scope && scope !== 'all' ? eq(sales.branchId, scope) : undefined)
    .groupBy(sales.branchId);
  const byBranch = rows.map((r) => ({ branchId: r.branchId, count: Number(r.count), total: Number(r.total), collected: Number(r.collected) }));
  return {
    count: byBranch.reduce((s, r) => s + r.count, 0),
    total: byBranch.reduce((s, r) => s + r.total, 0),
    collected: byBranch.reduce((s, r) => s + r.collected, 0),
    byBranch
  };
}
