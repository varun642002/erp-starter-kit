import React, { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Brain, CalendarDays, FlaskConical, HelpCircle, History, Loader2, LineChart, RefreshCw, Swords, Target } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { useApiScope } from '../../documents/ui';
import { analyticsApi, type TrainedModel } from '../../../services/analyticsApi';
import { Note, Panel, Stepper, TabState, Tip, useTabData, type Step } from './ui';

const ind = (n: number) => Math.round(n).toLocaleString('en-IN');
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const tip = { borderRadius: 12, fontSize: 12 } as const;
const tick = { fontSize: 10, fill: '#94a3b8' } as const;

// A ring that shows how much of 100 is right: green when good, amber when so-so, red when poor
const Ring: React.FC<{ value: number; label: string; sub: string }> = ({ value, label, sub }) => {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = v >= 70 ? '#10b981' : v >= 40 ? '#f59e0b' : '#f43f5e';
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 84 84" className="h-28 w-28" role="img" aria-label={`${label}: ${v}%`}>
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="9" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" className="fill-slate-900 text-[17px] font-extrabold dark:fill-white">
          {v}%
        </text>
      </svg>
      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{label}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </div>
  );
};

export const ModelTab: React.FC = () => {
  const { showToast, selectedBranchId } = useERP();
  const { scope } = useApiScope();
  const { data, loading, error, reload } = useTabData(() => analyticsApi.model(scope), [scope, selectedBranchId]);
  const [training, setTraining] = useState(false);
  const [fresh, setFresh] = useState<TrainedModel | null>(null);

  const model = fresh || data?.model;
  const chosen = model?.scores.find((s) => s.id === model.chosen);

  const train = async () => {
    setTraining(true);
    try {
      const r = await analyticsApi.trainModel(scope);
      setFresh(r.model);
      showToast('Model trained', `Learned from ${r.model.samples.toLocaleString('en-IN')} machine sales.`, 'success');
    } catch (e: any) {
      showToast('Could not train', e?.message || 'Please try again.', 'error');
    } finally {
      setTraining(false);
    }
  };

  // both years on one line, month after month
  const timeline = useMemo(() => {
    if (!model) return [];
    return model.forecast.flatMap((f) => f.months.map((m) => ({ label: m.label.replace(' 20', " '"), mean: m.mean, lo: m.p10, span: Math.max(0, m.p90 - m.p10), fy: f.label })));
  }, [model]);

  // every year as a bar: what was sold, then what is expected (with its range)
  const yearBars = useMemo(() => {
    if (!model) return [];
    const rows = model.years
      .filter((y) => y.fy < Number(model.forecast[0]?.fy ?? 9999))
      .map((y) => ({ label: y.label, units: y.total, kind: y.used ? 'used' : 'left out', err: [0, 0] as [number, number] }));
    for (const f of model.forecast) rows.push({ label: f.label, units: f.total.mean, kind: 'forecast', err: [f.total.mean - f.total.p10, f.total.p90 - f.total.mean] });
    return rows;
  }, [model]);

  const tests = useMemo(() => (model ? model.folds.map((f) => ({ label: f.label, real: f.actual, forecast: f.predicted[model.chosen] ?? 0 })) : []), [model]);
  const compare = useMemo(() => (model ? [...model.scores].sort((a, b) => a.monthError - b.monthError).map((s) => ({ name: s.name.replace('Season x ', 'Season × '), month: s.monthError, year: s.yearError, id: s.id })) : []), [model]);

  const steps: Step[] = [];
  if (model) {
    if (model.scores.length > 0) {
      steps.push({
        id: 'accuracy',
        label: 'How right',
        title: 'How right is the model?',
        hint: 'It was tested on years it had not seen. Fuller rings are better.',
        icon: Target,
        content: (
          <div className="space-y-4">
            <Panel>
              <div className="grid grid-cols-3 gap-2">
                <Ring value={100 - (chosen?.shapeError ?? 100)} label="Which months" sub="month pattern" />
                <Ring value={chosen?.inRange ?? 0} label="Inside range" sub="of real months" />
                <Ring value={100 - (chosen?.yearError ?? 100)} label="How many" sub="year total" />
              </div>
            </Panel>
            <Tip>It is better at telling which months will be busy than at telling exactly how many machines a whole year will bring. That is why the forecast always comes with a range.</Tip>
          </div>
        )
      });

      steps.push({
        id: 'forecast',
        label: 'Forecast',
        title: 'The forecast, month by month',
        hint: 'The purple line is the expected number. The shaded band is the likely range.',
        icon: LineChart,
        content: (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {model.forecast.map((f) => (
                <div key={f.fy} className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-4 text-white shadow-md shadow-violet-600/20">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/75">{f.label}</p>
                  <p className="mt-0.5 text-4xl font-black tabular-nums">{ind(f.total.mean)}</p>
                  <p className="text-xs text-white/85">
                    machines · likely {ind(f.total.p10)} to {ind(f.total.p90)}
                  </p>
                </div>
              ))}
            </div>
            <Panel title="Month by month">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={2} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} width={30} />
                    <Tooltip contentStyle={tip} formatter={(v: any, n: any) => [Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }), n === 'mean' ? 'Expected' : n === 'lo' ? 'Low' : 'Range']} />
                    <ReferenceLine x={timeline[12]?.label} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: model.forecast[1]?.label, position: 'insideTopLeft', fontSize: 10, fill: '#94a3b8' }} />
                    <Area type="monotone" dataKey="lo" stackId="band" stroke="none" fill="transparent" />
                    <Area type="monotone" dataKey="span" stackId="band" stroke="none" fill="#8b5cf6" fillOpacity={0.2} />
                    <Line type="monotone" dataKey="mean" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">Show the numbers</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs" data-no-stack="true">
                    <thead className="text-[11px] text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 font-bold">Month</th>
                        <th className="px-2 py-1.5 text-right font-bold">Expected</th>
                        <th className="px-2 py-1.5 text-right font-bold">Low</th>
                        <th className="px-2 py-1.5 text-right font-bold">High</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {model.forecast.flatMap((f) => f.months).map((m) => (
                        <tr key={m.month}>
                          <td className="px-2 py-1.5 font-semibold">{m.label}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold">{m.mean}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">{m.p10}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">{m.p90}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Panel>
          </div>
        )
      });

      steps.push({
        id: 'years',
        label: 'Every year',
        title: 'Every year, and the years ahead',
        hint: 'What sold in each year, then what the model expects.',
        icon: BarChart3,
        content: (
          <Panel>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={50} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={34} />
                  <Tooltip contentStyle={tip} formatter={(v: any, _n: any, item: any) => [`${ind(Number(v))} machines (${item?.payload?.kind})`, 'Machines']} />
                  <Bar dataKey="units" radius={[6, 6, 0, 0]}>
                    {yearBars.map((y) => (
                      <Cell key={y.label} fill={y.kind === 'forecast' ? '#8b5cf6' : y.kind === 'used' ? '#6366f1' : '#cbd5e1'} />
                    ))}
                    <ErrorBar dataKey="err" width={5} stroke="#7c3aed" strokeWidth={1.5} direction="y" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-indigo-500" /> used to train</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-slate-300" /> left out (partly recorded)</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-violet-500" /> expected, with range</span>
            </div>
          </Panel>
        )
      });

      steps.push({
        id: 'test',
        label: 'The test',
        title: 'The test: forecast against what sold',
        hint: 'For each year, the model forecast it without seeing it. Then we compared.',
        icon: FlaskConical,
        content: (
          <div className="space-y-4">
            <Panel>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tests} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} width={34} />
                    <Tooltip contentStyle={tip} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="real" name="Really sold" fill="#10b981" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="forecast" name="Model said" fill="#8b5cf6" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Tip>When the green and purple bars are close, the model guessed well. Where they are far apart, that year had something unusual, like a new subsidy.</Tip>
          </div>
        )
      });

      steps.push({
        id: 'shape',
        label: 'Busy months',
        title: 'Which months machines sell',
        hint: 'The share of a whole year that falls in each month.',
        icon: CalendarDays,
        content: (
          <Panel>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={model.shape.map((v, i) => ({ month: MONTHS[i], share: Math.round(v * 1000) / 10 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={false} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={34} unit="%" />
                  <Tooltip formatter={(v: any) => [`${v}% of a year`, 'Share']} contentStyle={tip} />
                  <Bar dataKey="share" radius={[6, 6, 0, 0]}>
                    {model.shape.map((v, i) => (
                      <Cell key={i} fill={v >= 0.1 ? '#8b5cf6' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Purple months carry 10% or more of the year.</p>
          </Panel>
        )
      });

      steps.push({
        id: 'compete',
        label: 'Models compared',
        title: 'The models that competed',
        hint: 'Several methods were tried. The one with the smallest mistakes won. Lower is better.',
        icon: Swords,
        content: (
          <Panel>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compare} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" horizontal={false} />
                  <XAxis type="number" tick={tick} tickLine={false} axisLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={108} />
                  <Tooltip contentStyle={tip} formatter={(v: any, n: any) => [`${v}%`, n === 'month' ? 'Months missed' : 'Year total missed']} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === 'month' ? 'Month by month' : 'Year total')} />
                  <Bar dataKey="month" fill="#a5b4fc" radius={[0, 5, 5, 0]} barSize={10}>
                    {compare.map((c) => (
                      <Cell key={c.id} fill={c.id === model.chosen ? '#7c3aed' : '#a5b4fc'} />
                    ))}
                  </Bar>
                  <Bar dataKey="year" fill="#fcd34d" radius={[0, 5, 5, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Dark purple is the model in use.</p>
          </Panel>
        )
      });
    } else {
      steps.push({
        id: 'notready',
        label: 'Status',
        title: 'The model is not ready yet',
        icon: Brain,
        content: <Note tone="warn">{model.notes[model.notes.length - 1]}</Note>
      });
    }

    steps.push({
      id: 'given',
      label: 'Years given',
      title: 'The years the model was given',
      hint: 'Blue years trained the model. Grey ones are partly recorded or empty.',
      icon: History,
      content: (
        <Panel>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
            {model.years.map((y) => (
              <div
                key={y.fy}
                title={y.used ? 'Used to train' : `Left out: ${y.reason}`}
                className={`rounded-xl px-2 py-2.5 text-center ${y.used ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
              >
                <p className="text-[10px] font-bold">{y.label}</p>
                <p className="text-lg font-extrabold">{ind(y.total)}</p>
                {!y.used && <p className="mt-0.5 text-[9px] leading-tight">{y.reason}</p>}
              </div>
            ))}
          </div>
        </Panel>
      )
    });

    steps.push({
      id: 'how',
      label: 'How it works',
      title: 'How the model works',
      hint: 'In plain words.',
      icon: HelpCircle,
      content: (
        <div className="space-y-4">
          <Panel>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <li>It trains itself again when bills are uploaded, and you can press Train again.</li>
              <li>Each year was held back in turn and forecast from the years before it; the best model won.</li>
              <li>A year's total depends on subsidy budgets, so the ranges are wide. They narrow as years are added.</li>
              {model.glm && <li>The regression found a link to earlier years of {model.glm.elasticity}; yearly spread about ±{Math.round(model.uncertainty.yearSigma * 100)}%.</li>}
              {model.scores.map((s) => (
                <li key={s.id}>
                  <b>{s.name}:</b> {s.about}
                </li>
              ))}
            </ul>
          </Panel>
          <button type="button" onClick={train} disabled={training} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60">
            {training ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Train again
          </button>
        </div>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!model} reload={reload}>
      {model && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950/50">
                <Brain className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-extrabold text-slate-900 dark:text-white">{chosen ? chosen.name : 'Machine sales model'}</p>
                <p className="text-[11px] text-slate-500">
                  {model.samples.toLocaleString('en-IN')} machine sales · {model.trainingYears} full years · trained {new Date(model.trainedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
            <button type="button" onClick={train} disabled={training} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60">
              {training ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Train again
            </button>
          </div>
          <Stepper steps={steps} resetKey={`model-${scope}`} />
        </div>
      )}
    </TabState>
  );
};
