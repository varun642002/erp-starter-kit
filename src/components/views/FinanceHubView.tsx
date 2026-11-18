import React from 'react';
import { Landmark, Wallet } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { LedgerView } from './LedgerView';
import { CashBookView } from './CashBookView';

// One page for money: the financial ledger and the daily cash book with day-end closing.
const TABS = [
  { id: 'finance' as const, label: 'Financial Ledger', icon: Wallet },
  { id: 'cash-book' as const, label: 'Cash Book', icon: Landmark }
];

export const FinanceHubView: React.FC = () => {
  const { currentView, setCurrentView } = useERP();
  const active = currentView === 'cash-book' ? 'cash-book' : 'finance';

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setCurrentView(t.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                on
                  ? 'bg-slate-800 text-white dark:bg-slate-700'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {active === 'cash-book' ? <CashBookView /> : <LedgerView />}
    </div>
  );
};
