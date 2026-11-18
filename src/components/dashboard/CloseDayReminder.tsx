import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { cashBookApi, type CashClosing } from '../../services/cashBookApi';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const yesterdayOf = () => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// A reminder when a branch did not close its cash book yesterday. Cash in hand is only exact when every day is closed.
export const CloseDayReminder: React.FC = () => {
  const { branches, setCurrentView } = useERP();
  const { scope, branchParam, assignedBranchId } = useApiScope();
  const key = `closeday-dismissed-${today()}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const [closings, setClosings] = useState<CashClosing[] | null>(null);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    cashBookApi
      .listClosings(scope, branchParam || assignedBranchId || 'all', 200)
      .then((r) => alive && setClosings(r))
      .catch(() => alive && setClosings(null));
    return () => {
      alive = false;
    };
  }, [scope, branchParam, assignedBranchId, hidden]);

  const late = useMemo(() => {
    if (!closings) return [];
    const y = yesterdayOf();
    const withHistory = new Set(closings.map((c) => c.branchId));
    const closedY = new Set(closings.filter((c) => c.businessDate === y).map((c) => c.branchId));
    return [...withHistory].filter((b) => !closedY.has(b)).map((b) => branches.find((x) => x.id === b)?.name || b);
  }, [closings, branches]);

  if (hidden || late.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Yesterday's cash book is not closed</b> ({late.join(', ')}). Count the cash and close the day so the cash in hand stays right.
        </span>
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={() => setCurrentView('cash-book')} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700">
          Close it now <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Hide until tomorrow"
          title="Hide until tomorrow (for example, a day the shop was shut)"
          onClick={() => {
            try {
              localStorage.setItem(key, '1');
            } catch {
              /* a private window can refuse storage; it just shows again next time */
            }
            setHidden(true);
          }}
          className="cursor-pointer rounded-full p-1.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
};
