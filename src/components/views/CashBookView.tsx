import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Wrench
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import {
  cashBookApi,
  isAllBranchesSummary,
  type AllBranchesSummary,
  type CashClosing,
  type CashEntryType,
  type DaySummary
} from '../../services/cashBookApi';
import { downloadCSV } from '../../utils/csvExport';

const CATEGORIES = [
  'Customer collection',
  'Expense',
  'Bank deposit',
  'Bank withdrawal',
  'Owner/Partner',
  'Salary advance',
  'Other'
];
const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const cardClass =
  'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-slate-400';
const primaryBtn =
  'flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600';
const thClass = 'py-3 px-4';

export const CashBookView: React.FC = () => {
  const { currentRole, selectedBranchId, branches, settings, showToast, addAuditLog } = useERP();
  const { userProfile, assignedBranchId } = useAuth();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const currency = settings.currencySymbol || '₹';
  const branchKey = isOwner ? selectedBranchId : assignedBranchId;
  const scope = useMemo(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  const actor = userProfile?.displayName || currentRole;

  const [date, setDate] = useState(todayIST);
  const [summary, setSummary] = useState<DaySummary | AllBranchesSummary | null>(null);
  const [closings, setClosings] = useState<CashClosing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const [busy, setBusy] = useState(false);

  const [entryType, setEntryType] = useState<CashEntryType>('in');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [description, setDescription] = useState('');

  const requestId = useRef(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const fmt = useCallback(
    (n: number) =>
      `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency]
  );
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name || id, [branches]);

  useEffect(() => {
    setCounted('');
    setNotes('');
  }, [date, branchKey]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    Promise.all([
      cashBookApi.getSummary(scope, branchKey, date),
      cashBookApi.listClosings(scope, branchKey, 30)
    ])
      .then(([s, c]) => {
        if (id !== requestId.current) return;
        setSummary(s);
        setClosings(Array.isArray(c) ? c : []);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setSummary(null);
        setError(e.message || 'Failed to load the cash book.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [scope, branchKey, date, reloadTick]);

  const single = summary && !isAllBranchesSummary(summary) ? summary : null;
  const all = summary && isAllBranchesSummary(summary) ? summary : null;
  const writeBranchId = branchKey !== 'all' ? branchKey : null;

  const countedNum = counted.trim() === '' ? null : Number(counted);
  const countedValid = countedNum !== null && Number.isFinite(countedNum) && countedNum >= 0;
  const liveVariance = single && countedValid ? Math.round((countedNum! - single.expectedCash) * 100) / 100 : null;

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeBranchId || !single || single.isClosed) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Invalid Amount', 'Enter an amount greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      await cashBookApi.addEntry(scope, {
        branchId: writeBranchId,
        date,
        type: entryType,
        category,
        amount: amt,
        method,
        description: description.trim() || undefined,
        createdBy: actor
      });
      addAuditLog('Added Cash Entry', 'Cash Book', `${entryType === 'in' ? 'Cash in' : 'Cash out'} ${fmt(amt)} (${category}) on ${date}`);
      showToast('Entry Added', `${fmt(amt)} recorded as ${entryType === 'in' ? 'money in' : 'money out'}.`, 'success');
      setAmount('');
      setDescription('');
      reload();
    } catch (err: any) {
      showToast('Could Not Add Entry', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntry = async (id: string, label: string) => {
    setBusy(true);
    try {
      await cashBookApi.deleteEntry(scope, id);
      addAuditLog('Deleted Cash Entry', 'Cash Book', `Removed ${label} on ${date}`);
      showToast('Entry Deleted', 'The cash entry was removed.', 'info');
      reload();
    } catch (err: any) {
      showToast('Could Not Delete', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!writeBranchId || !confirm) return;
    setBusy(true);
    try {
      if (confirm === 'close') {
        if (!countedValid) throw new Error('Enter the counted cash first.');
        await cashBookApi.closeDay(scope, {
          branchId: writeBranchId,
          date,
          countedCash: countedNum!,
          notes: notes.trim() || undefined,
          closedBy: actor
        });
        addAuditLog('Closed Cash Book', 'Cash Book', `${branchName(writeBranchId)} closed ${date}, counted ${fmt(countedNum!)}`, {
          severity: liveVariance !== null && liveVariance !== 0 ? 'warning' : 'success'
        });
        showToast('Day Closed', `${branchName(writeBranchId)} cash book for ${date} is closed.`, 'success');
      } else {
        await cashBookApi.reopenDay(scope, { branchId: writeBranchId, date });
        addAuditLog('Reopened Cash Book', 'Cash Book', `${branchName(writeBranchId)} reopened ${date}`, { severity: 'warning' });
        showToast('Day Reopened', `${date} can be edited again.`, 'warning');
      }
      setConfirm(null);
      reload();
    } catch (err: any) {
      showToast(confirm === 'close' ? 'Could Not Close Day' : 'Could Not Reopen', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportHistory = () => {
    downloadCSV(
      `Cash_Closings_${branchKey}_${todayIST()}.csv`,
      ['Date', 'Branch', 'Opening', 'Cash Sales', 'UPI Sales', 'Bank/Card Sales', 'Credit Sales', 'Service Collections', 'Manual In', 'Manual Out', 'Expected Cash', 'Counted Cash', 'Variance', 'Closed By', 'Closed At', 'Notes'],
      closings.map((c) => [
        c.businessDate,
        branchName(c.branchId),
        c.openingCash,
        c.cashSales,
        c.upiSales,
        c.bankCardSales,
        c.creditSales,
        c.serviceCollections,
        c.manualCashIn,
        c.manualCashOut,
        c.expectedCash,
        c.countedCash,
        c.variance,
        c.closedBy,
        c.closedAt,
        c.notes
      ])
    );
  };

  const varianceTone = (v: number) =>
    v === 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : Math.abs(v) <= 100
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';

  const statCard = (label: string, value: number, Icon: React.ElementType, sub?: string) => (
    <div className={`${cardClass} p-4`} key={label}>
      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-right font-mono text-lg font-bold text-slate-900 dark:text-white">{fmt(value)}</p>
      {sub && <p className="mt-0.5 text-right text-[10px] text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );

  const recRow = (label: string, value: number, sign: '' | '+' | '-' = '') => (
    <div className="flex items-center justify-between py-1.5 text-xs" key={label}>
      <span className="text-slate-600 dark:text-slate-400">
        {sign && <span className="mr-1.5 font-mono font-bold text-slate-400 dark:text-slate-500">{sign}</span>}
        {label}
      </span>
      <span className="font-mono text-slate-900 dark:text-white">{fmt(value)}</span>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Cash Book / Day-End Closing</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {branchKey === 'all' ? 'All branches' : branchName(branchKey)} &middot; collections, drawer reconciliation and closing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayIST()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={`${inputClass} w-auto font-mono`}
            aria-label="Business date"
          />
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">Could not load the cash book</p>
            <p>{error}</p>
          </div>
          <button type="button" onClick={reload} className="font-bold underline cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {loading && !summary && !error && (
        <div className={`${cardClass} flex items-center justify-center gap-2 p-12 text-xs text-slate-500 dark:text-slate-400`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading cash book...</span>
        </div>
      )}

      {all && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            Select a single branch from the branch switcher to record entries or close the day.
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {statCard('Cash sales', all.totals.cashSales, Banknote)}
            {statCard('UPI sales', all.totals.upiSales, Smartphone)}
            {statCard('Bank / Card', all.totals.bankCardSales, CreditCard)}
            {statCard('Credit sales', all.totals.creditSales, Landmark)}
            {statCard('Service collections', all.totals.serviceCollections, Wrench)}
          </div>

          <div className={`${cardClass} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className={thClass}>Branch</th>
                    <th className={`${thClass} text-right`}>Cash</th>
                    <th className={`${thClass} text-right`}>UPI</th>
                    <th className={`${thClass} text-right`}>Bank / Card</th>
                    <th className={`${thClass} text-right`}>Credit</th>
                    <th className={`${thClass} text-right`}>Service</th>
                    <th className={`${thClass} text-right`}>Expected cash</th>
                    <th className={`${thClass} text-right`}>Counted</th>
                    <th className={`${thClass} text-right`}>Variance</th>
                    <th className={`${thClass} text-center`}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {all.rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-slate-400 dark:text-slate-500">
                        No branches found.
                      </td>
                    </tr>
                  ) : (
                    all.rows.map((r) => (
                      <tr key={r.branchId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{r.branchName}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.cashSales)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.upiSales)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.bankCardSales)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.creditSales)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(r.serviceCollections)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">{fmt(r.expectedCash)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">
                          {r.countedCash === null ? '-' : fmt(r.countedCash)}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono font-bold ${r.variance === null ? 'text-slate-400' : varianceTone(r.variance)}`}>
                          {r.variance === null ? '-' : fmt(r.variance)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              r.isClosed
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {r.isClosed ? 'Closed' : 'Open'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white">
                  <tr>
                    <td className="py-3 px-4">Combined ({all.totals.closedBranches}/{all.totals.totalBranches} closed)</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.cashSales)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.upiSales)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.bankCardSales)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.creditSales)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.serviceCollections)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.expectedCash)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(all.totals.countedCash)}</td>
                    <td className={`py-3 px-4 text-right font-mono ${varianceTone(all.totals.variance)}`}>{fmt(all.totals.variance)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {single && (
        <>
          {single.isClosed && single.closing && (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">Day closed</p>
                  <p>
                    Closed by {single.closing.closedBy || 'unknown'} on {new Date(single.closing.closedAt).toLocaleString('en-IN')}. Counted{' '}
                    <span className="font-mono">{fmt(single.closing.countedCash)}</span>, variance{' '}
                    <span className="font-mono font-bold">{fmt(single.closing.variance)}</span>.
                    {single.closing.notes ? ` Notes: ${single.closing.notes}` : ''}
                  </p>
                </div>
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setConfirm('reopen')}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 font-bold text-emerald-800 hover:bg-emerald-100 cursor-pointer dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800"
                >
                  <LockOpen className="h-3.5 w-3.5" />
                  <span>Reopen</span>
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {statCard('Cash', single.cashSales, Banknote, 'sales')}
            {statCard('UPI', single.upiSales, Smartphone, 'sales')}
            {statCard('Bank / Card', single.bankCardSales, CreditCard, 'sales')}
            {statCard('Credit', single.creditSales, Landmark, `${single.salesCount} sales today`)}
            {statCard('Service collections', single.serviceCollections, Wrench, 'job cards, all methods')}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={`${cardClass} p-5`}>
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Cash drawer reconciliation</h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {recRow('Opening cash', single.openingCash)}
                {recRow('Cash sales', single.cashSales, '+')}
                {recRow('Service collections (cash)', single.serviceCash, '+')}
                {recRow('Manual cash in', single.manualCashIn, '+')}
                {recRow('Manual cash out', single.manualCashOut, '-')}
                <div className="flex items-center justify-between py-2.5 text-sm font-bold">
                  <span className="text-slate-900 dark:text-white">Expected cash</span>
                  <span className="font-mono text-slate-900 dark:text-white">{fmt(single.expectedCash)}</span>
                </div>
              </div>

              <div className="mt-3 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="counted-cash">
                    Counted cash
                  </label>
                  <input
                    id="counted-cash"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={single.isClosed && single.closing ? String(single.closing.countedCash) : counted}
                    onChange={(e) => setCounted(e.target.value)}
                    disabled={single.isClosed || !writeBranchId}
                    placeholder="0.00"
                    className={`${inputClass} text-right font-mono`}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Variance (counted - expected)</span>
                  {(() => {
                    const v = single.isClosed && single.closing ? single.closing.variance : liveVariance;
                    return v === null ? (
                      <span className="font-mono text-slate-400 dark:text-slate-500">-</span>
                    ) : (
                      <span className={`font-mono text-sm font-bold ${varianceTone(v)}`}>
                        {v > 0 ? '+' : ''}
                        {fmt(v)}
                      </span>
                    );
                  })()}
                </div>
                {!single.isClosed && (
                  <>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Closing notes (optional)"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setConfirm('close')}
                      disabled={!countedValid || busy || !writeBranchId}
                      className={`${primaryBtn} w-full`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Close day</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <form onSubmit={handleAddEntry} className={`${cardClass} p-5`}>
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Add cash book entry</h3>
              <div className="space-y-3">
                <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-bold dark:bg-slate-800">
                  {(['in', 'out'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={single.isClosed}
                      onClick={() => setEntryType(t)}
                      className={`rounded-md px-4 py-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed ${
                        entryType === t
                          ? 'bg-slate-800 text-white shadow-xs dark:bg-slate-600'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {t === 'in' ? 'Money in' : 'Money out'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400" htmlFor="cb-category">Category</label>
                    <select id="cb-category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={single.isClosed} className={inputClass}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400" htmlFor="cb-method">Method</label>
                    <select id="cb-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={single.isClosed} className={inputClass}>
                      {METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400" htmlFor="cb-amount">Amount</label>
                  <input
                    id="cb-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={single.isClosed}
                    placeholder="0.00"
                    className={`${inputClass} text-right font-mono`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400" htmlFor="cb-desc">Description</label>
                  <input
                    id="cb-desc"
                    type="text"
                    maxLength={300}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={single.isClosed}
                    placeholder="Optional note"
                    className={inputClass}
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Only Cash entries change the drawer. Other methods are recorded for reference.
                </p>
                <button type="submit" disabled={single.isClosed || busy || !writeBranchId || !amount} className={`${primaryBtn} w-full`}>
                  <Plus className="h-4 w-4" />
                  <span>Add entry</span>
                </button>
              </div>
            </form>
          </div>

          <div className={`${cardClass} overflow-hidden`}>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-bold text-slate-900 dark:border-slate-800 dark:text-white">
              Entries for {date}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Category</th>
                    <th className={thClass}>Method</th>
                    <th className={thClass}>Description</th>
                    <th className={thClass}>By</th>
                    <th className={`${thClass} text-right`}>Amount</th>
                    <th className={`${thClass} text-right`} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {single.entries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400 dark:text-slate-500">
                        No manual entries for this day.
                      </td>
                    </tr>
                  ) : (
                    single.entries.map((en) => (
                      <tr key={en.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              en.type === 'in'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {en.type === 'in' ? 'In' : 'Out'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">{en.category}</td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{en.method}</td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{en.description || '-'}</td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{en.createdBy || '-'}</td>
                        <td className={`py-3 px-4 text-right font-mono font-bold ${en.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {en.type === 'in' ? '+' : '-'}
                          {fmt(en.amount)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={single.isClosed || busy}
                            onClick={() => handleDeleteEntry(en.id, `${en.category} ${fmt(en.amount)}`)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-rose-950"
                            title={single.isClosed ? 'Day is closed' : 'Delete entry'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {(single || all) && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <span className="text-sm font-bold text-slate-900 dark:text-white">Recent closings</span>
            <button
              type="button"
              onClick={exportHistory}
              disabled={closings.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className={thClass}>Date</th>
                  {branchKey === 'all' && <th className={thClass}>Branch</th>}
                  <th className={`${thClass} text-right`}>Opening</th>
                  <th className={`${thClass} text-right`}>Expected</th>
                  <th className={`${thClass} text-right`}>Counted</th>
                  <th className={`${thClass} text-right`}>Variance</th>
                  <th className={thClass}>Closed by</th>
                  <th className={thClass}>Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {closings.length === 0 ? (
                  <tr>
                    <td colSpan={branchKey === 'all' ? 8 : 7} className="py-10 text-center text-slate-400 dark:text-slate-500">
                      No closings recorded yet.
                    </td>
                  </tr>
                ) : (
                  closings.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">{c.businessDate}</td>
                      {branchKey === 'all' && <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{branchName(c.branchId)}</td>}
                      <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(c.openingCash)}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(c.expectedCash)}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(c.countedCash)}</td>
                      <td className={`py-3 px-4 text-right font-mono font-bold ${varianceTone(c.variance)}`}>{fmt(c.variance)}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{c.closedBy || '-'}</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{c.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirm && single && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {confirm === 'close' ? `Close ${date}?` : `Reopen ${date}?`}
            </h3>
            {confirm === 'close' ? (
              <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex justify-between"><span>Expected</span><span className="font-mono">{fmt(single.expectedCash)}</span></div>
                <div className="flex justify-between"><span>Counted</span><span className="font-mono">{countedValid ? fmt(countedNum!) : '-'}</span></div>
                <div className="flex justify-between font-bold">
                  <span>Variance</span>
                  <span className={`font-mono ${liveVariance === null ? '' : varianceTone(liveVariance)}`}>{liveVariance === null ? '-' : fmt(liveVariance)}</span>
                </div>
                <p className="pt-2">Entries cannot be added or deleted after closing. Only an owner can reopen the day.</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                The closing snapshot will be removed and the day becomes editable again. Later days keep their own opening balance.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button type="button" onClick={handleConfirm} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{confirm === 'close' ? 'Confirm close' : 'Reopen day'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
