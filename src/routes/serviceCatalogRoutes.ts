import type { Express, Request, Response } from 'express';
import { getAuthContext } from './context.ts';
import { ServiceCatalogError, createService, deleteService, listServices, updateService } from '../db/serviceCatalog.ts';

// Everyone signed in can see the service list; only the owner side and the Warehouse Manager change it.
const canEdit = (req: Request) => {
  const { isOwner, role } = getAuthContext(req);
  return isOwner || role === 'Warehouse Manager';
};

function fail(res: Response, label: string, e: any) {
  if (e instanceof ServiceCatalogError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Services request failed' });
}

export function registerServiceCatalogRoutes(app: Express): void {
  const denied = (req: Request, res: Response) => {
    if (canEdit(req)) return false;
    res.status(403).json({ error: 'Only the owner or the Warehouse Manager can change the services.' });
    return true;
  };

  app.get('/api/services', async (_req: Request, res: Response) => {
    try {
      res.json(await listServices());
    } catch (e) {
      fail(res, 'GET /api/services', e);
    }
  });

  app.post('/api/services', async (req: Request, res: Response) => {
    if (denied(req, res)) return;
    try {
      res.status(201).json(await createService(req.body, req.auth?.email || 'owner'));
    } catch (e) {
      fail(res, 'POST /api/services', e);
    }
  });

  app.patch('/api/services/:id', async (req: Request, res: Response) => {
    if (denied(req, res)) return;
    try {
      res.json(await updateService(String(req.params.id), req.body));
    } catch (e) {
      fail(res, 'PATCH /api/services/:id', e);
    }
  });

  app.delete('/api/services/:id', async (req: Request, res: Response) => {
    if (denied(req, res)) return;
    try {
      await deleteService(String(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      fail(res, 'DELETE /api/services/:id', e);
    }
  });
}
