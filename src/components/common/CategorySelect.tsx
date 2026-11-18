import React, { useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
  'aria-label'?: string;
}

const NEW = '__new__';

// A category list with an "add a new category" entry, so a category that is not in the list can still be used.
export const CategorySelect: React.FC<Props> = ({ value, onChange, options, className = '', ...rest }) => {
  const unique = Array.from(new Set(options.map((o) => o.trim()).filter(Boolean)));
  const inList = unique.includes(value);
  const [custom, setCustom] = useState(!!value && !inList);

  useEffect(() => {
    // a value picked from the list (for example after a form reset) leaves custom mode
    if (value && unique.includes(value)) setCustom(false);
  }, [value]);

  const base =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white ' + className;

  return (
    <div>
      <select
        value={custom ? NEW : value}
        aria-label={rest['aria-label']}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setCustom(true);
            onChange('');
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
        className={base}
      >
        {unique.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={NEW}>+ New category...</option>
      </select>
      {custom && (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the new category name"
          className={base}
        />
      )}
    </div>
  );
};
