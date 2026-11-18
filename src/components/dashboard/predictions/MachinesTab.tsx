import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarDays, Gauge, Layers, Tractor, Users } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { useApiScope } from '../../documents/ui';
import { analyticsApi } from '../../../services/analyticsApi';
import { Hero, Note, Panel, Stat, Stepper, TabState, Tip, compact, full, useTabData, type Step } from './ui';

const ind = (n: number) => Math.round(n).toLocaleString('en-IN');
const MONTH_FULL: Record<string, string> = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };

// Every machine figure in one place, one step at a time: the key numbers, years, months, models and buyers.
export const MachinesTab: React.FC = () => {
  const { settings, selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const { data, loading, error, reload } = useTabData(() => analyticsApi.machines(scope, branchParam), [scope, branchParam, selectedBranchId]);

  const steps: Step[] = [];
  if (data && data.kpis.totalUnits > 0) {
    const k = data.kpis;
    const yearChart = data.years.map((y) => ({ label: y.label, units: y.units, recorded: y.recorded }));
    const gridMax = Math.max(1, ...data.grid.flatMap((g) => g.months));

    steps.push({
      id: 'numbers',
      label: 'Key numbers',
      title: 'The shop in numbers',
      hint: 'Every machine sold, counted from the bills.',
      icon: Gauge,
      content: (
        <div className="space-y-4">
          <Hero tone="emerald" label="Machines sold in all" value={ind(k.totalUnits)} sub={`${k.firstYear} to ${k.lastYear} · worth ${compact(k.totalValue, cur)} · about ${full(k.avgPrice, cur)} a machine`} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Best year" value={k.bestYear?.label ?? '-'} sub={k.bestYear ? `${ind(k.bestYear.units)} machines` : undefined} tone="good" />
            <Stat
              label="Last two full years"
              value={k.growth ? `${k.growth.percent > 0 ? '+' : ''}${k.growth.percent}%` : '-'}
              sub={k.growth ? `${k.growth.from} to ${k.growth.to}` : 'not enough full years'}
              tone={k.growth && k.growth.percent < 0 ? 'bad' : 'good'}
            />
            <Stat label="Busiest month" value={k.bestMonth ? MONTH_FULL[k.bestMonth.name] : '-'} sub={k.bestMonth ? `${ind(k.bestMonth.units)} machines, all years` : undefined} />
            <Stat label="Quietest month" value={k.quietMonth ? MONTH_FULL[k.quietMonth.name] : '-'} sub={k.quietMonth ? `${ind(k.quietMonth.units)} machines, all years` : undefined} />
            <Stat label="February and March" value={`${k.peakShare}%`} sub="of all machines sold" />
            <Stat label="Average a month" value={String(k.avgPerMonth)} sub="in the years with full records" />
            <Stat label="Buyers" value={ind(k.buyers)} sub={k.biggestBuyer ? `most: ${k.biggestBuyer.name} (${k.biggestBuyer.units})` : undefined} />
            <Stat label="On bills with no date" value={ind(k.noDateUnits)} sub="not counted in the years" />
          </div>
        </div>
      )
    });

    steps.push({
      id: 'years',
      label: 'Year by year',
      title: 'How each year went',
      hint: 'Years run from April to March.',
      icon: BarChart3,
      content: (
        <div className="space-y-4">
          <Panel title="Machines per year">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearChart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(v: any) => [`${ind(Number(v))} machines`, 'Sold']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="units" radius={[8, 8, 0, 0]} label={{ position: 'top', fontSize: 10, fill: '#64748b', fontWeight: 700 }} animationDuration={900}>
                    {yearChart.map((y) => (
                      <Cell key={y.label} fill={y.recorded ? '#6366f1' : '#cbd5e1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Year by year, in detail">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs" data-no-stack="true">
                <thead className="text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-bold">Year</th>
                    <th className="px-2 py-2 text-right font-bold">Machines</th>
                    <th className="px-2 py-2 text-right font-bold">Change</th>
                    <th className="px-2 py-2 text-right font-bold">Value</th>
                    <th className="px-2 py-2 text-right font-bold">Average price</th>
                    <th className="px-2 py-2 font-bold">Most sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.years.map((y) => (
                    <tr key={y.fy} className={y.units === 0 ? 'text-slate-400' : ''}>
                      <td className="px-2 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                        {y.label}
                        {!y.recorded && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-400 dark:bg-slate-800">{y.units ? 'part year' : 'no records'}</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-extrabold">{ind(y.units)}</td>
                      <td className={`px-2 py-2.5 text-right font-bold ${y.growth === null ? 'text-slate-400' : y.growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{y.growth === null ? '-' : `${y.growth > 0 ? '+' : ''}${y.growth}%`}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{y.units ? compact(y.value, cur) : '-'}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{y.avgPrice ? full(y.avgPrice, cur) : '-'}</td>
                      <td className="px-2 py-2.5 text-slate-600 dark:text-slate-300">{y.topModel ?? '-'}</td>
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
      id: 'months',
      label: 'Months',
      title: 'Which months machines sell',
      hint: 'February and March are usually the busiest.',
      icon: CalendarDays,
      content: (
        <div className="space-y-4">
          <Panel title="All years together, month by month">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthTotals} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(v: any) => [`${ind(Number(v))} machines`, 'Sold']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="units" radius={[8, 8, 0, 0]} label={{ position: 'top', fontSize: 10, fill: '#64748b', fontWeight: 700 }}>
                    {data.monthTotals.map((m, i) => (
                      <Cell key={m.name} fill={i === 1 || i === 2 ? '#8b5cf6' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Each month of each year">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-center text-[11px]" data-no-stack="true">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-bold">Year</th>
                    {data.gridMonths.map((m) => (
                      <th key={m} className="px-1 py-1.5 font-bold">
                        {m}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.grid.map((g) => (
                    <tr key={g.fy}>
                      <td className="px-2 py-1 text-left font-semibold text-slate-700 dark:text-slate-200">{g.label}</td>
                      {g.months.map((n, i) => (
                        <td key={i} className="px-0.5 py-0.5">
                          <div className="rounded-md py-1.5 font-semibold" style={{ background: n ? `rgba(16,185,129,${0.12 + 0.75 * (n / gridMax)})` : 'transparent', color: n / gridMax > 0.55 ? '#fff' : undefined }}>
                            {n || ''}
                          </div>
                        </td>
                      ))}
                      <td className="px-2 py-1 font-extrabold text-slate-900 dark:text-white">{g.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Tip>The darker the green box, the more machines sold that month.</Tip>
        </div>
      )
    });

    steps.push({
      id: 'types',
      label: 'Models',
      title: 'Which machines sell',
      hint: 'By type, and model by model.',
      icon: Layers,
      content: (
        <div className="space-y-4">
          <Panel title={<><Tractor className="h-4 w-4 text-indigo-500" /> Type of machine, year by year</>}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.kinds} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Rotavator" stackId="k" fill="#6366f1" />
                  <Bar dataKey="Baler" stackId="k" fill="#f59e0b" />
                  <Bar dataKey="Tractor" stackId="k" fill="#10b981" />
                  <Bar dataKey="Other" stackId="k" fill="#cbd5e1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Each machine over all the years">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-no-stack="true">
                <thead className="text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-bold">Machine</th>
                    <th className="px-2 py-2 text-right font-bold">Sold</th>
                    <th className="px-2 py-2 text-right font-bold">Value</th>
                    <th className="px-2 py-2 text-right font-bold">Average</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.modelTotals.map((m) => (
                    <tr key={m.model}>
                      <td className="px-2 py-2.5 font-semibold text-slate-800 dark:text-slate-100">{m.model}</td>
                      <td className="px-2 py-2.5 text-right font-extrabold">{ind(m.units)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{compact(m.value, cur)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-slate-500">{full(m.avgPrice, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Which machines sold, by year">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs" data-no-stack="true">
                <thead className="text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-bold">Year</th>
                    {data.models.map((m) => (
                      <th key={m} className="px-2 py-2 text-right font-bold">
                        {m}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-bold">Other</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.modelsByYear.map((y) => (
                    <tr key={y.fy}>
                      <td className="px-2 py-2.5 font-semibold text-slate-800 dark:text-slate-100">{y.label}</td>
                      {y.counts.map((n, i) => (
                        <td key={i} className={`px-2 py-2.5 text-right ${n ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-300'}`}>
                          {n || '-'}
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-right text-slate-500">{y.other || '-'}</td>
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
      id: 'buyers',
      label: 'Buyers',
      title: 'Who bought the most machines',
      hint: 'Your best customers by number of machines.',
      icon: Users,
      content: (
        <div className="space-y-4">
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.buyers.map((b, i) => (
                <li key={b.name} className="flex items-center gap-3 py-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{i + 1}</span>
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{b.name}</p>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{ind(b.units)}</p>
                    <p className="text-[11px] text-slate-500">{compact(b.value, cur)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Tip title="Good to know">Group buyers (such as farmer groups) appear as one buyer, as written on the bill.</Tip>
        </div>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && (data.kpis.totalUnits === 0 ? <Note>No machine sales are recorded yet.</Note> : <Stepper steps={steps} resetKey={`machines-${scope}-${branchParam}`} />)}
    </TabState>
  );
};
