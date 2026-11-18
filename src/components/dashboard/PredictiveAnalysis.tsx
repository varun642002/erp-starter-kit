import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeIndianRupee, Brain, CalendarRange, CloudRain, Loader2, RefreshCw, Sparkles, Tractor } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { analyticsApi, type Predictions } from '../../services/analyticsApi';
import { RainSeasonTab } from './predictions/RainSeasonTab';
import { SubsidyTab } from './predictions/SubsidyTab';
import { OutlookTab } from './predictions/OutlookTab';
import { MachinesTab } from './predictions/MachinesTab';
import { ModelTab } from './predictions/ModelTab';
import { OverviewTab } from './predictions/OverviewTab';

type TabId = 'outlook' | 'machines' | 'model' | 'overview' | 'season' | 'subsidy';
const TABS: { id: TabId; label: string; hint: string; icon: React.ElementType }[] = [
  { id: 'outlook', label: 'Next year', hint: 'How many machines to expect in the year ahead', icon: CalendarRange },
  { id: 'machines', label: 'Machines sold', hint: 'Every machine sold so far, year by year', icon: Tractor },
  { id: 'overview', label: 'Next 30 days', hint: 'Sales to expect over the coming month', icon: Sparkles },
  { id: 'season', label: 'Rain and season', hint: 'How the weather moves sales', icon: CloudRain },
  { id: 'subsidy', label: 'Subsidies', hint: 'Government schemes that bring buyers', icon: BadgeIndianRupee },
  { id: 'model', label: 'Trained model', hint: 'How the forecast is learned and how accurate it is', icon: Brain }
];

export const PredictiveAnalysis: React.FC = () => {
  const { settings, selectedBranchId } = useERP();
  const { scope, branchParam, isOwner } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const [tab, setTab] = useState<TabId>('outlook');

  // The 30-day overview is the only part that needs the quick prediction; the other tabs load their own data when opened.
  const [data, setData] = useState<Predictions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await analyticsApi.predictions(scope, branchParam);
      if (alive.current) setData(res);
    } catch (e: any) {
      if (alive.current) setError(e?.message || 'Could not load the predictions');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [scope, branchParam]);

  useEffect(() => {
    setData(null);
  }, [scope, branchParam, selectedBranchId]);

  useEffect(() => {
    if (tab === 'overview' && !data && !loading && !error) load();
  }, [tab, data, loading, error, load]);

  const tabs = TABS.filter((t) => t.id !== 'model' || isOwner);
  const current = tabs.find((t) => t.id === tab) || tabs[0];

  return (
    <section className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/30">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Predictions</h2>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">What to expect next, worked out from your own records. These are estimates: festivals, rain and price changes are not known in advance.</p>
          </div>
        </div>
        {tab === 'overview' && (
          <button
            type="button"
            onClick={load}
            aria-label="Refresh predictions"
            className="shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white p-2.5 text-slate-500 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* one section at a time */}
      <div className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-1.5" role="tablist" aria-label="Prediction sections">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = current.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-bold transition-all ${
                on
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-violet-600/25'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{current.hint}</p>

      <div className="mt-5">
        {current.id === 'outlook' && <OutlookTab />}
        {current.id === 'machines' && <MachinesTab />}
        {current.id === 'model' && <ModelTab />}
        {current.id === 'season' && <RainSeasonTab onOpenSubsidy={() => setTab('subsidy')} />}
        {current.id === 'subsidy' && <SubsidyTab />}
        {current.id === 'overview' &&
          (loading && !data ? (
            <div className="py-16 text-center text-sm text-slate-400">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Working out the predictions
            </div>
          ) : error && !data ? (
            <div className="py-12 text-center">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-500" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{error}</p>
              <button type="button" onClick={load} className="mt-3 cursor-pointer rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Try again
              </button>
            </div>
          ) : data ? (
            <OverviewTab data={data} cur={cur} onOpenSeason={() => setTab('season')} />
          ) : null)}
      </div>
    </section>
  );
};
