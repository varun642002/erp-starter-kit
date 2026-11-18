import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import type { ApiScope } from '../../services/apiClient';
import {
  attendanceApi,
  type PayType,
  type StaffMember,
  type StaffPayload,
  type StaffStatus
} from '../../services/attendanceApi';

export const STAFF_MANAGE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager', 'Branch Person', 'Accountant'];
export const STAFF_PAY_ROLES = ['Super Admin', 'Business Owner', 'Accountant'];

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export interface StaffAccess {
  scope: ApiScope;
  branchKey: string;
  isOwner: boolean;
  canManage: boolean;
  canSeePay: boolean;
  branchName: (id: string) => string;
}

export function useStaffAccess(): StaffAccess {
  const { currentRole, selectedBranchId, branches } = useERP();
  const { assignedBranchId } = useAuth();
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const branchKey = isOwner ? selectedBranchId : assignedBranchId;
  const scope = useMemo<ApiScope>(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name || id, [branches]);
  return {
    scope,
    branchKey,
    isOwner,
    canManage: STAFF_MANAGE_ROLES.includes(currentRole),
    canSeePay: STAFF_PAY_ROLES.includes(currentRole),
    branchName
  };
}

const cardClass = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 min-w-0 px-2.5 py-2.5 text-base sm:py-1.5 sm:text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-slate-400';
const primaryBtn =
  'flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 min-h-10 px-3.5 py-2 text-base sm:min-h-0 sm:text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600';
const secondaryBtn =
  'flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 min-h-10 px-3 py-1.5 text-base sm:min-h-0 sm:text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
const labelClass = 'mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400';
const thClass = 'whitespace-nowrap px-4 py-3';
const tdClass = 'px-4 py-3';

interface StaffForm {
  name: string;
  branchId: string;
  phone: string;
  designation: string;
  payType: PayType;
  baseSalary: string;
  overtimeRate: string;
  joinedOn: string;
  status: StaffStatus;
}

type ModalState = { mode: 'add' } | { mode: 'edit'; member: StaffMember } | null;

export interface StaffRosterProps {
  scope: ApiScope;
  // Branch used for the list request: 'all' (owners only) or one branch id.
  branchKey: string;
  isOwner: boolean;
  canManage: boolean;
  canSeePay: boolean;
  // Client-side branch filter applied on top of the fetched list.
  branchFilter?: string;
  search?: string;
  // Branch preselected in the add modal for owners.
  defaultBranchId?: string;
  // Increment to open the add modal from a parent button.
  addRequest?: number;
  showAddButton?: boolean;
  onLoaded?: (list: StaffMember[]) => void;
}

export const StaffRoster: React.FC<StaffRosterProps> = ({
  scope,
  branchKey,
  isOwner,
  canManage,
  canSeePay,
  branchFilter = 'all',
  search = '',
  defaultBranchId,
  addRequest = 0,
  showAddButton = true,
  onLoaded
}) => {
  const { showToast, addAuditLog, settings, branches } = useERP();
  const currency = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${currency}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name || id, [branches]);

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [showInactive, setShowInactive] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<StaffForm>(() => blankForm(''));
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    attendanceApi
      .listStaff(scope, branchKey)
      .then((r) => {
        if (id !== requestId.current) return;
        const list = Array.isArray(r) ? r : [];
        setStaffList(list);
        onLoadedRef.current?.(list);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setStaffList([]);
        onLoadedRef.current?.([]);
        setError(e.message || 'Failed to load the staff roster.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [scope, branchKey, tick]);

  const firstBranchId = branches[0]?.id ?? '';
  const initialBranch = useCallback(
    () => (defaultBranchId && defaultBranchId !== 'all' ? defaultBranchId : firstBranchId),
    [defaultBranchId, firstBranchId]
  );

  const openAdd = useCallback(() => {
    setForm(blankForm(initialBranch()));
    setFormError(null);
    setModal({ mode: 'add' });
  }, [initialBranch]);

  const lastAddRequest = useRef(addRequest);
  useEffect(() => {
    if (addRequest !== lastAddRequest.current) {
      lastAddRequest.current = addRequest;
      if (canManage) openAdd();
    }
  }, [addRequest, canManage, openAdd]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, busy]);

  const openEdit = (member: StaffMember) => {
    setForm({
      name: member.name,
      branchId: member.branchId,
      phone: member.phone ?? '',
      designation: member.designation ?? '',
      payType: member.payType,
      baseSalary: member.baseSalary !== undefined ? String(member.baseSalary) : '',
      overtimeRate: member.overtimeRate !== undefined ? String(member.overtimeRate) : '',
      joinedOn: member.joinedOn ?? '',
      status: member.status
    });
    setFormError(null);
    setModal({ mode: 'edit', member });
  };

  const q = search.trim().toLowerCase();
  const visible = staffList.filter((s) => {
    if (!showInactive && s.status !== 'Active') return false;
    if (branchFilter !== 'all' && s.branchId !== branchFilter) return false;
    if (q && !`${s.name} ${s.phone ?? ''} ${s.designation ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const numberOrNull = (v: string) => {
    if (v.trim() === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Enter the staff member name.');
      return;
    }
    const targetBranch = isOwner ? form.branchId : branchKey;
    if (modal.mode === 'add' && (!targetBranch || targetBranch === 'all')) {
      setFormError('Select a branch for this staff member.');
      return;
    }
    const salary = numberOrNull(form.baseSalary);
    const otRate = numberOrNull(form.overtimeRate);
    if (canSeePay && (salary === null || otRate === null)) {
      setFormError('Salary and overtime rate must be zero or more.');
      return;
    }
    const payload: StaffPayload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      designation: form.designation.trim(),
      payType: form.payType,
      joinedOn: form.joinedOn || undefined,
      ...(canSeePay ? { baseSalary: salary ?? 0, overtimeRate: otRate ?? 0 } : {})
    };
    setBusy(true);
    try {
      if (modal.mode === 'add') {
        await attendanceApi.createStaff(scope, { ...payload, name: payload.name as string, branchId: targetBranch });
        addAuditLog('Added Staff', 'Attendance', `${payload.name} added to ${branchName(targetBranch)}`);
        showToast('Staff Added', `${payload.name} was added to ${branchName(targetBranch)}.`, 'success');
      } else {
        const moved = isOwner && form.branchId && form.branchId !== modal.member.branchId;
        await attendanceApi.updateStaff(scope, modal.member.id, {
          ...payload,
          status: form.status,
          ...(moved ? { branchId: form.branchId } : {})
        });
        addAuditLog('Updated Staff', 'Attendance', `${payload.name} details updated`);
        showToast('Staff Updated', `${payload.name} was updated.`, 'success');
      }
      setModal(null);
      setTick((t) => t + 1);
    } catch (err: any) {
      setFormError(err?.message || 'The server rejected this request.');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (member: StaffMember) => {
    const next: StaffStatus = member.status === 'Active' ? 'Inactive' : 'Active';
    setBusy(true);
    setActionError(null);
    try {
      await attendanceApi.updateStaff(scope, member.id, { status: next });
      addAuditLog(next === 'Active' ? 'Activated Staff' : 'Deactivated Staff', 'Attendance', `${member.name} marked ${next}`);
      showToast('Staff Updated', `${member.name} is now ${next.toLowerCase()}.`, 'success');
      setTick((t) => t + 1);
    } catch (err: any) {
      setActionError(`Could not update ${member.name}: ${err?.message || 'Request failed.'}`);
    } finally {
      setBusy(false);
    }
  };

  const showBranchCol = branchKey === 'all' && branchFilter === 'all';
  const colCount = 6 + (canSeePay ? 2 : 0) + (showBranchCol ? 1 : 0) + (canManage ? 1 : 0);
  const isFiltered = q !== '' || branchFilter !== 'all';

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Your role has a read-only view of the staff roster. Ask a manager or owner to add or change staff.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-10 w-full min-w-0 items-center gap-2 text-sm sm:min-h-0 sm:w-auto sm:text-xs text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-5 w-5 sm:h-3.5 sm:w-3.5 cursor-pointer accent-slate-800"
          />
          Show inactive staff
        </label>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Reload"
            aria-label="Reload staff"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && showAddButton && (
            <button type="button" onClick={openAdd} className={`${primaryBtn} flex-1 sm:flex-none`}>
              <Plus className="h-4 w-4" />
              <span>Add staff</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Could not load the roster</p>
            <p className="break-words">{error}</p>
          </div>
          <button type="button" onClick={() => setTick((t) => t + 1)} className="font-bold underline cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 break-words">{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss" className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loading && staffList.length === 0 && !error && (
        <div className={`${cardClass} flex items-center justify-center gap-2 p-12 text-xs text-slate-500 dark:text-slate-400`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading staff roster...</span>
        </div>
      )}

      {!error && (!loading || staffList.length > 0) && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="md:hidden">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-slate-400 dark:text-slate-500">
                {isFiltered ? 'No staff match the current filters.' : 'No staff members yet.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((s) => (
                  <li key={s.id} className="space-y-3 p-4">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{s.name}</p>
                      <p className="break-words text-xs text-slate-500 dark:text-slate-400">{s.designation || '-'}</p>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {showBranchCol && (
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Branch</dt>
                          <dd className="break-words text-slate-600 dark:text-slate-300">{branchName(s.branchId)}</dd>
                        </div>
                      )}
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Phone</dt>
                        <dd className="break-words font-mono text-slate-600 dark:text-slate-300">{s.phone || '-'}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Pay type</dt>
                        <dd className="capitalize text-slate-600 dark:text-slate-300">{s.payType}</dd>
                      </div>
                      {canSeePay && (
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Base pay</dt>
                          <dd className="break-words font-mono text-slate-700 dark:text-slate-300">
                            {s.baseSalary !== undefined ? fmt(s.baseSalary) : '-'}
                            <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">{s.payType === 'daily' ? '/day' : '/mo'}</span>
                          </dd>
                        </div>
                      )}
                      {canSeePay && (
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">OT / hr</dt>
                          <dd className="font-mono text-slate-700 dark:text-slate-300">{s.overtimeRate ? fmt(s.overtimeRate) : 'Auto'}</dd>
                        </div>
                      )}
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Joined</dt>
                        <dd className="font-mono text-slate-500 dark:text-slate-400">{s.joinedOn || '-'}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Status</dt>
                        <dd className={`font-bold ${statusClass(s.status, false)}`}>{s.status}</dd>
                      </div>
                    </dl>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleStatus(s)}
                          className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {s.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          aria-label={`Edit ${s.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className={thClass}>Name</th>
                  {showBranchCol && <th className={thClass}>Branch</th>}
                  <th className={thClass}>Phone</th>
                  <th className={thClass}>Designation</th>
                  <th className={thClass}>Pay type</th>
                  {canSeePay && <th className={`${thClass} text-right`}>Base pay</th>}
                  {canSeePay && <th className={`${thClass} text-right`}>OT / hr</th>}
                  <th className={thClass}>Joined</th>
                  <th className={`${thClass} text-center`}>Status</th>
                  {canManage && <th className={`${thClass} text-right`}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                      {isFiltered ? 'No staff match the current filters.' : 'No staff members yet.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className={`${tdClass} max-w-56 truncate font-bold text-slate-900 dark:text-white`} title={s.name}>{s.name}</td>
                      {showBranchCol && <td className={`${tdClass} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{branchName(s.branchId)}</td>}
                      <td className={`${tdClass} whitespace-nowrap font-mono text-slate-600 dark:text-slate-300`}>{s.phone || '-'}</td>
                      <td className={`${tdClass} max-w-48 truncate text-slate-600 dark:text-slate-300`} title={s.designation ?? undefined}>{s.designation || '-'}</td>
                      <td className={`${tdClass} whitespace-nowrap capitalize text-slate-600 dark:text-slate-300`}>{s.payType}</td>
                      {canSeePay && (
                        <td className={`${tdClass} whitespace-nowrap text-right font-mono text-slate-700 dark:text-slate-300`}>
                          {s.baseSalary !== undefined ? fmt(s.baseSalary) : '-'}
                          <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">{s.payType === 'daily' ? '/day' : '/mo'}</span>
                        </td>
                      )}
                      {canSeePay && (
                        <td className={`${tdClass} whitespace-nowrap text-right font-mono text-slate-700 dark:text-slate-300`}>
                          {s.overtimeRate ? fmt(s.overtimeRate) : 'Auto'}
                        </td>
                      )}
                      <td className={`${tdClass} whitespace-nowrap font-mono text-slate-500 dark:text-slate-400`}>{s.joinedOn || '-'}</td>
                      <td className={`${tdClass} text-center`}>
                        {canManage ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleStatus(s)}
                            title={s.status === 'Active' ? 'Click to deactivate' : 'Click to activate'}
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${statusClass(s.status, true)}`}
                          >
                            {s.status}
                          </button>
                        ) : (
                          <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${statusClass(s.status, false)}`}>{s.status}</span>
                        )}
                      </td>
                      {canManage && (
                        <td className={`${tdClass} text-right`}>
                          <button
                            type="button"
                            onClick={() => openEdit(s)}
                            className="rounded-md border border-slate-200 p-2.5 sm:p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="Edit"
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && canManage && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-xl rounded-b-none sm:max-h-[90vh] sm:rounded-b-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="staff-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                {modal.mode === 'add' ? 'Add staff member' : 'Edit staff member'}
              </h3>
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={busy}
                className="rounded-md p-2 sm:p-1 text-slate-500 hover:bg-slate-100 cursor-pointer dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="min-w-0 break-words">{formError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor="st-name" className={labelClass}>Name</label>
                <input id="st-name" type="text" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} autoFocus />
              </div>

              {isOwner ? (
                <div className="min-w-0 sm:col-span-2">
                  <label htmlFor="st-branch" className={labelClass}>Branch</label>
                  <select id="st-branch" required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputClass}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:col-span-2">
                  Branch: <span className="font-bold text-slate-700 dark:text-slate-300">{branchName(branchKey)}</span>
                </p>
              )}

              <div className="min-w-0">
                <label htmlFor="st-phone" className={labelClass}>Phone</label>
                <input id="st-phone" type="tel" maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
              </div>
              <div className="min-w-0">
                <label htmlFor="st-desig" className={labelClass}>Designation</label>
                <input id="st-desig" type="text" maxLength={60} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={inputClass} />
              </div>
              <div className="min-w-0">
                <label htmlFor="st-paytype" className={labelClass}>Pay type</label>
                <select id="st-paytype" value={form.payType} onChange={(e) => setForm({ ...form, payType: e.target.value as PayType })} className={inputClass}>
                  <option value="monthly">Monthly salary</option>
                  <option value="daily">Daily wage</option>
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="st-joined" className={labelClass}>Joined on</label>
                <input id="st-joined" type="date" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} className={`${inputClass} font-mono`} />
              </div>

              {canSeePay && (
                <>
                  <div className="min-w-0">
                    <label htmlFor="st-salary" className={labelClass}>{form.payType === 'daily' ? 'Daily wage' : 'Monthly salary'}</label>
                    <input id="st-salary" type="number" min="0" step="0.01" inputMode="decimal" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} placeholder="0.00" className={`${inputClass} text-right font-mono`} />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="st-ot" className={labelClass}>Overtime rate / hr</label>
                    <input id="st-ot" type="number" min="0" step="0.01" inputMode="decimal" value={form.overtimeRate} onChange={(e) => setForm({ ...form, overtimeRate: e.target.value })} placeholder="0 = auto" className={`${inputClass} text-right font-mono`} />
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 sm:col-span-2">
                    Overtime rate 0 derives the hourly rate from the daily rate during payroll.
                  </p>
                </>
              )}

              {modal.mode === 'edit' && (
                <div className="min-w-0 sm:col-span-2">
                  <label htmlFor="st-status" className={labelClass}>Status</label>
                  <select id="st-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StaffStatus })} className={inputClass}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 -mx-4 -mb-4 mt-5 flex justify-end gap-2 bg-white px-4 py-3 sm:static sm:mx-0 sm:mb-0 sm:bg-transparent sm:p-0 dark:bg-slate-900 sm:dark:bg-transparent">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className={`${secondaryBtn} flex-1 sm:flex-none`}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={`${primaryBtn} flex-1 sm:flex-none`}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{modal.mode === 'add' ? 'Add staff' : 'Save changes'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

function blankForm(branchId: string): StaffForm {
  return {
    name: '',
    branchId,
    phone: '',
    designation: '',
    payType: 'monthly',
    baseSalary: '',
    overtimeRate: '',
    joinedOn: todayIST(),
    status: 'Active'
  };
}

function statusClass(status: StaffStatus, interactive: boolean): string {
  if (status === 'Active') {
    return `text-emerald-700 dark:text-emerald-300 ${interactive ? 'hover:underline' : ''}`;
  }
  return `text-slate-500 dark:text-slate-400 ${interactive ? 'hover:underline' : ''}`;
}
