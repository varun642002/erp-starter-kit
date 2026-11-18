import { eq, ilike, inArray, or, sql, and } from 'drizzle-orm';
import { db } from './index.ts';
import { products, warehouseStocks, warehouses, branches, salesOrderItems, saleItems, warranties } from './schema.ts';
import { documentItems } from './schema.documents.ts';
import { jobCardParts } from './schema.jobCards.ts';
import { machineSales } from './schema.machineSales.ts';
import { stockAdjustments, stockMovements, stockTransferItems } from './schema.stock.ts';
import { StockError, applyStockDelta, optText } from './stockService.ts';
import { productAliases } from './schema.voice.ts';

export interface ProductInput {
  id?: string;
  sku: string;
  name: string;
  category: string;
  subcategory?: string;
  brand?: string;
  barcode?: string;
  hsnCode?: string;
  gstRate?: number;
  unit?: string;
  alternateUnit?: string;
  conversionFactor?: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number;
  minStock?: number;
  maxStock?: number;
  reorderLevel?: number;
  description?: string;
  imageUrl?: string;
  status?: string;
  isArchived?: boolean;
  isSparePart?: boolean;
  compatibleModels?: string;
  oemPartNumber?: string;
  shelfBinLocation?: string;
  initialStock?: number;
  warehouseId?: string;
  // other names the product is known by (searched in Inventory, Quick Sale and by the voice assistant)
  alternateNames?: string[];
}

type ProductRow = typeof products.$inferSelect;

// Cleans a list of alternate names: trimmed, no blanks, no repeats, sensible lengths.
export function cleanAlternateNames(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[;|\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const alias = v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 30) break;
  }
  return out;
}

// Adds names to a product; names it already has are left alone.
async function addAlternateNames(tx: { insert: typeof db.insert }, productId: string, raw: unknown) {
  const names = cleanAlternateNames(raw);
  if (!names.length) return;
  await tx
    .insert(productAliases)
    .values(names.map((alias) => ({ productId, alias, aliasKey: alias.toLowerCase() })))
    .onConflictDoNothing();
}

async function aliasMapFor(ids?: string[]): Promise<Map<string, string[]>> {
  const rows = ids
    ? ids.length
      ? await db.select().from(productAliases).where(inArray(productAliases.productId, ids)).orderBy(productAliases.id)
      : []
    : await db.select().from(productAliases).orderBy(productAliases.id);
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.productId, [...(map.get(r.productId) || []), r.alias]);
  return map;
}

function presentProduct(
  p: ProductRow,
  stocks: (typeof warehouseStocks.$inferSelect)[],
  aliases?: Map<string, string[]>
) {
  return {
    ...p,
    alternateNames: aliases?.get(p.id) || [],
    warehouseStocks: stocks.filter((s) => s.productId === p.id),
    compatibleModels: p.compatibleModels ? p.compatibleModels.split(',').map((m) => m.trim()) : []
  };
}

async function withStocks(rows: ProductRow[]) {
  if (rows.length === 0) return [];
  const stocks = await db
    .select()
    .from(warehouseStocks)
    .where(inArray(warehouseStocks.productId, rows.map((p) => p.id)));
  const aliases = await aliasMapFor(rows.map((p) => p.id));
  return rows.map((p) => presentProduct(p, stocks, aliases));
}

export async function getAllProducts() {
  try {
    const prods = await db.select().from(products).orderBy(products.name);
    const stocks = await db.select().from(warehouseStocks);
    const aliases = await aliasMapFor();
    return prods.map((p) => presentProduct(p, stocks, aliases));
  } catch (error) {
    console.error('Failed to get all products:', error);
    throw new Error('Database query failed while fetching products.', { cause: error });
  }
}

export async function searchProducts(query: string, limit: number = 20) {
  try {
    if (!query || !query.trim()) {
      return await withStocks(await db.select().from(products).where(eq(products.isArchived, false)).limit(limit).orderBy(products.name));
    }

    const q = `%${query.trim()}%`;
    const results = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isArchived, false),
          or(
            ilike(products.sku, q),
            ilike(products.name, q),
            ilike(products.hsnCode, q),
            ilike(products.oemPartNumber, q),
            ilike(products.category, q),
            ilike(products.shelfBinLocation, q),
            sql`exists (select 1 from product_aliases a where a.product_id = ${products.id} and a.alias ilike ${q})`
          )
        )
      )
      .limit(limit)
      .orderBy(products.name);

    return await withStocks(results);
  } catch (error) {
    console.error('Failed to search products:', error);
    throw new Error('Database query failed during product search.', { cause: error });
  }
}

export async function getProductBySku(sku: string) {
  try {
    const results = await db
      .select()
      .from(products)
      .where(eq(sql`LOWER(${products.sku})`, sku.toLowerCase().trim()))
      .limit(1);
    return (await withStocks(results))[0] || null;
  } catch (error) {
    console.error('Failed to get product by SKU:', error);
    throw new Error('Database query failed during SKU lookup.', { cause: error });
  }
}

// Centralized Master Selling Price Update (Owner only -> reflects across all 6 branches)
export async function updateMasterProductPrice(productId: string, newSellingPrice: number) {
  try {
    const mrp = Math.round(newSellingPrice * 1.1);
    const [updated] = await db
      .update(products)
      .set({
        sellingPrice: newSellingPrice,
        mrp,
        updatedAt: new Date()
      })
      .where(eq(products.id, productId))
      .returning();

    return updated;
  } catch (error) {
    console.error('Failed to update master product price:', error);
    throw new Error('Database update failed for master product price.', { cause: error });
  }
}

export async function createProduct(input: ProductInput) {
  try {
    const id = input.id || `prod-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sku = input.sku.trim().toUpperCase();

    return await db.transaction(async (tx) => {
      const [newProduct] = await tx
        .insert(products)
        .values({
          id,
          sku,
          name: input.name.trim(),
          category: input.category || 'Tractor Implements',
          subcategory: input.subcategory || (input.isSparePart ? 'Agro Machinery Spares' : 'Machinery'),
          brand: input.brand || 'Acme Genuine Spares',
          barcode: input.barcode || `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
          hsnCode: input.hsnCode || '8432',
          gstRate: input.gstRate ?? 18,
          unit: input.unit || 'Nos',
          alternateUnit: input.alternateUnit,
          conversionFactor: input.conversionFactor,
          purchasePrice: input.purchasePrice,
          sellingPrice: input.sellingPrice,
          mrp: input.mrp || Math.round(input.sellingPrice * 1.1),
          minStock: input.minStock ?? 10,
          maxStock: input.maxStock ?? 100,
          reorderLevel: input.reorderLevel ?? 15,
          description: input.description,
          imageUrl: input.imageUrl,
          status: input.status || 'In Stock',
          isArchived: input.isArchived ?? false,
          isSparePart: input.isSparePart ?? false,
          compatibleModels: input.compatibleModels,
          oemPartNumber: input.oemPartNumber,
          shelfBinLocation: input.shelfBinLocation
        })
        .returning();

      await addAlternateNames(tx, newProduct.id, input.alternateNames);

      // If initial stock provided, create the stock row through the ledger.
      if (input.initialStock && input.initialStock > 0) {
        const whList = await tx.select().from(warehouses).limit(1);
        const whId = input.warehouseId || (whList[0]?.id ?? 'wh-1');

        await applyStockDelta(tx, {
          productId: newProduct.id,
          warehouseId: whId,
          availableDelta: input.initialStock,
          type: 'opening',
          refType: 'product',
          refId: newProduct.id,
          note: 'Opening stock',
          user: 'system',
          location: {
            rack: input.shelfBinLocation?.split('/')[0]?.replace('Rack', '').trim() || 'RACK-01',
            row: '01',
            shelf: 'S-A',
            bin: input.shelfBinLocation?.split('/')[1]?.replace('Bin', '').trim() || 'B-101'
          }
        });
      }

      return newProduct;
    });
  } catch (error) {
    console.error('Failed to create product:', error);
    throw new Error('Database insertion failed for product.', { cause: error });
  }
}

export async function importProductsTransactional(
  items: ProductInput[],
  duplicateStrategy: 'skip' | 'update' = 'skip'
) {
  try {
    return await db.transaction(async (tx) => {
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const sectionConflicts: { sku: string; existsAs: 'spare' | 'machinery' }[] = [];

      for (const item of items) {
        const sku = item.sku.trim().toUpperCase();
        // Check if product already exists
        const existing = await tx
          .select()
          .from(products)
          .where(eq(sql`LOWER(${products.sku})`, sku.toLowerCase()))
          .limit(1);

        if (existing.length > 0) {
          // A spare list never turns a machine into a spare, and a machinery list never the other way round.
          if (typeof item.isSparePart === 'boolean' && item.isSparePart !== existing[0].isSparePart) {
            sectionConflicts.push({ sku, existsAs: existing[0].isSparePart ? 'spare' : 'machinery' });
            skippedCount++;
            continue;
          }
          if (duplicateStrategy === 'update') {
            await tx
              .update(products)
              .set({
                name: item.name.trim(),
                category: item.category || existing[0].category,
                subcategory: item.subcategory || existing[0].subcategory,
                brand: item.brand || existing[0].brand,
                hsnCode: item.hsnCode || existing[0].hsnCode,
                gstRate: item.gstRate ?? existing[0].gstRate,
                unit: item.unit || existing[0].unit,
                purchasePrice: item.purchasePrice,
                sellingPrice: item.sellingPrice,
                mrp: item.mrp || Math.round(item.sellingPrice * 1.1),
                minStock: item.minStock ?? existing[0].minStock,
                description: item.description || existing[0].description,
                isSparePart: item.isSparePart ?? existing[0].isSparePart,
                compatibleModels: item.compatibleModels || existing[0].compatibleModels,
                oemPartNumber: item.oemPartNumber || existing[0].oemPartNumber,
                shelfBinLocation: item.shelfBinLocation || existing[0].shelfBinLocation,
                updatedAt: new Date()
              })
              .where(eq(products.id, existing[0].id));
            await addAlternateNames(tx, existing[0].id, item.alternateNames);
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          const id = item.id || `prod-csv-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          await tx.insert(products).values({
            id,
            sku,
            name: item.name.trim(),
            category: item.category || 'Tractor Implements',
            subcategory: item.subcategory || (item.isSparePart ? 'Agro Machinery Spares' : 'Machinery'),
            brand: item.brand || 'Acme Genuine Spares',
            barcode: item.barcode || `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
            hsnCode: item.hsnCode || '8432',
            gstRate: item.gstRate ?? 18,
            unit: item.unit || 'Nos',
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
            mrp: item.mrp || Math.round(item.sellingPrice * 1.1),
            minStock: item.minStock ?? 10,
            maxStock: item.maxStock ?? 100,
            reorderLevel: item.reorderLevel ?? 15,
            description: item.description,
            status: 'In Stock',
            isArchived: false,
            isSparePart: item.isSparePart ?? false,
            compatibleModels: item.compatibleModels,
            oemPartNumber: item.oemPartNumber,
            shelfBinLocation: item.shelfBinLocation
          });
          await addAlternateNames(tx, id, item.alternateNames);

          if (item.initialStock && item.initialStock > 0) {
            const whList = await tx.select().from(warehouses).limit(1);
            const whId = item.warehouseId || (whList[0]?.id ?? 'wh-1');
            await applyStockDelta(tx, {
              productId: id,
              warehouseId: whId,
              availableDelta: item.initialStock,
              type: 'opening',
              refType: 'import',
              refId: id,
              note: 'Opening stock (CSV import)',
              user: 'system',
              location: {
                rack: item.shelfBinLocation?.split('/')[0]?.replace('Rack', '').trim() || 'RACK-CSV',
                row: '01',
                shelf: 'S-A',
                bin: item.shelfBinLocation?.split('/')[1]?.replace('Bin', '').trim() || 'B-CSV'
              }
            });
          }
          insertedCount++;
        }
      }

      return {
        success: true,
        insertedCount,
        updatedCount,
        skippedCount,
        totalProcessed: items.length,
        sectionConflicts
      };
    });
  } catch (error) {
    console.error('Failed to import products transactionally:', error);
    throw new Error('Database transaction failed during product CSV import.', { cause: error });
  }
}

export interface SpareDeliveryInput {
  name: string;
  sku?: string;
  category?: string;
  compatibleModels?: string;
  oemPartNumber?: string;
  brand?: string;
  unit?: string;
  hsnCode?: string;
  purchasePrice?: number;
  sellingPrice: number;
  mrp?: number;
  gstRate?: number;
  deliveredQty: number;
  challanNumber?: string;
  deliveryDate?: string;
  receivingBranch: string;
  supplierName?: string;
  transporterOrVehicle?: string;
  shelfBinLocation?: string;
  alternateNames?: string[];
  subcategory?: string;
}

export async function importSparesWithDeliveryTransactional(
  items: SpareDeliveryInput[],
  duplicateStrategy: 'skip' | 'update' = 'update'
) {
  try {
    return await db.transaction(async (tx) => {
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let totalInwardQty = 0;
      const sectionConflicts: { sku: string; existsAs: 'spare' | 'machinery' }[] = [];

      // Fetch branches for matching
      const allBranches = await tx.select().from(branches);
      const allWarehouses = await tx.select().from(warehouses);

      const challanGroup = items[0]?.challanNumber || `DC-SP-${Date.now().toString().slice(-5)}`;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const trimmedName = item.name.trim();
        const generatedSku = item.sku?.trim().toUpperCase() || `SPR-TCT-${Math.floor(1000 + Math.random() * 9000)}`;
        const deliveredQty = Math.max(0, Number(item.deliveredQty) || 0);
        totalInwardQty += deliveredQty;

        // Resolve branch: by ID or name matching
        const branchMatch = allBranches.find(b => 
          b.id.toLowerCase() === item.receivingBranch.toLowerCase() ||
          b.name.toLowerCase().includes(item.receivingBranch.toLowerCase()) ||
          item.receivingBranch.toLowerCase().includes(b.name.toLowerCase()) ||
          b.city.toLowerCase().includes(item.receivingBranch.toLowerCase())
        ) || allBranches[0];

        const targetWh = allWarehouses.find(w => w.branchId === branchMatch?.id) || allWarehouses[0];
        const targetWhId = targetWh?.id || 'wh-1';

        // Check if existing product by SKU or exact name
        const existing = await tx
          .select()
          .from(products)
          .where(
            or(
              eq(sql`LOWER(${products.sku})`, generatedSku.toLowerCase()),
              eq(sql`LOWER(${products.name})`, trimmedName.toLowerCase())
            )
          )
          .limit(1);

        if (existing.length > 0) {
          const existingProd = existing[0];
          if (!existingProd.isSparePart) {
            // Same item number or name already belongs to Machinery: leave it there, add no stock.
            sectionConflicts.push({ sku: existingProd.sku, existsAs: 'machinery' });
            skippedCount++;
            totalInwardQty -= deliveredQty;
            continue;
          }
          if (duplicateStrategy === 'update') {
            await tx
              .update(products)
              .set({
                sellingPrice: item.sellingPrice > 0 ? item.sellingPrice : existingProd.sellingPrice,
                purchasePrice: item.purchasePrice ? item.purchasePrice : existingProd.purchasePrice,
                mrp: item.mrp || existingProd.mrp,
                isSparePart: true,
                compatibleModels: item.compatibleModels || existingProd.compatibleModels,
                oemPartNumber: item.oemPartNumber || existingProd.oemPartNumber,
                shelfBinLocation: item.shelfBinLocation || existingProd.shelfBinLocation,
                category: item.category || existingProd.category,
                ...(item.subcategory?.trim() ? { subcategory: item.subcategory.trim().slice(0, 100) } : {}),
                brand: item.brand || existingProd.brand,
                status: 'In Stock'
              })
              .where(eq(products.id, existingProd.id));
            await addAlternateNames(tx, existingProd.id, item.alternateNames);

            // Add inward delivered qty to the branch's warehouse stock
            if (deliveredQty > 0) {
              await applyStockDelta(tx, {
                productId: existingProd.id,
                warehouseId: targetWhId,
                availableDelta: deliveredQty,
                type: 'receipt',
                refType: 'import',
                refId: challanGroup,
                note: `Spares delivery ${item.challanNumber || challanGroup}`,
                user: 'system',
                location: {
                  rack: item.shelfBinLocation?.split('/')[0]?.replace('Rack', '').trim() || 'RACK-SPR',
                  row: '01',
                  shelf: 'S-A',
                  bin: item.shelfBinLocation?.split('/')[1]?.replace('Bin', '').trim() || 'B-01'
                }
              });
            }
            if (item.shelfBinLocation) {
              await tx
                .update(warehouseStocks)
                .set({ shelf: item.shelfBinLocation })
                .where(and(eq(warehouseStocks.productId, existingProd.id), eq(warehouseStocks.warehouseId, targetWhId)));
            }

            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          // New Spare Part Record
          const newProdId = `prod-sp-${Date.now()}-${i + 1}`;
          await tx.insert(products).values({
            id: newProdId,
            sku: generatedSku,
            name: trimmedName,
            category: item.category || 'Rotavator Blades & Fasteners',
            subcategory: item.subcategory?.trim().slice(0, 100) || 'Tractor Machinery Spares',
            brand: item.brand || 'Acme Genuine Spares',
            barcode: `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
            hsnCode: item.hsnCode || '8432',
            gstRate: item.gstRate ?? 12,
            unit: item.unit || 'Piece',
            purchasePrice: item.purchasePrice || Math.round(item.sellingPrice * 0.7),
            sellingPrice: item.sellingPrice,
            mrp: item.mrp || Math.round(item.sellingPrice * 1.15),
            minStock: 20,
            maxStock: 500,
            reorderLevel: 25,
            description: `Compatible with ${item.compatibleModels || 'Standard Agricultural Tractors'}. Inwarded via Challan ${item.challanNumber || challanGroup}`,
            status: deliveredQty > 0 ? 'In Stock' : 'Low Stock',
            isArchived: false,
            isSparePart: true,
            compatibleModels: item.compatibleModels,
            oemPartNumber: item.oemPartNumber,
            shelfBinLocation: item.shelfBinLocation || 'Rack RACK-SPR / Bin B-01'
          });
          await addAlternateNames(tx, newProdId, item.alternateNames);

          // Insert Branch Stock (a zero-quantity row still records the shelf location)
          if (deliveredQty > 0) {
            await applyStockDelta(tx, {
              productId: newProdId,
              warehouseId: targetWhId,
              availableDelta: deliveredQty,
              type: 'opening',
              refType: 'import',
              refId: challanGroup,
              note: `Spares delivery ${item.challanNumber || challanGroup}`,
              user: 'system',
              location: {
                rack: item.shelfBinLocation?.split('/')[0]?.replace('Rack', '').trim() || 'RACK-SPR',
                row: '01',
                shelf: 'S-A',
                bin: item.shelfBinLocation?.split('/')[1]?.replace('Bin', '').trim() || 'B-01'
              }
            });
          } else {
            await tx.insert(warehouseStocks).values({
              productId: newProdId,
              warehouseId: targetWhId,
              rack: item.shelfBinLocation?.split('/')[0]?.replace('Rack', '').trim() || 'RACK-SPR',
              row: '01',
              shelf: 'S-A',
              bin: item.shelfBinLocation?.split('/')[1]?.replace('Bin', '').trim() || 'B-01'
            });
          }

          insertedCount++;
        }
      }

      return {
        success: true,
        insertedCount,
        updatedCount,
        skippedCount,
        totalProcessed: items.length,
        totalInwardQty,
        grnNumber: challanGroup,
        sectionConflicts
      };
    });
  } catch (error) {
    console.error('Failed to import spares with delivery transactionally:', error);
    throw new Error('Database transaction failed during bulk spare delivery import.', { cause: error });
  }
}

// ---------- edits ----------

const PRODUCT_STATUSES = ['In Stock', 'Low Stock', 'Out of Stock', 'Archived'];

function numField(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

function intField(v: unknown, field: string): number {
  const n = numField(v);
  if (!Number.isInteger(n) || n < 0) throw new StockError(`${field} must be a whole number of 0 or more`);
  return n;
}

function moneyField(v: unknown, field: string): number {
  const n = numField(v);
  if (!Number.isFinite(n) || n < 0) throw new StockError(`${field} must be 0 or more`);
  return n;
}

// Parses the editable subset of a product; keys outside `allowed` are ignored.
function parseProductPatch(patch: Record<string, any>, allowed: readonly string[]): Partial<typeof products.$inferInsert> {
  const set: Partial<typeof products.$inferInsert> = {};
  const has = (k: string) => allowed.includes(k) && patch[k] !== undefined;
  const required = (k: string, max = 200) => {
    const s = optText(patch[k], max);
    if (!s) throw new StockError(`${k} cannot be empty`);
    return s;
  };

  if (has('name')) set.name = required('name');
  if (has('category')) set.category = required('category');
  if (has('subcategory')) set.subcategory = optText(patch.subcategory, 200);
  if (has('brand')) set.brand = optText(patch.brand, 200);
  if (has('hsnCode')) set.hsnCode = optText(patch.hsnCode, 20);
  if (has('gstRate')) {
    const gst = intField(patch.gstRate, 'gstRate');
    if (gst > 100) throw new StockError('gstRate must be between 0 and 100');
    set.gstRate = gst;
  }
  if (has('unit')) set.unit = required('unit', 30);
  // Second selling unit, for example a Box that holds 18 pieces.
  if (has('alternateUnit')) {
    const alt = optText(patch.alternateUnit, 30);
    if (alt && !['Piece', 'Box', 'Kg'].includes(alt)) throw new StockError('The second unit must be Piece, Box or Kg');
    set.alternateUnit = alt || null;
  }
  if (has('conversionFactor')) {
    const raw = patch.conversionFactor;
    if (raw === null || raw === '' || raw === 0) {
      set.conversionFactor = null;
    } else {
      const f = Number(raw);
      if (!Number.isInteger(f) || f < 2 || f > 100000) throw new StockError('Pieces in a box must be a whole number of 2 or more');
      set.conversionFactor = f;
    }
  }
  if (has('purchasePrice')) set.purchasePrice = moneyField(patch.purchasePrice, 'purchasePrice');
  if (has('sellingPrice')) set.sellingPrice = moneyField(patch.sellingPrice, 'sellingPrice');
  if (has('mrp')) set.mrp = moneyField(patch.mrp, 'mrp');
  if (has('minStock')) set.minStock = intField(patch.minStock, 'minStock');
  if (has('maxStock')) set.maxStock = intField(patch.maxStock, 'maxStock');
  if (has('reorderLevel')) set.reorderLevel = intField(patch.reorderLevel, 'reorderLevel');
  if (has('status')) {
    if (!PRODUCT_STATUSES.includes(patch.status)) throw new StockError(`status must be one of ${PRODUCT_STATUSES.join(', ')}`);
    set.status = patch.status;
  }
  if (has('isArchived')) {
    if (typeof patch.isArchived !== 'boolean') throw new StockError('isArchived must be true or false');
    set.isArchived = patch.isArchived;
  }
  if (has('description')) set.description = optText(patch.description, 2000);
  if (has('barcode')) set.barcode = optText(patch.barcode, 100);
  if (has('oemPartNumber')) set.oemPartNumber = optText(patch.oemPartNumber, 100);
  if (has('shelfBinLocation')) set.shelfBinLocation = optText(patch.shelfBinLocation, 100);
  if (has('compatibleModels')) {
    const v = patch.compatibleModels;
    const text = Array.isArray(v) ? v.map((m) => String(m).trim()).filter(Boolean).join(', ') : v;
    set.compatibleModels = optText(text, 2000);
  }
  return set;
}

const EDITABLE_FIELDS = [
  'name', 'category', 'subcategory', 'brand', 'hsnCode', 'gstRate', 'unit', 'alternateUnit', 'conversionFactor', 'purchasePrice', 'sellingPrice', 'mrp',
  'minStock', 'maxStock', 'reorderLevel', 'status', 'isArchived', 'description', 'barcode', 'oemPartNumber',
  'compatibleModels', 'shelfBinLocation'
] as const;
const BULK_FIELDS = ['status', 'isArchived', 'category'] as const;

export async function updateProduct(id: string, patch: Record<string, any>) {
  const set = parseProductPatch(patch, EDITABLE_FIELDS);
  if (Object.keys(set).length === 0) throw new StockError('No editable fields supplied');
  const [updated] = await db
    .update(products)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  if (!updated) throw new StockError('Product not found', 404);
  return (await withStocks([updated]))[0];
}

export async function bulkUpdateProducts(ids: unknown, patch: unknown) {
  if (!Array.isArray(ids) || ids.length === 0) throw new StockError('ids must be a non-empty list');
  if (ids.length > 1000) throw new StockError('At most 1000 products can be updated at once');
  if (!ids.every((i) => typeof i === 'string' && i)) throw new StockError('ids must be product ids');
  const set = parseProductPatch((patch && typeof patch === 'object' ? patch : {}) as Record<string, any>, BULK_FIELDS);
  if (Object.keys(set).length === 0) throw new StockError('patch must set status, isArchived or category');
  const updated = await db
    .update(products)
    .set({ ...set, updatedAt: new Date() })
    .where(inArray(products.id, ids as string[]))
    .returning({ id: products.id });
  return { updated: updated.length };
}

// Stock-in movements only. A product whose whole history is these (an import, an opening balance,
// a delivery, a count correction) can be erased; anything sold, billed, transferred or serviced cannot.
const ERASABLE_MOVEMENT_TYPES = ['opening', 'receipt', 'adjustment', 'branch-receipt'];

export interface BulkDeleteResult {
  dryRun: boolean;
  requested: number;
  deleted: number;
  archived: number;
  units: number; // units of stock that go away with the erased items
  blocked: { id: string; sku: string; name: string; reason: string }[];
}

// Permanently removes products that have no sales, billing, transfer or service history.
// Products that do have history are archived instead, so those records keep their reference.
export async function bulkDeleteProducts(ids: unknown, dryRun = false): Promise<BulkDeleteResult> {
  if (!Array.isArray(ids) || ids.length === 0) throw new StockError('ids must be a non-empty list');
  if (ids.length > 5000) throw new StockError('At most 5000 products can be removed at once');
  if (!ids.every((i) => typeof i === 'string' && i)) throw new StockError('ids must be product ids');
  const wanted = Array.from(new Set(ids as string[]));

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.id, wanted));

    const reasons = new Map<string, string>();
    const mark = (productId: string | null, reason: string) => {
      if (productId && !reasons.has(productId)) reasons.set(productId, reason);
    };
    const used = async (table: any, column: any, reason: string, extra?: any) => {
      const found = await tx
        .selectDistinct({ productId: column })
        .from(table)
        .where(extra ? and(inArray(column, wanted), extra) : inArray(column, wanted));
      for (const f of found as { productId: string | null }[]) mark(f.productId, reason);
    };

    await used(documentItems, documentItems.productId, 'used on an invoice or quotation');
    await used(machineSales, machineSales.productId, 'used in a machine sale');
    await used(jobCardParts, jobCardParts.productId, 'used on a service job card');
    await used(stockTransferItems, stockTransferItems.productId, 'part of a stock transfer');
    await used(salesOrderItems, salesOrderItems.productId, 'part of a sales order');
    await used(saleItems, saleItems.productId, 'part of a recorded sale');
    await used(warranties, warranties.productId, 'has a warranty record');
    await used(
      stockMovements,
      stockMovements.productId,
      'has sale or transfer history in the stock ledger',
      sql`${stockMovements.type} not in (${sql.join(ERASABLE_MOVEMENT_TYPES.map((t) => sql`${t}`), sql`, `)})`
    );

    const blocked = rows
      .filter((r) => reasons.has(r.id))
      .map((r) => ({ id: r.id, sku: r.sku, name: r.name, reason: reasons.get(r.id)! }));
    const blockedIds = new Set(blocked.map((b) => b.id));
    const erasable = rows.filter((r) => !blockedIds.has(r.id)).map((r) => r.id);

    let units = 0;
    if (erasable.length) {
      const [sum] = await tx
        .select({ n: sql<number>`coalesce(sum(${warehouseStocks.available}), 0)::int` })
        .from(warehouseStocks)
        .where(inArray(warehouseStocks.productId, erasable));
      units = Number(sum?.n || 0);
    }

    if (!dryRun) {
      if (erasable.length) {
        // The ledger rows describe stock of an item that no longer exists, so they go with it.
        await tx.delete(stockMovements).where(inArray(stockMovements.productId, erasable));
        await tx.delete(stockAdjustments).where(inArray(stockAdjustments.productId, erasable));
        await tx.delete(products).where(inArray(products.id, erasable)); // warehouse_stocks cascade
      }
      if (blocked.length) {
        await tx
          .update(products)
          .set({ isArchived: true, status: 'Archived', updatedAt: new Date() })
          .where(inArray(products.id, Array.from(blockedIds)));
      }
    }

    return {
      dryRun,
      requested: wanted.length,
      deleted: erasable.length,
      archived: blocked.length,
      units,
      blocked
    };
  });
}
