import { apiRequest, type ApiScope } from './apiClient';

export type PayType = 'monthly' | 'daily';
export type RunStatus = 'Draft' | 'Finalized';
export type SlipStatus = 'Unpaid' | 'Paid';
export type PaymentMethod = 'Cash' | 'UPI' | 'Bank Transfer' | 'Card';
export type AdvanceMethod = PaymentMethod | 'Cheque';

export interface PayrollRun {
  id: string;
  branchId: string;
  month: string;
  status: RunStatus;
  createdBy: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

export interface RunTotals {
  staffCount: number;
  paidCount: number;
  gross: number;
  net: number;
  paid: number;
  unpaid: number;
}

export type PayrollRunListItem = PayrollRun & RunTotals;

export interface Payslip {
  id: string;
  runId: string;
  staffId: string;
  staffName: string;
  designation: string | null;
  payType: PayType;
  baseRate: number;
  daysInMonth: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  unpaidDays: number;
  unmarkedDays: number;
  overtimeHours: number;
  basicPay: number;
  overtimePay: number;
  bonus: number;
  otherDeductions: number;
  advanceRecovered: number;
  grossPay: number;
  netPay: number;
  notes: string | null;
  status: SlipStatus;
  paidOn: string | null;
  paymentMethod: string | null;
  createdAt: string;
  payableDays: number;
  advanceBalance: number;
  hasUnmarkedDays: boolean;
}

export interface PayrollRunDetail {
  run: PayrollRun;
  payslips: Payslip[];
  totals: RunTotals;
  warnings: { unmarkedSlips: number; unmarkedDays: number; messages: string[] };
}

export interface SalaryAdvance {
  id: string;
  staffId: string;
  staffName: string;
  branchId: string;
  amount: number;
  recoveredAmount: number;
  balance: number;
  givenOn: string;
  method: string;
  reason: string | null;
  status: 'Open' | 'Recovered';
  createdBy: string | null;
  createdAt: string;
}

export interface PayrollSummary {
  month: string;
  branchId: string;
  runCount: number;
  runStatus: RunStatus | 'Mixed' | null;
  staffCount: number;
  gross: number;
  net: number;
  paid: number;
  unpaid: number;
  advancesOutstanding: number;
  openAdvanceCount: number;
}

export interface PayslipPatch {
  bonus?: number;
  otherDeductions?: number;
  advanceRecovered?: number;
  notes?: string;
}

export interface NewAdvance {
  branchId: string;
  staffId: string;
  amount: number;
  method: AdvanceMethod;
  reason?: string;
  givenOn?: string;
  createdBy?: string;
}

export interface StaffOption {
  id: string;
  name: string;
  designation?: string | null;
}

export const payrollApi = {
  generate: (scope: ApiScope, body: { branchId: string; month: string; createdBy?: string }) =>
    apiRequest<PayrollRunDetail>('/payroll/generate', scope, { method: 'POST', body }),
  listRuns: (scope: ApiScope, branchId: string, month?: string) =>
    apiRequest<PayrollRunListItem[]>('/payroll/runs', scope, { query: { branch_id: branchId, month } }),
  getRun: (scope: ApiScope, id: string) =>
    apiRequest<PayrollRunDetail>(`/payroll/runs/${encodeURIComponent(id)}`, scope),
  updatePayslip: (scope: ApiScope, id: string, patch: PayslipPatch) =>
    apiRequest<PayrollRunDetail>(`/payroll/payslips/${encodeURIComponent(id)}`, scope, { method: 'PATCH', body: patch }),
  finalize: (scope: ApiScope, id: string) =>
    apiRequest<PayrollRunDetail>(`/payroll/runs/${encodeURIComponent(id)}/finalize`, scope, { method: 'POST', body: {} }),
  paySlip: (scope: ApiScope, id: string, body: { method: PaymentMethod; paidOn?: string; createdBy?: string }) =>
    apiRequest<PayrollRunDetail>(`/payroll/payslips/${encodeURIComponent(id)}/pay`, scope, { method: 'POST', body }),
  settleSlip: (scope: ApiScope, id: string, body: { method: PaymentMethod; paidOn?: string; createdBy?: string }) =>
    apiRequest<PayrollRunDetail>(`/payroll/payslips/${encodeURIComponent(id)}/settle`, scope, { method: 'POST', body }),
  listAdvances: (scope: ApiScope, branchId: string, filters: { staffId?: string; status?: string } = {}) =>
    apiRequest<SalaryAdvance[]>('/payroll/advances', scope, { query: { branch_id: branchId, ...filters } }),
  createAdvance: (scope: ApiScope, body: NewAdvance) =>
    apiRequest<SalaryAdvance>('/payroll/advances', scope, { method: 'POST', body }),
  deleteAdvance: (scope: ApiScope, id: string) =>
    apiRequest<{ id: string; staffName: string; amount: number }>(`/payroll/advances/${encodeURIComponent(id)}`, scope, { method: 'DELETE' }),
  getSummary: (scope: ApiScope, branchId: string, month: string) =>
    apiRequest<PayrollSummary>('/payroll/summary', scope, { query: { branch_id: branchId, month } }),
  // The roster belongs to the staff module; its response shape is read leniently.
  listStaff: async (scope: ApiScope, branchId: string): Promise<StaffOption[]> => {
    const res = await apiRequest<unknown>('/staff', scope, { query: { branch_id: branchId } });
    const list = Array.isArray(res) ? res : Array.isArray((res as any)?.staff) ? (res as any).staff : [];
    return (list as any[])
      .filter((s) => s && s.id && s.name && (!s.status || s.status === 'Active'))
      .map((s) => ({ id: String(s.id), name: String(s.name), designation: s.designation ?? null }));
  }
};
