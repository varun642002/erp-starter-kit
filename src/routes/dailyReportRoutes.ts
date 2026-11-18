import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { getAuthContext, businessDate } from './context.ts';
import { buildDailyReport, dailyReportStatus, getDailyReportSettings, reportText, saveDailyReportSettings, sendDailyReport } from '../db/dailyReport.ts';

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function registerDailyReportRoutes(app: Express): void {
  // ---- owner only: preview, settings, send now (under /api, so a verified sign-in is required)
  const owner = (req: Request, res: Response): boolean => {
    if (getAuthContext(req).isOwner) return true;
    res.status(403).json({ error: 'Only the owner can use the daily report.' });
    return false;
  };
  const fail = (res: Response, e: any, where: string) => {
    console.error(`API ${where} error:`, e);
    res.status(500).json({ error: e?.message || 'Request failed' });
  };

  app.get('/api/daily-report', async (req: Request, res: Response) => {
    if (!owner(req, res)) return;
    try {
      const date = validDate(req.query.date) ? req.query.date : businessDate();
      const report = await buildDailyReport(date);
      res.json({ report, text: reportText(report), settings: await getDailyReportSettings(), status: dailyReportStatus() });
    } catch (e) {
      fail(res, e, 'GET /api/daily-report');
    }
  });
  app.put('/api/daily-report/settings', async (req: Request, res: Response) => {
    if (!owner(req, res)) return;
    try {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones.map(String) : undefined;
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
      res.json(await saveDailyReportSettings({ phones, enabled }, req.auth?.email || 'owner'));
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not save' });
    }
  });
  app.post('/api/daily-report/send', async (req: Request, res: Response) => {
    if (!owner(req, res)) return;
    try {
      const date = validDate(req.body?.date) ? req.body.date : businessDate();
      res.json(await sendDailyReport(date, { force: req.body?.force === true, user: req.auth?.email || 'owner' }));
    } catch (e) {
      fail(res, e, 'POST /api/daily-report/send');
    }
  });

  // ---- the 8 pm trigger. Cloud Scheduler calls this with a secret in the x-report-key header. It is outside /api on purpose
  // (the scheduler has no sign-in), so the secret is the only key: with no DAILY_REPORT_KEY set it does not exist.
  app.post('/internal/daily-report', async (req: Request, res: Response) => {
    const key = process.env.DAILY_REPORT_KEY;
    const got = String(req.get('x-report-key') || '');
    const ok = !!key && key.length >= 16 && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    try {
      const date = validDate(req.body?.date) ? req.body.date : businessDate();
      const out = await sendDailyReport(date, { user: 'Scheduler' });
      // If any number failed, answer with an error so Cloud Scheduler shows the run as failed and tries again: numbers that already got
      // the report are skipped on the retry, so only the failed ones are sent again
      if (out.results.some((r) => r.status === 'failed')) {
        console.error('daily-report: a send failed:', JSON.stringify(out.results.filter((r) => r.status === 'failed').map((r) => r.detail)));
        return res.status(502).json({ date: out.date, results: out.results });
      }
      res.json({ date: out.date, results: out.results });
    } catch (e: any) {
      console.error('POST /internal/daily-report error:', e);
      res.status(500).json({ error: 'Failed' });
    }
  });
}
