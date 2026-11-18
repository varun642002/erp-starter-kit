// Spoken Tamil for the Quick Sale voice assistant: number words and the sentences it says.
// Every sentence is built from real values (names, quantities, amounts) passed in by the caller.

const ONES = ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'];
const TEENS: Record<number, string> = {
  10: 'பத்து', 11: 'பதினொன்று', 12: 'பன்னிரண்டு', 13: 'பதின்மூன்று', 14: 'பதினான்கு',
  15: 'பதினைந்து', 16: 'பதினாறு', 17: 'பதினேழு', 18: 'பதினெட்டு', 19: 'பத்தொன்பது'
};
const TENS = ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'];
const TENS_JOIN = ['', '', 'இருபத்து', 'முப்பத்து', 'நாற்பத்து', 'ஐம்பத்து', 'அறுபத்து', 'எழுபத்து', 'எண்பத்து', 'தொண்ணூற்று'];
const HUNDREDS = ['', 'நூறு', 'இருநூறு', 'முந்நூறு', 'நானூறு', 'ஐந்நூறு', 'அறுநூறு', 'எழுநூறு', 'எண்ணூறு', 'தொள்ளாயிரம்'];
const HUNDREDS_JOIN = ['', 'நூற்று', 'இருநூற்று', 'முந்நூற்று', 'நானூற்று', 'ஐந்நூற்று', 'அறுநூற்று', 'எழுநூற்று', 'எண்ணூற்று', 'தொள்ளாயிரத்து'];
const THOUSANDS = ['', 'ஆயிரம்', 'இரண்டாயிரம்', 'மூவாயிரம்', 'நான்காயிரம்', 'ஐயாயிரம்', 'ஆறாயிரம்', 'ஏழாயிரம்', 'எட்டாயிரம்', 'ஒன்பதாயிரம்'];
const THOUSANDS_JOIN = ['', 'ஆயிரத்து', 'இரண்டாயிரத்து', 'மூவாயிரத்து', 'நான்காயிரத்து', 'ஐயாயிரத்து', 'ஆறாயிரத்து', 'ஏழாயிரத்து', 'எட்டாயிரத்து', 'ஒன்பதாயிரத்து'];

function below100(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS_JOIN[t]} ${ONES[o]}`;
}

function below1000(n: number, joinWithMore = false): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r);
  if (r === 0) return joinWithMore ? HUNDREDS_JOIN[h] : HUNDREDS[h];
  return `${HUNDREDS_JOIN[h]} ${below100(r)}`;
}

// Tamil words for a whole number; digits are used above 99,99,999 where nothing realistic is billed.
export function tamilNumber(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'பூஜ்யம்';
  if (n >= 100000000) return String(n);
  const parts: string[] = [];
  let rest = n;

  const crore = Math.floor(rest / 10000000);
  if (crore) {
    rest %= 10000000;
    parts.push(`${tamilNumber(crore)} கோடி${rest ? 'யே' : ''}`);
  }
  const lakh = Math.floor(rest / 100000);
  if (lakh) {
    rest %= 100000;
    parts.push(`${lakh === 1 ? 'ஒரு' : below100(lakh)} ${rest ? 'இலட்சத்து' : 'இலட்சம்'}`);
  }
  const thousand = Math.floor(rest / 1000);
  if (thousand) {
    rest %= 1000;
    const more = rest > 0;
    if (thousand < 10) parts.push(more ? THOUSANDS_JOIN[thousand] : THOUSANDS[thousand]);
    else parts.push(`${below100(thousand)} ${more ? 'ஆயிரத்து' : 'ஆயிரம்'}`);
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

// 1250 -> "ஆயிரத்து இருநூற்று ஐம்பது ரூபாய்", with paise when there are any.
export function rupeesInTamil(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  return paise ? `${tamilNumber(rupees)} ரூபாய் ${tamilNumber(paise)} பைசா` : `${tamilNumber(rupees)} ரூபாய்`;
}

// ---------- sentences ----------

export interface CartLine {
  name: string;
  quantity: number;
}

export const say = {
  added: (name: string, qty: number) => `${name}, ${tamilNumber(qty)} சேர்க்கப்பட்டது.`,
  addedMore: (name: string, qty: number, now: number) =>
    `${name}, மேலும் ${tamilNumber(qty)} சேர்க்கப்பட்டது. இப்போது மொத்தம் ${tamilNumber(now)}.`,
  askMore: () => 'வேறு பொருள் சேர்க்க வேண்டுமா?',
  quantitySet: (name: string, qty: number) => `${name} எண்ணிக்கை ${tamilNumber(qty)} ஆக மாற்றப்பட்டது.`,
  removed: (name: string) => `${name} நீக்கப்பட்டது.`,
  reduced: (name: string, by: number, now: number) => `${name}, ${tamilNumber(by)} குறைக்கப்பட்டது. இப்போது ${tamilNumber(now)} உள்ளது.`,
  notInSale: (query: string | null) => (query ? `"${query}" இந்த விற்பனையில் இல்லை.` : 'இந்த விற்பனையில் அந்தப் பொருள் இல்லை.'),
  whichInSale: (names: string[]) => `எந்தப் பொருள்? ${names.map((n, i) => `${tamilNumber(i + 1)}, ${n}`).join('. ')}.`,
  noProduct: (query: string) => `"${query}" என்ற பொருள் கிடைக்கவில்லை.`,
  whichProduct: (names: string[]) => `பல பொருட்கள் பொருந்துகின்றன. எது வேண்டும்? ${names.map((n, i) => `${tamilNumber(i + 1)}, ${n}`).join('. ')}.`,
  confirmProduct: (name: string) => `${name} என்பதா? ஆம் அல்லது இல்லை என்று சொல்லுங்கள்.`,
  lowStock: (name: string, stock: number) => `எச்சரிக்கை: ${name} இருப்பு ${tamilNumber(stock)} மட்டுமே உள்ளது.`,
  noStock: (name: string) => `எச்சரிக்கை: ${name} இருப்பு இல்லை.`,
  noPrice: (name: string) => `${name} க்கு விலை அமைக்கப்படவில்லை. விலையைக் கையால் உள்ளிடவும்.`,
  total: (amount: number) => `தற்போதைய மொத்தத் தொகை ${rupeesInTamil(amount)}.`,
  emptySale: () => 'இன்னும் எந்தப் பொருளும் சேர்க்கப்படவில்லை.',
  cart: (lines: CartLine[], amount: number) =>
    `${tamilNumber(lines.length)} பொருட்கள் உள்ளன. ${lines.map((l) => `${l.name}, ${tamilNumber(l.quantity)}`).join('. ')}. மொத்தத் தொகை ${rupeesInTamil(amount)}.`,
  price: (name: string, price: number, stock: number) =>
    price > 0
      ? `${name} விலை ${rupeesInTamil(price)}. இருப்பு ${tamilNumber(stock)}.`
      : `${name} க்கு விலை அமைக்கப்படவில்லை. இருப்பு ${tamilNumber(stock)}.`,
  confirmSave: (amount: number, customer: string | null) =>
    `${customer ? `வாடிக்கையாளர் ${customer}. ` : 'வாடிக்கையாளர் தேர்வு செய்யப்படவில்லை, வாக்-இன் வாடிக்கையாளராகச் சேமிக்கப்படும். '}மொத்தத் தொகை ${rupeesInTamil(amount)}. இந்த விற்பனையைச் சேமிக்கலாமா?`,
  saved: (invoice: string | null, amount: number) =>
    `விற்பனை சேமிக்கப்பட்டது.${invoice ? ` பில் எண் ${invoice}.` : ''} மொத்தத் தொகை ${rupeesInTamil(amount)}.`,
  saveFailed: (reason: string) => `விற்பனையைச் சேமிக்க முடியவில்லை. ${reason}`,
  saveCancelled: () => 'சேமிப்பு ரத்து செய்யப்பட்டது. தொடரலாம்.',
  nothingToSave: () => 'சேமிக்க எந்தப் பொருளும் இல்லை.',
  noPending: () => 'உறுதிப்படுத்த எதுவும் நிலுவையில் இல்லை. சேமிக்க, "விற்பனையைச் சேமிக்கவும்" என்று சொல்லுங்கள்.',
  confirmClear: () => 'எல்லாப் பொருட்களையும் நீக்கி இந்த விற்பனையை ரத்து செய்யலாமா?',
  cleared: () => 'விற்பனை ரத்து செய்யப்பட்டது.',
  customerSet: (name: string) => `வாடிக்கையாளர் ${name} தேர்வு செய்யப்பட்டார்.`,
  customerNone: (q: string) => `"${q}" என்ற வாடிக்கையாளர் கிடைக்கவில்லை. புதிய வாடிக்கையாளரைச் சேர்க்கலாம்.`,
  whichCustomer: (names: string[]) => `பல வாடிக்கையாளர்கள் பொருந்துகின்றனர். யார்? ${names.map((n, i) => `${tamilNumber(i + 1)}, ${n}`).join('. ')}.`,
  confirmCustomer: (name: string) => `${name} என்பவரா? ஆம் அல்லது இல்லை என்று சொல்லுங்கள்.`,
  discountPercent: (pct: number, amount: number, total: number) =>
    `${tamilNumber(pct)} சதவீதம், அதாவது ${rupeesInTamil(amount)} தள்ளுபடி சேர்க்கப்பட்டது. புதிய மொத்தத் தொகை ${rupeesInTamil(total)}.`,
  discountAmount: (amount: number, total: number) => `${rupeesInTamil(amount)} தள்ளுபடி சேர்க்கப்பட்டது. புதிய மொத்தத் தொகை ${rupeesInTamil(total)}.`,
  discountBad: () => 'தள்ளுபடி எவ்வளவு என்று புரியவில்லை. சதவீதம் அல்லது ரூபாய் சொல்லுங்கள்.',
  needQuantity: () => 'எத்தனை என்று சொல்லுங்கள்.',
  badQuantity: () => 'எண்ணிக்கை புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
  unknown: () => 'புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
  nothingHeard: () => 'எதுவும் கேட்கவில்லை. மைக்கை அழுத்தி மீண்டும் சொல்லுங்கள்.',
  help: () =>
    'நான் பொருட்களைச் சேர்க்கவும், எண்ணிக்கையை மாற்றவும், நீக்கவும், மொத்தத் தொகை சொல்லவும், வாடிக்கையாளரைத் தேர்வு செய்யவும், தள்ளுபடி கொடுக்கவும், விற்பனையைச் சேமிக்கவும் உதவுவேன்.',
  failed: () => 'மன்னிக்கவும், கட்டளையைச் செயல்படுத்த முடியவில்லை. கையால் உள்ளிடலாம்.'
};
