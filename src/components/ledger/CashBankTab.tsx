import React, { useState } from 'react';
import { Banknote, ChevronDown, ChevronUp, CreditCard, FileSpreadsheet, Landmark, Smartphone } from 'lucide-react';
import { ledgerApi, type CashBankMethod, type DateRange } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import {
  BTN_GHOST,
  CARD,
  CardHeader,
  EmptyRow,
  ErrorBox,
  IN_TONE,
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
  useAsync,
  useLedgerContext
} from './shared';

interface Props {
  range: DateRange;
  reloadKey: number;
}

const ICONS: Record<string, React.ElementType> = {
  Cash: Banknote,
  UPI: Smartphone,
  'Bank Transfer': Landmark,
  Card: CreditCard
};

export const CashBankTab: React.FC<Props> = ({ range, reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money, branchName } = useLedgerContext();
  const [open, setOpen] = useState<string | null>('Cash');
  const showBranch = effectiveBranch === 'all';

  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.cashBank(scope, queryBranch, range),
    [scope, queryBranch, range.from, range.to, reloadKey]
  );

  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [];
    for (const m of data.methods) {
      for (const l of m.lines) rows.push([m.method, l.date, branchName(l.branchId), l.type, l.number, l.party, l.description, l.receipt, l.payment, l.balance]);
    }
    downloadCSV(
      `Cash_Bank_Book_${effectiveBranch}_${range.from}_to_${range.to}.csv`,
      ['Method', 'Date', 'Branch', 'Voucher', 'Number', 'Party', 'Description', 'Receipt', 'Payment', 'Balance'],
      rows
    );
  };

  const line = (label: string, value: number, tone = 'text-slate-700 dark:text-slate-300') => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-mono ${tone}`}>{money(value)}</span>
    </div>
  );

  const selected: CashBankMethod | undefined = data?.methods.find((m) => m.method === open);
  const cols = showBranch ? 8 : 7;

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load the cash and bank book" message={error} onRetry={reload} />}
      {loading && !data && !error && (
        <div className={CARD}>
          <LoadingBox label="Loading cash and bank book..." />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.methods.map((m) => {
              const Icon = ICONS[m.method] || Landmark;
              const isOpen = open === m.method;
              return (
                <div key={m.method} className={`${CARD} min-w-0 p-4 ${isOpen ? 'ring-1 ring-slate-800 dark:ring-slate-500' : ''}`}>
                  <div className="mb-1 flex items-center justify-between text-slate-900 dark:text-white">
                    <span className="text-sm font-bold">{m.method}</span>
                    <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {line('Opening', m.opening)}
                    {line('Receipts', m.receipts, IN_TONE)}
                    {line('Payments', m.payments, OUT_TONE)}
                    <div className="flex items-center justify-between gap-3 py-2 text-sm font-bold">
                      <span className="text-slate-900 dark:text-white">Closing</span>
                      <span className="font-mono text-slate-900 dark:text-white">{money(m.closing)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : m.method)}
                    className="mt-2 flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-expanded={isOpen}
                  >
                    <span>{m.count} movements</span>
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>

          <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs`}>
            <span className="font-bold text-slate-900 dark:text-white">All methods combined</span>
            <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-slate-700 dark:text-slate-300">
              <span>Opening {money(data.totals.opening)}</span>
              <span className={IN_TONE}>Receipts {money(data.totals.receipts)}</span>
              <span className={OUT_TONE}>Payments {money(data.totals.payments)}</span>
              <span className="font-bold text-slate-900 dark:text-white">Closing {money(data.totals.closing)}</span>
            </div>
          </div>

          {selected && (
            <div className={`${CARD} overflow-hidden`}>
              <CardHeader title={`${selected.method} movements`} hint="Opening is everything received or paid before the start date.">
                <button type="button" onClick={exportCsv} className={BTN_GHOST}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export all CSV</span>
                </button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH}>Date</th>
                      {showBranch && <th className={TH}>Branch</th>}
                      <th className={TH}>Voucher</th>
                      <th className={TH}>Party / description</th>
                      <th className={THR}>Receipt</th>
                      <th className={THR}>Payment</th>
                      <th className={THR}>Balance</th>
                    </tr>
                  </thead>
                  <tbody className={TBODY}>
                    <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                      <td className={`${TD} font-bold`} colSpan={showBranch ? 6 : 5}>
                        Opening balance
                      </td>
                      <td className={`${TDR} font-bold`}>{money(selected.opening)}</td>
                    </tr>
                    {selected.lines.length === 0 ? (
                      <EmptyRow cols={cols - 1} text={`No ${selected.method} movements in this period.`} />
                    ) : (
                      selected.lines.map((l) => (
                        <tr key={l.ref} className={TROW}>
                          <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(l.date)}</td>
                          {showBranch && <td className={`${TD} whitespace-nowrap`}>{branchName(l.branchId)}</td>}
                          <td className={`${TD} whitespace-nowrap`}>
                            {l.type}
                            {l.number ? <span className="ml-1.5 font-mono text-slate-400 dark:text-slate-500">{l.number}</span> : null}
                          </td>
                          <td className={`${TD} max-w-[22rem] truncate`} title={`${l.party} ${l.description}`}>
                            {l.party && <span className="font-medium text-slate-900 dark:text-white">{l.party}</span>}
                            {l.party && l.description ? <span className="text-slate-400"> &middot; </span> : null}
                            {l.description}
                          </td>
                          <td className={`${TDR} ${l.receipt > 0 ? IN_TONE : ''}`}>{l.receipt > 0 ? money(l.receipt) : '-'}</td>
                          <td className={`${TDR} ${l.payment > 0 ? OUT_TONE : ''}`}>{l.payment > 0 ? money(l.payment) : '-'}</td>
                          <td className={`${TDR} font-bold text-slate-900 dark:text-white`}>{money(l.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {selected.truncated && (
                <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-amber-700 dark:border-slate-800 dark:text-amber-400">
                  Showing the first {selected.lines.length} movements. Narrow the date range to see the rest.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
