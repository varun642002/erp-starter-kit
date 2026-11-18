import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { getProductAliases, saveProductAliases } from '../../services/api';

interface Props {
  productId: string;
  canEdit: boolean;
  initial?: string[];
  onSaved?: (names: string[]) => void;
}

// Other names a product is known by (local names, Tamil spellings, short names). Added to search everywhere
// and used by the Tamil voice assistant to find the item.
export const AlternateNamesEditor: React.FC<Props> = ({ productId, canEdit, initial, onSaved }) => {
  const [names, setNames] = useState<string[]>(initial || []);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDirty(false);
    setError('');
    getProductAliases(productId)
      .then((n) => alive && setNames(n))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [productId]);

  const add = () => {
    const parts = draft
      .split(/[;|,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...names];
    for (const p of parts) if (!next.some((n) => n.toLowerCase() === p.toLowerCase())) next.push(p);
    setNames(next);
    setDraft('');
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await saveProductAliases(productId, names);
      setNames(saved);
      setDirty(false);
      onSaved?.(saved);
    } catch (e: any) {
      setError(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4 className="mb-1 text-xs font-bold text-slate-900 dark:text-white">Alternate names</h4>
      <p className="mb-2 text-[11px] text-slate-500">Other names this item is known by. They work in search and with the voice assistant.</p>
      {loading ? (
        <p className="text-[11px] text-slate-400">Loading...</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {names.length === 0 && <span className="text-[11px] text-slate-400">No alternate names yet.</span>}
          {names.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {n}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${n}`}
                  onClick={() => {
                    setNames(names.filter((x) => x !== n));
                    setDirty(true);
                  }}
                  className="cursor-pointer text-slate-400 hover:text-rose-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="e.g. ரோட்டவேட்டர் பிளேடு; rotary blade"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <button type="button" onClick={add} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
};
