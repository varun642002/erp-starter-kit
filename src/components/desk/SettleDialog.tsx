import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { documentApi } from '../../services/documentApi';
import { machineSaleApi, ADVANCE_METHODS } from '../../services/machineSaleApi';
import { jobCardApi } from '../../services/jobCardApi';
import type { PendingSource } from '../../services/messageApi';

export interface SettleTarget {
  source: PendingSource;
  id: string; // invoice, machine sale or job card id
  number: string;
  customerName: string;
  balance: number;
}

const METHODS: Record<PendingSource, string[]> = {
  invoice: ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'],
  'machine-sale': [...ADVANCE_METHODS],
  'job-card': ['Cash', 'UPI', 'Bank Transfer', 'Card']
};
const KIND: Record<PendingSource, string> = { invoice: 'Invoice', 'machine-sale': 'Machine sale', 'job-card': 'Job card' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const FIELD = 'mt-1 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

// Takes a payment against one unpaid bill. The amount starts as the whole remainder; a smaller amount is a part payment.
export const SettleDialog: React.FC<{ target: SettleTarget | null; cur: string; onClose: () => void; onDone: (paid: number, target: SettleTarget) => void }> = ({ target, cur, onClose, onDone }) => {
  const { scope } = useApiScope();
  const { showToast, addAuditLog } = useERP();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setAmount(String(Math.round(target.balance * 100) / 100));
    setMethod('Cash');
    setPaidOn(today());
    setReference('');
    setError('');
    setBusy(false);
  }, [target]);

  if (!target) return null;
  const money = (n: number) => `${cur}${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((target.balance - amt) * 100) / 100);
  const problem = !(amt > 0) ? 'Enter the amount received.' : amt > target.balance + 0.005 ? `The amount is more than the balance of ${money(target.balance)}.` : '';

  const save = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError('');
    try {
      if (target.source === 'invoice') {
        await documentApi.addPayment(scope, target.id, { amount: amt, method: method as any, paidOn, reference: reference.trim() || undefined });
      } else if (target.source === 'machine-sale') {
        await machineSaleApi.addPayment(scope, target.id, { amount: amt, method: method as any, paidOn, reference: reference.trim() || undefined });
      } else {
        await jobCardApi.addPayment(scope, target.id, { amount: amt, method: method as any });
      }
      addAuditLog('Payment received from the Business Desk', 'Payments', `${money(amt)} by ${method} from ${target.customerName} on ${KIND[target.source].toLowerCase()} ${target.number}${remaining > 0 ? ` (${money(remaining)} still due)` : ' (settled)'}.`, {
        severity: 'info',
        entityType: KIND[target.source],
        entityId: target.id
      });
      showToast(remaining > 0 ? 'Part payment recorded' : 'Settled', `${money(amt)} from ${target.customerName} on ${target.number}.`, 'success');
      onDone(amt, target);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Settle the balance">
      <div className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Settle the balance</h2>
            <p className="break-words text-xs text-slate-500">
              {target.customerName} · {KIND[target.source]} {target.number}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30">
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Balance to collect</p>
            <p className="text-2xl font-black tabular-nums text-amber-900 dark:text-amber-100">{money(target.balance)}</p>
          </div>

          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Amount received ({cur})
            <input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} text-right font-mono text-base`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAmount(String(Math.round(target.balance * 100) / 100))} className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Full balance
            </button>
            <button type="button" onClick={() => setAmount(String(Math.round(target.balance / 2)))} className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Half
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Paid by
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
                {METHODS[target.source].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            {target.source !== 'job-card' && (
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Date
                <input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} className={FIELD} />
              </label>
            )}
          </div>
          {target.source !== 'job-card' && (
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Reference (optional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI reference, cheque number" className={FIELD} />
            </label>
          )}

          <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            {remaining > 0 ? <>After this, <b>{money(remaining)}</b> will still be due.</> : <>This clears the bill.</>}
          </p>

          {(problem || error) && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error || problem}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !!problem}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record {amt > 0 ? money(amt) : 'payment'}
          </button>
        </div>
      </div>
    </div>
  );
};
