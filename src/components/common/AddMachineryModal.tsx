import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { canActOnBranchStock } from '../../services/stockApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const INPUT =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const LABEL = 'block text-xs font-semibold text-slate-700 dark:text-slate-300';

const MACHINE_TYPES = ['Rotavator', 'Baler', 'Tractor Implements', 'Power Tillers & Weeders', 'Tractor', 'Harvester & Thresher', 'Sprayer', 'Other machinery'];

// A machine (rotavator, baler, implement...) is added on its own, with the details dealers look at.
// Selling price can be left empty and entered when the machine is billed.
export const AddMachineryModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { addProduct, warehouses, branches, currentRole, products, settings } = useERP();
  const { assignedBranchId } = useAuth();

  const allowed = useMemo(
    () => warehouses.filter((w) => canActOnBranchStock(currentRole, assignedBranchId || 'branch-1', w.branchId)),
    [warehouses, currentRole, assignedBranchId]
  );

  const blank = {
    name: '',
    sku: '',
    type: 'Rotavator',
    brand: '',
    power: '',
    specs: '',
    altNames: '',
    hsn: '8432',
    gst: '5',
    buy: '',
    sell: '',
    qty: '0',
    min: '1',
    warehouseId: ''
  };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setF({ ...blank, warehouseId: allowed.find((w) => w.id === 'wh-1')?.id || allowed[0]?.id || '' });
    setError('');
  }, [isOpen]);

  if (!isOpen) return null;
  const set = (k: keyof typeof blank, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cs = settings.currencySymbol || '₹';

  const save = async () => {
    const name = f.name.trim();
    const sku = f.sku.trim().toUpperCase();
    if (!name) return setError('Enter the machine name or model.');
    if (sku && products.some((p) => p.sku.toUpperCase() === sku)) return setError(`Item number ${sku} already exists.`);
    const qty = Math.round(Number(f.qty) || 0);
    if (qty < 0) return setError('Opening stock cannot be negative.');
    if (qty > 0 && !f.warehouseId) return setError('Choose where the opening stock is kept.');
    const buy = f.buy === '' ? 0 : Number(f.buy);
    const sell = f.sell === '' ? 0 : Number(f.sell);
    if (!(buy >= 0) || !(sell >= 0)) return setError('Prices cannot be negative.');
    const min = Math.max(0, Math.round(Number(f.min) || 0));

    setBusy(true);
    setError('');
    try {
      await addProduct({
        name,
        sku: sku || undefined,
        category: f.type.trim() || 'Tractor Implements',
        subcategory: 'Machinery',
        brand: f.brand.trim() || 'Acme',
        barcode: '',
        unit: 'Nos',
        hsnCode: f.hsn.trim() || '8432',
        gstRate: Number(f.gst) || 0,
        purchasePrice: buy,
        sellingPrice: sell,
        mrp: sell > 0 ? Math.round(sell * 1.1) : 0,
        minStock: min,
        maxStock: Math.max(min * 8, qty),
        reorderLevel: min,
        description: f.specs.trim(),
        isSparePart: false,
        compatibleModels: f.power.trim() ? [f.power.trim()] : [],
        alternateNames: f.altNames.split(/[;|,\n]/).map((n) => n.trim()).filter(Boolean),
        status: qty <= 0 ? 'Out of Stock' : qty <= min ? 'Low Stock' : 'In Stock',
        warehouseStocks:
          qty > 0
            ? [{ warehouseId: f.warehouseId, rack: '', row: '', shelf: '', bin: '', available: qty, reserved: 0, inTransit: 0 }]
            : []
      } as any);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save the machine.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Add machinery</h2>
            <p className="text-xs text-slate-500">
              Tractors, rotavators, balers and implements. Spare parts have their own form.
            </p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <label className={`${LABEL} sm:col-span-2`}>
            Machine name / model *
            <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme AT40 Rotary Tiller" className={INPUT} />
          </label>
          <label className={LABEL}>
            Item number (SKU)
            <input
              value={f.sku}
              onChange={(e) => set('sku', e.target.value.toUpperCase())}
              placeholder="Leave empty to generate"
              className={`${INPUT} font-mono`}
            />
          </label>
          <label className={LABEL}>
            Type
            <input value={f.type} onChange={(e) => set('type', e.target.value)} list="machine-types" className={INPUT} />
            <datalist id="machine-types">
              {MACHINE_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className={LABEL}>
            Brand
            <input value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Acme" className={INPUT} />
          </label>
          <label className={LABEL}>
            Tractor power needed
            <input value={f.power} onChange={(e) => set('power', e.target.value)} placeholder="e.g. 40-50 HP tractor" className={INPUT} />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            Alternate names <span className="font-normal text-slate-400">optional, separated by ;</span>
            <input value={f.altNames} onChange={(e) => set('altNames', e.target.value)} placeholder="e.g. ரோட்டவேட்டர்; rotary tiller" className={INPUT} />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            Key specifications
            <textarea
              value={f.specs}
              onChange={(e) => set('specs', e.target.value)}
              rows={3}
              placeholder="Working width, blades, weight, PTO speed..."
              className={INPUT}
            />
          </label>

          <label className={LABEL}>
            HSN code
            <input value={f.hsn} onChange={(e) => set('hsn', e.target.value)} className={`${INPUT} font-mono`} />
          </label>
          <label className={LABEL}>
            GST %
            <select value={f.gst} onChange={(e) => set('gst', e.target.value)} className={INPUT}>
              {['0', '5', '12', '18', '28'].map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Purchase price ({cs}) <span className="font-normal text-slate-400">optional</span>
            <input type="number" min="0" value={f.buy} onChange={(e) => set('buy', e.target.value)} className={INPUT} />
          </label>
          <label className={LABEL}>
            Selling price ({cs}) <span className="font-normal text-slate-400">optional, can be set when billing</span>
            <input type="number" min="0" value={f.sell} onChange={(e) => set('sell', e.target.value)} className={INPUT} />
          </label>

          <label className={LABEL}>
            Opening stock
            <input type="number" min="0" value={f.qty} onChange={(e) => set('qty', e.target.value)} className={INPUT} />
          </label>
          <label className={LABEL}>
            Stock kept at
            <select value={f.warehouseId} onChange={(e) => set('warehouseId', e.target.value)} className={INPUT}>
              {allowed.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {branches.find((b) => b.id === w.branchId)?.name && branches.find((b) => b.id === w.branchId)?.name !== w.name
                    ? ` (${branches.find((b) => b.id === w.branchId)?.name})`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Alert when stock is at or below
            <input type="number" min="0" value={f.min} onChange={(e) => set('min', e.target.value)} className={INPUT} />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 sm:col-span-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-60 dark:bg-slate-700"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add machinery
          </button>
        </div>
      </div>
    </div>
  );
};
