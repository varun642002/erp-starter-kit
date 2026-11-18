import type { Express, Request, Response } from 'express';
import {
  CashBookError,
  LEDGER_ROLES,
  LedgerError,
  addExpense,
  getCashBank,
  getCustomerBalances,
  getCustomerStatement,
  getDaybook,
  getProfitLoss,
  getSummary,
  listExpenses,
  clearExpenses,
  removeExpense,
  resolveRange
} from '../db/ledgerService.ts';
import { actorName, getAuthContext, scopedBranch } from './context.ts';

function fail(res: Response, e: any, label: string) {
  if (e instanceof LedgerError || e instanceof CashBookError) return res.status(e.status).json({ error: e.message });
  console.error(`${label}:`, e);
  return res.status(500).json({ error: e?.message || label });
}

// Reads and writes share the same role list; returns false after sending 403.
function allowed(req: Request, res: Response): boolean {
  const { role } = getAuthContext(req);
  if (LEDGER_ROLES.includes(role)) return true;
  res.status(403).json({ error: 'Your role cannot access the financial ledger.' });
  return false;
}

function queryString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function registerLedgerRoutes(app: Express): void {
  app.get('/api/ledger/daybook', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const range = resolveRange(req.query.from, req.query.to);
      const types = queryString(req.query.type)
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      res.json(await getDaybook({ ...range, branch: scopedBranch(req), q: queryString(req.query.q), types }));
    } catch (e: any) {
      fail(res, e, 'Failed to load the day book');
    }
  });

  app.get('/api/ledger/cashbank', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const range = resolveRange(req.query.from, req.query.to);
      res.json(await getCashBank({ ...range, branch: scopedBranch(req) }));
    } catch (e: any) {
      fail(res, e, 'Failed to load the cash and bank book');
    }
  });

  app.get('/api/ledger/customers', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      res.json(await getCustomerBalances({ branch: scopedBranch(req), q: queryString(req.query.q) }));
    } catch (e: any) {
      fail(res, e, 'Failed to load customer balances');
    }
  });

  app.get('/api/ledger/customers/:customerId', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const range = resolveRange(req.query.from, req.query.to);
      res.json(await getCustomerStatement({ ...range, branch: scopedBranch(req), customerKey: req.params.customerId }));
    } catch (e: any) {
      fail(res, e, 'Failed to load the customer statement');
    }
  });

  app.get('/api/ledger/expenses', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const range = resolveRange(req.query.from, req.query.to);
      res.json(await listExpenses({ ...range, branch: scopedBranch(req), category: queryString(req.query.category) }));
    } catch (e: any) {
      fail(res, e, 'Failed to load expenses');
    }
  });

  app.post('/api/ledger/expenses', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const { isOwner, branchId } = getAuthContext(req);
      const body = req.body || {};
      const requested = typeof body.branchId === 'string' ? body.branchId : '';
      const branch = isOwner ? requested : branchId;
      if (!branch || branch === 'all') return res.status(400).json({ error: 'Select a specific branch to record an expense.' });
      const created = await addExpense({
        branchId: branch,
        date: body.date,
        category: body.category,
        vendor: body.vendor,
        amount: body.amount,
        method: body.method,
        description: body.description,
        createdBy: actorName(req, body.createdBy) || undefined
      });
      res.status(201).json(created);
    } catch (e: any) {
      fail(res, e, 'Failed to record the expense');
    }
  });

  // Owner only. Without confirm it only reports what would be removed.
  app.post('/api/ledger/expenses/clear', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const { isOwner } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Only an owner can delete all expenses.' });
      const confirmed = req.body?.confirm === 'DELETE';
      res.json(await clearExpenses({ branch: scopedBranch(req), dryRun: !confirmed }));
    } catch (e: any) {
      fail(res, e, 'Failed to delete the expenses');
    }
  });

  app.delete('/api/ledger/expenses/:id', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const { isOwner, branchId } = getAuthContext(req);
      await removeExpense(req.params.id, { isOwner, branchId });
      res.json({ success: true });
    } catch (e: any) {
      fail(res, e, 'Failed to delete the expense');
    }
  });

  app.get('/api/ledger/pnl', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      const range = resolveRange(req.query.from, req.query.to);
      res.json(await getProfitLoss({ ...range, branch: scopedBranch(req) }));
    } catch (e: any) {
      fail(res, e, 'Failed to load the profit and loss statement');
    }
  });

  app.get('/api/ledger/summary', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    try {
      res.json(await getSummary(scopedBranch(req)));
    } catch (e: any) {
      fail(res, e, 'Failed to load the ledger summary');
    }
  });
}
