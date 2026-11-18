import { apiRequest, type ApiScope } from './apiClient';
// Shapes come straight from the server service (type-only import, nothing from it is bundled)
import type { ActivityRow } from '../db/activityLog';
import type { BackupStatus, BigDiscount, DeskToday, OrderLine, SupplierOrder, SupplierPayment } from '../db/deskService';
export type { ActivityRow };
export type { BackupStatus, BigDiscount, DeskToday, OrderLine, SupplierOrder, SupplierPayment };

export const deskApi = {
  today: (scope: ApiScope, branchId?: string) => apiRequest<DeskToday>('/desk/today', scope, { query: { branch_id: branchId } }),
  discounts: (scope: ApiScope, branchId: string | undefined, days: number, percent: number) =>
    apiRequest<{ days: number; percent: number; items: BigDiscount[] }>('/desk/discounts', scope, { query: { branch_id: branchId, days, percent } }),
  activity: (scope: ApiScope, branchId: string | undefined, days: number, q: string) =>
    apiRequest<ActivityRow[]>('/desk/activity', scope, { query: { branch_id: branchId, days, q: q || undefined, limit: 300 } }),
  backups: (scope: ApiScope) => apiRequest<BackupStatus>('/desk/backups', scope),
  orders: (scope: ApiScope, branchId?: string, status?: string) => apiRequest<SupplierOrder[]>('/desk/orders', scope, { query: { branch_id: branchId, status } }),
  createOrder: (scope: ApiScope, body: { supplierName: string; supplierPhone?: string | null; branchId?: string; expectedDate?: string; note?: string; lines: OrderLine[] }) =>
    apiRequest<SupplierOrder>('/desk/orders', scope, { method: 'POST', body }),
  supplierPayments: (scope: ApiScope, supplierId?: string) => apiRequest<SupplierPayment[]>('/desk/supplier-payments', scope, { query: { supplier_id: supplierId } }),
  paySupplier: (scope: ApiScope, body: { supplierId: string; supplierName: string; amount: number; method: string; branchId?: string; reference?: string; note?: string }) =>
    apiRequest<SupplierPayment>('/desk/supplier-payments', scope, { method: 'POST', body }),
  cancelSupplierPayment: (scope: ApiScope, id: string) => apiRequest<SupplierPayment>(`/desk/supplier-payments/${encodeURIComponent(id)}`, scope, { method: 'DELETE' }),
  setOrderStatus: (scope: ApiScope, id: string, status: 'Ordered' | 'Received' | 'Cancelled') =>
    apiRequest<SupplierOrder>(`/desk/orders/${encodeURIComponent(id)}`, scope, { method: 'PATCH', body: { status } })
};
