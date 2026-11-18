import { apiRequest, type ApiScope } from './apiClient';

export type CompanyId = 'main' | 'second';

export interface CompanyProfile {
  id: CompanyId;
  displayName: string;
  legalName: string;
  tagline: string;
  addressLines: string;
  stateName: string;
  stateCode: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  pan: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  bankBranch: string;
  upiId: string;
  signatoryLabel: string;
  taxInvoicePrefix: string;
  quotationPrefix: string;
  plainInvoicePrefix: string;
  sortOrder: string | number;
}

export type CompanyPatch = Partial<Omit<CompanyProfile, 'id' | 'sortOrder'>>;

export const listCompaniesApi = (scope: ApiScope) => apiRequest<CompanyProfile[]>('/companies', scope);

export const updateCompanyApi = (scope: ApiScope, id: CompanyId, patch: CompanyPatch) =>
  apiRequest<CompanyProfile>(`/companies/${id}`, scope, { method: 'PUT', body: patch });
