import React from 'react';
import { FileSpreadsheet, MessageCircle, Printer, X } from 'lucide-react';
import { ledgerApi, type CustomerBalance, type CustomerStatement, type DateRange } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
import { buildWhatsAppLink, formatMessageDate, paymentReminderMessage } from '../../utils/whatsapp';
import {
  BTN_GHOST,
  ErrorBox,
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
  EmptyRow,
  escapeHtml,
  formatDate,
  useAsync,
  useLedgerContext
} from './shared';

interface Props {
  customer: CustomerBalance;
  range: DateRange;
  onClose: () => void;
}

export const StatementPanel: React.FC<Props> = ({ customer, range, onClose }) => {
  const { scope, queryBranch, money, currency, companyName, showToast } = useLedgerContext();
  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.statement(scope, queryBranch, customer.key, range),
    [scope, queryBranch, customer.key, range.from, range.to]
  );

  const reminderLink = (s: CustomerStatement): string | null => {
    if (s.outstandingToday <= 0) return null;
    const shown = s.openInvoices.slice(0, 3).map((i) => i.number);
    const extra = s.openInvoices.length - shown.length;
    const dueDates = s.openInvoices.map((i) => i.dueDate).filter((d): d is string => !!d).sort();
    const text = paymentReminderMessage({
      language: 'en',
      company: companyName,
      customerName: s.customer.name,
      currencySymbol: currency,
      invoiceNumber: extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', '),
      amountDue: s.outstandingToday,
      dueDate: dueDates[0] || null
    });
    return buildWhatsAppLink(s.customer.phone, text);
  };

  const sendReminder = () => {
    if (!data) return;
    const link = reminderLink(data);
    if (!link) {
      showToast('Cannot Send Reminder', 'This customer has no valid mobile number or nothing is outstanding.', 'warning');
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const exportCsv = () => {
    if (!data) return;
    downloadCSV(
      `Statement_${data.customer.name.replace(/[^A-Za-z0-9]+/g, '_')}_${range.from}_to_${range.to}.csv`,
      ['Date', 'Type', 'Number', 'Description', 'Debit', 'Credit', 'Balance'],
      [
        [range.from, 'Opening balance', '', '', '', '', data.openingBalance],
        ...data.lines.map((l) => [l.date, l.type, l.number, l.description, l.debit, l.credit, l.balance])
      ]
    );
  };

  const printStatement = () => {
    if (!data) return;
    const w = window.open('', '_blank');
    if (!w) {
      showToast('Pop-up Blocked', 'Allow pop-ups for this site to print the statement.', 'warning');
      return;
    }
    const rows = data.lines
      .map(
        (l) => `<tr><td>${escapeHtml(formatDate(l.date))}</td><td>${escapeHtml(l.type)}</td><td>${escapeHtml(l.number)}</td><td>${escapeHtml(l.description)}</td>
        <td class="r">${l.debit ? escapeHtml(money(l.debit)) : ''}</td><td class="r">${l.credit ? escapeHtml(money(l.credit)) : ''}</td><td class="r">${escapeHtml(money(l.balance))}</td></tr>`
      )
      .join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement - ${escapeHtml(data.customer.name)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;color:#0f172a;margin:24px}h1{font-size:16px;margin:0}p{margin:2px 0 10px;color:#475569}
      table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}th{background:#f1f5f9}.r{text-align:right;font-family:monospace}
      tfoot td{font-weight:bold;border-top:2px solid #0f172a}</style></head><body>
      <h1>${escapeHtml(companyName)} - Customer statement</h1>
      <p><b>${escapeHtml(data.customer.name)}</b>${data.customer.phone ? ` &middot; ${escapeHtml(data.customer.phone)}` : ''}<br>
      Period ${escapeHtml(formatDate(data.from))} to ${escapeHtml(formatDate(data.to))}</p>
      <table><thead><tr><th>Date</th><th>Type</th><th>Number</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
      <tbody><tr><td colspan="6"><b>Opening balance</b></td><td class="r"><b>${escapeHtml(money(data.openingBalance))}</b></td></tr>${rows}</tbody>
      <tfoot><tr><td colspan="4">Closing outstanding</td><td class="r">${escapeHtml(money(data.totalDebit))}</td><td class="r">${escapeHtml(money(data.totalCredit))}</td><td class="r">${escapeHtml(money(data.closingOutstanding))}</td></tr></tfoot></table>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  const tile = (label: string, value: number, tone = 'text-slate-900 dark:text-white') => (
    <div className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-right font-mono text-sm font-bold ${tone}`}>{money(value)}</p>
    </div>
  );

  const hasPhone = !!(data && buildWhatsAppLink(data.customer.phone, 'x'));

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/50" role="dialog" aria-modal="true" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{customer.name}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Statement {formatDate(range.from)} to {formatDate(range.to)}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Close statement"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <button type="button" onClick={printStatement} disabled={!data} className={BTN_GHOST}>
            <Printer className="h-3.5 w-3.5" />
            <span>Print</span>
          </button>
          <button type="button" onClick={exportCsv} disabled={!data} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={sendReminder}
            disabled={!data || data.outstandingToday <= 0 || !hasPhone}
            title={data && !hasPhone ? 'No valid mobile number on file' : undefined}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>Send reminder on WhatsApp</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error && <ErrorBox title="Could not load the statement" message={error} onRetry={reload} />}
          {loading && !data && <LoadingBox label="Loading statement..." />}
          {data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tile('Opening', data.openingBalance)}
                {tile('Billed', data.totalDebit)}
                {tile('Received', data.totalCredit, IN_TONE)}
                {tile('Closing outstanding', data.closingOutstanding, data.closingOutstanding > 0 ? OUT_TONE : IN_TONE)}
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white">Outstanding today</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{money(data.outstandingToday)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['0-30 days', data.ageing.b0_30],
                      ['31-60 days', data.ageing.b31_60],
                      ['61-90 days', data.ageing.b61_90],
                      ['90+ days', data.ageing.b90_plus]
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400 sm:block">
                      <p className="text-[10px] font-bold uppercase tracking-wide">{label}</p>
                      <p className="font-mono text-slate-900 dark:text-white sm:text-right">{money(value)}</p>
                    </div>
                  ))}
                </div>
                {data.openInvoices.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    Open: {data.openInvoices.map((i) => `${i.number} (due ${formatMessageDate(i.dueDate)})`).join(', ')}
                  </p>
                )}
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={THEAD}>
                      <tr>
                        <th className={TH}>Date</th>
                        <th className={TH}>Type</th>
                        <th className={TH}>Number</th>
                        <th className={TH}>Description</th>
                        <th className={THR}>Debit</th>
                        <th className={THR}>Credit</th>
                        <th className={THR}>Balance</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY}>
                      <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                        <td className={`${TD} font-bold`} colSpan={6}>
                          Opening balance
                        </td>
                        <td className={`${TDR} font-bold`}>{money(data.openingBalance)}</td>
                      </tr>
                      {data.lines.length === 0 ? (
                        <EmptyRow cols={7} text="No invoices or payments in this period." />
                      ) : (
                        data.lines.map((l, i) => (
                          <tr key={`${l.type}-${l.number}-${i}`} className={TROW}>
                            <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(l.date)}</td>
                            <td className={`${TD} whitespace-nowrap`}>{l.type}</td>
                            <td className={`${TD} whitespace-nowrap font-mono`}>{l.number}</td>
                            <td className={TD}>{l.description}</td>
                            <td className={TDR}>{l.debit > 0 ? money(l.debit) : '-'}</td>
                            <td className={`${TDR} ${l.credit > 0 ? IN_TONE : ''}`}>{l.credit > 0 ? money(l.credit) : '-'}</td>
                            <td className={`${TDR} font-bold text-slate-900 dark:text-white`}>{money(l.balance)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className={TFOOT}>
                      <tr>
                        <td className={TH} colSpan={4}>
                          Closing outstanding
                        </td>
                        <td className={`${THR} font-mono`}>{money(data.totalDebit)}</td>
                        <td className={`${THR} font-mono`}>{money(data.totalCredit)}</td>
                        <td className={`${THR} font-mono`}>{money(data.closingOutstanding)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
