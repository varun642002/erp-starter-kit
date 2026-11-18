import { apiRequest, type ApiScope } from './apiClient';

export interface PurchaseLine {
  sourceType: 'sale' | 'invoice';
  sourceId: string;
  lineId: string;
  number: string;
  date: string;
  branchId: string | null;
  branchName: string | null;
  customerKey: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  unitFactor: number;
  quantity: number;
  returned: number;
  remaining: number;
  unitValue: number;
  stockTracked: boolean;
  billBalance: number;
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  returnDate: string;
  branchId: string | null;
  branchName: string | null;
  customerName: string;
  customerPhone: string | null;
  sourceType: string;
  sourceNumber: string;
  productId: string;
  productName: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  stockQuantity: number;
  refundValue: number;
  condition: 'Not damaged' | 'Damaged';
  reason: string | null;
  restocked: boolean;
  damageStatus: 'Held' | 'Sent to supplier' | 'Repaired' | 'Scrapped';
  damageNote: string | null;
  balanceReduced: number;
  creditAdded: number;
  cashRefunded: number;
  refundMethod: string | null;
  stockNote: string | null;
  processedBy: string | null;
  createdAt: string;
}

export interface NewReturn {
  sourceType: 'sale' | 'invoice';
  sourceId: string;
  lineId: string;
  quantity: number;
  condition: 'Not damaged' | 'Damaged';
  reason?: string;
  settlement?: 'credit' | 'refund';
  refundMethod?: 'Cash' | 'UPI' | 'Bank Transfer';
}

export interface CreditBalance {
  customerKey: string;
  customerName: string;
  customerPhone: string | null;
  balance: number;
}

export interface OpenInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  branchId: string;
  total: number;
  balance: number;
}

export const returnApi = {
  purchases: (scope: ApiScope, o: { branchId?: string; q?: string }) => apiRequest<PurchaseLine[]>('/returns/purchases', scope, { query: { branch_id: o.branchId, q: o.q, limit: 300 } }),
  list: (scope: ApiScope, o: { branchId?: string; q?: string; condition?: 'Damaged' | 'Not damaged' }) => apiRequest<ReturnRecord[]>('/returns', scope, { query: { branch_id: o.branchId, q: o.q, condition: o.condition } }),
  create: (scope: ApiScope, body: NewReturn) => apiRequest<ReturnRecord>('/returns', scope, { method: 'POST', body }),
  credits: (scope: ApiScope) => apiRequest<CreditBalance[]>('/returns/credits', scope),
  openInvoices: (scope: ApiScope, customerKey: string, branchId?: string) =>
    apiRequest<OpenInvoice[]>('/returns/credits/invoices', scope, { query: { customer_key: customerKey, branch_id: branchId } }),
  applyCredit: (scope: ApiScope, body: { customerKey: string; documentId: string; amount: number }) =>
    apiRequest<{ balance: number; invoice: OpenInvoice | null }>('/returns/credits/apply', scope, { method: 'POST', body }),
  markDamaged: (scope: ApiScope, id: string, body: { status: 'Sent to supplier' | 'Repaired' | 'Scrapped'; note?: string }) =>
    apiRequest<ReturnRecord>(`/returns/${encodeURIComponent(id)}/damage`, scope, { method: 'PATCH', body })
};
