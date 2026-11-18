import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { newId } from '../routes/context.ts';

// A trail of who changed what, written by the server for every successful change (not by the browser), under the
// signed-in identity. It records the action and the record id, never phone numbers or other personal details.

export async function ensureActivityTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists activity_log (
      id text primary key,
      at timestamptz not null default now(),
      actor text,
      role text,
      branch_id text,
      method text not null,
      path text not null,
      summary text not null,
      entity_id text
    )`);
  await db.execute(sql`create index if not exists idx_activity_log_at on activity_log (at desc)`);
  await db.execute(sql`delete from activity_log where at < now() - interval '180 days'`);
}

// Requests that only look things up (even though they are POSTs) or that are noise.
const SKIP = [/\/broadcast\/[^/]+\/tick$/, /^\/api\/assistant/, /^\/api\/voice/, /^\/api\/db\/init/, /^\/api\/health/, /^\/api\/analytics/];

const ACTIONS: Record<string, string> = {
  cancel: 'Cancelled',
  deliver: 'Delivered',
  dispatch: 'Dispatched',
  ready: 'Marked ready',
  close: 'Closed the day in',
  reopen: 'Reopened the day in',
  confirm: 'Confirmed',
  invoice: 'Made the invoice from',
  subsidy: 'Recorded the subsidy on',
  'send-thank-you': 'Sent the thank-you for',
  apply: 'Applied',
  pay: 'Paid',
  clear: 'Deleted all',
  settle: 'Settled advance and paid',
  tick: 'Worked on'
};
const VERB: Record<string, string> = { POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };
const AMOUNT_FIELDS = ['amount', 'countedCash', 'grandTotal', 'salePrice', 'totalAmount'];
const looksLikeId = (seg: string) => /\d/.test(seg);

export function describeRequest(method: string, path: string, body: any): { summary: string; entityId: string | null } {
  const segs = path.replace(/^\/api\//, '').split('?')[0].split('/').filter(Boolean);
  const names = segs.filter((s) => !looksLikeId(s));
  const ids = segs.filter(looksLikeId);
  const last = names[names.length - 1];
  const action = last && ACTIONS[last];
  const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const nouns = (action ? names.slice(0, -1) : names).map((s, i, arr) => {
    const w = decodeURIComponent(s).replace(/-/g, ' ');
    return i === arr.length - 1 ? w.split(' ').map((x, j, a) => (j === a.length - 1 ? singular(x) : x)).join(' ') : w;
  }).join(' / ');
  let summary = `${action || VERB[method] || method} ${nouns || 'record'}`.trim();
  if (body && typeof body === 'object') {
    for (const f of AMOUNT_FIELDS) {
      const v = Number(body[f]);
      if (Number.isFinite(v) && v !== 0) {
        summary += ` (${f === 'countedCash' ? 'counted' : 'amount'} ${Math.round(v * 100) / 100})`;
        break;
      }
    }
  }
  return { summary: summary.slice(0, 240), entityId: ids.length ? decodeURIComponent(ids[ids.length - 1]).slice(0, 100) : null };
}

export function activityTrail(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const fullPath = (req.baseUrl || '') + req.path;
  if (SKIP.some((r) => r.test(fullPath))) return next();
  // The check-only call of "delete all expenses" changes nothing, so it is not logged as a deletion.
  if (/\/expenses\/clear$/.test(fullPath) && req.body?.confirm !== 'DELETE') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      const { summary, entityId } = describeRequest(req.method, fullPath, req.body);
      const actor = (req.auth?.email || '').slice(0, 100) || null;
      const role = (req.auth?.role || (req.headers['x-user-role'] as string) || '').slice(0, 40) || null;
      const branch = (req.auth?.branchId || (req.headers['x-branch-id'] as string) || '').slice(0, 60) || null;
      db.execute(
        sql`insert into activity_log (id, actor, role, branch_id, method, path, summary, entity_id)
            values (${newId('al')}, ${actor}, ${role}, ${branch}, ${req.method}, ${fullPath.slice(0, 200)}, ${summary}, ${entityId})`
      ).catch((e) => console.warn('Activity log notice:', e?.message || e));
    } catch (e: any) {
      console.warn('Activity log notice:', e?.message || e);
    }
  });
  next();
}

export interface ActivityRow {
  id: string;
  at: string;
  actor: string | null;
  role: string | null;
  branchId: string | null;
  branchName: string | null;
  method: string;
  summary: string;
  entityId: string | null;
}

export async function listActivity(opts: { days?: number; q?: string; scope?: string; limit?: number }): Promise<ActivityRow[]> {
  const days = Math.min(180, Math.max(1, Math.round(opts.days || 7)));
  const cap = Math.min(500, Math.max(1, Math.round(opts.limit || 200)));
  const q = (opts.q || '').trim().toLowerCase();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const text = q ? sql`and (lower(coalesce(a.actor, '')) like ${like} or lower(a.summary) like ${like} or lower(coalesce(a.entity_id, '')) like ${like})` : sql``;
  const branch = opts.scope && opts.scope !== 'all' ? sql`and a.branch_id = ${opts.scope}` : sql``;
  const res = await db.execute(sql`
    select a.*, b.name as branch_name from activity_log a left join branches b on b.id = a.branch_id
    where a.at >= now() - (${days} * interval '1 day') ${branch} ${text}
    order by a.at desc limit ${cap}`);
  return (res.rows as any[]).map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    actor: r.actor || null,
    role: r.role || null,
    branchId: r.branch_id || null,
    branchName: r.branch_name || null,
    method: r.method,
    summary: r.summary,
    entityId: r.entity_id || null
  }));
}
