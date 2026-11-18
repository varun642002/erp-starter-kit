import { randomUUID } from 'node:crypto';
import { db } from './index.ts';
import { messageLog } from './schema.messages.ts';
import { toWhatsappNumber } from './billMessenger.ts';
import { getPendingPayments, type PendingPaymentRow } from './messageService.ts';
import { sql } from 'drizzle-orm';
import { payLinkStatus, payToken } from './payLink.ts';

// Sends payment reminders to people with a pending payment through the WhatsApp Business Cloud API, using an approved template.
// Needs, as environment values (kept in Secret Manager on Cloud Run, never in the code):
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN   (the same two the other senders use)
// Optional: WHATSAPP_REMINDER_TEMPLATE_NAME (default payment_reminder), WHATSAPP_REMINDER_TEMPLATE_LANG (default en),
//   REMINDER_COOLDOWN_DAYS (default 3: the same bill is not reminded again sooner).
// Template "payment_reminder_link" (category Utility, English): four body variables and a "Pay now" button whose link is
//   https://<app address>/pay/{{1}}   (the button variable is the signed token of the bill)
//   Hello {{1}}, this is a gentle reminder from Acme Agro Equipment. Bill {{2}} has a pending balance of {{3}} ({{4}}). Tap Pay now to pay by UPI. If you have already paid, please ignore this message. Thank you.
// Any other template name is sent with the four body variables only and no button.

const GRAPH = 'https://graph.facebook.com/v20.0';
export const MAX_REMINDERS = 300;
const PARALLEL = 6;
const GIVE_UP_AFTER_FAILURES = 5;

export interface ReminderStatus {
  configured: boolean;
  missing: string[];
  templateName: string;
  templateLanguage: string;
  usesLink: boolean; // the template has the Pay now button
  cooldownDays: number;
  maxAtOnce: number;
}

export function reminderStatus(): ReminderStatus {
  const missing: string[] = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  const templateName = process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'payment_reminder_link';
  return {
    configured: missing.length === 0,
    missing,
    templateName,
    templateLanguage: process.env.WHATSAPP_REMINDER_TEMPLATE_LANG || 'en',
    usesLink: /_link$/i.test(templateName),
    cooldownDays: Math.max(0, Number(process.env.REMINDER_COOLDOWN_DAYS ?? 3) || 0),
    maxAtOnce: MAX_REMINDERS
  };
}

export interface ReminderItem {
  source: PendingPaymentRow['source'];
  refId: string;
}

export interface ReminderSendResult {
  sent: number;
  failed: number;
  skipped: number; // no usable number, reminded recently, or no longer owing
  stoppedEarly: string | null;
  failures: { name: string; phone: string; error: string }[];
  skippedWhy: { noNumber: number; recent: number; notOwing: number };
}

const oneLine = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);
const rs = (n: number) => `Rs ${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const niceDate = (ymd: string | null) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
const REF_TYPE: Record<PendingPaymentRow['source'], string> = { invoice: 'invoice', 'machine-sale': 'machine-sale', 'job-card': 'job-card' };

// The four values for the template. Amounts and dates come from the database, never from the browser.
export function reminderVars(r: PendingPaymentRow): string[] {
  const when = r.dueDate
    ? r.daysOverdue > 0
      ? `overdue since ${niceDate(r.dueDate)}`
      : `due on ${niceDate(r.dueDate)}`
    : r.billDate
      ? `billed on ${niceDate(r.billDate)}`
      : 'pending';
  return [oneLine(r.customerName || 'Customer', 60) || 'Customer', oneLine(r.invoiceNumber || '-', 40), rs(r.balance), when];
}

// testTo: send the first chosen reminder to this number (the owner's own) instead of to the customer, to see how it looks.
// A test is not counted as a reminder to the customer, so it never blocks the real one.
export async function sendPaymentReminders(
  input: { items: ReminderItem[]; branchId: string; force?: boolean; testTo?: string },
  user: string
): Promise<ReminderSendResult> {
  const status = reminderStatus();
  if (!status.configured) throw new Error(`WhatsApp sending is not set up yet (missing ${status.missing.join(', ')}).`);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Nobody was chosen.');
  if (input.items.length > MAX_REMINDERS) throw new Error(`Send at most ${MAX_REMINDERS} reminders at a time.`);
  const testNumber = input.testTo ? toWhatsappNumber(input.testTo) : null;
  if (input.testTo && !testNumber) throw new Error('Enter your WhatsApp number as 10 digits for the test.');
  if (testNumber) input = { ...input, items: input.items.slice(0, 1), force: true };
  if (status.usesLink) {
    const pl = await payLinkStatus();
    if (!pl.ready) throw new Error(`The Pay now link is not ready yet. Missing: ${pl.missing.join(', ')}.`);
  }

  // What is owed is read again here, so a bill paid a minute ago is not asked for.
  const pending = await getPendingPayments(input.branchId);
  const byKey = new Map(pending.map((p) => [`${p.source}:${p.invoiceId}`, p]));

  const result: ReminderSendResult = { sent: 0, failed: 0, skipped: 0, stoppedEarly: null, failures: [], skippedWhy: { noNumber: 0, recent: 0, notOwing: 0 } };
  const since = new Date(Date.now() - status.cooldownDays * 86400000);
  const recent = new Set<string>();
  if (!input.force && status.cooldownDays > 0) {
    const rows = (await db.execute(sql`select ref_type, ref_id from message_log where kind = 'payment-reminder' and channel = 'whatsapp-api' and status = 'sent' and created_at >= ${since}`)).rows as any[];
    for (const r of rows) recent.add(`${r.ref_type}:${r.ref_id}`);
  }

  const queue: { row: PendingPaymentRow; to: string; vars: string[] }[] = [];
  const seen = new Set<string>();
  for (const it of input.items) {
    const key = `${it.source}:${it.refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = byKey.get(key);
    if (!row) {
      result.skipped += 1;
      result.skippedWhy.notOwing += 1;
      continue;
    }
    const to = testNumber || toWhatsappNumber(row.phone) || toWhatsappNumber(row.alternatePhone);
    if (!to) {
      result.skipped += 1;
      result.skippedWhy.noNumber += 1;
      continue;
    }
    if (recent.has(`${REF_TYPE[row.source]}:${row.invoiceId}`)) {
      result.skipped += 1;
      result.skippedWhy.recent += 1;
      continue;
    }
    queue.push({ row, to, vars: reminderVars(row) });
  }

  let consecutiveFailures = 0;
  let sentAny = false;
  let cursor = 0;

  const sendOne = async (item: (typeof queue)[number]) => {
    const body = `Hello ${item.vars[0]}, reminder: bill ${item.vars[1]} has a pending balance of ${item.vars[2]} (${item.vars[3]}).`;
    let state: 'sent' | 'failed' = 'failed';
    let error: string | null = null;
    let providerId: string | null = null;
    try {
      const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: item.to,
          type: 'template',
          template: {
            name: status.templateName,
            language: { code: status.templateLanguage },
            components: [
              { type: 'body', parameters: item.vars.map((text) => ({ type: 'text', text })) },
              // the Pay now button: its link is /pay/{{1}}, and {{1}} is the signed token of this bill
              ...(status.usesLink ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: payToken(item.row.source, item.row.invoiceId) || '' }] }] : [])
            ]
          }
        })
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) {
        state = 'sent';
        providerId = json?.messages?.[0]?.id || null;
      } else {
        error = [json?.error?.message || `WhatsApp request failed (${res.status})`, json?.error?.error_data?.details].filter(Boolean).join(' - ').slice(0, 400);
      }
    } catch (e: any) {
      error = (e?.message || 'Network error').slice(0, 300);
    }

    await db
      .insert(messageLog)
      .values({
        id: `msg-${randomUUID()}`,
        branchId: item.row.branchId || 'branch-1',
        kind: testNumber ? 'custom' : 'payment-reminder',
        refType: testNumber ? 'reminder-test' : REF_TYPE[item.row.source],
        refId: item.row.invoiceId,
        customerId: item.row.customerId,
        customerName: item.vars[0],
        phone: item.to,
        channel: 'whatsapp-api',
        language: 'en',
        body,
        sentBy: user,
        status: state,
        error,
        providerId,
        createdAt: new Date()
      })
      .catch((e) => console.error('reminder log error:', e));

    if (state === 'sent') {
      result.sent += 1;
      sentAny = true;
      consecutiveFailures = 0;
    } else {
      result.failed += 1;
      consecutiveFailures += 1;
      if (result.failures.length < 20) result.failures.push({ name: item.vars[0], phone: item.to.slice(2), error: error || 'Failed' });
    }
  };

  const worker = async () => {
    while (cursor < queue.length) {
      if (!sentAny && consecutiveFailures >= GIVE_UP_AFTER_FAILURES) return;
      await sendOne(queue[cursor++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));

  const notTried = queue.length - result.sent - result.failed;
  if (notTried > 0) {
    result.skipped += notTried;
    result.stoppedEarly = `Stopped after ${consecutiveFailures} failures in a row at the start, so nothing else was sent. ${result.failures[0]?.error || ''}`.trim();
  }
  return result;
}
