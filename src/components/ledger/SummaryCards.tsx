import React from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { ledgerApi } from '../../services/ledgerApi';
import { CARD, ErrorBox, IN_TONE, OUT_TONE, useAsync, useLedgerContext } from './shared';

interface Props {
  reloadKey: number;
}

export const SummaryCards: React.FC<Props> = ({ reloadKey }) => {
  const { scope, queryBranch, money } = useLedgerContext();
  const { data, loading, error, reload } = useAsync(() => ledgerApi.summary(scope, queryBranch), [scope, queryBranch, reloadKey]);

  if (error) return <ErrorBox title="Could not load the summary" message={error} onRetry={reload} />;

  const card = (label: string, value: number | null, Icon: React.ElementType, sub: string, tone = 'text-slate-900 dark:text-white') => (
    <div className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className={`mt-2 truncate text-right font-mono text-lg font-bold ${tone}`}>{value === null ? '...' : money(value)}</p>
      <p className="mt-0.5 truncate text-right font-mono text-[10px] text-slate-400 dark:text-slate-500">{sub}</p>
    </div>
  );

  const ready = data && !loading;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {card('Sales today', data ? data.day.sales : null, Receipt, ready ? `Month: ${money(data.month.sales)}` : '')}
      {card('Collections today', data ? data.day.collections : null, ArrowDownLeft, ready ? `Month: ${money(data.month.collections)}` : '', IN_TONE)}
      {card('Expenses today', data ? data.day.expenses : null, ArrowUpRight, ready ? `Month: ${money(data.month.expenses)}` : '', OUT_TONE)}
      {card(
        'Receivables outstanding',
        data ? data.receivables.outstanding : null,
        AlertTriangle,
        ready ? `Overdue: ${money(data.receivables.overdue)} (${data.receivables.openInvoices} open invoices)` : ''
      )}
    </div>
  );
};
