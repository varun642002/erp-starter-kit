import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { documents } from './schema.documents.ts';
import { messageLog } from './schema.messages.ts';
import { listCompanies } from './companyService.ts';

// Sends an issued invoice to the customer's WhatsApp by itself, through the WhatsApp Business Cloud API.
// Needs these environment values (kept in Secret Manager on Cloud Run, never in the code):
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN
// Optional: WHATSAPP_TEMPLATE_NAME (default invoice_bill), WHATSAPP_TEMPLATE_LANG (default en),
//   PUBLIC_BASE_URL (the app's public address, used to build the bill link).
// The approved template must have four body variables: {{1}} customer name, {{2}} bill number,
// {{3}} amount, {{4}} bill link.

const GRAPH = 'https://graph.facebook.com/v20.0';

export interface AutoSendStatus {
  configured: boolean;
  missing: string[];
  templateName: string;
  templateLanguage: string;
  publicBaseUrl: string | null;
}

export function autoSendStatus(): AutoSendStatus {
  const missing: string[] = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  return {
    configured: missing.length === 0,
    missing,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'invoice_bill',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || null
  };
}

// 10 digit Indian mobile -> country code form WhatsApp expects (no plus sign).
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return null;
}

export async function ensureShareToken(documentId: string): Promise<string> {
  const [doc] = await db.select({ token: documents.shareToken }).from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error('Document not found');
  if (doc.token) return doc.token;
  const token = randomBytes(16).toString('hex');
  await db.update(documents).set({ shareToken: token }).where(eq(documents.id, documentId));
  return token;
}

export function billUrl(token: string, fallbackBase?: string): string {
  const base = (process.env.PUBLIC_BASE_URL || fallbackBase || '').replace(/\/+$/, '');
  return `${base}/b/${token}`;
}

const money = (n: number) => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;

export interface SendResult {
  status: 'sent' | 'failed' | 'queued' | 'skipped';
  detail: string;
  url?: string;
}

// Safe to call after every issue: it sends once per bill unless force is true, and never throws.
export async function autoSendBill(documentId: string, opts: { force?: boolean; fallbackBase?: string; user?: string } = {}): Promise<SendResult> {
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return { status: 'skipped', detail: 'Document not found' };
    if (doc.docType !== 'invoice') return { status: 'skipped', detail: 'Only invoices are sent' };
    if (!['Issued', 'Partially Paid', 'Paid'].includes(doc.status)) return { status: 'skipped', detail: `Invoice is ${doc.status}` };

    const to = toWhatsappNumber(doc.customerPhone);
    if (!to) return { status: 'skipped', detail: 'The customer has no valid mobile number' };

    if (!opts.force) {
      const [done] = await db
        .select({ id: messageLog.id })
        .from(messageLog)
        .where(
          and(eq(messageLog.refType, 'document'), eq(messageLog.refId, doc.id), eq(messageLog.channel, 'whatsapp-api'), eq(messageLog.status, 'sent'))
        )
        .limit(1);
      if (done) return { status: 'skipped', detail: 'Already sent' };
    }

    const token = await ensureShareToken(doc.id);
    const url = billUrl(token, opts.fallbackBase);
    const status = autoSendStatus();
    const companies = await listCompanies().catch(() => []);
    const company = companies.find((c) => c.id === doc.companyId)?.displayName || 'Acme Tractor Spares';
    const vars = [doc.customerName, doc.docNumber, money(doc.grandTotal), url];
    const body = `${company}: bill ${doc.docNumber} for ${money(doc.grandTotal)}. View: ${url}`;

    const log = async (state: 'sent' | 'failed' | 'queued', error: string | null, providerId: string | null) => {
      await db.insert(messageLog).values({
        id: `msg-${randomUUID()}`,
        branchId: doc.branchId,
        kind: 'invoice',
        refType: 'document',
        refId: doc.id,
        customerId: doc.customerId,
        customerName: doc.customerName,
        phone: to,
        channel: 'whatsapp-api',
        language: 'en',
        body,
        sentBy: opts.user || 'Automatic',
        status: state,
        error,
        providerId,
        createdAt: new Date()
      });
    };

    if (!status.configured) {
      await log('queued', `WhatsApp is not set up yet (missing ${status.missing.join(', ')})`, null);
      return { status: 'queued', detail: 'WhatsApp sending is not set up yet', url };
    }

    const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: status.templateName,
          language: { code: status.templateLanguage },
          components: [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text: String(text).slice(0, 1000) })) }]
        }
      })
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `WhatsApp request failed (${res.status})`;
      await log('failed', msg, null);
      return { status: 'failed', detail: msg, url };
    }
    await log('sent', null, json?.messages?.[0]?.id || null);
    return { status: 'sent', detail: 'Sent', url };
  } catch (e: any) {
    console.error('autoSendBill error:', e);
    return { status: 'failed', detail: e?.message || 'Unexpected error' };
  }
}
