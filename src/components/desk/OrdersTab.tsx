import React, { useEffect, useState } from 'react';
import { CheckCircle2, History, Loader2, Trash2, Truck, Wallet, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { deskApi, type SupplierOrder, type SupplierPayment } from '../../services/deskApi';
import { saveFirestoreDoc } from '../../lib/firestoreService';
import type { Supplier } from '../../types/erp';
import { PaySupplierDialog } from './PaySupplierDialog';
import { Good, Hero, Note, Panel, Stat, Stepper, TabState, Tip, WhatsAppButton, compact, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

const BADGE: Record<string, string> = {
  Ordered: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  Received: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  Cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
};
const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const orderText = (o: SupplierOrder) =>
  `Order ${o.orderNo} from Acme Agro Equipment${o.branchName ? ` (${o.branchName})` : ''}:\n${o.lines.map((l, i) => `${i + 1}. ${l.name}${l.sku ? ` (${l.sku})` : ''} - ${l.label || `${l.qty} ${l.unit || ''}`}`).join('\n')}${o.expectedDate ? `\nPlease deliver by ${o.expectedDate}.` : ''}\nThank you.`;

// Orders placed with suppliers, what is still on the way, and what is owed to suppliers.
export const OrdersTab: React.FC = () => {
  const { settings, selectedBranchId, suppliers, showToast, setCurrentView, addAuditLog } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const { data, loading, error, reload } = useTabData(() => deskApi.orders(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const [busyId, setBusyId] = useState('');
  const [paying, setPaying] = useState<Supplier | null>(null);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const loadPayments = () => {
    deskApi.supplierPayments(scope).then(setPayments).catch(() => setPayments([]));
  };
  useEffect(loadPayments, [scope.role, scope.branchId]);

  const cancelPayment = async (p: SupplierPayment) => {
    if (busyId) return;
    if (!window.confirm(`Cancel ${p.paymentNo}? The ${cur}${p.amount.toLocaleString('en-IN')} goes back onto what you owe ${p.supplierName}${p.method === 'Cash' ? ', and comes off the cash book entry' : ''}.`)) return;
    setBusyId(p.id);
    try {
      await deskApi.cancelSupplierPayment(scope, p.id);
      const s = suppliers.find((x) => x.id === p.supplierId);
      if (s) await saveFirestoreDoc('suppliers', s.id, { ...s, outstandingPayable: Math.round((s.outstandingPayable + p.amount) * 100) / 100 });
      addAuditLog('Cancelled supplier payment', 'Purchases', `${p.paymentNo}: ${cur}${p.amount.toLocaleString('en-IN')} paid to ${p.supplierName} was cancelled.`, { severity: 'warning', entityType: 'Supplier', entityId: p.supplierId });
      showToast('Payment cancelled', `${p.paymentNo} was removed.`, 'success');
      loadPayments();
    } catch (e: any) {
      showToast('Could not cancel', e?.message || 'Please try again.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const change = async (o: SupplierOrder, status: 'Received' | 'Cancelled') => {
    setBusyId(o.id);
    try {
      await deskApi.setOrderStatus(scope, o.id, status);
      addAuditLog(`Supplier order ${status.toLowerCase()}`, 'Purchases', `${o.orderNo} to ${o.supplierName} was marked ${status.toLowerCase()}.`, { severity: 'info', entityType: 'Supplier', entityId: o.id });
      showToast(status === 'Received' ? 'Marked received' : 'Order cancelled', `${o.orderNo} · ${o.supplierName}`, 'success');
      reload();
    } catch (e: any) {
      showToast('Could not update', e?.message || 'Please try again.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const open = (data || []).filter((o) => o.status === 'Ordered');
  const past = (data || []).filter((o) => o.status !== 'Ordered');
  const payable = suppliers.filter((s) => (s.outstandingPayable || 0) > 0).sort((a, b) => b.outstandingPayable - a.outstandingPayable);
  const payableTotal = payable.reduce((s, x) => s + x.outstandingPayable, 0);

  const card = (o: SupplierOrder, actions: boolean) => (
    <li key={o.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-extrabold text-slate-900 dark:text-white">{o.supplierName}</p>
          <p className="text-[11px] text-slate-500">
            <span className="font-mono">{o.orderNo}</span> · ordered {when(o.createdAt)}
            {o.expectedDate ? ` · expected ${shortDate(o.expectedDate)}` : ''}
            {o.branchName ? ` · for ${o.branchName}` : ''}
            {o.createdBy ? ` · by ${o.createdBy}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${BADGE[o.status]}`}>{o.status}</span>
      </div>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {o.lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-1.5 text-xs">
            <span className="min-w-0 break-words font-semibold text-slate-800 dark:text-slate-100">
              {l.name}
              {l.sku && <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-400">{l.sku}</span>}
            </span>
            <span className="shrink-0 font-bold text-indigo-600 dark:text-indigo-300">{l.label || `${l.qty} ${l.unit || ''}`}</span>
          </li>
        ))}
      </ul>
      {actions && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busyId === o.id} onClick={() => change(o, 'Received')} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Mark received
          </button>
          <WhatsAppButton phone={o.supplierPhone} text={orderText(o)} label="Send again" />
          <button type="button" disabled={busyId === o.id} onClick={() => change(o, 'Cancelled')} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
            <XCircle className="h-3.5 w-3.5" /> Cancel
          </button>
        </div>
      )}
    </li>
  );

  const steps: Step[] = [];
  if (data) {
    steps.push({
      id: 'open',
      label: 'On order',
      title: 'Orders still on the way',
      hint: 'Saved from the Buy list. When the goods arrive, receive the stock in Inventory, then mark the order received here.',
      icon: Truck,
      content: (
        <div className="space-y-4">
          <Hero tone={open.length ? 'amber' : 'emerald'} label="Orders waiting" value={open.length} sub={open.length ? `${open.reduce((s, o) => s + o.lines.length, 0)} items from ${new Set(open.map((o) => o.supplierName)).size} supplier${new Set(open.map((o) => o.supplierName)).size === 1 ? '' : 's'}` : 'Nothing is on order'} />
          {open.length === 0 ? <Good>No order is waiting</Good> : <ul className="space-y-3">{open.map((o) => card(o, true))}</ul>}
          <Tip title="How to place one">Open the Buy list, and press <b>Save as order</b> under a supplier. It is saved here and the items show "on order" in the Buy list, so nobody orders them twice.</Tip>
          <button type="button" onClick={() => setCurrentView('inventory')} className="cursor-pointer text-xs font-bold text-indigo-600 underline dark:text-indigo-400">
            Receive stock in Inventory
          </button>
        </div>
      )
    });

    steps.push({
      id: 'payable',
      label: 'Owed to suppliers',
      title: 'What you owe suppliers',
      hint: 'The payable balance kept on each supplier.',
      icon: Wallet,
      content:
        payable.length === 0 ? (
          <Note>No supplier has an outstanding balance saved. If you buy on credit, keep the supplier's payable updated, and it will show here.</Note>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total payable" value={compact(payableTotal, cur)} tone="bad" />
              <Stat label="Suppliers" value={payable.length} />
            </div>
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {payable.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{s.companyName || s.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {s.paymentTerms || (s.creditPeriodDays ? `${s.creditPeriodDays} days credit` : '')}
                        {s.lastPurchaseDate ? ` · last bought ${s.lastPurchaseDate}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-base font-black tabular-nums text-rose-600">{compact(s.outstandingPayable, cur)}</p>
                      <button type="button" onClick={() => setPaying(s)} className="cursor-pointer rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500">
                        Pay
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )
    });

    steps.push({
      id: 'paid',
      label: 'Paid',
      title: 'Payments made to suppliers',
      hint: 'Every payment recorded here, newest first. A cash payment is also in the cash book.',
      icon: CheckCircle2,
      content:
        payments.length === 0 ? (
          <Note>No payment to a supplier has been recorded yet. Use Pay beside a supplier under Owed to suppliers.</Note>
        ) : (
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{p.supplierName}</p>
                    <p className="text-[11px] text-slate-500">
                      <span className="font-mono">{p.paymentNo}</span> · {shortDate(p.paidOn)} · {p.method}
                      {p.branchName ? ` · ${p.branchName}` : ''}
                      {p.reference ? ` · ref ${p.reference}` : ''}
                      {p.createdBy ? ` · by ${p.createdBy}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{compact(p.amount, cur)}</p>
                    <button type="button" disabled={busyId === p.id} onClick={() => cancelPayment(p)} aria-label="Cancel this payment" title="Cancel this payment" className="cursor-pointer rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40">
                      {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )
    });

    steps.push({
      id: 'past',
      label: 'Past orders',
      title: 'Orders already received or cancelled',
      hint: 'The latest 80 orders.',
      icon: History,
      content: past.length === 0 ? <Note>No finished orders yet.</Note> : <ul className="space-y-3">{past.map((o) => card(o, false))}</ul>
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey={`orders-${branchParam}`} />}
      <PaySupplierDialog supplier={paying} cur={cur} onClose={() => setPaying(null)} onDone={loadPayments} />
    </TabState>
  );
};
