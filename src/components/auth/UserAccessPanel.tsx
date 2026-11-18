import React, { useEffect, useState } from 'react';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { UserCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth, UserProfile } from '../../context/AuthContext';
import { useERP } from '../../context/ERPContext';
import { Role } from '../../types/erp';

const ROLES: Role[] = [
  'Super Admin',
  'Business Owner',
  'Branch Person',
  'Branch Manager',
  'Accountant',
  'Sales Manager',
  'Salesperson',
  'Purchase Manager',
  'Warehouse Manager',
  'Warehouse Staff',
  'Cashier'
];

interface Draft {
  role: Role;
  branchId: string;
  approved: boolean;
}

const selectClass =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export const UserAccessPanel: React.FC = () => {
  const { firebaseUser } = useAuth();
  const { branches, showToast, addAuditLog } = useERP();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map((d) => d.data() as UserProfile);
      list.sort((a, b) => Number(a.approved) - Number(b.approved) || (a.email || '').localeCompare(b.email || ''));
      setUsers(list);
      setDrafts(
        Object.fromEntries(list.map((u) => [u.uid, { role: u.role, branchId: u.branchId, approved: u.approved }]))
      );
    } catch (e: any) {
      console.error('Failed to load users:', e);
      setError('Could not load users. Only an approved Super Admin can manage access.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (uid: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [uid]: { ...prev[uid], ...patch } }));

  const save = async (u: UserProfile) => {
    const d = drafts[u.uid];
    setSavingUid(u.uid);
    try {
      await updateDoc(doc(db, 'users', u.uid), { role: d.role, branchId: d.branchId, approved: d.approved });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, ...d } : x)));
      addAuditLog(
        'Access Updated',
        'Staff & RBAC',
        `${u.email}: role ${u.role} -> ${d.role}, branch ${u.branchId} -> ${d.branchId}, approved ${u.approved} -> ${d.approved}`
      );
      showToast('Access updated', `${u.email} is now ${d.approved ? d.role : 'not approved'}.`, 'success');
    } catch (e: any) {
      console.error('Failed to update user:', e);
      showToast('Update failed', 'You may not have permission to change this user.', 'error');
    } finally {
      setSavingUid(null);
    }
  };

  const pendingCount = users.filter((u) => !u.approved).length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">User Access (Super Admin)</h2>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {pendingCount} awaiting approval
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Branch</th>
              <th className="px-4 py-2.5">Approved</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => {
              const d = drafts[u.uid];
              if (!d) return null;
              const isSelf = u.uid === firebaseUser?.uid;
              const dirty = d.role !== u.role || d.branchId !== u.branchId || d.approved !== u.approved;
              return (
                <tr key={u.uid} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-slate-900 dark:text-white">{u.displayName || '-'}</p>
                    <p className="text-[11px] text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      className={selectClass}
                      value={d.role}
                      disabled={isSelf}
                      onChange={(e) => update(u.uid, { role: e.target.value as Role })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      className={selectClass}
                      value={d.branchId}
                      onChange={(e) => update(u.uid, { branchId: e.target.value })}
                    >
                      <option value="all">All branches</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
                      checked={d.approved}
                      disabled={isSelf}
                      onChange={(e) => update(u.uid, { approved: e.target.checked })}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => save(u)}
                      disabled={!dirty || savingUid === u.uid}
                      className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                    >
                      {savingUid === u.uid ? 'Saving...' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
