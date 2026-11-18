import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { deskApi } from '../../services/deskApi';
import { saveFirestoreDoc } from '../../lib/firestoreService';
import type { Supplier } from '../../types/erp';

const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];
const FIELD = 'mt-1 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

// Records a payment to a supplier. A cash payment also goes out of the chosen branch's cash book, so cash in hand comes down.
export const PaySupplierDialog: React.FC<{ supplier: Supplier | null; cur: string; onClose: () => void; onDone: () => void }> = ({ supplier, cur, onClose, onDone }) => {
  const { scope } = useApiScope();
  const { branches, selectedBranchId, showToast, addAuditLog } = useERP();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [branchId, setBranchId] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supplier) return;
    setAmount(String(Math.round(supplier.outstandingPayable * 100) / 100));
    setMethod('Cash');
    setBranchId(selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : branches.find((b) => b.isHeadOffice)?.id || branches[0]?.id || '');
    setReference('');
    setError('');
    setBusy(false);
  }, [supplier, selectedBranchId, branches]);

  if (!supplier) return null;
  const name = supplier.companyName || supplier.name;
  const balance = supplier.outstandingPayable;
  const money = (n: number) => `${cur}${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((balance - amt) * 100) / 100);
  const problem = !(amt > 0) ? 'Enter the amount paid.' : amt > balance + 0.005 ? `The amount is more than the balance of ${money(balance)}.` : method === 'Cash' && !branchId ? 'Choose the branch the cash was paid from.' : '';

  const save = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError('');
    try {
      const p = await deskApi.paySupplier(scope, { supplierId: supplier.id, supplierName: name, amount: amt, method, branchId: branchId || undefined, reference: reference.trim() || undefined });
      // the supplier list on screen is kept in the shared store, so its balance is brought down there too
      await saveFirestoreDoc('suppliers', supplier.id, { ...supplier, outstandingPayable: Math.max(0, Math.round((balance - amt) * 100) / 100) });
      addAuditLog('Paid supplier', 'Purchases', `${money(amt)} by ${method} paid to ${name} (${p.paymentNo})${remaining > 0 ? `; ${money(remaining)} still payable` : '; cleared'}.`, { severity: 'info', entityType: 'Supplier', entityId: supplier.id });
      showToast(remaining > 0 ? 'Part payment recorded' : 'Supplier cleared', `${money(amt)} paid to ${name}.`, 'success');
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Pay the supplier">
      <div className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Pay the supplier</h2>
            <p className="break-words text-xs text-slate-500">{name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/30">
            <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">You owe</p>
            <p className="text-2xl font-black tabular-nums text-rose-900 dark:text-rose-100">{money(balance)}</p>
          </div>

          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Amount paid ({cur})
            <input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} text-right font-mono text-base`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAmount(String(Math.round(balance * 100) / 100))} className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Full balance
            </button>
            <button type="button" onClick={() => setAmount(String(Math.round(balance / 2)))} className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Half
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Paid by
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {method === 'Cash' ? 'Cash paid from' : 'Branch (optional)'}
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={FIELD}>
                {method !== 'Cash' && <option value="">Not branch specific</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Reference (optional)
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI reference, cheque number" className={FIELD} />
          </label>

          <p className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>
              {remaining > 0 ? <>After this, you still owe <b>{money(remaining)}</b>.</> : <>This clears what you owe this supplier.</>}
              {method === 'Cash' && <> The cash also goes out of that branch's cash book today.</>}
            </span>
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
          <button type="button" onClick={save} disabled={busy || !!problem} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record {amt > 0 ? money(amt) : 'payment'}
          </button>
        </div>
      </div>
    </div>
  );
};
