import { createHmac, timingSafeEqual } from 'node:crypto';
import { listCompanies } from './companyService.ts';

// The "Pay now" link in a payment reminder: https://<app>/pay/<token>. The page shows what is still owed and a Pay with UPI button for
// the company's own UPI ID (Control Center > company details), so the money goes straight to the company's bank account.
//
// The token is signed (HMAC) so a link cannot be made up for someone else's bill. The signing secret is DAILY_REPORT_KEY.
// The amount shown is always read from the database at the moment the page is opened.

export type PaySource = 'invoice' | 'machine-sale' | 'job-card';
const CODE: Record<PaySource, string> = { invoice: 'i', 'machine-sale': 'm', 'job-card': 'j' };
const FROM_CODE: Record<string, PaySource> = { i: 'invoice', m: 'machine-sale', j: 'job-card' };

const secret = () => {
  const k = process.env.DAILY_REPORT_KEY || '';
  return k.length >= 16 ? `pay-link:${k}` : null;
};
const sign = (data: string, key: string) => createHmac('sha256', key).update(data).digest('base64url').slice(0, 22);

export function payToken(source: PaySource, id: string): string | null {
  const key = secret();
  if (!key) return null;
  const body = `${CODE[source]}.${id}`;
  return `${body}.${sign(body, key)}`;
}

export function parsePayToken(rawToken: string): { source: PaySource; id: string } | null {
  // The WhatsApp button link was saved as ".../pay/{{1}}" and WhatsApp adds the code after it, so the page may be opened
  // as "/pay/{{1}}<code>". The placeholder is dropped here, whichever way the button link was written.
  const token = rawToken.replace(/^(\{\{1\}\})+/, '');
  const key = secret();
  if (!key || !/^[A-Za-z0-9._-]{8,200}$/.test(token)) return null;
  const cut = token.lastIndexOf('.');
  if (cut < 3) return null;
  const body = token.slice(0, cut);
  const sig = token.slice(cut + 1);
  const want = sign(body, key);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const dot = body.indexOf('.');
  const source = FROM_CODE[body.slice(0, dot)];
  const id = body.slice(dot + 1);
  return source && id ? { source, id } : null;
}

export function payBase(): string {
  return (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
}

export function payUrl(source: PaySource, id: string): string | null {
  const token = payToken(source, id);
  const base = payBase();
  return token && base ? `${base}/pay/${token}` : null;
}

// Which company's UPI ID a bill is paid to: the company on the bill, else the first company that has one.
export async function upiFor(companyId: string | null | undefined): Promise<{ upiId: string; payee: string } | null> {
  const companies = await listCompanies().catch(() => []);
  const pick = companies.find((c) => c.id === companyId && c.upiId?.trim()) || companies.find((c) => c.upiId?.trim());
  return pick ? { upiId: pick.upiId.trim(), payee: pick.displayName || 'Payee' } : null;
}

export function upiUri(upiId: string, payee: string, amount: number, note: string): string {
  const q = (v: string) => encodeURIComponent(v);
  return `upi://pay?pa=${q(upiId)}&pn=${q(payee.slice(0, 60))}&am=${(Math.round(amount * 100) / 100).toFixed(2)}&cu=INR&tn=${q(note.slice(0, 50))}`;
}

// Is everything in place to put a Pay now link in a reminder?
export async function payLinkStatus(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  if (!secret()) missing.push('the signing key (DAILY_REPORT_KEY)');
  if (!payBase()) missing.push('the app address (PUBLIC_BASE_URL)');
  const companies = await listCompanies().catch(() => []);
  if (!companies.some((c) => c.upiId?.trim())) missing.push('a UPI ID in the company details');
  return { ready: missing.length === 0, missing };
}
