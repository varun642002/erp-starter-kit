import type { Express, Request, Response } from 'express';
import { getAuthContext, scopedBranch } from './context.ts';
import {
  StockError,
  approveTransfer,
  cancelTransfer,
  canEditProducts,
  createAdjustment,
  createAdjustmentsBatch,
  createReceipt,
  createTransfer,
  addStockDirect,
  importOpeningStock,
  dispatchTransfer,
  listAdjustments,
  listMovements,
  listReceipts,
  listTransfers,
  receiveTransfer,
  type Actor
} from '../db/stockService.ts';
import { BRANCH_PERSON_PRODUCT_FIELDS, branchPersonCanEditStock, stockEditBlocked } from '../db/appSettings.ts';
import { bulkDeleteProducts, bulkUpdateProducts, updateProduct } from '../db/productService.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof StockError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Stock request failed' });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const idParam = (req: Request) => String(req.params.id);

function actorOf(req: Request): Actor {
  const { role, branchId, isOwner } = getAuthContext(req);
  return { role, branchId, isOwner, name: req.auth?.email || role };
}

// Branch persons change stock only while the Super Admin has switched that on.
async function stockGate(req: Request, res: Response): Promise<boolean> {
  const blocked = await stockEditBlocked(getAuthContext(req).role);
  if (blocked) {
    res.status(403).json({ error: blocked });
    return true;
  }
  return false;
}

export function registerStockRoutes(app: Express): void {
  app.post('/api/stock/receipts', async (req, res) => {
    try {
      res.status(201).json(await createReceipt(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/receipts', e);
    }
  });

  app.get('/api/stock/receipts', async (req, res) => {
    try {
      res.json(await listReceipts(scopedBranch(req), { q: str(req.query.q), from: str(req.query.from), to: str(req.query.to) }));
    } catch (e) {
      fail(res, 'GET /api/stock/receipts', e);
    }
  });

  app.post('/api/stock/opening-import', async (req, res) => {
    try {
      if (await stockGate(req, res)) return;
      res.json(await importOpeningStock(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/opening-import', e);
    }
  });

  app.post('/api/stock/transfers', async (req, res) => {
    try {
      res.status(201).json(await createTransfer(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/transfers', e);
    }
  });

  app.get('/api/stock/transfers', async (req, res) => {
    try {
      res.json(await listTransfers(scopedBranch(req), { status: str(req.query.status) }));
    } catch (e) {
      fail(res, 'GET /api/stock/transfers', e);
    }
  });

  app.post('/api/stock/transfers/:id/approve', async (req, res) => {
    try {
      res.json(await approveTransfer(idParam(req), actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/transfers/:id/approve', e);
    }
  });

  app.post('/api/stock/transfers/:id/dispatch', async (req, res) => {
    try {
      res.json(await dispatchTransfer(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/transfers/:id/dispatch', e);
    }
  });

  app.post('/api/stock/transfers/:id/receive', async (req, res) => {
    try {
      res.json(await receiveTransfer(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/transfers/:id/receive', e);
    }
  });

  app.post('/api/stock/transfers/:id/cancel', async (req, res) => {
    try {
      res.json(await cancelTransfer(idParam(req), actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/transfers/:id/cancel', e);
    }
  });

  app.post('/api/stock/direct-add', async (req, res) => {
    try {
      if (await stockGate(req, res)) return;
      res.status(201).json(await addStockDirect(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/direct-add', e);
    }
  });

  app.post('/api/stock/adjustments', async (req, res) => {
    try {
      if (await stockGate(req, res)) return;
      res.status(201).json(await createAdjustment(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/adjustments', e);
    }
  });

  app.post('/api/stock/adjustments/batch', async (req, res) => {
    try {
      if (await stockGate(req, res)) return;
      res.status(201).json(await createAdjustmentsBatch(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/stock/adjustments/batch', e);
    }
  });

  app.get('/api/stock/adjustments', async (req, res) => {
    try {
      res.json(
        await listAdjustments(scopedBranch(req), {
          warehouseId: str(req.query.warehouse_id),
          productId: str(req.query.product_id)
        })
      );
    } catch (e) {
      fail(res, 'GET /api/stock/adjustments', e);
    }
  });

  app.get('/api/stock/movements', async (req, res) => {
    try {
      res.json(
        await listMovements(scopedBranch(req), {
          productId: str(req.query.product_id),
          warehouseId: str(req.query.warehouse_id),
          from: str(req.query.from),
          to: str(req.query.to),
          limit: req.query.limit
        })
      );
    } catch (e) {
      fail(res, 'GET /api/stock/movements', e);
    }
  });

  app.patch('/api/products/:id', async (req, res) => {
    try {
      const actor = actorOf(req);
      let patch = req.body || {};
      if (!canEditProducts(actor)) {
        // A branch person may correct item details (not prices, status or category) while stock editing is on.
        if (actor.role !== 'Branch Person' || !(await branchPersonCanEditStock())) {
          return res.status(403).json({ error: 'Access Denied: only owners and the Warehouse Manager can edit products.' });
        }
        // The screens send the whole item; keep only the details a branch person may change and ignore the rest
        // (prices, status, category and archiving stay with the owner and Warehouse Manager).
        const allowed = new Set<string>(BRANCH_PERSON_PRODUCT_FIELDS);
        patch = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
      }
      res.json(await updateProduct(idParam(req), patch));
    } catch (e) {
      fail(res, 'PATCH /api/products/:id', e);
    }
  });

  app.post('/api/products/bulk', async (req, res) => {
    try {
      if (!canEditProducts(actorOf(req))) {
        return res.status(403).json({ error: 'Access Denied: only owners and the Warehouse Manager can edit products.' });
      }
      res.json(await bulkUpdateProducts(req.body?.ids, req.body?.patch));
    } catch (e) {
      fail(res, 'POST /api/products/bulk', e);
    }
  });

  // Permanent removal; products with sales/billing/transfer history are archived instead.
  app.post('/api/products/bulk-delete', async (req, res) => {
    try {
      if (!canEditProducts(actorOf(req))) {
        return res.status(403).json({ error: 'Access Denied: only owners and the Warehouse Manager can delete products.' });
      }
      res.json(await bulkDeleteProducts(req.body?.ids, req.body?.dryRun === true));
    } catch (e) {
      fail(res, 'POST /api/products/bulk-delete', e);
    }
  });
}
