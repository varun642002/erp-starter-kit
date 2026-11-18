import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';

interface Props {
  name: string;
  canEdit: boolean;
  // names already used by other items, to warn about a repeat
  otherNames?: string[];
  onSave: (newName: string, keepOldAsAlternate: boolean) => Promise<void>;
}

// The item's name in its details dialog, with an edit button for people who may edit items.
export const ItemNameEditor: React.FC<Props> = ({ name, canEdit, otherNames = [], onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [keepOld, setKeepOld] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name);
    setEditing(false);
    setError('');
  }, [name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const trimmed = draft.trim().replace(/\s+/g, ' ');
  const changed = trimmed !== name.trim();
  const repeats = changed && otherNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());

  const save = async () => {
    if (!trimmed) {
      setError('The name cannot be empty.');
      return;
    }
    if (!changed) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(trimmed, keepOld);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the name.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h3 className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-white">{name}</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit name"
            aria-label="Edit name"
            className="shrink-0 cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          maxLength={200}
          aria-label="Item name"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-base font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none sm:py-1.5 sm:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !trimmed || !changed}
          title="Save name"
          aria-label="Save name"
          className="shrink-0 cursor-pointer rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(false);
            setError('');
          }}
          title="Cancel"
          aria-label="Cancel"
          className="shrink-0 cursor-pointer rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={keepOld} onChange={(e) => setKeepOld(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
        Keep the old name as an alternate name, so it can still be searched
      </label>
      {repeats && (
        <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Another item already has this name. You can still save it.</p>
      )}
      {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
};
