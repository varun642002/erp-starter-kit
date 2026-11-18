import type { Express, Request, Response } from 'express';
import {
  CashBookError,
  addEntry,
  closeDay,
  deleteEntry,
  getAllBranchesSummary,
  getDaySummary,
  getEntry,
  listClosings,
  reopenDay
} from '../db/cashBookService.ts';
import { confirmHandover, createHandover, deleteHandover, getCashInHand, listHandovers } from '../db/cashHandoverService.ts';
import { actorName, businessDate, getAuthContext, newId, scopedBranch } from './context.ts';

const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];

function fail(res: Response, e: any, label: string) {
  if (e instanceof CashBookError) return res.status(e.status).json({ error: e.message });
  console.error(`${label}:`, e);
  return res.status(500).json({ error: e.message || label });
}

// Concrete branch a write applies to: non-owners are pinned, owners must name one.
function writeBranch(req: Request): string | null {
  const { isOwner, branchId } = getAuthContext(req);
  if (!isOwner) return branchId;
  const requested = (req.body?.branchId as string) || (req.query.branch_id as string);
  return requested && requested !== 'all' ? requested : null;
}

function requestedDate(raw: unknown): string {
  return typeof raw === 'string' && raw ? raw : businessDate();
}

export function registerCashBookRoutes(app: Express): void {
  app.get('/api/cash-book/summary', async (req: Request, res: Response) => {
    try {
      const date = requestedDate(req.query.date);
      const branch = scopedBranch(req);
      if (branch === 'all') return res.json(await getAllBranchesSummary(date));
      res.json(await getDaySummary(branch, date));
    } catch (e: any) {
      fail(res, e, 'Failed to load cash book summary');
    }
  });

  app.post('/api/cash-book/entries', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to record a cash entry.' });

      const date = requestedDate(body.date);
      if (date > businessDate()) return res.status(400).json({ error: 'Entries cannot be dated in the future.' });
      if (body.type !== 'in' && body.type !== 'out') return res.status(400).json({ error: 'Type must be "in" or "out".' });
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      if (!category) return res.status(400).json({ error: 'Category is required.' });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });
      const method = body.method || 'Cash';
      if (!METHODS.includes(method)) return res.status(400).json({ error: `Method must be one of: ${METHODS.join(', ')}.` });

      const entry = await addEntry(
        {
          branchId: branch,
          date,
          type: body.type,
          category: category.slice(0, 60),
          amount,
          method,
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 300) : undefined,
          createdBy: actorName(req, body.createdBy) || undefined
        },
        newId('ce')
      );
      res.status(201).json(entry);
    } catch (e: any) {
      fail(res, e, 'Failed to add cash entry');
    }
  });

  app.delete('/api/cash-book/entries/:id', async (req: Request, res: Response) => {
    try {
      const { isOwner, branchId } = getAuthContext(req);
      const entry = await getEntry(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Cash entry not found.' });
      if (entry.id.startsWith('ce-ho-')) {
        return res.status(409).json({ error: 'This entry belongs to a cash handover. An owner can cancel the whole handover in Business Desk, under Cash in hand.' });
      }
      if (entry.id.startsWith('ce-sp-')) {
        return res.status(409).json({ error: 'This entry is a payment to a supplier. An owner can cancel the payment in Business Desk, under Supplier orders.' });
      }
      if (!isOwner && entry.branchId !== branchId) {
        return res.status(403).json({ error: 'You can only delete entries of your own branch.' });
      }
      await deleteEntry(entry.id);
      res.json({ success: true });
    } catch (e: any) {
      fail(res, e, 'Failed to delete cash entry');
    }
  });

  app.post('/api/cash-book/close', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to close the day.' });

      const date = requestedDate(body.date);
      if (date > businessDate()) return res.status(400).json({ error: 'A future day cannot be closed.' });
      const counted = Number(body.countedCash);
      if (body.countedCash === '' || body.countedCash == null || !Number.isFinite(counted) || counted < 0) {
        return res.status(400).json({ error: 'Counted cash must be a number of zero or more.' });
      }

      const closing = await closeDay(
        branch,
        date,
        counted,
        typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : undefined,
        typeof body.closedBy === 'string' ? body.closedBy : undefined,
        newId('cc')
      );
      res.status(201).json(closing);
    } catch (e: any) {
      fail(res, e, 'Failed to close the day');
    }
  });

  app.post('/api/cash-book/reopen', async (req: Request, res: Response) => {
    try {
      const { isOwner } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Only an owner can reopen a closed day.' });
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to reopen.' });
      const date = requestedDate(req.body?.date);
      const closing = await reopenDay(branch, date);
      res.json(closing);
    } catch (e: any) {
      fail(res, e, 'Failed to reopen the day');
    }
  });

  // Cash in hand at each branch (non-owners see only their own branch).
  app.get('/api/cash-book/in-hand', async (req: Request, res: Response) => {
    try {
      res.json(await getCashInHand(scopedBranch(req)));
    } catch (e: any) {
      fail(res, e, 'Failed to load the cash in hand');
    }
  });

  // Cash handed over from one branch to another (for example to the Head Office).
  app.get('/api/cash-book/handovers', async (req: Request, res: Response) => {
    try {
      res.json(await listHandovers(scopedBranch(req), Number(req.query.limit) || 60));
    } catch (e: any) {
      fail(res, e, 'Failed to load the handovers');
    }
  });

  app.post('/api/cash-book/handovers', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const { isOwner, branchId, role } = getAuthContext(req);
      // a branch user always hands over from his own branch; an owner names it
      const from = isOwner ? String(body.fromBranchId || '') : branchId;
      res.status(201).json(
        await createHandover(
          { fromBranchId: from, toBranchId: String(body.toBranchId || ''), amount: Number(body.amount), receivedBy: body.receivedBy, note: body.note },
          { name: actorName(req, body.createdBy, role), isOwner, branchId }
        )
      );
    } catch (e: any) {
      fail(res, e, 'Failed to record the handover');
    }
  });

  app.post('/api/cash-book/handovers/:id/confirm', async (req: Request, res: Response) => {
    try {
      const { isOwner, branchId, role } = getAuthContext(req);
      res.json(await confirmHandover(req.params.id, { name: actorName(req, req.body?.createdBy, role), isOwner, branchId }));
    } catch (e: any) {
      fail(res, e, 'Failed to confirm the handover');
    }
  });

  app.delete('/api/cash-book/handovers/:id', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Only an owner can cancel a cash handover.' });
      res.json(await deleteHandover(req.params.id));
    } catch (e: any) {
      fail(res, e, 'Failed to cancel the handover');
    }
  });

  app.get('/api/cash-book/closings', async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 30;
      res.json(await listClosings(scopedBranch(req), limit));
    } catch (e: any) {
      fail(res, e, 'Failed to load closings');
    }
  });
}
