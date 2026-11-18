import React, { useMemo, useState } from 'react';
import { History, Percent, ShieldQuestion } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { deskApi } from '../../services/deskApi';
import { Good, Hero, Note, Panel, Stepper, TabState, Tip, full, useTabData, type Step } from '../dashboard/predictions/ui';

const DAYS = [7, 30];
const TRAIL_DAYS = [1, 7, 30];
const PERCENTS = [10, 15, 25];
const FLAG = /^(edited|deleted|cancel+ed|reopened|voided|removed|reversed|rejected)/i;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

const Choice: React.FC<{ label: string; on: boolean; onClick: () => void }> = ({ label, on, onClick }) => (
  <button type="button" onClick={onClick} className={`cursor-pointer rounded-full px-4 py-2 text-xs font-bold ${on ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
    {label}
  </button>
);

// Things worth a second look: bills that were edited or deleted, cancelled handovers, and big discounts.
export const ChecksTab: React.FC = () => {
  const { auditLogs, settings, selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const [days, setDays] = useState(7);
  const [percent, setPercent] = useState(15);
  const [trailDays, setTrailDays] = useState(7);
  const [who, setWho] = useState('');
  const [whoQuery, setWhoQuery] = useState('');
  const trail = useTabData(() => deskApi.activity(scope, branchParam, trailDays, whoQuery), [scope, branchParam, selectedBranchId, trailDays, whoQuery]);
  const disc = useTabData(() => deskApi.discounts(scope, branchParam, days, percent), [scope, branchParam, selectedBranchId, days, percent]);

  const flagged = useMemo(() => {
    const since = Date.now() - days * 86_400_000;
    return auditLogs
      .filter((l) => {
        const t = new Date(l.timestamp).getTime();
        return Number.isFinite(t) && t >= since && (FLAG.test(l.action.trim()) || l.severity === 'critical');
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 60);
  }, [auditLogs, days]);

  const range = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">Look back</span>
      {DAYS.map((d) => (
        <Choice key={d} label={`${d} days`} on={days === d} onClick={() => setDays(d)} />
      ))}
    </div>
  );

  const steps: Step[] = [
    {
      id: 'changes',
      label: 'Edits and deletions',
      title: 'Bills and records that were changed',
      hint: 'Anything edited, deleted, cancelled or reopened. Most of it is normal. Look for patterns.',
      icon: ShieldQuestion,
      content: (
        <div className="space-y-4">
          {range}
          <Hero tone={flagged.length ? 'amber' : 'emerald'} label={`Changes in the last ${days} days`} value={flagged.length} sub="edits, deletions, cancellations and reopened days" />
          {flagged.length === 0 ? (
            <Good>Nothing was edited or deleted</Good>
          ) : (
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {flagged.map((l) => (
                  <li key={l.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-white">{l.action}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{when(l.timestamp)}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{l.details}</p>
                    <p className="text-[11px] text-slate-500">
                      {l.user} · {l.role}
                      {l.branchName ? ` · ${l.branchName}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Tip>Only the latest records the app holds are listed. For the full trail, open Activity Logs.</Tip>
        </div>
      )
    },
    {
      id: 'trail',
      label: 'Who did what',
      title: 'Everything staff changed',
      hint: 'Every sale, payment, edit, deletion and cash entry, with who did it. Kept for 180 days.',
      icon: History,
      content: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Look back</span>
            {TRAIL_DAYS.map((d) => (
              <Choice key={d} label={d === 1 ? 'Today and yesterday' : `${d} days`} on={trailDays === d} onClick={() => setTrailDays(d)} />
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setWhoQuery(who.trim());
            }}
            className="flex gap-2"
          >
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Search a person, a bill number or a word" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            <button type="submit" className="cursor-pointer rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500">
              Search
            </button>
          </form>
          <TabState loading={trail.loading} error={trail.error} hasData={!!trail.data} reload={trail.reload}>
            {trail.data &&
              (trail.data.length === 0 ? (
                <Good>Nothing recorded for this search</Good>
              ) : (
                <Panel title={`${trail.data.length}${trail.data.length >= 300 ? '+' : ''} change${trail.data.length === 1 ? '' : 's'}`}>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {trail.data.map((a) => (
                      <li key={a.id} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className={`min-w-0 break-words text-sm font-bold ${a.method === 'DELETE' ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>{a.summary}</p>
                          <span className="shrink-0 text-[11px] text-slate-400">{when(a.at)}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {a.actor || 'Unknown'}
                          {a.role ? ` · ${a.role}` : ''}
                          {a.branchName ? ` · ${a.branchName}` : ''}
                          {a.entityId ? <span className="font-mono"> · {a.entityId}</span> : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
          </TabState>
          <Tip>Deletions are shown in red. The trail starts from the day it was switched on; earlier history is in Activity Logs.</Tip>
        </div>
      )
    },
    {
      id: 'discounts',
      label: 'Big discounts',
      title: 'Counter sales with a big discount',
      hint: 'Quick sales where the discount was a large share of the price.',
      icon: Percent,
      content: (
        <div className="space-y-4">
          {range}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Discount of at least</span>
            {PERCENTS.map((p) => (
              <Choice key={p} label={`${p}%`} on={percent === p} onClick={() => setPercent(p)} />
            ))}
          </div>
          <TabState loading={disc.loading} error={disc.error} hasData={!!disc.data} reload={disc.reload}>
            {disc.data &&
              (disc.data.items.length === 0 ? (
                <Good>No sale had a discount of {percent}% or more</Good>
              ) : (
                <Panel title={`${disc.data.items.length} sale${disc.data.items.length === 1 ? '' : 's'}`}>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {disc.data.items.map((d) => (
                      <li key={d.saleId} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-bold text-slate-900 dark:text-white">
                            <span className="font-mono text-blue-600 dark:text-blue-400">{d.saleNumber}</span> · {d.customerName}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {d.branchName}
                            {d.createdBy ? ` · by ${d.createdBy}` : ''} · {when(d.createdAt)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-black tabular-nums text-rose-600">{d.percent}% off</p>
                          <p className="text-[11px] text-slate-500">
                            {full(d.discount, cur)} off a {full(d.grandTotal, cur)} bill
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
          </TabState>
          <Note>Overall and per-item discounts are added together. A big discount is not wrong by itself (a regular customer, an old item), but it is worth knowing who gives them.</Note>
        </div>
      )
    }
  ];

  return <Stepper steps={steps} resetKey="checks" />;
};
