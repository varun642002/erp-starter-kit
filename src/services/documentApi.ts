import { apiRequest, type ApiScope } from './apiClient';
import type { CompanyId } from './companyApi';

export type DocType = 'invoice' | 'quotation';
// 'plain' is a document without GST (an invoice only, or a quotation without GST).
export type InvoiceKind = 'tax' | 'plain';

export type InvoiceStatus = 'Draft' | 'Issued' | 'Partially Paid' | 'Paid' | 'Cancelled';
export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired' | 'Converted' | 'Cancelled';
export type DocStatus = InvoiceStatus | QuotationStatus;

export const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Cancelled'];
export const QUOTATION_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Converted', 'Cancelled'];
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Optional header fields: party/transport references and e-Invoice / e-Way Bill values typed in from the GST portal.
export const EXTRA_TEXT_KEYS = [
  'buyerStateName',
  'buyerStateCode',
  'consigneeName',
  'consigneeAddress',
  'consigneeGstin',
  'consigneeStateName',
  'consigneeStateCode',
  'irn',
  'ackNo',
  'ackDate',
  'einvoiceQr',
  'ewayBillNo',
  'deliveryNote',
  'deliveryNoteDate',
  'referenceNo',
  'referenceDate',
  'buyerOrderNo',
  'buyerOrderDate',
  'dispatchDocNo',
  'dispatchedThrough',
  'destination',
  'ladingNo',
  'ladingDate',
  'vehicleNo',
  'termsOfDelivery',
  'paymentTerms',
  'otherReferences',
  'ewbMode',
  'ewbGeneratedAt',
  'ewbValidUpto',
  'ewbSupplyType',
  'ewbTransactionType',
  'transporterId',
  'transporterName',
  'transporterDocNo',
  'transporterDocDate',
  'ewbFromPlace'
] as const;
export type ExtraTextKey = (typeof EXTRA_TEXT_KEYS)[number];
export type DocumentExtrasRow = { [K in ExtraTextKey]: string | null };
export type DocumentExtrasPayload = { [K in ExtraTextKey]?: string };

export interface DocumentRow extends DocumentExtrasRow {
  id: string;
  docType: DocType;
  docNumber: string;
  branchId: string;
  companyId: CompanyId;
  invoiceKind: InvoiceKind;
  // Displayed status: a Draft/Sent quotation past its validity is returned as Expired.
  status: DocStatus;
  storedStatus: DocStatus;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerGstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  placeOfSupply: string;
  isInterState: boolean;
  docDate: string;
  dueDate: string | null;
  validUntil: string | null;
  subtotal: number;
  totalDiscount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  otherCharges: number;
  roundOff: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  notes: string | null;
  terms: string | null;
  sourceQuotationId: string | null;
  sourceMachineSaleId?: string | null;
  // invoice made from a machine sale
  machineSaleNumber?: string | null;
  isSubsidy?: boolean;
  subsidyAmount?: number;
  subsidyStatus?: string | null;
  subsidyScheme?: string | null;
  convertedInvoiceId: string | null;
  stockDeducted: boolean;
  pricesIncludeTax: boolean;
  ewbDistanceKm: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentItem {
  id: number;
  documentId: string;
  productId: string | null;
  warehouseId: string | null;
  description: string;
  batchNote: string | null;
  sku: string | null;
  hsnCode: string | null;
  unit: string | null;
  quantity: number;
  rate: number;
  discountPercent: number;
  gstRate: number;
  taxableValue: number;
  taxAmount: number;
  lineTotal: number;
  sortOrder: number;
}

export interface DocumentPayment {
  id: number;
  documentId: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  receivedBy: string | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentRow {
  items: DocumentItem[];
  payments: DocumentPayment[];
}

export interface DocumentSummary {
  type: DocType;
  counts: Record<string, number>;
  total: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  overdueCount: number;
  overdueAmount: number;
  openValue: number;
  acceptedValue: number;
}

export interface DocumentLinePayload {
  productId?: string;
  description: string;
  batchNote?: string;
  sku?: string;
  hsnCode?: string;
  unit?: string;
  quantity: number;
  rate: number;
  discountPercent: number;
  gstRate: number;
}

export interface DocumentPayload extends DocumentExtrasPayload {
  pricesIncludeTax?: boolean;
  ewbDistanceKm?: number;
  docType?: DocType;
  branchId?: string;
  companyId?: CompanyId;
  invoiceKind?: InvoiceKind;
  // Invoice: Draft | Issued. Quotation: Draft | Sent.
  status?: 'Draft' | 'Issued' | 'Sent';
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerGstin?: string;
  billingAddress?: string;
  shippingAddress?: string;
  placeOfSupply: string;
  docDate: string;
  dueDate?: string;
  validUntil?: string;
  otherCharges: number;
  notes?: string;
  terms?: string;
  items: DocumentLinePayload[];
  deductStock?: boolean;
  warehouseId?: string;
}

export interface ListOptions {
  type: DocType;
  // 'only' = invoices of subsidy machine sales, 'exclude' = all the others
  subsidy?: 'only' | 'exclude';
  branchId?: string;
  companyId?: CompanyId;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
}

const branchQuery = (branchId?: string) => ({ branch_id: branchId });

export const documentApi = {
  list: (scope: ApiScope, o: ListOptions) =>
    apiRequest<DocumentRow[]>('/documents', scope, {
      query: {
        ...branchQuery(o.branchId),
        company_id: o.companyId,
        type: o.type,
        status: o.status && o.status !== 'All' ? o.status : undefined,
        subsidy: o.subsidy,
        q: o.q,
        from: o.from,
        to: o.to
      }
    }),
  summary: (scope: ApiScope, type: DocType, branchId?: string, companyId?: CompanyId, subsidy?: 'only' | 'exclude', from?: string, to?: string) =>
    apiRequest<DocumentSummary>('/documents/summary', scope, {
      query: { ...branchQuery(branchId), type, company_id: companyId, subsidy, from, to }
    }),
  get: (scope: ApiScope, id: string, branchId?: string) =>
    apiRequest<DocumentDetail>(`/documents/${id}`, scope, { query: branchQuery(branchId) }),
  // force = also delete an issued or paid invoice (Super Admin only)
  remove: (scope: ApiScope, id: string, branchId?: string, force = false) =>
    apiRequest<{ id: string; docNumber: string; docType: DocType; paymentsRemoved?: number }>(`/documents/${id}`, scope, {
      method: 'DELETE',
      query: { ...branchQuery(branchId), ...(force ? { force: 1 } : {}) }
    }),
  create: (scope: ApiScope, body: DocumentPayload, branchId?: string) =>
    apiRequest<DocumentDetail>('/documents', scope, { method: 'POST', body, query: branchQuery(branchId) }),
  // force = also edit an issued or paid invoice (Super Admin only)
  update: (scope: ApiScope, id: string, body: DocumentPayload, branchId?: string, force = false) =>
    apiRequest<DocumentDetail>(`/documents/${id}`, scope, {
      method: 'PUT',
      body,
      query: { ...branchQuery(branchId), ...(force ? { force: 1 } : {}) }
    }),
  issue: (scope: ApiScope, id: string, body: { deductStock: boolean; warehouseId?: string }, branchId?: string) =>
    apiRequest<DocumentDetail>(`/documents/${id}/issue`, scope, { method: 'POST', body, query: branchQuery(branchId) }),
  addPayment: (
    scope: ApiScope,
    id: string,
    body: { amount: number; method: PaymentMethod; paidOn?: string; reference?: string },
    branchId?: string
  ) => apiRequest<DocumentDetail>(`/documents/${id}/payments`, scope, { method: 'POST', body, query: branchQuery(branchId) }),
  convert: (scope: ApiScope, id: string, branchId?: string, invoiceKind?: InvoiceKind) =>
    apiRequest<DocumentDetail>(`/documents/${id}/convert`, scope, {
      method: 'POST',
      body: invoiceKind ? { invoiceKind } : undefined,
      query: branchQuery(branchId)
    }),
  // Sends the bill link to the customer's WhatsApp through the business API when it is set up.
  sendBill: (scope: ApiScope, id: string, branchId?: string) =>
    apiRequest<{ status: 'sent' | 'failed' | 'queued' | 'skipped'; detail: string; url?: string }>(`/documents/${id}/send-bill`, scope, {
      method: 'POST',
      body: {},
      query: branchQuery(branchId)
    }),
  cancel: (scope: ApiScope, id: string, branchId?: string) =>
    apiRequest<DocumentDetail>(`/documents/${id}/cancel`, scope, { method: 'POST', query: branchQuery(branchId) }),
  duplicate: (scope: ApiScope, id: string, branchId?: string) =>
    apiRequest<DocumentDetail>(`/documents/${id}/duplicate`, scope, { method: 'POST', query: branchQuery(branchId) }),
  setStatus: (scope: ApiScope, id: string, status: 'Sent' | 'Accepted' | 'Rejected', branchId?: string) =>
    apiRequest<DocumentDetail>(`/documents/${id}/status`, scope, { method: 'POST', body: { status }, query: branchQuery(branchId) })
};
