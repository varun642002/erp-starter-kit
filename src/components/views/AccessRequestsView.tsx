import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { AlertCircle, Check, ShieldCheck, UserPlus } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth, UserProfile } from '../../context/AuthContext';
import { useERP } from '../../context/ERPContext';
import { UserAccessPanel } from '../auth/UserAccessPanel';
import { Role } from '../../types/erp';

const ROLES: Role[] = [
  'Business Owner',
  'Branch Manager',
  'Branch Person',
  'Accountant',
  'Sales Manager',
  'Salesperson',
  'Purchase Manager',
  'Warehouse Manager',
  'Warehouse Staff',
  'Cashier',
  'Super Admin'
];

const selectClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

interface Draft {
  role: Role;
  branchId: string;
}

function requestedOn(createdAt: any): string {
  const d: Date | null = createdAt?.toDate ? createdAt.toDate() : null;
  return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
}

export const AccessRequestsView: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const { branches, showToast, addAuditLog } = useERP();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [pending, setPending] = useState<UserProfile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const q = query(collection(db, 'users'), where('approved', '==', false));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserProfile);
        list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        setPending(list);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const u of list) next[u.uid] = next[u.uid] || { role: 'Salesperson', branchId: 'branch-1' };
          return next;
        });
        setError(null);
        setLoading(false);
      },
      (e) => {
        console.error('Access requests listener failed:', e);
        setError('Could not load access requests. Only an approved Super Admin can view them.');
        setLoading(false);
      }
    );
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
        <h1 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Access Restricted</h1>
        <p className="mt-1 text-xs text-slate-500">Only a Super Admin can review access requests.</p>
      </div>
    );
  }

  const approve = async (u: UserProfile) => {
    const d = drafts[u.uid];
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, 'users', u.uid), { role: d.role, branchId: d.branchId, approved: true });
      addAuditLog('Access Approved', 'Staff & RBAC', `${u.email} approved as ${d.role} (${d.branchId})`);
      showToast('Access approved', `${u.email} can now sign in as ${d.role}.`, 'success');
    } catch (e) {
      console.error('Approve failed:', e);
      showToast('Approval failed', 'You may not have permission to approve this user.', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Access Requests</h1>
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {pending.length} waiting
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          People who create an account need your approval before they can use the ERP. Choose their role and branch, then approve.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:w-fit">
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={`rounded-md px-3 py-1.5 ${tab === 'pending' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
        >
          Pending requests ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`rounded-md px-3 py-1.5 ${tab === 'all' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
        >
          All users and roles
        </button>
      </div>

      {tab === 'pending' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          {error && (
            <div className="m-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {loading && <p className="p-6 text-center text-xs text-slate-400">Loading requests...</p>}
          {!loading && !error && pending.length === 0 && (
            <div className="p-10 text-center">
              <UserPlus className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">No pending requests</p>
              <p className="text-xs text-slate-500">New sign-ups will show up here automatically.</p>
            </div>
          )}
          {pending.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Person</th>
                    <th className="px-4 py-2.5">Requested</th>
                    <th className="w-48 px-4 py-2.5">Role</th>
                    <th className="w-48 px-4 py-2.5">Branch</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pending.map((u) => {
                    const d = drafts[u.uid] || { role: 'Salesperson' as Role, branchId: 'branch-1' };
                    return (
                      <tr key={u.uid} className="align-middle hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
                              {(u.displayName || u.email || 'U')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900 dark:text-white">{u.displayName || '-'}</p>
                              <p className="truncate text-[11px] text-slate-500">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{requestedOn(u.createdAt)}</td>
                        <td className="px-4 py-3">
                          <select
                            className={selectClass}
                            value={d.role}
                            onChange={(e) => setDrafts((p) => ({ ...p, [u.uid]: { ...d, role: e.target.value as Role } }))}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className={selectClass}
                            value={d.branchId}
                            onChange={(e) => setDrafts((p) => ({ ...p, [u.uid]: { ...d, branchId: e.target.value } }))}
                          >
                            <option value="all">All branches</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => approve(u)}
                            disabled={busyUid === u.uid}
                            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {busyUid === u.uid ? 'Approving...' : 'Approve'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'all' && <UserAccessPanel />}
    </div>
  );
};
