import type { Express, Request, Response } from 'express';
import { getAuthContext, scopedBranch } from './context.ts';
import { StockError, type Actor } from '../db/stockService.ts';
import { applyCredit, createReturn, listCredits, listPurchases, listReturns, openInvoicesFor, setDamageStatus } from '../db/returnService.ts';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function fail(res: Response, label: string, e: any) {
  if (e instanceof StockError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  res.status(500).json({ error: e?.message || 'Request failed' });
}

function actorOf(req: Request): Actor {
  const { role, branchId, isOwner } = getAuthContext(req);
  return { role, branchId, isOwner, name: req.auth?.email || role };
}

export function registerReturnRoutes(app: Express): void {
  // What customers bought (counter sales and invoices), with how much of each line has already come back.
  // Non-owners are pinned to their own branch by scopedBranch.
  app.get('/api/returns/purchases', async (req: Request, res: Response) => {
    try {
      res.json(await listPurchases(scopedBranch(req), str(req.query.q), Number(req.query.limit) || undefined));
    } catch (e) {
      fail(res, 'GET /api/returns/purchases', e);
    }
  });

  // Credit customers hold with us from returns, and using it on an open invoice.
  app.get('/api/returns/credits', async (_req: Request, res: Response) => {
    try {
      res.json(await listCredits());
    } catch (e) {
      fail(res, 'GET /api/returns/credits', e);
    }
  });

  app.get('/api/returns/credits/invoices', async (req: Request, res: Response) => {
    try {
      res.json(await openInvoicesFor(scopedBranch(req), str(req.query.customer_key) || ''));
    } catch (e) {
      fail(res, 'GET /api/returns/credits/invoices', e);
    }
  });

  app.post('/api/returns/credits/apply', async (req: Request, res: Response) => {
    try {
      res.json(await applyCredit(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/returns/credits/apply', e);
    }
  });

  app.get('/api/returns', async (req: Request, res: Response) => {
    try {
      res.json(await listReturns(scopedBranch(req), str(req.query.q), Number(req.query.limit) || undefined, str(req.query.condition)));
    } catch (e) {
      fail(res, 'GET /api/returns', e);
    }
  });

  // What was done with a damaged return: sent to the supplier, repaired (goes back into stock) or scrapped.
  app.patch('/api/returns/:id/damage', async (req: Request, res: Response) => {
    try {
      res.json(await setDamageStatus(String(req.params.id), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'PATCH /api/returns/:id/damage', e);
    }
  });

  app.post('/api/returns', async (req: Request, res: Response) => {
    try {
      res.status(201).json(await createReturn(req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/returns', e);
    }
  });
}
