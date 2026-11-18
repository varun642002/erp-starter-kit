import { apiRequest, type ApiScope } from './apiClient';

export const VOUCHER_TYPES = ['Sale', 'Invoice', 'Receipt', 'Service Receipt', 'Expense', 'Salary', 'Cash In', 'Cash Out'] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
export const LEDGER_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;
export const EXPENSE_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'] as const;
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Transport',
  'Fuel',
  'Repairs & maintenance',
  'Office supplies',
  'Telephone & internet',
  'Tea & refreshments',
  'Marketing',
  'Taxes & fees',
  'Insurance',
  'Other'
] as const;

export interface DateRange {
  from: string;
  to: string;
}

export interface DaybookRow {
  ref: string;
  date: string;
  branchId: string | null;
  type: VoucherType;
  number: string;
  party: string;
  description: string;
  method: string;
  debit: number;
  credit: number;
  balance: number;
  onAccount: boolean;
}

export interface Daybook {
  from: string;
  to: string;
  branch: string;
  rows: DaybookRow[];
  truncated: boolean;
  totals: { count: number; debit: number; credit: number; moneyIn: number; moneyOut: number; net: number };
}

export interface CashBankLine {
  ref: string;
  date: string;
  branchId: string | null;
  type: VoucherType;
  number: string;
  party: string;
  description: string;
  receipt: number;
  payment: number;
  balance: number;
}

export interface CashBankMethod {
  method: string;
  opening: number;
  receipts: number;
  payments: number;
  closing: number;
  count: number;
  lines: CashBankLine[];
  truncated: boolean;
}

export interface CashBank {
  from: string;
  to: string;
  branch: string;
  methods: CashBankMethod[];
  totals: { opening: number; receipts: number; payments: number; closing: number };
}

export interface Ageing {
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
}

export interface OpenInvoice {
  number: string;
  dueDate: string | null;
  balance: number;
}

export interface CustomerBalance {
  key: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  branchIds: string[];
  invoiceCount: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
  ageing: Ageing;
  openInvoices: OpenInvoice[];
}

export interface CustomerBalances {
  asOf: string;
  branch: string;
  customers: CustomerBalance[];
  totals: { count: number; outstanding: number; overdue: number } & Ageing;
}

export interface StatementLine {
  date: string;
  type: 'Invoice' | 'Receipt';
  number: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  from: string;
  to: string;
  asOf: string;
  customer: { key: string; customerId: string | null; name: string; phone: string | null; branchIds: string[] };
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingOutstanding: number;
  outstandingToday: number;
  ageing: Ageing;
  openInvoices: OpenInvoice[];
  lines: StatementLine[];
}

export interface ExpenseRow {
  id: string;
  branchId: string;
  date: string;
  category: string;
  vendor: string;
  description: string;
  method: string;
  amount: number;
  createdBy: string | null;
  deletable: boolean;
}

export interface ExpenseList {
  from: string;
  to: string;
  branch: string;
  rows: ExpenseRow[];
  total: number;
  byCategory: { category: string; amount: number }[];
  categories: string[];
}

export interface NewExpense {
  branchId: string;
  date: string;
  category: string;
  vendor: string;
  amount: number;
  method: string;
  description: string;
  createdBy?: string;
}

export interface PnlBranchRow {
  branchId: string;
  branchName: string;
  quickSales: number;
  gstInvoices: number;
  service: number;
  income: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  branch: string;
  income: { quickSales: number; gstInvoices: number; service: number; total: number };
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  expenses: { lines: { label: string; group: 'Expense' | 'Salary' | 'Other'; amount: number }[]; total: number };
  netProfit: number;
  byBranch: PnlBranchRow[];
}

export interface PeriodFigures {
  sales: number;
  collections: number;
  expenses: number;
}

export interface LedgerSummary {
  branch: string;
  today: string;
  monthStart: string;
  day: PeriodFigures;
  month: PeriodFigures;
  receivables: { outstanding: number; overdue: number; openInvoices: number };
}

// branch is 'all' or a branch id for owners and undefined for everyone else (the server pins them).
const branchQuery = (branch: string | undefined) => (branch ? { branch_id: branch } : {});

export const ledgerApi = {
  daybook: (scope: ApiScope, branch: string | undefined, range: DateRange, opts: { q?: string; types?: string[] } = {}) =>
    apiRequest<Daybook>('/ledger/daybook', scope, {
      query: { ...branchQuery(branch), ...range, q: opts.q, type: opts.types?.length ? opts.types.join(',') : undefined }
    }),
  cashBank: (scope: ApiScope, branch: string | undefined, range: DateRange) =>
    apiRequest<CashBank>('/ledger/cashbank', scope, { query: { ...branchQuery(branch), ...range } }),
  customers: (scope: ApiScope, branch: string | undefined, q?: string) =>
    apiRequest<CustomerBalances>('/ledger/customers', scope, { query: { ...branchQuery(branch), q } }),
  statement: (scope: ApiScope, branch: string | undefined, customerKey: string, range: DateRange) =>
    apiRequest<CustomerStatement>(`/ledger/customers/${encodeURIComponent(customerKey)}`, scope, {
      query: { ...branchQuery(branch), ...range }
    }),
  expenses: (scope: ApiScope, branch: string | undefined, range: DateRange, category?: string) =>
    apiRequest<ExpenseList>('/ledger/expenses', scope, { query: { ...branchQuery(branch), ...range, category } }),
  addExpense: (scope: ApiScope, body: NewExpense) =>
    apiRequest<ExpenseRow>('/ledger/expenses', scope, { method: 'POST', body }),
  // Owner only. Without confirm it only reports what would be removed.
  clearExpenses: (scope: ApiScope, branch: string | undefined, confirm?: 'DELETE') =>
    apiRequest<{ count: number; total: number; first: string | null; last: string | null; deleted: number }>('/ledger/expenses/clear', scope, {
      method: 'POST',
      query: { ...branchQuery(branch) },
      body: confirm ? { confirm } : {}
    }),
  deleteExpense: (scope: ApiScope, id: string) =>
    apiRequest<{ success: boolean }>(`/ledger/expenses/${encodeURIComponent(id)}`, scope, { method: 'DELETE' }),
  pnl: (scope: ApiScope, branch: string | undefined, range: DateRange) =>
    apiRequest<ProfitLoss>('/ledger/pnl', scope, { query: { ...branchQuery(branch), ...range } }),
  summary: (scope: ApiScope, branch: string | undefined) =>
    apiRequest<LedgerSummary>('/ledger/summary', scope, { query: branchQuery(branch) })
};
