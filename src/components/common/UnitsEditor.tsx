import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { UNIT_CHOICES, altUnitOf, unitWord } from '../../utils/units';

interface Props {
  unit: string;
  alternateUnit?: string | null;
  conversionFactor?: number | null;
  canEdit: boolean;
  onSave: (alternateUnit: string | null, conversionFactor: number | null) => Promise<void>;
}

// "Sold in": the unit stock is counted in, and an optional second unit that holds a fixed number of it
// (a Box of 18 blades). Stock stays counted in pieces; boxes are worked out from it.
export const UnitsEditor: React.FC<Props> = ({ unit, alternateUnit, conversionFactor, canEdit, onSave }) => {
  const current = altUnitOf({ unit, alternateUnit, conversionFactor });
  const [alt, setAlt] = useState(current?.unit || '');
  const [count, setCount] = useState(current ? String(current.factor) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = altUnitOf({ unit, alternateUnit, conversionFactor });
    setAlt(c?.unit || '');
    setCount(c ? String(c.factor) : '');
    setError('');
  }, [unit, alternateUnit, conversionFactor]);

  const baseLabel = unitWord(unit, 2);
  const n = Number(count);
  const valid = !alt || (Number.isInteger(n) && n >= 2);
  const dirty = (alt || '') !== (current?.unit || '') || (alt ? n !== (current?.factor ?? 0) : false);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      await onSave(alt || null, alt ? n : null);
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
      <h4 className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Selling units</h4>
      <p className="mb-2 text-[11px] text-slate-500">
        Counted in <strong>{baseLabel}</strong>. {current ? `Also sold by the ${current.unit.toLowerCase()}: 1 ${current.unit.toLowerCase()} = ${current.factor} ${baseLabel}.` : 'Not sold by the box.'}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Also sold by
          <select value={alt} onChange={(e) => setAlt(e.target.value)} disabled={!canEdit} className={input}>
            <option value="">Only {baseLabel}</option>
            {UNIT_CHOICES.filter((u) => u.toLowerCase() !== unit.toLowerCase() && !(u === 'Piece' && unit === 'Nos')).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        {alt && (
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {baseLabel} in one {alt.toLowerCase()}
            <input
              type="number"
              min={2}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. 18"
              className={`${input} font-mono`}
            />
          </label>
        )}
      </div>
      {canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || !valid || saving}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
          {alt && !valid && <span className="text-[11px] font-semibold text-rose-600">Enter a whole number of 2 or more.</span>}
          {error && <span className="text-[11px] font-semibold text-rose-600">{error}</span>}
        </div>
      )}
    </div>
  );
};
