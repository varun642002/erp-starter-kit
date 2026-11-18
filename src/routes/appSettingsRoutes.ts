import type { Express, Request, Response } from 'express';
import { getAuthContext } from './context.ts';
import { getAppSettings, setBranchPersonStockEdit } from '../db/appSettings.ts';

export function registerAppSettingsRoutes(app: Express): void {
  // Everyone signed in can read the switches (the screens hide what a role may not do).
  app.get('/api/app-settings', async (_req: Request, res: Response) => {
    try {
      res.json(await getAppSettings());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not read the settings' });
    }
  });

  // Only the Super Admin account can change them.
  app.put('/api/app-settings', async (req: Request, res: Response) => {
    if (getAuthContext(req).role !== 'Super Admin') {
      return res.status(403).json({ error: 'Only the Super Admin can change this setting.' });
    }
    try {
      if (typeof req.body?.branchPersonStockEdit !== 'boolean') {
        return res.status(400).json({ error: 'branchPersonStockEdit must be true or false.' });
      }
      res.json(await setBranchPersonStockEdit(req.body.branchPersonStockEdit, req.auth?.email || 'Super Admin'));
    } catch (e: any) {
      console.error('API PUT /api/app-settings error:', e);
      res.status(500).json({ error: e?.message || 'Could not save the setting' });
    }
  });
}
