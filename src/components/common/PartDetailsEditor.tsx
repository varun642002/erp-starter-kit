import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  partNumber: string;
  subCategory: string;
  suggestions: string[];
  canEdit: boolean;
  onSave: (partNumber: string, subCategory: string) => Promise<void>;
}

// Part number and sub category of an item, shown on its details and editable by stock handling roles.
export const PartDetailsEditor: React.FC<Props> = ({ partNumber, subCategory, suggestions, canEdit, onSave }) => {
  const [pn, setPn] = useState(partNumber);
  const [sub, setSub] = useState(subCategory);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPn(partNumber);
    setSub(subCategory);
    setError('');
  }, [partNumber, subCategory]);

  const dirty = pn.trim() !== partNumber.trim() || sub.trim() !== subCategory.trim();

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(pn.trim(), sub.trim());
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:bg-slate-50 disabled:text-slate-500';

  return (
    <div>
      <h4 className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Part number and sub category</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Part number
          <input value={pn} onChange={(e) => setPn(e.target.value)} disabled={!canEdit} placeholder="e.g. 6205-2RS" className={`${input} font-mono`} />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Sub category
          <input value={sub} onChange={(e) => setSub(e.target.value)} disabled={!canEdit} list="part-subcategories" placeholder="e.g. Ball bearings" className={input} />
          <datalist id="part-subcategories">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      </div>
      {canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
          {error && <span className="text-[11px] font-semibold text-rose-600">{error}</span>}
        </div>
      )}
    </div>
  );
};
