import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { machineSales } from './schema.machineSales.ts';
import { messageLog } from './schema.messages.ts';
import { autoSendStatus, toWhatsappNumber, type SendResult } from './billMessenger.ts';
import { businessDate } from '../routes/context.ts';

// When a machine sale is delivered, the customer gets a thank-you message on WhatsApp by itself, on the mobile number saved in the sale:
// thanks for buying the machine from the shop, come again, and a button to the shop's website. No prices, no delivery note, no invoice.
//
// Needs the same two values as every WhatsApp sender (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN) and an approved template:
//   name WHATSAPP_THANKYOU_TEMPLATE_NAME (default purchase_thank_you), language WHATSAPP_THANKYOU_TEMPLATE_LANG (default en),
//   category Utility, two body variables and one fixed "Visit website" button (the link is part of the template, nothing is sent for it):
//   Hello {{1}}, thank you for purchasing {{2}} from Acme Tractor Spares. Thank you, visit again!
// THANKYOU_START_DATE (YYYY-MM-DD, optional): nothing is sent automatically before this day. A sent-by-hand message (force) ignores it.

export const THANKS_KIND = 'thank-you';
export const THANKS_REF = 'machine-sale-thanks';

export const thanksTemplate = () => ({
  name: process.env.WHATSAPP_THANKYOU_TEMPLATE_NAME || 'purchase_thank_you',
  language: process.env.WHATSAPP_THANKYOU_TEMPLATE_LANG || 'en'
});

const oneLine = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

// Safe to call after every delivery: it sends once per sale unless force is set, never throws, and a failure never undoes the delivery.
export async function autoSendThankYou(saleId: string, opts: { force?: boolean; user?: string } = {}): Promise<SendResult> {
  try {
    const [sale] = await db.select().from(machineSales).where(eq(machineSales.id, saleId));
    if (!sale) return { status: 'skipped', detail: 'Machine sale not found' };
    if (sale.status !== 'Delivered') return { status: 'skipped', detail: `The sale is ${sale.status}, not delivered yet` };
    if (sale.isHistorical) return { status: 'skipped', detail: 'An old record from the bill files' };
    const startDate = process.env.THANKYOU_START_DATE || '';
    if (!opts.force && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && businessDate() < startDate) return { status: 'skipped', detail: `Automatic thank-you messages start on ${startDate}` };

    const to = toWhatsappNumber(sale.customerPhone);
    if (!to) return { status: 'skipped', detail: 'The customer has no valid mobile number on this sale' };

    if (!opts.force) {
      const [done] = await db
        .select({ id: messageLog.id })
        .from(messageLog)
        .where(and(eq(messageLog.kind, THANKS_KIND), eq(messageLog.refType, THANKS_REF), eq(messageLog.refId, sale.id), eq(messageLog.channel, 'whatsapp-api'), eq(messageLog.status, 'sent')))
        .limit(1);
      if (done) return { status: 'skipped', detail: 'Already sent' };
    }

    const tpl = thanksTemplate();
    const status = autoSendStatus();
    const vars = [oneLine(sale.customerName || 'Customer', 60) || 'Customer', oneLine(sale.machineName || 'your machine', 80) || 'your machine'];
    const body = `Hello ${vars[0]}, thank you for purchasing ${vars[1]} from Acme Tractor Spares. Thank you, visit again!`;

    const log = async (state: 'sent' | 'failed' | 'queued', error: string | null, providerId: string | null) => {
      await db.insert(messageLog).values({
        id: `msg-${randomUUID()}`,
        branchId: sale.branchId,
        kind: THANKS_KIND,
        refType: THANKS_REF,
        refId: sale.id,
        customerId: sale.customerId,
        customerName: vars[0],
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
      return { status: 'queued', detail: 'WhatsApp sending is not set up yet' };
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: tpl.name,
          language: { code: tpl.language },
          components: [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text })) }]
        }
      })
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = [json?.error?.message || `WhatsApp request failed (${res.status})`, json?.error?.error_data?.details].filter(Boolean).join(' - ').slice(0, 400);
      await log('failed', msg, null);
      return { status: 'failed', detail: msg };
    }
    await log('sent', null, json?.messages?.[0]?.id || null);
    return { status: 'sent', detail: 'Sent' };
  } catch (e: any) {
    console.error('autoSendThankYou error:', e);
    return { status: 'failed', detail: e?.message || 'Unexpected error' };
  }
}
