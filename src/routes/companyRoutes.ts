import type { Express, Request, Response } from 'express';
import { CompanyError, listCompanies, updateCompany } from '../db/companyService.ts';
import { getAuthContext } from './context.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof CompanyError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Company request failed' });
}

export function registerCompanyRoutes(app: Express): void {
  app.get('/api/companies', async (_req: Request, res: Response) => {
    try {
      res.json(await listCompanies());
    } catch (e) {
      fail(res, 'GET /api/companies', e);
    }
  });

  app.put('/api/companies/:id', async (req: Request, res: Response) => {
    const { isOwner } = getAuthContext(req);
    if (!isOwner) return res.status(403).json({ error: 'Only an owner can edit company details' });
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      res.json(await updateCompany(String(req.params.id), body));
    } catch (e) {
      fail(res, 'PUT /api/companies/:id', e);
    }
  });
}
