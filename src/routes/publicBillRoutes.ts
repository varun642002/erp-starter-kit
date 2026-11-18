import type { Express, Request, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { documentItems, documentPayments, documents } from '../db/schema.documents.ts';
import { listCompanies } from '../db/companyService.ts';

// Public, read-only bill page opened from the link sent to the customer. The long random token is the
// only key, so nothing else about the business is exposed.

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
body{margin:0;background:#f1f5f9;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
.wrap{max-width:760px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:14px}
h1{font-size:18px;margin:0 0 2px}.muted{color:#64748b;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;padding:6px 4px}
td{padding:7px 4px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.r{text-align:right}.tot td{border:0;padding:3px 4px}.grand td{font-weight:700;border-top:2px solid #0f172a;font-size:15px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
.paid{background:#dcfce7;color:#166534}.due{background:#fee2e2;color:#991b1b}.part{background:#fef9c3;color:#854d0e}
button{background:#1e293b;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer}
@media print{body{background:#fff}.no-print{display:none}.card{border:0;padding:0}}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export function registerPublicBillRoutes(app: Express): void {
  app.get('/b/:token', async (req: Request, res: Response) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    try {
      const token = String(req.params.token || '');
      if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).send(page('Bill not found', '<div class="card"><h1>Bill not found</h1></div>'));

      const [doc] = await db.select().from(documents).where(eq(documents.shareToken, token));
      if (!doc || doc.docType !== 'invoice' || doc.status === 'Draft' || doc.status === 'Cancelled') {
        return res.status(404).send(page('Bill not found', '<div class="card"><h1>Bill not found</h1><p class="muted">This link is no longer valid.</p></div>'));
      }
      const [items, payments, companies] = await Promise.all([
        db.select().from(documentItems).where(eq(documentItems.documentId, doc.id)).orderBy(asc(documentItems.sortOrder), asc(documentItems.id)),
        db.select().from(documentPayments).where(eq(documentPayments.documentId, doc.id)).orderBy(asc(documentPayments.id)),
        listCompanies().catch(() => [])
      ]);
      const co = companies.find((c) => c.id === doc.companyId);
      const plain = doc.invoiceKind === 'plain';
      const balance = Math.max(0, Math.round((doc.grandTotal - doc.paidAmount) * 100) / 100);
      const state = balance <= 0 ? ['Paid', 'paid'] : doc.paidAmount > 0 ? ['Part paid', 'part'] : ['Payment due', 'due'];

      const rows = items
        .map(
          (it, i) => `<tr><td>${i + 1}</td><td>${esc(it.description)}${it.batchNote ? `<div class="muted">${esc(it.batchNote)}</div>` : ''}</td>
<td class="r">${esc(it.quantity)}${it.unit ? ` ${esc(it.unit)}` : ''}</td><td class="r">${money(it.rate)}</td><td class="r">${money(it.lineTotal)}</td></tr>`
        )
        .join('');

      const tax = plain
        ? ''
        : `<tr class="tot"><td colspan="2"></td><td colspan="2" class="r">Taxable value</td><td class="r">${money(doc.taxableAmount)}</td></tr>
${doc.isInterState ? `<tr class="tot"><td colspan="2"></td><td colspan="2" class="r">IGST</td><td class="r">${money(doc.igst)}</td></tr>` : `<tr class="tot"><td colspan="2"></td><td colspan="2" class="r">CGST</td><td class="r">${money(doc.cgst)}</td></tr>
<tr class="tot"><td colspan="2"></td><td colspan="2" class="r">SGST</td><td class="r">${money(doc.sgst)}</td></tr>`}`;

      const pays = payments.length
        ? `<div class="card"><strong>Payments received</strong><table style="margin-top:6px"><tbody>${payments
            .map((p) => `<tr><td>${esc(p.paidOn)}</td><td>${esc(p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${money(p.amount)}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '';

      const body = `
<div class="card">
  <h1>${esc(co?.displayName || 'Bill')}</h1>
  <div class="muted">${esc((co?.addressLines || '').replace(/\n/g, ', '))}</div>
  <div class="muted">${[co?.phone, co?.gstin ? `GSTIN ${co.gstin}` : ''].filter(Boolean).map(esc).join(' | ')}</div>
</div>
<div class="card">
  <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div><strong>${plain ? 'Invoice' : 'Tax Invoice'} ${esc(doc.docNumber)}</strong><div class="muted">Date ${esc(doc.docDate)}</div></div>
    <div><span class="badge ${state[1]}">${state[0]}</span></div>
  </div>
  <div style="margin-top:10px"><div class="muted">Billed to</div><strong>${esc(doc.customerName)}</strong>
  ${doc.billingAddress ? `<div class="muted">${esc(doc.billingAddress)}</div>` : ''}</div>
</div>
<div class="card">
  <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>${tax}${doc.otherCharges ? `<tr class="tot"><td colspan="2"></td><td colspan="2" class="r">Other charges</td><td class="r">${money(doc.otherCharges)}</td></tr>` : ''}
  <tr class="grand"><td colspan="2"></td><td colspan="2" class="r">Total</td><td class="r">${money(doc.grandTotal)}</td></tr>
  <tr class="tot"><td colspan="2"></td><td colspan="2" class="r">Paid</td><td class="r">${money(doc.paidAmount)}</td></tr>
  <tr class="tot"><td colspan="2"></td><td colspan="2" class="r"><strong>Balance</strong></td><td class="r"><strong>${money(balance)}</strong></td></tr>
  </tfoot></table>
</div>
${pays}
<div class="no-print" style="text-align:center"><button onclick="window.print()">Print or save as PDF</button></div>`;

      res.send(page(`Bill ${doc.docNumber}`, body));
    } catch (e) {
      console.error('GET /b/:token error:', e);
      res.status(500).send(page('Bill unavailable', '<div class="card"><h1>Bill unavailable</h1><p class="muted">Please try again in a moment.</p></div>'));
    }
  });
}
