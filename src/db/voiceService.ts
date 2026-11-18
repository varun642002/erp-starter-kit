import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import { customers, products, warehouseStocks, warehouses } from './schema.ts';
import { productAliases } from './schema.voice.ts';
import {
  WORDS,
  editDistance,
  glossaryLookup,
  hasTamil,
  isKnownEnglish,
  isNumberToken,
  isSkuLike,
  parseNumberToken,
  phoneticKey,
  tamilStem,
  tokenize
} from '../voice/lexicon.ts';

// ---------- command model ----------

export const INTENTS = [
  'add_product',
  'change_quantity',
  'remove_product',
  'search_product',
  'show_cart',
  'get_total',
  'select_customer',
  'apply_discount',
  'clear_draft',
  'request_save',
  'confirm_save',
  'cancel_save',
  'help',
  'unknown'
] as const;
export type Intent = (typeof INTENTS)[number];

export interface VoiceCommand {
  intent: Intent;
  product_query: string | null;
  quantity: number | null;
  unit: string | null;
  discount: { type: 'percent' | 'amount'; value: number } | null;
  customer_query: string | null;
  requires_confirmation: boolean;
}

export type Awaiting = 'save' | 'clear' | null;

export class VoiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const blank = (intent: Intent): VoiceCommand => ({
  intent,
  product_query: null,
  quantity: null,
  unit: null,
  discount: null,
  customer_query: null,
  requires_confirmation: intent === 'request_save' || intent === 'clear_draft'
});

// ---------- rule based interpreter (used when no AI key is configured, and as the fallback) ----------

const inSet = (t: string, list: string[]) => list.some((w) => t === w || (w.length >= 4 && t.startsWith(w)));
const anyIn = (tokens: string[], list: string[]) => tokens.some((t) => inSet(t, list));

const NON_PRODUCT_LISTS = [
  WORDS.add, WORDS.remove, WORDS.change, WORDS.qtyWord, WORDS.total, WORDS.price, WORDS.show, WORDS.save, WORDS.cancel,
  WORDS.yes, WORDS.no, WORDS.help, WORDS.discount, WORDS.percent, WORDS.rupees, WORDS.customer, WORDS.bill, WORDS.more,
  WORDS.units, WORDS.filler, WORDS.clauseSplit,
  ['இந்தப்', 'அந்தப்', 'இந்த', 'அந்த', 'பொருளின்', 'பொருளை', 'பொருள்', 'என்ன', 'எது', 'சொல்லுங்க', 'சொல்லுங்கள்', 'சொல்லு', 'sollu', 'sollunga', 'enna', 'ethu']
];
const isNonProductToken = (t: string) => NON_PRODUCT_LISTS.some((l) => inSet(t, l)) || t === '|';

// Reads the first number in the clause; "இருபது ஐந்து" style tens + units are added together.
function readQuantity(tokens: string[]): { quantity: number | null; used: Set<number> } {
  const used = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const n = parseNumberToken(tokens[i]);
    if (n === null || isSkuLike(tokens[i])) continue;
    used.add(i);
    let value = n;
    const next = i + 1 < tokens.length ? parseNumberToken(tokens[i + 1]) : null;
    if (next !== null && n >= 20 && n < 100 && n % 10 === 0 && next >= 1 && next <= 9) {
      value = n + next;
      used.add(i + 1);
    }
    return { quantity: value, used };
  }
  return { quantity: null, used };
}

function clauseCommand(tokens: string[], inheritedIntent: Intent | null): VoiceCommand {
  const { quantity, used } = readQuantity(tokens);
  const rest = tokens.filter((_, i) => !used.has(i));
  const productTokens = rest.filter((t) => !isNonProductToken(t));
  const productQuery = productTokens.length ? productTokens.join(' ') : null;
  const unit = tokens.find((t) => inSet(t, WORDS.units)) ?? null;

  const cmd = (intent: Intent): VoiceCommand => ({ ...blank(intent), product_query: productQuery, quantity, unit });

  if (anyIn(tokens, WORDS.help)) return blank('help');

  // "<name> அவர்களுக்கு பில் போடுங்க" / "இந்த விற்பனையை <name> பெயரில் போடுங்க"
  const customerPhrase = anyIn(tokens, WORDS.customer) || (anyIn(tokens, WORDS.bill) && productTokens.length > 0 && quantity === null);
  if (customerPhrase && productTokens.length > 0 && !anyIn(tokens, WORDS.save)) {
    return { ...blank('select_customer'), customer_query: productTokens.join(' ') };
  }

  if (anyIn(tokens, WORDS.save)) return blank('request_save');

  if (anyIn(tokens, WORDS.cancel) && !anyIn(tokens, WORDS.change)) return blank('clear_draft');

  if (anyIn(tokens, WORDS.discount)) {
    const isPercent = anyIn(tokens, WORDS.percent);
    return {
      ...blank('apply_discount'),
      quantity,
      discount: quantity !== null ? { type: isPercent ? 'percent' : 'amount', value: quantity } : null
    };
  }

  if (anyIn(tokens, WORDS.price) && !anyIn(tokens, WORDS.total)) return cmd('search_product');
  if (anyIn(tokens, WORDS.price)) return cmd('search_product');

  const wantsShow = anyIn(tokens, WORDS.show) && quantity === null;
  if (wantsShow && !anyIn(tokens, WORDS.total)) return blank('show_cart');
  if (anyIn(tokens, WORDS.total) && quantity === null) return blank('get_total');

  if (anyIn(tokens, WORDS.remove)) return cmd('remove_product');
  if (anyIn(tokens, WORDS.change) || (anyIn(tokens, WORDS.qtyWord) && quantity !== null)) return cmd('change_quantity');
  if (anyIn(tokens, WORDS.add) || anyIn(tokens, WORDS.more) || (quantity !== null && productQuery)) {
    return { ...cmd('add_product'), quantity: quantity ?? 1 };
  }
  if (inheritedIntent && (quantity !== null || productQuery)) {
    return { ...cmd(inheritedIntent), quantity: inheritedIntent === 'add_product' ? quantity ?? 1 : quantity };
  }
  if (productQuery) return cmd('search_product');
  return blank('unknown');
}

export function parseCommandsRules(text: string, awaiting: Awaiting): VoiceCommand[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [blank('unknown')];

  if (awaiting) {
    const short = tokens.filter((t) => t !== '|').length <= 5;
    if (short && anyIn(tokens, WORDS.save) && !anyIn(tokens, WORDS.yes)) return [blank('request_save')];
    if (short && anyIn(tokens, WORDS.no)) return [blank('cancel_save')];
    if (short && anyIn(tokens, WORDS.cancel)) return [blank('cancel_save')];
    if (short && anyIn(tokens, WORDS.yes)) return [blank('confirm_save')];
  } else if (tokens.length <= 3 && anyIn(tokens, WORDS.yes) && !anyIn(tokens, WORDS.save)) {
    return [blank('confirm_save')];
  }

  // clauses split on "மற்றும்", "and", commas...
  const clauses: string[][] = [[]];
  for (const t of tokens) {
    if (inSet(t, WORDS.clauseSplit)) clauses.push([]);
    else clauses[clauses.length - 1].push(t);
  }
  const nonEmpty = clauses.filter((c) => c.length > 0);

  // a clause without a verb ("இரண்டு பம்ப்" in "இரண்டு பம்ப் மற்றும் ஐந்து பேரிங் சேர்க்கவும்") shares the sentence's verb
  const verbIntent: Intent | null = (() => {
    const all = nonEmpty.flat();
    if (anyIn(all, WORDS.remove)) return 'remove_product';
    if (anyIn(all, WORDS.change)) return 'change_quantity';
    if (anyIn(all, WORDS.add) || anyIn(all, WORDS.more)) return 'add_product';
    return null;
  })();

  const commands = nonEmpty.map((c) => clauseCommand(c, verbIntent));
  return commands.length ? commands : [blank('unknown')];
}

// ---------- AI interpreter (optional) ----------

const CLAUDE_MODEL = process.env.VOICE_MODEL || 'claude-haiku-5-5';

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const COMMAND_SCHEMA = {
  type: 'object',
  properties: {
    commands: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          intent: { type: 'string', enum: [...INTENTS] },
          product_query: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          discount_type: { type: ['string', 'null'], enum: ['percent', 'amount', null] },
          discount_value: { type: ['number', 'null'] },
          customer_query: { type: ['string', 'null'] }
        },
        required: ['intent']
      }
    }
  },
  required: ['commands']
};

const SYSTEM_PROMPT = `You turn one spoken sentence from a tractor-spares shop employee (Tamil, Tanglish or English) into counter-sale commands for an ERP Quick Sale screen.
Return every command in the sentence, in order, through the emit_commands tool.
Intents: add_product, change_quantity, remove_product, search_product (asks about a product or its price), show_cart, get_total, select_customer, apply_discount, clear_draft, request_save, confirm_save, cancel_save, help, unknown.
Rules:
- product_query: the product as the shop would name it, WITHOUT the quantity and without verbs. Write Tamil-script product words as the English / Latin word used in inventory names when you are sure (ரோட்டவேட்டர் பிளேடு -> "rotavator blade"); keep item numbers exactly.
- quantity: a whole number. Convert Tamil or Tanglish number words (மூன்று, moonu, பத்தாக, five-a). "இன்னும்" means "more": add_product, the quantity is the extra amount. A quantity is not a price or an item-number digit.
- change_quantity: the quantity is the NEW total for that product. remove_product: quantity only when a number of units is to be taken off, otherwise null.
- apply_discount: discount_type percent or amount and discount_value.
- select_customer: customer_query is only the person's name.
- request_save is for "save / சேமிக்கவும் / bill podunga" when no confirmation is pending. confirm_save / cancel_save only when the user is answering a confirmation question (yes / no).
- Never invent products, prices, totals or stock. If the sentence is not a command, return a single unknown.`;

async function interpretWithClaude(text: string, awaiting: Awaiting, cartNames: string[]): Promise<VoiceCommand[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 700,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [{ name: 'emit_commands', description: 'Report the structured commands.', input_schema: COMMAND_SCHEMA }],
        tool_choice: { type: 'tool', name: 'emit_commands' },
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              sentence: text,
              confirmation_pending: awaiting, // "save", "clear" or null
              products_already_in_sale: cartNames.slice(0, 40)
            })
          }
        ]
      })
    });
    if (!res.ok) {
      console.warn('voice: AI interpretation failed with HTTP', res.status);
      return null;
    }
    const json: any = await res.json();
    const block = (json.content || []).find((b: any) => b.type === 'tool_use');
    const raw: any[] = block?.input?.commands;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out: VoiceCommand[] = [];
    for (const c of raw.slice(0, 12)) {
      const intent: Intent = (INTENTS as readonly string[]).includes(c?.intent) ? c.intent : 'unknown';
      const qty = Number(c?.quantity);
      const dv = Number(c?.discount_value);
      out.push({
        intent,
        product_query: typeof c?.product_query === 'string' && c.product_query.trim() ? c.product_query.trim().slice(0, 120) : null,
        quantity: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : null,
        unit: typeof c?.unit === 'string' ? c.unit.slice(0, 20) : null,
        discount:
          (c?.discount_type === 'percent' || c?.discount_type === 'amount') && Number.isFinite(dv) && dv > 0
            ? { type: c.discount_type, value: dv }
            : null,
        customer_query: typeof c?.customer_query === 'string' && c.customer_query.trim() ? c.customer_query.trim().slice(0, 80) : null,
        requires_confirmation: intent === 'request_save' || intent === 'clear_draft'
      });
    }
    return out.length ? out : null;
  } catch (e: any) {
    console.warn('voice: AI interpretation unavailable:', e?.name === 'AbortError' ? 'timed out' : e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- matching ----------

interface Term {
  lit: string; // literal word (Latin lower case, or Tamil stem)
  en: string | null; // English word from the glossary, when a Tamil word is known
  key: string; // phonetic skeleton
  tamil: boolean;
}

const singular = (w: string) => (w.length > 3 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function toTerm(token: string): Term {
  if (hasTamil(token)) {
    const stem = tamilStem(token.normalize('NFC'));
    return { lit: stem, en: glossaryLookup(token), key: phoneticKey(stem), tamil: true };
  }
  const lit = token.toLowerCase();
  return { lit, en: null, key: phoneticKey(lit), tamil: false };
}

function queryTerms(query: string): Term[] {
  return tokenize(query)
    .filter((t) => t !== '|' && !inSet(t, WORDS.units) && !inSet(t, WORDS.filler))
    .map(toTerm);
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// score 0..1 and whether the evidence is literal (spelling, glossary or alias) rather than phonetic only
function scoreTerm(term: Term, cand: Term[]): { score: number; strong: boolean } {
  let best = 0;
  let strong = false;
  for (const c of cand) {
    let s = 0;
    let st = false;
    if (term.lit === c.lit) {
      s = 1;
      st = true;
    } else if (term.en && (c.lit === term.en || singular(c.lit) === term.en || (term.en.length >= 4 && c.lit.startsWith(term.en)))) {
      s = 1;
      st = true;
    } else if (!term.tamil && !c.tamil) {
      const a = singular(term.lit);
      const b = singular(c.lit);
      if (a === b) {
        s = 0.95;
        st = true;
      } else if (a.length >= 3 && b.length >= 3 && (b.startsWith(a) || (a.length >= 4 && a.startsWith(b) && b.length >= 4))) {
        s = 0.88;
        st = true;
      } else if (a.length >= 5 && editDistance(a, b) <= 1) {
        s = 0.8;
        st = false;
      }
    }
    // two different known words (belt / blade share a consonant skeleton) never match each other
    const cEnglish = c.en ?? (!c.tamil && isKnownEnglish(c.lit) ? singular(c.lit) : null);
    const differentWords = !!(term.en && cEnglish && term.en !== cEnglish && singular(term.en) !== cEnglish);
    if (differentWords) continue;
    if (s < 0.7 && term.key.length >= 2 && term.key === c.key) {
      if (term.tamil && c.tamil) {
        // same script: a spelling variant, not just the same consonants
        const d = editDistance(term.lit, c.lit);
        if (d <= 1) {
          s = 0.95;
          st = true;
        } else if (d <= 2 && term.lit.length >= 6) {
          s = 0.75;
        }
      } else {
        s = 0.7;
      }
    }
    if (s < 0.5 && term.key.length >= 4 && c.key.length >= 4 && editDistance(term.key, c.key) <= 1) s = 0.5;
    if (s > best) {
      best = s;
      strong = st;
    }
  }
  return { score: best, strong };
}

function scoreText(terms: Term[], text: string): { score: number; strong: boolean } {
  if (!terms.length) return { score: 0, strong: false };
  const cand = tokenize(text)
    .filter((t) => t !== '|')
    .map(toTerm);
  if (!cand.length) return { score: 0, strong: false };
  const exactAlias = cand.length === terms.length && terms.every((t, i) => t.lit === cand[i].lit);
  let sum = 0;
  let allStrong = true;
  let missing = 0;
  for (const t of terms) {
    const r = scoreTerm(t, cand);
    sum += r.score;
    if (!r.strong) allStrong = false;
    if (r.score < 0.5) missing++;
  }
  let score = sum / terms.length;
  if (missing > 0) score *= 0.6;
  // a short exact-ish name beats a long one that merely contains the words
  score += Math.min(0.03, 0.03 * (terms.length / cand.length));
  // spoken exactly as a saved name: it wins over names that only contain the same words
  if (exactAlias) score += 0.1;
  return { score, strong: allStrong && missing === 0 };
}

export interface ProductCandidate {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: number;
  stock: number;
  score: number;
  matchedBy: 'item_number' | 'part_number' | 'hsn' | 'name' | 'alias' | 'similar_sound';
}

export interface Resolution {
  status: 'matched' | 'ambiguous' | 'none';
  needsConfirm?: boolean; // a single candidate that only sounds like the request
  candidates: ProductCandidate[];
}

interface CatalogRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: number;
  oem: string | null;
  hsn: string | null;
  models: string | null;
}

async function loadCatalog(): Promise<CatalogRow[]> {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      unit: products.unit,
      sellingPrice: products.sellingPrice,
      oem: products.oemPartNumber,
      hsn: products.hsnCode,
      models: products.compatibleModels
    })
    .from(products)
    .where(and(eq(products.isArchived, false)));
  return rows as CatalogRow[];
}

async function loadAliases(ids?: string[]): Promise<Map<string, string[]>> {
  const rows = ids?.length
    ? await db.select().from(productAliases).where(inArray(productAliases.productId, ids))
    : await db.select().from(productAliases);
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.productId, [...(map.get(r.productId) || []), r.alias]);
  return map;
}

async function stockFor(ids: string[], warehouseId?: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!ids.length || !warehouseId) return map;
  const rows = await db
    .select({ productId: warehouseStocks.productId, available: warehouseStocks.available })
    .from(warehouseStocks)
    .where(and(inArray(warehouseStocks.productId, ids), eq(warehouseStocks.warehouseId, warehouseId)));
  for (const r of rows) map.set(r.productId, Number(r.available) || 0);
  return map;
}

function rankProducts(query: string, rows: CatalogRow[], aliases: Map<string, string[]>) {
  const terms = queryTerms(query);
  const results: { row: CatalogRow; score: number; strong: boolean; matchedBy: ProductCandidate['matchedBy'] }[] = [];
  const asCode = alnum(query);
  const codeLike = tokenize(query).some((t) => isSkuLike(t)) || (asCode.length >= 5 && /\d/.test(asCode) && /[A-Z]/.test(asCode));
  const digitsOnly = /^\d{4,8}$/.test(query.trim());

  for (const row of rows) {
    // item number / part number / HSN
    if (codeLike || digitsOnly) {
      if (alnum(row.sku) === asCode || (codeLike && asCode.length >= 5 && alnum(row.sku).includes(asCode))) {
        results.push({ row, score: 1, strong: true, matchedBy: 'item_number' });
        continue;
      }
      if (row.oem && alnum(row.oem) === asCode) {
        results.push({ row, score: 1, strong: true, matchedBy: 'part_number' });
        continue;
      }
      if (digitsOnly && row.hsn && row.hsn.replace(/\D/g, '') === query.trim()) {
        results.push({ row, score: 0.85, strong: true, matchedBy: 'hsn' });
        continue;
      }
    }
    if (!terms.length) continue;
    const texts: { text: string; by: ProductCandidate['matchedBy'] }[] = [
      { text: `${row.name} ${row.category}`, by: 'name' },
      ...(row.oem ? [{ text: row.oem, by: 'part_number' as const }] : []),
      ...(aliases.get(row.id) || []).map((a) => ({ text: a, by: 'alias' as const }))
    ];
    let best = { score: 0, strong: false, by: 'name' as ProductCandidate['matchedBy'] };
    for (const t of texts) {
      const r = scoreText(terms, t.text);
      if (r.score > best.score) best = { score: r.score, strong: r.strong, by: t.by };
    }
    // compatible models only help to break ties, they never make a match on their own
    if (best.score > 0.5 && row.models) {
      const r = scoreText(terms, row.models);
      if (r.score > 0.9) best.score = Math.min(1, best.score + 0.02);
    }
    if (best.score >= 0.5) {
      const by = best.strong ? best.by : 'similar_sound';
      results.push({ row, score: best.score, strong: best.strong, matchedBy: by });
    }
  }
  results.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return results;
}

function decide<T extends { score: number; strong: boolean }>(ranked: T[]): { status: Resolution['status']; needsConfirm: boolean; picks: T[] } {
  if (!ranked.length || ranked[0].score < 0.6) return { status: 'none', needsConfirm: false, picks: [] };
  const top = ranked[0];
  const second = ranked[1];
  const clearWinner = !second || top.score - second.score >= 0.12;
  if (top.strong && top.score >= 0.88 && clearWinner) return { status: 'matched', needsConfirm: false, picks: [top] };
  const near = ranked.filter((r) => r.score >= Math.max(0.6, top.score - 0.2)).slice(0, 5);
  return { status: 'ambiguous', needsConfirm: near.length === 1, picks: near };
}

export async function resolveProduct(query: string, warehouseId?: string): Promise<Resolution> {
  const rows = await loadCatalog();
  const aliases = await loadAliases();
  const ranked = rankProducts(query, rows, aliases);
  const d = decide(ranked);
  if (d.status === 'none') return { status: 'none', candidates: [] };
  const stock = await stockFor(d.picks.map((p) => p.row.id), warehouseId);
  return {
    status: d.status,
    needsConfirm: d.needsConfirm || undefined,
    candidates: d.picks.map((p) => ({
      id: p.row.id,
      sku: p.row.sku,
      name: p.row.name,
      category: p.row.category,
      unit: p.row.unit,
      sellingPrice: Number(p.row.sellingPrice) || 0,
      stock: stock.get(p.row.id) ?? 0,
      score: Math.round(Math.min(1, p.score) * 100) / 100,
      matchedBy: p.matchedBy
    }))
  };
}

// Matches a spoken name against the items already in the sale (change / remove).
export interface CartRef {
  productId: string;
  name: string;
  sku?: string;
}

export async function resolveInCart(query: string | null, cart: CartRef[]): Promise<{ status: Resolution['status']; productIds: string[] }> {
  if (!cart.length) return { status: 'none', productIds: [] };
  if (!query) {
    return cart.length === 1 ? { status: 'matched', productIds: [cart[0].productId] } : { status: 'ambiguous', productIds: cart.map((c) => c.productId) };
  }
  const aliases = await loadAliases(cart.map((c) => c.productId));
  const rows: CatalogRow[] = cart.map((c) => ({
    id: c.productId,
    sku: c.sku || '',
    name: c.name,
    category: '',
    unit: '',
    sellingPrice: 0,
    oem: null,
    hsn: null,
    models: null
  }));
  const ranked = rankProducts(query, rows, aliases);
  // inside the sale a clear sound-alike is enough: there are only a few items to choose from
  const top = ranked[0];
  if (!top || top.score < 0.6) return { status: 'none', productIds: [] };
  const second = ranked[1];
  // an item that only sounds like the request is confirmed with the user before it is changed or removed
  if (!top.strong) return { status: 'ambiguous', productIds: [top.row.id] };
  if (!second || top.score - second.score >= 0.12) return { status: 'matched', productIds: [top.row.id] };
  return { status: 'ambiguous', productIds: ranked.filter((r) => r.score >= top.score - 0.12).slice(0, 5).map((r) => r.row.id) };
}

// ---------- customers ----------

export interface CustomerCandidate {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  city: string;
  branchId: string | null;
  score: number;
  exact: boolean;
  record: Record<string, unknown>;
}

const HONORIFICS = ['அவர்கள்', 'அவர்களுக்கு', 'அவர்கள', 'அண்ணன்', 'அண்ணா', 'ஐயா', 'அம்மா', 'sir', 'mr', 'mrs', 'ayya', 'anna', 'annan', 'thiru', 'திரு', 'திருமதி'];

export async function resolveCustomer(query: string, branchId: string | null): Promise<{ status: Resolution['status']; candidates: CustomerCandidate[] }> {
  const terms = tokenize(query)
    .filter((t) => t !== '|' && !HONORIFICS.includes(t) && !inSet(t, WORDS.filler))
    .map(toTerm);
  if (!terms.length) return { status: 'none', candidates: [] };
  // Central directory: a customer registered at any branch can be named from any branch.
  const rows = await db.select().from(customers).orderBy(asc(customers.companyName));

  const scored = rows
    .map((r) => {
      const a = scoreText(terms, `${r.name || ''} ${r.companyName || ''}`);
      return { r, ...a };
    })
    .filter((x) => x.score >= 0.6)
    .sort((x, y) => y.score - x.score || String(x.r.name).localeCompare(String(y.r.name)));
  if (!scored.length) return { status: 'none', candidates: [] };

  const top = scored[0];
  const near = scored.filter((x) => x.score >= top.score - 0.15).slice(0, 5);
  const candidates: CustomerCandidate[] = near.map((x) => ({
    id: x.r.id,
    name: x.r.name || x.r.companyName,
    companyName: x.r.companyName,
    phone: x.r.phone,
    city: x.r.city || '',
    branchId: x.r.branchId,
    score: Math.round(x.score * 100) / 100,
    exact: x.strong,
    record: x.r as unknown as Record<string, unknown>
  }));
  // A customer is only picked automatically when the name was spelled / typed the same way and nobody else fits.
  const sure = near.length === 1 && top.strong && top.score >= 0.9;
  return { status: sure ? 'matched' : 'ambiguous', candidates };
}

// ---------- orchestration ----------

export interface ResolvedCommand extends VoiceCommand {
  product?: Resolution;
  cartMatch?: { status: Resolution['status']; productIds: string[] };
  customer?: { status: Resolution['status']; candidates: CustomerCandidate[] };
}

export interface InterpretInput {
  text: string;
  awaiting: Awaiting;
  cart: CartRef[];
  warehouseId?: string;
  customerBranchId: string | null; // null = all branches (owner)
}

export async function interpret(input: InterpretInput): Promise<{ interpreter: 'ai' | 'rules'; commands: ResolvedCommand[] }> {
  const text = input.text.trim().slice(0, 400);
  if (!text) throw new VoiceError('No speech text was received');

  let interpreter: 'ai' | 'rules' = 'rules';
  let commands: VoiceCommand[] | null = await interpretWithClaude(text, input.awaiting, input.cart.map((c) => c.name));
  if (commands) interpreter = 'ai';
  else commands = parseCommandsRules(text, input.awaiting);

  const resolved: ResolvedCommand[] = [];
  for (const c of commands.slice(0, 12)) {
    const r: ResolvedCommand = { ...c };
    if (c.intent === 'add_product' || c.intent === 'search_product') {
      if (c.product_query) r.product = await resolveProduct(c.product_query, input.warehouseId);
    } else if (c.intent === 'change_quantity' || c.intent === 'remove_product') {
      r.cartMatch = await resolveInCart(c.product_query, input.cart);
    } else if (c.intent === 'select_customer' && c.customer_query) {
      r.customer = await resolveCustomer(c.customer_query, input.customerBranchId);
    }
    resolved.push(r);
  }
  return { interpreter, commands: resolved };
}

// ---------- aliases (configurable names for products) ----------

const cleanAlias = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export async function listAliases(productId: string): Promise<string[]> {
  const rows = await db.select().from(productAliases).where(eq(productAliases.productId, productId)).orderBy(asc(productAliases.id));
  return rows.map((r) => r.alias);
}

export async function replaceAliases(productId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) throw new VoiceError('aliases must be a list of names');
  if (raw.length > 30) throw new VoiceError('At most 30 voice names per product');
  const seen = new Set<string>();
  const list: { alias: string; key: string }[] = [];
  for (const a of raw) {
    if (typeof a !== 'string') throw new VoiceError('Each voice name must be text');
    const alias = cleanAlias(a);
    if (!alias) continue;
    if (alias.length > 80) throw new VoiceError('A voice name can have at most 80 characters');
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ alias, key });
  }
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!p) throw new VoiceError('Product not found', 404);
  await db.transaction(async (tx) => {
    await tx.delete(productAliases).where(eq(productAliases.productId, productId));
    if (list.length) {
      await tx.insert(productAliases).values(list.map((l) => ({ productId, alias: l.alias, aliasKey: l.key })));
    }
  });
  return list.map((l) => l.alias);
}

// A warehouse may only be used for stock lookups by users of its branch (owners: any).
export async function assertWarehouseAccess(warehouseId: string | undefined, isOwner: boolean, branchId: string): Promise<void> {
  if (!warehouseId || isOwner) return;
  const [w] = await db.select({ branchId: warehouses.branchId }).from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!w || w.branchId !== branchId) throw new VoiceError('This warehouse is not in your branch', 403);
}

export { isNumberToken };
