import React, { useState } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { ledgerApi, type CustomerBalance, type DateRange } from '../../services/ledgerApi';
import { downloadCSV } from '../../utils/csvExport';
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
import { StatementPanel } from './StatementPanel';

interface Props {
  range: DateRange;
  reloadKey: number;
}

export const CustomerLedgerTab: React.FC<Props> = ({ range, reloadKey }) => {
  const { scope, queryBranch, effectiveBranch, money } = useLedgerContext();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<CustomerBalance | null>(null);
  const q = useDebounced(search);

  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.customers(scope, queryBranch, q),
    [scope, queryBranch, q, reloadKey]
  );

  const exportCsv = () => {
    if (!data) return;
    downloadCSV(
      `Customer_Outstanding_${effectiveBranch}_${data.asOf}.csv`,
      ['Customer', 'Phone', 'Invoices', 'Last invoice', 'Last payment', '0-30', '31-60', '61-90', '90+', 'Outstanding'],
      data.customers.map((c) => [c.name, c.phone, c.invoiceCount, c.lastInvoiceDate, c.lastPaymentDate, c.ageing.b0_30, c.ageing.b31_60, c.ageing.b61_90, c.ageing.b90_plus, c.outstanding])
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBox title="Could not load customer balances" message={error} onRetry={reload} />}

      <div className={`${CARD} overflow-hidden`}>
        <CardHeader
          title="Customer Ledger"
          hint={`Outstanding GST invoice balances as of ${data ? formatDate(data.asOf) : 'today'}. Ageing counts days past the due date; invoices not yet due are in 0-30. Click a customer for the statement of the selected period.`}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, phone, invoice"
              className={`${INPUT} w-60 pl-8`}
              aria-label="Search customers"
            />
          </div>
          <button type="button" onClick={exportCsv} disabled={!data || data.customers.length === 0} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </CardHeader>

        {loading && !data ? (
          <LoadingBox label="Loading customer balances..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Last invoice</th>
                  <th className={TH}>Last payment</th>
                  <th className={THR}>0-30</th>
                  <th className={THR}>31-60</th>
                  <th className={THR}>61-90</th>
                  <th className={THR}>90+</th>
                  <th className={THR}>Outstanding</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {!data || data.customers.length === 0 ? (
                  <EmptyRow cols={8} text={q ? 'No customers match your search.' : 'No customer has an outstanding balance.'} />
                ) : (
                  data.customers.map((c) => (
                    <tr
                      key={c.key}
                      onClick={() => setActive(c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActive(c);
                        }
                      }}
                      tabIndex={0}
                      className={`${TROW} cursor-pointer`}
                    >
                      <td className={TD}>
                        <p className="max-w-[16rem] truncate font-bold text-slate-900 dark:text-white" title={c.name}>
                          {c.name}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                          {c.phone || 'No phone'} &middot; {c.invoiceCount} invoices
                        </p>
                      </td>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(c.lastInvoiceDate)}</td>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(c.lastPaymentDate)}</td>
                      <td className={TDR}>{c.ageing.b0_30 > 0 ? money(c.ageing.b0_30) : '-'}</td>
                      <td className={TDR}>{c.ageing.b31_60 > 0 ? money(c.ageing.b31_60) : '-'}</td>
                      <td className={`${TDR} ${c.ageing.b61_90 > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{c.ageing.b61_90 > 0 ? money(c.ageing.b61_90) : '-'}</td>
                      <td className={`${TDR} ${c.ageing.b90_plus > 0 ? OUT_TONE : ''}`}>{c.ageing.b90_plus > 0 ? money(c.ageing.b90_plus) : '-'}</td>
                      <td className={`${TDR} font-bold text-slate-900 dark:text-white`}>{money(c.outstanding)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {data && data.customers.length > 0 && (
                <tfoot className={TFOOT}>
                  <tr>
                    <td className={TH} colSpan={3}>
                      Total ({data.totals.count} customers)
                    </td>
                    <td className={`${THR} font-mono`}>{money(data.totals.b0_30)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.b31_60)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.b61_90)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.b90_plus)}</td>
                    <td className={`${THR} font-mono`}>{money(data.totals.outstanding)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {active && <StatementPanel customer={active} range={range} onClose={() => setActive(null)} />}
    </div>
  );
};
