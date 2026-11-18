import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { listMovementsApi, type StockMovementRow } from '../../services/stockApi';
import { downloadCSV } from '../../utils/csvExport';

const TYPE_LABELS: Record<string, string> = {
  receipt: 'Stock receipt',
  'branch-receipt': 'Added to branch',
  'transfer-out': 'Transfer out',
  'transfer-in': 'Transfer in',
  'transfer-damage': 'Transfer damage',
  'transfer-short': 'Transfer short',
  adjustment: 'Adjustment',
  sale: 'Counter sale',
  'document-sale': 'Invoice',
  'sale-return': 'Customer return',
  'service-part': 'Service part',
  opening: 'Opening stock'
};

const cardClass = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400';
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const StockLedgerView: React.FC = () => {
  const { currentRole, products, warehouses } = useERP();
  const { assignedBranchId } = useAuth();
  const scope = useMemo(() => ({ role: currentRole, branchId: assignedBranchId || 'branch-1' }), [currentRole, assignedBranchId]);

  const [rows, setRows] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listMovementsApi(scope, { product_id: productId, warehouse_id: warehouseId, from, to, limit: 500 }));
    } catch (e: any) {
      setError(e.message || 'Could not load the stock ledger.');
    } finally {
      setLoading(false);
    }
  }, [scope, productId, warehouseId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;
  const shown = useMemo(() => (type ? rows.filter((r) => r.type === type) : rows), [rows, type]);
  const totals = useMemo(
    () => ({
      inQty: shown.reduce((s, r) => s + (r.availableDelta > 0 ? r.availableDelta : 0), 0),
      outQty: shown.reduce((s, r) => s + (r.availableDelta < 0 ? -r.availableDelta : 0), 0)
    }),
    [shown]
  );

  const exportCsv = () =>
    downloadCSV(
      `stock-ledger-${from}-to-${to}.csv`,
      ['Date', 'Product', 'Location', 'Type', 'Change', 'Incoming change', 'Balance', 'Reference', 'Note', 'By'],
      shown.map((r) => [
        new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        r.productName,
        whName(r.warehouseId),
        TYPE_LABELS[r.type] || r.type,
        r.availableDelta,
        r.inTransitDelta,
        r.balanceAfter,
        r.refId,
        r.note,
        r.createdBy
      ])
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Stock Ledger</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Every stock change with who did it and the balance after: receipts, transfers, adjustments and sales.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={!shown.length}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-50 cursor-pointer dark:bg-slate-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className={`${cardClass} grid grid-cols-2 gap-3 p-4 md:grid-cols-5`}>
        <label className="text-[11px] font-semibold text-slate-500">
          Product
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Location
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">All locations</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className={`${cardClass} flex items-center gap-3 p-3`}>
          <ArrowDownLeft className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-[11px] text-slate-500">Stock in</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{totals.inQty.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className={`${cardClass} flex items-center gap-3 p-3`}>
          <ArrowUpRight className="h-5 w-5 text-rose-600" />
          <div>
            <p className="text-[11px] text-slate-500">Stock out</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{totals.outQty.toLocaleString('en-IN')}</p>
          </div>
        </div>
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        {error ? (
          <p className="p-6 text-center text-xs font-semibold text-rose-600">{error}</p>
        ) : loading && !rows.length ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading stock ledger...
          </div>
        ) : !shown.length ? (
          <p className="p-10 text-center text-xs text-slate-500">
            No stock movements in this period. Record a Stock Receipt at the Head Office to start the ledger.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Incoming</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600 dark:text-slate-300">
                      {new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{r.productName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600 dark:text-slate-300">{whName(r.warehouseId)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {TYPE_LABELS[r.type] || r.type}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-bold ${
                        r.availableDelta > 0 ? 'text-emerald-600' : r.availableDelta < 0 ? 'text-rose-600' : 'text-slate-400'
                      }`}
                    >
                      {r.availableDelta > 0 ? '+' : ''}
                      {r.availableDelta}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {r.inTransitDelta ? `${r.inTransitDelta > 0 ? '+' : ''}${r.inTransitDelta}` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-white">{r.balanceAfter}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{r.refId || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.createdBy || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
