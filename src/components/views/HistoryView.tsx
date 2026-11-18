import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { HistoryTab } from '../ledger/HistoryTab';
import { CARD, useLedgerContext } from '../ledger/shared';

// A page of its own: every record on file, one tab per category. Read only.
export const HistoryView: React.FC = () => {
  const { hasAccess, role, effectiveBranch, branchName } = useLedgerContext();
  const [reloadKey, setReloadKey] = useState(0);

  if (!hasAccess) {
    return (
      <div className={`${CARD} p-8 text-center text-xs text-slate-500 dark:text-slate-400`}>
        The {role} role does not have access to the history.
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">History</h2>
          <p className="break-words text-xs text-slate-500 dark:text-slate-400">
            {effectiveBranch === 'all' ? 'All branches' : branchName(effectiveBranch)} &middot; everything recorded, by category, for every date
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-lg border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Reload"
          aria-label="Reload"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <HistoryTab reloadKey={reloadKey} />
    </div>
  );
};
