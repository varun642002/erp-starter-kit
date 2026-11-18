import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { messageLog } from './schema.messages.ts';
import { toWhatsappNumber } from './billMessenger.ts';
import { optedOutNumbers } from './optOuts.ts';
import { newId } from '../routes/context.ts';

// A greeting (for example Diwali) with one picture and a short message, sent to every customer with a mobile number.
// The people are saved in a queue table first, so the send survives a restart and no number is sent twice. The queue is
// worked through in small batches: by the page that is open (each progress check does a batch) and by a timer on the server.
// Needs (environment values, Secret Manager on Cloud Run):
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_BROADCAST_TEMPLATE_NAME
// Optional: WHATSAPP_BROADCAST_TEMPLATE_LANG (default en).
// The template is a MARKETING template with an IMAGE header and a body that has two variables:
//   {{1}} the customer's name, {{2}} the message.

const GRAPH = 'https://graph.facebook.com/v20.0';
export const MAX_BROADCAST = 5000;
const PARALLEL = 10;
const CLAIM = 40;
const MAX_POSTER_BYTES = 4 * 1024 * 1024;
const GIVE_UP_AFTER_FAILURES = 5; // this many failures in a row, with nothing sent yet, means the setup is wrong
const PAUSE_SECONDS = 60;
// WhatsApp answers these when the sending limit or rate is reached: wait and carry on.
const RATE_CODES = new Set([130429, 131056, 80007, 4, 613]);

export interface BroadcastStatus {
  configured: boolean;
  missing: string[];
  templateName: string | null;
  templateLanguage: string;
  maxRecipients: number;
}

export function broadcastStatus(): BroadcastStatus {
  const missing: string[] = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME) missing.push('WHATSAPP_BROADCAST_TEMPLATE_NAME');
  return {
    configured: missing.length === 0,
    missing,
    templateName: process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME || null,
    templateLanguage: process.env.WHATSAPP_BROADCAST_TEMPLATE_LANG || 'en',
    maxRecipients: MAX_BROADCAST
  };
}

export async function ensureBroadcastTables(): Promise<void> {
  await db.execute(sql`
    create table if not exists broadcast_jobs (
      id text primary key,
      title text not null,
      message text not null,
      template_name text not null,
      template_lang text not null default 'en',
      media_id text not null,
      status text not null default 'queued',
      total int not null default 0,
      sent int not null default 0,
      failed int not null default 0,
      skipped int not null default 0,
      note text,
      resume_at timestamptz,
      created_by text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )`);
  await db.execute(sql`
    create table if not exists broadcast_recipients (
      job_id text not null,
      phone text not null,
      name text not null,
      customer_id text,
      branch_id text,
      status text not null default 'pending',
      error text,
      provider_id text,
      claimed_at timestamptz,
      claimed_by text,
      sent_at timestamptz,
      primary key (job_id, phone)
    )`);
  await db.execute(sql`alter table broadcast_recipients add column if not exists claimed_by text`);
  await db.execute(sql`create index if not exists idx_broadcast_recipients_status on broadcast_recipients (job_id, status)`);
}

// One variable may not hold line breaks, tabs or long runs of spaces (WhatsApp rejects the message otherwise).
const oneLine = (s: string, max: number) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

async function uploadPoster(p: { mime: string; data: string }): Promise<string> {
  const mime = p.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const buf = Buffer.from(String(p.data || ''), 'base64');
  if (!buf.length || buf.length > MAX_POSTER_BYTES) throw new Error('The picture must be a JPG or PNG under 4 MB.');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buf], { type: mime }), mime === 'image/png' ? 'greeting.png' : 'greeting.jpg');
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, body: form });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) {
    const e = json?.error || {};
    const detail = [e.code ? `code ${e.code}` : '', e.error_subcode ? `subcode ${e.error_subcode}` : '', e.fbtrace_id ? `trace ${e.fbtrace_id}` : ''].filter(Boolean).join(', ');
    const hint = /api access blocked/i.test(String(e.message || ''))
      ? ' Meta is blocking this app from using the WhatsApp API: check the app in Meta for Developers (restrictions notice, Live mode, "Require app secret" setting) and the access token.'
      : '';
    throw new Error(`WhatsApp did not accept the picture: ${e.message || res.status}${detail ? ` (${detail})` : ''}.${hint}`);
  }
  return String(json.id);
}

export interface BroadcastJob {
  id: string;
  title: string;
  message: string;
  templateName: string;
  status: 'draft' | 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'stopped';
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  note: string | null;
  resumeAt: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const presentJob = (r: any): BroadcastJob => ({
  id: r.id,
  title: r.title,
  message: r.message,
  templateName: r.template_name,
  status: r.status,
  total: Number(r.total),
  sent: Number(r.sent),
  failed: Number(r.failed),
  skipped: Number(r.skipped),
  pending: Math.max(0, Number(r.total) - Number(r.sent) - Number(r.failed) - Number(r.skipped)),
  note: r.note || null,
  resumeAt: r.resume_at ? new Date(r.resume_at).toISOString() : null,
  createdBy: r.created_by || null,
  createdAt: new Date(r.created_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null
});

export interface BroadcastInput {
  title: string;
  message: string;
  poster: { mime: string; data: string };
  recipients: { customerId?: string | null; name: string; phone: string; branchId?: string | null }[];
}

export async function createBroadcast(input: BroadcastInput, by: string): Promise<BroadcastJob> {
  const status = broadcastStatus();
  if (!status.configured) throw new Error(`Group sending is not set up yet (missing ${status.missing.join(', ')}).`);
  const title = oneLine(input.title, 120);
  const message = oneLine(input.message, 500);
  if (!title) throw new Error('Give the greeting a name, for example "Diwali 2026".');
  if (!message) throw new Error('Type the message to send.');
  if (!input.poster?.data) throw new Error('Choose the picture to send.');
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) throw new Error('There is nobody to send to.');
  if (input.recipients.length > MAX_BROADCAST) throw new Error(`At most ${MAX_BROADCAST} people can be sent in one go.`);

  // numbers that already received a greeting with this name are never sent again
  const sentBefore = new Set(
    ((await db.execute(sql`select distinct phone from message_log where kind = 'marketing' and ref_id = ${title} and channel = 'whatsapp-api' and status = 'sent'`)).rows as any[]).map((r) => String(r.phone))
  );
  const optedOut = await optedOutNumbers(); // people who replied STOP are never sent marketing
  const seen = new Set<string>();
  const people: { phone: string; name: string; customer_id: string | null; branch_id: string | null }[] = [];
  let skipped = 0;
  for (const r of input.recipients) {
    const to = toWhatsappNumber(r.phone);
    if (!to || seen.has(to) || sentBefore.has(to) || optedOut.has(to)) {
      skipped += 1;
      continue;
    }
    seen.add(to);
    people.push({ phone: to, name: oneLine(r.name || 'Customer', 60) || 'Customer', customer_id: r.customerId || null, branch_id: r.branchId || null });
  }
  if (people.length === 0) throw new Error('Everyone on the list has already received this greeting, or has no usable number.');

  const mediaId = await uploadPoster(input.poster);
  const id = newId('bc');
  // The job starts as a draft so it is not worked on before all its people are saved. A greeting with this name that is
  // still going out blocks a second one (checked under a lock, so two clicks at once cannot both pass), so nobody gets it twice.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`broadcast:${title}`}))`);
    const running = (await tx.execute(sql`select id from broadcast_jobs where title = ${title} and status in ('draft', 'queued', 'running', 'paused') limit 1`)).rows;
    if (running.length) throw new Error(`"${title}" is still being sent. Wait for it to finish or cancel it first.`);
    await tx.execute(sql`
      insert into broadcast_jobs (id, title, message, template_name, template_lang, media_id, status, total, skipped, created_by)
      values (${id}, ${title}, ${message}, ${status.templateName}, ${status.templateLanguage}, ${mediaId}, 'draft', ${people.length + skipped}, ${skipped}, ${by.slice(0, 100) || null})`);
  });
  for (let i = 0; i < people.length; i += 500) {
    const chunk = JSON.stringify(people.slice(i, i + 500));
    await db.execute(sql`
      insert into broadcast_recipients (job_id, phone, name, customer_id, branch_id)
      select ${id}, r.phone, r.name, r.customer_id, r.branch_id from jsonb_to_recordset(${chunk}::jsonb) as r(phone text, name text, customer_id text, branch_id text)
      on conflict do nothing`);
  }
  await db.execute(sql`update broadcast_jobs set status = 'queued' where id = ${id} and status = 'draft'`);
  return (await getBroadcast(id))!.job;
}

export interface BroadcastFailure {
  name: string;
  phone: string;
  error: string;
}

export async function getBroadcast(id: string): Promise<{ job: BroadcastJob; failures: BroadcastFailure[] } | null> {
  const row = (await db.execute(sql`select * from broadcast_jobs where id = ${id}`)).rows[0];
  if (!row) return null;
  const left = (await db.execute(sql`select count(*)::int as n from broadcast_recipients where job_id = ${id} and status in ('pending', 'sending')`)).rows[0] as any;
  const job = presentJob(row);
  job.pending = Number(left?.n) || 0;
  const fails = (await db.execute(sql`select name, phone, error from broadcast_recipients where job_id = ${id} and status = 'failed' order by sent_at desc nulls last limit 30`)).rows as any[];
  return { job, failures: fails.map((f) => ({ name: f.name, phone: String(f.phone).slice(2), error: f.error || 'Failed' })) };
}

export async function listBroadcasts(limit = 8): Promise<BroadcastJob[]> {
  const rows = (await db.execute(sql`select * from broadcast_jobs order by created_at desc limit ${Math.min(Math.max(limit, 1), 30)}`)).rows as any[];
  return rows.map(presentJob);
}

export async function cancelBroadcast(id: string): Promise<void> {
  await db.execute(sql`update broadcast_recipients set status = 'skipped', error = 'Cancelled' where job_id = ${id} and status in ('pending', 'sending')`);
  await db.execute(sql`update broadcast_jobs set status = 'cancelled', finished_at = now(), note = 'Cancelled by the owner.' where id = ${id} and status in ('draft', 'queued', 'running', 'paused')`);
  await recount(id);
}

// sent / failed / skipped are counted from the queue so they are always exact (the people skipped at the start stay counted)
async function recount(id: string): Promise<void> {
  await db.execute(sql`
    update broadcast_jobs j set
      sent = c.sent, failed = c.failed,
      skipped = j.total - c.sent - c.failed - c.open
    from (
      select count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed,
             count(*) filter (where status in ('pending', 'sending'))::int as open
      from broadcast_recipients where job_id = ${id}
    ) c
    where j.id = ${id}`);
}

type SendOutcome = { state: 'sent' | 'failed'; error: string | null; providerId: string | null; code: number | null };

async function sendOne(job: any, to: string, name: string): Promise<SendOutcome> {
  try {
    const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: job.template_name,
          language: { code: job.template_lang },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { id: job.media_id } }] },
            { type: 'body', parameters: [name, job.message].map((text) => ({ type: 'text', text })) }
          ]
        }
      })
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok) return { state: 'sent', error: null, providerId: json?.messages?.[0]?.id || null, code: null };
    return { state: 'failed', error: (json?.error?.message || `WhatsApp request failed (${res.status})`).slice(0, 300), providerId: null, code: Number(json?.error?.code) || (res.status === 429 ? 130429 : null) };
  } catch (e: any) {
    return { state: 'failed', error: (e?.message || 'Network error').slice(0, 300), providerId: null, code: null };
  }
}

// Works through the queue of one greeting for at most `budgetMs`. Safe to call from several places at once: a person is
// claimed by exactly one caller.
export async function processBroadcast(id: string, budgetMs = 20_000): Promise<void> {
  const started = Date.now();
  const job = (await db.execute(sql`select * from broadcast_jobs where id = ${id}`)).rows[0] as any;
  if (!job || ['draft', 'done', 'cancelled', 'stopped'].includes(job.status)) return;
  if (job.status === 'paused' && job.resume_at && new Date(job.resume_at).getTime() > Date.now()) return;
  await db.execute(sql`update broadcast_jobs set status = 'running', resume_at = null where id = ${id} and status in ('queued', 'paused')`);
  // anyone claimed more than ten minutes ago by a caller that died goes back in the queue
  await db.execute(sql`update broadcast_recipients set status = 'pending', claimed_by = null where job_id = ${id} and status = 'sending' and claimed_at < now() - interval '10 minutes'`);

  let consecutiveFailures = 0;
  while (Date.now() - started < budgetMs) {
    // another caller may have paused, stopped or cancelled the greeting meanwhile
    const live = (await db.execute(sql`select status from broadcast_jobs where id = ${id}`)).rows[0] as any;
    if (!live || live.status !== 'running') return;
    // anyone who replied STOP since the greeting was queued is left out
    await db.execute(sql`update broadcast_recipients set status = 'skipped', error = 'Replied STOP' where job_id = ${id} and status = 'pending' and phone in (select phone from whatsapp_opt_outs)`);
    const token = randomUUID();
    const claimed = (
      await db.execute(sql`
        update broadcast_recipients set status = 'sending', claimed_at = now(), claimed_by = ${token}
        where (job_id, phone) in (select job_id, phone from broadcast_recipients where job_id = ${id} and status = 'pending' order by phone limit ${CLAIM} for update skip locked)
        returning phone, name, customer_id, branch_id`)
    ).rows as any[];
    if (claimed.length === 0) break;

    let paused = false;
    let cursor = 0;
    const results: { row: any; out: SendOutcome | null }[] = claimed.map((row) => ({ row, out: null }));
    const worker = async () => {
      while (cursor < results.length && !paused) {
        const item = results[cursor++];
        const out = await sendOne(job, item.row.phone, item.row.name);
        if (out.state === 'failed' && out.code !== null && RATE_CODES.has(out.code)) {
          paused = true; // not counted as a failure: the person goes back in the queue
          return;
        }
        item.out = out;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, results.length) }, worker));

    for (const { row, out } of results) {
      if (!out) {
        await db.execute(sql`update broadcast_recipients set status = 'pending', claimed_at = null, claimed_by = null where job_id = ${id} and phone = ${row.phone} and claimed_by = ${token}`);
        continue;
      }
      const wrote = await db.execute(sql`update broadcast_recipients set status = ${out.state}, error = ${out.error}, provider_id = ${out.providerId}, sent_at = now(), claimed_at = null, claimed_by = null where job_id = ${id} and phone = ${row.phone} and claimed_by = ${token}`);
      if (!wrote.rowCount && out.state !== 'sent') continue; // taken over by someone else after a long stall; theirs is the record
      if (!wrote.rowCount) console.warn(`broadcast ${id}: ${row.phone} was sent but its claim had expired`);
      await db
        .insert(messageLog)
        .values({
          id: `msg-${randomUUID()}`,
          branchId: row.branch_id || 'branch-1',
          kind: 'marketing',
          refType: 'campaign',
          refId: job.title,
          customerId: row.customer_id || null,
          customerName: row.name,
          phone: row.phone,
          channel: 'whatsapp-api',
          language: job.template_lang === 'ta' ? 'ta' : 'en',
          body: `${row.name}: ${job.message}`.slice(0, 1000),
          sentBy: job.created_by || 'broadcast',
          status: out.state,
          error: out.error,
          providerId: out.providerId,
          createdAt: new Date()
        })
        .catch((e) => console.error('broadcast log error:', e));
      consecutiveFailures = out.state === 'sent' ? 0 : consecutiveFailures + 1;
    }
    await recount(id);

    if (paused) {
      await db.execute(sql`update broadcast_jobs set status = 'paused', resume_at = now() + (${PAUSE_SECONDS} * interval '1 second'), note = 'WhatsApp asked us to slow down. Sending carries on by itself in a minute.' where id = ${id} and status = 'running'`);
      return;
    }
    const sentSoFar = Number(((await db.execute(sql`select count(*)::int as n from broadcast_recipients where job_id = ${id} and status = 'sent'`)).rows[0] as any)?.n) || 0;
    if (sentSoFar === 0 && consecutiveFailures >= GIVE_UP_AFTER_FAILURES) {
      const first = ((await db.execute(sql`select error from broadcast_recipients where job_id = ${id} and status = 'failed' limit 1`)).rows[0] as any)?.error || '';
      await db.execute(sql`update broadcast_jobs set status = 'stopped', finished_at = now(), note = ${`Stopped after ${consecutiveFailures} failures in a row at the start, so nothing else was sent. ${first}`.trim().slice(0, 400)} where id = ${id} and status = 'running'`);
      return;
    }
  }

  const open = Number(((await db.execute(sql`select count(*)::int as n from broadcast_recipients where job_id = ${id} and status in ('pending', 'sending')`)).rows[0] as any)?.n) || 0;
  await recount(id);
  if (open === 0) await db.execute(sql`update broadcast_jobs set status = 'done', finished_at = now(), note = null where id = ${id} and status = 'running'`);
}

// A timer on the server also works the queue, so a greeting carries on even when nobody has the page open.
// (On Cloud Run the server is slowed between requests, so the open page does most of the work.)
let timer: NodeJS.Timeout | null = null;
let busy = false;
export function startBroadcastWorker(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const jobs = (await db.execute(sql`select id from broadcast_jobs where status in ('queued', 'running') or (status = 'paused' and resume_at <= now()) order by created_at limit 3`)).rows as any[];
      for (const j of jobs) await processBroadcast(j.id, 10_000);
    } catch (e: any) {
      console.warn('Broadcast worker notice:', e?.message || e);
    } finally {
      busy = false;
    }
  }, 5000);
  timer.unref?.();
}
