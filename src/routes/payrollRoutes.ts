import type { Express, Request, Response } from 'express';
import {
  PayrollError,
  assertMonth,
  createAdvance,
  deleteAdvance,
  finalizeRun,
  generateRun,
  getRunDetail,
  getSummary,
  listAdvances,
  listRuns,
  paySlip,
  settleAndPaySlip,
  updatePayslip,
  type PayslipPatch
} from '../db/payrollService.ts';
import { actorName, businessDate, getAuthContext, scopedBranch } from './context.ts';

const PAYROLL_ROLES = ['Super Admin', 'Business Owner', 'Accountant'];

function fail(res: Response, e: any, label: string) {
  if (e instanceof PayrollError) return res.status(e.status).json({ error: e.message });
  console.error(`${label}:`, e);
  return res.status(500).json({ error: e.message || label });
}

// Returns the caller's access scope, or sends 403 and returns null.
function authorize(req: Request, res: Response) {
  const ctx = getAuthContext(req);
  if (!PAYROLL_ROLES.includes(ctx.role)) {
    res.status(403).json({ error: 'Only owners and accountants can access payroll.' });
    return null;
  }
  return ctx;
}

// Concrete branch a write applies to: non-owners are pinned, owners must name one.
function writeBranch(req: Request): string | null {
  const { isOwner, branchId } = getAuthContext(req);
  if (!isOwner) return branchId;
  const requested = (req.body?.branchId as string) || (req.query.branch_id as string);
  return requested && requested !== 'all' ? requested : null;
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

function money(raw: unknown, label: string): number {
  const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new PayrollError(`${label} must be a number of zero or more.`);
  return n;
}

export function registerPayrollRoutes(app: Express): void {
  app.post('/api/payroll/generate', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to generate payroll.' });
      const body = req.body || {};
      assertMonth(body.month);
      res.status(201).json(await generateRun(ctx, branch, body.month, actorName(req, str(body.createdBy, 80), ctx.role)));
    } catch (e: any) {
      fail(res, e, 'Failed to generate payroll');
    }
  });

  app.get('/api/payroll/runs', async (req: Request, res: Response) => {
    try {
      if (!authorize(req, res)) return;
      const month = str(req.query.month, 7);
      if (month) assertMonth(month);
      res.json(await listRuns(scopedBranch(req), month));
    } catch (e: any) {
      fail(res, e, 'Failed to load payroll runs');
    }
  });

  app.get('/api/payroll/runs/:id', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      res.json(await getRunDetail(req.params.id, ctx));
    } catch (e: any) {
      fail(res, e, 'Failed to load payroll run');
    }
  });

  app.patch('/api/payroll/payslips/:id', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      const body = req.body || {};
      const patch: PayslipPatch = {};
      if (body.bonus !== undefined) patch.bonus = money(body.bonus, 'Bonus');
      if (body.otherDeductions !== undefined) patch.otherDeductions = money(body.otherDeductions, 'Deductions');
      if (body.advanceRecovered !== undefined) patch.advanceRecovered = money(body.advanceRecovered, 'Advance recovery');
      if (body.notes !== undefined) patch.notes = str(body.notes, 300) ?? null;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
      res.json(await updatePayslip(ctx, req.params.id, patch));
    } catch (e: any) {
      fail(res, e, 'Failed to update payslip');
    }
  });

  app.post('/api/payroll/runs/:id/finalize', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      res.json(await finalizeRun(ctx, req.params.id));
    } catch (e: any) {
      fail(res, e, 'Failed to finalize payroll');
    }
  });

  app.post('/api/payroll/payslips/:id/pay', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      const body = req.body || {};
      res.json(
        await paySlip(ctx, req.params.id, {
          method: typeof body.method === 'string' ? body.method : '',
          paidOn: str(body.paidOn, 10),
          createdBy: actorName(req, str(body.createdBy, 80), ctx.role)
        })
      );
    } catch (e: any) {
      fail(res, e, 'Failed to record salary payment');
    }
  });

  app.get('/api/payroll/advances', async (req: Request, res: Response) => {
    try {
      if (!authorize(req, res)) return;
      const status = str(req.query.status, 20);
      if (status && status !== 'Open' && status !== 'Recovered') {
        return res.status(400).json({ error: 'Status must be Open or Recovered.' });
      }
      res.json(await listAdvances(scopedBranch(req), { staffId: str(req.query.staffId, 80), status }));
    } catch (e: any) {
      fail(res, e, 'Failed to load advances');
    }
  });

  app.post('/api/payroll/advances', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to give an advance.' });
      const body = req.body || {};
      const staffId = str(body.staffId, 80);
      if (!staffId) return res.status(400).json({ error: 'Staff member is required.' });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });
      const advance = await createAdvance(ctx, {
        branchId: branch,
        staffId,
        amount,
        method: str(body.method, 20) || 'Cash',
        reason: str(body.reason, 200),
        givenOn: str(body.givenOn, 10),
        createdBy: actorName(req, str(body.createdBy, 80), ctx.role)
      });
      res.status(201).json(advance);
    } catch (e: any) {
      fail(res, e, 'Failed to record advance');
    }
  });

  app.post('/api/payroll/payslips/:id/settle', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      const body = req.body || {};
      res.json(
        await settleAndPaySlip(ctx, req.params.id, {
          method: typeof body.method === 'string' ? body.method : '',
          paidOn: str(body.paidOn, 10),
          createdBy: actorName(req, str(body.createdBy, 80), ctx.role)
        })
      );
    } catch (e: any) {
      fail(res, e, 'Failed to settle and pay the salary');
    }
  });

  app.delete('/api/payroll/advances/:id', async (req: Request, res: Response) => {
    try {
      const ctx = authorize(req, res);
      if (!ctx) return;
      res.json(await deleteAdvance(ctx, req.params.id));
    } catch (e: any) {
      fail(res, e, 'Failed to delete advance');
    }
  });

  app.get('/api/payroll/summary', async (req: Request, res: Response) => {
    try {
      if (!authorize(req, res)) return;
      const month = str(req.query.month, 7) || businessDate().slice(0, 7);
      res.json(await getSummary(scopedBranch(req), month));
    } catch (e: any) {
      fail(res, e, 'Failed to load payroll summary');
    }
  });
}
