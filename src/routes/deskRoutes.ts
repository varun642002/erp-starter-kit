import type { Express, Request, Response } from 'express';
import { CashBookError } from '../db/cashBookService.ts';
import { createSupplierOrder, createSupplierPayment, deleteSupplierPayment, getBackupStatus, getBigDiscounts, getDeskToday, listSupplierOrders, listSupplierPayments, setSupplierOrderStatus } from '../db/deskService.ts';
import { listActivity } from '../db/activityLog.ts';
import { actorName, getAuthContext, scopedBranch } from './context.ts';

function fail(res: Response, e: any, label: string) {
  if (e instanceof CashBookError) return res.status(e.status).json({ error: e.message });
  console.error(`${label}:`, e);
  return res.status(500).json({ error: e?.message || label });
}

const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function registerDeskRoutes(app: Express): void {
  // The day at a glance for one branch (non-owners are pinned to their own branch), or all branches for an owner.
  app.get('/api/desk/today', async (req: Request, res: Response) => {
    try {
      res.json(await getDeskToday(scopedBranch(req)));
    } catch (e) {
      fail(res, e, 'Failed to load today');
    }
  });

  // Checks on what staff did: owners only.
  app.get('/api/desk/discounts', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'The staff checks are for the owner and Super Admin.' });
      res.json(await getBigDiscounts(scopedBranch(req), num(req.query.days) ?? 7, num(req.query.percent) ?? 15));
    } catch (e) {
      fail(res, e, 'Failed to load the discount check');
    }
  });

  // The activity trail: who changed what. Owners only.
  app.get('/api/desk/activity', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'The activity trail is for the owner and Super Admin.' });
      res.json(await listActivity({ days: num(req.query.days), q: typeof req.query.q === 'string' ? req.query.q : '', scope: scopedBranch(req), limit: num(req.query.limit) }));
    } catch (e) {
      fail(res, e, 'Failed to load the activity trail');
    }
  });

  app.get('/api/desk/backups', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Backups are for the owner and Super Admin.' });
      res.json(await getBackupStatus());
    } catch (e) {
      fail(res, e, 'Failed to read the backups');
    }
  });

  // Orders placed with suppliers: owners only.
  app.get('/api/desk/orders', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Supplier orders are for the owner and Super Admin.' });
      res.json(await listSupplierOrders(scopedBranch(req), typeof req.query.status === 'string' ? req.query.status : undefined, num(req.query.limit)));
    } catch (e) {
      fail(res, e, 'Failed to load the orders');
    }
  });

  app.post('/api/desk/orders', async (req: Request, res: Response) => {
    try {
      const { isOwner, role } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Only the owner and Super Admin can save a supplier order.' });
      const b = req.body || {};
      res.status(201).json(
        await createSupplierOrder(
          { supplierName: b.supplierName, supplierPhone: b.supplierPhone, branchId: typeof b.branchId === 'string' && b.branchId !== 'all' ? b.branchId : null, expectedDate: b.expectedDate, note: b.note, lines: b.lines },
          actorName(req, b.createdBy, role)
        )
      );
    } catch (e) {
      fail(res, e, 'Failed to save the order');
    }
  });

  // Payments to suppliers: owners only.
  app.get('/api/desk/supplier-payments', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Supplier payments are for the owner and Super Admin.' });
      res.json(await listSupplierPayments(typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined, num(req.query.limit)));
    } catch (e) {
      fail(res, e, 'Failed to load the supplier payments');
    }
  });

  app.post('/api/desk/supplier-payments', async (req: Request, res: Response) => {
    try {
      const { isOwner, role } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Only the owner and Super Admin can record a supplier payment.' });
      const b = req.body || {};
      res.status(201).json(
        await createSupplierPayment(
          { supplierId: String(b.supplierId || ''), supplierName: String(b.supplierName || ''), amount: Number(b.amount), method: String(b.method || 'Cash'), branchId: typeof b.branchId === 'string' ? b.branchId : null, reference: b.reference, note: b.note },
          actorName(req, b.createdBy, role)
        )
      );
    } catch (e) {
      fail(res, e, 'Failed to record the supplier payment');
    }
  });

  app.delete('/api/desk/supplier-payments/:id', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Only the owner and Super Admin can cancel a supplier payment.' });
      res.json(await deleteSupplierPayment(req.params.id));
    } catch (e) {
      fail(res, e, 'Failed to cancel the supplier payment');
    }
  });

  app.patch('/api/desk/orders/:id', async (req: Request, res: Response) => {
    try {
      const { isOwner, role } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Only the owner and Super Admin can change a supplier order.' });
      res.json(await setSupplierOrderStatus(req.params.id, String(req.body?.status || ''), actorName(req, req.body?.by, role)));
    } catch (e) {
      fail(res, e, 'Failed to update the order');
    }
  });
}
