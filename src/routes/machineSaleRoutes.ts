import type { Express, Request, Response } from 'express';
import { actorName, getAuthContext, scopedBranch } from './context.ts';
import {
  MachineSaleError,
  addPayment,
  cancelMachineSale,
  createMachineSale,
  completeDirectSale,
  updateSalePayment,
  deleteSalePayment,
  deleteMachineSale,
  deliverMachineSale,
  generateMachineSaleInvoice,
  dispatchMachineSale,
  getMachineSale,
  getSummary, getYearSummary,
  listMachineSales,
  markReady,
  updateSubsidy,
  updateMachineSale
} from '../db/machineSaleService.ts';
import type { Actor } from '../db/stockService.ts';
import { autoSendThankYou } from '../db/purchaseThanks.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof MachineSaleError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Machine sale request failed' });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const idParam = (req: Request) => String(req.params.id);

function actorOf(req: Request): Actor {
  const { role, branchId, isOwner } = getAuthContext(req);
  return { role, branchId, isOwner, name: actorName(req, undefined, role) };
}

export function registerMachineSaleRoutes(app: Express): void {
  // Registered before '/:id' so "summary" is not read as an id.
  app.get('/api/machine-sales/summary', async (req, res) => {
    try {
      res.json(await getSummary(scopedBranch(req), actorOf(req)));
    } catch (e) {
      fail(res, 'GET /api/machine-sales/summary', e);
    }
  });

  app.get('/api/machine-sales', async (req, res) => {
    try {
      res.json(
        await listMachineSales(
          scopedBranch(req),
          {
            status: str(req.query.status),
            q: str(req.query.q),
            customerId: str(req.query.customer_id),
            from: str(req.query.from),
            to: str(req.query.to),
            serial: str(req.query.serial),
            serialState: str(req.query.serial_state),
            payment: str(req.query.payment)
          },
          actorOf(req)
        )
      );
    } catch (e) {
      fail(res, 'GET /api/machine-sales', e);
    }
  });

  // Machines sold per financial year, and which months machines sell in.
  app.get('/api/machine-sales/years', async (req, res) => {
    try {
      res.json(await getYearSummary(scopedBranch(req), actorOf(req)));
    } catch (e) {
      fail(res, 'GET /api/machine-sales/years', e);
    }
  });

  app.get('/api/machine-sales/:id', async (req, res) => {
    try {
      res.json(await getMachineSale(idParam(req), actorOf(req)));
    } catch (e) {
      fail(res, 'GET /api/machine-sales/:id', e);
    }
  });

  app.post('/api/machine-sales', async (req, res) => {
    try {
      const actor = actorOf(req);
      const body = req.body || {};
      // Owners choose the branch; everyone else is pinned to their own.
      const branchId = actor.isOwner
        ? str(body.branchId) || str(body.branch_id) || str(req.query.branch_id) || actor.branchId
        : actor.branchId;
      if (!branchId || branchId === 'all') {
        return res.status(400).json({ error: 'Select a specific branch to create a machine sale' });
      }
      const created = await createMachineSale(body, branchId, actor);
      // A direct sale (no booking): the machine is handed over straight away.
      if (body.directSale === true) {
        const done = await completeDirectSale(created.id, { deliveredDate: str(body.deliveredDate) }, actor);
        // the sale is done: the customer gets a thank-you on WhatsApp (in the background, never fails the sale)
        void autoSendThankYou(created.id, { user: actor.name });
        return res.status(201).json({ ...done, customerCreated: (created as any).customerCreated });
      }
      res.status(201).json(created);
    } catch (e) {
      fail(res, 'POST /api/machine-sales', e);
    }
  });

  app.put('/api/machine-sales/:id', async (req, res) => {
    try {
      res.json(await updateMachineSale(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'PUT /api/machine-sales/:id', e);
    }
  });

  app.put('/api/machine-sales/:id/payments/:paymentId', async (req, res) => {
    try {
      res.json(await updateSalePayment(idParam(req), Number(req.params.paymentId), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'PUT /api/machine-sales/:id/payments/:paymentId', e);
    }
  });

  app.delete('/api/machine-sales/:id/payments/:paymentId', async (req, res) => {
    try {
      res.json(await deleteSalePayment(idParam(req), Number(req.params.paymentId), actorOf(req)));
    } catch (e) {
      fail(res, 'DELETE /api/machine-sales/:id/payments/:paymentId', e);
    }
  });

  app.post('/api/machine-sales/:id/payments', async (req, res) => {
    try {
      res.status(201).json(await addPayment(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/payments', e);
    }
  });

  app.post('/api/machine-sales/:id/subsidy', async (req, res) => {
    try {
      res.json(await updateSubsidy(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/subsidy', e);
    }
  });

  app.post('/api/machine-sales/:id/ready', async (req, res) => {
    try {
      res.json(await markReady(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/ready', e);
    }
  });

  app.post('/api/machine-sales/:id/dispatch', async (req, res) => {
    try {
      res.json(await dispatchMachineSale(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/dispatch', e);
    }
  });

  app.post('/api/machine-sales/:id/deliver', async (req, res) => {
    try {
      const actor = actorOf(req);
      const done = await deliverMachineSale(idParam(req), req.body || {}, actor);
      // delivered: the customer gets a thank-you on WhatsApp (in the background, never fails the delivery)
      void autoSendThankYou(idParam(req), { user: actor.name });
      res.json(done);
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/deliver', e);
    }
  });

  // Send (or send again) the thank-you message to the customer's WhatsApp right now
  app.post('/api/machine-sales/:id/send-thank-you', async (req, res) => {
    try {
      const actor = actorOf(req);
      await getMachineSale(idParam(req), actor); // the same access rules as viewing the sale
      res.json(await autoSendThankYou(idParam(req), { force: true, user: actor.name }));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/send-thank-you', e);
    }
  });

  // Invoice of a delivered sale (made automatically at delivery; this is for one that is missing)
  app.post('/api/machine-sales/:id/invoice', async (req, res) => {
    try {
      res.json(await generateMachineSaleInvoice(idParam(req), actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/invoice', e);
    }
  });

  app.delete('/api/machine-sales/:id', async (req, res) => {
    try {
      res.json(await deleteMachineSale(idParam(req), actorOf(req)));
    } catch (e) {
      fail(res, 'DELETE /api/machine-sales/:id', e);
    }
  });

  app.post('/api/machine-sales/:id/cancel', async (req, res) => {
    try {
      res.json(await cancelMachineSale(idParam(req), req.body || {}, actorOf(req)));
    } catch (e) {
      fail(res, 'POST /api/machine-sales/:id/cancel', e);
    }
  });
}
