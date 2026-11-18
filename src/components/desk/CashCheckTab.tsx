import React, { useMemo } from 'react';
import { ArrowRight, CalendarX2, Scale } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { cashBookApi, type CashClosing } from '../../services/cashBookApi';
import { Good, Hero, Note, Panel, Stat, Stepper, TabState, Tip, full, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

const addDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// How the daily cash count went: days the drawer did not match, and days nobody closed the cash book.
export const CashCheckTab: React.FC = () => {
  const { settings, selectedBranchId, branches, setCurrentView } = useERP();
  const { scope, branchParam, assignedBranchId } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const branchKey = branchParam || assignedBranchId || 'all';
  const { data, loading, error, reload } = useTabData(() => cashBookApi.listClosings(scope, branchKey, 120), [scope, branchKey, selectedBranchId]);
  const name = (id: string) => branches.find((b) => b.id === id)?.name || id;

  const view = useMemo(() => {
    const rows: CashClosing[] = (data || []).filter((c) => c.businessDate >= addDays(today(), -30)).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
    const off = rows.filter((c) => Math.abs(c.variance) >= 1);
    const short = off.filter((c) => c.variance < 0).reduce((s, c) => s + c.variance, 0);
    const over = off.filter((c) => c.variance > 0).reduce((s, c) => s + c.variance, 0);
    // days in the last week with no closing, for each branch that closes at all
    const closedBy = new Map<string, Set<string>>();
    for (const c of data || []) {
      if (!closedBy.has(c.branchId)) closedBy.set(c.branchId, new Set());
      closedBy.get(c.branchId)!.add(c.businessDate);
    }
    const missing: { branchId: string; days: string[] }[] = [];
    for (const [bid, set] of closedBy) {
      const days: string[] = [];
      for (let i = 1; i <= 7; i++) {
        const d = addDays(today(), -i);
        if (!set.has(d)) days.push(d);
      }
      if (days.length) missing.push({ branchId: bid, days });
    }
    return { rows, off, short, over, missing };
  }, [data]);

  const steps: Step[] = [];
  if (data) {
    steps.push({
      id: 'diff',
      label: 'Differences',
      title: 'Did the cash match?',
      hint: 'Counted cash against what the books say should be in the drawer. The last 30 days.',
      icon: Scale,
      content: (
        <div className="space-y-4">
          <Hero
            tone={view.off.length === 0 ? 'emerald' : 'amber'}
            label="Days the cash did not match"
            value={view.off.length}
            sub={view.rows.length ? `out of ${view.rows.length} closed day${view.rows.length === 1 ? '' : 's'}` : 'No day has been closed in the last 30 days'}
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total short" value={full(Math.abs(view.short), cur)} tone={view.short < 0 ? 'bad' : undefined} sub="counted less than expected" />
            <Stat label="Total extra" value={full(view.over, cur)} sub="counted more than expected" />
          </div>
          {view.rows.length === 0 ? (
            <Note>Nothing to show yet. Close the day in the Cash Book each evening and it will appear here.</Note>
          ) : view.off.length === 0 ? (
            <Good>Every closed day matched the cash book</Good>
          ) : (
            <Panel title="Days that did not match">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.off.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {shortDate(c.businessDate)}
                        {branchKey === 'all' ? <span className="font-normal text-slate-500"> · {name(c.branchId)}</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Expected {full(c.expectedCash, cur)} · counted {full(c.countedCash, cur)}
                        {c.closedBy ? ` · by ${c.closedBy}` : ''}
                      </p>
                      {c.notes && <p className="text-[11px] italic text-slate-400">{c.notes}</p>}
                    </div>
                    <p className={`shrink-0 text-base font-black tabular-nums ${c.variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {c.variance > 0 ? '+' : '-'}
                      {full(Math.abs(c.variance), cur)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <button type="button" onClick={() => setCurrentView('cash-book')} className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
            Open the Cash Book to close a day <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )
    });

    steps.push({
      id: 'missing',
      label: 'Not closed',
      title: 'Days nobody closed the cash book',
      hint: 'The last 7 days, for every branch that closes its cash.',
      icon: CalendarX2,
      content:
        view.missing.length === 0 ? (
          <Good>Every branch closed all of the last 7 days</Good>
        ) : (
          <div className="space-y-4">
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.missing.map((m) => (
                  <li key={m.branchId} className="py-2.5">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{name(m.branchId)}</p>
                    <p className="mt-0.5 flex flex-wrap gap-1.5">
                      {m.days.map((d) => (
                        <span key={d} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                          {shortDate(d)}
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
            <Tip>A day with no closing means nobody counted the drawer, so a missing amount would go unnoticed. Closing takes a minute in the Cash Book.</Tip>
          </div>
        )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey={`cash-${branchKey}`} />}
    </TabState>
  );
};
