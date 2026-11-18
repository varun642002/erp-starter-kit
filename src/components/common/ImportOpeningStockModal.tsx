import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import {
  importOpeningStockApi,
  type OpeningStockResult,
  type OpeningStockRowInput
} from '../../services/stockApi';
import { downloadCSV } from '../../utils/csvExport';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

function parseCsvText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const row: string[] = [];
    let inQuote = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        row.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    row.push(cur.trim());
    return row;
  });
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

type Mode = 'set' | 'add' | 'remove';

const REASONS = ['Physical count', 'Stock correction', 'Found / surplus', 'Damaged / scrap', 'Opening stock', 'Other'];

// 'Opening stock' is the first load of quantities; every other reason is a recorded stock correction.
const kindOf = (reason: string): 'opening' | 'update' => (reason === 'Opening stock' ? 'opening' : 'update');

export const ImportOpeningStockModal: React.FC<Props> = ({ isOpen, onClose, onImported }) => {
  const { currentRole, products, warehouses, showToast } = useERP();
  const { assignedBranchId } = useAuth();
  const scope = useMemo(() => ({ role: currentRole, branchId: assignedBranchId || 'branch-1' }), [currentRole, assignedBranchId]);

  const [rows, setRows] = useState<OpeningStockRowInput[]>([]);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<Mode>('set');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<OpeningStockResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const reset = () => {
    setRows([]);
    setFileName('');
    setPreview(null);
    setError('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const downloadTemplate = () => {
    const sample = products.slice(0, 5);
    downloadCSV(
      'stock-update-template.csv',
      ['SKU', 'Quantity', 'Warehouse (optional, default Head Office)', 'Rack', 'Row', 'Shelf', 'Bin'],
      sample.length ? sample.map((p) => [p.sku, 0, '', '', '', '', '']) : [['SKU-001', 10, '', 'A', '1', '2', '3']]
    );
  };

  // Today's stock as a file: change the Quantity column, keep the rows you want, and upload it back.
  const downloadCurrent = () => {
    const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;
    const out: (string | number)[][] = [];
    for (const p of products) {
      if (p.isArchived || p.status === 'Archived') continue;
      for (const s of p.warehouseStocks || []) out.push([p.sku, s.available, whName(s.warehouseId), p.name]);
    }
    downloadCSV('current-stock.csv', ['SKU', 'Quantity', 'Warehouse', 'Product (for reference)'], out);
  };

  const reasonText = reason === 'Other' ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;

  const runPreview = async (parsed: OpeningStockRowInput[], m: Mode, rsn: string = reason) => {
    setBusy(true);
    setError('');
    try {
      setPreview(await importOpeningStockApi(scope, { rows: parsed, mode: m, dryRun: true, kind: kindOf(rsn), reason: reasonText || rsn }));
    } catch (e: any) {
      setPreview(null);
      setError(e.message || 'Could not check the file.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    const grid = parseCsvText(await file.text());
    if (grid.length < 2) {
      setError('The file needs a header row and at least one data row.');
      return;
    }
    const headers = grid[0].map(norm);
    const col = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.startsWith(n)));
    const iSku = col('sku', 'itemnumber', 'itemcode', 'partnumber');
    const iQty = col('quantity', 'qty', 'openingstock', 'stock');
    if (iSku < 0 || iQty < 0) {
      setError('Could not find the SKU and Quantity columns. Download the template to see the format.');
      return;
    }
    const iWh = col('warehouse', 'location');
    const iRack = col('rack');
    const iRow = col('row');
    const iShelf = col('shelf');
    const iBin = col('bin');
    const parsed: OpeningStockRowInput[] = grid.slice(1).map((r) => ({
      sku: r[iSku] || '',
      quantity: r[iQty] ?? '',
      warehouse: iWh >= 0 ? r[iWh] : undefined,
      rack: iRack >= 0 ? r[iRack] : undefined,
      row: iRow >= 0 ? r[iRow] : undefined,
      shelf: iShelf >= 0 ? r[iShelf] : undefined,
      bin: iBin >= 0 ? r[iBin] : undefined
    }));
    setRows(parsed);
    await runPreview(parsed, mode);
  };

  const changeMode = (m: Mode) => {
    setMode(m);
    if (rows.length) runPreview(rows, m);
  };

  const changeReason = (r: string) => {
    setReason(r);
    if (rows.length) runPreview(rows, mode, r);
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await importOpeningStockApi(scope, { rows, mode, dryRun: false, kind: kindOf(reason), reason: reasonText });
      showToast('Stock updated', `${res.changed} product${res.changed === 1 ? '' : 's'} updated.`, 'success');
      onImported();
      close();
    } catch (e: any) {
      setError(e.message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const canApply = !!preview && preview.errors === 0 && !busy && rows.length > 0 && !!reasonText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Update Stock from CSV</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Change the stock of many products at once from a file. Each row is a SKU and a quantity; add a Warehouse
              column to name the warehouse. Every row is checked first and nothing changes until all rows are valid.
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 cursor-pointer dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" /> Blank template
            </button>
            <button
              onClick={downloadCurrent}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" /> Current stock file
            </button>
            <label className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-900 cursor-pointer dark:bg-slate-700">
              <Upload className="h-3.5 w-3.5" /> {fileName ? 'Choose another file' : 'Choose CSV file'}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
            {fileName && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {fileName} ({rows.length} rows)
              </span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['set', 'Set to these quantities', 'Safe to run again: the file becomes the stock on hand.'],
                ['add', 'Add to current stock', 'Adds each quantity on top of what is there.'],
                ['remove', 'Remove from stock', 'Takes each quantity off (damaged, lost, used).']
              ] as const
            ).map(([k, title, hint]) => (
              <button
                key={k}
                onClick={() => changeMode(k)}
                className={`rounded-lg border p-3 text-left cursor-pointer ${
                  mode === k
                    ? 'border-slate-800 bg-slate-50 dark:border-slate-300 dark:bg-slate-800'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                }`}
              >
                <p className="text-xs font-bold text-slate-900 dark:text-white">{title}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Reason
              <select
                value={reason}
                onChange={(e) => changeReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Note {reason === 'Other' ? '(required)' : '(optional)'}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder="e.g. monthly stock audit"
              />
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {busy && !preview && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking file...
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <div
                className={`flex items-center gap-2 rounded-lg p-3 text-xs font-semibold ${
                  preview.errors
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                {preview.errors ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {preview.errors
                  ? `${preview.errors} row${preview.errors === 1 ? '' : 's'} need fixing. Nothing is imported until every row is valid.`
                  : `${preview.total} rows are valid and ready to import.`}
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Now</th>
                      <th className="px-3 py-2 text-right">After</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} className={r.error ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                        <td className="px-3 py-1.5 text-slate-500">{r.rowNumber}</td>
                        <td className="px-3 py-1.5 font-mono">{r.sku || '-'}</td>
                        <td className="px-3 py-1.5">{r.productName || '-'}</td>
                        <td className="px-3 py-1.5 text-right">{r.current ?? '-'}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{r.next ?? '-'}</td>
                        <td className={`px-3 py-1.5 ${r.error ? 'font-semibold text-rose-600' : 'text-emerald-600'}`}>
                          {r.error || 'OK'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            onClick={close}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!canApply}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Update stock
          </button>
        </div>
      </div>
    </div>
  );
};
