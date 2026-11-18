import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { ledgerApi, type DateRange, type ProfitLoss } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import {
  BTN_GHOST,
  CARD,
  CardHeader,
  ErrorBox,
  IN_TONE,
  LoadingBox,
  OUT_TONE,
  TBODY,
  TFOOT,
  TH,
  THEAD,
  THR,
  TD,
  TDR,
  TROW,
  formatDate,
  useAsync,
  useLedgerContext
} from './shared';

interface Props {
  range: DateRange;
  reloadKey: number;
}

export const ProfitLossTab: React.FC<Props> = ({ range, reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money } = useLedgerContext();
  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.pnl(scope, queryBranch, range),
    [scope, queryBranch, range.from, range.to, reloadKey]
  );

  const exportCsv = (d: ProfitLoss) => {
    const rows: (string | number)[][] = [
      ['Income', 'Quick sales (net of GST)', d.income.quickSales],
      ['Income', 'GST invoices (taxable value)', d.income.gstInvoices],
      ['Income', 'Service job cards', d.income.service],
      ['Income', 'Total income', d.income.total],
      ['Cost', 'Cost of goods sold', d.cogs],
      ['Profit', 'Gross profit', d.grossProfit],
      ...d.expenses.lines.map((l): (string | number)[] => ['Expense', l.label, l.amount]),
      ['Expense', 'Total expenses', d.expenses.total],
      ['Profit', 'Net profit', d.netProfit]
    ];
    downloadCSV(`Profit_and_Loss_${effectiveBranch}_${range.from}_to_${range.to}.csv`, ['Section', 'Line', 'Amount'], rows);
  };

  const row = (label: string, value: number, opts: { indent?: boolean; bold?: boolean; tone?: string; note?: string } = {}) => (
    <div
      className={`flex items-baseline justify-between gap-4 px-5 py-2 text-xs ${opts.bold ? 'bg-slate-50 font-bold dark:bg-slate-800/60' : ''}`}
    >
      <span className={`min-w-0 ${opts.indent ? 'pl-4' : ''} ${opts.bold ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
        {label}
        {opts.note && <span className="ml-2 text-[10px] font-normal text-slate-400 dark:text-slate-500">{opts.note}</span>}
      </span>
      <span className={`whitespace-nowrap text-right font-mono ${opts.tone || 'text-slate-900 dark:text-white'}`}>{money(value)}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load the profit and loss statement" message={error} onRetry={reload} />}
      {loading && !data && !error && (
        <div className={CARD}>
          <LoadingBox label="Loading profit and loss..." />
        </div>
      )}

      {data && (
        <>
          <div className={`${CARD} overflow-hidden`}>
            <CardHeader title="Profit & Loss" hint={`${formatDate(data.from)} to ${formatDate(data.to)}`}>
              <button type="button" onClick={() => exportCsv(data)} className={BTN_GHOST}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Export CSV</span>
              </button>
            </CardHeader>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <div className="px-5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Income</div>
              {row('Quick sales', data.income.quickSales, { indent: true, note: 'net of GST' })}
              {row('GST invoices', data.income.gstInvoices, { indent: true, note: 'taxable value' })}
              {row('Service job cards', data.income.service, { indent: true, note: 'by received date' })}
              {row('Total income', data.income.total, { bold: true })}
              {row('Less: cost of goods sold', data.cogs, { note: 'purchase price of items sold', tone: OUT_TONE })}
              {row(`Gross profit (${data.grossMarginPct.toFixed(1)}%)`, data.grossProfit, {
                bold: true,
                tone: data.grossProfit >= 0 ? IN_TONE : OUT_TONE
              })}
              <div className="px-5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Expenses</div>
              {data.expenses.lines.length === 0 ? (
                <div className="px-5 py-3 pl-9 text-xs text-slate-400 dark:text-slate-500">No expenses in this period.</div>
              ) : (
                data.expenses.lines.map((l) => row(l.label, l.amount, { indent: true }))
              )}
              {row('Total expenses', data.expenses.total, { bold: true, tone: OUT_TONE })}
              {row('Net profit', data.netProfit, { bold: true, tone: data.netProfit >= 0 ? IN_TONE : OUT_TONE })}
            </div>
            <p className="border-t border-slate-100 px-5 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
              Bank deposits and withdrawals, owner or partner transfers and salary advances are not expenses and are excluded. Salaries are counted when paid.
            </p>
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <CardHeader title="Branch comparison" hint="Same period, per branch." />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>Branch</th>
                    <th className={THR}>Quick sales</th>
                    <th className={THR}>GST invoices</th>
                    <th className={THR}>Service</th>
                    <th className={THR}>Income</th>
                    <th className={THR}>COGS</th>
                    <th className={THR}>Gross profit</th>
                    <th className={THR}>Expenses</th>
                    <th className={THR}>Net profit</th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {data.byBranch.map((b) => (
                    <tr key={b.branchId} className={TROW}>
                      <td className={`${TD} whitespace-nowrap font-bold text-slate-900 dark:text-white`}>{b.branchName}</td>
                      <td className={TDR}>{money(b.quickSales)}</td>
                      <td className={TDR}>{money(b.gstInvoices)}</td>
                      <td className={TDR}>{money(b.service)}</td>
                      <td className={`${TDR} font-bold`}>{money(b.income)}</td>
                      <td className={TDR}>{money(b.cogs)}</td>
                      <td className={TDR}>{money(b.grossProfit)}</td>
                      <td className={TDR}>{money(b.expenses)}</td>
                      <td className={`${TDR} font-bold ${b.netProfit >= 0 ? IN_TONE : OUT_TONE}`}>{money(b.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
                {data.byBranch.length > 1 && (
                  <tfoot className={TFOOT}>
                    <tr>
                      <td className={TH}>Total</td>
                      <td className={`${THR} font-mono`}>{money(data.income.quickSales)}</td>
                      <td className={`${THR} font-mono`}>{money(data.income.gstInvoices)}</td>
                      <td className={`${THR} font-mono`}>{money(data.income.service)}</td>
                      <td className={`${THR} font-mono`}>{money(data.income.total)}</td>
                      <td className={`${THR} font-mono`}>{money(data.cogs)}</td>
                      <td className={`${THR} font-mono`}>{money(data.grossProfit)}</td>
                      <td className={`${THR} font-mono`}>{money(data.expenses.total)}</td>
                      <td className={`${THR} font-mono`}>{money(data.netProfit)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
