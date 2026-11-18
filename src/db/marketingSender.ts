import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { messageLog } from './schema.messages.ts';
import { toWhatsappNumber } from './billMessenger.ts';
import { optedOutNumbers } from './optOuts.ts';

// Sends one approved WhatsApp marketing template to a group of people (up to 200) in one go, through the WhatsApp
// Business Cloud API. Needs, as environment values (kept in Secret Manager on Cloud Run, never in the code):
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN   (the same two the invoice sender uses)
//   WHATSAPP_MARKETING_TEMPLATE_NAME                  (an approved template in the MARKETING category)
// Optional: WHATSAPP_MARKETING_TEMPLATE_LANG (default en).
// The template body must have two variables: {{1}} the customer's name and {{2}} the offer text (one line).
// POSTER MODE: when the template name ends in "_poster" (for example marketing_poster) the template has an IMAGE header and one body
// variable ({{1}} the customer's name); the poster picked in the app is uploaded to WhatsApp and goes at the top of every message.

const GRAPH = 'https://graph.facebook.com/v20.0';
export const MAX_GROUP = 200;
const PARALLEL = 8;
const GIVE_UP_AFTER_FAILURES = 5; // this many failures in a row at the very start means the setup is wrong

export interface MarketingStatus {
  configured: boolean;
  missing: string[];
  templateName: string | null;
  templateLanguage: string;
  posterMode: boolean; // the template carries a poster (image) instead of an offer text
}

export function marketingStatus(): MarketingStatus {
  const missing: string[] = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!process.env.WHATSAPP_MARKETING_TEMPLATE_NAME) missing.push('WHATSAPP_MARKETING_TEMPLATE_NAME');
  return {
    configured: missing.length === 0,
    missing,
    templateName: process.env.WHATSAPP_MARKETING_TEMPLATE_NAME || null,
    templateLanguage: process.env.WHATSAPP_MARKETING_TEMPLATE_LANG || 'en',
    posterMode: /_poster$/i.test(process.env.WHATSAPP_MARKETING_TEMPLATE_NAME || '')
  };
}

export interface MarketingRecipient {
  customerId?: string | null;
  name: string;
  phone: string;
  branchId?: string | null;
}

export interface MarketingSendResult {
  sent: number;
  failed: number;
  skipped: number; // already sent in this campaign, or no usable number
  stoppedEarly: string | null;
  failures: { name: string; phone: string; error: string }[];
}

export interface MarketingPoster {
  mime: string; // image/jpeg or image/png
  data: string; // the picture, base64
}

const MAX_POSTER_BYTES = 4 * 1024 * 1024;

// Uploads the poster to WhatsApp once and returns its media id (valid for 30 days).
async function uploadPoster(p: MarketingPoster): Promise<string> {
  const mime = p.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const buf = Buffer.from(String(p.data || ''), 'base64');
  if (!buf.length || buf.length > MAX_POSTER_BYTES) throw new Error('The poster must be a JPG or PNG picture under 4 MB.');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buf], { type: mime }), mime === 'image/png' ? 'poster.png' : 'poster.jpg');
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: form
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) throw new Error(`WhatsApp did not accept the poster: ${json?.error?.message || res.status}`);
  return String(json.id);
}

// One variable may not hold line breaks, tabs or long runs of spaces (WhatsApp rejects the message otherwise).
const oneLine = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

export async function sendMarketingGroup(
  input: { campaign: string; offerText: string; recipients: MarketingRecipient[]; poster?: MarketingPoster },
  user: string
): Promise<MarketingSendResult> {
  const status = marketingStatus();
  if (!status.configured) throw new Error(`WhatsApp sending is not set up yet (missing ${status.missing.join(', ')}).`);

  const campaign = input.campaign.trim().slice(0, 120);
  const offer = status.posterMode ? '' : oneLine(input.offerText || '', 600);
  if (!campaign) throw new Error('Campaign name is required.');
  if (!status.posterMode && !offer) throw new Error('The offer text is required.');
  if (status.posterMode && !input.poster) throw new Error('Choose the poster to send first.');
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) throw new Error('No recipients.');
  if (input.recipients.length > MAX_GROUP) throw new Error(`Send at most ${MAX_GROUP} people at a time.`);

  // the poster goes up once for the whole group, after the quick checks above
  const mediaIdPromise = status.posterMode ? uploadPoster(input.poster as MarketingPoster) : Promise.resolve<string | null>(null);
  mediaIdPromise.catch(() => undefined); // a failure is reported when it is awaited below, never as an unhandled rejection

  // Numbers already sent through the API in this campaign are never sent again.
  const already = await db
    .select({ phone: messageLog.phone })
    .from(messageLog)
    .where(
      and(eq(messageLog.kind, 'marketing'), eq(messageLog.refId, campaign), eq(messageLog.channel, 'whatsapp-api'), eq(messageLog.status, 'sent'))
    );
  const sentBefore = new Set(already.map((r) => r.phone));
  const optedOut = await optedOutNumbers(); // people who replied STOP are never sent marketing

  const queue: { name: string; to: string; customerId: string | null; branchId: string }[] = [];
  const seen = new Set<string>();
  const result: MarketingSendResult = { sent: 0, failed: 0, skipped: 0, stoppedEarly: null, failures: [] };
  for (const r of input.recipients) {
    const to = toWhatsappNumber(r.phone);
    if (!to || seen.has(to) || sentBefore.has(to) || optedOut.has(to)) {
      result.skipped += 1;
      continue;
    }
    seen.add(to);
    queue.push({ name: oneLine(r.name || 'Customer', 60) || 'Customer', to, customerId: r.customerId || null, branchId: r.branchId || 'branch-1' });
  }

  const mediaId = await mediaIdPromise;
  let consecutiveFailures = 0;
  let sentAny = false;
  let cursor = 0;

  const sendOne = async (item: (typeof queue)[number]) => {
    const body = status.posterMode ? `${item.name}: poster for "${campaign}"` : `${item.name}: ${offer}`;
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
              ...(mediaId ? [{ type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] }] : []),
              { type: 'body', parameters: (status.posterMode ? [item.name] : [item.name, offer]).map((text) => ({ type: 'text', text })) }
            ]
          }
        })
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) {
        state = 'sent';
        providerId = json?.messages?.[0]?.id || null;
      } else {
        error = (json?.error?.message || `WhatsApp request failed (${res.status})`).slice(0, 300);
      }
    } catch (e: any) {
      error = (e?.message || 'Network error').slice(0, 300);
    }

    await db
      .insert(messageLog)
      .values({
        id: `msg-${randomUUID()}`,
        branchId: item.branchId,
        kind: 'marketing',
        refType: 'campaign',
        refId: campaign,
        customerId: item.customerId,
        customerName: item.name,
        phone: item.to,
        channel: 'whatsapp-api',
        language: status.templateLanguage === 'ta' ? 'ta' : 'en',
        body,
        sentBy: user,
        status: state,
        error,
        providerId,
        createdAt: new Date()
      })
      .catch((e) => console.error('marketing log error:', e));

    if (state === 'sent') {
      result.sent += 1;
      sentAny = true;
      consecutiveFailures = 0;
    } else {
      result.failed += 1;
      consecutiveFailures += 1;
      if (result.failures.length < 20) result.failures.push({ name: item.name, phone: item.to.slice(2), error: error || 'Failed' });
    }
  };

  const worker = async () => {
    while (cursor < queue.length) {
      if (!sentAny && consecutiveFailures >= GIVE_UP_AFTER_FAILURES) return;
      const item = queue[cursor++];
      await sendOne(item);
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
