import React, { useEffect, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, CalendarDays, CloudRain, LineChart, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { Predictions } from '../../../services/analyticsApi';
import { Chip, Hero, Note, Panel, Stat, Stepper, Tip, compact, full, shortDate, type Step } from './ui';

// The big number counts up when it first appears
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let step = 0;
    const steps = 24;
    const id = window.setInterval(() => {
      step++;
      const t = Math.min(1, step / steps);
      setV(target * (1 - Math.pow(1 - t, 3)));
      if (t >= 1) window.clearInterval(id);
    }, ms / steps);
    return () => window.clearInterval(id);
  }, [target, ms]);
  return v;
}

const GlassTip: React.FC<any> = ({ active, payload, label, cur }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as { actual?: number; forecast?: number; band?: [number, number] };
  const isForecast = row.actual === undefined || row.band !== undefined;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
      <p className="font-bold text-slate-800 dark:text-slate-100">Week of {label}</p>
      {isForecast && row.forecast !== undefined ? (
        <>
          <p className="text-violet-600 dark:text-violet-300">Expected {full(row.forecast, cur)}</p>
          {row.band && (
            <p className="text-slate-500">
              Likely {full(row.band[0], cur)} to {full(row.band[1], cur)}
            </p>
          )}
        </>
      ) : (
        <p className="text-indigo-600 dark:text-indigo-300">Sold {full(row.actual || 0, cur)}</p>
      )}
    </div>
  );
};

const SEASON_BADGE: Record<string, string> = { Peak: 'bg-rose-500', Busy: 'bg-amber-500', Steady: 'bg-sky-500' };

export const OverviewTab: React.FC<{ data: Predictions; cur: string; onOpenSeason: () => void }> = ({ data, cur, onOpenSeason }) => {
  const sales = data.sales;
  const heroValues = sales.enoughData ? sales.next30Days : sales.pace?.next30 ?? null;
  const expected = useCountUp(heroValues ? heroValues.expected : 0);
  const trend = sales.trendPercent;

  // Real weeks first, then the expected weeks; the dashed line starts from the last real week so the two meet.
  const chart: { label: string; actual?: number; forecast?: number; band?: [number, number] }[] = [
    ...sales.weeks.map((w) => ({ label: shortDate(w.weekStart), actual: w.total })),
    ...sales.nextWeeks.map((w) => ({ label: shortDate(w.weekStart), forecast: w.total, band: [w.low ?? w.total, w.high ?? w.total] as [number, number] }))
  ];
  if (sales.enoughData && sales.weeks.length && sales.nextWeeks.length) chart[sales.weeks.length - 1].forecast = chart[sales.weeks.length - 1].actual;
  const todayLabel = sales.weeks.length ? chart[sales.weeks.length - 1]?.label : undefined;
  const spark = [...sales.weeks.slice(-6).map((w) => w.total), ...sales.nextWeeks.map((w) => w.total)];
  const sparkMax = Math.max(1, ...spark);

  const real = sales.weeks.map((w) => w.total);
  const avgWeek = real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
  let best: { weekStart: string; total: number } | null = null;
  for (const w of sales.weeks) if (!best || w.total > best.total) best = w;
  const lastWeek = sales.weeks.length ? sales.weeks[sales.weeks.length - 1] : null;
  const nextAvg = sales.nextWeeks.length ? sales.nextWeeks.reduce((a, w) => a + w.total, 0) / sales.nextWeeks.length : 0;

  const steps: Step[] = [];

  // ---- 1. the next 30 days
  steps.push({
    id: 'next30',
    label: 'Next 30 days',
    title: 'What the next 30 days look like',
    hint: 'The money you can expect from sales over the coming month.',
    icon: Sparkles,
    content: heroValues ? (
      <div className="space-y-4">
        <Hero
          label={sales.enoughData ? 'Expected sales, next 30 days' : 'At the current pace, next 30 days'}
          value={compact(expected, cur)}
          sub={
            <>
              Most likely between <b className="text-white">{compact(heroValues.low, cur)}</b> and <b className="text-white">{compact(heroValues.high, cur)}</b>
            </>
          }
          chip={
            trend !== null && trend !== undefined ? (
              <Chip tone={trend >= 0 ? 'up' : 'down'}>
                {trend >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {trend >= 0 ? '+' : ''}
                {trend}% against the 4 weeks before
              </Chip>
            ) : undefined
          }
        >
          {sales.enoughData && (
            <>
              <div className="flex h-16 items-end gap-1.5" aria-hidden>
                {spark.map((v, i) => (
                  <div key={i} className={`flex-1 rounded-t-md ${i >= spark.length - sales.nextWeeks.length ? 'bg-white/90' : 'bg-white/35'}`} style={{ height: `${Math.max(8, (v / sparkMax) * 100)}%` }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] font-semibold text-white/65">
                <span>Recent weeks</span>
                <span>Next 4 weeks</span>
              </div>
            </>
          )}
        </Hero>
        {!sales.enoughData && sales.pace && (
          <Note>
            This is worked out from about {compact(sales.pace.perDay, cur)} a day over the last {sales.pace.days} days. A week-by-week forecast with a chart appears after 4 full weeks of sales.
          </Note>
        )}
        {sales.enoughData && (
          <Tip>
            If nothing unusual happens, the shop should sell about {compact(heroValues.expected, cur)} in the next 30 days. The range shows how far it could reasonably go either way.
          </Tip>
        )}
      </div>
    ) : (
      <Note>Sales prediction needs at least a week of sales. Keep recording sales and it will appear here.</Note>
    )
  });

  // ---- 2. week by week
  if (sales.enoughData && chart.length > 0) {
    steps.push({
      id: 'weekly',
      label: 'Week by week',
      title: 'Sold so far, and what comes next',
      hint: 'Each point is one week. The dotted purple line is what we expect.',
      icon: LineChart,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="An average week" value={compact(avgWeek, cur)} sub={`over the last ${real.length} weeks`} />
            <Stat label="Last full week" value={lastWeek ? compact(lastWeek.total, cur) : '-'} sub={lastWeek ? `week of ${shortDate(lastWeek.weekStart)}` : undefined} tone={lastWeek && lastWeek.total >= avgWeek ? 'good' : undefined} />
            <Stat label="Best week so far" value={best ? compact(best.total, cur) : '-'} sub={best ? `week of ${shortDate(best.weekStart)}` : undefined} />
            <Stat label="Next 4 weeks, each" value={compact(nextAvg, cur)} sub="expected on average" />
          </div>
          <Panel
            title="Weekly sales"
            right={
              <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-500" /> Sold</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-fuchsia-500" /> Expected</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-300" /> Likely range</span>
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pa-actual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="pa-band" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c084fc" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#c084fc" stopOpacity={0.08} />
                    </linearGradient>
                    <linearGradient id="pa-line" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#d946ef" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => compact(v, cur)} />
                  <Tooltip content={<GlassTip cur={cur} />} cursor={{ stroke: '#a78bfa', strokeDasharray: '3 3' }} />
                  {todayLabel && <ReferenceLine x={todayLabel} stroke="#a78bfa" strokeDasharray="2 4" label={{ value: 'Now', position: 'insideTopRight', fontSize: 10, fill: '#7c3aed', fontWeight: 700 }} />}
                  <Area type="monotone" dataKey="band" stroke="none" fill="url(#pa-band)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2.5} fill="url(#pa-actual)" connectNulls animationDuration={900} />
                  <Line type="monotone" dataKey="forecast" stroke="url(#pa-line)" strokeWidth={3} strokeDasharray="6 5" dot={{ r: 3, fill: '#fff', stroke: '#d946ef', strokeWidth: 2 }} connectNulls animationDuration={1100} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Tip>The shaded purple band is the "likely range". Real sales usually land inside it, but a big order or a quiet week can fall outside.</Tip>
        </div>
      )
    });
  }

  // ---- 3. season and rain
  if (sales.season.available && sales.season.districts.length > 0) {
    steps.push({
      id: 'season',
      label: 'Season and rain',
      title: 'How the season and rain change it',
      hint: 'Farm work follows the weather, so sales do too.',
      icon: CloudRain,
      content: (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {sales.season.districts.map((d) => (
              <div key={d.key} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-extrabold text-slate-900 dark:text-white">{d.label}</p>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold text-white ${SEASON_BADGE[d.level] || 'bg-slate-400'}`}>{d.level} season</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{d.rainSummary}</p>
                {d.coming[0] && <p className="mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">Coming up: {d.coming[0]}</p>}
              </div>
            ))}
          </div>
          <Tip title="Effect on the estimate">
            {sales.season.reasons[0]}
            {sales.season.withoutSeason30 > 0 && (
              <>
                {' '}
                <b>{compact(sales.season.withoutSeason30, cur)}</b> from sales speed alone, <b>{compact(heroValues?.expected ?? 0, cur)}</b> after season and rain.
              </>
            )}
          </Tip>
          <button type="button" onClick={onOpenSeason} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-slate-50 dark:border-slate-700 dark:text-indigo-300 dark:hover:bg-slate-800">
            Open the Rain and season tab <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    });
  }

  // ---- 4. busiest day
  steps.push({
    id: 'busiest',
    label: 'Busiest day',
    title: 'Which day the shop sells most',
    hint: 'Good to know when to keep extra staff and stock ready.',
    icon: CalendarDays,
    content: sales.busiestDay ? (
      <div className="space-y-4">
        <Hero label="Busiest day of the week" value={sales.busiestDay.name} sub={`${sales.busiestDay.sharePercent}% of a week's sales happen on this day`} tone="sky">
          <div className="h-2.5 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, sales.busiestDay.sharePercent * 2.5)}%`, transition: 'width .8s ease' }} />
          </div>
        </Hero>
        <Tip>If every day sold the same, each would carry about 14% of the week. {sales.busiestDay.name} carries more than that, so plan for it.</Tip>
      </div>
    ) : (
      <Note>There are not enough sales yet to tell which day is busiest.</Note>
    )
  });

  return (
    <div className="space-y-4">
      <Stepper steps={steps} resetKey="overview" />
      <p className="text-center text-[11px] text-slate-400">
        {sales.basis}. Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
      </p>
    </div>
  );
};
