import { useCallback, useEffect, useState } from 'react';
import { listCompaniesApi, type CompanyId, type CompanyProfile } from '../services/companyApi';
import { useApiScope } from '../components/documents/ui';

const blank = (id: CompanyId, displayName: string, sortOrder: number): CompanyProfile => ({
  id,
  displayName,
  legalName: displayName,
  tagline: '',
  addressLines: '',
  stateName: '',
  stateCode: '',
  phone: '',
  email: '',
  website: '',
  gstin: '',
  pan: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  bankBranch: '',
  upiId: '',
  signatoryLabel: '',
  taxInvoicePrefix: '',
  quotationPrefix: '',
  plainInvoicePrefix: '',
  sortOrder
});

// Names only, so company pickers and badges still render before the profiles load or if the request fails.
export const FALLBACK_COMPANIES: CompanyProfile[] = [
  blank('main', 'Main Company', 1),
  blank('second', 'Second Company', 2)
];

let cache: CompanyProfile[] | null = null;
let inflight: Promise<CompanyProfile[]> | null = null;
const listeners = new Set<(list: CompanyProfile[]) => void>();

const sorted = (list: CompanyProfile[]) => [...list].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));

function publish(list: CompanyProfile[]) {
  cache = sorted(list);
  listeners.forEach((fn) => fn(cache as CompanyProfile[]));
}

export function useCompanies() {
  const { scope } = useApiScope();
  const [companies, setCompanies] = useState<CompanyProfile[]>(cache ?? FALLBACK_COMPANIES);
  const [loading, setLoading] = useState(cache === null);

  const fetchList = useCallback(
    (force: boolean) => {
      if (!force && cache) return Promise.resolve(cache);
      if (!inflight || force) {
        inflight = listCompaniesApi(scope)
          .then((list) => {
            publish(list);
            return cache as CompanyProfile[];
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    [scope]
  );

  useEffect(() => {
    listeners.add(setCompanies);
    if (cache) setCompanies(cache);
    let alive = true;
    if (cache === null) {
      fetchList(false)
        .catch(() => undefined)
        .finally(() => alive && setLoading(false));
    }
    return () => {
      alive = false;
      listeners.delete(setCompanies);
    };
  }, [fetchList]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await fetchList(true);
    } catch {
      // keep whatever is cached
    } finally {
      setLoading(false);
    }
  }, [fetchList]);

  const getCompany = useCallback(
    (id: string | null | undefined): CompanyProfile =>
      companies.find((c) => c.id === id) ?? FALLBACK_COMPANIES.find((c) => c.id === id) ?? companies[0] ?? FALLBACK_COMPANIES[0],
    [companies]
  );

  return { companies, getCompany, reload, loading };
}

// Lets the company editor push saved profiles into every open picker.
export function setCompaniesCache(updated: CompanyProfile) {
  const base = cache ?? FALLBACK_COMPANIES;
  publish(base.some((c) => c.id === updated.id) ? base.map((c) => (c.id === updated.id ? updated : c)) : [...base, updated]);
}
