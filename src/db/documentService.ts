import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { branches, warehouses, warehouseStocks } from './schema.ts';
import { cashEntries } from './schema.cashBook.ts';
import { companyProfiles } from './schema.companies.ts';
import { documentItems, documentPayments, documents } from './schema.documents.ts';
import { machineSalePayments, machineSales } from './schema.machineSales.ts';
import { products as productsTable } from './schema.ts';
import { COMPANY_IDS, ensureCompanyDefaults } from './companyService.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { StockError, applyStockDelta } from './stockService.ts';
// Pure, dependency-free helpers shared with the builder so the server and the live preview always agree.
import {
  DEFAULT_TERMS,
  INDIAN_STATES,
  SELLER_STATE,
  SELLER_STATE_CODE,
  calcDocument,
  round2,
  stateCodeFromName,
  stateNameFromCode
} from '../components/documents/calc.ts';

// Document number: {company prefix}/{4-digit sequence}/{yy-yy financial year}, e.g. MAIN/0014/26-27.
// Prefixes live in company_profiles; each company/kind pair keeps its own counter.

export class DocumentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DOC_TYPES = ['invoice', 'quotation'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const INVOICE_KINDS = ['tax', 'plain'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
type NumberKind = 'quotation' | 'invoice' | 'plain';
export const INVOICE_STATUSES = ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Cancelled'] as const;
export const QUOTATION_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Converted', 'Cancelled'] as const;
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'] as const;
export const GST_RATES = [0, 5, 12, 18, 28];
// Invoices and quotations are for the Super Admin, the owner and the branch manager only.
export const WRITE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager'];

const DEFAULT_CREDIT_DAYS = 15;

type DocRow = typeof documents.$inferSelect;
type ItemRow = typeof documentItems.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EPS = 0.005;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const GSTIN_RE = /^\d{2}[0-9A-Z]{13}$/;
const IRN_RE = /^[0-9a-f]{64}$/;
const EWB_RE = /^\d{12}$/;

const uid = (prefix: string) => `${prefix}-${randomUUID()}`;

function optText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function optDate(value: unknown, field: string): string | null {
  const s = optText(value);
  if (s && (!DATE_RE.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()))) {
    throw new DocumentError(`${field} must be YYYY-MM-DD`);
  }
  return s;
}

// Indian financial year (April-March) of an IST date, e.g. 2025-07-01 -> "2025-26".
export function financialYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function detectInterState(gstin: string | null | undefined, placeOfSupply: string | null | undefined): boolean {
  const g = (gstin || '').trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2) !== SELLER_STATE_CODE;
  return (placeOfSupply || SELLER_STATE).trim().toLowerCase() !== SELLER_STATE.toLowerCase();
}

export interface ParsedLine {
  productId: string | null;
  description: string;
  batchNote: string | null;
  sku: string | null;
  hsnCode: string | null;
  unit: string | null;
  quantity: number;
  rate: number;
  discountPercent: number;
  gstRate: number;
}

// Optional header fields stored as text, with their maximum lengths.
const EXTRA_TEXT = {
  buyerStateName: 60,
  buyerStateCode: 2,
  consigneeName: 200,
  consigneeAddress: 500,
  consigneeGstin: 15,
  consigneeStateName: 60,
  consigneeStateCode: 2,
  irn: 64,
  ackNo: 30,
  einvoiceQr: 6000,
  ewayBillNo: 12,
  deliveryNote: 100,
  referenceNo: 100,
  buyerOrderNo: 100,
  dispatchDocNo: 100,
  dispatchedThrough: 100,
  destination: 100,
  ladingNo: 100,
  vehicleNo: 20,
  termsOfDelivery: 300,
  paymentTerms: 200,
  otherReferences: 200,
  ewbMode: 40,
  ewbSupplyType: 40,
  ewbTransactionType: 40,
  transporterId: 30,
  transporterName: 150,
  transporterDocNo: 50,
  ewbFromPlace: 100
} as const;
const EXTRA_DATES = ['ackDate', 'deliveryNoteDate', 'referenceDate', 'buyerOrderDate', 'ladingDate', 'transporterDocDate'] as const;
const EXTRA_DATETIMES = ['ewbGeneratedAt', 'ewbValidUpto'] as const;

type ExtraKey = keyof typeof EXTRA_TEXT | (typeof EXTRA_DATES)[number] | (typeof EXTRA_DATETIMES)[number];
type Extras = Record<ExtraKey, string | null>;
const EXTRA_KEYS = [...(Object.keys(EXTRA_TEXT) as ExtraKey[]), ...EXTRA_DATES, ...EXTRA_DATETIMES];

// e-Invoice and e-Way Bill values belong to one invoice only, so copies start without them.
const PORTAL_KEYS: ExtraKey[] = ['irn', 'ackNo', 'ackDate', 'einvoiceQr', 'ewayBillNo', 'ewbGeneratedAt', 'ewbValidUpto'];

interface ParsedDoc {
  companyId: string;
  invoiceKind: InvoiceKind;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerGstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  placeOfSupply: string;
  docDate: string;
  dueDate: string | null;
  validUntil: string | null;
  otherCharges: number;
  pricesIncludeTax: boolean;
  ewbDistanceKm: number | null;
  extras: Extras;
  notes: string | null;
  terms: string | null;
  lines: ParsedLine[];
}

function canonicalState(value: string | null, field: string): string | null {
  if (!value) return null;
  const found = INDIAN_STATES.find((s) => s.name.toLowerCase() === value.toLowerCase());
  if (!found) throw new DocumentError(`${field} is not a recognised Indian state`);
  return found.name;
}

function parseExtras(input: Record<string, any>, customerGstin: string | null, placeOfSupplyIn: string | null): { extras: Extras; placeOfSupply: string } {
  const extras = {} as Extras;
  for (const key of Object.keys(EXTRA_TEXT) as (keyof typeof EXTRA_TEXT)[]) {
    const v = optText(input[key]);
    if (v && v.length > EXTRA_TEXT[key]) throw new DocumentError(`${key} is too long (maximum ${EXTRA_TEXT[key]} characters)`);
    extras[key] = v;
  }
  for (const key of EXTRA_DATES) extras[key] = optDate(input[key], key);
  for (const key of EXTRA_DATETIMES) {
    const v = optText(input[key]);
    if (v && (!DATETIME_RE.test(v) || Number.isNaN(new Date(`${v}:00Z`).getTime()))) {
      throw new DocumentError(`${key} must be YYYY-MM-DDTHH:mm`);
    }
    extras[key] = v;
  }

  if (extras.irn) {
    extras.irn = extras.irn.toLowerCase();
    if (!IRN_RE.test(extras.irn)) throw new DocumentError('IRN must be 64 hexadecimal characters');
  }
  if (extras.ewayBillNo && !EWB_RE.test(extras.ewayBillNo)) throw new DocumentError('e-Way Bill number must be 12 digits');
  if (extras.consigneeGstin) {
    extras.consigneeGstin = extras.consigneeGstin.toUpperCase().replace(/\s+/g, '');
    if (!GSTIN_RE.test(extras.consigneeGstin)) throw new DocumentError('Consignee GSTIN must be 15 characters');
  }
  if (extras.vehicleNo) extras.vehicleNo = extras.vehicleNo.toUpperCase();

  const gstinState = stateNameFromCode(customerGstin?.slice(0, 2));
  const buyerState =
    canonicalState(extras.buyerStateName, 'Buyer state') ?? gstinState ?? canonicalState(placeOfSupplyIn, 'Place of supply') ?? SELLER_STATE;
  extras.buyerStateName = buyerState;
  extras.buyerStateCode = stateCodeFromName(buyerState);

  const consigneeState =
    canonicalState(extras.consigneeStateName, 'Consignee state') ?? stateNameFromCode(extras.consigneeGstin?.slice(0, 2)) ?? null;
  extras.consigneeStateName = consigneeState;
  extras.consigneeStateCode = consigneeState ? stateCodeFromName(consigneeState) : null;

  extras.ewbMode = extras.ewbMode ?? '1 - Road';
  extras.ewbSupplyType = extras.ewbSupplyType ?? 'Outward-Supply';
  extras.ewbTransactionType = extras.ewbTransactionType ?? 'Regular';

  return { extras, placeOfSupply: placeOfSupplyIn ?? buyerState };
}

function parseLines(raw: unknown): ParsedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new DocumentError('Add at least one line item');
  if (raw.length > 200) throw new DocumentError('A document can have at most 200 lines');
  return raw.map((r: any, i) => {
    const n = i + 1;
    const description = optText(r?.description);
    if (!description) throw new DocumentError(`Line ${n}: description is required`);
    if (description.length > 500) throw new DocumentError(`Line ${n}: description is too long (maximum 500 characters)`);
    const batchNote = optText(r?.batchNote);
    if (batchNote && batchNote.length > 200) throw new DocumentError(`Line ${n}: batch note is too long (maximum 200 characters)`);
    const quantity = Number(r?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new DocumentError(`Line ${n}: quantity must be greater than 0`);
    const rate = Number(r?.rate);
    if (r?.rate === '' || !Number.isFinite(rate) || rate < 0) throw new DocumentError(`Line ${n}: rate must be 0 or more`);
    const discountPercent = r?.discountPercent === undefined || r?.discountPercent === '' ? 0 : Number(r.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw new DocumentError(`Line ${n}: discount must be between 0 and 100`);
    }
    const gstRate = Number(r?.gstRate);
    if (!GST_RATES.includes(gstRate)) throw new DocumentError(`Line ${n}: GST rate must be one of ${GST_RATES.join(', ')}`);
    return {
      productId: optText(r?.productId),
      description,
      batchNote,
      sku: optText(r?.sku),
      hsnCode: optText(r?.hsnCode),
      unit: optText(r?.unit),
      quantity: Math.round(quantity * 1000) / 1000,
      rate: round2(rate),
      discountPercent: round2(discountPercent),
      gstRate
    };
  });
}

function parseCompanyId(value: unknown, fallback: string): string {
  const id = optText(value) ?? fallback;
  if (!(COMPANY_IDS as readonly string[]).includes(id)) {
    throw new DocumentError(`companyId must be one of ${COMPANY_IDS.join(', ')}`);
  }
  return id;
}

// 'plain' means no GST. Invoices and quotations can both be plain; quotation numbers do not depend on it.
function parseInvoiceKind(value: unknown, _docType: DocType, fallback: InvoiceKind): InvoiceKind {
  const kind = optText(value) ?? fallback;
  if (!(INVOICE_KINDS as readonly string[]).includes(kind)) {
    throw new DocumentError(`invoiceKind must be one of ${INVOICE_KINDS.join(', ')}`);
  }
  return kind as InvoiceKind;
}

// "Invoice only" documents carry no GST, e-invoice or e-way bill data, whatever the client sent.
function applyKind(parsed: ParsedDoc): ParsedDoc {
  if (parsed.invoiceKind !== 'plain') return parsed;
  const extras = { ...parsed.extras };
  for (const key of PORTAL_KEYS) extras[key] = null;
  return {
    ...parsed,
    pricesIncludeTax: false,
    ewbDistanceKm: null,
    extras,
    lines: parsed.lines.map((l) => ({ ...l, gstRate: 0 }))
  };
}

// `current` supplies the stored company and kind on an edit, so omitting them keeps the document where it is.
function parseInput(
  input: Record<string, any>,
  docType: DocType,
  current: { companyId: string; invoiceKind: InvoiceKind } = { companyId: 'main', invoiceKind: 'tax' }
): ParsedDoc {
  const companyId = parseCompanyId(input.companyId, current.companyId);
  const invoiceKind = parseInvoiceKind(input.invoiceKind, docType, current.invoiceKind);
  const customerName = optText(input.customerName);
  if (!customerName) throw new DocumentError('Customer name is required');
  if (customerName.length > 200) throw new DocumentError('Customer name is too long (maximum 200 characters)');
  const gstinRaw = optText(input.customerGstin)?.toUpperCase().replace(/\s+/g, '') ?? null;
  if (gstinRaw && !GSTIN_RE.test(gstinRaw)) throw new DocumentError('GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)');

  const today = businessDate();
  const docDate = optDate(input.docDate, 'docDate') || today;
  let dueDate: string | null = null;
  let validUntil: string | null = null;
  if (docType === 'invoice') {
    dueDate = optDate(input.dueDate, 'dueDate') || addDays(docDate, DEFAULT_CREDIT_DAYS);
    if (dueDate < docDate) throw new DocumentError('Due date cannot be before the invoice date');
  } else {
    validUntil = optDate(input.validUntil, 'validUntil') || addDays(docDate, DEFAULT_CREDIT_DAYS);
    if (validUntil < docDate) throw new DocumentError('Valid until cannot be before the quotation date');
  }

  const otherCharges = input.otherCharges === undefined || input.otherCharges === '' ? 0 : Number(input.otherCharges);
  if (!Number.isFinite(otherCharges) || otherCharges < 0) throw new DocumentError('Other charges must be 0 or more');

  let ewbDistanceKm: number | null = null;
  if (input.ewbDistanceKm !== undefined && input.ewbDistanceKm !== null && input.ewbDistanceKm !== '') {
    ewbDistanceKm = Number(input.ewbDistanceKm);
    if (!Number.isInteger(ewbDistanceKm) || ewbDistanceKm < 0 || ewbDistanceKm > 4000) {
      throw new DocumentError('Approximate distance must be a whole number of km between 0 and 4000');
    }
  }

  const billingAddress = optText(input.billingAddress);
  const shippingAddress = optText(input.shippingAddress);
  const notes = optText(input.notes);
  const terms = optText(input.terms);
  const phone = optText(input.customerPhone);
  for (const [field, value, max] of [
    ['Billing address', billingAddress, 500],
    ['Shipping address', shippingAddress, 500],
    ['Notes', notes, 1000],
    ['Terms', terms, 2000],
    ['Phone', phone, 30]
  ] as const) {
    if (value && value.length > max) throw new DocumentError(`${field} is too long (maximum ${max} characters)`);
  }

  const { extras, placeOfSupply } = parseExtras(input, gstinRaw, optText(input.placeOfSupply));

  return {
    companyId,
    invoiceKind,
    customerId: optText(input.customerId),
    customerName,
    customerPhone: phone,
    customerGstin: gstinRaw,
    billingAddress,
    shippingAddress,
    placeOfSupply,
    docDate,
    dueDate,
    validUntil,
    otherCharges: round2(otherCharges),
    pricesIncludeTax: input.pricesIncludeTax === true,
    ewbDistanceKm,
    extras,
    notes,
    terms: terms ?? (DEFAULT_TERMS[docType] || null),
    lines: parseLines(input.items)
  };
}

function parseDocType(value: unknown): DocType {
  if (value !== 'invoice' && value !== 'quotation') throw new DocumentError("docType must be 'invoice' or 'quotation'");
  return value;
}

function parsedFromRows(doc: DocRow, items: ItemRow[]): ParsedDoc {
  const extras = {} as Extras;
  for (const key of EXTRA_KEYS) extras[key] = doc[key];
  return {
    companyId: doc.companyId,
    invoiceKind: doc.invoiceKind === 'plain' ? 'plain' : 'tax',
    customerId: doc.customerId,
    customerName: doc.customerName,
    customerPhone: doc.customerPhone,
    customerGstin: doc.customerGstin,
    billingAddress: doc.billingAddress,
    shippingAddress: doc.shippingAddress,
    placeOfSupply: doc.placeOfSupply,
    docDate: doc.docDate,
    dueDate: doc.dueDate,
    validUntil: doc.validUntil,
    otherCharges: doc.otherCharges,
    pricesIncludeTax: doc.pricesIncludeTax,
    ewbDistanceKm: doc.ewbDistanceKm,
    extras,
    notes: doc.notes,
    terms: doc.terms,
    lines: items.map((i) => ({
      productId: i.productId,
      description: i.description,
      batchNote: i.batchNote,
      sku: i.sku,
      hsnCode: i.hsnCode,
      unit: i.unit,
      quantity: i.quantity,
      rate: i.rate,
      discountPercent: i.discountPercent,
      gstRate: i.gstRate
    }))
  };
}

function withoutPortalData(parsed: ParsedDoc): ParsedDoc {
  const extras = { ...parsed.extras };
  for (const key of PORTAL_KEYS) extras[key] = null;
  return { ...parsed, extras };
}

function displayStatus(doc: Pick<DocRow, 'docType' | 'status' | 'validUntil'>, today: string): string {
  if (doc.docType === 'quotation' && (doc.status === 'Draft' || doc.status === 'Sent') && doc.validUntil && doc.validUntil < today) {
    return 'Expired';
  }
  return doc.status;
}

function present(doc: DocRow, today = businessDate()) {
  const receivable = doc.docType === 'invoice' && (doc.status === 'Issued' || doc.status === 'Partially Paid');
  const balance = receivable ? Math.max(0, round2(doc.grandTotal - doc.paidAmount)) : 0;
  return { ...doc, storedStatus: doc.status, status: displayStatus(doc, today), balance };
}

function assertAccess(doc: DocRow | undefined, scope: string): DocRow {
  if (!doc) throw new DocumentError('Document not found', 404);
  if (scope !== 'all' && doc.branchId !== scope) throw new DocumentError('Access denied for this branch', 403);
  return doc;
}

async function lockDoc(tx: Tx, id: string, scope: string): Promise<DocRow> {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for('update');
  return assertAccess(doc, scope);
}

const numberKind = (docType: DocType, invoiceKind: string): NumberKind =>
  docType === 'quotation' ? 'quotation' : invoiceKind === 'plain' ? 'plain' : 'invoice';

async function allocateNumber(tx: Tx, companyId: string, kind: NumberKind): Promise<string> {
  const [company] = await tx.select().from(companyProfiles).where(eq(companyProfiles.id, companyId));
  if (!company) throw new DocumentError('Unknown company');
  const prefix = kind === 'quotation' ? company.quotationPrefix : kind === 'plain' ? company.plainInvoicePrefix : company.taxInvoicePrefix;

  const fy = financialYear(businessDate());
  const counterKey = `${companyId}:${kind}`;
  if (companyId === 'main' && kind !== 'plain') {
    // Carry the pre-company sequence over so existing numbers are never reissued.
    await tx.execute(
      sql`INSERT INTO document_counters (doc_type, fy, last)
          SELECT ${counterKey}, fy, last FROM document_counters WHERE doc_type = ${kind} AND fy = ${fy}
          ON CONFLICT (doc_type, fy) DO NOTHING`
    );
  }
  const result = await tx.execute(
    sql`INSERT INTO document_counters (doc_type, fy, last) VALUES (${counterKey}, ${fy}, 1)
        ON CONFLICT (doc_type, fy) DO UPDATE SET last = document_counters.last + 1
        RETURNING last`
  );
  const last = Number((result.rows[0] as { last: number | string }).last);
  return `${prefix}/${String(last).padStart(4, '0')}/${fy.slice(2)}`;
}

// A draft that moves to another number series gives its old number back when it was the newest one,
// so the old series stays free of gaps.
async function releaseNumber(tx: Tx, doc: DocRow) {
  const m = /\/(\d{4,})\/(\d{2})-(\d{2})$/.exec(doc.docNumber);
  if (!m) return;
  const kind = numberKind(doc.docType as DocType, doc.invoiceKind);
  const key = `${doc.companyId}:${kind}`;
  await tx.execute(
    sql`UPDATE document_counters SET last = last - 1
        WHERE doc_type = ${key} AND fy = ${`20${m[2]}-${m[3]}`} AND last = ${Number(m[1])} AND last > 0`
  );
  await trimCounter(tx, doc.companyId, kind, `${m[2]}-${m[3]}`);
}

// After documents are removed, the counter drops back to the highest number still in use, so the series has no
// unused numbers at its end. It never moves the counter up.
export async function trimCounter(tx: Tx, companyId: string, kind: NumberKind, fyLabel: string) {
  const kindCond =
    kind === 'quotation'
      ? sql`doc_type = 'quotation'`
      : kind === 'plain'
        ? sql`doc_type = 'invoice' and invoice_kind = 'plain'`
        : sql`doc_type = 'invoice' and invoice_kind <> 'plain'`;
  const res = await tx.execute(
    sql`select doc_number from documents where company_id = ${companyId} and ${kindCond} and doc_number like ${'%/' + fyLabel}`
  );
  let max = 0;
  for (const r of res.rows as { doc_number: string }[]) {
    const mm = /\/(\d{4,})\/\d{2}-\d{2}$/.exec(r.doc_number);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  await tx.execute(
    sql`update document_counters set last = ${max} where doc_type = ${`${companyId}:${kind}`} and fy = ${`20${fyLabel}`} and last > ${max}`
  );
}

function headerValues(parsed: ParsedDoc, docType: DocType, totals: ReturnType<typeof calcDocument>, isInterState: boolean) {
  return {
    companyId: parsed.companyId,
    invoiceKind: parsed.invoiceKind,
    customerId: parsed.customerId,
    customerName: parsed.customerName,
    customerPhone: parsed.customerPhone,
    customerGstin: parsed.customerGstin,
    billingAddress: parsed.billingAddress,
    shippingAddress: parsed.shippingAddress,
    placeOfSupply: parsed.placeOfSupply,
    isInterState,
    pricesIncludeTax: parsed.pricesIncludeTax,
    ewbDistanceKm: parsed.ewbDistanceKm,
    ...parsed.extras,
    docDate: parsed.docDate,
    dueDate: docType === 'invoice' ? parsed.dueDate : null,
    validUntil: docType === 'quotation' ? parsed.validUntil : null,
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    taxableAmount: totals.taxableAmount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    otherCharges: totals.otherCharges,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    notes: parsed.notes,
    terms: parsed.terms
  };
}

function itemValues(documentId: string, lines: ParsedLine[], totals: ReturnType<typeof calcDocument>) {
  return lines.map((l, i) => ({
    documentId,
    productId: l.productId,
    description: l.description,
    batchNote: l.batchNote,
    sku: l.sku,
    hsnCode: l.hsnCode,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    discountPercent: l.discountPercent,
    gstRate: l.gstRate,
    taxableValue: totals.lines[i].taxableValue,
    taxAmount: totals.lines[i].taxAmount,
    lineTotal: totals.lines[i].lineTotal,
    sortOrder: i
  }));
}

async function insertDocument(
  tx: Tx,
  args: {
    docType: DocType;
    branchId: string;
    parsed: ParsedDoc;
    createdBy: string;
    status: string;
    sourceQuotationId?: string | null;
    sourceMachineSaleId?: string | null;
  }
): Promise<DocRow> {
  const { docType } = args;
  const parsed = applyKind(args.parsed);
  const isInterState = parsed.invoiceKind === 'plain' ? false : detectInterState(parsed.customerGstin, parsed.placeOfSupply);
  const totals = calcDocument(parsed.lines, isInterState, parsed.otherCharges, parsed.pricesIncludeTax);
  const docNumber = await allocateNumber(tx, parsed.companyId, numberKind(docType, parsed.invoiceKind));
  const [doc] = await tx
    .insert(documents)
    .values({
      id: uid('doc'),
      docType,
      docNumber,
      branchId: args.branchId,
      status: args.status,
      ...headerValues(parsed, docType, totals, isInterState),
      sourceQuotationId: args.sourceQuotationId ?? null,
      sourceMachineSaleId: args.sourceMachineSaleId ?? null,
      createdBy: args.createdBy
    })
    .returning();
  await tx.insert(documentItems).values(itemValues(doc.id, parsed.lines, totals));
  return doc;
}

// ---------- stock ----------

// Stock changes go through the shared ledger helper; its errors keep the document error shape.
async function moveStock(tx: Tx, args: Parameters<typeof applyStockDelta>[1]) {
  try {
    return await applyStockDelta(tx, args);
  } catch (e) {
    if (e instanceof StockError) throw new DocumentError(e.message, e.status);
    throw e;
  }
}

async function deductStock(tx: Tx, doc: DocRow, items: ItemRow[], warehouseId?: string): Promise<boolean> {
  const stockLines = items.filter((i) => i.productId);
  if (stockLines.length === 0) return false;

  let fixedWarehouse: string | undefined;
  if (warehouseId) {
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
    if (!wh || wh.branchId !== doc.branchId) throw new DocumentError('Warehouse does not belong to this branch');
    fixedWarehouse = wh.id;
  }

  const need = new Map<string, { qty: number; name: string }>();
  for (const it of stockLines) {
    if (!Number.isInteger(it.quantity)) {
      throw new DocumentError(`Quantity for "${it.description}" must be a whole number to deduct stock`);
    }
    const entry = need.get(it.productId!);
    if (entry) entry.qty += it.quantity;
    else need.set(it.productId!, { qty: it.quantity, name: it.description });
  }

  const chosen = new Map<string, string>();
  // Sorted so concurrent documents touch stock rows in the same order.
  for (const productId of [...need.keys()].sort()) {
    const { qty, name } = need.get(productId)!;
    const rows = await tx
      .select({ id: warehouseStocks.id, warehouseId: warehouseStocks.warehouseId, available: warehouseStocks.available })
      .from(warehouseStocks)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStocks.warehouseId))
      .where(
        and(
          eq(warehouseStocks.productId, productId),
          eq(warehouses.branchId, doc.branchId),
          fixedWarehouse ? eq(warehouseStocks.warehouseId, fixedWarehouse) : undefined
        )
      )
      .orderBy(desc(warehouseStocks.available));
    const stock = rows[0];
    if (!stock || stock.available < qty) {
      throw new DocumentError(`Insufficient stock for ${name}: ${stock ? stock.available : 0} available, ${qty} required`);
    }
    await moveStock(tx, {
      productId,
      warehouseId: stock.warehouseId,
      availableDelta: -qty,
      type: 'document-sale',
      refType: 'document',
      refId: doc.id,
      note: `Invoice ${doc.docNumber}`,
      user: doc.createdBy || 'system'
    });
    chosen.set(productId, stock.warehouseId);
  }

  for (const it of stockLines) {
    await tx.update(documentItems).set({ warehouseId: chosen.get(it.productId!) }).where(eq(documentItems.id, it.id));
  }
  return true;
}

async function restoreStock(tx: Tx, doc: DocRow, items: ItemRow[], verb = 'Cancelled') {
  for (const it of items) {
    if (!it.productId || !it.warehouseId) continue;
    await moveStock(tx, {
      productId: it.productId,
      warehouseId: it.warehouseId,
      availableDelta: Math.round(it.quantity),
      type: 'document-sale',
      refType: 'document',
      refId: doc.id,
      note: `${verb} ${doc.docNumber}`,
      user: doc.createdBy || 'system'
    });
  }
}

async function issueInTx(tx: Tx, doc: DocRow, opts: { deductStock?: boolean; warehouseId?: string }) {
  const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, doc.id)).orderBy(asc(documentItems.sortOrder));
  const stockDeducted = opts.deductStock ? await deductStock(tx, doc, items, opts.warehouseId) : false;
  await tx.update(documents).set({ status: 'Issued', stockDeducted, updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

// ---------- invoice for a delivered machine sale ----------

const PAYMENT_METHOD_NAMES: readonly string[] = PAYMENT_METHODS;

// Keeps the invoice's payments equal to what the machine sale has received (customer payments and a paid subsidy).
// These rows are for the invoice's own history only: the money is already counted through the machine sale,
// so no cash book entry is written here.
export async function syncMachineSaleInvoice(tx: Tx, saleId: string): Promise<void> {
  const [doc] = await tx.select().from(documents).where(eq(documents.sourceMachineSaleId, saleId)).for('update');
  if (!doc) return;
  const [sale] = await tx.select().from(machineSales).where(eq(machineSales.id, saleId));
  if (!sale) return;
  const pays = await tx.select().from(machineSalePayments).where(eq(machineSalePayments.saleId, saleId));

  await tx.delete(documentPayments).where(eq(documentPayments.documentId, doc.id));
  const rows: (typeof documentPayments.$inferInsert)[] = pays.map((p) => ({
    documentId: doc.id,
    amount: p.amount,
    method: PAYMENT_METHOD_NAMES.includes(p.method) ? p.method : 'Bank Transfer',
    paidOn: p.paidOn,
    reference: p.reference,
    receivedBy: p.receivedBy
  }));
  if (sale.saleType === 'subsidy' && sale.subsidyStatus === 'Received' && sale.subsidyAmount > 0) {
    rows.push({
      documentId: doc.id,
      amount: sale.subsidyAmount,
      method: 'Bank Transfer',
      paidOn: sale.subsidyReceivedDate || businessDate(),
      reference: `Subsidy ${sale.subsidyScheme || ''}`.trim(),
      receivedBy: 'subsidy'
    });
  }
  if (rows.length) await tx.insert(documentPayments).values(rows);

  const paid = round2(rows.reduce((a, r) => a + r.amount, 0));
  const status = doc.status === 'Cancelled' ? 'Cancelled' : paid >= doc.grandTotal - EPS ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Issued';
  await tx.update(documents).set({ paidAmount: paid, status, updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

// The invoice of a machine sale is made when the sale is booked and follows every change to the sale
// (price, GST, customer, machine details), so sales are always counted from invoices. Stock is not touched:
// the machine leaves stock when it is dispatched.
async function buildMachineSaleDoc(tx: Tx, sale: typeof machineSales.$inferSelect): Promise<ParsedDoc> {
  let hsn: string | null = null;
  if (sale.productId) {
    const [p] = await tx.select({ hsn: productsTable.hsnCode }).from(productsTable).where(eq(productsTable.id, sale.productId));
    hsn = p?.hsn || null;
  }
  const gstRate = GST_RATES.includes(sale.gstRate) ? sale.gstRate : 0;
  const taxable = round2(Math.max(0, sale.listPrice - sale.discount));
  const gstin = sale.customerGstin && GSTIN_RE.test(sale.customerGstin.toUpperCase()) ? sale.customerGstin.toUpperCase() : null;
  const { extras, placeOfSupply } = parseExtras({}, gstin, null);
  const docDate = sale.bookingDate || businessDate();
  const ident = [
    sale.serialNumber && `Serial ${sale.serialNumber}`,
    sale.engineNumber && `Engine ${sale.engineNumber}`,
    sale.chassisNumber && `Chassis ${sale.chassisNumber}`
  ]
    .filter(Boolean)
    .join(' / ');

  return {
    companyId: sale.companyId,
    invoiceKind: gstRate > 0 ? 'tax' : 'plain',
    customerId: sale.customerId,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    customerGstin: gstin,
    billingAddress: sale.customerAddress,
    shippingAddress: sale.deliveryAddress,
    placeOfSupply,
    docDate,
    dueDate: sale.expectedDeliveryDate && sale.expectedDeliveryDate > docDate ? sale.expectedDeliveryDate : docDate,
    validUntil: null,
    otherCharges: 0,
    pricesIncludeTax: false,
    ewbDistanceKm: null,
    extras,
    notes: [
      `Machine sale ${sale.saleNumber}`,
      sale.discount > 0 ? `List price ${round2(sale.listPrice)} less discount ${round2(sale.discount)}` : null,
      sale.saleType === 'subsidy' ? `Government subsidy ${round2(sale.subsidyAmount)}${sale.subsidyScheme ? ` (${sale.subsidyScheme})` : ''} claimed from the department` : null
    ]
      .filter(Boolean)
      .join('. '),
    terms: DEFAULT_TERMS.invoice || null,
    lines: [
      {
        productId: sale.productId,
        description: [sale.machineName, sale.model].filter(Boolean).join(' ').slice(0, 500),
        batchNote: ident ? ident.slice(0, 200) : null,
        sku: sale.sku,
        hsnCode: hsn,
        unit: 'Nos',
        quantity: 1,
        rate: taxable,
        discountPercent: 0,
        gstRate
      }
    ]
  };
}

// Makes the invoice if the machine sale has none, and brings an existing one up to date. Returns it.
export async function ensureMachineSaleInvoice(
  tx: Tx,
  saleId: string,
  createdBy: string
): Promise<{ id: string; docNumber: string; created: boolean }> {
  const [sale] = await tx.select().from(machineSales).where(eq(machineSales.id, saleId));
  if (!sale) throw new DocumentError('Machine sale not found', 404);
  await ensureCompanyDefaults();
  const [existing] = await tx.select().from(documents).where(eq(documents.sourceMachineSaleId, saleId)).for('update');

  if (existing) {
    if (existing.status === 'Cancelled') return { id: existing.id, docNumber: existing.docNumber, created: false };
    // edited by hand: keep the lines and details as they are, only the payments still follow the machine sale
    if (existing.manualEdit) {
      await syncMachineSaleInvoice(tx, saleId);
      return { id: existing.id, docNumber: existing.docNumber, created: false };
    }
    const parsed = applyKind(await buildMachineSaleDoc(tx, sale));
    const isInterState = parsed.invoiceKind === 'plain' ? false : detectInterState(parsed.customerGstin, parsed.placeOfSupply);
    const totals = calcDocument(parsed.lines, isInterState, parsed.otherCharges, parsed.pricesIncludeTax);
    let docNumber = existing.docNumber;
    // GST on or off, or another company, is another number series
    if (parsed.invoiceKind !== existing.invoiceKind || parsed.companyId !== existing.companyId) {
      docNumber = await allocateNumber(tx, parsed.companyId, numberKind('invoice', parsed.invoiceKind));
      await releaseNumber(tx, existing);
    }
    await tx.delete(documentItems).where(eq(documentItems.documentId, existing.id));
    await tx.insert(documentItems).values(itemValues(existing.id, parsed.lines, totals));
    await tx
      .update(documents)
      .set({ ...headerValues(parsed, 'invoice', totals, isInterState), docNumber, updatedAt: new Date() })
      .where(eq(documents.id, existing.id));
    await syncMachineSaleInvoice(tx, saleId);
    return { id: existing.id, docNumber, created: false };
  }

  const doc = await insertDocument(tx, {
    docType: 'invoice',
    branchId: sale.branchId,
    parsed: await buildMachineSaleDoc(tx, sale),
    createdBy,
    status: 'Issued',
    sourceMachineSaleId: sale.id
  });
  await syncMachineSaleInvoice(tx, saleId);
  return { id: doc.id, docNumber: doc.docNumber, created: true };
}

// Deleting a machine sale removes its invoice too. The invoice number goes back to the series when it was the newest.
export async function deleteMachineSaleInvoice(tx: Tx, saleId: string): Promise<void> {
  const [doc] = await tx.select().from(documents).where(eq(documents.sourceMachineSaleId, saleId)).for('update');
  if (!doc) return;
  await tx.delete(documentPayments).where(eq(documentPayments.documentId, doc.id));
  await tx.delete(documentItems).where(eq(documentItems.documentId, doc.id));
  await tx.delete(documents).where(eq(documents.id, doc.id));
  await releaseNumber(tx, doc);
}

// A cancelled machine sale cancels its invoice.
export async function cancelMachineSaleInvoice(tx: Tx, saleId: string): Promise<void> {
  await tx
    .update(documents)
    .set({ status: 'Cancelled', updatedAt: new Date() })
    .where(eq(documents.sourceMachineSaleId, saleId));
}

// ---------- queries ----------

const expiredSql = (today: string) =>
  sql`(${documents.docType} = 'quotation' and ${documents.status} in ('Draft', 'Sent') and ${documents.validUntil} is not null and ${documents.validUntil} < ${today})`;

// 'all' or empty means every company.
function companyFilter(value: string | undefined): string | null {
  const id = value?.trim();
  if (!id || id.toLowerCase() === 'all') return null;
  if (!(COMPANY_IDS as readonly string[]).includes(id)) throw new DocumentError('Unknown company filter');
  return id;
}

// Invoices made from a machine sale that is a government subsidy sale.
const subsidyCond = (mode: string | undefined) => {
  const m = mode?.trim().toLowerCase();
  if (m !== 'only' && m !== 'exclude') return null;
  const isSubsidy = sql`exists (select 1 from machine_sales ms where ms.id = ${documents.sourceMachineSaleId} and ms.sale_type = 'subsidy')`;
  return m === 'only' ? isSubsidy : sql`not ${isSubsidy}`;
};

export interface ListFilters {
  type?: string;
  // 'only' = subsidy invoices, 'exclude' = everything else
  subsidy?: string;
  companyId?: string;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
}

export async function listDocuments(scope: string, filters: ListFilters = {}) {
  const today = businessDate();
  const conds = [];
  if (scope !== 'all') conds.push(eq(documents.branchId, scope));
  if (filters.type) conds.push(eq(documents.docType, parseDocType(filters.type)));
  const company = companyFilter(filters.companyId);
  if (company) conds.push(eq(documents.companyId, company));
  const status = filters.status;
  if (status && status.toLowerCase() !== 'all') {
    const known: readonly string[] = [...INVOICE_STATUSES, ...QUOTATION_STATUSES];
    if (!known.includes(status)) throw new DocumentError('Unknown status filter');
    if (status === 'Expired') {
      conds.push(expiredSql(today));
    } else {
      conds.push(eq(documents.status, status));
      if (status === 'Draft' || status === 'Sent') conds.push(sql`not ${expiredSql(today)}`);
    }
  }
  const from = optDate(filters.from, 'from');
  const to = optDate(filters.to, 'to');
  if (from) conds.push(gte(documents.docDate, from));
  if (to) conds.push(lte(documents.docDate, to));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conds.push(or(ilike(documents.docNumber, like), ilike(documents.customerName, like), ilike(documents.customerPhone, like))!);
  }
  const sub = subsidyCond(filters.subsidy);
  if (sub) conds.push(sub);
  const rows = await db
    .select({
      doc: documents,
      saleType: machineSales.saleType,
      subsidyAmount: machineSales.subsidyAmount,
      subsidyStatus: machineSales.subsidyStatus,
      subsidyScheme: machineSales.subsidyScheme,
      machineSaleNumber: machineSales.saleNumber
    })
    .from(documents)
    .leftJoin(machineSales, eq(machineSales.id, documents.sourceMachineSaleId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(documents.docDate), desc(documents.createdAt))
    .limit(1500);
  return rows.map((r) => ({
    ...present(r.doc, today),
    // set for invoices that come from a machine sale
    machineSaleNumber: r.machineSaleNumber ?? null,
    isSubsidy: r.saleType === 'subsidy',
    subsidyAmount: r.saleType === 'subsidy' ? r.subsidyAmount ?? 0 : 0,
    subsidyStatus: r.saleType === 'subsidy' ? r.subsidyStatus ?? null : null,
    subsidyScheme: r.saleType === 'subsidy' ? r.subsidyScheme ?? null : null
  }));
}

export async function getDocument(id: string, scope: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  assertAccess(doc, scope);
  const [items, payments] = await Promise.all([
    db.select().from(documentItems).where(eq(documentItems.documentId, id)).orderBy(asc(documentItems.sortOrder), asc(documentItems.id)),
    db.select().from(documentPayments).where(eq(documentPayments.documentId, id)).orderBy(asc(documentPayments.id))
  ]);
  return { ...present(doc), items, payments };
}

export async function getSummary(scope: string, typeParam?: string, companyParam?: string, subsidyParam?: string, fromParam?: string, toParam?: string) {
  const type = typeParam ? parseDocType(typeParam) : 'invoice';
  const today = businessDate();
  const base = [eq(documents.docType, type)];
  if (scope !== 'all') base.push(eq(documents.branchId, scope));
  const company = companyFilter(companyParam);
  if (company) base.push(eq(documents.companyId, company));
  const subsidy = subsidyCond(subsidyParam);
  if (subsidy) base.push(subsidy);
  // the totals follow the year (or dates) picked on the screen
  const from = optDate(fromParam, 'from');
  const to = optDate(toParam, 'to');
  if (from) base.push(gte(documents.docDate, from));
  if (to) base.push(lte(documents.docDate, to));

  const agg = {
    status: documents.status,
    count: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(${documents.grandTotal}), 0)::float8`,
    paid: sql<number>`coalesce(sum(${documents.paidAmount}), 0)::float8`
  };
  const rows = await db.select(agg).from(documents).where(and(...base)).groupBy(documents.status);
  const expiredRows =
    type === 'quotation'
      ? await db.select(agg).from(documents).where(and(...base, expiredSql(today))).groupBy(documents.status)
      : [];

  const statuses: readonly string[] = type === 'invoice' ? INVOICE_STATUSES : QUOTATION_STATUSES;
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const paids: Record<string, number> = {};
  for (const s of statuses) {
    counts[s] = 0;
    totals[s] = 0;
    paids[s] = 0;
  }
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + Number(r.count);
    totals[r.status] = (totals[r.status] || 0) + Number(r.total);
    paids[r.status] = (paids[r.status] || 0) + Number(r.paid);
  }
  for (const r of expiredRows) {
    counts[r.status] -= Number(r.count);
    totals[r.status] -= Number(r.total);
    counts.Expired += Number(r.count);
    totals.Expired += Number(r.total);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const billed = ['Issued', 'Partially Paid', 'Paid'];
  const invoiced = round2(billed.reduce((a, s) => a + (totals[s] || 0), 0));
  const collected = round2(billed.reduce((a, s) => a + (paids[s] || 0), 0));
  const openValue = round2(['Draft', 'Sent', 'Accepted'].reduce((a, s) => a + (totals[s] || 0), 0));

  let overdueCount = 0;
  let overdueAmount = 0;
  if (type === 'invoice') {
    const [overdue] = await db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${documents.grandTotal} - ${documents.paidAmount}), 0)::float8`
      })
      .from(documents)
      .where(
        and(
          ...base,
          sql`${documents.status} in ('Issued', 'Partially Paid')`,
          sql`${documents.dueDate} is not null and ${documents.dueDate} < ${today}`
        )
      );
    overdueCount = Number(overdue?.count ?? 0);
    overdueAmount = round2(Number(overdue?.amount ?? 0));
  }

  return {
    type,
    counts,
    total,
    invoiced,
    collected,
    outstanding: type === 'invoice' ? round2(invoiced - collected) : 0,
    overdueCount,
    overdueAmount,
    openValue: type === 'quotation' ? openValue : 0,
    acceptedValue: type === 'quotation' ? round2(totals.Accepted || 0) : 0
  };
}

// ---------- commands ----------

interface WriteInput {
  [key: string]: unknown;
}

export async function createDocument(input: WriteInput, branchId: string, createdBy: string) {
  const docType = parseDocType(input.docType);
  const parsed = parseInput(input, docType);
  const wanted = optText(input.status) || 'Draft';
  const allowed = docType === 'invoice' ? ['Draft', 'Issued'] : ['Draft', 'Sent'];
  if (!allowed.includes(wanted)) throw new DocumentError(`status must be ${allowed.join(' or ')}`);

  const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
  if (!branch) throw new DocumentError('Unknown branch', 400);
  await ensureCompanyDefaults();

  const id = await db.transaction(async (tx) => {
    const doc = await insertDocument(tx, {
      docType,
      branchId,
      parsed,
      createdBy,
      status: docType === 'quotation' && wanted === 'Sent' ? 'Sent' : 'Draft'
    });
    if (docType === 'invoice' && wanted === 'Issued') {
      await issueInTx(tx, doc, {
        deductStock: input.deductStock === true,
        warehouseId: optText(input.warehouseId) || undefined
      });
    }
    return doc.id;
  });
  return getDocument(id, branchId);
}

function assertEditable(doc: DocRow) {
  const ok = doc.docType === 'invoice' ? doc.status === 'Draft' : doc.status === 'Draft' || doc.status === 'Sent';
  if (!ok) {
    throw new DocumentError(
      doc.docType === 'invoice'
        ? `Only Draft invoices can be edited (this one is ${doc.status})`
        : `Only Draft or Sent quotations can be edited (this one is ${doc.status})`
    );
  }
}

// `force` (Super Admin only) also lets an issued or paid invoice be edited. Stock taken off for it follows the change,
// and the payments already received stay as they are (the new total cannot be lower than what was received).
export async function updateDocument(id: string, input: WriteInput, scope: string, force = false) {
  await ensureCompanyDefaults();
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    const forceIssued = force && doc.docType === 'invoice' && ['Issued', 'Partially Paid', 'Paid'].includes(doc.status);
    if (!forceIssued) assertEditable(doc);
    const docType = doc.docType as DocType;
    const parsed = applyKind(
      parseInput(input, docType, { companyId: doc.companyId, invoiceKind: doc.invoiceKind === 'plain' ? 'plain' : 'tax' })
    );
    const wanted = forceIssued ? undefined : optText(input.status);
    if (wanted && wanted !== doc.status) {
      const allowed = docType === 'invoice' ? ['Issued'] : ['Sent'];
      if (!allowed.includes(wanted)) throw new DocumentError(`status can only change to ${allowed.join(' or ')} while editing`);
    }

    // A new company or kind means a new number series, so the document is renumbered.
    const companyChanged = parsed.companyId !== doc.companyId;
    const kindChanged = docType === 'invoice' && parsed.invoiceKind !== doc.invoiceKind;
    let docNumber = doc.docNumber;
    if (companyChanged || kindChanged) {
      const draft = doc.status === 'Draft';
      if (!draft && !(docType === 'quotation' && !kindChanged && doc.status === 'Sent')) {
        throw new DocumentError('Company and invoice type can only be changed while the document is a Draft');
      }
      docNumber = await allocateNumber(tx, parsed.companyId, numberKind(docType, parsed.invoiceKind));
      await releaseNumber(tx, doc);
    }

    const isInterState = parsed.invoiceKind === 'plain' ? false : detectInterState(parsed.customerGstin, parsed.placeOfSupply);
    const totals = calcDocument(parsed.lines, isInterState, parsed.otherCharges, parsed.pricesIncludeTax);

    let nextStatus: string = docType === 'quotation' && wanted === 'Sent' ? 'Sent' : doc.status;
    let oldWarehouse: string | undefined;
    if (forceIssued) {
      if (doc.paidAmount > totals.grandTotal + EPS) {
        throw new DocumentError(
          `${doc.paidAmount.toFixed(2)} has already been received on this invoice, which is more than the new total of ${totals.grandTotal.toFixed(2)}.`
        );
      }
      nextStatus = doc.paidAmount > 0 ? (doc.paidAmount >= totals.grandTotal - EPS ? 'Paid' : 'Partially Paid') : 'Issued';
      if (doc.stockDeducted) {
        const before = await tx.select().from(documentItems).where(eq(documentItems.documentId, id));
        oldWarehouse = before.find((i) => i.warehouseId)?.warehouseId || undefined;
        await restoreStock(tx, doc, before, 'Edited');
      }
    }

    await tx.delete(documentItems).where(eq(documentItems.documentId, id));
    await tx.insert(documentItems).values(itemValues(id, parsed.lines, totals));
    const [updated] = await tx
      .update(documents)
      .set({
        ...headerValues(parsed, docType, totals, isInterState),
        docNumber,
        status: nextStatus,
        // an invoice of a machine sale, once edited by hand, is no longer rebuilt from the machine sale
        ...(forceIssued && doc.sourceMachineSaleId ? { manualEdit: true } : {}),
        updatedAt: new Date()
      })
      .where(eq(documents.id, id))
      .returning();
    if (forceIssued && doc.stockDeducted) {
      // take the new lines off stock again (from the same warehouse when it can); not enough stock cancels the whole edit
      const after = await tx.select().from(documentItems).where(eq(documentItems.documentId, id)).orderBy(asc(documentItems.sortOrder));
      const deducted = await deductStock(tx, updated, after, oldWarehouse);
      await tx.update(documents).set({ stockDeducted: deducted }).where(eq(documents.id, id));
    }
    if (docType === 'invoice' && wanted === 'Issued') {
      await issueInTx(tx, updated, {
        deductStock: input.deductStock === true,
        warehouseId: optText(input.warehouseId) || undefined
      });
    }
  });
  return getDocument(id, scope);
}

export async function issueDocument(id: string, input: { deductStock?: unknown; warehouseId?: unknown }, scope: string) {
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    if (doc.docType !== 'invoice') throw new DocumentError('Only invoices can be issued');
    if (doc.status !== 'Draft') throw new DocumentError(`Only Draft invoices can be issued (this one is ${doc.status})`);
    await issueInTx(tx, doc, {
      deductStock: input.deductStock === true,
      warehouseId: optText(input.warehouseId) || undefined
    });
  });
  return getDocument(id, scope);
}

export async function addPayment(
  id: string,
  input: { amount?: unknown; method?: unknown; paidOn?: unknown; reference?: unknown },
  scope: string,
  receivedBy: string
) {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new DocumentError('amount must be greater than 0');
  const method = typeof input.method === 'string' && input.method ? input.method : 'Cash';
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new DocumentError(`method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  const paidOn = optDate(input.paidOn, 'paidOn') || businessDate();
  const reference = optText(input.reference);

  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    if (doc.docType !== 'invoice') throw new DocumentError('Payments can only be recorded against invoices');
    if (doc.status !== 'Issued' && doc.status !== 'Partially Paid') {
      throw new DocumentError(
        doc.status === 'Paid' ? 'This invoice is already fully paid' : `Cannot take payment on a ${doc.status} invoice`
      );
    }
    const balance = round2(doc.grandTotal - doc.paidAmount);
    if (amount > balance + EPS) throw new DocumentError(`Amount exceeds the balance of ${balance.toFixed(2)}`);

    await tx.insert(documentPayments).values({ documentId: id, amount, method, paidOn, reference, receivedBy });
    const paidAmount = round2(doc.paidAmount + amount);
    await tx
      .update(documents)
      .set({ paidAmount, status: paidAmount >= doc.grandTotal - EPS ? 'Paid' : 'Partially Paid', updatedAt: new Date() })
      .where(eq(documents.id, id));
    await tx.insert(cashEntries).values({
      id: uid('cash'),
      branchId: doc.branchId,
      entryDate: paidOn,
      type: 'in',
      category: 'Customer collection',
      amount,
      method,
      description: `Payment ${doc.docNumber}`,
      createdBy: receivedBy
    });
  });
  return getDocument(id, scope);
}

export async function convertQuotation(id: string, scope: string, createdBy: string, input: { invoiceKind?: unknown } = {}) {
  await ensureCompanyDefaults();
  const invoiceId = await db.transaction(async (tx) => {
    const quote = await lockDoc(tx, id, scope);
    if (quote.docType !== 'quotation') throw new DocumentError('Only quotations can be converted');
    const invoiceKind = parseInvoiceKind(input.invoiceKind, 'invoice', quote.invoiceKind === 'plain' ? 'plain' : 'tax');
    if (!['Draft', 'Sent', 'Accepted'].includes(quote.status)) {
      throw new DocumentError(`A ${quote.status} quotation cannot be converted`);
    }
    const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, id)).orderBy(asc(documentItems.sortOrder));
    const today = businessDate();
    const parsed: ParsedDoc = {
      ...withoutPortalData(parsedFromRows(quote, items)),
      invoiceKind,
      docDate: today,
      dueDate: addDays(today, DEFAULT_CREDIT_DAYS),
      validUntil: null,
      terms: DEFAULT_TERMS.invoice || null
    };
    const invoice = await insertDocument(tx, {
      docType: 'invoice',
      branchId: quote.branchId,
      parsed,
      createdBy,
      status: 'Draft',
      sourceQuotationId: quote.id
    });
    await tx
      .update(documents)
      .set({ status: 'Converted', convertedInvoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(documents.id, id));
    return invoice.id;
  });
  return getDocument(invoiceId, scope);
}

export async function duplicateDocument(id: string, scope: string, createdBy: string) {
  await ensureCompanyDefaults();
  const newId = await db.transaction(async (tx) => {
    const src = await lockDoc(tx, id, scope);
    const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, id)).orderBy(asc(documentItems.sortOrder));
    const today = businessDate();
    const docType = src.docType as DocType;
    const parsed: ParsedDoc = {
      ...withoutPortalData(parsedFromRows(src, items)),
      docDate: today,
      dueDate: docType === 'invoice' ? addDays(today, DEFAULT_CREDIT_DAYS) : null,
      validUntil: docType === 'quotation' ? addDays(today, DEFAULT_CREDIT_DAYS) : null
    };
    const copy = await insertDocument(tx, { docType, branchId: src.branchId, parsed, createdBy, status: 'Draft' });
    return copy.id;
  });
  return getDocument(newId, scope);
}

// Removes a document that never took effect: a Draft or Cancelled invoice, or a Draft, Rejected or Cancelled
// quotation. An issued invoice has to be cancelled first (that also returns its stock). The number goes back to
// the series when it was the newest.
// `force` (Super Admin only) also removes an invoice that was issued or paid: stock taken off for it goes back, and the
// payments recorded on it are removed together with the cash book entries they made.
export async function deleteDocument(id: string, scope: string, force = false) {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    const allowed = doc.docType === 'invoice' ? ['Draft', 'Cancelled'] : ['Draft', 'Rejected', 'Cancelled'];
    let paymentsRemoved = 0;
    if (force && doc.docType === 'invoice' && !allowed.includes(doc.status)) {
      const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, id));
      if (doc.stockDeducted) await restoreStock(tx, doc, items, 'Deleted');
      const pays = await tx.select().from(documentPayments).where(eq(documentPayments.documentId, id));
      paymentsRemoved = pays.length;
      // A machine sale's invoice only mirrors money the machine sale holds, so it wrote no cash entries.
      if (!doc.sourceMachineSaleId) {
        for (const p of pays) {
          const [entry] = await tx
            .select({ id: cashEntries.id })
            .from(cashEntries)
            .where(
              and(
                eq(cashEntries.branchId, doc.branchId),
                eq(cashEntries.type, 'in'),
                eq(cashEntries.category, 'Customer collection'),
                eq(cashEntries.description, `Payment ${doc.docNumber}`),
                eq(cashEntries.amount, p.amount),
                eq(cashEntries.method, p.method),
                eq(cashEntries.entryDate, p.paidOn)
              )
            )
            .limit(1);
          if (entry) await tx.delete(cashEntries).where(eq(cashEntries.id, entry.id));
        }
      }
    } else if (!allowed.includes(doc.status)) {
      throw new DocumentError(
        doc.docType === 'invoice'
          ? 'Only a Draft or Cancelled invoice can be deleted. Cancel an issued invoice first.'
          : 'Only a Draft, Rejected or Cancelled quotation can be deleted.',
        409
      );
    }
    await tx.delete(documentPayments).where(eq(documentPayments.documentId, id));
    await tx.delete(documentItems).where(eq(documentItems.documentId, id));
    // a quotation that was converted into this invoice becomes open again
    await tx
      .update(documents)
      .set({ convertedInvoiceId: null, status: 'Accepted', updatedAt: new Date() })
      .where(and(eq(documents.convertedInvoiceId, id), eq(documents.status, 'Converted')));
    await tx.update(machineSales).set({ invoiceId: null, documentNumber: null }).where(eq(machineSales.invoiceId, id));
    await tx.delete(documents).where(eq(documents.id, id));
    await releaseNumber(tx, doc);
    return { id: doc.id, docNumber: doc.docNumber, docType: doc.docType as DocType, paymentsRemoved };
  });
}

export async function cancelDocument(id: string, scope: string) {
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    if (doc.status === 'Cancelled') throw new DocumentError('This document is already cancelled');
    if (doc.docType === 'invoice') {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(documentPayments)
        .where(eq(documentPayments.documentId, id));
      if (doc.paidAmount > 0 || Number(count) > 0) {
        throw new DocumentError('This invoice has payments recorded and cannot be cancelled');
      }
      if (doc.stockDeducted) {
        const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, id));
        await restoreStock(tx, doc, items);
      }
    } else if (doc.status === 'Converted') {
      throw new DocumentError('A converted quotation cannot be cancelled; cancel the invoice instead');
    }
    await tx.update(documents).set({ status: 'Cancelled', stockDeducted: false, updatedAt: new Date() }).where(eq(documents.id, id));
  });
  return getDocument(id, scope);
}

const QUOTE_TARGETS = ['Sent', 'Accepted', 'Rejected'];

export async function changeQuotationStatus(id: string, status: string, scope: string) {
  if (!QUOTE_TARGETS.includes(status)) throw new DocumentError(`status must be one of ${QUOTE_TARGETS.join(', ')}`);
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id, scope);
    if (doc.docType !== 'quotation') throw new DocumentError('Status changes apply to quotations only');
    if (!['Draft', 'Sent', 'Accepted', 'Rejected'].includes(doc.status)) {
      throw new DocumentError(`Cannot change a ${doc.status} quotation`);
    }
    if (doc.status === status) throw new DocumentError(`Quotation is already ${status}`);
    await tx.update(documents).set({ status, updatedAt: new Date() }).where(eq(documents.id, id));
  });
  return getDocument(id, scope);
}
