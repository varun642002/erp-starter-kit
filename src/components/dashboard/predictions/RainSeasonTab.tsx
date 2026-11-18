import React, { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CloudRain, Droplets, HelpCircle, Leaf, Lightbulb, Sprout, Sun, Tractor, Wheat } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { useApiScope } from '../../documents/ui';
import { analyticsApi, type SeasonOutlook } from '../../../services/analyticsApi';
import { Hero, Note, Panel, Stat, Stepper, TabState, Tip, shortDate, useTabData, type Step } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type District = SeasonOutlook['districts'][number];

// What to do about the season, in plain words. These follow from the sowing calendar and the rain outlook.
function adviceFor(d: District, onSubsidy: () => void): { icon: React.ReactNode; text: React.ReactNode }[] {
  const out: { icon: React.ReactNode; text: React.ReactNode }[] = [];
  const coming = d.status.coming.join(' ');
  const now = d.status.now.join(' ');
  if (/Navarai|Sugarcane planting \(early\)/.test(coming) || /Navarai/.test(now)) {
    out.push({
      icon: <Tractor className="h-4 w-4 text-indigo-500" />,
      text: 'Navarai rice (sown December to January) and early sugarcane planting need land ready from late November. Have rotavator blades, bolts, bearings, oil seals and gear oil in stock by mid-November.'
    });
  }
  if (/Sugarcane planting/.test(coming + now)) {
    out.push({ icon: <Sprout className="h-4 w-4 text-emerald-500" />, text: 'Sugarcane planting: cultivators, ridgers and rotavators are asked for. Remind cane growers before the planting month.' });
  }
  if (/Kar rice|Kuruvai|Sornavari/.test(coming + now)) {
    out.push({ icon: <Leaf className="h-4 w-4 text-emerald-500" />, text: 'Kar, Kuruvai and Sornavari rice are starting. This is the busiest buying period for rotavators and spares.' });
  }
  if (d.weather.ok && d.weather.rainFactor < 1) {
    out.push({ icon: <CloudRain className="h-4 w-4 text-sky-500" />, text: d.weather.rainReason + '. Use the quiet days to follow up on bookings and collect payments.' });
  } else if (d.weather.ok && d.weather.rainFactor > 1) {
    out.push({ icon: <Droplets className="h-4 w-4 text-sky-500" />, text: d.weather.rainReason + '. Keep blades and spares ready before the rain stops.' });
  }
  out.push({
    icon: <Sun className="h-4 w-4 text-amber-500" />,
    text: (
      <>
        Farmers buying a rotavator, tractor or power tiller may be able to get a government subsidy of 40 to 50%, but it must be approved before they buy.{' '}
        <button type="button" onClick={onSubsidy} className="cursor-pointer font-bold text-indigo-600 underline dark:text-indigo-400">
          See the subsidy guide
        </button>
      </>
    )
  });
  return out;
}

export const RainSeasonTab: React.FC<{ onOpenSubsidy: () => void }> = ({ onOpenSubsidy }) => {
  const { selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const { data, loading, error, reload } = useTabData(() => analyticsApi.season(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const [pick, setPick] = useState<string>('');
  const d = data ? data.districts.find((x) => x.key === pick) || data.districts[0] : undefined;
  const monthNow = data ? Number(data.today.split('-')[1]) : 1;

  const steps: Step[] = [];
  if (data && d) {
    steps.push({
      id: 'season',
      label: 'The season',
      title: `Farming season in ${d.label}`,
      hint: 'How busy farmers are right now, and so how much machinery they buy.',
      icon: Wheat,
      content: (
        <div className="space-y-4">
          <Hero tone="sky" label={`Farming season in ${d.label}`} value={d.status.level} sub={`Machinery demand is about ${Math.round(d.status.index * 100)}% of an average month`} />
          {(d.status.now.length > 0 || d.status.coming.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {d.status.now.length > 0 && (
                <Panel title="Happening now">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                    {d.status.now.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Panel>
              )}
              {d.status.coming.length > 0 && (
                <Panel title="Coming next month">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                    {d.status.coming.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          )}
        </div>
      )
    });

    steps.push({
      id: 'rain',
      label: 'Rain',
      title: `Rain in ${d.label}`,
      hint: 'The last 14 days, and what is forecast for the next 16.',
      icon: CloudRain,
      content: (
        <div className="space-y-4">
          {d.weather.ok ? (
            <>
              <Panel title="Rain each day" right={<span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">{d.weather.outlook}</span>}>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.weather.days.slice(16)} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rs-past" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" />
                          <stop offset="100%" stopColor="#818cf8" stopOpacity={0.6} />
                        </linearGradient>
                        <linearGradient id="rs-next" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" />
                          <stop offset="100%" stopColor="#7dd3fc" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={26} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={34} />
                      <Tooltip
                        cursor={{ fill: 'rgba(14,165,233,0.08)' }}
                        content={({ active, payload }: any) =>
                          active && payload?.length ? (
                            <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
                              <p className="font-bold text-slate-800 dark:text-slate-100">{shortDate(payload[0].payload.date)}</p>
                              <p className="text-sky-600 dark:text-sky-300">
                                {payload[0].payload.mm} mm {payload[0].payload.past ? 'fell' : 'expected'}
                              </p>
                              {!payload[0].payload.past && payload[0].payload.probability !== null && <p className="text-slate-500">{payload[0].payload.probability}% chance</p>}
                            </div>
                          ) : null
                        }
                      />
                      <ReferenceLine x={data.today} stroke="#a78bfa" strokeDasharray="3 4" label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#7c3aed', fontWeight: 700 }} />
                      <Bar dataKey="mm" radius={[6, 6, 0, 0]} animationDuration={800}>
                        {d.weather.days.slice(16).map((x) => (
                          <Cell key={x.date} fill={x.past ? 'url(#rs-past)' : 'url(#rs-next)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Purple bars: rain that fell. Blue bars: forecast. Millimetres a day. {d.weather.summary}.</p>
              </Panel>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Rain, last 30 days" value={`${Math.round(d.weather.last30mm)} mm`} sub={d.weather.normalLast30mm !== null ? `Normal for these dates ${Math.round(d.weather.normalLast30mm)} mm` : undefined} />
                <Stat
                  label="Against normal"
                  value={d.weather.departurePercent === null ? '-' : `${d.weather.departurePercent > 0 ? '+' : ''}${d.weather.departurePercent}%`}
                  tone={d.weather.departurePercent !== null && d.weather.departurePercent < -25 ? 'bad' : undefined}
                  sub="11-year average"
                />
                <Stat label="Next 7 days" value={`${Math.round(d.weather.next7mm)} mm`} sub={d.weather.maxDay ? `Wettest day ${shortDate(d.weather.maxDay.date)}, ${Math.round(d.weather.maxDay.mm)} mm` : undefined} />
                <Stat label="Next 14 days" value={`${Math.round(d.weather.next14mm)} mm`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Northeast monsoon normal" value={`${d.neNormalMm} mm`} sub="October to December, TNAU" />
                <Stat label="Southwest monsoon normal" value={`${d.swNormalMm} mm`} sub="June to September, TNAU" />
              </div>
            </>
          ) : (
            <Note tone="warn">The weather service could not be reached just now, so no rain adjustment is being made. Try again in a few minutes.</Note>
          )}
        </div>
      )
    });

    steps.push({
      id: 'year',
      label: 'Through the year',
      title: 'When farmers buy through the year',
      hint: `Machinery and spares demand in ${d.label}, month by month. The red dot is this month.`,
      icon: Tractor,
      content: (
        <div className="space-y-4">
          <Panel>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.monthlyIndex.map((v, i) => ({ month: MONTHS[i], v, now: i + 1 === monthNow ? v : undefined }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rs-demand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={30} domain={[0, 'auto']} />
                  <ReferenceLine y={1} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: 'average', position: 'insideTopLeft', fontSize: 9, fill: '#94a3b8' }} />
                  <Tooltip formatter={(v: any) => [`${Math.round(Number(v) * 100)}% of an average month`, 'Demand']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Area type="monotone" dataKey="v" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#rs-demand)" dot={{ r: 2.5 }} animationDuration={900} />
                  <Area type="monotone" dataKey="now" stroke="none" fill="none" dot={{ r: 6, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.seasons.map((s) => (
                <span key={s.name + s.startMonth} className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {s.name}: {MONTHS[s.startMonth - 1]}
                  {s.endMonth !== s.startMonth ? ` to ${MONTHS[s.endMonth - 1]}` : ''}
                </span>
              ))}
            </div>
          </Panel>
          <Tip title="How the pattern is built">
            From when each crop is sown in {d.label} (land is prepared from a month before sowing)
            {data.history ? `, and from the ${data.history.units.toLocaleString('en-IN')} machines you sold between ${data.history.fromYear} and ${data.history.toYear}, which count for ${Math.round(data.history.weight * 100)}% of this pattern` : ''}.
          </Tip>
        </div>
      )
    });

    steps.push({
      id: 'advice',
      label: 'What to do',
      title: 'What this means for you',
      hint: 'Plain advice that follows from the season and the rain.',
      icon: Lightbulb,
      content: (
        <Panel>
          <ul className="space-y-3.5">
            {adviceFor(d, onOpenSubsidy).map((a, i) => (
              <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">{a.icon}</span>
                <span className="pt-0.5">{a.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )
    });

    steps.push({
      id: 'how',
      label: 'How it is worked out',
      title: 'How this is worked out',
      icon: HelpCircle,
      content: (
        <Note>
          Sowing months come from the TNAU rice and sugarcane seasons for each district, rain normals are TNAU's, and the forecast and 11-year rainfall average come from Open-Meteo. The effect on sales is a judgement written down as rules (heavy rain pauses field work, good rain in a land-preparation month starts it, a dry spell delays sowing). It is weighed at 60% until your own sales cover a full year.{' '}
          {data.sources.map((s, i) => (
            <React.Fragment key={s.url}>
              {i > 0 && ', '}
              <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                {s.label}
              </a>
            </React.Fragment>
          ))}
          .
        </Note>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && d && (
        <div className="space-y-4">
          {data.districts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">District</span>
              {data.districts.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setPick(x.key)}
                  className={`cursor-pointer rounded-full px-4 py-2 text-xs font-bold ${
                    x.key === d.key ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {x.label}
                  <span className="ml-1.5 opacity-70">{x.weight > 0 ? `${Math.round(x.weight * 100)}%` : ''}</span>
                </button>
              ))}
            </div>
          )}
          <Stepper steps={steps} resetKey={`season-${d.key}`} />
        </div>
      )}
    </TabState>
  );
};
