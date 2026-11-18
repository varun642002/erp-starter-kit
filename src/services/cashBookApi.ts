import { apiRequest, type ApiScope } from './apiClient';

export type CashEntryType = 'in' | 'out';

export interface CashEntry {
  id: string;
  branchId: string;
  entryDate: string;
  type: CashEntryType;
  category: string;
  amount: number;
  method: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CashClosing {
  id: string;
  branchId: string;
  businessDate: string;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  bankCardSales: number;
  creditSales: number;
  serviceCollections: number;
  manualCashIn: number;
  manualCashOut: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  notes: string | null;
  closedBy: string | null;
  closedAt: string;
}

export interface DaySummary {
  branchId: string;
  date: string;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  bankCardSales: number;
  creditSales: number;
  salesCount: number;
  serviceCollections: number;
  serviceCash: number;
  serviceUpi: number;
  serviceBank: number;
  manualCashIn: number;
  manualCashOut: number;
  manualOtherIn: number;
  manualOtherOut: number;
  expectedCash: number;
  entries: CashEntry[];
  isClosed: boolean;
  closing: CashClosing | null;
}

export interface BranchSummaryRow extends Omit<DaySummary, 'entries'> {
  branchName: string;
  countedCash: number | null;
  variance: number | null;
}

export interface AllBranchesSummary {
  date: string;
  rows: BranchSummaryRow[];
  totals: {
    openingCash: number;
    cashSales: number;
    upiSales: number;
    bankCardSales: number;
    creditSales: number;
    serviceCollections: number;
    manualCashIn: number;
    manualCashOut: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
    closedBranches: number;
    totalBranches: number;
  };
}

export interface NewCashEntry {
  branchId: string;
  date: string;
  type: CashEntryType;
  category: string;
  amount: number;
  method: string;
  description?: string;
  createdBy?: string;
}

export interface CashHandover {
  id: string;
  handoverNo: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  amount: number;
  handoverDate: string;
  receivedBy: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  status: 'Pending' | 'Received';
  receivedOn: string | null;
  confirmedBy: string | null;
}

export interface BranchCashInHand {
  branchId: string;
  branchName: string;
  isHeadOffice: boolean;
  lastClosedDate: string | null;
  lastCounted: number;
  movementSince: number;
  cashInHand: number;
  handedOverThisMonth: number;
  receivedThisMonth: number;
  onTheWayIn: number;
  onTheWayOut: number;
  openDaysSinceClose: number;
}

export const cashBookApi = {
  inHand: (scope: ApiScope, branchId?: string) => apiRequest<BranchCashInHand[]>('/cash-book/in-hand', scope, { query: { branch_id: branchId } }),
  handovers: (scope: ApiScope, branchId?: string, limit = 60) => apiRequest<CashHandover[]>('/cash-book/handovers', scope, { query: { branch_id: branchId, limit } }),
  createHandover: (scope: ApiScope, body: { fromBranchId?: string; toBranchId: string; amount: number; receivedBy?: string; note?: string }) =>
    apiRequest<{ handover: CashHandover; fromCashAfter: number; short: boolean }>('/cash-book/handovers', scope, { method: 'POST', body }),
  confirmHandover: (scope: ApiScope, id: string) => apiRequest<CashHandover>(`/cash-book/handovers/${encodeURIComponent(id)}/confirm`, scope, { method: 'POST', body: {} }),
  cancelHandover: (scope: ApiScope, id: string) => apiRequest<CashHandover>(`/cash-book/handovers/${encodeURIComponent(id)}`, scope, { method: 'DELETE' }),
  getSummary: (scope: ApiScope, branchId: string, date: string) =>
    apiRequest<DaySummary | AllBranchesSummary>('/cash-book/summary', scope, { query: { branch_id: branchId, date } }),
  addEntry: (scope: ApiScope, entry: NewCashEntry) =>
    apiRequest<CashEntry>('/cash-book/entries', scope, { method: 'POST', body: entry }),
  deleteEntry: (scope: ApiScope, id: string) =>
    apiRequest<{ success: boolean }>(`/cash-book/entries/${encodeURIComponent(id)}`, scope, { method: 'DELETE' }),
  closeDay: (scope: ApiScope, body: { branchId: string; date: string; countedCash: number; notes?: string; closedBy?: string }) =>
    apiRequest<CashClosing>('/cash-book/close', scope, { method: 'POST', body }),
  reopenDay: (scope: ApiScope, body: { branchId: string; date: string }) =>
    apiRequest<CashClosing>('/cash-book/reopen', scope, { method: 'POST', body }),
  listClosings: (scope: ApiScope, branchId: string, limit = 30) =>
    apiRequest<CashClosing[]>('/cash-book/closings', scope, { query: { branch_id: branchId, limit } })
};

export function isAllBranchesSummary(s: DaySummary | AllBranchesSummary): s is AllBranchesSummary {
  return Array.isArray((s as AllBranchesSummary).rows);
}
