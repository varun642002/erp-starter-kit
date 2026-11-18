import { authFetch } from './authFetch';

// Shared request helper for the SQL-backed /api routes used by the newer modules.

export interface ApiScope {
  role: string;
  branchId: string; // the signed-in user's own branch (used for non-owner scoping)
}

export async function apiRequest<T>(
  path: string,
  scope: ApiScope,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; query?: Record<string, string | number | undefined>; body?: unknown } = {}
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query || {})) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const res = await authFetch(`/api${path}${qs ? `?${qs}` : ''}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': scope.role,
      'x-branch-id': scope.branchId
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
