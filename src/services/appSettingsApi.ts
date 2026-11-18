import { apiRequest, type ApiScope } from './apiClient';

export interface AppSettings {
  branchPersonStockEdit: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const getAppSettings = (scope: ApiScope) => apiRequest<AppSettings>('/app-settings', scope);

export const saveAppSettings = (scope: ApiScope, patch: { branchPersonStockEdit: boolean }) =>
  apiRequest<AppSettings>('/app-settings', scope, { method: 'PUT', body: patch });
