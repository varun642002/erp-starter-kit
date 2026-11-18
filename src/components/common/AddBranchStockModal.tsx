import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Trash2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { ProductSearchSelect } from './ProductSearchSelect';
import { addStockDirectApi, canActOnBranchStock } from '../../services/stockApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultWarehouseId?: string;
}

interface Line {
  productId: string;
  qty: string;
}

// Puts stock straight into a branch's warehouse, for stock that did not come through a transfer.
export const AddBranchStockModal: React.FC<Props> = ({ isOpen, onClose, defaultWarehouseId }) => {
  const { currentRole, products, warehouses, branches, refreshStock, addAuditLog, showToast } = useERP();
  const { assignedBranchId } = useAuth();
  const scope = useMemo(() => ({ role: currentRole, branchId: assignedBranchId || 'branch-1' }), [currentRole, assignedBranchId]);

  const allowed = useMemo(
    () => warehouses.filter((w) => canActOnBranchStock(currentRole, assignedBranchId || 'branch-1', w.branchId)),
    [warehouses, currentRole, assignedBranchId]
  );

  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const preferred = allowed.find((w) => w.id === defaultWarehouseId) || allowed[0];
    setWarehouseId(preferred?.id || '');
    setLines([]);
    setReference('');
    setNote('');
    setError('');
  }, [isOpen]);

  if (!isOpen) return null;

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || '';
  const stockHere = (productId: string) =>
    products.find((p) => p.id === productId)?.warehouseStocks?.find((w) => w.warehouseId === warehouseId)?.available ?? 0;

  const addProduct = (product: { id: string }) =>
    setLines((prev) => (prev.some((l) => l.productId === product.id) ? prev : [...prev, { productId: product.id, qty: '' }]));

  const patch = (productId: string, qty: string) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty } : l)));

  const valid = (l: Line) => Number.isInteger(Number(l.qty)) && Number(l.qty) > 0;
  const canSave = !!warehouseId && lines.length > 0 && lines.every(valid) && !busy;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await addStockDirectApi(scope, {
        warehouseId,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.qty) }))
      });
      await refreshStock();
      const wh = warehouses.find((w) => w.id === warehouseId);
      addAuditLog('Stock Added to Branch', 'Inventory', `Added ${res.units} units (${res.items} products) to ${wh?.name || warehouseId}`, {
        severity: 'info',
        entityType: 'Inventory',
        entityId: warehouseId
      });
      showToast('Stock added', `${res.units} units added to ${wh?.name || warehouseId}.`, 'success');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not add the stock.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Add stock to a branch</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Put stock straight into one branch, without a stock transfer from the Head Office.
            </p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {allowed.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Your role cannot add stock.
            </p>
          ) : (
            <>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Add to
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {allowed.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {branchName(w.branchId) && branchName(w.branchId) !== w.name ? ` (${branchName(w.branchId)})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Products</p>
                <ProductSearchSelect
                  value=""
                  onChange={addProduct}
                  warehouseId={warehouseId}
                  placeholder="Search by name or SKU and pick to add. Add as many as you need."
                />
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                {lines.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">No products added yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {lines.map((l) => {
                      const p = products.find((x) => x.id === l.productId);
                      const cur = stockHere(l.productId);
                      const q = Number(l.qty);
                      return (
                        <li key={l.productId} className="flex items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{p?.name || l.productId}</p>
                            <p className="text-[11px] text-slate-500">
                              {p?.sku} · Now {cur} {p?.unit || ''}
                              {valid(l) && <span className="ml-1 font-semibold text-emerald-600">to {cur + q}</span>}
                            </p>
                          </div>
                          <input
                            type="number"
                            min="1"
                            value={l.qty}
                            onChange={(e) => patch(l.productId, e.target.value)}
                            placeholder="Qty"
                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            aria-label="Quantity to add"
                          />
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                            className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            aria-label="Remove product"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Bill / reference no. (optional)
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Note (optional)
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. bought locally"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add stock
          </button>
        </div>
      </div>
    </div>
  );
};
