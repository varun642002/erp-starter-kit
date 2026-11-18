import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Trash2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { ProductSearchSelect } from './ProductSearchSelect';
import { canActOnBranchStock, createAdjustmentsBatchApi } from '../../services/stockApi';
import { altUnitOf, defaultSaleUnit, formatStock, unitWord } from '../../utils/units';

type Mode = 'Recount' | 'Increase' | 'Decrease';

interface Line {
  productId: string;
  mode: Mode;
  qty: string; // counted in `unit`
  unit?: string; // the product's second unit (a Box) when the quantity is in boxes; missing means the product's own unit
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultWarehouseId?: string;
  // Products to start with (for example the rows ticked in the inventory list).
  initialProductIds?: string[];
  // Shows an 'Upload a CSV file' shortcut that hands over to the CSV import.
  onUploadCsv?: () => void;
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'Recount', label: 'Set to', hint: 'Counted quantity on the shelf' },
  { value: 'Increase', label: 'Add', hint: 'Found or returned stock' },
  { value: 'Decrease', label: 'Remove', hint: 'Damaged, lost or used' }
];

const REASONS = ['Physical count', 'Damaged / scrap', 'Found / surplus', 'Stock correction', 'Other'];

export const StockUpdateModal: React.FC<Props> = ({ isOpen, onClose, defaultWarehouseId, initialProductIds, onUploadCsv }) => {
  const { currentRole, products, warehouses, refreshStock, addAuditLog, showToast, canEditStock } = useERP();
  const { assignedBranchId } = useAuth();
  const scope = useMemo(() => ({ role: currentRole, branchId: assignedBranchId || 'branch-1' }), [currentRole, assignedBranchId]);

  const allowed = useMemo(
    () => warehouses.filter((w) => canActOnBranchStock(currentRole, assignedBranchId || 'branch-1', w.branchId)),
    [warehouses, currentRole, assignedBranchId]
  );

  // Items sold by the box (blades) are counted in boxes by default; everything else in its own unit.
  const startUnit = (productId: string): string | undefined => {
    const p = products.find((x) => x.id === productId);
    const d = defaultSaleUnit(p);
    return d.factor > 1 ? d.unit : undefined;
  };

  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [allMode, setAllMode] = useState<Mode>('Recount');
  const [allQty, setAllQty] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const preferred = allowed.find((w) => w.id === defaultWarehouseId) || allowed[0];
    setWarehouseId(preferred?.id || '');
    setLines((initialProductIds || []).map((productId) => ({ productId, mode: 'Recount' as Mode, qty: '', unit: startUnit(productId) })));
    setAllMode('Recount');
    setAllQty('');
    setNote('');
    setReason(REASONS[0]);
    setError('');
    setFailed({});
  }, [isOpen]);

  if (!isOpen) return null;

  const stockHere = (productId: string) =>
    products.find((p) => p.id === productId)?.warehouseStocks?.find((w) => w.warehouseId === warehouseId)?.available ?? 0;

  const addProduct = (product: { id: string }) => {
    setLines((prev) =>
      prev.some((l) => l.productId === product.id) ? prev : [...prev, { productId: product.id, mode: 'Recount', qty: '', unit: startUnit(product.id) }]
    );
  };

  const patch = (productId: string, change: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...change } : l)));

  // Pieces in one of the unit chosen on this row (18 for a box of blades, otherwise 1).
  const factorOf = (l: Line) => {
    const alt = altUnitOf(products.find((x) => x.id === l.productId));
    return alt && l.unit === alt.unit ? alt.factor : 1;
  };

  const newCount = (l: Line) => {
    const q = Number(l.qty);
    const cur = stockHere(l.productId);
    if (l.qty === '' || !Number.isInteger(q) || q < 0) return null;
    const pieces = q * factorOf(l);
    return l.mode === 'Recount' ? pieces : l.mode === 'Increase' ? cur + pieces : cur - pieces;
  };

  const lineProblem = (l: Line) => {
    if (l.qty === '') return '';
    const q = Number(l.qty);
    if (!Number.isInteger(q) || q < 0) return 'Enter a whole number';
    if (l.mode !== 'Recount' && q === 0) return 'Enter a quantity above 0';
    const after = newCount(l);
    if (after !== null && after < 0) return 'Cannot go below 0';
    return '';
  };

  const filled = lines.filter((l) => l.qty !== '');
  const changed = filled.filter((l) => !lineProblem(l) && newCount(l) !== stockHere(l.productId));
  const hasProblems = lines.some((l) => lineProblem(l));
  const reasonText = reason === 'Other' ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;
  const canSave = !!warehouseId && changed.length > 0 && !hasProblems && !busy && !!reasonText;

  const applyToAll = () => {
    if (allQty === '') return;
    setLines((prev) => prev.map((l) => ({ ...l, mode: allMode, qty: allQty })));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setFailed({});
    let done: string[] = [];
    const bad: Record<string, string> = {};
    try {
      const result = await createAdjustmentsBatchApi(scope, {
        warehouseId,
        reason: reasonText,
        items: changed.map((l) => ({ productId: l.productId, adjustmentType: l.mode, quantity: Number(l.qty) * factorOf(l) }))
      });
      done = result.done;
      for (const f of result.failed) bad[f.productId] = f.error;
    } catch (e: any) {
      setBusy(false);
      setError(e.message || 'Could not update stock. Nothing was changed.');
      return;
    }
    await refreshStock();
    setBusy(false);

    const whName = warehouses.find((w) => w.id === warehouseId)?.name || warehouseId;
    if (done.length) {
      addAuditLog('Stock Updated', 'Inventory', `Updated stock for ${done.length} product${done.length === 1 ? '' : 's'} at ${whName} (${reasonText})`, {
        severity: 'info',
        entityType: 'Inventory',
        entityId: warehouseId
      });
    }
    if (Object.keys(bad).length === 0) {
      showToast('Stock updated', `${done.length} product${done.length === 1 ? '' : 's'} updated at ${whName}.`, 'success');
      onClose();
      return;
    }
    setFailed(bad);
    setLines((prev) => prev.filter((l) => !done.includes(l.productId)));
    setError(`${done.length} updated, ${Object.keys(bad).length} failed. Fix the rows below and save again.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Update Stock</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Correct the quantity of one or many products in a warehouse. Every change is recorded in the Stock Ledger.
            </p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {!canEditStock || allowed.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {!canEditStock
                ? 'Stock editing is switched off for branch persons. Ask the Super Admin to switch it on.'
                : 'Your role cannot update stock.'}
            </p>
          ) : (
            <>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Warehouse
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {allowed.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Add products</p>
                  {onUploadCsv && (
                    <button
                      type="button"
                      onClick={onUploadCsv}
                      className="cursor-pointer text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Have many? Upload a CSV file
                    </button>
                  )}
                </div>
                <ProductSearchSelect
                  value=""
                  onChange={addProduct}
                  warehouseId={warehouseId}
                  placeholder="Search by name or SKU and pick to add. Add as many as you need."
                />
              </div>

              {lines.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Same for all {lines.length} rows:</span>
                  <div className="inline-flex rounded-md bg-slate-200/70 p-0.5 dark:bg-slate-700">
                    {MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setAllMode(m.value)}
                        className={`cursor-pointer rounded px-2 py-0.5 font-semibold ${
                          allMode === m.value ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-600 dark:text-white' : 'text-slate-500 dark:text-slate-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={allQty}
                    onChange={(e) => setAllQty(e.target.value)}
                    placeholder="Qty"
                    aria-label="Quantity for all rows"
                    className="h-7 w-20 rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={applyToAll}
                    disabled={allQty === ''}
                    className="h-7 cursor-pointer rounded-md bg-slate-700 px-2.5 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply to all
                  </button>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.map((l) => ({ ...l, qty: '' })))}
                    className="h-7 cursor-pointer rounded-md px-2 font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  >
                    Clear quantities
                  </button>
                  <span className="ml-auto text-slate-500">Rows left blank are not changed.</span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                {lines.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">No products added yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {lines.map((l) => {
                      const p = products.find((x) => x.id === l.productId);
                      const cur = stockHere(l.productId);
                      const after = newCount(l);
                      const problem = l.qty !== '' ? lineProblem(l) : '';
                      return (
                        <li key={l.productId} className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{p?.name || l.productId}</p>
                              <p className="text-[11px] text-slate-500">
                                {p?.sku} · Now {formatStock(cur, p)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                              className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                              aria-label="Remove product"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                              {MODES.map((m) => (
                                <button
                                  key={m.value}
                                  type="button"
                                  title={m.hint}
                                  onClick={() => patch(l.productId, { mode: m.value })}
                                  className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                                    l.mode === m.value
                                      ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                                  }`}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={l.qty}
                              onChange={(e) => patch(l.productId, { qty: e.target.value })}
                              placeholder="Qty"
                              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              aria-label="Quantity"
                            />
                            {altUnitOf(p) && (
                              <select
                                value={l.unit === altUnitOf(p)!.unit ? 'alt' : 'base'}
                                onChange={(e) => patch(l.productId, { unit: e.target.value === 'alt' ? altUnitOf(p)!.unit : undefined })}
                                aria-label="Unit"
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              >
                                <option value="base">{unitWord(p?.unit, 2)}</option>
                                <option value="alt">
                                  {altUnitOf(p)!.unit} ({altUnitOf(p)!.factor})
                                </option>
                              </select>
                            )}
                            {after !== null && !problem && (
                              <span className="text-[11px] text-slate-500">
                                {cur} <span className="mx-0.5">to</span>
                                <strong className={after === cur ? 'text-slate-500' : after > cur ? 'text-emerald-600' : 'text-rose-600'}>
                                  {' '}
                                  {formatStock(after, p)}
                                </strong>
                              </span>
                            )}
                            {(problem || failed[l.productId]) && (
                              <span className="text-[11px] font-semibold text-rose-600">{failed[l.productId] || problem}</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Reason
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
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
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            {lines.length > 0 && !hasProblems && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {changed.length} of {lines.length} will change{filled.length < lines.length ? ` (${lines.length - filled.length} left blank)` : ''}
              </>
            )}
          </span>
          <div className="flex gap-2">
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
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Update {changed.length > 1 ? `${changed.length} products` : 'stock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
