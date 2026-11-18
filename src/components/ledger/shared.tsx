import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import type { ApiScope } from '../../services/apiClient';
import type { DateRange } from '../../services/ledgerApi';

export const LEDGER_ROLES = ['Super Admin', 'Business Owner', 'Accountant', 'Branch Manager', 'Branch Person'];

export const CARD = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
export const INPUT =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-slate-400';
export const LABEL = 'mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400';
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600';
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';

export const THEAD = 'border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400';
export const TBODY = 'divide-y divide-slate-100 dark:divide-slate-800';
export const TROW = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40';
export const TFOOT = 'border-t border-slate-200 bg-slate-50 font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white';
export const TH = 'whitespace-nowrap px-4 py-3 text-left';
export const THR = 'whitespace-nowrap px-4 py-3 text-right';
export const TD = 'px-4 py-3 text-slate-600 dark:text-slate-300';
export const TDR = 'whitespace-nowrap px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300';

export const IN_TONE = 'text-emerald-600 dark:text-emerald-400';
export const OUT_TONE = 'text-rose-600 dark:text-rose-400';

export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Preset = 'today' | 'week' | 'month' | 'fy' | 'custom';

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'fy', label: 'This FY' },
  { id: 'custom', label: 'Custom' }
];

export function presetRange(preset: Exclude<Preset, 'custom'>, today = todayIST()): DateRange {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { from: shiftDays(today, -((dow + 6) % 7)), to: today };
  }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  const year = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: today };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

export function useLedgerContext() {
  const { currentRole, selectedBranchId, branches, settings, showToast, addAuditLog } = useERP();
  const { assignedBranchId, userProfile } = useAuth();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const currency = settings.currencySymbol || '₹';
  const scope: ApiScope = useMemo(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  const effectiveBranch = isOwner ? selectedBranchId : assignedBranchId;
  const queryBranch = isOwner ? selectedBranchId : undefined;
  const writeBranchId = effectiveBranch !== 'all' ? effectiveBranch : null;

  const money = useCallback(
    (n: number) => {
      const rounded = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
      const text = Math.abs(rounded).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${rounded < 0 ? '-' : ''}${currency}${text}`;
    },
    [currency]
  );
  const branchName = useCallback(
    (id: string | null | undefined) => (id ? branches.find((b) => b.id === id)?.name || id : '-'),
    [branches]
  );

  return {
    role: currentRole,
    isOwner,
    hasAccess: LEDGER_ROLES.includes(currentRole),
    scope,
    effectiveBranch,
    queryBranch,
    writeBranchId,
    currency,
    money,
    branchName,
    companyName: settings.companyName || 'our shop',
    actor: userProfile?.displayName || currentRole,
    showToast,
    addAuditLog
  };
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

// Keeps the previous data on screen while refetching and drops answers that arrive out of order.
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    setError('');
    load()
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (id !== latest.current) return;
        setData(null);
        setError(e.message || 'Request failed.');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const LoadingBox: React.FC<{ label?: string }> = ({ label = 'Loading...' }) => (
  <div className="flex items-center justify-center gap-2 p-12 text-xs text-slate-500 dark:text-slate-400">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>{label}</span>
  </div>
);

export const ErrorBox: React.FC<{ title: string; message: string; onRetry: () => void }> = ({ title, message, onRetry }) => (
  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="font-bold">{title}</p>
      <p className="break-words">{message}</p>
    </div>
    <button type="button" onClick={onRetry} className="cursor-pointer font-bold underline">
      Retry
    </button>
  </div>
);

export const EmptyRow: React.FC<{ cols: number; text: string }> = ({ cols, text }) => (
  <tr>
    <td colSpan={cols} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
      {text}
    </td>
  </tr>
);

export const CardHeader: React.FC<{ title: string; hint?: string; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
);

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
