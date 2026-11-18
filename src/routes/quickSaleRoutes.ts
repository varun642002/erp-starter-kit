import type { Express, Request, Response } from 'express';
import { getAuthContext, scopedBranch } from './context.ts';
import { StockError } from '../db/stockService.ts';
import { deleteQuickSale, getQuickSale, listQuickSales, quickSaleSummary, updateQuickSale } from '../db/quickSaleService.ts';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function fail(res: Response, label: string, e: any) {
  if (e instanceof StockError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  res.status(500).json({ error: e?.message || 'Request failed' });
}

// Only the Super Admin account may change or remove a recorded sale.
function requireSuperAdmin(req: Request, res: Response): boolean {
  if (getAuthContext(req).role === 'Super Admin') return true;
  res.status(403).json({ error: 'Only the Super Admin can edit or delete a quick sale.' });
  return false;
}

export function registerQuickSaleRoutes(app: Express): void {
  // Everyone signed in can read; non-owners are pinned to their own branch by scopedBranch.
  app.get('/api/quick-sales', async (req: Request, res: Response) => {
    try {
      res.json(
        await listQuickSales(scopedBranch(req), {
          q: str(req.query.q),
          customerId: str(req.query.customer_id),
          from: str(req.query.from),
          to: str(req.query.to),
          limit: Number(req.query.limit) || undefined
        })
      );
    } catch (e) {
      fail(res, 'GET /api/quick-sales', e);
    }
  });

  // Totals for the dashboards (non-owners are pinned to their own branch).
  app.get('/api/quick-sales/summary', async (req: Request, res: Response) => {
    try {
      res.json(await quickSaleSummary(scopedBranch(req)));
    } catch (e) {
      fail(res, 'GET /api/quick-sales/summary', e);
    }
  });

  app.put('/api/quick-sales/:id', async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const actor = req.auth?.email || 'Super Admin';
      const saved = await updateQuickSale(String(req.params.id), req.body || {}, actor);
      res.json(saved);
    } catch (e) {
      fail(res, 'PUT /api/quick-sales/:id', e);
    }
  });

  app.delete('/api/quick-sales/:id', async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const existing = await getQuickSale(String(req.params.id));
      if (!existing) return res.status(404).json({ error: 'Sale not found' });
      const actor = req.auth?.email || 'Super Admin';
      res.json(await deleteQuickSale(String(req.params.id), actor));
    } catch (e) {
      fail(res, 'DELETE /api/quick-sales/:id', e);
    }
  });
}
