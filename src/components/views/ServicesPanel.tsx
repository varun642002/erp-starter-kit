import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Search, Trash2, Wrench, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { serviceCatalogApi, type ServiceItem } from '../../services/serviceCatalogApi';

// The Services tab of Inventory: the services done for the machines the shop sells, each with its cost.

const cardCls = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputCls = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 sm:h-8 sm:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const rs = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;
const COMMON_MACHINES = ['Rotavator', 'Baler', 'Power Tiller', 'Tractor'];

interface Draft {
  id: string | null;
  name: string;
  machineType: string;
  cost: string;
  notes: string;
}
const emptyDraft: Draft = { id: null, name: '', machineType: '', cost: '', notes: '' };

export const ServicesPanel: React.FC<{ canEdit: boolean; onCount?: (n: number) => void }> = ({ canEdit, onCount }) => {
  const { currentRole, showToast } = useERP();
  const { assignedBranchId } = useAuth();
  const scope = useMemo(() => ({ role: currentRole, branchId: assignedBranchId || 'branch-1' }), [currentRole, assignedBranchId]);

  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [machineFilter, setMachineFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await serviceCatalogApi.list(scope);
      setItems(list);
      onCount?.(list.length);
    } catch (e: any) {
      setError(e?.message || 'Could not load the services');
    } finally {
      setLoading(false);
    }
  }, [scope, onCount]);
  useEffect(() => {
    load();
  }, [load]);

  const machineTypes = useMemo(
    () => Array.from(new Set([...COMMON_MACHINES, ...items.map((i) => i.machineType || '').filter(Boolean)])).sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (machineFilter === 'none' ? !!i.machineType : machineFilter !== 'all' && i.machineType !== machineFilter) return false;
      return !q || `${i.name} ${i.machineType || ''} ${i.notes || ''}`.toLowerCase().includes(q);
    });
  }, [items, query, machineFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, ServiceItem[]>();
    for (const i of shown) {
      const k = i.machineType || 'Any machine';
      map.set(k, [...(map.get(k) || []), i]);
    }
    return Array.from(map.entries());
  }, [shown]);

  const save = async () => {
    if (!draft) return;
    const cost = Number(draft.cost);
    if (!draft.name.trim()) return showToast('Services', 'Enter the type of service.', 'error');
    if (draft.cost.trim() === '' || !Number.isFinite(cost) || cost < 0) return showToast('Services', 'Enter the cost as a number.', 'error');
    setBusy(true);
    try {
      const body = { name: draft.name, machineType: draft.machineType, cost, notes: draft.notes };
      if (draft.id) await serviceCatalogApi.update(scope, draft.id, body);
      else await serviceCatalogApi.create(scope, body);
      showToast('Services', draft.id ? 'Service updated.' : 'Service added.', 'success');
      setDraft(null);
      await load();
    } catch (e: any) {
      showToast('Could not save', e?.message || 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (i: ServiceItem) => {
    try {
      await serviceCatalogApi.update(scope, i.id, { active: !i.active });
      await load();
    } catch (e: any) {
      showToast('Could not change', e?.message || 'Please try again.', 'error');
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await serviceCatalogApi.remove(scope, id);
      showToast('Services', 'Service deleted.', 'success');
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      showToast('Could not delete', e?.message || 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The services you do for the machines you sell, and what each one costs.
        </p>
        {canEdit && !draft && (
          <button
            type="button"
            onClick={() => setDraft({ ...emptyDraft })}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 dark:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> Add service
          </button>
        )}
      </div>

      {draft && (
        <div className={`${cardCls} space-y-3 p-4`}>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{draft.id ? 'Edit service' : 'New service'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Type of service
              <input className={`${inputCls} mt-1`} placeholder="e.g. Gearbox overhaul" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              For which machine
              <input className={`${inputCls} mt-1`} list="service-machine-types" placeholder="e.g. Rotavator (leave empty for any machine)" value={draft.machineType} onChange={(e) => setDraft({ ...draft, machineType: e.target.value })} />
              <datalist id="service-machine-types">
                {machineTypes.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Cost (₹)
              <input className={`${inputCls} mt-1`} inputMode="decimal" placeholder="0" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value.replace(/[^0-9.]/g, '') })} />
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Note (optional)
              <input className={`${inputCls} mt-1`} placeholder="e.g. labour only, parts extra" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 w-full sm:w-72">
          <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
          <input className={`${inputCls} pl-8`} placeholder="Search services" aria-label="Search services" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className={`${inputCls} col-span-2 sm:w-auto sm:max-w-[12rem]`} aria-label="Filter by machine" value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
          <option value="all">All machines</option>
          {machineTypes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value="none">Any machine</option>
        </select>
      </div>

      {loading && !items.length ? (
        <div className="py-10 text-center text-xs text-slate-400">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading services
        </div>
      ) : error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          {error}{' '}
          <button type="button" onClick={load} className="cursor-pointer font-bold underline">
            Retry
          </button>
        </div>
      ) : !items.length ? (
        <div className={`${cardCls} px-5 py-10 text-center`}>
          <Wrench className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {canEdit ? 'No services yet. Use Add service to enter the first one and its cost.' : 'No services have been added yet.'}
          </p>
        </div>
      ) : !shown.length ? (
        <p className="py-6 text-center text-xs text-slate-500">No services match your search.</p>
      ) : (
        groups.map(([machine, list]) => (
          <div key={machine} className={`${cardCls} overflow-hidden`}>
            <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
              {machine} <span className="font-mono opacity-70">{list.length}</span>
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((i) => (
                <li key={i.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 ${i.active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-slate-900 dark:text-white">
                      {i.name}
                      {!i.active && <span className="ml-2 rounded bg-slate-200 px-1.5 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">OFF</span>}
                    </p>
                    {i.notes && <p className="text-[11px] text-slate-500">{i.notes}</p>}
                  </div>
                  <p className="text-sm font-extrabold text-slate-900 dark:text-white">{rs(i.cost)}</p>
                  {canEdit && (
                    <div className="flex items-center gap-1.5">
                      {confirmDelete === i.id ? (
                        <>
                          <button type="button" onClick={() => remove(i.id)} disabled={busy} className="cursor-pointer rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-rose-500 disabled:opacity-60">
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} aria-label="Keep it" className="cursor-pointer rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => toggleActive(i)} className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                            {i.active ? 'Switch off' : 'Switch on'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraft({ id: i.id, name: i.name, machineType: i.machineType || '', cost: String(i.cost), notes: i.notes || '' })}
                            aria-label={`Edit ${i.name}`}
                            className="cursor-pointer rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(i.id)} aria-label={`Delete ${i.name}`} className="cursor-pointer rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
};
