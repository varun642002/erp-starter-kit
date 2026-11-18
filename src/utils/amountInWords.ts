const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(below100(rest));
  return parts.join(' ');
}

// Indian numbering: Crore (10^7), Lakh (10^5), Thousand, Hundred. `n` must be a non-negative integer.
function integerInWords(n: number): string {
  if (n === 0) return ONES[0];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

// 125430.5 -> "Rupees One Lakh Twenty Five Thousand Four Hundred Thirty and Fifty Paise Only"
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0;
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  let words: string;
  if (rupees === 0 && paise > 0) {
    words = `${below100(paise)} Paise`;
  } else {
    words = `Rupees ${integerInWords(rupees)}`;
    if (paise > 0) words += ` and ${below100(paise)} Paise`;
  }
  return `${negative ? 'Minus ' : ''}${words} Only`;
}

// Tally style: "INR One Lakh Twenty Thousand Only",
// "INR Five Thousand Seven Hundred Fourteen and Twenty Eight paise Only".
export function amountInWordsINR(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0;
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  let words: string;
  if (rupees === 0 && paise > 0) words = `${below100(paise)} paise`;
  else {
    words = integerInWords(rupees);
    if (paise > 0) words += ` and ${below100(paise)} paise`;
  }
  return `INR ${negative ? 'Minus ' : ''}${words} Only`;
}
