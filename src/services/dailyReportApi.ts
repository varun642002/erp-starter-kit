import { apiRequest, type ApiScope } from './apiClient';
import type { DailyReport, DailyReportSettings, SendOutcome } from '../db/dailyReport';
export type { DailyReport, DailyReportSettings, SendOutcome };

export interface DailyReportStatus {
  configured: boolean;
  missing: string[];
  templateName: string;
  templateLanguage: string;
  triggerConfigured: boolean;
}

export const dailyReportApi = {
  get: (scope: ApiScope, date?: string) => apiRequest<{ report: DailyReport; text: string; settings: DailyReportSettings; status: DailyReportStatus }>('/daily-report', scope, { query: { date } }),
  save: (scope: ApiScope, body: { phones?: string[]; enabled?: boolean }) => apiRequest<DailyReportSettings>('/daily-report/settings', scope, { method: 'PUT', body }),
  send: (scope: ApiScope, date: string, force: boolean) => apiRequest<{ date: string; results: SendOutcome[]; text: string }>('/daily-report/send', scope, { method: 'POST', body: { date, force } })
};
