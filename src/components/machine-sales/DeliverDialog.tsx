import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL, Modal, useApiScope } from '../documents/ui';
import { formatMessageDate } from '../../utils/whatsapp';
import {
  addMonthsIso,
  formatMoney,
  machineSaleApi,
  scopeForSale,
  todayIst,
  type MachineSale,
  type MachineSaleDetail
} from '../../services/machineSaleApi';
import { ErrorBanner } from './MachineSaleForm';

interface Props {
  sale: MachineSale;
  onClose: () => void;
  onDone: (sale: MachineSaleDetail) => void;
}

export const DeliverDialog: React.FC<Props> = ({ sale, onClose, onDone }) => {
  const { settings, showToast, addAuditLog } = useERP();
  const { scope, isOwner } = useApiScope();
  const currency = settings.currencySymbol || '₹';

  const [receivedBy, setReceivedBy] = useState(sale.receivedByName || sale.customerName || '');
  const [handoverNotes, setHandoverNotes] = useState(sale.handoverNotes || '');
  const [deliveredDate, setDeliveredDate] = useState(todayIst());
  // Warranty normally starts on the delivery day, so it follows the delivery date until edited.
  const [warrantyStart, setWarrantyStart] = useState('');
  const [balanceAck, setBalanceAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const effectiveWarrantyStart = warrantyStart || deliveredDate;
  const warrantyEnd = sale.warrantyMonths > 0 ? addMonthsIso(effectiveWarrantyStart, sale.warrantyMonths) : '';
  const needsAck = sale.balance > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivedBy.trim()) return setError('Enter the name of the person who received the machine');
    if (!deliveredDate) return setError('Enter the delivery date');
    if (needsAck && !balanceAck) return setError('Confirm that the balance will remain outstanding');
    setSaving(true);
    setError('');
    try {
      const updated = await machineSaleApi.deliver(scopeForSale(scope, sale, isOwner), sale.id, {
        receivedByName: receivedBy.trim(),
        handoverNotes: handoverNotes.trim() || undefined,
        deliveredDate,
        warrantyStart: effectiveWarrantyStart
      });
      addAuditLog('Machine Delivered', 'Machine Sales', `${sale.saleNumber}: ${sale.machineName} handed over to ${receivedBy.trim()}`);
      showToast('Machine delivered', `${sale.saleNumber} handed over to ${receivedBy.trim()}`, 'success');
      onDone(updated);
    } catch (err: any) {
      setError(err.message || 'Could not complete the delivery');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Deliver machine"
      subtitle={`${sale.saleNumber} - ${[sale.machineName, sale.model].filter(Boolean).join(' ')}`}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>Received by *</label>
            <input
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              className={INPUT}
              placeholder="Name of the person taking delivery"
            />
          </div>
          <div>
            <label className={LABEL}>Delivery date *</label>
            <input type="date" value={deliveredDate} onChange={(e) => setDeliveredDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Warranty starts</label>
            <input
              type="date"
              value={effectiveWarrantyStart}
              onChange={(e) => setWarrantyStart(e.target.value)}
              disabled={sale.warrantyMonths <= 0}
              className={INPUT}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Handover notes</label>
            <textarea
              value={handoverNotes}
              onChange={(e) => setHandoverNotes(e.target.value)}
              rows={3}
              className={INPUT}
              placeholder="Accessories handed over, hours on meter, demo given, documents shared"
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {sale.warrantyMonths > 0
            ? `Warranty of ${sale.warrantyMonths} months runs until ${formatMessageDate(warrantyEnd)}.`
            : 'No warranty period is set for this sale.'}
        </p>

        {needsAck && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <input
              type="checkbox"
              checked={balanceAck}
              onChange={(e) => setBalanceAck(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            />
            <span>
              A balance of <strong>{formatMoney(sale.balance, currency)}</strong> is still unpaid. Deliver anyway and keep it as outstanding.
            </span>
          </label>
        )}

        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirm delivery
          </button>
        </div>
      </form>
    </Modal>
  );
};
