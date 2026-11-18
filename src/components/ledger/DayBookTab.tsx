import React, { useState } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { VOUCHER_TYPES, ledgerApi, type DateRange, type VoucherType } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import {
  BTN_GHOST,
  CARD,
  CardHeader,
  EmptyRow,
  ErrorBox,
  INPUT,
  LoadingBox,
  TBODY,
  TD,
  TDR,
  TFOOT,
  TH,
  THEAD,
  THR,
  TROW,
  formatDate,
  useAsync,
  useDebounced,
  useLedgerContext
} from './shared';

interface Props {
  range: DateRange;
  reloadKey: number;
}

const TYPE_TONE: Record<VoucherType, string> = {
  Sale: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  Invoice: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  Receipt: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Service Receipt': 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  Expense: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  Salary: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Cash In': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Cash Out': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
};

export const DayBookTab: React.FC<Props> = ({ range, reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money, branchName } = useLedgerContext();
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<VoucherType[]>([]);
  const q = useDebounced(search);
  const showBranch = effectiveBranch === 'all';

  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.daybook(scope, queryBranch, range, { q, types }),
    [scope, queryBranch, range.from, range.to, q, types.join(','), reloadKey]
  );

  const toggle = (t: VoucherType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const exportCsv = () => {
    if (!data) return;
    downloadCSV(
      `Day_Book_${effectiveBranch}_${range.from}_to_${range.to}.csv`,
      ['Date', 'Branch', 'Voucher', 'Number', 'Party', 'Description', 'Method', 'Debit', 'Credit', 'Balance', 'On account'],
      data.rows.map((r) => [r.date, branchName(r.branchId), r.type, r.number, r.party, r.description, r.method, r.debit, r.credit, r.balance, r.onAccount ? 'Yes' : 'No'])
    );
  };

  const cols = showBranch ? 10 : 9;

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load the day book" message={error} onRetry={reload} />}

      <div className={`${CARD} overflow-hidden`}>
        <CardHeader title="Day Book" hint="Latest first. Debit is money in or value billed; credit is money out. Balance moves only for cash and bank vouchers.">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, party, note"
              className={`${INPUT} w-56 pl-8`}
              aria-label="Search vouchers"
            />
          </div>
          <button type="button" onClick={exportCsv} disabled={!data || data.rows.length === 0} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </CardHeader>

        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTypes([])}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-bold ${
              types.length === 0
                ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-600 dark:bg-slate-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            All
          </button>
          {VOUCHER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-bold ${
                types.includes(t)
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-600 dark:bg-slate-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <LoadingBox label="Loading day book..." />
        ) : (
          <>
          {/* Phones: one card per voucher, newest first */}
          <ul className="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            {!data || data.rows.length === 0 ? (
              <li className="px-5 py-8 text-center text-xs text-slate-500">No vouchers match this period and filter.</li>
            ) : (
              data.rows.map((r) => (
                <li key={r.ref} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TYPE_TONE[r.type] || TYPE_TONE['Cash In']}`}>{r.type}</span>
                    <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">{formatDate(r.date)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.party || '-'}</p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {[r.number, r.method, showBranch ? branchName(r.branchId) : ''].filter(Boolean).join(' · ') || '-'}
                      </p>
                      {r.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-300">{r.description}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {r.debit > 0 && (
                        <p className={`font-mono text-sm font-bold ${r.onAccount ? 'italic text-slate-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          +{money(r.debit)}
                        </p>
                      )}
                      {r.credit > 0 && <p className="font-mono text-sm font-bold text-rose-600 dark:text-rose-400">-{money(r.credit)}</p>}
                      <p className="font-mono text-[10px] text-slate-500">Balance {money(r.balance)}</p>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
          {data && data.rows.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] font-semibold text-slate-700 sm:hidden dark:border-slate-800 dark:text-slate-300">
              {data.totals.count} vouchers · in {money(data.totals.moneyIn)} · out {money(data.totals.moneyOut)} · net {money(data.totals.net)}
            </div>
          )}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Date</th>
                  {showBranch && <th className={TH}>Branch</th>}
                  <th className={TH}>Voucher</th>
                  <th className={TH}>Number</th>
                  <th className={TH}>Party</th>
                  <th className={TH}>Description</th>
                  <th className={TH}>Method</th>
                  <th className={THR}>Debit</th>
                  <th className={THR}>Credit</th>
                  <th className={THR}>Balance</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {!data || data.rows.length === 0 ? (
                  <EmptyRow cols={cols} text="No vouchers match this period and filter." />
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.ref} className={TROW}>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(r.date)}</td>
                      {showBranch && <td className={`${TD} whitespace-nowrap`}>{branchName(r.branchId)}</td>}
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${TYPE_TONE[r.type] || TYPE_TONE['Cash In']}`}>{r.type}</span>
                      </td>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{r.number || '-'}</td>
                      <td className={`${TD} max-w-[12rem] truncate font-medium text-slate-900 dark:text-white`} title={r.party}>{r.party || '-'}</td>
                      <td className={`${TD} max-w-[18rem] truncate`} title={r.description}>{r.description || '-'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{r.method}</td>
                      <td
                        className={`${TDR} ${r.onAccount && r.debit > 0 ? 'italic text-slate-400 dark:text-slate-500' : ''}`}
                        title={r.onAccount && r.debit > 0 ? 'Billed on account, no cash movement' : undefined}
                      >
                        {r.debit > 0 ? money(r.debit) : '-'}
                      </td>
                      <td className={TDR}>{r.credit > 0 ? money(r.credit) : '-'}</td>
                      <td className={`${TDR} font-bold text-slate-900 dark:text-white`}>{money(r.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {data && data.rows.length > 0 && (
                <tfoot className={TFOOT}>
                  <tr>
                    <td className={TH} colSpan={showBranch ? 7 : 6}>
                      Total ({data.totals.count} vouchers) &middot; money in {money(data.totals.moneyIn)}, money out {money(data.totals.moneyOut)}
                    </td>
                    <td className={`${THR} font-mono`}>{money(data.totals.debit)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.credit)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </>
        )}
        {data?.truncated && (
          <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-amber-700 dark:border-slate-800 dark:text-amber-400">
            Showing the latest {data.rows.length} vouchers. Narrow the date range to see older ones.
          </p>
        )}
      </div>
    </div>
  );
};
