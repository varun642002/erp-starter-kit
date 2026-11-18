import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, FileSpreadsheet, FileText, HandCoins, List, Receipt, ShoppingCart, Wrench } from 'lucide-react';
import { ledgerApi, type VoucherType } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import { ExpenseHistoryTab } from './ExpenseHistoryTab';
import {
  BTN_GHOST,
  CARD,
  CardHeader,
  EmptyRow,
  ErrorBox,
  INPUT,
  IN_TONE,
  LoadingBox,
  OUT_TONE,
  TBODY,
  TD,
  TDR,
  TFOOT,
  TH,
  THEAD,
  THR,
  TROW,
  formatDate,
  todayIST,
  useAsync,
  useLedgerContext
} from './shared';

type Category = 'all' | VoucherType;

const CATEGORIES: { id: Category; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All history', icon: List },
  { id: 'Sale', label: 'Sales', icon: ShoppingCart },
  { id: 'Invoice', label: 'Invoices', icon: FileText },
  { id: 'Receipt', label: 'Receipts', icon: HandCoins },
  { id: 'Service Receipt', label: 'Service', icon: Wrench },
  { id: 'Expense', label: 'Expenses', icon: Receipt },
  { id: 'Salary', label: 'Salary', icon: Banknote },
  { id: 'Cash In', label: 'Cash in', icon: ArrowDownToLine },
  { id: 'Cash Out', label: 'Cash out', icon: ArrowUpFromLine }
];

interface Props {
  reloadKey: number;
}

// Everything ever recorded, one tab per category. Read only: each record is still added or changed where it was made.
export const HistoryTab: React.FC<Props> = ({ reloadKey }) => {
  const [category, setCategory] = useState<Category>('all');

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="History by category">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              onClick={() => setCategory(id)}
              className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-bold transition-colors ${
                category === id
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

      {category === 'Expense' ? <ExpenseHistoryTab reloadKey={reloadKey} /> : <CategoryHistory key={category} category={category} reloadKey={reloadKey} />}
    </div>
  );
};

const CategoryHistory: React.FC<{ category: Category; reloadKey: number }> = ({ category, reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money, branchName } = useLedgerContext();
  const showBranch = effectiveBranch === 'all';
  const [search, setSearch] = useState('');
  const label = CATEGORIES.find((c) => c.id === category)?.label || 'History';

  const { data, loading, error, reload } = useAsync(
    () =>
      ledgerApi.daybook(scope, queryBranch, { from: '2000-01-01', to: todayIST() }, { types: category === 'all' ? undefined : [category] }),
    [scope, queryBranch, category, reloadKey]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.rows || [];
    return q ? all.filter((r) => `${r.number} ${r.party} ${r.description} ${r.method} ${r.type}`.toLowerCase().includes(q)) : all;
  }, [data, search]);

  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);

  const exportCsv = () =>
    downloadCSV(
      `History_${category === 'all' ? 'all' : category.replace(/\W+/g, '_')}_${effectiveBranch}.csv`,
      ['Date', 'Branch', 'Voucher', 'Number', 'Party', 'Description', 'Method', 'Debit', 'Credit'],
      rows.map((r) => [r.date, branchName(r.branchId), r.type, r.number, r.party, r.description, r.method, r.debit, r.credit])
    );

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load the history" message={error} onRetry={reload} />}
      <div className={`${CARD} overflow-hidden`}>
        <CardHeader
          title={label}
          hint={data ? `${data.totals.count} records on file, every date.` : 'Every record on file, every date.'}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, party or note"
            aria-label="Search the history"
            className={`${INPUT} w-full sm:w-56`}
          />
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </CardHeader>

        {loading && !data ? (
          <LoadingBox label={`Loading ${label.toLowerCase()}...`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Date</th>
                  {showBranch && <th className={TH}>Branch</th>}
                  {category === 'all' && <th className={TH}>Voucher</th>}
                  <th className={TH}>Number</th>
                  <th className={TH}>Party</th>
                  <th className={TH}>Description</th>
                  <th className={TH}>Method</th>
                  <th className={THR}>Debit</th>
                  <th className={THR}>Credit</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {rows.length === 0 ? (
                  <EmptyRow cols={(showBranch ? 8 : 7) + (category === 'all' ? 1 : 0)} text="Nothing recorded here yet." />
                ) : (
                  rows.map((r) => (
                    <tr key={r.ref} className={TROW}>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(r.date)}</td>
                      {showBranch && <td className={`${TD} whitespace-nowrap`}>{branchName(r.branchId)}</td>}
                      {category === 'all' && <td className={`${TD} whitespace-nowrap`}>{r.type}</td>}
                      <td className={`${TD} whitespace-nowrap font-mono`}>{r.number || '-'}</td>
                      <td className={`${TD} max-w-[12rem] truncate font-medium text-slate-900 dark:text-white`} title={r.party}>{r.party || '-'}</td>
                      <td className={`${TD} max-w-[18rem] truncate`} title={r.description}>{r.description || '-'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{r.method}</td>
                      <td className={`${TDR} ${r.debit > 0 ? IN_TONE : ''}`}>{r.debit > 0 ? money(r.debit) : '-'}</td>
                      <td className={`${TDR} ${r.credit > 0 ? OUT_TONE : ''}`}>{r.credit > 0 ? money(r.credit) : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className={TFOOT}>
                  <tr>
                    <td className={TH} colSpan={(showBranch ? 5 : 4) + (category === 'all' ? 1 : 0) + 1}>
                      {rows.length} shown
                    </td>
                    <td className={`${THR} font-mono`}>{money(debit)}</td>
                    <td className={`${THR} font-mono`}>{money(credit)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {data?.truncated && (
          <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Only the newest 5,000 records are listed.
          </p>
        )}
      </div>
    </div>
  );
};
