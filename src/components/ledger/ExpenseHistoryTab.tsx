import React, { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { ledgerApi } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import { spentByLabel } from './ExpensesTab';
import {
  BTN_GHOST,
  CARD,
  CardHeader,
  EmptyRow,
  ErrorBox,
  INPUT,
  LoadingBox,
  OUT_TONE,
  TBODY,
  TD,
  TDR,
  TH,
  THEAD,
  THR,
  TROW,
  formatDate,
  todayIST,
  useAsync,
  useLedgerContext
} from './shared';

interface Props {
  reloadKey: number;
}

// Every expense ever recorded, grouped by category. Read only: adding and deleting stay in the Expenses tab.
export const ExpenseHistoryTab: React.FC<Props> = ({ reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money, branchName } = useLedgerContext();
  const showBranch = effectiveBranch === 'all';
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.expenses(scope, queryBranch, { from: '2000-01-01', to: todayIST() }),
    [scope, queryBranch, reloadKey]
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows || []) m.set(r.category, (m.get(r.category) || 0) + 1);
    return m;
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter(
      (r) =>
        (category === 'all' || r.category === category) &&
        (!q || `${r.vendor} ${r.description} ${r.category} ${spentByLabel(r.method)}`.toLowerCase().includes(q))
    );
  }, [data, category, search]);

  const shownTotal = rows.reduce((s, r) => s + r.amount, 0);
  const allRows = data?.rows || [];
  const last = allRows.length ? allRows[0].date : null;
  const first = allRows.length ? allRows[allRows.length - 1].date : null;

  const exportCsv = () =>
    downloadCSV(
      `Expense_history_${effectiveBranch}_${category === 'all' ? 'all-categories' : category.replace(/\W+/g, '_')}.csv`,
      ['Date', 'Branch', 'Category', 'Vendor', 'Description', 'Spent by', 'Amount', 'Recorded by'],
      rows.map((r) => [r.date, branchName(r.branchId), r.category, r.vendor, r.description, spentByLabel(r.method), r.amount, r.createdBy])
    );

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11px] cursor-pointer ${
      active
        ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-300 dark:bg-slate-700'
        : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load the expense history" message={error} onRetry={reload} />}

      <div className={`${CARD} overflow-hidden`}>
        <CardHeader
          title="Expense history"
          hint={
            data
              ? `${allRows.length} expenses, ${money(data.total)} in all${first && last ? `, from ${formatDate(first)} to ${formatDate(last)}` : ''}. Every date, by category.`
              : 'Every expense ever recorded, by category.'
          }
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor or note"
            aria-label="Search the expense history"
            className={`${INPUT} w-full sm:w-52`}
          />
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </CardHeader>

        {data && data.byCategory.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <button type="button" onClick={() => setCategory('all')} className={chip(category === 'all')}>
              All <span className="ml-1 font-mono font-bold">{allRows.length}</span>
            </button>
            {data.byCategory.map((c) => (
              <button key={c.category} type="button" onClick={() => setCategory(c.category)} className={chip(category === c.category)}>
                {c.category} <span className="ml-1 font-mono">{counts.get(c.category) || 0}</span>
                <span className="ml-1.5 font-mono font-bold">{money(c.amount)}</span>
              </button>
            ))}
          </div>
        )}

        {loading && !data ? (
          <LoadingBox label="Loading expense history..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Date</th>
                  {showBranch && <th className={TH}>Branch</th>}
                  <th className={TH}>Category</th>
                  <th className={TH}>Vendor</th>
                  <th className={TH}>Description</th>
                  <th className={TH}>Spent by</th>
                  <th className={THR}>Amount</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {rows.length === 0 ? (
                  <EmptyRow cols={showBranch ? 7 : 6} text="No expenses found." />
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className={TROW}>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(r.date)}</td>
                      {showBranch && <td className={`${TD} whitespace-nowrap`}>{branchName(r.branchId)}</td>}
                      <td className={`${TD} whitespace-nowrap font-medium text-slate-900 dark:text-white`}>{r.category}</td>
                      <td className={`${TD} max-w-[12rem] truncate`} title={r.vendor}>{r.vendor || '-'}</td>
                      <td className={`${TD} max-w-[18rem] truncate`} title={r.description}>{r.description || '-'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{spentByLabel(r.method)}</td>
                      <td className={`${TDR} font-bold ${OUT_TONE}`}>{money(r.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs font-bold dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">
              {rows.length} shown{allRows.length >= 2000 ? ' (the latest 2,000 are listed)' : ''}
            </span>
            <span className={`font-mono ${OUT_TONE}`}>{money(shownTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
