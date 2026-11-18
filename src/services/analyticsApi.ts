import { apiRequest, type ApiScope } from './apiClient';
// Shapes come straight from the server services (type-only imports, nothing from them is bundled)
import type { SeasonOutlook } from '../db/seasonService';
import type { Outlook, MachineStats } from '../db/analyticsOutlook';
import type { TrainedModel } from '../db/forecastModel';
import type { StockPlan } from '../db/analyticsPlan';
import type { CustomerInsights } from '../db/analyticsPeople';
import type { MoneyInsights } from '../db/analyticsMoney';
import type { CustomerRanking } from '../db/analyticsRanking';
export type { SeasonOutlook, StockPlan, CustomerInsights, MoneyInsights, CustomerRanking, Outlook, MachineStats, TrainedModel };

export interface WeekPoint {
  weekStart: string;
  total: number;
  forecast?: boolean;
  low?: number;
  high?: number;
}

export interface StockRisk {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  unit: string;
  perDay: number;
  perMonth: number;
  daysLeft: number;
  runOutDate: string | null;
  level: 'Out' | 'Critical' | 'Soon' | 'Watch';
  suggestQty: number;
  suggestLabel: string;
}

export interface Predictions {
  generatedAt: string;
  scope: string;
  sales: {
    basis: string;
    weeks: WeekPoint[];
    nextWeeks: WeekPoint[];
    next30Days: { low: number; expected: number; high: number };
    last4Weeks: number;
    prev4Weeks: number;
    trendPercent: number | null;
    busiestDay: { name: string; sharePercent: number } | null;
    enoughData: boolean;
    pace: { days: number; perDay: number; next30: { low: number; expected: number; high: number } } | null;
    season: {
      factor: number;
      withoutSeason30: number;
      reasons: string[];
      districts: { key: string; label: string; weightPercent: number; level: string; index: number; now: string[]; coming: string[]; outlook: string; rainSummary: string; rainReason: string }[];
      available: boolean;
    };
  };
  stock: { basis: string; risks: StockRisk[]; outCount: number; criticalCount: number };
  machines: {
    monthly: { month: string; delivered: number; value: number }[];
    avgPerMonth: number;
    avgBasis: 'full-months' | 'this-month' | 'none';
    pipeline: { status: string; count: number; value: number; balance: number }[];
    dueThisMonth: number;
  };
  collections: { overdue: number; dueNext30: number; overdueCount: number; dueNext30Count: number };
}

export const analyticsApi = {
  predictions: (scope: ApiScope, branchId?: string) =>
    apiRequest<Predictions>('/analytics/predictions', scope, { query: { branch_id: branchId } }),
  season: (scope: ApiScope, branchId?: string) => apiRequest<SeasonOutlook>('/analytics/season', scope, { query: { branch_id: branchId } }),
  stockPlan: (scope: ApiScope, branchId: string | undefined, lead: number, cover: number) =>
    apiRequest<StockPlan>('/analytics/stock-plan', scope, { query: { branch_id: branchId, lead, cover } }),
  customers: (scope: ApiScope, branchId?: string) => apiRequest<CustomerInsights>('/analytics/customers', scope, { query: { branch_id: branchId } }),
  money: (scope: ApiScope, branchId?: string) => apiRequest<MoneyInsights>('/analytics/money', scope, { query: { branch_id: branchId } }),
  customerRanking: (scope: ApiScope, branchId: string | undefined, quietDays: number) =>
    apiRequest<CustomerRanking>('/analytics/customer-ranking', scope, { query: { branch_id: branchId, quiet: quietDays } }),
  outlook: (scope: ApiScope, branchId?: string) => apiRequest<Outlook>('/analytics/outlook', scope, { query: { branch_id: branchId } }),
  machines: (scope: ApiScope, branchId?: string) => apiRequest<MachineStats>('/analytics/machines', scope, { query: { branch_id: branchId } }),
  model: (scope: ApiScope) => apiRequest<{ model: TrainedModel; retrained: boolean }>('/analytics/model', scope),
  trainModel: (scope: ApiScope) => apiRequest<{ model: TrainedModel; retrained: boolean }>('/analytics/model/train', scope, { method: 'POST' })
};
