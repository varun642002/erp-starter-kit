import { apiRequest, type ApiScope } from './apiClient';

export type JobStatus =
  | 'Received'
  | 'Diagnosing'
  | 'Awaiting Parts'
  | 'In Progress'
  | 'Ready'
  | 'Delivered'
  | 'Cancelled';

export const JOB_STATUS_FLOW: JobStatus[] = ['Received', 'Diagnosing', 'Awaiting Parts', 'In Progress', 'Ready', 'Delivered'];
export const JOB_STATUSES: JobStatus[] = [...JOB_STATUS_FLOW, 'Cancelled'];
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface JobCard {
  id: string;
  jobNumber: string;
  branchId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  machineModel: string | null;
  serialNumber: string | null;
  complaint: string;
  diagnosis: string | null;
  status: JobStatus;
  technician: string | null;
  isWarranty: boolean;
  labourHours: number;
  labourRate: number;
  labourCharge: number;
  partsTotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  balance: number;
  receivedOn: string;
  promisedDate: string | null;
  deliveredOn: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobCardPart {
  id: number;
  jobCardId: string;
  productId: string | null;
  warehouseId: string | null;
  productName: string;
  sku: string | null;
  quantity: number;
  rate: number;
  amount: number;
}

export interface JobCardService {
  id: number;
  jobCardId: string;
  serviceId: string | null;
  name: string;
  machineType: string | null;
  cost: number;
}

export interface JobCardPayment {
  id: number;
  jobCardId: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  receivedBy: string | null;
}

export interface JobCardDetail extends JobCard {
  parts: JobCardPart[];
  services: JobCardService[];
  servicesTotal: number;
  payments: JobCardPayment[];
}

export interface JobCardSummary {
  counts: Record<JobStatus, number>;
  total: number;
  open: number;
  overdue: number;
}

export type SerialLookup =
  | { found: false }
  | {
      found: true;
      serialNumber: string;
      productId: string | null;
      productName: string;
      customerId: string | null;
      customerName: string;
      customerPhone: string | null;
      purchaseDate: string;
      warrantyExpiryDate: string;
      inWarranty: boolean;
    };

export interface NewJobCardPayload {
  branchId?: string;
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  machineModel?: string;
  serialNumber?: string;
  complaint: string;
  promisedDate?: string;
  technician?: string;
  labourRate?: number;
  isWarranty?: boolean;
}

export interface JobCardPatch {
  diagnosis?: string;
  technician?: string;
  labourHours?: number;
  labourRate?: number;
  discount?: number;
  promisedDate?: string;
  complaint?: string;
  isWarranty?: boolean;
}

const branchQuery = (branchId?: string) => ({ branch_id: branchId });

export const jobCardApi = {
  list: (scope: ApiScope, opts: { branchId?: string; status?: string; q?: string }) =>
    apiRequest<JobCard[]>('/job-cards', scope, {
      query: { ...branchQuery(opts.branchId), status: opts.status && opts.status !== 'All' ? opts.status : undefined, q: opts.q }
    }),
  summary: (scope: ApiScope, branchId?: string) =>
    apiRequest<JobCardSummary>('/job-cards/summary', scope, { query: branchQuery(branchId) }),
  get: (scope: ApiScope, id: string, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}`, scope, { query: branchQuery(branchId) }),
  lookupSerial: (scope: ApiScope, serial: string) =>
    apiRequest<SerialLookup>('/job-cards/lookup-serial', scope, { query: { serial } }),
  create: (scope: ApiScope, body: NewJobCardPayload) =>
    apiRequest<JobCard>('/job-cards', scope, { method: 'POST', body }),
  update: (scope: ApiScope, id: string, patch: JobCardPatch, branchId?: string) =>
    apiRequest<JobCard>(`/job-cards/${id}`, scope, { method: 'PATCH', body: patch, query: branchQuery(branchId) }),
  addPart: (scope: ApiScope, id: string, body: { productId: string; quantity: number; warehouseId?: string }, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/parts`, scope, { method: 'POST', body, query: branchQuery(branchId) }),
  removePart: (scope: ApiScope, id: string, partId: number, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/parts/${partId}`, scope, { method: 'DELETE', query: branchQuery(branchId) }),
  addService: (scope: ApiScope, id: string, body: { serviceId: string; cost?: number }, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/services`, scope, { method: 'POST', body, query: branchQuery(branchId) }),
  removeService: (scope: ApiScope, id: string, lineId: number, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/services/${lineId}`, scope, { method: 'DELETE', query: branchQuery(branchId) }),
  addPayment: (scope: ApiScope, id: string, body: { amount: number; method: PaymentMethod }, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/payments`, scope, { method: 'POST', body, query: branchQuery(branchId) }),
  setStatus: (scope: ApiScope, id: string, status: JobStatus, branchId?: string) =>
    apiRequest<JobCardDetail>(`/job-cards/${id}/status`, scope, { method: 'POST', body: { status }, query: branchQuery(branchId) })
};
