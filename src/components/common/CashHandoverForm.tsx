import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Banknote, Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { cashBookApi, type BranchCashInHand } from '../../services/cashBookApi';

const INPUT =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';

// Cash taken from one branch to another (usually to the Head Office). Both cash books follow it.
export const CashHandoverForm: React.FC<{ onDone: () => void; onCancel?: () => void }> = ({ onDone, onCancel }) => {
  const { branches, settings, showToast, addAuditLog } = useERP();
  const { scope, isOwner, assignedBranchId } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const money = (n: number) => `${n < 0 ? '-' : ''}${cur}${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;

  const head = branches.find((b) => /head office/i.test(b.name)) || branches[0];
  const ownBranch = isOwner ? '' : assignedBranchId || '';
  const [from, setFrom] = useState(ownBranch || branches.find((b) => b.id !== head?.id)?.id || '');
  const [to, setTo] = useState(head?.id || '');
  const [amount, setAmount] = useState('');
  const [takenBy, setTakenBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inHand, setInHand] = useState<BranchCashInHand | null>(null);
  const [loadingHand, setLoadingHand] = useState(false);

  const fromId = isOwner ? from : ownBranch;
  const fromName = branches.find((b) => b.id === fromId)?.name || fromId;

  // keep the two branches different
  useEffect(() => {
    if (to === fromId) setTo(branches.find((b) => b.id !== fromId)?.id || '');
  }, [fromId, to, branches]);

  useEffect(() => {
    if (!fromId) return;
    let alive = true;
    setLoadingHand(true);
    cashBookApi
      .inHand(scope, fromId)
      .then((r) => alive && setInHand(r.find((x) => x.branchId === fromId) || r[0] || null))
      .catch(() => alive && setInHand(null))
      .finally(() => alive && setLoadingHand(false));
    return () => {
      alive = false;
    };
  }, [fromId, scope]);

  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const after = inHand ? Math.round((inHand.cashInHand - amt) * 100) / 100 : null;
  const problem = useMemo(() => {
    if (!fromId) return 'Choose the branch handing over the cash.';
    if (!to) return 'Choose the branch receiving the cash.';
    if (to === fromId) return 'The two branches must be different.';
    if (!(amt > 0)) return 'Enter the amount handed over.';
    return '';
  }, [fromId, to, amt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || problem) return;
    setBusy(true);
    setError('');
    try {
      const r = await cashBookApi.createHandover(scope, { fromBranchId: fromId, toBranchId: to, amount: amt, receivedBy: takenBy.trim() || undefined, note: note.trim() || undefined });
      const toName = branches.find((b) => b.id === to)?.name || to;
      addAuditLog('Cash handover', 'Cash Book', `${money(amt)} handed over from ${fromName} to ${toName}${takenBy.trim() ? ` (taken by ${takenBy.trim()})` : ''}. Cash in hand at ${fromName} is now ${money(r.fromCashAfter)}.`, {
        severity: 'info',
        entityType: 'Cash handover',
        entityId: r.handover.id
      });
      showToast('Cash handed over', `${money(amt)} from ${fromName} to ${toName}. ${fromName} now has ${money(r.fromCashAfter)} in hand. ${toName} confirms when it arrives.`, 'success');
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not record the handover.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        <Banknote className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Use this when a person collects the cash from a branch to take it to another branch, usually the Head Office. The cash goes <b>out</b> of the giving branch's cash book now. It is added to the receiving branch's cash book when that branch confirms the cash arrived.
        </p>
      </div>

      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">From branch (hands over)</label>
          {isOwner ? (
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT}>
              <option value="">Choose a branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <div className={`${INPUT} bg-slate-50 font-semibold dark:bg-slate-800/60`}>{fromName || 'Your branch'}</div>
          )}
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-400 sm:mb-2.5 sm:block" />
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">To branch (receives)</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={INPUT}>
            {branches
              .filter((b) => b.id !== fromId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
        {loadingHand ? (
          <span className="inline-flex items-center gap-2 text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the cash in hand at {fromName || 'the branch'}
          </span>
        ) : inHand ? (
          <>
            <p className="text-slate-500">Cash in hand at {inHand.branchName} now (from the books)</p>
            <p className="text-xl font-black tabular-nums text-slate-900 dark:text-white">{money(inHand.cashInHand)}</p>
            {inHand.openDaysSinceClose > 3 && (
              <p className="mt-0.5 text-[11px] text-amber-600">The cash book was last closed {inHand.openDaysSinceClose >= 9999 ? 'never' : `${inHand.openDaysSinceClose} days ago`}, so this figure may be off.</p>
            )}
          </>
        ) : (
          <span className="text-slate-500">Choose the giving branch to see its cash in hand.</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Amount handed over ({cur}) *</label>
          <input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className={`${INPUT} text-right font-mono text-base`} />
          {inHand && amt > 0 && after !== null && (
            <p className={`mt-1 text-[11px] font-semibold ${after < 0 ? 'text-amber-600' : 'text-slate-500'}`}>
              {after < 0 ? `This is ${money(-after)} more than the books show in hand.` : `${inHand.branchName} will have ${money(after)} left in hand.`}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Taken by (person collecting)</label>
          <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder="Name of the person" className={INPUT} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: weekly cash, bank deposit" className={INPUT} />
      </div>

      {(problem && amount !== '') || error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error || problem}
        </div>
      ) : null}

      <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !!problem}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record handover{amt > 0 ? ` of ${money(amt)}` : ''}
        </button>
      </div>
    </form>
  );
};
