import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Lightbulb, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { buildWhatsAppLink } from '../../../utils/whatsapp';

export const compact = (n: number, cur: string) => {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 10000000) return `${sign}${cur}${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `${sign}${cur}${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${sign}${cur}${(v / 1000).toFixed(1)}K`;
  return `${sign}${cur}${Math.round(v)}`;
};
export const full = (n: number, cur: string) => `${n < 0 ? '-' : ''}${cur}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

// A clean card used by every prediction tab
export const Panel: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <div className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {(title || right) && (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {title && <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">{title}</h3>}
        {right}
      </div>
    )}
    {children}
  </div>
);

export const Note: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' | 'good' }> = ({ children, tone = 'info' }) => (
  <p
    className={`rounded-xl p-3 text-xs leading-relaxed ${
      tone === 'warn'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
        : tone === 'good'
        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
        : 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400'
    }`}
  >
    {children}
  </p>
);

// "What this means", in plain words, under a chart or a number
export const Tip: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title = 'What this means' }) => (
  <div className="flex items-start gap-2.5 rounded-xl bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
    <div>
      <p className="font-bold">{title}</p>
      <div className="mt-0.5 text-indigo-800/90 dark:text-indigo-200/90">{children}</div>
    </div>
  </div>
);

export const Good: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
    <CheckCircle2 className="h-4 w-4 shrink-0" /> {children}
  </p>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'good' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
    <p className={`mt-1 text-2xl font-black tracking-tight tabular-nums ${tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    {sub && <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{sub}</p>}
  </div>
);

// The one big answer of a step
export const Hero: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; chip?: React.ReactNode; tone?: 'violet' | 'emerald' | 'sky' | 'amber'; children?: React.ReactNode }> = ({
  label,
  value,
  sub,
  chip,
  tone = 'violet',
  children
}) => {
  const bg =
    tone === 'emerald'
      ? 'from-emerald-500 to-teal-600 shadow-emerald-600/20'
      : tone === 'sky'
      ? 'from-sky-500 to-indigo-600 shadow-sky-600/20'
      : tone === 'amber'
      ? 'from-amber-500 to-orange-600 shadow-amber-600/20'
      : 'from-indigo-600 via-violet-600 to-fuchsia-600 shadow-violet-600/25';
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${bg} p-5 text-white shadow-lg sm:p-6`}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-14 right-8 h-32 w-32 rounded-full bg-white/10" />
      <p className="relative text-xs font-bold uppercase tracking-widest text-white/75">{label}</p>
      <p className="relative mt-1 text-5xl font-black tracking-tight tabular-nums sm:text-6xl">{value}</p>
      {sub && <p className="relative mt-1.5 text-sm text-white/85">{sub}</p>}
      {chip && <div className="relative mt-3">{chip}</div>}
      {children && <div className="relative mt-4">{children}</div>}
    </div>
  );
};

export const Chip: React.FC<{ children: React.ReactNode; tone?: 'up' | 'down' | 'plain' }> = ({ children, tone = 'plain' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
      tone === 'up' ? 'bg-emerald-400/25 text-emerald-50' : tone === 'down' ? 'bg-rose-400/30 text-rose-50' : 'bg-white/20 text-white'
    }`}
  >
    {children}
  </span>
);

export const WhatsAppButton: React.FC<{ phone: string | null | undefined; text: string; label?: string }> = ({ phone, text, label = 'WhatsApp' }) => {
  const link = buildWhatsAppLink(phone, text);
  if (!link) return <span className="text-[11px] text-slate-400">No valid phone</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-500"
    >
      <MessageCircle className="h-3.5 w-3.5" /> {label}
    </a>
  );
};

// ------------------------------------------------------------------ one step at a time

export interface Step {
  id: string;
  label: string; // short, for the numbered chips
  title: string; // the heading of the step
  hint?: string; // one plain sentence under the heading
  icon?: React.ElementType;
  content: React.ReactNode;
}

// Shows ONE step at a time with Back / Next, so a tab never puts everything on the screen together.
export const Stepper: React.FC<{ steps: Step[]; resetKey?: string }> = ({ steps, resetKey }) => {
  const [i, setI] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setI(0);
  }, [resetKey]);
  const last = steps.length - 1;
  const idx = Math.min(i, last);
  const s = steps[idx];
  const go = (n: number) => {
    setI(Math.max(0, Math.min(last, n)));
    top.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  if (!s) return null;
  const Icon = s.icon;
  return (
    <div ref={top} className="scroll-mt-4" onKeyDown={(e) => (e.key === 'ArrowRight' ? go(idx + 1) : e.key === 'ArrowLeft' ? go(idx - 1) : undefined)}>
      {/* numbered steps */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Steps">
        {steps.map((x, n) => {
          const on = n === idx;
          return (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => go(n)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-3.5 text-xs font-bold transition-colors ${
                on ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${on ? 'bg-white/20' : n < idx ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>{n < idx ? '✓' : n + 1}</span>
              {x.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${((idx + 1) / steps.length) * 100}%`, transition: 'width .35s ease' }} />
      </div>

      {/* the step */}
      <div key={s.id} className="mt-5 space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Step {idx + 1} of {steps.length}
          </p>
          <h3 className="mt-0.5 flex items-center gap-2 text-xl font-black tracking-tight text-slate-900 sm:text-2xl dark:text-white">
            {Icon && <Icon className="h-5 w-5 shrink-0 text-indigo-500" />} {s.title}
          </h3>
          {s.hint && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{s.hint}</p>}
        </div>
        {s.content}
      </div>

      {/* back / next */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go(idx - 1)}
          disabled={idx === 0}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        {idx < last ? (
          <button
            type="button"
            onClick={() => go(idx + 1)}
            className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-violet-600/25 hover:opacity-95"
          >
            <span className="truncate">Next: {steps[idx + 1].label}</span> <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => go(0)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Back to the start
          </button>
        )}
      </div>
    </div>
  );
};

// Loads one tab's data when the tab opens, with the same loading and error look everywhere
export function useTabData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await load();
      if (alive.current) setData(r);
    } catch (e: any) {
      if (alive.current) setError(e?.message || 'Could not load this');
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, loading, error, reload: run };
}

export const TabState: React.FC<{ loading: boolean; error: string; hasData: boolean; reload: () => void; children: React.ReactNode }> = ({ loading, error, hasData, reload, children }) => {
  if (loading && !hasData) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
        Working this out
      </div>
    );
  }
  if (error && !hasData) {
    return (
      <div className="py-12 text-center">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-500" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{error}</p>
        <button type="button" onClick={reload} className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }
  return <>{children}</>;
};
