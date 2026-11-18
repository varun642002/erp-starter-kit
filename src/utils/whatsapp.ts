export type MessageLanguage = 'en' | 'ta';

// Returns a 12-digit number with the 91 prefix, or null when the input is not a usable Indian mobile number.
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  if (digits.length !== 10) return null;
  return `91${digits}`;
}

export function buildWhatsAppLink(phone: string | null | undefined, text: string): string | null {
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

// First usable number out of several candidates (e.g. primary then alternate phone).
export function pickValidPhone(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const n = normalizeIndianPhone(c);
    if (n) return n;
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD -> DD-MMM-YYYY
export function formatMessageDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  if (iso.startsWith('1900-01-01')) return 'No date'; // old bills that never had a date written on them
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]}-${month}-${m[1]}` : iso;
}

export function formatMessageAmount(amount: number, currencySymbol: string): string {
  return `${currencySymbol}${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

interface BaseCtx {
  language: MessageLanguage;
  company: string;
  customerName: string;
  currencySymbol: string;
}

export function paymentReminderMessage(
  ctx: BaseCtx & { invoiceNumber: string; amountDue: number; dueDate: string | null; billLabel?: string; payUrl?: string | null }
): string {
  const amount = formatMessageAmount(ctx.amountDue, ctx.currencySymbol);
  const label = ctx.billLabel || 'Invoice';
  const dueEn = ctx.dueDate ? ` (due date: ${formatMessageDate(ctx.dueDate)})` : '';
  const payEn = ctx.payUrl ? `\n\nPay now: ${ctx.payUrl}` : '';
  const payTa = ctx.payUrl ? `\n\nஇப்போது செலுத்த: ${ctx.payUrl}` : '';
  const dueTa = ctx.dueDate ? ` (செலுத்த வேண்டிய தேதி: ${formatMessageDate(ctx.dueDate)})` : '';
  if (ctx.language === 'ta') {
    return `வணக்கம் ${ctx.customerName},\n\n${ctx.company} சார்பில் ஒரு நினைவூட்டல். உங்கள் ${ctx.billLabel ? 'பில்' : 'இன்வாய்ஸ்'} ${ctx.invoiceNumber}-க்கு ${amount} நிலுவையில் உள்ளது${dueTa}.\n\nதயவுசெய்து விரைவில் செலுத்தவும். ஏற்கனவே செலுத்தியிருந்தால் இந்தச் செய்தியைப் புறக்கணிக்கவும்.${payTa}\n\nநன்றி,\n${ctx.company}`;
  }
  return `Dear ${ctx.customerName},\n\nThis is a gentle reminder from ${ctx.company}. ${label} ${ctx.invoiceNumber} has an outstanding balance of ${amount}${dueEn}.\n\nKindly arrange the payment at your earliest convenience. If you have already paid, please ignore this message.${payEn}\n\nThank you,\n${ctx.company}`;
}

export function warrantyExpiryMessage(
  ctx: BaseCtx & { productName: string; serialNumber: string; expiryDate: string; daysLeft: number }
): string {
  const date = formatMessageDate(ctx.expiryDate);
  const expired = ctx.daysLeft < 0;
  if (ctx.language === 'ta') {
    const status = expired
      ? `உத்தரவாதம் ${date} அன்று முடிவடைந்தது.`
      : `உத்தரவாதம் ${date} அன்று முடிவடைகிறது.`;
    const ask = expired
      ? 'பராமரிப்பு ஒப்பந்தம் (AMC) மற்றும் சர்வீஸ் விவரங்களுக்கு எங்களைத் தொடர்பு கொள்ளவும்.'
      : 'உத்தரவாதம் முடிவதற்குள் இலவச பரிசோதனைக்கு எங்களைத் தொடர்பு கொள்ளவும்.';
    return `வணக்கம் ${ctx.customerName},\n\n${ctx.company} சார்பில் தகவல். உங்கள் ${ctx.productName} (வரிசை எண்: ${ctx.serialNumber}) இயந்திரத்தின் ${status}\n\n${ask}\n\nநன்றி,\n${ctx.company}`;
  }
  const status = expired
    ? `The warranty on your ${ctx.productName} (serial no. ${ctx.serialNumber}) expired on ${date}.`
    : `The warranty on your ${ctx.productName} (serial no. ${ctx.serialNumber}) expires on ${date}.`;
  const ask = expired
    ? 'Please contact us to know about our annual maintenance contract (AMC) and service options.'
    : 'Please contact us before it ends to book a free inspection of your machine.';
  return `Dear ${ctx.customerName},\n\n${ctx.company} here. ${status}\n\n${ask}\n\nThank you,\n${ctx.company}`;
}

export function jobReadyMessage(
  ctx: BaseCtx & { jobNumber: string; machineModel: string | null; balanceDue: number }
): string {
  const machine = ctx.machineModel || (ctx.language === 'ta' ? 'இயந்திரம்' : 'machine');
  const balance = Math.max(0, ctx.balanceDue);
  const amount = formatMessageAmount(balance, ctx.currencySymbol);
  if (ctx.language === 'ta') {
    const pay = balance > 0 ? `டெலிவரிக்கு முன் செலுத்த வேண்டிய தொகை: ${amount}.` : 'செலுத்த வேண்டிய தொகை எதுவும் இல்லை.';
    return `வணக்கம் ${ctx.customerName},\n\nஉங்கள் ${machine} (வேலை அட்டை ${ctx.jobNumber}) தயாராக உள்ளது. ${pay}\n\nதயவுசெய்து கடைக்கு வந்து பெற்றுக்கொள்ளவும்.\n\nநன்றி,\n${ctx.company}`;
  }
  const pay = balance > 0 ? `The balance to be paid before delivery is ${amount}.` : 'There is no balance to pay.';
  return `Dear ${ctx.customerName},\n\nYour ${machine} (job card ${ctx.jobNumber}) is ready for delivery. ${pay}\n\nPlease visit the shop to collect it.\n\nThank you,\n${ctx.company}`;
}

export interface CustomTemplate {
  id: string;
  label: { en: string; ta: string };
  build: (ctx: BaseCtx) => string;
}

export const CUSTOM_TEMPLATES: CustomTemplate[] = [
  {
    id: 'greeting',
    label: { en: 'General greeting', ta: 'பொது வணக்கம்' },
    build: (c) =>
      c.language === 'ta'
        ? `வணக்கம் ${c.customerName},\n\n${c.company} சார்பில் வணக்கம். டிராக்டர் மற்றும் உதிரிபாகங்கள் தொடர்பான எந்த உதவிக்கும் எங்களைத் தொடர்பு கொள்ளவும்.\n\nநன்றி,\n${c.company}`
        : `Dear ${c.customerName},\n\nGreetings from ${c.company}. Please contact us for any help with your tractor or spare parts.\n\nThank you,\n${c.company}`
  },
  {
    id: 'service',
    label: { en: 'Service due reminder', ta: 'சர்வீஸ் நினைவூட்டல்' },
    build: (c) =>
      c.language === 'ta'
        ? `வணக்கம் ${c.customerName},\n\nஉங்கள் டிராக்டரின் அடுத்த சர்வீஸ் நேரம் வந்துவிட்டது. சர்வீஸ் நேரத்தை முன்பதிவு செய்ய ${c.company}-ஐ தொடர்பு கொள்ளவும்.\n\nநன்றி,\n${c.company}`
        : `Dear ${c.customerName},\n\nYour tractor is due for its next service. Please contact ${c.company} to book a convenient slot.\n\nThank you,\n${c.company}`
  },
  {
    id: 'thanks',
    label: { en: 'Thank you for your purchase', ta: 'வாங்கியதற்கு நன்றி' },
    build: (c) =>
      c.language === 'ta'
        ? `வணக்கம் ${c.customerName},\n\n${c.company}-இல் வாங்கியதற்கு மிக்க நன்றி. உங்கள் வாங்குதலில் ஏதேனும் உதவி தேவைப்பட்டால் தயங்காமல் எங்களைத் தொடர்பு கொள்ளவும்.\n\nநன்றி,\n${c.company}`
        : `Dear ${c.customerName},\n\nThank you for your purchase from ${c.company}. If you need any help with your purchase, please feel free to contact us.\n\nThank you,\n${c.company}`
  },
  {
    id: 'spares',
    label: { en: 'Spares available', ta: 'உதிரிபாகங்கள் கிடைக்கும்' },
    build: (c) =>
      c.language === 'ta'
        ? `வணக்கம் ${c.customerName},\n\nநீங்கள் கேட்ட உதிரிபாகங்கள் ${c.company}-இல் இப்போது கிடைக்கின்றன. தயவுசெய்து கடைக்கு வந்து பெற்றுக்கொள்ளவும்.\n\nநன்றி,\n${c.company}`
        : `Dear ${c.customerName},\n\nThe spare parts you enquired about are now available at ${c.company}. Please visit the shop to collect them.\n\nThank you,\n${c.company}`
  }
];

// Templates for bulk marketing. {name} is replaced with each customer's name when the message is built.
export interface MarketingTemplate {
  id: string;
  label: { en: string; ta: string };
  body: (ctx: { language: MessageLanguage; company: string }) => string;
}

export const MARKETING_TEMPLATES: MarketingTemplate[] = [
  {
    id: 'spares-stock',
    label: { en: 'New spares in stock', ta: 'புதிய உதிரிபாகங்கள்' },
    body: (c) =>
      c.language === 'ta'
        ? `வணக்கம் {name},\n\n${c.company}-இல் டிராக்டர் மற்றும் ரோட்டாவேட்டர் உதிரிபாகங்கள் புதிதாக வந்துள்ளன. தேவையான பாகங்களுக்கு கடைக்கு வாருங்கள் அல்லது எங்களை அழையுங்கள்.\n\nநன்றி,\n${c.company}`
        : `Dear {name},\n\nFresh stock of tractor and rotavator spare parts has arrived at ${c.company}. Visit the shop or call us for the parts you need.\n\nThank you,\n${c.company}`
  },
  {
    id: 'service-camp',
    label: { en: 'Service camp / offer', ta: 'சர்வீஸ் முகாம் / சலுகை' },
    body: (c) =>
      c.language === 'ta'
        ? `வணக்கம் {name},\n\n${c.company}-இல் சிறப்பு சர்வீஸ் முகாம் நடைபெறுகிறது. உங்கள் டிராக்டரை இலவசமாகப் பரிசோதிக்க வாருங்கள். தேதி மற்றும் நேரத்திற்கு எங்களைத் தொடர்பு கொள்ளவும்.\n\nநன்றி,\n${c.company}`
        : `Dear {name},\n\nA special service camp is on at ${c.company}. Bring your tractor for a free check-up. Contact us for the date and time.\n\nThank you,\n${c.company}`
  },
  {
    id: 'festival',
    label: { en: 'Festival greetings', ta: 'பண்டிகை வாழ்த்துகள்' },
    body: (c) =>
      c.language === 'ta'
        ? `வணக்கம் {name},\n\n${c.company} சார்பில் உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் இனிய பண்டிகை நல்வாழ்த்துகள்!\n\nநன்றி,\n${c.company}`
        : `Dear {name},\n\nWishing you and your family a happy festival from all of us at ${c.company}!\n\nThank you,\n${c.company}`
  }
];

export const MARKETING_OPT_OUT: Record<MessageLanguage, string> = {
  en: 'Reply STOP if you do not want these messages.',
  ta: 'இந்தச் செய்திகள் வேண்டாம் என்றால் STOP என்று பதில் அனுப்பவும்.'
};

// One-line offer text that goes into variable {{2}} of the approved marketing template.
export const MARKETING_OFFERS: Record<string, Record<MessageLanguage, (company: string) => string>> = {
  'spares-stock': {
    en: (c) => `Fresh stock of tractor and rotavator spare parts has arrived at ${c}. Visit the shop or call us for the parts you need.`,
    ta: (c) => `${c}-இல் டிராக்டர் மற்றும் ரோட்டாவேட்டர் உதிரிபாகங்கள் புதிதாக வந்துள்ளன. தேவையான பாகங்களுக்கு கடைக்கு வாருங்கள் அல்லது அழையுங்கள்.`
  },
  'service-camp': {
    en: (c) => `A special service camp is on at ${c}. Bring your tractor for a free check-up and call us for the date and time.`,
    ta: (c) => `${c}-இல் சிறப்பு சர்வீஸ் முகாம் நடைபெறுகிறது. உங்கள் டிராக்டரை இலவசமாகப் பரிசோதிக்க வாருங்கள். தேதி, நேரத்திற்கு அழையுங்கள்.`
  },
  festival: {
    en: (c) => `Wishing you and your family a happy festival from all of us at ${c}!`,
    ta: (c) => `${c} சார்பில் உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் இனிய பண்டிகை நல்வாழ்த்துகள்!`
  }
};
