import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Users, UserCheck, Building2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { StaffMember } from '../../services/attendanceApi';
import { StaffRoster, useStaffAccess } from '../staff/StaffRoster';

const ROLE_NOTES: { role: string; scope: string; staff: string }[] = [
  { role: 'Super Admin / Business Owner', scope: 'All branches', staff: 'Add, edit and deactivate staff in any branch; sees salary and overtime rates.' },
  { role: 'Accountant', scope: 'Assigned branch', staff: 'Add and edit staff; sees salary and overtime rates for payroll.' },
  { role: 'Branch Manager / Branch Person', scope: 'Own branch', staff: 'Add and edit staff in their own branch; salary figures are hidden.' },
  { role: 'Other roles', scope: 'Own branch', staff: 'No access to the staff roster.' }
];

const summaryCard =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900';

export const EmployeesView: React.FC = () => {
  const { branches, selectedBranchId } = useERP();
  const { scope, branchKey, isOwner, canManage, canSeePay } = useStaffAccess();

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>(isOwner ? selectedBranchId : 'all');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [addRequest, setAddRequest] = useState(0);

  // Follow the global branch switcher so the directory matches the rest of the app.
  useEffect(() => {
    if (isOwner) setBranchFilter(selectedBranchId);
  }, [isOwner, selectedBranchId]);

  const stats = useMemo(() => {
    const perBranch = new Map<string, number>();
    let active = 0;
    for (const s of staff) {
      if (s.status === 'Active') active++;
      perBranch.set(s.branchId, (perBranch.get(s.branchId) ?? 0) + 1);
    }
    return { total: staff.length, active, perBranch };
  }, [staff]);

  const listedBranches = isOwner ? branches : branches.filter((b) => stats.perBranch.has(b.id) || b.id === branchKey);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Staff Directory</h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Everyone on the payroll across branches. Add new staff, update details or mark them inactive.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setAddRequest((n) => n + 1)}
            className="flex items-center justify-center gap-1.5 self-start rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600 sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Add staff</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={summaryCard}>
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <Users className="h-3.5 w-3.5" />
            <span>Total staff</span>
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
        </div>
        <div className={summaryCard}>
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <UserCheck className="h-3.5 w-3.5" />
            <span>Active</span>
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.active}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">{stats.total - stats.active} inactive</p>
        </div>
        <div className={`${summaryCard} sm:col-span-2`}>
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <Building2 className="h-3.5 w-3.5" />
            <span>Staff per branch</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {listedBranches.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-600 dark:text-slate-300" title={b.name}>{b.name}</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{stats.perBranch.get(b.id) ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or designation"
            aria-label="Search staff"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
            className="h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      <StaffRoster
        scope={scope}
        branchKey={isOwner ? 'all' : branchKey}
        isOwner={isOwner}
        canManage={canManage}
        canSeePay={canSeePay}
        branchFilter={isOwner ? branchFilter : 'all'}
        search={search}
        defaultBranchId={isOwner && branchFilter !== 'all' ? branchFilter : undefined}
        addRequest={addRequest}
        showAddButton={false}
        onLoaded={setStaff}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Roles and what they can do</h3>
        <div className="overflow-x-auto">
          <table data-stack="true" className="w-full text-left text-xs">
            <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="whitespace-nowrap px-3 py-2.5">Role</th>
                <th className="whitespace-nowrap px-3 py-2.5">Branch scope</th>
                <th className="px-3 py-2.5">Staff roster access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ROLE_NOTES.map((r) => (
                <tr key={r.role}>
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-900 dark:text-white">{r.role}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-400">{r.scope}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{r.staff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
