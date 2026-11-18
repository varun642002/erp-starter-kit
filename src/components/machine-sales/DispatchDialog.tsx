import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL, Modal, useApiScope } from '../documents/ui';
import { normalizeIndianPhone } from '../../utils/whatsapp';
import { formatMoney, machineSaleApi, scopeForSale, type MachineSale, type MachineSaleDetail } from '../../services/machineSaleApi';
import { ErrorBanner } from './MachineSaleForm';

interface DialogProps {
  sale: MachineSale;
  onClose: () => void;
  onDone: (sale: MachineSaleDetail) => void;
}

const machineLabel = (s: MachineSale) => [s.machineName, s.model].filter(Boolean).join(' ');

// ---------- PDI (Booked -> Ready for Delivery) ----------

export const PdiDialog: React.FC<DialogProps> = ({ sale, onClose, onDone }) => {
  const { showToast, addAuditLog } = useERP();
  const { scope, isOwner } = useApiScope();
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState(sale.pdiNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed) return setError('Confirm that the inspection is complete');
    setSaving(true);
    setError('');
    try {
      const updated = await machineSaleApi.markReady(scopeForSale(scope, sale, isOwner), sale.id, {
        pdiDone: true,
        pdiNotes: notes.trim() || undefined
      });
      addAuditLog('Machine PDI Done', 'Machine Sales', `${sale.saleNumber}: ${machineLabel(sale)} ready for delivery`);
      showToast('Ready for delivery', `${sale.saleNumber} passed pre-delivery inspection`, 'success');
      onDone(updated);
    } catch (err: any) {
      setError(err.message || 'Could not update the sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Pre-delivery inspection" subtitle={`${sale.saleNumber} - ${machineLabel(sale)}`} onClose={onClose} size="md">
      <form onSubmit={submit} className="space-y-4 p-5">
        <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
          />
          PDI is complete and the machine is ready to be dispatched to the customer.
        </label>
        <div>
          <label className={LABEL}>Inspection notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={INPUT}
            placeholder="Oil and coolant levels, battery, tyres, hydraulics, anything fixed before delivery"
          />
        </div>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Mark PDI done
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------- Dispatch (Ready for Delivery -> Dispatched) ----------

export const DispatchDialog: React.FC<DialogProps> = ({ sale, onClose, onDone }) => {
  const { warehouses, products, settings, showToast, addAuditLog, refreshProducts } = useERP();
  const { scope, isOwner } = useApiScope();
  const currency = settings.currencySymbol || '₹';

  const [vehicleNo, setVehicleNo] = useState(sale.vehicleNo || '');
  const [driverName, setDriverName] = useState(sale.driverName || '');
  const [driverPhone, setDriverPhone] = useState(sale.driverPhone || '');
  const [deliveryAddress, setDeliveryAddress] = useState(sale.deliveryAddress || sale.customerAddress || '');
  const [warehouseId, setWarehouseId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const branchWarehouses = useMemo(
    () => warehouses.filter((w) => w.branchId === sale.branchId),
    [warehouses, sale.branchId]
  );
  const product = sale.productId ? products.find((p) => p.id === sale.productId) : undefined;
  const stockIn = (warehouse: string) =>
    (product?.warehouseStocks || []).filter((ws) => ws.warehouseId === warehouse).reduce((a, ws) => a + (ws.available || 0), 0);
  const totalStock = branchWarehouses.reduce((a, w) => a + stockIn(w.id), 0);
  const phoneBad = driverPhone.trim() !== '' && !normalizeIndianPhone(driverPhone);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneBad) return setError('Driver phone must be a 10-digit mobile number');
    setSaving(true);
    setError('');
    try {
      const phone = normalizeIndianPhone(driverPhone);
      const updated = await machineSaleApi.dispatch(scopeForSale(scope, sale, isOwner), sale.id, {
        vehicleNo: vehicleNo.trim().toUpperCase() || undefined,
        driverName: driverName.trim() || undefined,
        driverPhone: phone ? phone.slice(2) : undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        warehouseId: warehouseId || undefined
      });
      // Dispatch deducts the machine from stock on the server.
      refreshProducts();
      addAuditLog('Machine Dispatched', 'Machine Sales', `${sale.saleNumber}: ${machineLabel(sale)} to ${sale.customerName}`);
      showToast('Machine dispatched', `${sale.saleNumber} is on the way to ${sale.customerName}`, 'success');
      onDone(updated);
    } catch (err: any) {
      // A 409 for insufficient stock arrives here with the server's message.
      setError(err.message || 'Could not dispatch the machine');
      refreshProducts();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Dispatch machine" subtitle={`${sale.saleNumber} - ${machineLabel(sale)}`} onClose={onClose} size="md">
      <form onSubmit={submit} className="space-y-4 p-5">
        {sale.productId ? (
          <div
            className={`rounded-lg border p-2.5 text-xs ${
              product && totalStock <= 0
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
            }`}
          >
            One unit of this machine is deducted from stock when you dispatch.
            {product && totalStock <= 0 && ' No stock is recorded at this branch, so the server may refuse the dispatch.'}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            This sale is not linked to a catalogue item, so no stock is deducted.
          </div>
        )}

        {sale.balance > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Balance of {formatMoney(sale.balance, currency)} is still to be collected.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Vehicle number</label>
            <input
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              className={`${INPUT} font-mono uppercase`}
              placeholder="TN 28 AB 1234"
            />
          </div>
          <div>
            <label className={LABEL}>Driver name</label>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Driver phone</label>
            <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} inputMode="tel" className={INPUT} placeholder="10-digit mobile" />
            {phoneBad && <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">Enter a 10-digit mobile number</p>}
          </div>
          {sale.productId && (
            <div>
              <label className={LABEL}>Take stock from</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={INPUT}>
                <option value="">Automatic (most stock)</option>
                {branchWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {product ? ` (${stockIn(w.id)} in stock)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={LABEL}>Delivery address</label>
            <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} rows={2} className={INPUT} />
          </div>
        </div>

        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Dispatch
          </button>
        </div>
      </form>
    </Modal>
  );
};
