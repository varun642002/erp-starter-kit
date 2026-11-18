import React, { useState } from 'react';
import { Crown, MoonStar, Sparkles } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { analyticsApi, type CustomerRanking } from '../../services/analyticsApi';
import { Good, Hero, Note, Panel, Stat, Stepper, TabState, Tip, WhatsAppButton, compact, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

const ago = (days: number | null) => (days === null ? 'no date' : days < 30 ? `${days} days ago` : days < 365 ? `${Math.round(days / 30)} months ago` : `${(days / 365).toFixed(1)} years ago`);

const Person: React.FC<{ c: CustomerRanking['top'][number]; cur: string; rank?: number; extra?: React.ReactNode }> = ({ c, cur, rank, extra }) => (
  <li className="flex flex-wrap items-center gap-3 py-3">
    {rank !== undefined && (
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${rank === 1 ? 'bg-amber-400 text-white' : rank === 2 ? 'bg-slate-300 text-slate-700' : rank === 3 ? 'bg-orange-300 text-orange-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{rank}</span>
    )}
    <div className="min-w-0 flex-1">
      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{c.name}</p>
      <p className="text-[11px] text-slate-500">
        {c.city ? `${c.city} · ` : ''}
        {c.orders} purchase{c.orders === 1 ? '' : 's'}
        {c.machines > 0 ? ` · ${c.machines} machine${c.machines === 1 ? '' : 's'}` : ''} · last bought {ago(c.daysSinceLast)}
        {c.lastPurchase ? ` (${shortDate(c.lastPurchase)})` : ''}
      </p>
    </div>
    <div className="shrink-0 text-right">
      <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{compact(c.total, cur)}</p>
      {c.totalLast12 > 0 && <p className="text-[11px] text-slate-500">{compact(c.totalLast12, cur)} this year</p>}
    </div>
    {extra}
  </li>
);

// Best customers, customers who have gone quiet, and new ones.
export const RankTab: React.FC = () => {
  const { settings, selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const [quietDays, setQuietDays] = useState(180);
  const { data, loading, error, reload } = useTabData(() => analyticsApi.customerRanking(scope, branchParam, quietDays), [scope, branchParam, selectedBranchId, quietDays]);

  const steps: Step[] = [];
  if (data) {
    const s = data.summary;
    steps.push({
      id: 'top',
      label: 'Best customers',
      title: 'Your best customers',
      hint: 'Who has spent the most with you, across counter sales, invoices and machines.',
      icon: Crown,
      content: (
        <div className="space-y-4">
          <Hero label="Customers who have bought" value={s.buyers.toLocaleString('en-IN')} sub={s.top10SharePercent !== null ? `The top 10 bring ${s.top10SharePercent}% of the money` : undefined} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Bought in the last 90 days" value={s.activeLast90.toLocaleString('en-IN')} tone="good" />
            <Stat label="New in the last 30 days" value={s.newLast30.toLocaleString('en-IN')} />
          </div>
          {data.top.length === 0 ? (
            <Note>No purchases are saved against customers yet.</Note>
          ) : (
            <Panel title="Top 20 by total spent">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.top.map((c, i) => (
                  <Person key={c.customerId} c={c} cur={cur} rank={i + 1} />
                ))}
              </ul>
            </Panel>
          )}
          <p className="text-[11px] text-slate-400">{data.basis}</p>
        </div>
      )
    });

    steps.push({
      id: 'quiet',
      label: 'Gone quiet',
      title: 'Customers who stopped coming',
      hint: 'They bought before, but nothing for a long time. The ones who spent most are first.',
      icon: MoonStar,
      content: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Quiet for more than</span>
            {[90, 180, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setQuietDays(d)}
                className={`cursor-pointer rounded-full px-4 py-2 text-xs font-bold ${quietDays === d ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
              >
                {d === 365 ? '1 year' : `${Math.round(d / 30)} months`}
              </button>
            ))}
          </div>
          {data.quiet.length === 0 ? (
            <Good>No regular customer has been away that long</Good>
          ) : (
            <Panel title={`${data.quiet.length} customer${data.quiet.length === 1 ? '' : 's'} to win back`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.quiet.map((c) => (
                  <Person key={c.customerId} c={c} cur={cur} extra={<WhatsAppButton phone={c.phone} text={c.message} label="Message" />} />
                ))}
              </ul>
            </Panel>
          )}
          <Tip>Only customers with two or more purchases, or at least {cur}5,000 spent, are listed, so one-time small buyers do not crowd the list.</Tip>
        </div>
      )
    });

    steps.push({
      id: 'new',
      label: 'New customers',
      title: 'New customers this month',
      hint: 'First purchase in the last 30 days. A thank-you or a follow-up call makes them stay.',
      icon: Sparkles,
      content:
        data.fresh.length === 0 ? (
          <Note>No new customer has made a first purchase in the last 30 days.</Note>
        ) : (
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.fresh.map((c) => (
                <Person
                  key={c.customerId}
                  c={c}
                  cur={cur}
                  extra={<WhatsAppButton phone={c.phone} label="Thank" text={`Hello ${c.name}, thank you for buying from Acme Agro Equipment. Please call us anytime for spares, service or advice. We are happy to help.`} />}
                />
              ))}
            </ul>
          </Panel>
        )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey={`rank-${scope.branchId}-${branchParam}`} />}
    </TabState>
  );
};
