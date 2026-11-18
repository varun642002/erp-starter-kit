import { apiRequest, type ApiScope } from './apiClient';
import type { ServiceItem } from '../db/serviceCatalog';
export type { ServiceItem };

export interface ServiceInput {
  name: string;
  machineType?: string;
  cost: number;
  notes?: string;
  active?: boolean;
}

export const serviceCatalogApi = {
  list: (scope: ApiScope) => apiRequest<ServiceItem[]>('/services', scope),
  create: (scope: ApiScope, body: ServiceInput) => apiRequest<ServiceItem>('/services', scope, { method: 'POST', body }),
  update: (scope: ApiScope, id: string, body: Partial<ServiceInput>) => apiRequest<ServiceItem>(`/services/${encodeURIComponent(id)}`, scope, { method: 'PATCH', body }),
  remove: (scope: ApiScope, id: string) => apiRequest<{ ok: true }>(`/services/${encodeURIComponent(id)}`, scope, { method: 'DELETE' })
};
