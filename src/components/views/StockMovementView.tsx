import React, { useEffect, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { StockTransfersView } from './StockTransfersView';
import { StockLedgerView } from './StockLedgerView';

type Tab = 'transfers' | 'ledger';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transfers', label: 'Stock transfers' },
  { id: 'ledger', label: 'Stock ledger' }
];

// One page for moving stock between branches and for the record of every stock movement.
export const StockMovementView: React.FC = () => {
  const { currentView } = useERP();
  const [tab, setTab] = useState<Tab>(currentView === 'stock-ledger' ? 'ledger' : 'transfers');

  // Links from elsewhere (assistant, search) can still open either tab.
  useEffect(() => {
    if (currentView === 'stock-ledger') setTab('ledger');
    else if (currentView === 'stock-transfers' || currentView === 'transfers') setTab('transfers');
  }, [currentView]);

  return (
    <div className="space-y-5">
      <div className="flex w-full overflow-x-auto rounded-lg bg-slate-100 p-1 text-xs font-bold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:inline-flex sm:w-auto dark:bg-slate-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-4 py-2.5 transition-colors cursor-pointer sm:flex-none sm:py-1.5 ${
              tab === t.id
                ? 'bg-slate-800 text-white shadow-xs dark:bg-slate-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'transfers' ? <StockTransfersView /> : <StockLedgerView />}
    </div>
  );
};
