import React, { useState } from 'react';
import { FileSpreadsheet, Loader2, Plus, Trash2 } from 'lucide-react';
import type { ApiScope } from '../../services/apiClient';
import { EXPENSE_CATEGORIES, ledgerApi, type DateRange } from '../../services/ledgerApi';

// How the money was spent: cash, from the bank account, or by UPI (the account is stored as a bank transfer).
const SPENT_BY: { value: string; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Bank Transfer', label: 'Account' },
  { value: 'UPI', label: 'UPI' }
];
export const spentByLabel = (m: string) => SPENT_BY.find((o) => o.value === m)?.label || m;
import { downloadCSV } from '../../utils/csvExport';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  CardHeader,
  EmptyRow,
  ErrorBox,
  INPUT,
  LABEL,
  LoadingBox,
  OUT_TONE,
  TBODY,
  TD,
  TDR,
  TFOOT,
  TH,
  THEAD,
  THR,
  TROW,
  formatDate,
  todayIST,
  useAsync,
  useLedgerContext
} from './shared';

interface Props {
  range: DateRange;
  reloadKey: number;
  onChanged: () => void;
}

interface ClearProps {
  scope: ApiScope;
  branch: string | undefined;
  branchLabel: string;
  money: (n: number) => string;
  branchName: (id: string) => string;
  onClose: () => void;
  onDone: (deleted: number) => void;
}

// Owner clean-up: shows exactly what will go, makes the owner save a CSV copy first, then asks for a typed word.
const ClearExpensesDialog: React.FC<ClearProps> = ({ scope, branch, branchLabel, money, branchName, onClose, onDone }) => {
  const [found, setFound] = useState<{ count: number; total: number; first: string | null; last: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    let live = true;
    ledgerApi
      .clearExpenses(scope, branch)
      .then((r) => live && setFound(r))
      .catch((e: Error) => live && setErr(e.message || 'Could not check the expenses.'));
    return () => {
      live = false;
    };
  }, [scope, branch]);

  const backup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const all = await ledgerApi.expenses(scope, branch, { from: '2000-01-01', to: todayIST() });
      if (found && all.rows.length < found.count) {
        setErr(`The backup holds only the latest ${all.rows.length} of ${found.count} entries, so deleting is blocked. Tell me and I will arrange a full backup.`);
        return;
      }
      downloadCSV(
        `Expenses_BACKUP_${branch || 'all'}_${todayIST()}.csv`,
        ['Date', 'Branch', 'Category', 'Vendor', 'Description', 'Spent by', 'Amount', 'Recorded by'],
        all.rows.map((r) => [r.date, branchName(r.branchId), r.category, r.vendor, r.description, spentByLabel(r.method), r.amount, r.createdBy])
      );
      setSaved(true);
    } catch (e: any) {
      setErr(e.message || 'Could not prepare the backup.');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await ledgerApi.clearExpenses(scope, branch, 'DELETE');
      onDone(r.deleted);
    } catch (e: any) {
      setErr(e.message || 'Could not delete the expenses.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Delete all expenses">
      <div className="max-h-[100dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete all expenses</h3>
        {!found && !err && (
          <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking what is there...</p>
        )}
        {found && found.count === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">There are no expenses for {branchLabel}. Nothing to delete.</p>}
        {found && found.count > 0 && (
          <>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <p className="font-bold">{found.count} expense entries for {branchLabel}, {money(found.total)} in all</p>
              <p className="mt-0.5">Dated {found.first} to {found.last}. This cannot be undone.</p>
              <p className="mt-1.5">Cash handovers, salaries, salary advances and supplier payments are not touched. The cash in hand goes up by the cash expenses removed.</p>
            </div>
            <button type="button" onClick={backup} disabled={busy} className={`${BTN_GHOST} w-full justify-center`}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>{saved ? 'Backup saved (download again)' : '1. Download a backup (CSV)'}</span>
            </button>
            <div>
              <label className={LABEL} htmlFor="clr-confirm">2. Type DELETE to confirm</label>
              <input id="clr-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!saved} autoComplete="off" className={INPUT} placeholder="DELETE" />
            </div>
          </>
        )}
        {err && <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>Cancel</button>
          {found && found.count > 0 && (
            <button
              type="button"
              onClick={run}
              disabled={busy || !saved || typed !== 'DELETE'}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span>Delete {found.count} expenses</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const ExpensesTab: React.FC<Props> = ({ range, reloadKey, onChanged }) => {
  const { scope, queryBranch, effectiveBranch, writeBranchId, money, branchName, actor, showToast, addAuditLog, isOwner } = useLedgerContext();
  const [clearOpen, setClearOpen] = useState(false);
  const showBranch = effectiveBranch === 'all';

  const [filter, setFilter] = useState('all');
  const [date, setDate] = useState(todayIST);
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('Cash');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => ledgerApi.expenses(scope, queryBranch, range, filter),
    [scope, queryBranch, range.from, range.to, filter, reloadKey]
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeBranchId) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Invalid Amount', 'Enter an amount greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      await ledgerApi.addExpense(scope, {
        branchId: writeBranchId,
        date,
        category,
        vendor: vendor.trim(),
        amount: amt,
        method,
        description: description.trim(),
        createdBy: actor
      });
      addAuditLog('Added Expense', 'Finance', `${category} expense of ${money(amt)} on ${date} (${branchName(writeBranchId)})`);
      showToast('Expense Recorded', `${money(amt)} recorded under ${category}.`, 'success');
      setAmount('');
      setVendor('');
      setDescription('');
      onChanged();
    } catch (err: any) {
      showToast('Could Not Record Expense', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    setBusy(true);
    try {
      await ledgerApi.deleteExpense(scope, id);
      addAuditLog('Deleted Expense', 'Finance', `Removed expense ${label}`, { severity: 'warning' });
      showToast('Expense Deleted', 'The expense was removed from the books.', 'info');
      setConfirmId(null);
      onChanged();
    } catch (err: any) {
      showToast('Could Not Delete', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    downloadCSV(
      `Expenses_${effectiveBranch}_${range.from}_to_${range.to}.csv`,
      ['Date', 'Branch', 'Category', 'Vendor', 'Description', 'Spent by', 'Amount', 'Recorded by'],
      data.rows.map((r) => [r.date, branchName(r.branchId), r.category, r.vendor, r.description, spentByLabel(r.method), r.amount, r.createdBy])
    );
  };

  const cols = showBranch ? 8 : 7;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className={`${CARD} p-5`}>
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Add expense</h3>
        {!writeBranchId && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
            Select a single branch from the branch switcher in the header to record an expense.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className={LABEL} htmlFor="lg-date">Date</label>
            <input id="lg-date" type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={!writeBranchId} className={`${INPUT} font-mono`} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lg-cat">Category</label>
            <select id="lg-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!writeBranchId} className={INPUT}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="lg-vendor">Vendor</label>
            <input id="lg-vendor" type="text" maxLength={80} value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={!writeBranchId} placeholder="Paid to" className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lg-amount">Amount</label>
            <input id="lg-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!writeBranchId} placeholder="0.00" className={`${INPUT} text-right font-mono`} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lg-method">Spent by</label>
            <select id="lg-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={!writeBranchId} className={INPUT}>
              {SPENT_BY.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="lg-desc">Description</label>
            <input id="lg-desc" type="text" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!writeBranchId} placeholder="Optional note" className={INPUT} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            Posts a Money out entry to the cash book for {writeBranchId ? branchName(writeBranchId) : 'the selected branch'}. A closed day must be reopened first.
          </p>
          <button type="submit" disabled={busy || !writeBranchId || !amount} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span>Add expense</span>
          </button>
        </div>
      </form>

      {error && <ErrorBox title="Could not load expenses" message={error} onRetry={reload} />}

      {clearOpen && (
        <ClearExpensesDialog
          scope={scope}
          branch={queryBranch}
          branchLabel={effectiveBranch === 'all' ? 'all branches' : branchName(effectiveBranch)}
          money={money}
          branchName={branchName}
          onClose={() => setClearOpen(false)}
          onDone={(n) => {
            addAuditLog('Deleted All Expenses', 'Finance', `${n} expense entries removed (${effectiveBranch === 'all' ? 'all branches' : branchName(effectiveBranch)})`, { severity: 'critical' });
            showToast('Expenses Deleted', `${n} expense entries were removed from the books.`, 'info');
            setClearOpen(false);
            onChanged();
          }}
        />
      )}

      <div className={`${CARD} overflow-hidden`}>
        <CardHeader title="Expenses" hint="Expense entries from the cash book for the selected period.">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${INPUT} w-auto`} aria-label="Filter by category">
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="button" onClick={exportCsv} disabled={!data || data.rows.length === 0} className={BTN_GHOST}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          {isOwner && (
            <button type="button" onClick={() => setClearOpen(true)} className={`${BTN_GHOST} !border-rose-200 !text-rose-600 dark:!border-rose-500/30 dark:!text-rose-400`}>
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete all expenses</span>
            </button>
          )}
        </CardHeader>

        {data && data.byCategory.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            {data.byCategory.map((c) => (
              <span key={c.category} className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {c.category} <span className="ml-1 font-mono font-bold text-slate-900 dark:text-white">{money(c.amount)}</span>
              </span>
            ))}
          </div>
        )}

        {loading && !data ? (
          <LoadingBox label="Loading expenses..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Date</th>
                  {showBranch && <th className={TH}>Branch</th>}
                  <th className={TH}>Category</th>
                  <th className={TH}>Vendor</th>
                  <th className={TH}>Description</th>
                  <th className={TH}>Spent by</th>
                  <th className={THR}>Amount</th>
                  <th className={THR} />
                </tr>
              </thead>
              <tbody className={TBODY}>
                {!data || data.rows.length === 0 ? (
                  <EmptyRow cols={cols} text="No expenses recorded for this period." />
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id} className={TROW}>
                      <td className={`${TD} whitespace-nowrap font-mono`}>{formatDate(r.date)}</td>
                      {showBranch && <td className={`${TD} whitespace-nowrap`}>{branchName(r.branchId)}</td>}
                      <td className={`${TD} whitespace-nowrap font-medium text-slate-900 dark:text-white`}>{r.category}</td>
                      <td className={`${TD} max-w-[12rem] truncate`} title={r.vendor}>{r.vendor || '-'}</td>
                      <td className={`${TD} max-w-[18rem] truncate`} title={r.description}>{r.description || '-'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{spentByLabel(r.method)}</td>
                      <td className={`${TDR} font-bold ${OUT_TONE}`}>{money(r.amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {r.deletable &&
                          (confirmId === r.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => remove(r.id, `${r.category} ${money(r.amount)} on ${r.date}`)}
                                className="cursor-pointer rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmId(null)}
                                className="cursor-pointer rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmId(r.id)}
                              className="cursor-pointer rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-rose-950"
                              title="Delete expense"
                              aria-label="Delete expense"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {data && data.rows.length > 0 && (
                <tfoot className={TFOOT}>
                  <tr>
                    <td className={TH} colSpan={showBranch ? 6 : 5}>
                      Total ({data.rows.length} expenses)
                    </td>
                    <td className={`${THR} font-mono`}>{money(data.total)}</td>
                    <td className={THR} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
