import type { Express, Request, Response } from 'express';
import { getAuthContext, scopedBranch } from './context.ts';
import {
  JobCardError,
  addPayment,
  addPart,
  addService,
  removeService,
  changeStatus,
  createJobCard,
  getJobCard,
  getSummary,
  listJobCards,
  lookupSerial,
  removePart,
  updateJobCard
} from '../db/jobCardService.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof JobCardError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Job card request failed' });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const idParam = (req: Request) => String(req.params.id);

export function registerJobCardRoutes(app: Express): void {
  app.get('/api/job-cards/summary', async (req, res) => {
    try {
      res.json(await getSummary(scopedBranch(req)));
    } catch (e) {
      fail(res, 'GET /api/job-cards/summary', e);
    }
  });

  app.get('/api/job-cards/lookup-serial', async (req, res) => {
    try {
      res.json(await lookupSerial(str(req.query.serial) || ''));
    } catch (e) {
      fail(res, 'GET /api/job-cards/lookup-serial', e);
    }
  });

  app.get('/api/job-cards', async (req, res) => {
    try {
      res.json(
        await listJobCards(scopedBranch(req), { status: str(req.query.status), q: str(req.query.q) })
      );
    } catch (e) {
      fail(res, 'GET /api/job-cards', e);
    }
  });

  app.get('/api/job-cards/:id', async (req, res) => {
    try {
      res.json(await getJobCard(idParam(req), scopedBranch(req)));
    } catch (e) {
      fail(res, 'GET /api/job-cards/:id', e);
    }
  });

  app.post('/api/job-cards', async (req, res) => {
    try {
      const { isOwner, branchId, role } = getAuthContext(req);
      const body = req.body || {};
      const targetBranch = isOwner ? str(body.branchId) : branchId;
      if (!targetBranch || targetBranch === 'all') {
        return res.status(400).json({ error: 'Select a specific branch to create a job card' });
      }
      res.status(201).json(await createJobCard(body, targetBranch, role));
    } catch (e) {
      fail(res, 'POST /api/job-cards', e);
    }
  });

  app.patch('/api/job-cards/:id', async (req, res) => {
    try {
      res.json(await updateJobCard(idParam(req), req.body || {}, scopedBranch(req)));
    } catch (e) {
      fail(res, 'PATCH /api/job-cards/:id', e);
    }
  });

  app.post('/api/job-cards/:id/parts', async (req, res) => {
    try {
      res.status(201).json(await addPart(idParam(req), req.body || {}, scopedBranch(req)));
    } catch (e) {
      fail(res, 'POST /api/job-cards/:id/parts', e);
    }
  });

  app.delete('/api/job-cards/:id/parts/:partId', async (req, res) => {
    try {
      res.json(await removePart(idParam(req), Number(req.params.partId), scopedBranch(req)));
    } catch (e) {
      fail(res, 'DELETE /api/job-cards/:id/parts/:partId', e);
    }
  });

  app.post('/api/job-cards/:id/services', async (req, res) => {
    try {
      res.status(201).json(await addService(idParam(req), req.body || {}, scopedBranch(req)));
    } catch (e) {
      fail(res, 'POST /api/job-cards/:id/services', e);
    }
  });

  app.delete('/api/job-cards/:id/services/:lineId', async (req, res) => {
    try {
      res.json(await removeService(idParam(req), Number(req.params.lineId), scopedBranch(req)));
    } catch (e) {
      fail(res, 'DELETE /api/job-cards/:id/services/:lineId', e);
    }
  });

  app.post('/api/job-cards/:id/payments', async (req, res) => {
    try {
      const { role } = getAuthContext(req);
      res.status(201).json(await addPayment(idParam(req), req.body || {}, scopedBranch(req), role));
    } catch (e) {
      fail(res, 'POST /api/job-cards/:id/payments', e);
    }
  });

  app.post('/api/job-cards/:id/status', async (req, res) => {
    try {
      res.json(await changeStatus(idParam(req), String(req.body?.status || ''), scopedBranch(req)));
    } catch (e) {
      fail(res, 'POST /api/job-cards/:id/status', e);
    }
  });
}
