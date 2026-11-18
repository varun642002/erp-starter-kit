import { apiRequest, type ApiScope } from './apiClient';

export interface QuickSaleItem {
  id: number;
  saleId: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  quantity: number; // counted in `unit`
  unit: string | null; // Piece, Box or Kg
  unitFactor: number; // how many of the product's own unit one `unit` holds
  unitPrice: number;
  discount: number;
  gst: number;
  lineTotal: number;
  hsnCode: string | null;
}

export interface QuickSaleRecord {
  id: string;
  saleNumber: string;
  createdAt: string;
  branchId: string | null;
  branchName: string | null;
  createdBy: string | null;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerAlternatePhone: string | null;
  customerCode: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod: string;
  secondaryPaymentMethod: string | null;
  secondaryPaymentAmount: number;
  paymentStatus: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  items: QuickSaleItem[];
}

export interface QuickSaleEdit {
  customerName?: string;
  customerId?: string;
  paymentMethod?: string;
  secondaryPaymentMethod?: string | null; // empty clears it
  secondaryPaymentAmount?: number;
  discount?: number;
  saleDate?: string; // YYYY-MM-DD
  items: {
    productId: string | null;
    productName: string;
    sku?: string | null;
    serialNumber?: string | null;
    hsnCode?: string | null;
    unit?: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
  }[];
}

export interface QuickSaleSummary {
  count: number;
  total: number;
  collected: number;
  byBranch: { branchId: string | null; count: number; total: number; collected: number }[];
}

export const quickSaleApi = {
  summary: (scope: ApiScope, branchId?: string) =>
    apiRequest<QuickSaleSummary>('/quick-sales/summary', scope, { query: { branch_id: branchId } }),
  list: (scope: ApiScope, o: { branchId?: string; q?: string; customerId?: string; from?: string; to?: string; limit?: number }) =>
    apiRequest<QuickSaleRecord[]>('/quick-sales', scope, {
      query: { branch_id: o.branchId, q: o.q, customer_id: o.customerId, from: o.from, to: o.to, limit: o.limit }
    }),
  update: (scope: ApiScope, id: string, body: QuickSaleEdit) =>
    apiRequest<QuickSaleRecord>(`/quick-sales/${encodeURIComponent(id)}`, scope, { method: 'PUT', body }),
  remove: (scope: ApiScope, id: string) =>
    apiRequest<{ id: string; saleNumber: string; invoiceIds: string[] }>(`/quick-sales/${encodeURIComponent(id)}`, scope, {
      method: 'DELETE'
    })
};
