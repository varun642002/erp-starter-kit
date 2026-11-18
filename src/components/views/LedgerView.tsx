import React, { useMemo, useState } from 'react';
import { BookOpen, Landmark, Receipt, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { CashBankTab } from '../ledger/CashBankTab';
import { CustomerLedgerTab } from '../ledger/CustomerLedgerTab';
import { DayBookTab } from '../ledger/DayBookTab';
import { ExpensesTab } from '../ledger/ExpensesTab';
import { ProfitLossTab } from '../ledger/ProfitLossTab';
import { SummaryCards } from '../ledger/SummaryCards';
import { CARD, INPUT, PRESETS, presetRange, todayIST, useLedgerContext, type Preset } from '../ledger/shared';

type TabId = 'daybook' | 'cashbank' | 'customers' | 'expenses' | 'pnl';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'daybook', label: 'Day Book', icon: BookOpen },
  { id: 'cashbank', label: 'Cash & Bank Book', icon: Landmark },
  { id: 'customers', label: 'Customer Ledger', icon: Users },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'pnl', label: 'Profit & Loss', icon: TrendingUp }
];

export const LedgerView: React.FC = () => {
  const { hasAccess, role, effectiveBranch, branchName } = useLedgerContext();

  const [tab, setTab] = useState<TabId>('daybook');
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => presetRange('month'));
  const [reloadKey, setReloadKey] = useState(0);

  const range = useMemo(() => (preset === 'custom' ? custom : presetRange(preset)), [preset, custom]);
  const bump = () => setReloadKey((k) => k + 1);

  if (!hasAccess) {
    return (
      <div className={`${CARD} p-8 text-center text-xs text-slate-500 dark:text-slate-400`}>
        The {role} role does not have access to the financial ledger.
      </div>
    );
  }

  const setCustomFrom = (from: string) => from && setCustom((c) => ({ from, to: from > c.to ? from : c.to }));
  const setCustomTo = (to: string) => to && setCustom((c) => ({ from: to < c.from ? to : c.from, to }));

  return (
    <div className="min-w-0 space-y-6 pb-12">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Financial Ledger</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {effectiveBranch === 'all' ? 'All branches' : branchName(effectiveBranch)} &middot; day book, cash and bank, receivables, expenses and profit
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 text-xs font-bold dark:bg-slate-800" role="group" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`cursor-pointer rounded-md px-3 py-1.5 transition-colors ${
                  preset === p.id
                    ? 'bg-slate-800 text-white shadow-xs dark:bg-slate-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input type="date" value={custom.from} max={todayIST()} onChange={(e) => setCustomFrom(e.target.value)} className={`${INPUT} w-auto font-mono`} aria-label="From date" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={custom.to} max={todayIST()} onChange={(e) => setCustomTo(e.target.value)} className={`${INPUT} w-auto font-mono`} aria-label="To date" />
            </div>
          ) : (
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {range.from} to {range.to}
            </span>
          )}
          <button
            type="button"
            onClick={bump}
            className="cursor-pointer rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <SummaryCards reloadKey={reloadKey} />

      <div className="overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        <div className="flex min-w-max gap-1" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-bold transition-colors ${
                tab === id
                  ? 'border-slate-800 text-slate-900 dark:border-slate-300 dark:text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'daybook' && <DayBookTab range={range} reloadKey={reloadKey} />}
      {tab === 'cashbank' && <CashBankTab range={range} reloadKey={reloadKey} />}
      {tab === 'customers' && <CustomerLedgerTab range={range} reloadKey={reloadKey} />}
      {tab === 'expenses' && <ExpensesTab range={range} reloadKey={reloadKey} onChanged={bump} />}
      {tab === 'pnl' && <ProfitLossTab range={range} reloadKey={reloadKey} />}
    </div>
  );
};
