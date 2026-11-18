import { apiRequest, type ApiScope } from './apiClient';
import type { CompanyId } from './companyApi';

export type MachineSaleStatus = 'Booked' | 'Ready for Delivery' | 'Dispatched' | 'Delivered' | 'Cancelled';

export const MACHINE_SALE_FLOW: MachineSaleStatus[] = ['Booked', 'Ready for Delivery', 'Dispatched', 'Delivered'];
export const MACHINE_SALE_STATUSES: MachineSaleStatus[] = [...MACHINE_SALE_FLOW, 'Cancelled'];

export const MACHINE_PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Finance'] as const;
export type MachinePaymentMode = (typeof MACHINE_PAYMENT_MODES)[number];
// Finance is a disbursal from the financier, so it is not offered for the customer's own advance.
export const ADVANCE_METHODS: MachinePaymentMode[] = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'];

export interface MachineSale {
  id: string;
  saleNumber: string;
  branchId: string;
  companyId: CompanyId;
  status: MachineSaleStatus;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerGstin: string;
  productId: string | null;
  machineName: string;
  model: string;
  sku: string;
  serialNumber: string;
  engineNumber: string;
  chassisNumber: string;
  listPrice: number;
  discount: number;
  salePrice: number;
  // 0 = without GST; otherwise salePrice includes GST and gstAmount is the tax inside it
  gstRate: number;
  gstAmount: number;
  advancePaid: number;
  paidAmount: number;
  balance: number;
  invoiceId?: string | null;
  paymentMode: MachinePaymentMode;
  financier: string;
  loanAmount: number;
  saleType: 'normal' | 'subsidy';
  subsidyScheme: string | null;
  subsidyAmount: number;
  subsidyStatus: 'Applied' | 'Sanctioned' | 'Received' | 'Rejected' | null;
  subsidyApplicationNo: string | null;
  subsidyReceivedDate: string | null;
  // What the customer has to pay (price minus subsidy) and what is still to be claimed from the scheme.
  customerPayable: number;
  subsidyDue: number;
  bookingDate: string;
  expectedDeliveryDate: string | null;
  deliveredDate: string | null;
  deliveryAddress: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  pdiDone: boolean;
  pdiNotes: string;
  handoverNotes: string;
  receivedByName: string;
  warrantyMonths: number;
  warrantyStart: string | null;
  documentNumber: string | null;
  // an old sale entered from the bill files: already settled, no balance to collect
  isHistorical?: boolean;
  stockDeducted: boolean;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MachineSalePayment {
  id: string | number;
  amount: number;
  method: MachinePaymentMode;
  paidOn: string;
  reference: string;
  receivedBy: string;
}

export interface MachineSaleEvent {
  id: string | number;
  stage: string;
  date: string;
  user: string;
  notes: string;
}

export interface MachineSaleDetail extends MachineSale {
  payments: MachineSalePayment[];
  events: MachineSaleEvent[];
  // true when the mobile number was new and the customer was added to the customer list
  customerCreated?: boolean;
}

// Old bills with no date written on them are kept under this placeholder date and shown as "No date".
export const NO_DATE = '1900-01-01';

export interface YearSummary {
  fy: number; // the year it starts in: 2015 means 2015-2016
  label: string;
  units: number;
  value: number;
  avgPrice: number;
  topModel: string | null;
  topModelUnits: number;
}

export interface YearsReport {
  years: YearSummary[];
  monthly: number[]; // machines sold in Jan..Dec over all years
  noDate: { units: number; value: number }; // old bills that never had a date written on them
  totalUnits: number;
  totalValue: number;
}

export interface MachineSaleSummary {
  booked: number;
  readyForDelivery: number;
  dispatched: number;
  deliveredThisMonth: number;
  outstandingBalance: number;
  subsidyPending: number;
  dueToday: number;
  overdue: number;
}

export interface MachineSaleInput {
  // the branch the sale is booked for (owners choose it; everyone else is placed in their own branch)
  branchId?: string;
  companyId: CompanyId;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerGstin: string;
  productId?: string;
  machineName: string;
  model: string;
  sku: string;
  serialNumber: string;
  engineNumber: string;
  chassisNumber: string;
  listPrice: number;
  discount: number;
  salePrice: number;
  gstRate?: number;
  advance?: { amount: number; method: MachinePaymentMode; reference?: string };
  // Direct sale: sold and handed over at the counter, with no booking in between
  directSale?: boolean;
  // Secondary advance: part of the advance paid another way
  advance2?: { amount: number; method: MachinePaymentMode; reference?: string };
  paymentMode: MachinePaymentMode;
  financier: string;
  loanAmount: number;
  saleType: 'normal' | 'subsidy';
  subsidyScheme?: string;
  subsidyAmount?: number;
  subsidyApplicationNo?: string;
  bookingDate: string;
  expectedDeliveryDate?: string;
  deliveryAddress: string;
  warrantyMonths: number;
}

export interface PaymentInput {
  amount: number;
  method: MachinePaymentMode;
  paidOn?: string;
  reference?: string;
  // Secondary payment: part of this payment taken another way
  secondary?: { amount: number; method: MachinePaymentMode; reference?: string };
}

export interface DispatchInput {
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
  deliveryAddress?: string;
  warehouseId?: string;
}

export interface DeliverInput {
  receivedByName: string;
  handoverNotes?: string;
  deliveredDate?: string;
  warrantyStart?: string;
}

const NUM_FIELDS = [
  'listPrice',
  'discount',
  'salePrice',
  'gstRate',
  'gstAmount',
  'advancePaid',
  'paidAmount',
  'balance',
  'loanAmount',
  'subsidyAmount',
  'customerPayable',
  'subsidyDue',
  'warrantyMonths'
] as const;

// Numeric SQL columns can arrive as strings, so coerce once here and keep the screens free of Number() calls.
function normalizeSale<T extends MachineSale>(row: T): T {
  const out: MachineSale = { ...row };
  for (const k of NUM_FIELDS) out[k] = Number(row[k]) || 0;
  out.pdiDone = !!row.pdiDone;
  out.stockDeducted = !!row.stockDeducted;
  return out as T;
}

function normalizeDetail(d: MachineSaleDetail): MachineSaleDetail {
  return {
    ...normalizeSale(d),
    payments: (d.payments || []).map((p) => ({ ...p, amount: Number(p.amount) || 0 })),
    events: d.events || [],
    customerCreated: d.customerCreated
  };
}

function normalizeSummary(s: MachineSaleSummary): MachineSaleSummary {
  return {
    booked: Number(s.booked) || 0,
    readyForDelivery: Number(s.readyForDelivery) || 0,
    dispatched: Number(s.dispatched) || 0,
    deliveredThisMonth: Number(s.deliveredThisMonth) || 0,
    outstandingBalance: Number(s.outstandingBalance) || 0,
    subsidyPending: Number(s.subsidyPending) || 0,
    dueToday: Number(s.dueToday) || 0,
    overdue: Number(s.overdue) || 0
  };
}

const branchQuery = (branchId?: string) => ({ branch_id: branchId });
const base = '/machine-sales';

export const machineSaleApi = {
  list: async (
    scope: ApiScope,
    opts: { branchId?: string; status?: string; q?: string; customerId?: string; from?: string; to?: string; serial?: string; serialState?: string; payment?: string }
  ) => {
    const rows = await apiRequest<MachineSale[]>(base, scope, {
      query: {
        ...branchQuery(opts.branchId),
        status: opts.status && opts.status !== 'All' ? opts.status : undefined,
        q: opts.q,
        customer_id: opts.customerId,
        from: opts.from,
        to: opts.to,
        serial: opts.serial,
        serial_state: opts.serialState && opts.serialState !== 'all' ? opts.serialState : undefined,
        payment: opts.payment && opts.payment !== 'all' ? opts.payment : undefined
      }
    });
    return Array.isArray(rows) ? rows.map(normalizeSale) : [];
  },
  subsidy: async (
    scope: ApiScope,
    id: string,
    body: { status: 'Applied' | 'Sanctioned' | 'Received' | 'Rejected'; applicationNo?: string; receivedDate?: string; notes?: string },
    branchId?: string
  ) =>
    normalizeDetail(
      await apiRequest<MachineSaleDetail>(`${base}/${id}/subsidy`, scope, { method: 'POST', body, query: branchQuery(branchId) })
    ),
  years: (scope: ApiScope, branchId?: string) => apiRequest<YearsReport>(`${base}/years`, scope, { query: branchQuery(branchId) }),
  summary: async (scope: ApiScope, branchId?: string) =>
    normalizeSummary(await apiRequest<MachineSaleSummary>(`${base}/summary`, scope, { query: branchQuery(branchId) })),
  get: async (scope: ApiScope, id: string, branchId?: string) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}`, scope, { query: branchQuery(branchId) })),
  create: async (scope: ApiScope, body: MachineSaleInput) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(base, scope, { method: 'POST', body })),
  update: async (scope: ApiScope, id: string, body: Omit<MachineSaleInput, 'advance' | 'advance2'>) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}`, scope, { method: 'PUT', body })),
  updatePayment: async (scope: ApiScope, id: string, paymentId: number, body: PaymentInput) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/payments/${paymentId}`, scope, { method: 'PUT', body })),
  deletePayment: async (scope: ApiScope, id: string, paymentId: number) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/payments/${paymentId}`, scope, { method: 'DELETE' })),
  addPayment: async (scope: ApiScope, id: string, body: PaymentInput) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/payments`, scope, { method: 'POST', body })),
  markReady: async (scope: ApiScope, id: string, body: { pdiDone: true; pdiNotes?: string }) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/ready`, scope, { method: 'POST', body })),
  dispatch: async (scope: ApiScope, id: string, body: DispatchInput) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/dispatch`, scope, { method: 'POST', body })),
  deliver: async (scope: ApiScope, id: string, body: DeliverInput) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/deliver`, scope, { method: 'POST', body })),
  remove: async (scope: ApiScope, id: string) =>
    apiRequest<{ deleted: true }>(`${base}/${id}`, scope, { method: 'DELETE' }),
  // Sends (or sends again) the thank-you message to the customer's WhatsApp
  sendThankYou: async (scope: ApiScope, id: string) =>
    apiRequest<{ status: 'sent' | 'failed' | 'queued' | 'skipped'; detail: string }>(`${base}/${id}/send-thank-you`, scope, { method: 'POST', body: {} }),
  generateInvoice: async (scope: ApiScope, id: string) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/invoice`, scope, { method: 'POST', body: {} })),
  cancel: async (scope: ApiScope, id: string, body: { reason: string }) =>
    normalizeDetail(await apiRequest<MachineSaleDetail>(`${base}/${id}/cancel`, scope, { method: 'POST', body }))
};

// Owners browse every branch with one scope, so actions on a sale go out under that sale's own branch.
export const scopeForSale = (scope: ApiScope, sale: { branchId: string }, isOwner: boolean): ApiScope =>
  isOwner && sale.branchId ? { ...scope, branchId: sale.branchId } : scope;

export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// YYYY-MM-DD plus whole months, clamped to the last day of the target month (31 Jan + 1 month = 28/29 Feb).
export function addMonthsIso(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const target = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(Number(m[3]), lastDay));
  return target.toISOString().slice(0, 10);
}

export const formatMoney = (n: number, currency: string) =>
  `${currency}${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const OPEN_STATUSES: MachineSaleStatus[] = ['Booked', 'Ready for Delivery', 'Dispatched'];

export const isSaleOverdue = (s: Pick<MachineSale, 'expectedDeliveryDate' | 'status'>) =>
  !!s.expectedDeliveryDate && s.expectedDeliveryDate < todayIst() && OPEN_STATUSES.includes(s.status);

export const isSaleDueToday = (s: Pick<MachineSale, 'expectedDeliveryDate' | 'status'>) =>
  !!s.expectedDeliveryDate && s.expectedDeliveryDate === todayIst() && OPEN_STATUSES.includes(s.status);
