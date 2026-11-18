import type { Express, Request, Response } from 'express';
import { getAuthContext, scopedBranch } from './context.ts';
import { getPredictions } from '../db/analyticsService.ts';
import { seasonOutlook } from '../db/seasonService.ts';
import { getStockPlan } from '../db/analyticsPlan.ts';
import { getCustomerInsights } from '../db/analyticsPeople.ts';
import { getMoneyInsights } from '../db/analyticsMoney.ts';
import { getCustomerRanking } from '../db/analyticsRanking.ts';
import { getOutlook, getMachineStats } from '../db/analyticsOutlook.ts';
import { currentModel, trainAndSave } from '../db/forecastModel.ts';

export function registerAnalyticsRoutes(app: Express): void {
  // Forecasts for the dashboards; non-owners are pinned to their own branch by scopedBranch.
  // Predictions, and the owner-level money and customer insights behind the Business Desk, are for the Super Admin only.
  // The stock plan (Buy list) and the customer ranking are open to every signed-in role, pinned to their own branch.
  const isSuper = (req: Request) => getAuthContext(req).role === 'Super Admin';
  // The Business Owner also sees the whole Business Desk, so the two insights behind its money and follow-up tabs are open to the owner too.
  const isSuperOrOwner = (req: Request) => ['Super Admin', 'Business Owner'].includes(getAuthContext(req).role);
  const route = (path: string, run: (req: Request) => Promise<unknown>, superOnly = false, allowOwner = false) =>
    app.get(path, async (req: Request, res: Response) => {
      if (superOnly && !(allowOwner ? isSuperOrOwner(req) : isSuper(req))) {
        return res.status(403).json({ error: allowOwner ? 'This is for the Super Admin and the Business Owner only.' : 'This is for the Super Admin only.' });
      }
      try {
        res.json(await run(req));
      } catch (e: any) {
        console.error(`API GET ${path} error:`, e);
        res.status(500).json({ error: e?.message || 'Request failed' });
      }
    });
  const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

  route('/api/analytics/predictions', (req) => getPredictions(scopedBranch(req)), true);
  route('/api/analytics/season', (req) => seasonOutlook(scopedBranch(req)), true);
  route('/api/analytics/stock-plan', (req) => getStockPlan(scopedBranch(req), num(req.query.lead), num(req.query.cover)));
  route('/api/analytics/customers', (req) => getCustomerInsights(scopedBranch(req)), true, true);
  route('/api/analytics/money', (req) => getMoneyInsights(scopedBranch(req)), true, true);
  route('/api/analytics/customer-ranking', (req) => getCustomerRanking(scopedBranch(req), num(req.query.quiet)));
  route('/api/analytics/outlook', (req) => getOutlook(scopedBranch(req)), true);
  route('/api/analytics/machines', (req) => getMachineStats(scopedBranch(req)), true);

  // The trained forecasting model. Super Admin only. It trains itself when the records have changed, and can be trained again by hand.
  app.get('/api/analytics/model', async (req: Request, res: Response) => {
    if (!isSuper(req)) return res.status(403).json({ error: 'Only the Super Admin can see the model.' });
    try {
      res.json(await currentModel(req.auth?.email || 'system'));
    } catch (e: any) {
      console.error('API GET /api/analytics/model error:', e);
      res.status(500).json({ error: e?.message || 'Request failed' });
    }
  });
  app.post('/api/analytics/model/train', async (req: Request, res: Response) => {
    if (!isSuper(req)) return res.status(403).json({ error: 'Only the Super Admin can train the model.' });
    try {
      res.json({ model: await trainAndSave(req.auth?.email || 'owner'), retrained: true });
    } catch (e: any) {
      console.error('API POST /api/analytics/model/train error:', e);
      res.status(500).json({ error: e?.message || 'Request failed' });
    }
  });
}
