import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarDays, CalendarRange, HelpCircle, Package, Target, Tractor } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { useApiScope } from '../../documents/ui';
import { analyticsApi } from '../../../services/analyticsApi';
import { Chip, Hero, Note, Panel, Stat, Stepper, TabState, Tip, compact, full, useTabData, type Step } from './ui';

const ind = (n: number) => Math.round(n).toLocaleString('en-IN');

export const OutlookTab: React.FC = () => {
  const { settings, selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const { data, loading, error, reload } = useTabData(() => analyticsApi.outlook(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const [period, setPeriod] = useState(0);

  const chart = useMemo(() => {
    if (!data) return [];
    const rows: { label: string; units: number; kind: 'sold' | 'gap' | 'now' | 'forecast' }[] = data.history.map((y) => ({
      label: y.label,
      units: y.units,
      kind: y.fy === data.thisFy ? 'now' : y.recorded ? 'sold' : 'gap'
    }));
    // this year: sold so far plus what is still expected; the next year: all expected
    const now = data.periods[0];
    const cell = rows.find((r) => r.kind === 'now');
    if (cell) cell.units = now.totalUnits;
    rows.push({ label: data.periods[1].label, units: data.periods[1].totalUnits, kind: 'forecast' });
    return rows;
  }, [data]);

  const steps: Step[] = [];
  if (data) {
    const p = data.periods[period];
    const [thisYear, nextYear] = data.periods;
    const change = thisYear.totalUnits > 0 ? Math.round(((nextYear.totalUnits - thisYear.totalUnits) / thisYear.totalUnits) * 100) : null;
    const maxModel = Math.max(1, ...data.models.map((m) => m.next12));

    steps.push({
      id: 'answer',
      label: 'The answer',
      title: `How many machines in ${nextYear.label}?`,
      hint: 'The short answer first. The next steps show how we got there.',
      icon: Target,
      content: (
        <div className="space-y-4">
          <Hero
            label={`Machines expected in ${nextYear.label}`}
            value={ind(nextYear.totalUnits)}
            sub={
              <>
                Most likely between <b className="text-white">{ind(nextYear.low)}</b> and <b className="text-white">{ind(nextYear.high)}</b> machines, worth about <b className="text-white">{compact(nextYear.totalValue, cur)}</b>
              </>
            }
            chip={change !== null ? <Chip tone={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '+' : ''}{change}% against {thisYear.label}</Chip> : undefined}
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`${thisYear.label}, whole year`} value={ind(thisYear.totalUnits)} sub={`${thisYear.soldSoFar} sold so far · about ${compact(thisYear.totalValue, cur)}`} />
            <Stat label="Recent years' average" value={ind(data.method.historyLevel)} sub="machines a year, from the old bills" />
            <Stat label="This year's pace" value={data.method.paceLevel === null ? '-' : ind(data.method.paceLevel)} sub="machines a year at today's rate" />
            <Stat label="Average price" value={compact(data.method.avgPrice, cur)} sub="for one machine" />
          </div>
          <Tip>
            This blends two things: what the shop sold in recent years, and how fast it is selling this year. Subsidy schemes, rain and prices can still move it either way.
          </Tip>
        </div>
      )
    });

    steps.push({
      id: 'years',
      label: 'Year by year',
      title: 'Machines sold each year',
      hint: 'The last bar is the year ahead.',
      icon: BarChart3,
      content: (
        <div className="space-y-4">
          <Panel
            title="Machines per year"
            right={
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-500" /> Sold</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> This year</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" /> Expected</span>
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip
                    formatter={(v: any, _n: any, item: any) => [`${ind(Number(v))} machines${item?.payload?.kind === 'gap' ? ' (no full records)' : item?.payload?.kind === 'forecast' ? ' (expected)' : item?.payload?.kind === 'now' ? ' (sold + expected)' : ''}`, 'Machines']}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="units" radius={[8, 8, 0, 0]} animationDuration={900} label={{ position: 'top', fontSize: 10, fill: '#64748b', fontWeight: 700 }}>
                    {chart.map((r, i) => (
                      <Cell key={i} fill={r.kind === 'forecast' ? '#8b5cf6' : r.kind === 'now' ? '#10b981' : r.kind === 'gap' ? '#cbd5e1' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Tip>A grey bar means that year has no full records on the old bills, so it is not used to work out the forecast.</Tip>
        </div>
      )
    });

    steps.push({
      id: 'months',
      label: 'Month by month',
      title: 'Which months are busy',
      hint: 'Pick a year to see how its machines are spread across the months.',
      icon: CalendarDays,
      content: (
        <Panel
          title="Machines per month"
          right={
            <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {data.periods.map((x, i) => (
                <button key={x.fy} type="button" onClick={() => setPeriod(i)} className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${period === i ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white' : 'text-slate-500'}`}>
                  {x.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-no-stack="true">
              <thead className="text-[11px] text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-bold">Month</th>
                  <th className="px-2 py-2 text-right font-bold">Machines</th>
                  <th className="px-2 py-2 text-right font-bold">Range</th>
                  <th className="px-2 py-2 text-right font-bold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {p.months.map((m) => (
                  <tr key={m.month} className={m.past ? 'text-slate-500' : ''}>
                    <td className="px-2 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                      {m.label}
                      {m.past && m.actual !== null && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">sold</span>}
                      {m.past && m.actual === null && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-400 dark:bg-slate-800">no records</span>}
                      {!m.past && m.actual !== null && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">{m.actual} sold so far</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right text-sm font-extrabold text-slate-900 dark:text-white">{m.past ? (m.actual === null ? '-' : ind(m.expected)) : `≈ ${ind(m.expected)}`}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right text-slate-500">{m.past ? '-' : `${ind(m.low)} to ${ind(m.high)}`}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">{m.past && m.actual === null ? '-' : full(m.value, cur)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="px-2 py-2.5">Whole year</td>
                  <td className="px-2 py-2.5 text-right text-sm font-extrabold">{ind(p.totalUnits)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right text-slate-500">{`${ind(p.low)} to ${ind(p.high)}`}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right">{full(p.totalValue, cur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )
    });

    steps.push({
      id: 'weeks',
      label: 'Week by week',
      title: 'The weeks around today',
      hint: 'Green is this week, purple is what we expect for the weeks ahead.',
      icon: CalendarRange,
      content: (
        <div className="space-y-4">
          <Panel title="Machines per week">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weeks.map((w) => ({ ...w, shown: w.kind === 'next' ? w.expected : w.actual ?? 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip
                    formatter={(v: any, _n: any, item: any) => [`${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} machines${item?.payload?.kind === 'next' ? ' (expected)' : ''}`, `Week of ${item?.payload?.label}`]}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="shown" radius={[6, 6, 0, 0]}>
                    {data.weeks.map((w) => (
                      <Cell key={w.start} fill={w.kind === 'next' ? '#8b5cf6' : w.kind === 'now' ? '#10b981' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Week list">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs" data-no-stack="true">
                <thead className="sticky top-0 bg-white/95 text-[11px] text-slate-500 dark:bg-slate-900/95">
                  <tr>
                    <th className="px-2 py-2 font-bold">Week starting</th>
                    <th className="px-2 py-2 text-right font-bold">Machines</th>
                    <th className="px-2 py-2 text-right font-bold">Range</th>
                    <th className="px-2 py-2 text-right font-bold">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.weeks.map((w) => (
                    <tr key={w.start} className={w.kind === 'past' ? 'text-slate-500' : ''}>
                      <td className="px-2 py-2 font-semibold text-slate-800 dark:text-slate-100">
                        Mon {w.label}
                        {w.kind === 'now' && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">this week</span>}
                        {w.kind === 'past' && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">{w.actual === null ? 'no records' : 'sold'}</span>}
                      </td>
                      <td className="px-2 py-2 text-right font-extrabold text-slate-900 dark:text-white">{w.kind === 'past' ? (w.actual === null ? '-' : ind(w.actual)) : w.kind === 'now' ? `${w.actual ?? 0} sold · ≈ ${w.expected}` : `≈ ${w.expected}`}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-slate-500">{w.kind === 'past' ? '-' : `${w.low} to ${w.high}`}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{w.kind === 'past' ? '-' : full(w.value, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )
    });

    steps.push({
      id: 'models',
      label: 'Which machines',
      title: `Which machines will be needed in ${nextYear.label}`,
      hint: 'The expected machines are split by how much each model has sold before.',
      icon: Tractor,
      content:
        data.models.length === 0 ? (
          <Note>There are no machine sales to work from yet.</Note>
        ) : (
          <Panel>
            <ul className="space-y-3.5">
              {data.models.map((m) => (
                <li key={m.model}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-white">{m.model}</p>
                    <p className="shrink-0 text-lg font-black tabular-nums text-slate-900 dark:text-white">{ind(m.next12)}</p>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.max(3, (m.next12 / maxModel) * 100)}%`, transition: 'width .8s ease' }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{m.share}% of the machines sold</p>
                </li>
              ))}
            </ul>
          </Panel>
        )
    });

    steps.push({
      id: 'spares',
      label: 'Spares',
      title: 'Spares and parts on the old bills',
      hint: 'What sold most on the old bills, to help you decide what to keep in stock.',
      icon: Package,
      content:
        data.oldItems.length === 0 ? (
          <Note>No old bills with spares were found.</Note>
        ) : (
          <Panel>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-left text-xs" data-no-stack="true">
                <thead className="sticky top-0 bg-white/95 text-[11px] text-slate-500 dark:bg-slate-900/95">
                  <tr>
                    <th className="px-2 py-2 font-bold">Item</th>
                    <th className="px-2 py-2 text-right font-bold">Average a year</th>
                    <th className="px-2 py-2 text-right font-bold">Best year</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.oldItems.map((it) => (
                    <tr key={it.name}>
                      <td className="px-2 py-2.5 text-slate-800 dark:text-slate-100">{it.name}</td>
                      <td className="px-2 py-2.5 text-right font-extrabold text-slate-900 dark:text-white">{ind(it.avgPerYear)}</td>
                      <td className="px-2 py-2.5 text-right text-slate-500">{ind(Math.max(...it.perYear.map((y) => y.qty)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
    });

    steps.push({
      id: 'how',
      label: 'How it is worked out',
      title: 'How these numbers are worked out',
      hint: 'In plain words.',
      icon: HelpCircle,
      content: (
        <Panel>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {data.method.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>
              A full year is expected at about {ind(data.method.expected)} machines (between {ind(data.method.low)} and {ind(data.method.high)}), at about {full(data.method.avgPrice, cur)} each.
            </li>
            <li>These are estimates from past sales. Subsidy schemes, rain and prices can move them either way.</li>
          </ul>
        </Panel>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey={`outlook-${scope}-${branchParam}`} />}
    </TabState>
  );
};
