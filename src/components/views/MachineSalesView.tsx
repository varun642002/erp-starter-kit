import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Check,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tractor,
  Trash2,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { BTN_GHOST, BTN_PRIMARY, CARD, INPUT, LABEL, Modal, useApiScope } from '../documents/ui';
import { MachineSaleForm, ErrorBanner } from '../machine-sales/MachineSaleForm';
import { DispatchDialog, PdiDialog } from '../machine-sales/DispatchDialog';
import { DeliverDialog } from '../machine-sales/DeliverDialog';
import { DeliveryChallan, SaleWhatsAppButton } from '../machine-sales/DeliveryChallan';
import { useCompanies } from '../../hooks/useCompanies';
import { formatMessageDate } from '../../utils/whatsapp';
import { downloadCSV } from '../../utils/csvExport';
import {
  MACHINE_PAYMENT_MODES,
  MACHINE_SALE_FLOW,
  addMonthsIso,
  formatMoney,
  isSaleDueToday,
  isSaleOverdue,
  machineSaleApi,
  scopeForSale,
  todayIst,
  type MachinePaymentMode,
  type MachineSale,
  type MachineSaleDetail,
  type MachineSaleStatus,
  type MachineSaleSummary,
  type YearsReport,
  NO_DATE
} from '../../services/machineSaleApi';

const STATUS_STYLES: Record<MachineSaleStatus, string> = {
  Booked: 'text-sky-700 dark:text-sky-300',
  'Ready for Delivery': 'text-amber-700 dark:text-amber-300',
  Dispatched: 'text-indigo-700 dark:text-indigo-300',
  Delivered: 'text-emerald-700 dark:text-emerald-300',
  Cancelled: 'text-rose-700 dark:text-rose-300'
};

const StatusBadge: React.FC<{ status: MachineSaleStatus }> = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap text-[11px] font-bold ${STATUS_STYLES[status]}`}>
    {status}
  </span>
);

type StepKind = 'pdi' | 'dispatch' | 'deliver';

const NEXT_STEP: Partial<Record<MachineSaleStatus, { kind: StepKind; label: string }>> = {
  Booked: { kind: 'pdi', label: 'Mark PDI done' },
  'Ready for Delivery': { kind: 'dispatch', label: 'Dispatch' },
  Dispatched: { kind: 'deliver', label: 'Deliver' }
};

type DialogState =
  | { kind: 'new' }
  | { kind: 'edit' | 'pdi' | 'dispatch' | 'deliver' | 'cancel' | 'challan' | 'delete'; sale: MachineSale };

// Small, quiet filter controls that sit in one row and wrap on narrow screens.
const FILTER =
  'h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

const STATUS_TABS: ('All' | MachineSaleStatus)[] = ['All', 'Booked', 'Ready for Delivery', 'Dispatched', 'Delivered', 'Cancelled'];

const TAB_LABEL: Record<string, string> = { Dispatched: 'On the way' };

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

// ---------- Delete ----------

const DeleteSaleDialog: React.FC<{ sale: MachineSale; onClose: () => void; onDone: () => void }> = ({ sale, onClose, onDone }) => {
  const { showToast, addAuditLog } = useERP();
  const { scope, isOwner } = useApiScope();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setSaving(true);
    setError('');
    try {
      await machineSaleApi.remove(scopeForSale(scope, sale, isOwner), sale.id);
      addAuditLog('Deleted Machine Sale', 'Machine Sales', `${sale.saleNumber} for ${sale.customerName} was deleted`, { severity: 'warning' });
      showToast('Machine sale deleted', `${sale.saleNumber} was removed`, 'info');
      onDone();
    } catch (err: any) {
      setError(err.message || 'Could not delete the sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Delete machine sale" subtitle={sale.saleNumber} onClose={onClose} size="sm">
      <div className="space-y-4 p-5 text-xs text-slate-700 dark:text-slate-300">
        <p>
          Delete <strong>{sale.saleNumber}</strong> for {sale.customerName}? Its payments, history and invoice are removed
          {sale.stockDeducted ? ', and the machine goes back to stock' : ''}. This cannot be undone.
        </p>
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          To keep the record of a sale that did not go ahead, use Cancel instead.
        </p>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className={BTN_GHOST}>
            Keep
          </button>
          <button
            onClick={confirm}
            disabled={saving}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-60"
          >
            {saving ? 'Deleting...' : 'Yes, delete'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------- Cancel ----------

const CancelSaleDialog: React.FC<{ sale: MachineSale; onClose: () => void; onDone: (s: MachineSaleDetail) => void }> = ({
  sale,
  onClose,
  onDone
}) => {
  const { showToast, addAuditLog } = useERP();
  const { scope, isOwner } = useApiScope();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError('Enter the reason for cancelling');
    setSaving(true);
    setError('');
    try {
      const updated = await machineSaleApi.cancel(scopeForSale(scope, sale, isOwner), sale.id, { reason: reason.trim() });
      addAuditLog('Cancelled Machine Sale', 'Machine Sales', `${sale.saleNumber}: ${reason.trim()}`, { severity: 'warning' });
      showToast('Sale cancelled', `${sale.saleNumber} was cancelled`, 'info');
      onDone(updated);
    } catch (err: any) {
      setError(err.message || 'Could not cancel the sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Cancel machine sale" subtitle={`${sale.saleNumber} - ${sale.customerName}`} onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-4 p-5">
        {sale.stockDeducted && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Stock was deducted when this machine was dispatched. Check that the machine is back in the yard.
          </p>
        )}
        <div>
          <label className={LABEL}>Reason *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={INPUT} placeholder="Why is the booking being cancelled?" />
        </div>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Keep sale
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Cancel sale
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------- Detail drawer ----------

const Info: React.FC<{ label: string; value?: string | null; mono?: boolean; tone?: 'danger' }> = ({ label, value, mono, tone }) => (
  <div>
    <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
    <p
      className={`text-xs ${mono ? 'font-mono' : ''} ${
        tone === 'danger' ? 'font-bold text-rose-600 dark:text-rose-400' : 'font-semibold text-slate-900 dark:text-white'
      }`}
    >
      {value || '-'}
    </p>
  </div>
);

interface DrawerProps {
  saleId: string;
  version: number;
  onClose: () => void;
  onChanged: () => void;
  onAction: (kind: StepKind | 'edit' | 'cancel' | 'challan' | 'delete', sale: MachineSale) => void;
}

const SaleDrawer: React.FC<DrawerProps> = ({ saleId, version, onClose, onChanged, onAction }) => {
  const { settings, showToast, addAuditLog } = useERP();
  const { scope, isOwner, branchParam } = useApiScope();
  const { getCompany } = useCompanies();
  const currency = settings.currencySymbol || '₹';
  const money = (n: number) => formatMoney(n, currency);

  const [sale, setSale] = useState<MachineSaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<MachinePaymentMode>('Cash');
  const [payDate, setPayDate] = useState(todayIst());
  const [payRef, setPayRef] = useState('');
  // Secondary payment: part of this payment taken another way
  const [payAmount2, setPayAmount2] = useState('');
  const [payMethod2, setPayMethod2] = useState<MachinePaymentMode>('UPI');
  const [payRef2, setPayRef2] = useState('');
  // Correcting a payment that was entered wrongly (owners and branch managers)
  const [editPay, setEditPay] = useState<{ id: number; amount: string; method: MachinePaymentMode; paidOn: string; reference: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const d = await machineSaleApi.get(scope, saleId, branchParam);
      setSale(d);
      setPayAmount(d.balance > 0 ? String(d.balance) : '');
    } catch (e: any) {
      setLoadError(e.message || 'Could not load the sale');
    } finally {
      setLoading(false);
    }
  }, [scope, saleId, branchParam]);

  // `version` bumps after any dialog action so the open drawer shows the new status and timeline.
  useEffect(() => {
    load();
  }, [load, version]);

  const shell = (children: React.ReactNode) => (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );

  if (!sale) {
    return shell(
      <div className="flex h-full w-full max-w-3xl flex-col items-center justify-center gap-3 bg-white p-6 dark:bg-slate-900">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        ) : (
          <>
            <AlertTriangle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-slate-700 dark:text-slate-300">{loadError || 'Sale not found'}</p>
            <div className="flex gap-2">
              <button onClick={load} className={BTN_PRIMARY}>
                Retry
              </button>
              <button onClick={onClose} className={BTN_GHOST}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const final = sale.status === 'Delivered' || sale.status === 'Cancelled';
  const flowIdx = MACHINE_SALE_FLOW.indexOf(sale.status);
  const next = NEXT_STEP[sale.status];
  const overdue = isSaleOverdue(sale);
  const company = getCompany(sale.companyId);
  // Owners and managers can correct a sale at any stage; others while it is being prepared.
  const canEdit =
    sale.status !== 'Cancelled' &&
    (sale.status === 'Booked' || sale.status === 'Ready for Delivery' || isOwner || scope.role === 'Branch Manager');
  const canDelete = isOwner || scope.role === 'Branch Manager';
  const warrantyEnd =
    sale.warrantyMonths > 0 && (sale.warrantyStart || sale.deliveredDate)
      ? formatMessageDate(addMonthsIso(sale.warrantyStart || sale.deliveredDate || '', sale.warrantyMonths))
      : '';

  const recordPayment = async () => {
    const amount = num(payAmount);
    const amount2 = amount > 0 ? num(payAmount2) : 0;
    // the second method must differ from the first
    const method2 = (payMethod2 !== payMethod ? payMethod2 : MACHINE_PAYMENT_MODES.find((m) => m !== payMethod) || 'UPI') as MachinePaymentMode;
    if (!(amount > 0)) return showToast('Invalid amount', 'Enter an amount greater than 0', 'error');
    if (amount + amount2 > sale.balance) return showToast('Amount too high', `The balance is only ${money(sale.balance)}`, 'error');
    setBusy(true);
    try {
      const updated = await machineSaleApi.addPayment(scopeForSale(scope, sale, isOwner), sale.id, {
        amount,
        method: payMethod,
        paidOn: payDate || undefined,
        reference: payRef.trim() || undefined,
        ...(amount2 > 0 ? { secondary: { amount: amount2, method: method2, reference: payRef2.trim() || undefined } } : {})
      });
      setSale(updated);
      setPayAmount(updated.balance > 0 ? String(updated.balance) : '');
      setPayRef('');
      setPayAmount2('');
      setPayRef2('');
      addAuditLog('Machine Sale Payment', 'Machine Sales', `${sale.saleNumber}: ${money(amount)} via ${payMethod}${amount2 > 0 ? ` + ${money(amount2)} via ${method2}` : ''}`);
      showToast(
        'Payment recorded',
        amount2 > 0 ? `${money(amount)} by ${payMethod} + ${money(amount2)} by ${method2}` : `${money(amount)} received by ${payMethod}`,
        'success'
      );
      onChanged();
    } catch (e: any) {
      showToast('Payment failed', e.message || 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePaymentEdit = async () => {
    if (!editPay) return;
    const amount = num(editPay.amount);
    if (!(amount > 0)) return showToast('Invalid amount', 'Enter an amount greater than 0', 'error');
    setBusy(true);
    try {
      const updated = await machineSaleApi.updatePayment(scopeForSale(scope, sale, isOwner), sale.id, editPay.id, {
        amount,
        method: editPay.method,
        paidOn: editPay.paidOn || undefined,
        reference: editPay.reference.trim() || undefined
      });
      setSale(updated);
      setEditPay(null);
      addAuditLog('Machine Sale Payment Edited', 'Machine Sales', `${sale.saleNumber}: a payment was changed to ${money(amount)} via ${editPay.method}`);
      showToast('Payment updated', `${money(amount)} by ${editPay.method}`, 'success');
      onChanged();
    } catch (e: any) {
      showToast('Could not update the payment', e.message || 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async (p: { id: number; amount: number; method: string }) => {
    if (!window.confirm(`Remove the ${money(p.amount)} payment by ${p.method}? The balance on this sale goes up by that amount.`)) return;
    setBusy(true);
    try {
      const updated = await machineSaleApi.deletePayment(scopeForSale(scope, sale, isOwner), sale.id, p.id);
      setSale(updated);
      addAuditLog('Machine Sale Payment Removed', 'Machine Sales', `${sale.saleNumber}: ${money(p.amount)} via ${p.method} was removed`);
      showToast('Payment removed', `${money(p.amount)} by ${p.method}`, 'info');
      onChanged();
    } catch (e: any) {
      showToast('Could not remove the payment', e.message || 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const generateInvoice = async () => {
    setBusy(true);
    try {
      const updated = await machineSaleApi.generateInvoice(scopeForSale(scope, sale, isOwner), sale.id);
      setSale(updated);
      showToast('Invoice generated', `Invoice ${updated.documentNumber || ''} was made for ${sale.saleNumber}`, 'success');
      onChanged();
    } catch (e: any) {
      showToast('Could not generate the invoice', e.message || 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setSubsidy = async (status: 'Sanctioned' | 'Received' | 'Rejected') => {
    setBusy(true);
    try {
      const updated = await machineSaleApi.subsidy(scopeForSale(scope, sale, isOwner), sale.id, { status });
      setSale(updated);
      addAuditLog('Machine Sale Subsidy', 'Machine Sales', `${sale.saleNumber}: subsidy ${status}`);
      showToast('Subsidy updated', `Marked as ${status}`, 'success');
      onChanged();
    } catch (e: any) {
      showToast('Could not update subsidy', e.message || 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const events = [...(sale.events || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return shell(
    <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-mono text-base font-bold text-slate-900 dark:text-white">{sale.saleNumber}</h2>
          <StatusBadge status={sale.status} />
          <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {company.displayName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sale.status !== 'Cancelled' && <SaleWhatsAppButton sale={sale} />}
          {sale.status !== 'Cancelled' && (
            <button onClick={() => onAction('challan', sale)} className={BTN_GHOST}>
              <FileText className="h-3.5 w-3.5" /> Challan
            </button>
          )}
          {canEdit && (
            <button onClick={() => onAction('edit', sale)} className={BTN_GHOST}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onAction('delete', sale)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* Progress and next step */}
        <div className={`${CARD} p-4`}>
          {sale.status === 'Cancelled' ? (
            <div>
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">This sale was cancelled.</p>
              {sale.cancelReason && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Reason: {sale.cancelReason}</p>}
            </div>
          ) : (
            <ol className="flex flex-wrap items-center gap-y-2">
              {MACHINE_SALE_FLOW.map((s, i) => {
                const done = i < flowIdx || sale.status === 'Delivered';
                const current = i === flowIdx && sale.status !== 'Delivered';
                return (
                  <li key={s} className="flex items-center">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                        done
                          ? 'bg-emerald-500 text-white'
                          : current
                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                            : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className={`ml-1.5 text-[11px] ${current ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                      {TAB_LABEL[s] || s}
                    </span>
                    {i < MACHINE_SALE_FLOW.length - 1 && <span className="mx-2 h-px w-4 bg-slate-300 dark:bg-slate-700" />}
                  </li>
                );
              })}
            </ol>
          )}
          {!final && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              {next && (
                <button disabled={busy} onClick={() => onAction(next.kind, sale)} className={BTN_PRIMARY}>
                  {next.label}
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => onAction('cancel', sale)}
                className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                Cancel sale
              </button>
              {overdue && <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Expected delivery date has passed</span>}
            </div>
          )}
        </div>

        {/* Customer and machine */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={`${CARD} space-y-2.5 p-4`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Customer</h3>
            <Info label="Name" value={sale.customerName} />
            <Info label="Phone" value={sale.customerPhone} />
            <Info label="Address" value={sale.customerAddress} />
            <Info label="GSTIN" value={sale.customerGstin} mono />
          </div>
          <div className={`${CARD} space-y-2.5 p-4`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Machine</h3>
            <Info label="Machine" value={[sale.machineName, sale.model].filter(Boolean).join(' ')} />
            <div className="grid grid-cols-2 gap-2.5">
              <Info label="Item no." value={sale.sku} mono />
              <Info label="Serial no." value={sale.serialNumber} mono />
              <Info label="Engine no." value={sale.engineNumber} mono />
              <Info label="Chassis no." value={sale.chassisNumber} mono />
            </div>
            {!sale.productId && <p className="text-[11px] text-slate-400">Not linked to the catalogue; stock is not deducted.</p>}
          </div>
        </div>

        {/* Delivery */}
        <div className={`${CARD} grid grid-cols-2 gap-3 p-4 sm:grid-cols-4`}>
          <Info label="Booked" value={formatMessageDate(sale.bookingDate)} />
          <Info
            label="Expected delivery"
            value={sale.expectedDeliveryDate ? formatMessageDate(sale.expectedDeliveryDate) : ''}
            tone={overdue ? 'danger' : undefined}
          />
          <Info label="Delivered" value={sale.deliveredDate ? formatMessageDate(sale.deliveredDate) : ''} />
          <Info
            label="Warranty"
            value={sale.warrantyMonths > 0 ? `${sale.warrantyMonths} months${warrantyEnd ? ` to ${warrantyEnd}` : ''}` : 'None set'}
          />
          <Info label="PDI" value={sale.pdiDone ? 'Done' : 'Pending'} />
          <Info label="Vehicle" value={sale.vehicleNo} mono />
          <Info label="Driver" value={[sale.driverName, sale.driverPhone].filter(Boolean).join(', ')} />
          <Info label="Received by" value={sale.receivedByName} />
          <div className="col-span-2 sm:col-span-4">
            <Info label="Delivery address" value={sale.deliveryAddress || sale.customerAddress} />
          </div>
          {sale.pdiNotes && (
            <div className="col-span-2 sm:col-span-4">
              <Info label="PDI notes" value={sale.pdiNotes} />
            </div>
          )}
          {sale.handoverNotes && (
            <div className="col-span-2 sm:col-span-4">
              <Info label="Handover notes" value={sale.handoverNotes} />
            </div>
          )}
        </div>

        {/* Price and payments */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={`${CARD} space-y-1.5 p-4 text-xs`}>
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Price</h3>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>List price</span>
              <span>{money(sale.listPrice)}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Discount</span>
              <span>-{money(sale.discount)}</span>
            </div>
            {sale.gstRate > 0 && (
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>GST ({sale.gstRate}%)</span>
                <span>+{money(sale.gstAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-bold text-slate-900 dark:border-slate-800 dark:text-white">
              <span>{sale.gstRate > 0 ? 'Final price (incl. GST)' : 'Final price'}</span>
              <span>{money(sale.salePrice)}</span>
            </div>
            {sale.saleType === 'subsidy' && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Government subsidy ({sale.subsidyStatus || 'Applied'})</span>
                <span>-{money(sale.subsidyAmount)}</span>
              </div>
            )}
            {sale.saleType === 'subsidy' && (
              <div className="flex justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Customer pays</span>
                <span>{money(sale.customerPayable)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Received</span>
              <span>{money(sale.paidAmount)}</span>
            </div>
            <div className={`flex justify-between font-bold ${sale.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              <span>Balance</span>
              <span>{money(sale.balance)}</span>
            </div>
            {sale.status !== 'Cancelled' && (
              <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Payment</span>
                <span className="font-bold uppercase">{sale.balance <= 0 ? 'Paid' : sale.paidAmount > 0 ? 'Part paid' : 'Unpaid'}</span>
              </div>
            )}
            {sale.status === 'Delivered' && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60">
                <span className="text-slate-600 dark:text-slate-300">
                  Invoice: <strong className="font-mono">{sale.invoiceId && sale.documentNumber ? sale.documentNumber : 'not generated'}</strong>
                </span>
                {!sale.invoiceId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={generateInvoice}
                    className="cursor-pointer rounded bg-slate-800 px-2 py-1 font-bold text-white hover:bg-slate-900 disabled:opacity-60 dark:bg-slate-700"
                  >
                    Generate invoice
                  </button>
                )}
              </div>
            )}
            {sale.saleType === 'subsidy' && sale.status !== 'Cancelled' && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                  {sale.subsidyScheme || 'Government subsidy'}: {money(sale.subsidyAmount)} is {(sale.subsidyStatus || 'Applied').toLowerCase()}
                  {sale.subsidyStatus === 'Received' && sale.subsidyReceivedDate ? ` on ${sale.subsidyReceivedDate}` : ''}
                </p>
                {sale.subsidyApplicationNo && (
                  <p className="text-[11px] text-slate-500">Application no. {sale.subsidyApplicationNo}</p>
                )}
                {sale.subsidyStatus !== 'Received' && (
                  <div className="flex flex-wrap gap-1.5">
                    {sale.subsidyStatus !== 'Sanctioned' && sale.subsidyStatus !== 'Rejected' && (
                      <button disabled={busy} onClick={() => setSubsidy('Sanctioned')} className={BTN_GHOST}>
                        Mark sanctioned
                      </button>
                    )}
                    <button disabled={busy} onClick={() => setSubsidy('Received')} className={BTN_PRIMARY}>
                      Mark received
                    </button>
                    {sale.subsidyStatus !== 'Rejected' && (
                      <button disabled={busy} onClick={() => setSubsidy('Rejected')} className={BTN_GHOST}>
                        Rejected
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="pt-1 text-[11px] text-slate-400">
              Balance by {sale.paymentMode}
              {sale.paymentMode === 'Finance' && sale.financier && `: ${sale.financier}, loan ${money(sale.loanAmount)}`}
            </p>
          </div>

          <div className={`${CARD} space-y-3 p-4 text-xs`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Payments</h3>
            {sale.status !== 'Cancelled' && sale.balance > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className={INPUT}
                  placeholder="Amount"
                  aria-label="Payment amount"
                />
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as MachinePaymentMode)}
                  className={INPUT}
                  aria-label="Payment method"
                >
                  {MACHINE_PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={INPUT} aria-label="Paid on" />
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className={INPUT}
                  placeholder="Reference (optional)"
                  aria-label="Reference"
                />
                {num(payAmount) > 0 && (
                  <>
                    <input
                      type="number"
                      min="0"
                      value={payAmount2}
                      onChange={(e) => setPayAmount2(e.target.value)}
                      className={INPUT}
                      placeholder="Secondary payment amount (optional)"
                      aria-label="Secondary payment amount"
                    />
                    <select
                      value={payMethod2 !== payMethod ? payMethod2 : MACHINE_PAYMENT_MODES.find((m) => m !== payMethod) || 'UPI'}
                      onChange={(e) => setPayMethod2(e.target.value as MachinePaymentMode)}
                      disabled={!(num(payAmount2) > 0)}
                      className={INPUT}
                      aria-label="Secondary payment method"
                    >
                      {MACHINE_PAYMENT_MODES.filter((m) => m !== payMethod).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {num(payAmount2) > 0 && (
                      <input
                        value={payRef2}
                        onChange={(e) => setPayRef2(e.target.value)}
                        className={`${INPUT} col-span-2`}
                        placeholder="Secondary reference (optional)"
                        aria-label="Secondary reference"
                      />
                    )}
                  </>
                )}
                <button disabled={busy} onClick={recordPayment} className={`${BTN_PRIMARY} col-span-2`}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record payment
                </button>
              </div>
            )}
            {sale.payments.length === 0 ? (
              <p className="text-slate-400">No payments received yet</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {sale.payments.map((p) =>
                  editPay && editPay.id === p.id ? (
                    <li key={p.id} className="grid grid-cols-2 gap-2 py-2">
                      <input
                        type="number"
                        min="0"
                        value={editPay.amount}
                        onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })}
                        className={INPUT}
                        aria-label="Payment amount"
                      />
                      <select
                        value={editPay.method}
                        onChange={(e) => setEditPay({ ...editPay, method: e.target.value as MachinePaymentMode })}
                        className={INPUT}
                        aria-label="Payment method"
                      >
                        {MACHINE_PAYMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input type="date" value={editPay.paidOn} onChange={(e) => setEditPay({ ...editPay, paidOn: e.target.value })} className={INPUT} aria-label="Paid on" />
                      <input
                        value={editPay.reference}
                        onChange={(e) => setEditPay({ ...editPay, reference: e.target.value })}
                        className={INPUT}
                        placeholder="Reference (optional)"
                        aria-label="Reference"
                      />
                      <div className="col-span-2 flex justify-end gap-2">
                        <button type="button" disabled={busy} onClick={() => setEditPay(null)} className={BTN_GHOST}>
                          Cancel
                        </button>
                        <button type="button" disabled={busy} onClick={savePaymentEdit} className={BTN_PRIMARY}>
                          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save payment
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-slate-700 dark:text-slate-300">
                      <span className="min-w-0">
                        {formatMessageDate(p.paidOn)} <span className="text-slate-400">{p.method}</span>
                        {p.reference && <span className="ml-1 font-mono text-[10px] text-slate-400">{p.reference}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="font-semibold">{money(p.amount)}</span>
                        {canDelete && sale.status !== 'Cancelled' && (
                          <>
                            <button
                              type="button"
                              title="Edit this payment"
                              aria-label="Edit payment"
                              disabled={busy}
                              onClick={() => setEditPay({ id: p.id, amount: String(p.amount), method: p.method as MachinePaymentMode, paidOn: p.paidOn.slice(0, 10), reference: p.reference || '' })}
                              className="cursor-pointer rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Remove this payment"
                              aria-label="Remove payment"
                              disabled={busy}
                              onClick={() => removePayment(p)}
                              className="cursor-pointer rounded p-1 text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className={`${CARD} p-4`}>
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Timeline</h3>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400">No activity recorded yet</p>
          ) : (
            <ol className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
              {events.map((ev) => (
                <li key={ev.id} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-500 dark:border-slate-900 dark:bg-slate-400" />
                  <p className="font-semibold text-slate-900 dark:text-white">{ev.stage}</p>
                  <p className="text-[11px] text-slate-400">
                    {formatMessageDate(ev.date)}
                    {ev.user && ` - ${ev.user}`}
                  </p>
                  {ev.notes && <p className="mt-0.5 text-slate-600 dark:text-slate-400">{ev.notes}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------- Summary tile ----------

const Tile: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'danger';
  onClick?: () => void;
  active?: boolean;
  wide?: boolean;
}> = ({ label, value, sub, tone = 'default', onClick, active, wide }) => {
  const body = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
    </>
  );
  const cls = `${CARD} p-3 text-left ${wide ? 'col-span-2 md:col-span-1' : ''} ${active ? 'ring-2 ring-slate-800 dark:ring-slate-300' : ''}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

// ---------- Main view ----------

export const MachineSalesView: React.FC = () => {
  const { settings, selectedBranchId, branches, machineSaleSeedProductId, clearMachineSaleSeed, warranties, syncMachineWarranty, deleteWarranty } =
    useERP();
  const { scope, branchParam, isOwner } = useApiScope();
  const { getCompany } = useCompanies();
  const currency = settings.currencySymbol || '₹';
  const money = (n: number) => formatMoney(n, currency);

  const [rows, setRows] = useState<MachineSale[]>([]);
  const [summary, setSummary] = useState<MachineSaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | MachineSaleStatus>('All');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [serialSearch, setSerialSearch] = useState('');
  const [debouncedSerial, setDebouncedSerial] = useState('');
  const [serialState, setSerialState] = useState<'all' | 'with' | 'without'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid' | 'part'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [yearsReport, setYearsReport] = useState<YearsReport | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // machine picked with "Sell" in the catalogue: the new sale form opens with it already chosen
  const [seedProductId, setSeedProductId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (machineSaleSeedProductId) {
      setSeedProductId(machineSaleSeedProductId);
      setDialog({ kind: 'new' });
      clearMachineSaleSeed();
    }
  }, [machineSaleSeedProductId]);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSerial(serialSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [serialSearch]);

  useEffect(() => {
    let live = true;
    machineSaleApi
      .years(scope, branchParam)
      .then((r) => live && setYearsReport(r))
      .catch(() => live && setYearsReport(null));
    return () => {
      live = false;
    };
  }, [scope, branchParam, version]);

  // The year picked in the drop-down is simply the booked-from and booked-up-to dates of that financial year (April to March).
  const thisFy = (() => {
    const t = new Date(Date.now() + 5.5 * 3600_000);
    return t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  })();
  const yearOptions = useMemo(() => {
    const first = Math.min(2013, ...(yearsReport?.years.map((y) => y.fy) ?? [2013]));
    const list: { fy: number; units: number }[] = [];
    for (let y = thisFy; y >= first; y--) list.push({ fy: y, units: yearsReport?.years.find((x) => x.fy === y)?.units ?? 0 });
    return list;
  }, [yearsReport, thisFy]);
  const pickedYear = useMemo(() => {
    const m = /^(\d{4})-04-01$/.exec(from);
    return m && to === `${Number(m[1]) + 1}-03-31` ? Number(m[1]) : null;
  }, [from, to]);
  const noDatePicked = from === NO_DATE && to === NO_DATE;
  const pickNoDate = () => {
    setFrom(NO_DATE);
    setTo(NO_DATE);
  };
  const pickYear = (fy: number | null) => {
    if (fy === null) {
      setFrom('');
      setTo('');
    } else {
      setFrom(`${fy}-04-01`);
      setTo(`${fy + 1}-03-31`);
    }
  };

  const load = useCallback(async () => {
    const req = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        machineSaleApi.list(scope, {
          branchId: branchParam,
          status: statusFilter,
          q: debouncedSearch,
          from: from || undefined,
          to: to || undefined,
          serial: debouncedSerial || undefined,
          serialState,
          payment: paymentFilter
        }),
        machineSaleApi.summary(scope, branchParam)
      ]);
      if (req !== requestRef.current) return;
      setRows(list);
      setSummary(sum);
    } catch (e: any) {
      if (req !== requestRef.current) return;
      setError(e.message || 'Failed to load machine sales');
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, [scope, branchParam, statusFilter, debouncedSearch, from, to, debouncedSerial, serialState, paymentFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || id;

  const changed = () => {
    setVersion((v) => v + 1);
    load();
  };

  const openStep = (kind: StepKind | 'edit' | 'cancel' | 'challan' | 'delete', sale: MachineSale) => setDialog({ kind, sale });

  // Every machine sale that is paid for or delivered has its warranty on the Warranty page (code WR-<sale number>).
  // The start is the delivery date once delivered (the booking date before that); a cancelled sale voids it.
  useEffect(() => {
    for (const m of rows) {
      if (!(m.warrantyMonths > 0)) continue;
      const cancelled = m.status === 'Cancelled';
      if (!cancelled && !m.invoiceId && m.status !== 'Delivered') continue;
      const start = m.warrantyStart || m.deliveredDate || m.bookingDate;
      if (!start) continue;
      syncMachineWarranty({
        warrantyCode: `WR-${m.saleNumber}`,
        serialNumber: m.serialNumber || m.engineNumber || m.chassisNumber || m.saleNumber,
        chassisNumber: m.chassisNumber || undefined,
        engineNumber: m.engineNumber || undefined,
        productId: m.productId || '',
        productName: [m.machineName, m.model].filter(Boolean).join(' '),
        productSku: m.sku || '',
        productCategory: 'Machinery',
        customerId: m.customerId || '',
        customerName: m.customerName,
        customerPhone: m.customerPhone,
        branchId: m.branchId,
        branchName: branches.find((b) => b.id === m.branchId)?.name,
        invoiceId: m.invoiceId || undefined,
        invoiceNumber: m.documentNumber || undefined,
        purchaseDate: m.deliveredDate || m.bookingDate || start,
        warrantyStartDate: start,
        warrantyEndDate: addMonthsIso(start, m.warrantyMonths),
        durationMonths: m.warrantyMonths,
        coverageType: 'Full Comprehensive',
        status: cancelled ? 'Void' : 'Active',
        notes: `Machine sale ${m.saleNumber}`,
        serviceRecords: []
      } as any);
    }
  }, [rows, warranties.length]);

  const tabCount = (t: 'All' | MachineSaleStatus): number | undefined => {
    if (!summary) return undefined;
    if (t === 'Booked') return summary.booked;
    if (t === 'Ready for Delivery') return summary.readyForDelivery;
    if (t === 'Dispatched') return summary.dispatched;
    return undefined;
  };

  const exportCsv = () => {
    downloadCSV(
      `Machine_Sales_${todayIst()}.csv`,
      ['Sale no', 'Status', 'Company', 'Customer', 'Phone', 'Machine', 'Model', 'Serial no', 'Engine no', 'Chassis no', 'Final price', 'Received', 'Balance', 'Booked', 'Expected delivery', 'Delivered'],
      rows.map((r) => [
        r.saleNumber,
        r.status,
        getCompany(r.companyId).displayName,
        r.customerName,
        r.customerPhone,
        r.machineName,
        r.model,
        r.serialNumber,
        r.engineNumber,
        r.chassisNumber,
        r.salePrice,
        r.paidAmount,
        r.balance,
        r.bookingDate === NO_DATE ? '' : r.bookingDate,
        r.expectedDeliveryDate,
        r.deliveredDate
      ])
    );
  };

  const filtered = statusFilter !== 'All' || !!debouncedSearch || !!from || !!to;
  const COLS = 8;

  return (
    <div className="space-y-5 pb-12">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Machine Sales &amp; Delivery</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Book a tractor, inspect it, dispatch it and hand it over with a delivery challan</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={rows.length === 0} className={`${BTN_GHOST} whitespace-nowrap`}>
            Export CSV
          </button>
          <button onClick={load} className={`${BTN_GHOST} shrink-0`} aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setDialog({ kind: 'new' })} className={`${BTN_PRIMARY} min-w-0 flex-1 whitespace-nowrap sm:flex-none`}>
            <Plus className="h-3.5 w-3.5 shrink-0" /> New machine sale
          </button>
        </div>
      </div>

      <div className="no-print grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Booked" value={summary?.booked ?? '-'} onClick={() => setStatusFilter('Booked')} active={statusFilter === 'Booked'} />
        <Tile
          label="Ready"
          value={summary?.readyForDelivery ?? '-'}
          sub="PDI done"
          onClick={() => setStatusFilter('Ready for Delivery')}
          active={statusFilter === 'Ready for Delivery'}
        />
        <Tile label="On the way" value={summary?.dispatched ?? '-'} onClick={() => setStatusFilter('Dispatched')} active={statusFilter === 'Dispatched'} />
        <Tile
          label="Delivered this month"
          value={summary?.deliveredThisMonth ?? '-'}
          onClick={() => setStatusFilter('Delivered')}
          active={statusFilter === 'Delivered'}
        />
        <Tile
          label="Balance to collect"
          value={summary ? money(summary.outstandingBalance) : '-'}
          tone={summary && summary.outstandingBalance > 0 ? 'danger' : 'default'}
        />
        <Tile label="Subsidy to claim" value={summary ? money(summary.subsidyPending) : '-'} />
        <Tile
          label="Due today / overdue"
          value={
            summary ? (
              <>
                {summary.dueToday}
                <span className="mx-1 text-slate-300 dark:text-slate-600">/</span>
                <span className={summary.overdue > 0 ? 'text-rose-600 dark:text-rose-400' : ''}>{summary.overdue}</span>
              </>
            ) : (
              '-'
            )
          }
          sub="Expected delivery dates"
          wide
        />
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <label htmlFor="ms-year" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          Year
        </label>
        <select
          id="ms-year"
          value={noDatePicked ? 'nodate' : pickedYear === null ? (from || to ? 'custom' : 'all') : String(pickedYear)}
          onChange={(e) => (e.target.value === 'all' ? pickYear(null) : e.target.value === 'custom' ? undefined : e.target.value === 'nodate' ? pickNoDate() : pickYear(Number(e.target.value)))}
          aria-label="Show one financial year"
          className={`${FILTER} font-semibold sm:max-w-[14rem]`}
        >
          <option value="all">All years</option>
          {pickedYear === null && !noDatePicked && (from || to) && <option value="custom">Custom dates</option>}
          {yearOptions.map((o) => (
            <option key={o.fy} value={o.fy}>
              {`${o.fy}-${o.fy + 1}`}
              {o.units ? ` (${o.units})` : ''}
            </option>
          ))}
          {yearsReport && yearsReport.noDate.units > 0 && <option value="nodate">{`No date (${yearsReport.noDate.units})`}</option>}
        </select>
        {noDatePicked && <span className="text-[11px] text-slate-500">Old bills that had no date written on them</span>}
        {pickedYear !== null && <span className="text-[11px] text-slate-500">Only {pickedYear}-{pickedYear + 1} is shown</span>}
      </div>

      {yearsReport && yearsReport.years.length > 0 && <YearsPanel report={yearsReport} picked={pickedYear} onPick={pickYear} money={money} />}

      <div className="no-print flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {STATUS_TABS.map((t) => {
            const active = statusFilter === t;
            const count = tabCount(t);
            return (
              <button
                key={t}
                onClick={() => setStatusFilter(t)}
                className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors sm:px-2.5 sm:py-1 sm:text-[11px] ${
                  active
                    ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {TAB_LABEL[t] || t}
                {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            title="Booked from"
            className={FILTER}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            title="Booked up to"
            className={FILTER}
          />
          <div className="relative col-span-2 w-full sm:w-52">
            <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
            <input
              value={serialSearch}
              onChange={(e) => setSerialSearch(e.target.value)}
              placeholder="Serial / engine / chassis no."
              aria-label="Search by machine serial, engine or chassis number"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 font-mono text-sm sm:h-8 sm:text-[11px] text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <select
            value={serialState}
            onChange={(e) => setSerialState(e.target.value as 'all' | 'with' | 'without')}
            aria-label="Filter by serial number status"
            className={FILTER}
          >
            <option value="all">Serial: all</option>
            <option value="with">Serial recorded</option>
            <option value="without">Serial not entered</option>
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as 'all' | 'paid' | 'unpaid' | 'part')}
            aria-label="Filter by payment"
            className={FILTER}
          >
            <option value="all">Payment: all</option>
            <option value="paid">Paid</option>
            <option value="part">Part paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <div className="relative col-span-2 w-full sm:w-52">
            <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sale no, customer, phone, serial"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 sm:h-8 sm:text-[11px] focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* Phones: one card per machine sale */}
      <div className="no-print space-y-3 md:hidden">
        {loading && rows.length === 0 ? (
          <div className={`${CARD} py-10 text-center text-xs text-slate-400`}>
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
            Loading machine sales
          </div>
        ) : error ? (
          <div className={`${CARD} py-10 text-center`}>
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{error}</p>
            <button onClick={load} className={`${BTN_PRIMARY} mt-3`}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className={`${CARD} px-5 py-10 text-center text-xs text-slate-400`}>
            <Tractor className="mx-auto mb-2 h-10 w-10 stroke-1 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{filtered ? 'No machine sales match' : 'No machine sales yet'}</p>
            <p className="mt-0.5">{filtered ? 'Change the status, dates or search.' : 'Tap New machine sale to book one.'}</p>
          </div>
        ) : (
          rows.map((r) => {
            const overdue = isSaleOverdue(r);
            const dueToday = isSaleDueToday(r);
            const step = NEXT_STEP[r.status];
            const canEdit = r.status !== 'Cancelled' && (isOwner || scope.role === 'Branch Manager' || r.status === 'Booked' || r.status === 'Ready for Delivery');
            const canDelete = isOwner || scope.role === 'Branch Manager';
            const cancelled = r.status === 'Cancelled';
            return (
              <div key={r.id} onClick={() => setSelectedId(r.id)} className={`${CARD} cursor-pointer p-3.5`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{r.saleNumber}</p>
                    {r.isHistorical && <p className="text-[10px] font-bold text-slate-400">Old record · {dayLabel(r.bookingDate)}</p>}
                    <p className="truncate text-[11px] text-slate-500">
                      {getCompany(r.companyId).displayName}
                      {isOwner && selectedBranchId === 'all' && ` · ${branchName(r.branchId)}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{r.customerName}</p>
                <p className="text-[11px] text-slate-500">{r.customerPhone || '-'}</p>

                <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{[r.machineName, r.model].filter(Boolean).join(' ') || '-'}</p>
                  <p className="font-mono text-[11px] text-slate-500">{r.serialNumber || 'No serial yet'}</p>
                  {r.saleType === 'subsidy' && (
                    <span className="mt-1 inline-block rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Subsidy{r.subsidyStatus ? `: ${r.subsidyStatus}` : ''}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Price</p>
                    <p className="font-bold text-slate-900 dark:text-white">{money(r.salePrice)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Balance</p>
                    <p className={`font-bold ${cancelled ? 'text-slate-400' : r.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {cancelled ? '-' : r.balance > 0 ? money(r.balance) : 'Settled'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Expected</p>
                    <p className={`font-bold ${overdue ? 'text-rose-600 dark:text-rose-400' : dueToday ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {r.expectedDeliveryDate ? formatMessageDate(r.expectedDeliveryDate) : '-'}
                    </p>
                    {(overdue || dueToday) && <p className="text-[10px] font-bold">{overdue ? 'Overdue' : 'Today'}</p>}
                  </div>
                </div>

                {(step || r.status === 'Delivered' || canEdit || canDelete) && (
                  <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {step ? (
                      <button onClick={() => openStep(step.kind, r)} className={`${BTN_PRIMARY} min-w-0 flex-1 whitespace-nowrap`}>
                        {step.label}
                      </button>
                    ) : r.status === 'Delivered' ? (
                      <button onClick={() => openStep('challan', r)} className={`${BTN_GHOST} min-w-0 flex-1 whitespace-nowrap`}>
                        <FileText className="h-3.5 w-3.5" /> Challan
                      </button>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {canEdit && (
                      <button onClick={() => openStep('edit', r)} aria-label="Edit this sale" className={`${BTN_GHOST} shrink-0 px-3`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => openStep('delete', r)} aria-label="Delete this sale" className={`${BTN_GHOST} shrink-0 px-3 text-rose-600 dark:text-rose-400`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={`no-print hidden overflow-hidden md:block ${CARD}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3">Sale no.</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Machine</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">Balance</th>
                <th className="px-3 py-3">Expected</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                    Loading machine sales
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={COLS} className="py-12 text-center">
                    <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
                    <p className="font-semibold text-slate-700 dark:text-slate-300">{error}</p>
                    <button onClick={load} className={`${BTN_PRIMARY} mt-3`}>
                      Retry
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-6 py-12 text-center text-slate-400">
                    <Tractor className="mx-auto mb-2 h-10 w-10 stroke-1 text-slate-300 dark:text-slate-600" />
                    {filtered ? (
                      <>
                        <p className="font-semibold text-slate-600 dark:text-slate-300">No machine sales match</p>
                        <p className="mt-0.5">Change the status, dates or search.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-slate-600 dark:text-slate-300">No machine sales yet</p>
                        <p className="mx-auto mt-1 max-w-md">
                          Book a machine with the customer and advance, mark it ready once the pre-delivery inspection is done, dispatch it
                          (stock is deducted), then confirm delivery to print the challan and start the warranty.
                        </p>
                        <button onClick={() => setDialog({ kind: 'new' })} className={`${BTN_PRIMARY} mt-4`}>
                          <Plus className="h-3.5 w-3.5" /> New machine sale
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const overdue = isSaleOverdue(r);
                  const dueToday = isSaleDueToday(r);
                  const step = NEXT_STEP[r.status];
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-3 py-3">
                        <span className="whitespace-nowrap font-mono font-bold text-slate-900 dark:text-white">{r.saleNumber}</span>
                        {r.isHistorical && <span className="block text-[10px] font-bold text-slate-400">Old record · {dayLabel(r.bookingDate)}</span>}
                        <span className="block text-[10px] text-slate-400">
                          {getCompany(r.companyId).displayName}
                          {isOwner && selectedBranchId === 'all' && ` - ${branchName(r.branchId)}`}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-semibold text-slate-900 dark:text-white">{r.customerName}</span>
                        <span className="block text-[11px] text-slate-400">{r.customerPhone || '-'}</span>
                      </td>
                      <td className="px-3 py-3">
                        {[r.machineName, r.model].filter(Boolean).join(' ') || '-'}
                        <span className="block font-mono text-[11px] text-slate-400">{r.serialNumber || 'No serial yet'}</span>
                        {r.saleType === 'subsidy' && (
                          <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Subsidy{r.subsidyStatus ? `: ${r.subsidyStatus}` : ''}
                          </span>
                        )}
                        {(r.engineNumber || r.chassisNumber) && (
                          <span className="block font-mono text-[10px] text-slate-400">
                            {[r.engineNumber && `Eng ${r.engineNumber}`, r.chassisNumber && `Ch ${r.chassisNumber}`].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">{money(r.salePrice)}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${
                          r.status === 'Cancelled'
                            ? 'text-slate-400'
                            : r.balance > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {r.status === 'Cancelled' ? '-' : r.balance > 0 ? money(r.balance) : 'Settled'}
                        {r.status !== 'Cancelled' && (
                          <span
                            className={`mt-0.5 block text-[10px] font-bold uppercase ${
                              r.balance <= 0 ? 'text-emerald-600 dark:text-emerald-400' : r.paidAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {r.balance <= 0 ? 'Paid' : r.paidAmount > 0 ? 'Part paid' : 'Unpaid'}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {r.expectedDeliveryDate ? (
                          <span
                            className={
                              overdue
                                ? 'rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                : dueToday
                                  ? 'rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                                  : ''
                            }
                          >
                            {formatMessageDate(r.expectedDeliveryDate)}
                            {overdue && ' (overdue)'}
                            {dueToday && ' (today)'}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                        {step ? (
                          <button onClick={() => openStep(step.kind, r)} className={`${BTN_PRIMARY} whitespace-nowrap`}>
                            {step.label}
                          </button>
                        ) : r.status === 'Delivered' ? (
                          <button onClick={() => openStep('challan', r)} className={`${BTN_GHOST} whitespace-nowrap`}>
                            <FileText className="h-3.5 w-3.5" /> Challan
                          </button>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                        {r.status !== 'Cancelled' && (isOwner || scope.role === 'Branch Manager' || r.status === 'Booked' || r.status === 'Ready for Delivery') && (
                          <button
                            onClick={() => openStep('edit', r)}
                            title="Edit this sale"
                            aria-label="Edit this sale"
                            className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(isOwner || scope.role === 'Branch Manager') && (
                          <button
                            onClick={() => openStep('delete', r)}
                            title="Delete this sale"
                            aria-label="Delete this sale"
                            className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedId && (
        <SaleDrawer saleId={selectedId} version={version} onClose={() => setSelectedId(null)} onChanged={changed} onAction={openStep} />
      )}

      {dialog?.kind === 'new' && (
        <MachineSaleForm
          initialProductId={seedProductId}
          onClose={() => {
            setDialog(null);
            setSeedProductId(undefined);
          }}
          onSaved={(s) => {
            setSeedProductId(undefined);
            setDialog(null);
            setSelectedId(s.id);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteSaleDialog
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onDone={() => {
            const w = warranties.find((x) => x.warrantyCode === `WR-${dialog.sale.saleNumber}`);
            if (w) deleteWarranty(w.id);
            setDialog(null);
            setSelectedId(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <MachineSaleForm
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'pdi' && (
        <PdiDialog
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'dispatch' && (
        <DispatchDialog
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'deliver' && (
        <DeliverDialog
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onDone={(s) => {
            // The handover is when the challan is needed, so show it straight away.
            setDialog({ kind: 'challan', sale: s });
            changed();
          }}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelSaleDialog
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'challan' && <DeliveryChallan sale={dialog.sale} onClose={() => setDialog(null)} />}
    </div>
  );
};

const dayLabel = (ymd: string) => {
  if (ymd === NO_DATE) return 'No date';
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lakhs = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(2)} cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} L` : Math.round(n).toLocaleString('en-IN'));

// Machines sold in each financial year, and the months machines sell in. Tapping a year shows only that year.
const YearsPanel: React.FC<{ report: YearsReport; picked: number | null; onPick: (fy: number | null) => void; money: (n: number) => string }> = ({ report, picked, onPick, money }) => {
  const [open, setOpen] = useState(false);
  const maxUnits = Math.max(1, ...report.years.map((y) => y.units));
  const maxMonth = Math.max(1, ...report.monthly);
  // April first, to follow the financial year
  const monthOrder = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
  return (
    <div className={`${CARD} no-print overflow-hidden`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <BarChart3 className="h-4 w-4 shrink-0 text-indigo-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Machines sold, year by year</p>
          <p className="truncate text-[11px] text-slate-500">
            {report.totalUnits.toLocaleString('en-IN')} machines · {money(report.totalValue)} · {report.years[0].label} to {report.years[report.years.length - 1].label}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-3.5 dark:border-slate-800">
          <ul className="space-y-1.5">
            {report.years.map((y) => (
              <li key={y.fy}>
                <button type="button" onClick={() => onPick(picked === y.fy ? null : y.fy)} className={`w-full cursor-pointer rounded-lg px-2.5 py-2 text-left ${picked === y.fy ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-900 dark:text-white">{y.label}</span>
                    <span className="text-[12px] text-slate-600 dark:text-slate-300">
                      <b>{y.units}</b> machines · ₹{lakhs(y.value)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(3, (y.units / maxUnits) * 100)}%` }} />
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    Average ₹{lakhs(y.avgPrice)}
                    {y.topModel ? ` · most sold: ${y.topModel} (${y.topModelUnits})` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {report.noDate.units > 0 && (
            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <b>No date:</b> {report.noDate.units} machines (₹{lakhs(report.noDate.value)}) on old bills that had no date written on them. They are not counted in the years above or in the months below.
            </p>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Machines sold in each month, all years together</p>
            <div className="flex h-24 items-end gap-1.5">
              {monthOrder.map((mi) => (
                <div key={mi} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{report.monthly[mi]}</span>
                  <div className="w-full rounded-t bg-emerald-500" style={{ height: `${Math.max(2, (report.monthly[mi] / maxMonth) * 64)}px` }} />
                  <span className="text-[10px] text-slate-500">{MONTH_NAMES[mi]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
