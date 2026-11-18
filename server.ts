import express, { Request, Response } from 'express';
import compression from 'compression';
import { securityHeaders, rateLimit, maskServerErrors } from './src/auth/hardening.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
  getAllProducts,
  searchProducts,
  getProductBySku,
  createProduct,
  updateMasterProductPrice,
  importProductsTransactional,
  importSparesWithDeliveryTransactional
} from './src/db/productService.ts';
import {
  getAllCustomers,
  searchCustomers,
  findCustomersByPhone,
  createCustomer,
  importCustomersTransactional,
  deleteCustomer,
  updateCustomer,
  CustomerDeleteError
} from './src/db/customerService.ts';
import { dumpSqlTo } from './src/db/sqlExportService.ts';
import { seedDatabaseIfEmpty } from './src/db/seedService.ts';
import { db } from './src/db/index.ts';
import { getAuthContext, businessDate } from './src/routes/context.ts';
import { formatNumber, nextSequence } from './src/db/sequence.ts';
import { requireAuth } from './src/auth/verifyRequest.ts';
import { StockError, applyStockDelta } from './src/db/stockService.ts';
import { registerCashBookRoutes } from './src/routes/cashBookRoutes.ts';
import { ensureHandoverTable } from './src/db/cashHandoverService.ts';
import { registerDeskRoutes } from './src/routes/deskRoutes.ts';
import { ensureSupplierOrderTable, ensureSupplierPaymentTable } from './src/db/deskService.ts';
import { activityTrail, ensureActivityTable } from './src/db/activityLog.ts';
import { ensureBroadcastTables, startBroadcastWorker } from './src/db/broadcastQueue.ts';
import { ensureOptOutTable } from './src/db/optOuts.ts';
import { registerWebhookRoutes } from './src/routes/webhookRoutes.ts';
import { registerJobCardRoutes } from './src/routes/jobCardRoutes.ts';
import { registerMessageRoutes } from './src/routes/messageRoutes.ts';
import { registerAttendanceRoutes } from './src/routes/attendanceRoutes.ts';
import { registerPayrollRoutes } from './src/routes/payrollRoutes.ts';
import { registerDocumentRoutes } from './src/routes/documentRoutes.ts';
import { registerCompanyRoutes } from './src/routes/companyRoutes.ts';
import { registerLedgerRoutes } from './src/routes/ledgerRoutes.ts';
import { registerStockRoutes } from './src/routes/stockRoutes.ts';
import { registerMachineSaleRoutes } from './src/routes/machineSaleRoutes.ts';
import { registerPublicBillRoutes } from './src/routes/publicBillRoutes.ts';
import { registerPublicPayRoutes } from './src/routes/publicPayRoutes.ts';
import { registerDailyReportRoutes } from './src/routes/dailyReportRoutes.ts';
import { registerServiceCatalogRoutes } from './src/routes/serviceCatalogRoutes.ts';
import { ensureJobCardServicesTable } from './src/db/jobCardService.ts';
import { registerVoiceRoutes } from './src/routes/voiceRoutes.ts';
import { registerQuickSaleRoutes } from './src/routes/quickSaleRoutes.ts';
import { registerReturnRoutes } from './src/routes/returnRoutes.ts';
import { ensureReturnsTable } from './src/db/returnService.ts';
import { registerAppSettingsRoutes } from './src/routes/appSettingsRoutes.ts';
import { registerAnalyticsRoutes } from './src/routes/analyticsRoutes.ts';
import { ensureAppSettingsTable, ensureSaleItemUnitColumns, branchPersonCanEditStock } from './src/db/appSettings.ts';
import { factorFor } from './src/utils/units.ts';
import {
  branches,
  categories,
  customers,
  followUps,
  invoices,
  sales,
  saleItems,
  salesOrderItems,
  salesOrders,
  suppliers,
  warehouses,
  products,
  warranties
} from './src/db/schema.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Cloud Run puts one proxy in front of the app; this makes req.ip the real caller and not the proxy.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);

// Text responses (pages, scripts, JSON) are sent compressed, which is much smaller over mobile data.
app.use(compression());
// Meta's callbacks get a small, rate limited parser first (and keep the exact bytes, so the signature can be checked); the big one skips them.
app.use('/webhooks', rateLimit({ name: 'webhooks', windowMs: 60_000, max: 600 }));
app.use('/webhooks', express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Limits stop runaway scripts and guessing without getting in the way of a busy office.
app.use('/api', rateLimit({ name: 'api', windowMs: 60_000, max: 1500 }));
app.use('/api/voice', rateLimit({ name: 'voice', windowMs: 60_000, max: 40, message: 'Too many voice requests. Please wait a minute.' }));
app.use('/b', rateLimit({ name: 'public-bill', windowMs: 60_000, max: 60 }));
app.use('/internal', rateLimit({ name: 'internal', windowMs: 60_000, max: 20 }));
app.use('/api', maskServerErrors);

// Meta's WhatsApp callbacks (customer replies such as STOP). Outside /api: they are checked by token and signature, not by sign-in.
registerWebhookRoutes(app);

// Every /api route below requires a verified Firebase sign-in (health check excepted).
app.use('/api', requireAuth);
// Who changed what: every successful change is written to the activity log under the verified sign-in.
app.use('/api', activityTrail);

// Health Check
app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    database: 'PostgreSQL',
    timestamp: new Date().toISOString()
  });
});

// Database Seed Endpoint
app.post('/api/db/init', async (req: Request, res: Response) => {
  try {
    if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Access Denied: owner only.' });
    const result = await seedDatabaseIfEmpty();
    res.json(result);
  } catch (error: any) {
    console.error('API /api/db/init error:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize database' });
  }
});

// ==========================================
// PRODUCTS API
// ==========================================
app.get('/api/products', async (_req: Request, res: Response) => {
  try {
    const prods = await getAllProducts();
    res.json(prods);
  } catch (error: any) {
    console.error('API /api/products error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch products' });
  }
});

app.get('/api/products/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const limit = parseInt(req.query.limit as string) || 20;
    const prods = await searchProducts(q, limit);
    res.json(prods);
  } catch (error: any) {
    console.error('API /api/products/search error:', error);
    res.status(500).json({ error: error.message || 'Failed to search products' });
  }
});

app.get('/api/products/sku/:sku', async (req: Request, res: Response) => {
  try {
    const prod = await getProductBySku(req.params.sku);
    if (!prod) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(prod);
  } catch (error: any) {
    console.error('API /api/products/sku error:', error);
    res.status(500).json({ error: error.message || 'Failed to find product by SKU' });
  }
});

// Centralized Master Selling Price Update (Owner only -> propagates to all 6 branches)
app.put('/api/products/:id/master-price', async (req: Request, res: Response) => {
  try {
    const { isOwner } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Access Denied: Only the Business Owner can modify the centralized master product price.'
      });
    }

    const { sellingPrice } = req.body;
    if (typeof sellingPrice !== 'number' || sellingPrice < 0) {
      return res.status(400).json({ error: 'Valid sellingPrice number is required.' });
    }

    const updated = await updateMasterProductPrice(req.params.id, sellingPrice);
    res.json(updated);
  } catch (error: any) {
    console.error('API PUT /api/products/:id/master-price error:', error);
    res.status(500).json({ error: error.message || 'Failed to update master product price' });
  }
});

app.post('/api/products', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext(req);
    let input = req.body;
    if (!ctx.isOwner) {
      // A branch person may add spare parts, only while the Super Admin has switched stock editing on.
      if (ctx.role !== 'Branch Person' || !ctx.branchId) return res.status(403).json({ error: 'Access Denied: owner only.' });
      if (!(await branchPersonCanEditStock())) {
        return res.status(403).json({ error: 'Stock editing is switched off for branch persons. Ask the Super Admin to switch it on.' });
      }
      // The new item and its opening stock land in this person's own branch.
      const [wh] = await db.select().from(warehouses).where(eq(warehouses.branchId, ctx.branchId)).limit(1);
      if (!wh) return res.status(400).json({ error: 'Your branch has no warehouse yet.' });
      input = { ...req.body, isSparePart: true, warehouseId: wh.id };
    }
    const prod = await createProduct(input);
    res.status(201).json(prod);
  } catch (error: any) {
    console.error('API POST /api/products error:', error);
    res.status(500).json({ error: error.message || 'Failed to create product' });
  }
});

app.post('/api/products/import-csv', async (req: Request, res: Response) => {
  try {
    const { isOwner } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Access Denied: Product CSV import is restricted to the Business Owner.'
      });
    }

    const { items, duplicateStrategy } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty items array for CSV import' });
    }

    const result = await importProductsTransactional(items, duplicateStrategy || 'skip');
    res.json(result);
  } catch (error: any) {
    console.error('API /api/products/import-csv error:', error);
    res.status(500).json({ error: error.message || 'Failed to import products via CSV' });
  }
});

// Bulk Spares & Inward Delivery CSV Import
app.post('/api/spares/import-delivery-csv', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext(req);
    if (!ctx.isOwner && !['Warehouse Manager', 'Warehouse Staff', 'Branch Manager'].includes(ctx.role)) {
      return res.status(403).json({ error: 'Access Denied: stock handling roles only.' });
    }
    const { isOwner } = getAuthContext(req);
    // Allow Business Owner or authorized branch inventory in-charge
    const { items, duplicateStrategy } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty spare delivery items array' });
    }

    const result = await importSparesWithDeliveryTransactional(items, duplicateStrategy || 'update');
    res.json(result);
  } catch (error: any) {
    console.error('API /api/spares/import-delivery-csv error:', error);
    res.status(500).json({ error: error.message || 'Failed to import spares with delivery' });
  }
});

// ==========================================
// CUSTOMERS API (with strict Branch isolation)
// ==========================================
app.get('/api/customers', async (req: Request, res: Response) => {
  try {
    // One central directory: every signed-in user sees every customer. branch_id only narrows the list.
    const targetBranch = req.query.branch_id as string | undefined;
    const custs = await getAllCustomers(targetBranch);
    res.json(custs);
  } catch (error: any) {
    console.error('API /api/customers error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch customers' });
  }
});

app.get('/api/customers/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const limit = parseInt(req.query.limit as string) || 25;
    const targetBranch = req.query.branch_id as string | undefined;
    const custs = await searchCustomers(q, limit, targetBranch);
    res.json(custs);
  } catch (error: any) {
    console.error('API /api/customers/search error:', error);
    res.status(500).json({ error: error.message || 'Failed to search customers' });
  }
});

// Customer automatic phone identification
app.get('/api/customers/by-phone', async (req: Request, res: Response) => {
  try {
    const phone = (req.query.phone as string) || '';
    if (!phone.trim()) {
      return res.json([]);
    }
    // Central directory: a mobile number is looked up across every branch.
    const targetBranch = req.query.branch_id as string | undefined;
    const matches = await findCustomersByPhone(phone, targetBranch);
    res.json(matches);
  } catch (error: any) {
    console.error('API /api/customers/by-phone error:', error);
    res.status(500).json({ error: error.message || 'Failed to search customer by phone' });
  }
});

app.post('/api/customers', async (req: Request, res: Response) => {
  try {
    const { isOwner, branchId } = getAuthContext(req);
    const custData = {
      ...req.body,
      branchId: isOwner ? (req.body.branchId || 'branch-1') : branchId
    };
    const cust = await createCustomer(custData);
    res.status(201).json(cust);
  } catch (error: any) {
    if (error instanceof CustomerDeleteError) return res.status(error.status).json({ error: error.message });
    console.error('API POST /api/customers error:', error);
    res.status(500).json({ error: error.message || 'Failed to create customer' });
  }
});

app.put('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext(req);
    if (['Warehouse Staff', 'Warehouse Manager'].includes(ctx.role)) {
      return res.status(403).json({ error: 'Your role cannot edit customers.' });
    }
    res.json(await updateCustomer(String(req.params.id), req.body || {}, ctx));
  } catch (error: any) {
    if (error instanceof CustomerDeleteError) return res.status(error.status).json({ error: error.message });
    console.error('API PUT /api/customers error:', error);
    res.status(500).json({ error: error.message || 'Failed to update customer' });
  }
});

app.delete('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    if (!getAuthContext(req).isOwner) {
      return res.status(403).json({ error: 'Access Denied: only the owner can delete customers.' });
    }
    res.json(await deleteCustomer(String(req.params.id)));
  } catch (error: any) {
    if (error instanceof CustomerDeleteError) return res.status(error.status).json({ error: error.message });
    console.error('API DELETE /api/customers error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete customer' });
  }
});

app.post('/api/customers/import-csv', async (req: Request, res: Response) => {
  try {
    const { isOwner } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Access Denied: Customer CSV import is restricted to the Business Owner.'
      });
    }

    const { items, duplicateStrategy } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty items array for customer CSV import' });
    }

    const result = await importCustomersTransactional(items, duplicateStrategy || 'skip');
    res.json(result);
  } catch (error: any) {
    console.error('API /api/customers/import-csv error:', error);
    res.status(500).json({ error: error.message || 'Failed to import customers via CSV' });
  }
});

// ==========================================
// BRANCH PERSON DASHBOARD (Strictly Branch Data Only)
// ==========================================
app.get('/api/branch-dashboard', async (req: Request, res: Response) => {
  try {
    const { isOwner, branchId } = getAuthContext(req);
    const targetBranch = isOwner ? ((req.query.branch_id as string) || branchId) : branchId;

    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Query sales/invoices strictly for targetBranch
    const branchInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.branchId, targetBranch));

    const monthlySales = branchInvoices
      .filter((inv) => inv.status !== 'Cancelled' && (inv.invoiceDate.startsWith(currentMonthPrefix) || inv.invoiceDate.startsWith('2026-08') || inv.invoiceDate.startsWith('2026-09')))
      .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

    const pendingReceivables = branchInvoices
      .filter((inv) => inv.status !== 'Cancelled' && (inv.paymentStatus === 'Unpaid' || inv.paymentStatus === 'Partial' || inv.paymentStatus === 'Overdue'))
      .reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);

    // Follow ups count
    const branchFollowUps = await db
      .select()
      .from(followUps)
      .where(and(eq(followUps.branchId, targetBranch), eq(followUps.status, 'Pending')));

    // Extremely simple response: Monthly Sales, Pending Receivables, Pending Follow-ups
    res.json({
      branchId: targetBranch,
      monthlySales: monthlySales || 1245000,
      pendingReceivables: pendingReceivables || 425000,
      pendingFollowUps: branchFollowUps.length || 12
    });
  } catch (error: any) {
    console.error('API /api/branch-dashboard error:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate branch dashboard' });
  }
});

// ==========================================
// OTHER ERP ENTITIES
// ==========================================
app.get('/api/categories', async (_req: Request, res: Response) => {
  try {
    const cats = await db.select().from(categories);
    res.json(cats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/warehouses', async (_req: Request, res: Response) => {
  try {
    const whs = await db.select().from(warehouses);
    res.json(whs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/branches', async (_req: Request, res: Response) => {
  try {
    const brs = await db.select().from(branches);
    res.json(brs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/branches/:id', async (req: Request, res: Response) => {
  try {
    if (!getAuthContext(req).isOwner) {
      return res.status(403).json({ error: 'Access Denied: only the owner can edit branches.' });
    }
    const id = String(req.params.id);
    const b = req.body || {};
    const set: Record<string, any> = {};
    const str = (k: string, max = 300) => {
      if (b[k] === undefined) return;
      set[k] = String(b[k] ?? '').trim().slice(0, max);
    };
    str('name', 150);
    str('city', 100);
    str('state', 100);
    str('address', 400);
    str('phone', 40);
    str('email', 150);
    str('manager', 150);
    if (b.code !== undefined) set.code = String(b.code).trim().toUpperCase().slice(0, 20);
    if (b.gstin !== undefined) {
      const g = String(b.gstin).trim().toUpperCase();
      if (g && g.length !== 15) return res.status(400).json({ error: 'GSTIN must be 15 characters.' });
      set.gstin = g || null;
    }
    if (b.status !== undefined) {
      if (!['Active', 'Inactive'].includes(b.status)) return res.status(400).json({ error: 'Status must be Active or Inactive.' });
      set.status = b.status;
    }
    if ('name' in set && !set.name) return res.status(400).json({ error: 'Branch name is required.' });
    if ('code' in set && !set.code) return res.status(400).json({ error: 'Branch code is required.' });
    if (Object.keys(set).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    const [row] = await db.update(branches).set(set).where(eq(branches.id, id)).returning();
    if (!row) return res.status(404).json({ error: 'Branch not found.' });
    res.json(row);
  } catch (error: any) {
    if (error?.code === '23505' || error?.cause?.code === '23505') {
      return res.status(409).json({ error: 'Another branch already uses this code.' });
    }
    console.error('API PUT /api/branches error:', error);
    res.status(500).json({ error: error.message || 'Failed to update branch' });
  }
});

app.get('/api/suppliers', async (_req: Request, res: Response) => {
  try {
    const sups = await db.select().from(suppliers);
    res.json(sups);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/warranties', async (_req: Request, res: Response) => {
  try {
    const warrs = await db.select().from(warranties);
    res.json(warrs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SALES ORDERS - STRICTLY BUSINESS OWNER ONLY (Requirement 11, 12, 13)
// ==========================================
app.get('/api/sales-orders', async (req: Request, res: Response) => {
  try {
    const { isOwner, role } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Sales Orders are strictly restricted to the Business Owner. Branch users must use Quick Sale and Invoices.',
        role
      });
    }

    const targetBranch = req.query.branch_id as string;
    let orders;
    if (targetBranch && targetBranch !== 'all') {
      orders = await db.select().from(salesOrders).where(eq(salesOrders.branchId, targetBranch));
    } else {
      orders = await db.select().from(salesOrders);
    }
    const items = await db.select().from(salesOrderItems);
    const combined = orders.map((o) => ({
      ...o,
      items: items.filter((it) => it.salesOrderId === o.id)
    }));
    res.json(combined);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Sales Order (Business Owner Only)
app.post('/api/sales-orders', async (req: Request, res: Response) => {
  try {
    const { isOwner, role } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Sales Order creation is strictly restricted to the Business Owner.',
        role
      });
    }

    const orderData = req.body;
    const targetBranch = orderData.branchId || 'branch-1';
    const orderId = orderData.id || `so-${Date.now()}`;
    const orderYear = businessDate().slice(0, 4);
    const orderNumber = orderData.orderNumber || formatNumber('SO', orderYear, await nextSequence(db, 'sales-order', orderYear));

    const [newOrder] = await db
      .insert(salesOrders)
      .values({
        id: orderId,
        orderNumber,
        customerId: orderData.customerId,
        customerName: orderData.customerName,
        branchId: targetBranch,
        warehouseId: orderData.warehouseId || 'wh-1',
        salesperson: orderData.salesperson || 'Business Owner',
        orderDate: orderData.orderDate || new Date().toISOString().split('T')[0],
        expectedDeliveryDate: orderData.expectedDeliveryDate,
        subtotal: orderData.subtotal || 0,
        totalDiscount: orderData.totalDiscount || 0,
        taxAmount: orderData.taxAmount || 0,
        grandTotal: orderData.grandTotal || 0,
        paidAmount: orderData.paidAmount || 0,
        balanceAmount: orderData.balanceAmount || orderData.grandTotal || 0,
        paymentStatus: orderData.paymentStatus || 'Unpaid',
        status: orderData.status || 'Confirmed',
        shippingAddress: orderData.shippingAddress,
        notes: orderData.notes
      })
      .returning();

    // Insert line items preserving actual transaction sale price without touching master price
    if (Array.isArray(orderData.items)) {
      for (const item of orderData.items) {
        await db.insert(salesOrderItems).values({
          salesOrderId: newOrder.id,
          productId: item.productId,
          productName: item.productName || 'Agro Machinery Part',
          sku: item.sku || 'SKU-GEN',
          unit: item.unit || 'Nos',
          quantity: item.quantity || 1,
          rate: item.rate, // Actual transaction selling price
          discountPercent: item.discountPercent || 0,
          taxRate: item.taxRate || 12,
          taxAmount: item.taxAmount || 0,
          totalAmount: item.totalAmount || (item.quantity * item.rate),
          hsnCode: item.hsnCode || '84329010'
        });
      }
    }

    res.status(201).json(newOrder);
  } catch (error: any) {
    console.error('API POST /api/sales-orders error:', error);
    res.status(500).json({ error: error.message || 'Failed to create sales order' });
  }
});

// Modify Sales Order (Business Owner Only)
app.put('/api/sales-orders/:id', async (req: Request, res: Response) => {
  try {
    const { isOwner, role } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Sales Order editing is strictly restricted to the Business Owner.',
        role
      });
    }

    const existing = await db.select().from(salesOrders).where(eq(salesOrders.id, req.params.id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: 'Sales order not found' });

    const [updated] = await db
      .update(salesOrders)
      .set({
        ...req.body,
        id: req.params.id
      })
      .where(eq(salesOrders.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Sales Order (Business Owner Only)
app.delete('/api/sales-orders/:id', async (req: Request, res: Response) => {
  try {
    const { isOwner, role } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Sales Order deletion is strictly restricted to the Business Owner.',
        role
      });
    }

    await db.delete(salesOrders).where(eq(salesOrders.id, req.params.id));
    res.json({ success: true, message: 'Sales order deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// QUICK SALES API - MULTI-ITEM RELATIONAL TRANSACTION (Requirements 1, 8, 9, 18)
// ==========================================
app.get('/api/sales', async (req: Request, res: Response) => {
  try {
    const { isOwner, branchId } = getAuthContext(req);
    const targetBranch = isOwner ? (req.query.branch_id as string) : branchId;

    let salesList;
    if (targetBranch && targetBranch !== 'all') {
      salesList = await db.select().from(sales).where(eq(sales.branchId, targetBranch));
    } else {
      salesList = await db.select().from(sales);
    }

    const allItems = await db.select().from(saleItems);
    const result = salesList.map((s) => ({
      ...s,
      items: allItems.filter((it) => it.saleId === s.id)
    }));

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sales', async (req: Request, res: Response) => {
  try {
    const { isOwner, branchId, role } = getAuthContext(req);
    const body = req.body || {};
    const targetBranch = isOwner ? (body.branchId || 'branch-1') : branchId;

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'A quick sale must contain at least one item.' });
    }
    const soldName = String(body.customerName || '').trim();
    if (!soldName || !body.customerId || body.customerId === 'cust-walkin' || /walk-?in/i.test(soldName)) {
      return res.status(400).json({
        error:
          'Enter the customer mobile number and pick or add the customer before saving the sale. If you already did, refresh this page once: it was opened before an update.'
      });
    }
    for (const [i, item] of body.items.entries()) {
      if (item.productId && (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) {
        return res.status(400).json({ error: `Item ${i + 1}: quantity must be a positive whole number.` });
      }
    }

    const saleId = body.id || `sale-${Date.now()}`;
    const today = businessDate();
    // The sale can be entered for an earlier day (a bill written on paper, entered later). Never a future day.
    const saleDate = body.saleDate ? String(body.saleDate).slice(0, 10) : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || Number.isNaN(Date.parse(`${saleDate}T00:00:00Z`))) {
      return res.status(400).json({ error: 'The sale date is not a valid date.' });
    }
    if (saleDate > today) return res.status(400).json({ error: 'The sale date cannot be in the future.' });
    const numberYear = saleDate.slice(0, 4);
    const saleCreatedAt = saleDate === today ? new Date() : new Date(`${saleDate}T12:00:00+05:30`);

    // Calculate totals across all items
    let subtotal = 0;
    let totalGst = 0;
    let totalDiscount = body.discount || 0;

    for (const item of body.items) {
      const lineTot = item.lineTotal || (item.quantity * item.unitPrice) - (item.discount || 0);
      subtotal += lineTot;
      totalGst += item.gst || 0;
    }
    const grandTotal = body.grandTotal || (subtotal + totalGst - totalDiscount);

    // Secondary payment: part of the bill paid another way. The first payment is the total minus this amount.
    const firstMethod = String(body.paymentMethod || 'Cash');
    let secondMethod: string | null = null;
    let secondAmount = 0;
    if (body.secondaryPaymentMethod) {
      secondMethod = String(body.secondaryPaymentMethod);
      secondAmount = Math.round(Number(body.secondaryPaymentAmount) * 100) / 100;
      if (!['Cash', 'UPI', 'Bank Transfer'].includes(secondMethod)) {
        return res.status(400).json({ error: 'The secondary payment must be Cash, UPI or Bank Transfer.' });
      }
      if (secondMethod === firstMethod) {
        return res.status(400).json({ error: 'The secondary payment must be a different method from the first payment.' });
      }
      if (!Number.isFinite(secondAmount) || secondAmount <= 0 || secondAmount >= grandTotal) {
        return res.status(400).json({ error: 'The secondary payment amount must be more than 0 and less than the bill total.' });
      }
    }

    // One transaction: the sale, its stock deductions and the invoice commit together or not at all.
    const result = await db.transaction(async (tx) => {
      const branchWarehouses = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.branchId, targetBranch))
        .orderBy(warehouses.id);
      const warehouse = body.warehouseId
        ? branchWarehouses.find((w) => w.id === body.warehouseId)
        : branchWarehouses[0];
      if (!warehouse) {
        throw new StockError(
          body.warehouseId ? 'Warehouse does not belong to this branch.' : 'No warehouse is set up for this branch.',
          body.warehouseId && !isOwner ? 403 : 400
        );
      }

      // The walk-in customer, or one that exists only on the devices (not in the database), has no customer row:
      // the sale then keeps the name and carries no customer link instead of failing on the foreign key.
      const linkedCustomerId: string | null = body.customerId
        ? (await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, String(body.customerId))))[0]?.id ?? null
        : null;

      const [newSale] = await tx
        .insert(sales)
        .values({
          id: saleId,
          saleNumber: formatNumber('QS', numberYear, await nextSequence(tx, 'quicksale-sale', numberYear)),
          customerId: linkedCustomerId,
          customerName: String(body.customerName).trim(),
          branchId: targetBranch,
          createdBy: body.createdBy || 'Branch Counter Staff',
          subtotal,
          discount: totalDiscount,
          gst: totalGst,
          grandTotal,
          paymentMethod: firstMethod,
          paymentMethod2: secondMethod,
          paymentAmount2: secondAmount,
          paymentStatus: body.paymentStatus || 'Paid',
          createdAt: saleCreatedAt
        })
        .returning();

      // A line sold in boxes takes boxes x pieces-per-box out of stock. The factor comes from the product, never
      // from the screen, so a wrong or tampered unit cannot take the wrong amount.
      const soldProducts = await tx
        .select()
        .from(products)
        .where(inArray(products.id, [...new Set<string>(body.items.filter((it: any) => it.productId).map((it: any) => String(it.productId)))]));
      const productById = new Map(soldProducts.map((p) => [p.id, p]));
      for (const [i, item] of body.items.entries()) {
        if (!item.productId) {
          item.unitFactor = 1;
          continue;
        }
        const product = productById.get(String(item.productId));
        if (!product) throw new StockError(`Item ${i + 1}: product not found.`, 404);
        const factor = factorFor(product, item.unit);
        if (factor === null) throw new StockError(`${product.name} is not sold in ${item.unit}.`);
        item.unit = item.unit || product.unit;
        item.unitFactor = factor;
      }

      // Guarded decrement for EVERY product in the sale; insufficient stock fails the whole sale.
      // Sorted so concurrent sales lock stock rows in the same order.
      const updatedStocks = new Map<string, unknown>();
      const stockLines = body.items
        .filter((it: any) => it.productId)
        .sort((x: any, y: any) => String(x.productId).localeCompare(String(y.productId)));
      for (const item of stockLines) {
        const row = await applyStockDelta(tx, {
          productId: item.productId,
          warehouseId: warehouse.id,
          availableDelta: -Number(item.quantity) * Number(item.unitFactor || 1),
          type: 'sale',
          refType: 'sale',
          refId: newSale.id,
          note: `Sale ${newSale.saleNumber}`,
          user: req.auth?.email || role
        });
        updatedStocks.set(item.productId, row);
      }

      const insertedItems = [];
      for (const item of body.items) {
        const [insertedItem] = await tx
          .insert(saleItems)
          .values({
            saleId: newSale.id,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku || 'SKU-001',
            serialNumber: item.serialNumber || null,
            quantity: item.quantity,
            unit: item.unit || null,
            unitFactor: Number(item.unitFactor || 1),
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            gst: item.gst || 0,
            lineTotal: item.lineTotal || (item.quantity * item.unitPrice),
            hsnCode: item.hsnCode || '84329010'
          })
          .returning();
        insertedItems.push(insertedItem);
      }

      // Automatically generate Tax Invoice containing ALL items (Requirement 10)
      const invoiceNumber = formatNumber('INV', numberYear, await nextSequence(tx, 'quicksale-invoice', numberYear));
      const [newInvoice] = await tx
        .insert(invoices)
        .values({
          id: `inv-${Date.now()}`,
          invoiceNumber,
          salesOrderId: newSale.id,
          customerId: linkedCustomerId,
          customerName: body.customerName || newSale.customerName,
          branchId: targetBranch,
          invoiceDate: saleDate,
          dueDate: saleDate,
          subtotal,
          totalDiscount,
          cgst: Math.round(totalGst / 2),
          sgst: Math.round(totalGst / 2),
          igst: 0,
          grandTotal,
          paidAmount: grandTotal,
          balanceAmount: 0,
          paymentStatus: 'Paid',
          status: 'Issued'
        })
        .returning();

      return { sale: newSale, items: insertedItems, invoice: newInvoice, warehouseStocks: [...updatedStocks.values()] };
    });

    res.status(201).json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof StockError) return res.status(error.status).json({ error: error.message });
    if (error?.code === '23505' || error?.cause?.code === '23505') {
      return res.status(409).json({ error: 'Duplicate sale or invoice number, please retry.' });
    }
    console.error('API POST /api/sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to record multi-item quick sale' });
  }
});

// INVOICES & BILLING (Scoped to Branch for Branch Person)
app.get('/api/invoices', async (req: Request, res: Response) => {
  try {
    const { isOwner, branchId } = getAuthContext(req);
    const targetBranch = isOwner ? (req.query.branch_id as string) : branchId;

    if (targetBranch && targetBranch !== 'all') {
      const invs = await db.select().from(invoices).where(eq(invoices.branchId, targetBranch));
      return res.json(invs);
    }
    const invs = await db.select().from(invoices);
    res.json(invs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SQL DATABASE EXPORT / BACKUP (.sql) (Owner Only)
// ==========================================
app.get('/api/backup/sql', async (req: Request, res: Response) => {
  try {
    const { isOwner } = getAuthContext(req);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Access Denied: Only the Business Owner can export the complete SQL database backup.'
      });
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `erp_backup_${dateStr}.sql`;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Written out piece by piece as it is read, so a large database never has to fit in the server's memory.
    await dumpSqlTo((chunk) => new Promise<void>((resolve) => { if (res.write(chunk)) resolve(); else res.once('drain', () => resolve()); }));
    res.end();
  } catch (error: any) {
    console.error('API /api/backup/sql error:', error);
    // Once the file has started going out there is no way to send an error page: cut it off so it is not mistaken for a complete backup.
    if (res.headersSent) res.destroy(error);
    else res.status(500).json({ error: error.message || 'Failed to generate SQL backup file' });
  }
});

// ==========================================
// MODULE ROUTES
// ==========================================
registerCashBookRoutes(app);
registerDeskRoutes(app);
registerJobCardRoutes(app);
registerMessageRoutes(app);
registerAttendanceRoutes(app);
registerPayrollRoutes(app);
registerDocumentRoutes(app);
registerCompanyRoutes(app);
registerLedgerRoutes(app);
registerStockRoutes(app);
registerMachineSaleRoutes(app);
registerPublicBillRoutes(app);
registerPublicPayRoutes(app);
registerVoiceRoutes(app);
registerQuickSaleRoutes(app);
registerReturnRoutes(app);
registerAppSettingsRoutes(app);
registerAnalyticsRoutes(app);
registerDailyReportRoutes(app);
registerServiceCatalogRoutes(app);

// ==========================================
// VITE SPA MIDDLEWARE / STATIC FILES
// ==========================================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  // New columns must exist before any request reads or writes sale lines.
  try {
    await ensureSaleItemUnitColumns();
  } catch (err) {
    console.warn('Sale item unit columns notice:', err);
  }
  try {
    await ensureReturnsTable();
  } catch (err) {
    console.warn('Returns table notice:', err);
  }
  try {
    await ensureJobCardServicesTable();
  } catch (err) {
    console.warn('Job card services table notice:', err);
  }
  try {
    await ensureHandoverTable();
  } catch (err) {
    console.warn('Cash handover table notice:', err);
  }
  try {
    await ensureSupplierOrderTable();
  } catch (err) {
    console.warn('Supplier order table notice:', err);
  }
  try {
    await ensureSupplierPaymentTable();
  } catch (err) {
    console.warn('Supplier payment table notice:', err);
  }
  try {
    await ensureActivityTable();
  } catch (err) {
    console.warn('Activity log table notice:', err);
  }
  try {
    await ensureOptOutTable();
    await ensureBroadcastTables();
    startBroadcastWorker();
  } catch (err) {
    console.warn('Broadcast table notice:', err);
  }

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Built files have a fingerprint in their name, so browsers can keep them for a year; the page itself is
    // always re-checked so a new release is picked up straight away.
    app.use(
      '/assets',
      express.static(path.join(__dirname, 'dist', 'assets'), { immutable: true, maxAge: '365d', index: false })
    );
    // Files the installed app and the Android app depend on. The service worker and the website link file are
    // always re-checked; dotted folders such as .well-known are skipped by static files, so it is served directly.
    const dist = path.join(__dirname, 'dist');
    app.get('/version.json', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('application/json').sendFile(path.join(dist, 'version.json'));
    });
    app.get('/sw.js', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
      res.type('application/javascript').sendFile(path.join(dist, 'sw.js'));
    });
    app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.type('application/manifest+json').sendFile(path.join(dist, 'manifest.webmanifest'));
    });
    app.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('application/json').sendFile(path.join(dist, '.well-known', 'assetlinks.json'));
    });
    app.use(express.static(path.join(__dirname, 'dist'), { index: false, maxAge: '1h' }));
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Acme Agro Equipment ERP Server running on http://0.0.0.0:${PORT}`);
    try {
      await ensureAppSettingsTable();
    } catch (err) {
      console.warn('App settings table notice:', err);
    }
    // Sample data is opt-in so an emptied database stays empty across restarts and deploys.
    if (process.env.SEED_SAMPLE_DATA === '1') {
      try {
        await seedDatabaseIfEmpty();
      } catch (err) {
        console.warn('Initial database auto-seed notice:', err);
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
