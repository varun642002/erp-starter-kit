import type { Express, Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { getPendingPayments } from '../db/messageService.ts';
import { parsePayToken, upiFor, upiUri } from '../db/payLink.ts';
import { db } from '../db/index.ts';
import { sql } from 'drizzle-orm';

// Public "Pay now" page opened from the link in a payment reminder. The signed token is the only key. It shows the live balance of
// that one bill and a Pay with UPI button for the company's own UPI ID; nothing else about the business is exposed.

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const money = (n: number) => `Rs ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>
body{margin:0;background:#f1f5f9;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
.wrap{max-width:460px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:14px;text-align:center}
h1{font-size:18px;margin:0 0 2px}.muted{color:#64748b;font-size:13px}
.amt{font-size:32px;font-weight:800;margin:6px 0}
.btn{display:block;background:#16a34a;color:#fff;text-decoration:none;border-radius:12px;padding:14px 16px;font-weight:700;font-size:17px;margin:14px 0 6px}
.upi{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f1f5f9;border-radius:8px;padding:6px 10px;display:inline-block;margin-top:6px;word-break:break-all}
img{width:200px;height:200px;margin-top:10px}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const notFound = () => page('Link not valid', '<div class="card"><h1>This link is not valid</h1><p class="muted">Please ask the shop to send it again.</p></div>');

export function registerPublicPayRoutes(app: Express): void {
  app.get('/pay/:token', async (req: Request, res: Response) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    try {
      const parsed = parsePayToken(String(req.params.token || ''));
      if (!parsed) return res.status(404).send(notFound());

      const row = (await getPendingPayments('all')).find((p) => p.source === parsed.source && p.invoiceId === parsed.id);
      if (!row) {
        return res.send(page('Nothing pending', '<div class="card"><h1>Nothing is pending on this bill</h1><p class="muted">Thank you. If you have just paid, the shop will update its records shortly.</p></div>'));
      }
      // the company on the bill decides whose UPI ID is used
      // (a job card has no company of its own, so it is paid to the first company that has a UPI ID)
      const table = parsed.source === 'invoice' ? 'documents' : parsed.source === 'machine-sale' ? 'machine_sales' : null;
      const co = table ? ((await db.execute(sql`select company_id from ${sql.raw(table)} where id = ${parsed.id}`)).rows[0] as any) : null;
      const upi = await upiFor(co?.company_id);
      if (!upi) return res.send(page('Pay', '<div class="card"><h1>Online payment is not set up yet</h1><p class="muted">Please contact the shop to pay this bill.</p></div>'));

      const uri = upiUri(upi.upiId, upi.payee, row.balance, `Bill ${row.invoiceNumber}`);
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      const body = `
<div class="card">
  <h1>${esc(upi.payee)}</h1>
  <div class="muted">Payment request for ${esc(row.customerName)}</div>
</div>
<div class="card">
  <div class="muted">Bill ${esc(row.invoiceNumber)}</div>
  <div class="amt">${money(row.balance)}</div>
  <div class="muted">pending balance</div>
  <a class="btn" href="${esc(uri)}">Pay ${money(row.balance)} now</a>
  <div class="muted">Opens GPay, PhonePe, Paytm or any UPI app with the amount filled in. Please check the amount and the name before you pay.</div>
</div>
<div class="card">
  <div class="muted">On a computer, or from another phone, scan this code with any UPI app</div>
  <img src="${qr}" alt="UPI QR code">
  <div class="muted" style="margin-top:8px">or pay to UPI ID</div>
  <div class="upi">${esc(upi.upiId)}</div>
</div>`;
      res.send(page(`Pay bill ${row.invoiceNumber}`, body));
    } catch (e) {
      console.error('GET /pay/:token error:', e);
      res.status(500).send(page('Unavailable', '<div class="card"><h1>Unavailable</h1><p class="muted">Please try again in a moment.</p></div>'));
    }
  });
}
