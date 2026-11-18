import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { toWhatsappNumber } from './billMessenger.ts';

// Customers who replied STOP to a marketing message. They are left out of every marketing send (group greetings and
// campaigns). Payment reminders, bills and the daily report are not marketing and are not affected.
// They can come back by replying START.

export async function ensureOptOutTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists whatsapp_opt_outs (
      phone text primary key,
      replied text,
      created_at timestamptz not null default now()
    )`);
}

export async function optedOutNumbers(): Promise<Set<string>> {
  const rows = (await db.execute(sql`select phone from whatsapp_opt_outs`)).rows as { phone: string }[];
  return new Set(rows.map((r) => String(r.phone)));
}

const STOP_RE = /^(stop|stop all|stop messages|unsubscribe|opt[\s-]?out)$/i;
const START_RE = /^(start|subscribe)$/i;

// The whole message must be the word (capitals, spaces and punctuation around it do not matter), so "stop calling me at night" or "start tractor service" change nothing.
const plain = (text: string) => text.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, ' ').trim();
export const wantsToStop = (text: string) => text.length <= 40 && STOP_RE.test(plain(text));
export const wantsToStart = (text: string) => text.length <= 40 && START_RE.test(plain(text));

export function webhookSetup(): { verifyToken: string | null; appSecret: string | null } {
  return {
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null,
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() || null
  };
}

// Meta signs every webhook call: "sha256=" + HMAC-SHA256(app secret, exact request body).
export function validSignature(raw: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!raw || !header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  let got: Buffer;
  try {
    got = Buffer.from(header.slice(7), 'hex');
  } catch {
    return false;
  }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// Reads the messages in a webhook call and records STOP / START replies. Returns how many changed.
export async function handleInbound(body: any): Promise<{ stopped: number; started: number }> {
  let stopped = 0;
  let started = 0;
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const m of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        const text: string = String(m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title ?? '');
        const phone = toWhatsappNumber(String(m?.from ?? ''));
        if (!text || !phone) continue;
        if (wantsToStop(text)) {
          await db.execute(sql`insert into whatsapp_opt_outs (phone, replied) values (${phone}, ${text.slice(0, 60)}) on conflict (phone) do nothing`);
          stopped += 1;
        } else if (wantsToStart(text)) {
          await db.execute(sql`delete from whatsapp_opt_outs where phone = ${phone}`);
          started += 1;
        }
      }
    }
  }
  return { stopped, started };
}
