import type { Request } from 'express';

// Extract role and branch authorization context from request headers.
export function getAuthContext(req: Request) {
  // Verified identity (set by requireAuth) always wins over client-supplied headers.
  if (req.auth) {
    const { role, branchId } = req.auth;
    return { role, branchId, isOwner: role === 'Business Owner' || role === 'Super Admin' };
  }
  const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'Business Owner';
  const branchId = (req.headers['x-branch-id'] as string) || (req.query.branch_id as string) || 'branch-1';
  const isOwner = role === 'Business Owner' || role === 'Super Admin';
  return { role, branchId, isOwner };
}

// Branch a request is allowed to see: owners may pick any branch (or 'all'),
// everyone else is pinned to their own branch.
export function scopedBranch(req: Request): string {
  const { isOwner, branchId } = getAuthContext(req);
  if (!isOwner) return branchId;
  const requested = (req.query.branch_id as string) || 'all';
  return requested;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Business date (YYYY-MM-DD) in India Standard Time.
export function businessDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return businessDate(d);
}

// Name recorded on audit fields: the verified sign-in email when present, otherwise the client's value.
export function actorName(req: Request, claimed?: unknown, fallback = ''): string {
  if (req.auth?.email) return req.auth.email;
  return typeof claimed === 'string' && claimed ? claimed.slice(0, 100) : fallback;
}
