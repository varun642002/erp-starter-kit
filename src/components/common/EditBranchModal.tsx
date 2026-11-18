import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Branch } from '../../types/erp';

interface Props {
  branch: Branch | null;
  onClose: () => void;
}

const INPUT =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export const EditBranchModal: React.FC<Props> = ({ branch, onClose }) => {
  const { updateBranch } = useERP();
  const [f, setF] = useState<Branch | null>(branch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setF(branch);
    setError('');
  }, [branch]);

  if (!branch || !f) return null;
  const set = <K extends keyof Branch>(key: K, value: Branch[K]) => setF((p) => (p ? { ...p, [key]: value } : p));

  const save = async () => {
    const name = f.name.trim();
    const code = f.code.trim().toUpperCase();
    const gstin = (f.gstin || '').trim().toUpperCase();
    if (!name) return setError('Branch name is required.');
    if (!code) return setError('Branch code is required.');
    if (gstin && gstin.length !== 15) return setError('GSTIN must be 15 characters, or leave it empty.');
    setBusy(true);
    setError('');
    try {
      await updateBranch({ ...f, name, code, gstin });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save the branch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Edit branch</h2>
            <p className="text-xs text-slate-500">{branch.name}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
            Branch name *
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Branch code *
            <input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className={`${INPUT} font-mono`} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Status
            <select value={f.status} onChange={(e) => set('status', e.target.value as Branch['status'])} className={INPUT}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
            Address
            <textarea value={f.address} onChange={(e) => set('address', e.target.value)} rows={2} className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            City / town
            <input value={f.city} onChange={(e) => set('city', e.target.value)} className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            State
            <input value={f.state} onChange={(e) => set('state', e.target.value)} className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Phone
            <input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Email
            <input value={f.email} onChange={(e) => set('email', e.target.value)} type="email" className={INPUT} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            GSTIN (if this branch has its own)
            <input
              value={f.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              maxLength={15}
              className={`${INPUT} font-mono`}
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 sm:col-span-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-60 dark:bg-slate-700"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
};
