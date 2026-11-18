import { apiRequest, ApiScope } from './apiClient';
import { GoodsReceivedNote, StockTransfer, StockAdjustment } from '../types/erp';

// Client for the Postgres-backed stock endpoints. The server owns all stock quantities.

export interface StockReceiptInput {
  supplierId: string;
  supplierInvoiceNumber?: string;
  challanNumber: string;
  receivedDate?: string;
  receivedBy: string;
  verifiedBy: string;
  qualityStatus: GoodsReceivedNote['qualityStatus'];
  notes?: string;
  items: { productId: string; receivedQuantity: number; damagedQuantity: number; rate?: number; notes?: string }[];
}

export interface StockTransferInput {
  toBranchId: string;
  toWarehouseId?: string;
  notes?: string;
  items: { productId: string; requestedQty: number }[];
}

export interface DispatchDetails {
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
}

export interface ReceiveItemInput {
  productId: string;
  receivedQty: number;
  damagedQty?: number;
}

export interface StockAdjustmentInput {
  warehouseId: string;
  productId: string;
  adjustmentType: 'Increase' | 'Decrease' | 'Recount';
  quantity: number;
  reason: string;
}

export interface StockMovementRow {
  id: string;
  productId: string;
  productName: string;
  warehouseId: string;
  branchId: string;
  type: string;
  availableDelta: number;
  reservedDelta: number;
  inTransitDelta: number;
  balanceAfter: number;
  refType: string;
  refId: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export function createReceiptApi(scope: ApiScope, body: StockReceiptInput) {
  return apiRequest<GoodsReceivedNote>('/stock/receipts', scope, { method: 'POST', body });
}

export function listReceiptsApi(scope: ApiScope, query: { q?: string; from?: string; to?: string } = {}) {
  return apiRequest<GoodsReceivedNote[]>('/stock/receipts', scope, { query });
}

export function createTransferApi(scope: ApiScope, body: StockTransferInput) {
  return apiRequest<StockTransfer>('/stock/transfers', scope, { method: 'POST', body });
}

export function listTransfersApi(scope: ApiScope, query: { branch_id?: string; status?: string } = {}) {
  return apiRequest<StockTransfer[]>('/stock/transfers', scope, { query });
}

export function approveTransferApi(scope: ApiScope, id: string) {
  return apiRequest<StockTransfer>(`/stock/transfers/${encodeURIComponent(id)}/approve`, scope, { method: 'POST', body: {} });
}

export function dispatchTransferApi(scope: ApiScope, id: string, details: DispatchDetails = {}) {
  return apiRequest<StockTransfer>(`/stock/transfers/${encodeURIComponent(id)}/dispatch`, scope, { method: 'POST', body: details });
}

export function receiveTransferApi(scope: ApiScope, id: string, items: ReceiveItemInput[]) {
  return apiRequest<StockTransfer>(`/stock/transfers/${encodeURIComponent(id)}/receive`, scope, { method: 'POST', body: { items } });
}

export function cancelTransferApi(scope: ApiScope, id: string) {
  return apiRequest<StockTransfer>(`/stock/transfers/${encodeURIComponent(id)}/cancel`, scope, { method: 'POST', body: {} });
}

export function createAdjustmentApi(scope: ApiScope, body: StockAdjustmentInput) {
  return apiRequest<StockAdjustment>('/stock/adjustments', scope, { method: 'POST', body });
}

export interface StockAdjustmentBatchResult {
  done: string[];
  failed: { productId: string; error: string }[];
}

export function createAdjustmentsBatchApi(
  scope: ApiScope,
  body: {
    warehouseId: string;
    reason: string;
    items: { productId: string; adjustmentType: 'Increase' | 'Decrease' | 'Recount'; quantity: number }[];
  }
) {
  return apiRequest<StockAdjustmentBatchResult>('/stock/adjustments/batch', scope, { method: 'POST', body });
}

export function listAdjustmentsApi(scope: ApiScope, query: { warehouse_id?: string; product_id?: string } = {}) {
  return apiRequest<StockAdjustment[]>('/stock/adjustments', scope, { query });
}

export function listMovementsApi(
  scope: ApiScope,
  query: { product_id?: string; warehouse_id?: string; from?: string; to?: string; limit?: number } = {}
) {
  return apiRequest<StockMovementRow[]>('/stock/movements', scope, { query });
}

// UI-side mirrors of the server's permission checks (the server stays the authority).
export const HEAD_BRANCH_ID = 'branch-1';
export const HEAD_WAREHOUSE_ID = 'wh-1';
const OWNER_ROLES = ['Business Owner', 'Super Admin'];
const HEAD_OFFICE_ROLES = ['Warehouse Manager', 'Warehouse Staff', 'Branch Manager'];
const BRANCH_STOCK_ROLES = ['Branch Manager', 'Branch Person', 'Warehouse Manager', 'Warehouse Staff'];

export const canManageHeadOfficeStock = (role: string, branchId: string) =>
  OWNER_ROLES.includes(role) || (branchId === HEAD_BRANCH_ID && HEAD_OFFICE_ROLES.includes(role));

export const canActOnBranchStock = (role: string, branchId: string, targetBranchId: string) =>
  OWNER_ROLES.includes(role) || (!!targetBranchId && branchId === targetBranchId && BRANCH_STOCK_ROLES.includes(role));

export interface OpeningStockRowInput {
  sku: string;
  quantity: number | string;
  warehouse?: string;
  rack?: string;
  row?: string;
  shelf?: string;
  bin?: string;
}

export interface OpeningStockRowResult {
  rowNumber: number;
  sku: string;
  productName?: string;
  warehouseId?: string;
  current?: number;
  next?: number;
  error?: string;
}

export interface OpeningStockResult {
  applied: boolean;
  mode: 'set' | 'add' | 'remove';
  total: number;
  errors: number;
  changed: number;
  rows: OpeningStockRowResult[];
}

export function importOpeningStockApi(
  scope: ApiScope,
  body: {
    rows: OpeningStockRowInput[];
    mode: 'set' | 'add' | 'remove';
    dryRun: boolean;
    kind?: 'opening' | 'update';
    reason?: string;
  }
) {
  return apiRequest<OpeningStockResult>('/stock/opening-import', scope, { method: 'POST', body });
}

export interface DirectAddInput {
  warehouseId: string;
  reference?: string;
  note?: string;
  items: { productId: string; quantity: number }[];
}

export function addStockDirectApi(scope: ApiScope, body: DirectAddInput) {
  return apiRequest<{ ok: boolean; warehouseId: string; items: number; units: number }>('/stock/direct-add', scope, {
    method: 'POST',
    body
  });
}
