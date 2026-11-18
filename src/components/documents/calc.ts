export const SELLER_STATE = 'Tamil Nadu';
export const SELLER_STATE_CODE = '33';

export const INDIAN_STATES: { name: string; code: string }[] = [
  { name: 'Andaman and Nicobar Islands', code: '35' },
  { name: 'Andhra Pradesh', code: '37' },
  { name: 'Arunachal Pradesh', code: '12' },
  { name: 'Assam', code: '18' },
  { name: 'Bihar', code: '10' },
  { name: 'Chandigarh', code: '04' },
  { name: 'Chhattisgarh', code: '22' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: '26' },
  { name: 'Delhi', code: '07' },
  { name: 'Goa', code: '30' },
  { name: 'Gujarat', code: '24' },
  { name: 'Haryana', code: '06' },
  { name: 'Himachal Pradesh', code: '02' },
  { name: 'Jammu and Kashmir', code: '01' },
  { name: 'Jharkhand', code: '20' },
  { name: 'Karnataka', code: '29' },
  { name: 'Kerala', code: '32' },
  { name: 'Ladakh', code: '38' },
  { name: 'Lakshadweep', code: '31' },
  { name: 'Madhya Pradesh', code: '23' },
  { name: 'Maharashtra', code: '27' },
  { name: 'Manipur', code: '14' },
  { name: 'Meghalaya', code: '17' },
  { name: 'Mizoram', code: '15' },
  { name: 'Nagaland', code: '13' },
  { name: 'Odisha', code: '21' },
  { name: 'Puducherry', code: '34' },
  { name: 'Punjab', code: '03' },
  { name: 'Rajasthan', code: '08' },
  { name: 'Sikkim', code: '11' },
  { name: 'Tamil Nadu', code: '33' },
  { name: 'Telangana', code: '36' },
  { name: 'Tripura', code: '16' },
  { name: 'Uttar Pradesh', code: '09' },
  { name: 'Uttarakhand', code: '05' },
  { name: 'West Bengal', code: '19' }
];

// Invoices rely on the printed declaration; quotations carry the standard terms.
export const DEFAULT_TERMS = {
  invoice: '',
  quotation:
    '1. Prices are valid until the date shown above.\n2. Taxes are charged as applicable at the time of invoicing.\n3. Delivery subject to stock availability.\n4. Subject to Sampletown jurisdiction.'
} as const;

export const DEFAULT_CREDIT_DAYS = 15;

export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function stateFromGstin(gstin: string | null | undefined): string | null {
  const code = (gstin || '').trim().slice(0, 2);
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? null;
}

// Mirrors the server rule: the GSTIN state code wins, otherwise the place of supply decides.
export function isInterStateSupply(gstin: string | null | undefined, placeOfSupply: string | null | undefined): boolean {
  const g = (gstin || '').trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2) !== SELLER_STATE_CODE;
  return (placeOfSupply || SELLER_STATE).trim().toLowerCase() !== SELLER_STATE.toLowerCase();
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface CalcLine {
  quantity: number;
  rate: number;
  discountPercent: number;
  gstRate: number;
}

// Shared by the server (authoritative) and the builder (live preview) so both always agree.
// Tax is split per line: intra-state gives CGST = SGST = round(taxable * rate / 2, 2) and
// interstate gives IGST = round(taxable * rate, 2). The grand total is rounded to the rupee.
export function calcDocument(lines: CalcLine[], isInterState: boolean, otherCharges: number, pricesIncludeTax = false) {
  let gross = 0;
  let taxable = 0;
  let cgstSum = 0;
  let sgstSum = 0;
  let igstSum = 0;
  const computed = lines.map((l) => {
    const q = Number.isFinite(l.quantity) ? l.quantity : 0;
    const r = Number.isFinite(l.rate) ? l.rate : 0;
    const d = Number.isFinite(l.discountPercent) ? l.discountPercent : 0;
    const factor = 1 + l.gstRate / 100;
    const entered = q * r * (1 - d / 100);
    const taxableValue = round2(pricesIncludeTax ? entered / factor : entered);
    const half = isInterState ? 0 : round2((taxableValue * l.gstRate) / 200);
    const integrated = isInterState ? round2((taxableValue * l.gstRate) / 100) : 0;
    const taxAmount = round2(half * 2 + integrated);
    gross += round2(pricesIncludeTax ? (q * r) / factor : q * r);
    taxable += taxableValue;
    cgstSum += half;
    sgstSum += half;
    igstSum += integrated;
    return {
      taxableValue,
      taxAmount,
      lineTotal: round2(taxableValue + taxAmount),
      baseRate: round2(pricesIncludeTax ? r / factor : r),
      inclusiveRate: round2(pricesIncludeTax ? r : r * factor)
    };
  });
  const subtotal = round2(gross);
  const taxableAmount = round2(taxable);
  const cgst = round2(cgstSum);
  const sgst = round2(sgstSum);
  const igst = round2(igstSum);
  const extra = Number.isFinite(otherCharges) ? round2(otherCharges) : 0;
  const pre = round2(taxableAmount + cgst + sgst + igst + extra);
  const grandTotal = Math.round(pre);
  return {
    lines: computed,
    subtotal,
    totalDiscount: Math.max(0, round2(subtotal - taxableAmount)),
    taxableAmount,
    totalTax: round2(cgst + sgst + igst),
    cgst,
    sgst,
    igst,
    otherCharges: extra,
    roundOff: round2(grandTotal - pre),
    grandTotal
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD -> d-MMM-yy (6-Oct-26)
export const formatDateShort = (iso: string | null | undefined): string => {
  if (!iso) return '';
  if (iso.startsWith('1900-01-01')) return 'No date'; // old bills that never had a date written on them
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1] ?? m[2]}-${m[1].slice(2)}`;
};

// YYYY-MM-DDTHH:mm -> 6-Oct-26 5:00 PM
export const formatDateTimeShort = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return formatDateShort(iso);
  const h = Number(m[2]);
  return `${formatDateShort(m[1])} ${h % 12 || 12}:${m[3]} ${h < 12 ? 'AM' : 'PM'}`;
};

export const stateCodeFromName = (name: string | null | undefined): string | null =>
  INDIAN_STATES.find((s) => s.name.toLowerCase() === (name || '').trim().toLowerCase())?.code ?? null;

export const stateNameFromCode = (code: string | null | undefined): string | null =>
  INDIAN_STATES.find((s) => s.code === (code || '').trim())?.name ?? null;

// Indian digit grouping with two decimals: 1,14,285.71
export const inr = (n: number): string => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// d-MMM-yy everywhere on screen, with a dash for empty values.
export const formatDate = (iso: string | null | undefined): string => formatDateShort(iso) || '-';
