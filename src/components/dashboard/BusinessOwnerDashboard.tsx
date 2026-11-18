import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Database, FileSpreadsheet, History, Loader2 } from 'lucide-react';
import { downloadSqlDatabaseBackup } from '../../services/api';
import { useERP } from '../../context/ERPContext';
import { documentApi, type DocumentRow, type DocumentSummary } from '../../services/documentApi';
import { machineSaleApi, type MachineSale, type MachineSaleSummary } from '../../services/machineSaleApi';
import { quickSaleApi, type QuickSaleSummary } from '../../services/quickSaleApi';
import { useApiScope } from '../documents/ui';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

// Every figure here is read from real records. With no records yet, everything shows zero.
const CARD = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';

export const BusinessOwnerDashboard: React.FC = () => {
  const { settings, branches, products, warranties, customers, auditLogs, setCurrentView, showToast, currentRole } = useERP();
  const { scope, branchParam } = useApiScope();
  const cs = settings.currencySymbol || '₹';
  const money = (n: number) => `${cs}${Math.round(n || 0).toLocaleString('en-IN')}`;

  const [invoices, setInvoices] = useState<DocumentRow[]>([]);
  const [invSummary, setInvSummary] = useState<DocumentSummary | null>(null);
  const [machine, setMachine] = useState<MachineSaleSummary | null>(null);
  const [machineRows, setMachineRows] = useState<MachineSale[]>([]);
  const [quick, setQuick] = useState<QuickSaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // silent = a background refresh: no spinner, and a failed refresh keeps the figures already on screen.
  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }
      try {
        const [rows, sum, ms, msRows, qs] = await Promise.all([
          documentApi.list(scope, { type: 'invoice', branchId: branchParam }),
          documentApi.summary(scope, 'invoice', branchParam),
          machineSaleApi.summary(scope, branchParam),
          machineSaleApi.list(scope, { branchId: branchParam }),
          // Counter sales are their own records; if they cannot be read the other figures still show.
          quickSaleApi.summary(scope, branchParam).catch(() => null)
        ]);
        if (!mounted.current) return;
        setInvoices(Array.isArray(rows) ? rows : []);
        setInvSummary(sum);
        setMachine(ms);
        setMachineRows(Array.isArray(msRows) ? msRows : []);
        setQuick(qs);
        setUpdatedAt(new Date());
        setError('');
      } catch (e: any) {
        if (mounted.current && !silent) setError(e?.message || 'Could not load the figures.');
      } finally {
        if (mounted.current && !silent) setLoading(false);
      }
    },
    [scope, branchParam]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Branch figures follow sales and payments made anywhere, without reloading the page.
  useLiveRefresh(() => load(true), 20_000);

  // Invoices that count as sales: issued or paid, not drafts or cancelled.
  const counted = useMemo(
    () => invoices.filter((d) => ['Issued', 'Partially Paid', 'Paid'].includes(String(d.status))),
    [invoices]
  );

  // Machine sales that count: everything except cancelled. A subsidy the department has paid counts as collected.
  const msLive = useMemo(() => machineRows.filter((m) => m.status !== 'Cancelled'), [machineRows]);
  const msCollected = (m: MachineSale) =>
    (m.paidAmount || 0) + (m.saleType === 'subsidy' && m.subsidyStatus === 'Received' ? m.subsidyAmount || 0 : 0);
  const ms = useMemo(() => {
    let value = 0;
    let collected = 0;
    let balance = 0;
    let subsidyDue = 0;
    for (const m of msLive) {
      value += m.salePrice || 0;
      collected += msCollected(m);
      balance += m.balance || 0;
      subsidyDue += m.subsidyDue || 0;
    }
    return { count: msLive.length, value, collected, balance, subsidyDue };
  }, [msLive]);

  const byBranch = useMemo(
    () =>
      branches.map((b) => {
        const rows = counted.filter((d) => d.branchId === b.id);
        const mrows = msLive.filter((m) => m.branchId === b.id);
        const q = quick?.byBranch?.find((x) => x.branchId === b.id);
        const invoiced = rows.reduce((s, d) => s + (d.grandTotal || 0), 0) + (q?.total || 0);
        const collected = rows.reduce((s, d) => s + (d.paidAmount || 0), 0) + (q?.collected || 0);
        return {
          id: b.id,
          name: b.name,
          city: b.city,
          count: rows.length + (q?.count || 0),
          machines: mrows.length,
          invoiced,
          collected,
          outstanding: invoiced - collected
        };
      }),
    [branches, counted, msLive, quick]
  );

  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; invoiced: number; count: number }>();
    for (const d of counted) {
      const key = d.customerId || d.customerName;
      const cur = map.get(key) || { name: d.customerName, invoiced: 0, count: 0 };
      cur.invoiced += d.grandTotal || 0;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.invoiced - a.invoiced).slice(0, 5);
  }, [counted]);

  const stockUnits = useMemo(
    () =>
      products
        .filter((p) => !p.isArchived && p.status !== 'Archived')
        .reduce((sum, p) => sum + (p.warehouseStocks || []).reduce((s, w) => s + (w.available || 0), 0), 0),
    [products]
  );

  // Headline figures come from invoices only. A machine sale makes its own invoice when it is booked,
  // so machine sales are already inside these totals.
  // Counter (quick) sales are paid at the counter and live in their own records, so they are added on top.
  const quickTotal = quick?.total ?? 0;
  const quickCount = quick?.count ?? 0;
  const invoiced = (invSummary?.invoiced ?? 0) + quickTotal;
  const collected = (invSummary?.collected ?? 0) + (quick?.collected ?? 0);
  const outstanding = invSummary?.outstanding ?? 0;
  const machineInvoices = counted.filter((d) => (d as any).sourceMachineSaleId).length;
  const noSalesYet = !loading && counted.length === 0 && quickCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Enterprise Profitability &amp; Growth Matrix</h1>
          <p className="mt-0.5 text-xs text-slate-300">
            Sales, collections and stock across your branches, read from your own records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={async () => {
              try {
                showToast('Exporting SQL Backup...', 'Generating full SQL dump with tables, schemas, and records.', 'info');
                await downloadSqlDatabaseBackup();
                showToast('SQL Backup Exported', 'Database backup downloaded successfully as .sql file.', 'success');
              } catch (e: any) {
                showToast('Export Failed', e.message || 'Failed to download SQL backup', 'error');
              }
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500"
            title="Download a full SQL backup"
          >
            <Database className="h-3.5 w-3.5" />
            <span>Export SQL (.sql)</span>
          </button>
          <button
            onClick={() => setCurrentView('reports')}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-blue-300" />
            <span>Reports</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Sales and collections */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Total sales',
            value: money(invoiced),
            hint: `${counted.length} invoice${counted.length === 1 ? '' : 's'}${machineInvoices > 0 ? `, ${machineInvoices} from machine sales` : ''}${quickCount > 0 ? `, ${quickCount} quick sale${quickCount === 1 ? '' : 's'} (${money(quickTotal)})` : ''}`
          },
          { label: 'Collected', value: money(collected), hint: 'Payments received, including counter sales' },
          {
            label: 'Outstanding',
            value: money(outstanding),
            hint: invSummary && invSummary.overdueCount > 0 ? `${invSummary.overdueCount} overdue` : 'Nothing overdue',
            tone: outstanding > 0 ? 'text-rose-600 dark:text-rose-400' : ''
          },
          { label: 'Stock on hand', value: stockUnits.toLocaleString('en-IN'), hint: 'Units across warehouses' }
        ].map((k) => (
          <div key={k.label} className={`${CARD} p-5`}>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{k.label}</span>
            <p className={`mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white ${k.tone || ''}`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : k.value}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Machine sales */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Machine sales and delivery</h2>
          <button
            type="button"
            onClick={() => setCurrentView('machine-sales')}
            className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            Open <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ['Booked', machine?.booked ?? 0],
            ['Ready', machine?.readyForDelivery ?? 0],
            ['On the way', machine?.dispatched ?? 0],
            ['Delivered this month', machine?.deliveredThisMonth ?? 0],
            ['Machines sold', ms.count],
            ['Sales value', money(ms.value)],
            ['Collected', money(ms.collected)],
            ['Balance to collect', money(ms.balance)],
            ['Subsidy to claim', money(ms.subsidyDue)]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
              <p className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Branch performance */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Branch performance</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400" title="Updates by itself every 20 seconds">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="px-5 py-2.5">Branch</th>
                <th className="px-3 py-2.5 text-right">Invoices</th>
                <th className="px-3 py-2.5 text-right">Machines</th>
                <th className="px-3 py-2.5 text-right">Invoiced</th>
                <th className="px-3 py-2.5 text-right">Collected</th>
                <th className="px-5 py-2.5 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {byBranch.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <span className="font-semibold text-slate-900 dark:text-white">{b.name}</span>
                    {b.city && <span className="block text-[10px] text-slate-400">{b.city}</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{b.count}</td>
                  <td className="px-3 py-3 text-right font-mono">{b.machines}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{money(b.invoiced)}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-600">{money(b.collected)}</td>
                  <td className={`px-5 py-3 text-right font-mono ${b.outstanding > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {money(b.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {noSalesYet && (
          <p className="border-t border-slate-100 px-5 py-4 text-center text-xs text-slate-500 dark:border-slate-800">
            No invoices or machine sales yet. Branch figures appear here as you make them.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top customers */}
        <div className={`${CARD} p-5`}>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Top customers by sales amount</h2>
          {topCustomers.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">No invoiced customers yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {topCustomers.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">
                    {i + 1}. {c.name}
                    <span className="ml-2 font-normal text-slate-400">{c.count} invoice{c.count === 1 ? '' : 's'}</span>
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{money(c.invoiced)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Counts */}
        <div className={`${CARD} p-5`}>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Records</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              ['Customers', customers.length, 'customers'],
              ['Products', products.filter((p) => !p.isArchived && p.status !== 'Archived').length, 'inventory'],
              ['Registered machines', warranties.length, 'warranties'],
              ['Branches', branches.length, 'branches']
            ].map(([label, value, view]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => setCurrentView(view as any)}
                className="cursor-pointer rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
              >
                <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
                <p className="mt-0.5 font-mono text-lg font-bold text-slate-900 dark:text-white">{value}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className={`${CARD} p-5`}>
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Recent activity
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {auditLogs.length} events
                </span>
              </h3>
              <p className="text-xs text-slate-500">Who did what: invoices, stock changes, approvals and settings.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('activity-logs')}
            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:self-auto"
          >
            <span>Open activity log</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {auditLogs.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No activity yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800/60">
            {auditLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex flex-col justify-between gap-1 py-3 text-xs sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 dark:text-white">{log.action}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {log.module}
                  </span>
                  <span className="ml-2 text-slate-500">by {log.user}</span>
                  <p className="mt-0.5 truncate text-slate-600 dark:text-slate-400">{log.details}</p>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{log.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
