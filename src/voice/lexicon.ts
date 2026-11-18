// Tamil / Tanglish language helpers for the Quick Sale voice assistant.
// Pure functions only: used by the server (command parsing, product matching) and by the browser.
// This file holds vocabulary and spelling rules, never product data: products always come from the database.

// ---------- text normalisation ----------

const TAMIL_DIGIT_BASE = 0x0be6;

export function normalizeSpoken(input: string): string {
  let s = String(input ?? '').normalize('NFC');
  s = s.replace(/[௦-௯]/g, (d) => String(d.charCodeAt(0) - TAMIL_DIGIT_BASE));
  s = s.replace(/[‌‍]/g, '');
  s = s.replace(/[,;।|]/g, ' | ');
  s = s.replace(/%/g, ' percent ');
  s = s.replace(/[.?!:()"“”‘’]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// An item number such as PT-00125 or SPR-BLD-102 stays one token; "five-a" is split into two words.
const SKU_LIKE = /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]{1,10}(?:-[A-Za-z0-9]+)+$/;
export const isSkuLike = (token: string) => SKU_LIKE.test(token);

export function tokenize(input: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeSpoken(input).split(' ')) {
    if (!raw) continue;
    if (raw === '|') {
      out.push('|');
      continue;
    }
    if (isSkuLike(raw)) {
      out.push(raw.toUpperCase());
      continue;
    }
    for (const part of raw.split(/[-/_]+/)) if (part) out.push(part.toLowerCase());
  }
  return out;
}

export const hasTamil = (s: string) => /[஀-௿]/.test(s);

// ---------- number words ----------

const NUM_WORDS: Record<string, number> = {};
const put = (n: number, words: string[]) => words.forEach((w) => (NUM_WORDS[w] = n));

// Tamil script
put(0, ['பூஜ்யம்', 'பூஜ்ஜியம்', 'சுழியம்'])
put(1, ['ஒன்று', 'ஒன்னு', 'ஒண்ணு', 'ஒரு', 'ஒன்றை', 'ஒன்றாக'])
put(2, ['இரண்டு', 'ரெண்டு', 'ரண்டு', 'இரெண்டு', 'இரு', 'இரண்டாக', 'ரெண்டா'])
put(3, ['மூன்று', 'மூணு', 'மூனு', 'மூன்றாக', 'மூணா'])
put(4, ['நான்கு', 'நாலு', 'நாங்கு', 'நான்காக', 'நாலா'])
put(5, ['ஐந்து', 'அஞ்சு', 'அய்ந்து', 'ஐந்தாக', 'அஞ்சா'])
put(6, ['ஆறு', 'ஆறாக', 'ஆறா'])
put(7, ['ஏழு', 'ஏழாக', 'எழு'])
put(8, ['எட்டு', 'எட்டாக'])
put(9, ['ஒன்பது', 'ஒம்பது', 'ஒன்பதாக'])
put(10, ['பத்து', 'பத்தாக', 'பதது'])
put(11, ['பதினொன்று', 'பதினொன்னு', 'பதினொண்ணு'])
put(12, ['பன்னிரண்டு', 'பன்னிரெண்டு', 'பனிரண்டு', 'பன்னெண்டு'])
put(13, ['பதின்மூன்று', 'பதிமூன்று', 'பதிமூணு'])
put(14, ['பதினான்கு', 'பதினாலு'])
put(15, ['பதினைந்து', 'பதினஞ்சு'])
put(16, ['பதினாறு'])
put(17, ['பதினேழு'])
put(18, ['பதினெட்டு'])
put(19, ['பத்தொன்பது', 'பத்தொம்பது'])
put(20, ['இருபது', 'இருபத்து', 'இருபத்தி'])
put(30, ['முப்பது', 'முப்பத்து', 'முப்பத்தி'])
put(40, ['நாற்பது', 'நாப்பது', 'நாற்பத்து', 'நாற்பத்தி'])
put(50, ['ஐம்பது', 'அம்பது', 'ஐம்பத்து', 'ஐம்பத்தி'])
put(60, ['அறுபது', 'அறுபத்து', 'அறுபத்தி'])
put(70, ['எழுபது', 'எழுபத்து', 'எழுபத்தி'])
put(80, ['எண்பது', 'எண்பத்து', 'எண்பத்தி'])
put(90, ['தொண்ணூறு', 'தொண்ணூற்று', 'தொண்ணூற்றி'])
put(100, ['நூறு', 'நூற்று'])

// Compound numbers: இருபத்தைந்து (25), முப்பத்தொன்று (31) ...
{
  const bases: [number, string, string][] = [
    [20, 'இருபத்', 'த'],
    [30, 'முப்பத்', 'த'],
    [40, 'நாற்பத்', 'த'],
    [50, 'ஐம்பத்', 'த'],
    [60, 'அறுபத்', 'த'],
    [70, 'எழுபத்', 'த'],
    [80, 'எண்பத்', 'த'],
    [90, 'தொண்ணூற்', 'ற']
  ];
  const units: [number, string][] = [
    [1, 'ஒன்று'],
    [2, 'இரண்டு'],
    [3, 'மூன்று'],
    [4, 'நான்கு'],
    [5, 'ஐந்து'],
    [6, 'ஆறு'],
    [7, 'ஏழு'],
    [8, 'எட்டு'],
    [9, 'ஒன்பது']
  ];
  const sign: Record<string, string> = { ஒ: 'ொ', இ: 'ி', ஐ: 'ை', ஆ: 'ா', ஏ: 'ே', எ: 'ெ' };
  for (const [tens, base, join] of bases) {
    for (const [n, word] of units) {
      const first = word[0];
      if (sign[first]) {
        NUM_WORDS[base + join + sign[first] + word.slice(1)] = tens + n;
      } else {
        NUM_WORDS[base + join + 'ு' + word] = tens + n;
        NUM_WORDS[base + join + 'ி' + word] = tens + n;
      }
    }
  }
}

// Tanglish and English
put(0, ['zero', 'poojyam'])
put(1, ['one', 'ondru', 'onru', 'onnu', 'oru', 'ondru', 'onne'])
put(2, ['two', 'irandu', 'rendu', 'randu', 'iru', 'rendaa'])
put(3, ['three', 'moondru', 'moonu', 'munu', 'moonru', 'moondu'])
put(4, ['four', 'naangu', 'naalu', 'nalu', 'nangu', 'naanku'])
put(5, ['five', 'ainthu', 'anju', 'anchu', 'aindhu', 'ainthu'])
put(6, ['six', 'aaru', 'aru', 'aaru'])
put(7, ['seven', 'ezhu', 'yezhu', 'elu', 'ezhu'])
put(8, ['eight', 'ettu', 'ett'])
put(9, ['nine', 'onbathu', 'ombathu', 'onbadhu'])
put(10, ['ten', 'pathu', 'patthu', 'pattu', 'badhu', 'pathaaga', 'pathaga'])
put(11, ['eleven', 'pathinonnu', 'pathinondru'])
put(12, ['twelve', 'panirendu', 'pannirendu', 'pannendu'])
put(13, ['thirteen', 'pathimoonu'])
put(14, ['fourteen', 'pathinaalu'])
put(15, ['fifteen', 'pathinanju', 'pathinainthu'])
put(16, ['sixteen', 'pathinaaru'])
put(17, ['seventeen', 'pathinezhu'])
put(18, ['eighteen', 'pathinettu'])
put(19, ['nineteen', 'pathonbathu'])
put(20, ['twenty', 'irubathu', 'irupathu', 'iruvathu'])
put(30, ['thirty', 'muppathu', 'muppadhu'])
put(40, ['forty', 'naarpathu', 'nalupathu', 'naapathu'])
put(50, ['fifty', 'aimbathu', 'ambathu'])
put(60, ['sixty', 'arubathu'])
put(70, ['seventy', 'ezhubathu'])
put(80, ['eighty', 'enbathu'])
put(90, ['ninety', 'thonnooru', 'thonnuru'])
put(100, ['hundred', 'nooru', 'noru'])

export function parseNumberToken(token: string): number | null {
  if (!token) return null;
  if (/^\d{1,5}$/.test(token)) return Number(token);
  if (token in NUM_WORDS) return NUM_WORDS[token];
  // "five-a", "pathu-a": a trailing -a / -aa is Tanglish for "...ஆக"
  const t = token.replace(/(aa|a)$/, '');
  if (t && t !== token && t in NUM_WORDS) return NUM_WORDS[t];
  return null;
}

export const isNumberToken = (t: string) => parseNumberToken(t) !== null;

// ---------- Tamil case endings and phonetic keys ----------

const TAMIL_SUFFIXES = [
  'ிலிருந்து', 'ுக்கான', 'களுக்கு', 'களை', 'கள்', 'ையும்', 'ையே', 'யை', 'ுடன்', 'ோடு', 'ுக்கு', 'க்கு', 'ில்', 'இல்', 'ினை', 'ை', 'ஐ'
];

// Spoken word without plural and case endings: பெல்ட்டை -> பெல்ட், பிளேடுகள் -> பிளேடு
export function tamilStem(word: string): string {
  let w = word;
  for (const suf of TAMIL_SUFFIXES) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  // doubled consonant before a case ending: பெல்ட்ட -> பெல்ட்
  const m = /^(.*)(.)்\2$/.exec(w);
  if (m) w = `${m[1]}${m[2]}்`;
  return w.replace(/[ு்]$/, '');
}

const TAMIL_CONS: Record<string, string> = {
  க: 'k', ங: 'n', ச: 's', ஞ: 'n', ட: 't', ண: 'n', த: 't', ந: 'n', ன: 'n', ப: 'p', ம: 'm', ய: '', ர: 'r',
  ல: 'l', வ: 'v', ழ: 'l', ள: 'l', ற: 'r', ஜ: 's', ஷ: 's', ஸ: 's', ஹ: '', ஃ: ''
};

function collapse(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

// Consonant skeleton used to compare Tamil spellings with English product names (ரோட்டவேட்டர் ~ rotavator).
export function phoneticKey(word: string): string {
  if (!word) return '';
  if (hasTamil(word)) {
    let out = '';
    for (const ch of word) out += TAMIL_CONS[ch] ?? '';
    return collapse(out);
  }
  let s = word.toLowerCase().replace(/[^a-z]/g, '');
  s = s
    .replace(/ph/g, 'p')
    .replace(/th|dh/g, 't')
    .replace(/sh|ch/g, 's')
    .replace(/ck|kh|gh/g, 'k')
    .replace(/wh/g, 'v')
    .replace(/qu/g, 'kv')
    .replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k');
  const map: Record<string, string> = { b: 'p', d: 't', g: 'k', j: 's', z: 's', f: 'p', w: 'v', q: 'k' };
  let out = '';
  for (const ch of s) {
    if ('aeiouyh'.includes(ch)) continue;
    out += map[ch] ?? ch;
  }
  return collapse(out);
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

// ---------- vocabulary (language only; never product data) ----------

// Tamil-script words commonly used for tractor / implement parts, with the English word used in item names.
const GLOSSARY_SRC: Record<string, string[]> = {
  rotavator: ['ரோட்டவேட்டர்', 'ரோட்டாவேட்டர்', 'ரொட்டவேட்டர்', 'ரோட்டோவேட்டர்', 'ரோடவேட்டர்', 'ரோட்டவேட்டார்'],
  rotary: ['ரோட்டரி', 'ரோட்டறி'],
  tiller: ['டில்லர்', 'டிலர்'],
  blade: ['பிளேடு', 'பிளேட்', 'பிளேடுகள்', 'பிளேடை', 'பிளேட்டு', 'ப்ளேடு', 'ப்ளேட்'],
  hydraulic: ['ஹைட்ராலிக்', 'ஹைட்ரோலிக்', 'ஹைடிராலிக்', 'ஹைட்ராலிக்கு', 'ஐட்ராலிக்'],
  pump: ['பம்ப்', 'பம்பு', 'பம்'],
  bearing: ['பேரிங்', 'பியரிங்', 'பெயரிங்', 'பேரிங்கு', 'பெரிங்'],
  belt: ['பெல்ட்', 'பெல்டு', 'பெல்ட்டு', 'வார்'],
  bolt: ['போல்ட்', 'போல்டு', 'போல்ட்டு'],
  nut: ['நட்டு', 'நட்', 'நட்டுகள்'],
  washer: ['வாஷர்', 'வாசர்'],
  gear: ['கியர்', 'கியரு'],
  gearbox: ['கியர்பாக்ஸ்', 'கியர்பாக்சு', 'கியர்பெட்டி'],
  oil: ['ஆயில்', 'எண்ணெய்', 'ஆயிலு'],
  seal: ['சீல்', 'சீலு'],
  filter: ['பில்டர்', 'ஃபில்டர்', 'ஃபில்ட்டர்', 'பில்ட்டர்', 'வடிகட்டி'],
  spring: ['ஸ்பிரிங்', 'ஸ்ப்ரிங்', 'ஸ்பிரிங்கு'],
  pin: ['பின்', 'பின்னு'],
  bush: ['புஷ்', 'புஸ்', 'புஷ்ஷ்'],
  shaft: ['ஷாஃப்ட்', 'ஷாப்ட்', 'சாப்ட்', 'ஷாப்ட்டு'],
  piston: ['பிஸ்டன்', 'பிஸ்டனு'],
  cylinder: ['சிலிண்டர்', 'சிலிண்டரு'],
  valve: ['வால்வு', 'வால்வ்', 'வால்வ'],
  clutch: ['கிளட்ச்', 'கிளட்சு', 'கிளச்'],
  brake: ['பிரேக்', 'பிரேக்கு', 'ப்ரேக்'],
  tyre: ['டயர்', 'டயரு', 'டையர்'],
  tube: ['டியூப்', 'டியூபு'],
  tractor: ['டிராக்டர்', 'ட்ராக்டர்', 'டிராக்டரு', 'ட்ராக்டரு'],
  baler: ['பேலர்', 'பேலரு'],
  cultivator: ['கல்டிவேட்டர்', 'கல்டிவேட்டரு', 'கலப்பை'],
  plough: ['கலப்பை', 'பிளவ்', 'ப்ளவ்'],
  nozzle: ['நோசில்', 'நாசில்', 'நொசில்'],
  sprayer: ['ஸ்ப்ரேயர்', 'ஸ்பிரேயர்', 'ஸ்ப்ரேயரு'],
  chain: ['செயின்', 'சங்கிலி', 'செயினு'],
  sprocket: ['ஸ்ப்ராக்கெட்', 'ஸ்ப்ரோக்கெட்'],
  coupling: ['கப்ளிங்', 'கப்லிங்', 'கப்ளிங்கு'],
  hose: ['ஹோஸ்', 'ஓஸ்', 'ஹோசு'],
  pipe: ['பைப்', 'பைப்பு', 'குழாய்'],
  light: ['லைட்', 'விளக்கு', 'லைட்டு'],
  battery: ['பேட்டரி', 'பேட்டறி'],
  motor: ['மோட்டார்', 'மோட்டரு'],
  engine: ['இன்ஜின்', 'எஞ்சின்', 'இஞ்சின்', 'என்ஜின்'],
  plug: ['பிளக்', 'ப்ளக்', 'ப்ளக்கு'],
  cable: ['கேபிள்', 'கேபிளு'],
  wire: ['வயர்', 'வயரு'],
  handle: ['ஹேண்டில்', 'ஹாண்டில்', 'கைப்பிடி'],
  seat: ['சீட்', 'சீட்டு'],
  mudguard: ['மட்கார்டு', 'மட்கார்ட்'],
  rim: ['ரிம்', 'ரிம்மு'],
  axle: ['ஆக்ஸில்', 'ஆக்சில்', 'அச்சு'],
  hub: ['ஹப்', 'ஹப்பு'],
  link: ['லிங்க்', 'லிங்கு'],
  rod: ['ராடு', 'ராட்', 'கம்பி'],
  steering: ['ஸ்டீரிங்', 'ஸ்டியரிங்', 'ஸ்டீயரிங்'],
  coil: ['காயில்', 'காயிலு'],
  clamp: ['கிளாம்ப்', 'கிளாம்பு'],
  tooth: ['பல்'],
  tine: ['டைன்', 'டைனு'],
  fastener: ['பாஸ்டனர்', 'பாஸ்டனரு'],
  spare: ['ஸ்பேர்', 'ஸ்பேரு'],
  part: ['பார்ட்', 'பார்ட்டு', 'பார்ட்ஸ்'],
  weeder: ['வீடர்', 'வீடரு'],
  thresher: ['த்ரெஷர்', 'திரெஷர்'],
  harvester: ['ஹார்வெஸ்டர்', 'அறுவடை']
};

const GLOSSARY = new Map<string, string>();
for (const [en, words] of Object.entries(GLOSSARY_SRC)) {
  for (const w of words) GLOSSARY.set(tamilStem(w.normalize('NFC')), en);
}

const ENGLISH_WORDS = new Set(Object.keys(GLOSSARY_SRC));
// An English word the glossary knows (blade, belt, pump ...): two different known words are never the same item.
export const isKnownEnglish = (w: string) => ENGLISH_WORDS.has(w) || ENGLISH_WORDS.has(w.replace(/(es|s)$/, ''));

export function glossaryLookup(tamilWord: string): string | null {
  return GLOSSARY.get(tamilStem(tamilWord)) ?? null;
}

// ---------- intent vocabulary ----------

const has = (tokens: string[], words: string[]) => tokens.some((t) => words.some((w) => t === w || (w.length >= 4 && t.startsWith(w))));

export const WORDS = {
  add: ['சேர்', 'சேர்க்க', 'சேர்த்து', 'போடு', 'போடுங்க', 'போடுங்கள்', 'போடவும்', 'வேண்டும்', 'வேணும்', 'வேணுமா', 'கொடு', 'கொடுங்க', 'add', 'podu', 'podunga', 'pannunga', 'panunga', 'venum', 'vendum', 'venumm', 'kodunga', 'need', 'want', 'வை', 'வையுங்க'],
  remove: ['நீக்கு', 'நீக்க', 'நீக்கவும்', 'நீக்குங்க', 'அகற்று', 'அகற்ற', 'எடுத்துடு', 'எடுத்து', 'எடு', 'remove', 'delete', 'neekku', 'neeku', 'neekkunga', 'eduthudu', 'kazhatti'],
  change: ['மாற்று', 'மாற்ற', 'மாற்றவும்', 'மாத்து', 'மாத்துங்க', 'மாற்றுங்க', 'maatru', 'matru', 'maathu', 'maatrunga', 'change', 'update', 'ஆக்கு', 'ஆக்குங்க', 'aakku', 'aakkunga', 'set'],
  qtyWord: ['எண்ணிக்கை', 'எண்ணிக்கையை', 'quantity', 'qty', 'count'],
  total: ['மொத்தம்', 'மொத்த', 'மொத்தத்', 'மொத்தத்தொகை', 'total', 'evlo', 'evalo', 'evvalavu', 'எவ்வளவு', 'எவ்ளோ', 'எவ்ளவு', 'தொகை', 'thogai', 'amount'],
  price: ['விலை', 'vilai', 'price', 'rate'],
  show: ['என்னென்ன', 'என்ன', 'பொருட்கள்', 'பட்டியல்', 'list', 'show', 'காட்டு', 'காட்டுங்க', 'kaattu', 'cart', 'ennenna', 'items', 'பொருள்'],
  save: ['சேமி', 'சேமிக்க', 'சேமிக்கவும்', 'சேமிங்க', 'சேமிக்கலாம்', 'save', 'saving', 'seymi', 'semi', 'முடி', 'முடிக்க', 'முடிங்க', 'finish', 'complete'],
  cancel: ['ரத்து', 'ரத்துசெய்', 'cancel', 'clear', 'அழி', 'ratthu', 'rathu', 'reset', 'நிறுத்து'],
  yes: ['ஆம்', 'ஆமா', 'ஆமாம்', 'சரி', 'உறுதி', 'ஓகே', 'ஒகே', 'ok', 'okay', 'yes', 'confirm', 'aama', 'aamam', 'aam', 'seri', 'sari', 'ஆமாங்க', 'சரிங்க'],
  no: ['வேண்டாம்', 'இல்லை', 'இல்ல', 'illai', 'illa', 'vendam', 'vendaam', 'no', 'cancel', 'stop', 'நிறுத்து', 'வேணாம்'],
  help: ['உதவி', 'help', 'udhavi', 'helpu'],
  discount: ['தள்ளுபடி', 'discount', 'kurai', 'thallupadi', 'kuraichu'],
  percent: ['சதவீதம்', 'சதவீத', 'சதம்', 'percent', 'percentage', 'per', 'சதவிகிதம்'],
  rupees: ['ரூபாய்', 'ரூபாய்க்கு', 'ரூ', 'rs', 'rupees', 'rupee', 'rupaai', 'inr'],
  customer: ['பெயரில்', 'அவர்களுக்கு', 'அவருக்கு', 'அவங்களுக்கு', 'வாடிக்கையாளர்', 'customer', 'peyaril', 'pareil'],
  bill: ['பில்', 'bill', 'பில்லு'],
  more: ['இன்னும்', 'மேலும்', 'innum', 'more', 'extra', 'another', 'inoru'],
  units: ['பீஸ்', 'piece', 'pieces', 'pcs', 'pc', 'nos', 'எண்', 'எண்ணம்', 'செட்', 'set', 'லிட்டர்', 'litre', 'liter', 'kg', 'கிலோ', 'meter', 'மீட்டர்', 'நம்பர்'],
  clauseSplit: ['மற்றும்', 'அப்புறம்', 'பிறகு', 'அதோடு', 'and', 'then', 'plus', 'appuram', 'pirague', 'mattrum', 'matrum', 'அப்புறமா', '|'],
  filler: ['இந்த', 'அந்த', 'ஒரு', 'விற்பனையை', 'விற்பனை', 'விற்பனைக்கு', 'sale', 'please', 'plz', 'தயவுசெய்து', 'பண்ணுங்க', 'பண்ணு', 'செய்யவும்', 'செய்யுங்க', 'செய்', 'pannu', 'panni', 'pannunga', 'sir', 'ஐயா', 'அண்ணா', 'என்று', 'னு', 'எனக்கு', 'நமக்கு', 'இதில்', 'இதுல', 'a', 'ah', 'ஆ', 'ஆக', 'ஆகா', 'ku', 'kku', 'la', 'ல', 'ஐ', 'தான்', 'ஒன்', 'உம்']
};

export { has as tokensHave };
