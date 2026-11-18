import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, Clock, Loader2, Trash2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { cashBookApi, type CashHandover } from '../../services/cashBookApi';
import { CashHandoverForm } from '../common/CashHandoverForm';
import { Good, Hero, Note, Panel, Stepper, TabState, Tip, full, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

// How much cash each branch is holding, and the cash that has been handed from one branch to another.
export const CashInHandTab: React.FC = () => {
  const { settings, selectedBranchId, showToast, addAuditLog, setCurrentView } = useERP();
  const { scope, branchParam, isOwner, assignedBranchId } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const hand = useTabData(() => cashBookApi.inHand(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const list = useTabData(() => cashBookApi.handovers(scope, branchParam, 80), [scope, branchParam, selectedBranchId]);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<CashHandover | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => {
    hand.reload();
    list.reload();
  };
  const [confirming, setConfirming] = useState('');

  const confirm = async (h: CashHandover) => {
    if (confirming) return;
    setConfirming(h.id);
    setError('');
    try {
      await cashBookApi.confirmHandover(scope, h.id);
      addAuditLog('Confirmed cash handover', 'Cash Book', `${h.handoverNo}: ${full(h.amount, cur)} from ${h.fromBranchName} was received at ${h.toBranchName}.`, { severity: 'info', entityType: 'Cash handover', entityId: h.id });
      showToast('Cash received', `${full(h.amount, cur)} is now in the ${h.toBranchName} cash book.`, 'success');
      refresh();
    } catch (e: any) {
      showToast('Could not confirm', e?.message || 'Try again.', 'error');
    } finally {
      setConfirming('');
    }
  };
  const canConfirm = (h: CashHandover) => h.status === 'Pending' && (isOwner || h.toBranchId === assignedBranchId);

  const cancel = async () => {
    if (!cancelling || busy) return;
    setBusy(true);
    setError('');
    try {
      await cashBookApi.cancelHandover(scope, cancelling.id);
      addAuditLog('Cancelled cash handover', 'Cash Book', `${cancelling.handoverNo}: ${full(cancelling.amount, cur)} from ${cancelling.fromBranchName} to ${cancelling.toBranchName} was cancelled.`, { severity: 'warning', entityType: 'Cash handover', entityId: cancelling.id });
      showToast('Handover cancelled', `${cancelling.handoverNo} was removed from both cash books.`, 'success');
      setCancelling(null);
      refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not cancel the handover.');
    } finally {
      setBusy(false);
    }
  };

  const steps: Step[] = [];
  const rows = [...(hand.data || [])].sort((a, b) => Number(b.isHeadOffice) - Number(a.isHeadOffice) || b.cashInHand - a.cashInHand);
  if (hand.data) {
    const total = rows.reduce((s, r) => s + r.cashInHand, 0);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.cashInHand)));
    steps.push({
      id: 'inhand',
      label: 'Cash in hand',
      title: 'How much cash each branch holds',
      hint: 'The last counted cash, plus cash sales and collections since, minus what was handed over.',
      icon: Banknote,
      content: (
        <div className="space-y-4">
          <Hero tone="emerald" label={rows.length > 1 ? 'Cash in hand, all branches' : 'Cash in hand'} value={full(total, cur)} sub={`${rows.length} branch${rows.length === 1 ? '' : 'es'}`}>
            <button type="button" onClick={() => setOpen(true)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50">
              <ArrowRight className="h-3.5 w-3.5" /> Record a cash handover
            </button>
          </Hero>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.branchId} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-white">{r.branchName}</p>
                  {r.isHeadOffice && <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Head Office</span>}
                </div>
                <p className={`mt-1 text-3xl font-black tabular-nums ${r.cashInHand < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>{full(r.cashInHand, cur)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-full rounded-full ${r.cashInHand < 0 ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-500 to-teal-400'}`} style={{ width: `${Math.max(3, (Math.abs(r.cashInHand) / max) * 100)}%` }} />
                </div>
                <dl className="mt-3 space-y-1 text-[11px] text-slate-500">
                  <div className="flex justify-between gap-2">
                    <dt>Counted {r.lastClosedDate ? `on ${shortDate(r.lastClosedDate)}` : '(never closed)'}</dt>
                    <dd className="font-semibold text-slate-700 dark:text-slate-300">{full(r.lastCounted, cur)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Since then (sales, collections, entries)</dt>
                    <dd className={`font-semibold ${r.movementSince < 0 ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>
                      {r.movementSince >= 0 ? '+' : '-'}
                      {full(Math.abs(r.movementSince), cur)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Handed over this month</dt>
                    <dd className="font-semibold text-slate-700 dark:text-slate-300">{full(r.handedOverThisMonth, cur)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Received this month</dt>
                    <dd className="font-semibold text-slate-700 dark:text-slate-300">{full(r.receivedThisMonth, cur)}</dd>
                  </div>
                </dl>
                {r.onTheWayIn > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky-50 p-2 text-[11px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                    <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                    {full(r.onTheWayIn, cur)} is on its way here. It is added when this branch confirms it arrived (see Handovers).
                  </p>
                )}
                {r.onTheWayOut > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                    {full(r.onTheWayOut, cur)} handed over from here, not yet confirmed as received.
                  </p>
                )}
                {r.openDaysSinceClose > 3 && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {r.openDaysSinceClose >= 9999 ? 'The cash book has never been closed here, so this figure counts everything recorded.' : `Not closed for ${r.openDaysSinceClose} days. Close the day to make this exact.`}
                  </p>
                )}
              </div>
            ))}
          </div>
          <Tip title="How it is worked out">
            Cash in hand = the cash counted when the day was last closed + cash sales, machine sale payments, service collections and cash entries since, with every handover taken off the giving branch and added to the receiving one.{' '}
            <button type="button" onClick={() => setCurrentView('cash-book')} className="cursor-pointer font-bold underline">
              Open the Cash Book
            </button>
          </Tip>
        </div>
      )
    });
  }

  if (list.data) {
    steps.push({
      id: 'handovers',
      label: 'Handovers',
      title: 'Cash that was handed over',
      hint: 'Every handover from one branch to another, newest first.',
      icon: ArrowRight,
      content:
        list.data.length === 0 ? (
          <div className="space-y-3">
            <Note>No cash has been handed over yet. When a person collects cash from a branch, record it with Cash Handover in Quick Add, or here.</Note>
            <button type="button" onClick={() => setOpen(true)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Record a cash handover
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button type="button" onClick={() => setOpen(true)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Record a cash handover
            </button>
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.data.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                        {h.fromBranchName} <ArrowRight className="h-3.5 w-3.5 text-slate-400" /> {h.toBranchName}
                      </p>
                      <p className="mt-0.5">
                        {h.status === 'Pending' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-extrabold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                            <Clock className="h-3 w-3" /> On its way, waiting for {h.toBranchName} to confirm
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> Received{h.receivedOn ? ` ${shortDate(h.receivedOn)}` : ''}{h.confirmedBy ? ` · confirmed by ${h.confirmedBy}` : ''}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        <span className="font-mono">{h.handoverNo}</span> · {shortDate(h.handoverDate)}
                        {h.receivedBy ? ` · taken by ${h.receivedBy}` : ''}
                        {h.createdBy ? ` · entered by ${h.createdBy}` : ''}
                      </p>
                      {h.note && <p className="text-[11px] italic text-slate-400">{h.note}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{full(h.amount, cur)}</p>
                      {canConfirm(h) && (
                        <button type="button" onClick={() => confirm(h)} disabled={!!confirming} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                          {confirming === h.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Cash received
                        </button>
                      )}
                      {isOwner && (
                        <button type="button" onClick={() => { setError(''); setCancelling(h); }} aria-label="Cancel this handover" title="Cancel this handover" className="cursor-pointer rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )
    });
  }

  return (
    <>
      <TabState loading={hand.loading && list.loading} error={hand.error && list.error ? hand.error : ''} hasData={steps.length > 0} reload={refresh}>
        {steps.length > 0 ? <Stepper steps={steps} resetKey={`hand-${scope.branchId}-${branchParam}`} /> : <Good>Nothing to show yet</Good>}
      </TabState>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Cash handover">
          <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Cash handover</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <CashHandoverForm
                onCancel={() => setOpen(false)}
                onDone={() => {
                  setOpen(false);
                  refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Cancel {cancelling.handoverNo}?</h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {full(cancelling.amount, cur)} from {cancelling.fromBranchName} to {cancelling.toBranchName} is removed from the cash book{cancelling.status === 'Received' ? 's of both branches' : ''}. The cash goes back to {cancelling.fromBranchName}{cancelling.status === 'Received' ? ` and comes off ${cancelling.toBranchName}` : ''}.
            </p>
            {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelling(null)} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                Keep it
              </button>
              <button type="button" onClick={cancel} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancel handover
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
