import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import {
  payrollApi,
  type AdvanceMethod,
  type PaymentMethod,
  type Payslip,
  type PayrollRunDetail,
  type PayrollRunListItem,
  type PayrollSummary,
  type RunTotals,
  type SalaryAdvance,
  type StaffOption
} from '../../services/payrollApi';
import { downloadCSV } from '../../utils/csvExport';

type Tab = 'run' | 'advances' | 'history';

const PAY_METHODS: PaymentMethod[] = ['Cash', 'UPI', 'Bank Transfer', 'Card'];
const ADVANCE_METHODS: AdvanceMethod[] = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const cardClass = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 sm:py-1.5 text-base sm:text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-slate-400';
const primaryBtn =
  'flex min-h-10 sm:min-h-0 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600';
const ghostBtn =
  'flex min-h-10 sm:min-h-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
const thClass = 'py-3 px-3';
const tdClass = 'py-2.5 px-3';
const theadClass =
  'border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400';
const labelClass = 'mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400';

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

const tabBtn = (active: boolean) =>
  `px-4 py-3 sm:py-2 whitespace-nowrap shrink-0 text-xs font-bold border-b-2 cursor-pointer ${
    active
      ? 'border-slate-800 text-slate-900 dark:border-white dark:text-white'
      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
  }`;

const Badge: React.FC<{ tone: 'green' | 'amber' | 'slate' | 'rose'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
  };
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${tones[tone]}`}>{children}</span>;
};

// Commits on blur or Enter; a failed save snaps back to the stored value.
const EditableAmount: React.FC<{
  value: number;
  disabled: boolean;
  label: string;
  fmt: (n: number) => string;
  onCommit: (n: number) => Promise<boolean>;
  className?: string;
}> = ({ value, disabled, label, fmt, onCommit, className = 'w-24' }) => {
  const show = (n: number) => (n === 0 ? '' : String(n));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);

  if (disabled) return <span className="font-mono text-slate-700 dark:text-slate-300">{fmt(value)}</span>;

  const commit = async () => {
    const n = text.trim() === '' ? 0 : Number(text);
    if (!Number.isFinite(n) || n < 0) {
      setText(show(value));
      return;
    }
    if (Math.round(n * 100) === Math.round(value * 100)) {
      setText(show(value));
      return;
    }
    const ok = await onCommit(n);
    if (!ok) setText(show(value));
  };

  return (
    <input
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      value={text}
      placeholder="0"
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(show(value));
      }}
      className={`${inputClass} ${className} text-right font-mono`}
    />
  );
};

interface SheetProps {
  slip: Payslip;
  runStatus: string;
  month: string;
  branchName: string;
  companyName: string;
  fmt: (n: number) => string;
}

// Document-style paper: stays white in both themes so the preview matches the printout.
const PayslipSheet: React.FC<SheetProps> = ({ slip, runStatus, month, branchName, companyName, fmt }) => {
  const daily = slip.payType === 'daily';
  const row = (label: string, value: string) => (
    <div className="flex justify-between border-b border-slate-200 py-1 print:border-slate-400">
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
  return (
    <div className="bg-white text-xs text-slate-900">
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p>{branchName}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold">Payslip</p>
          <p>{monthLabel(month)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1">
        <p><span className="font-bold">Employee:</span> {slip.staffName}</p>
        <p><span className="font-bold">Designation:</span> {slip.designation || '-'}</p>
        <p><span className="font-bold">Pay type:</span> {daily ? 'Daily wage' : 'Monthly salary'}</p>
        <p><span className="font-bold">Rate:</span> {fmt(slip.baseRate)} {daily ? 'per day' : 'per month'}</p>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4 sm:gap-8 print:gap-8">
        <div>
          <p className="mb-1 font-bold uppercase tracking-wide">Attendance</p>
          {row('Days in month', String(slip.daysInMonth))}
          {row('Present', fmtDays(slip.presentDays))}
          {row('Half days', fmtDays(slip.halfDays))}
          {row('Paid leave', fmtDays(slip.paidLeaveDays))}
          {row(daily ? 'Holiday / weekly off (unpaid)' : 'Holiday / weekly off', fmtDays(slip.holidayDays))}
          {row('Absent / unpaid leave', fmtDays(slip.unpaidDays))}
          {row('Unmarked', fmtDays(slip.unmarkedDays))}
          {row('Payable days', fmtDays(slip.payableDays))}
          {row('Overtime hours', fmtDays(slip.overtimeHours))}
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1 font-bold uppercase tracking-wide">Earnings</p>
            {row('Basic pay', fmt(slip.basicPay))}
            {row('Overtime', fmt(slip.overtimePay))}
            {row('Bonus', fmt(slip.bonus))}
            <div className="flex justify-between py-1 font-bold">
              <span>Gross earnings</span>
              <span className="font-mono">{fmt(slip.grossPay)}</span>
            </div>
          </div>
          <div>
            <p className="mb-1 font-bold uppercase tracking-wide">Deductions</p>
            {row('Other deductions', fmt(slip.otherDeductions))}
            {row('Advance recovery', fmt(slip.advanceRecovered))}
            <div className="flex justify-between py-1 font-bold">
              <span>Total deductions</span>
              <span className="font-mono">{fmt(slip.otherDeductions + slip.advanceRecovered)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-2 border-slate-900 px-4 py-3">
        <span className="text-sm font-bold uppercase tracking-wide">Net pay</span>
        <span className="font-mono text-xl font-bold">{fmt(slip.netPay)}</span>
      </div>

      <p className="mt-3">
        <span className="font-bold">Status:</span>{' '}
        {runStatus !== 'Finalized'
          ? 'Draft - not final'
          : slip.status === 'Paid'
            ? `Paid on ${slip.paidOn || '-'} by ${slip.paymentMethod || '-'}`
            : 'Unpaid'}
      </p>
      {slip.notes && <p className="mt-1"><span className="font-bold">Notes:</span> {slip.notes}</p>}

      <div className="mt-12 flex justify-between">
        <div className="w-40 border-t border-slate-900 pt-1 text-center">Employee signature</div>
        <div className="w-40 border-t border-slate-900 pt-1 text-center">Authorised signatory</div>
      </div>
    </div>
  );
};

export const PayrollView: React.FC = () => {
  const { currentRole, selectedBranchId, branches, settings, showToast, addAuditLog } = useERP();
  const { userProfile, assignedBranchId } = useAuth();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const canUse = isOwner || currentRole === 'Accountant';
  const currency = settings.currencySymbol || '₹';
  const companyName = settings.companyName || 'Company';
  // Payroll is per branch, so owners pick the branch on this page instead of relying on "All branches".
  const [pageBranch, setPageBranch] = useState<string>(selectedBranchId !== 'all' ? selectedBranchId : 'branch-1');
  useEffect(() => {
    if (selectedBranchId !== 'all') setPageBranch(selectedBranchId);
  }, [selectedBranchId]);
  const branchKey = isOwner ? pageBranch : assignedBranchId;
  const scope = useMemo(
    () => ({
      role: currentRole,
      branchId: branchKey
    }),
    [currentRole, branchKey]
  );
  const actor = userProfile?.displayName || currentRole;

  const [tab, setTab] = useState<Tab>('run');
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTick, setDetailTick] = useState(0);

  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [history, setHistory] = useState<PayrollRunListItem[]>([]);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaTick, setMetaTick] = useState(0);

  const [advances, setAdvances] = useState<SalaryAdvance[]>([]);
  const [advLoading, setAdvLoading] = useState(false);
  const [advError, setAdvError] = useState<string | null>(null);
  const [advStatusFilter, setAdvStatusFilter] = useState('');
  const [advStaffFilter, setAdvStaffFilter] = useState('');
  const [roster, setRoster] = useState<StaffOption[]>([]);
  const [rosterFailed, setRosterFailed] = useState(false);

  const [advStaff, setAdvStaff] = useState('');
  const [advAmount, setAdvAmount] = useState('');
  const [advMethod, setAdvMethod] = useState<AdvanceMethod>('Cash');
  const [advReason, setAdvReason] = useState('');
  const [advDate, setAdvDate] = useState(todayIST);

  const [busy, setBusy] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [payMethods, setPayMethods] = useState<Record<string, PaymentMethod>>({});
  const [printSlip, setPrintSlip] = useState<Payslip | null>(null);

  const detailReq = useRef(0);
  const metaReq = useRef(0);
  const advReq = useRef(0);

  const reloadDetail = useCallback(() => setDetailTick((t) => t + 1), []);
  const bumpMeta = useCallback(() => setMetaTick((t) => t + 1), []);

  const fmt = useCallback(
    (n: number) => `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency]
  );
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name || id, [branches]);

  useEffect(() => {
    setOpenRunId(null);
    setAdvStaff('');
    setAdvStaffFilter('');
  }, [branchKey]);

  useEffect(() => {
    if (!canUse) return;
    const id = ++detailReq.current;
    setLoading(true);
    setError(null);
    (async () => {
      let runId = openRunId;
      if (!runId && branchKey !== 'all') {
        const runs = await payrollApi.listRuns(scope, branchKey, month);
        runId = runs[0]?.id ?? null;
      }
      return runId ? payrollApi.getRun(scope, runId) : null;
    })()
      .then((d) => {
        if (id === detailReq.current) setDetail(d);
      })
      .catch((e: Error) => {
        if (id !== detailReq.current) return;
        setDetail(null);
        setError(e.message || 'Failed to load payroll.');
      })
      .finally(() => {
        if (id === detailReq.current) setLoading(false);
      });
  }, [canUse, scope, branchKey, month, openRunId, detailTick]);

  useEffect(() => {
    if (!canUse) return;
    const id = ++metaReq.current;
    setMetaError(null);
    Promise.all([payrollApi.getSummary(scope, branchKey, month), payrollApi.listRuns(scope, branchKey)])
      .then(([s, h]) => {
        if (id !== metaReq.current) return;
        setSummary(s);
        setHistory(Array.isArray(h) ? h : []);
      })
      .catch((e: Error) => {
        if (id === metaReq.current) setMetaError(e.message || 'Failed to load payroll summary.');
      });
  }, [canUse, scope, branchKey, month, metaTick]);

  useEffect(() => {
    if (!canUse || tab !== 'advances') return;
    const id = ++advReq.current;
    setAdvLoading(true);
    setAdvError(null);
    payrollApi
      .listAdvances(scope, branchKey, { status: advStatusFilter || undefined, staffId: advStaffFilter || undefined })
      .then((rows) => {
        if (id === advReq.current) setAdvances(Array.isArray(rows) ? rows : []);
      })
      .catch((e: Error) => {
        if (id !== advReq.current) return;
        setAdvances([]);
        setAdvError(e.message || 'Failed to load advances.');
      })
      .finally(() => {
        if (id === advReq.current) setAdvLoading(false);
      });
  }, [canUse, tab, scope, branchKey, advStatusFilter, advStaffFilter, metaTick]);

  useEffect(() => {
    if (!canUse || tab !== 'advances' || branchKey === 'all') {
      setRoster([]);
      setRosterFailed(false);
      return;
    }
    let live = true;
    payrollApi
      .listStaff(scope, branchKey)
      .then((list) => {
        if (!live) return;
        setRoster(list);
        setRosterFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setRoster([]);
        setRosterFailed(true);
      });
    return () => {
      live = false;
    };
  }, [canUse, tab, scope, branchKey]);

  const staffOptions = useMemo<StaffOption[]>(() => {
    if (roster.length > 0) return roster;
    if (!detail || detail.run.branchId !== branchKey) return [];
    return detail.payslips.map((p) => ({ id: p.staffId, name: p.staffName, designation: p.designation }));
  }, [roster, detail, branchKey]);

  const run = detail?.run ?? null;
  const isDraft = run?.status === 'Draft';
  const isFinal = run?.status === 'Finalized';
  const canGenerate = branchKey !== 'all' && !isFinal && !busy;

  const totals: RunTotals | null = detail
    ? detail.totals
    : summary
      ? { staffCount: summary.staffCount, paidCount: 0, gross: summary.gross, net: summary.net, paid: summary.paid, unpaid: summary.unpaid }
      : null;

  const applyDetail = (d: PayrollRunDetail) => {
    setDetail(d);
    bumpMeta();
  };

  const handleGenerate = async () => {
    if (branchKey === 'all') return;
    setBusy(true);
    try {
      const d = await payrollApi.generate(scope, { branchId: branchKey, month, createdBy: actor });
      setOpenRunId(null);
      applyDetail(d);
      addAuditLog(isDraft ? 'Regenerated Payroll' : 'Generated Payroll', 'Payroll', `${branchName(branchKey)} ${month}: ${d.totals.staffCount} payslips, net ${fmt(d.totals.net)}`);
      showToast(isDraft ? 'Payroll Regenerated' : 'Payroll Generated', `${d.totals.staffCount} payslips for ${monthLabel(month)}.`, 'success');
    } catch (err: any) {
      showToast('Could Not Generate Payroll', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const commitField = (slip: Payslip, field: 'bonus' | 'otherDeductions' | 'advanceRecovered') => async (n: number) => {
    try {
      applyDetail(await payrollApi.updatePayslip(scope, slip.id, { [field]: n }));
      return true;
    } catch (err: any) {
      showToast('Could Not Update Payslip', err.message || 'Request failed.', 'error');
      return false;
    }
  };

  const handleFinalize = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const d = await payrollApi.finalize(scope, run.id);
      applyDetail(d);
      setConfirmFinalize(false);
      addAuditLog('Finalized Payroll', 'Payroll', `${branchName(run.branchId)} ${run.month}: net ${fmt(d.totals.net)}`, { severity: 'warning' });
      showToast('Payroll Finalized', `${monthLabel(run.month)} payslips are locked. Salaries can now be paid.`, 'success');
    } catch (err: any) {
      showToast('Could Not Finalize', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async (slip: Payslip) => {
    const method = payMethods[slip.id] || 'Cash';
    setBusy(true);
    try {
      applyDetail(await payrollApi.paySlip(scope, slip.id, { method, createdBy: actor }));
      addAuditLog('Paid Salary', 'Payroll', `${slip.staffName} ${fmt(slip.netPay)} via ${method}`);
      showToast('Salary Paid', `${fmt(slip.netPay)} paid to ${slip.staffName} and recorded in the cash book.`, 'success');
    } catch (err: any) {
      showToast('Could Not Record Payment', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const canSettle = (p: Payslip) => p.status === 'Unpaid' && p.advanceBalance > 0.005 && p.netPay > 0.005;

  const handleSettle = async (slip: Payslip) => {
    if (busy) return;
    const method = payMethods[slip.id] || 'Cash';
    const taken = Math.min(slip.advanceBalance, slip.netPay);
    const pays = Math.max(0, Math.round((slip.netPay - taken) * 100) / 100);
    if (!window.confirm(`Settle and pay ${slip.staffName}?

Salary to pay now: ${fmt(slip.netPay)}
Advance taken out of it: ${fmt(taken)}
Paid to ${slip.staffName} by ${method}: ${fmt(pays)}

This cannot be undone.`)) return;
    setBusy(true);
    try {
      applyDetail(await payrollApi.settleSlip(scope, slip.id, { method, createdBy: actor }));
      bumpMeta();
      addAuditLog('Settled Advance and Paid Salary', 'Payroll', `${slip.staffName} advance ${fmt(taken)} taken, ${fmt(pays)} paid via ${method}`);
      showToast('Settled and Paid', `${fmt(taken)} advance taken from the salary and ${fmt(pays)} paid to ${slip.staffName}.`, 'success');
    } catch (err: any) {
      showToast('Could Not Settle', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (branchKey === 'all') return;
    const amount = Number(advAmount);
    if (!advStaff) {
      showToast('Select Staff', 'Choose the staff member receiving the advance.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Invalid Amount', 'Enter an amount greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      const adv = await payrollApi.createAdvance(scope, {
        branchId: branchKey,
        staffId: advStaff,
        amount,
        method: advMethod,
        reason: advReason.trim() || undefined,
        givenOn: advDate,
        createdBy: actor
      });
      addAuditLog('Gave Salary Advance', 'Payroll', `${adv.staffName} ${fmt(adv.amount)} via ${adv.method}`);
      showToast('Advance Recorded', `${fmt(adv.amount)} advance to ${adv.staffName} added to the cash book.`, 'success');
      setAdvAmount('');
      setAdvReason('');
      bumpMeta();
      reloadDetail();
    } catch (err: any) {
      showToast('Could Not Record Advance', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAdvance = async (a: SalaryAdvance) => {
    if (busy) return;
    if (!window.confirm(`Delete the ${fmt(a.amount)} advance given to ${a.staffName} on ${a.givenOn}?\n\nIts cash book entry will be removed too. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await payrollApi.deleteAdvance(scope, a.id);
      addAuditLog('Deleted Salary Advance', 'Payroll', `${a.staffName} ${fmt(a.amount)} on ${a.givenOn}`);
      showToast('Advance Deleted', `${fmt(a.amount)} advance to ${a.staffName} removed, and the cash book entry too.`, 'success');
      bumpMeta();
      reloadDetail();
    } catch (err: any) {
      showToast('Could Not Delete Advance', err.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportRun = (d: PayrollRunDetail) => {
    downloadCSV(
      `Payroll_${d.run.branchId}_${d.run.month}.csv`,
      ['Staff', 'Designation', 'Pay type', 'Base rate', 'Days in month', 'Present', 'Half days', 'Paid leave', 'Holiday / weekly off', 'Absent / unpaid', 'Unmarked', 'Payable days', 'Overtime hours', 'Basic pay', 'Overtime pay', 'Bonus', 'Other deductions', 'Advance recovered', 'Gross', 'Net pay', 'Status', 'Paid on', 'Method', 'Notes'],
      d.payslips.map((p) => [
        p.staffName,
        p.designation,
        p.payType,
        p.baseRate,
        p.daysInMonth,
        p.presentDays,
        p.halfDays,
        p.paidLeaveDays,
        p.holidayDays,
        p.unpaidDays,
        p.unmarkedDays,
        p.payableDays,
        p.overtimeHours,
        p.basicPay,
        p.overtimePay,
        p.bonus,
        p.otherDeductions,
        p.advanceRecovered,
        p.grossPay,
        p.netPay,
        d.run.status === 'Finalized' ? p.status : 'Draft',
        p.paidOn,
        p.paymentMethod,
        p.notes
      ])
    );
  };

  const exportById = async (id: string) => {
    try {
      exportRun(detail && detail.run.id === id ? detail : await payrollApi.getRun(scope, id));
    } catch (err: any) {
      showToast('Could Not Export', err.message || 'Request failed.', 'error');
    }
  };

  const openFromHistory = (r: PayrollRunListItem) => {
    setMonth(r.month);
    setOpenRunId(r.id);
    setTab('run');
  };

  if (!canUse) {
    return (
      <div className="space-y-6 pb-12">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Payroll</h2>
        <div className={`${cardClass} flex items-center gap-2 p-6 text-xs text-slate-600 dark:text-slate-400`}>
          <Lock className="h-4 w-4" />
          <span>Payroll is available to owners and accountants only.</span>
        </div>
      </div>
    );
  }

  const chip = (label: string, value: string, tone = '') => (
    <div className={`${cardClass} p-4`} key={label}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-right font-mono text-base sm:text-lg break-all sm:break-normal font-bold text-slate-900 dark:text-white ${tone}`}>{value}</p>
    </div>
  );

  const errorBanner = (title: string, message: string, onRetry: () => void) => (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-bold">{title}</p>
        <p>{message}</p>
      </div>
      <button type="button" onClick={onRetry} className="font-bold underline cursor-pointer">
        Retry
      </button>
    </div>
  );

  const loadingBox = (text: string) => (
    <div className={`${cardClass} flex items-center justify-center gap-2 p-12 text-xs text-slate-500 dark:text-slate-400`}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{text}</span>
    </div>
  );

  const advanceRecoveryTotal = detail ? detail.payslips.reduce((a, p) => a + p.advanceRecovered, 0) : 0;

  return (
    <div className="space-y-6 pb-12">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Payroll</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {branchKey === 'all' ? 'All branches' : branchName(branchKey)} &middot; monthly salary from attendance, advances and payments
          </p>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:flex sm:flex-wrap">
          {isOwner && (
            <select
              value={pageBranch}
              onChange={(e) => {
                setOpenRunId(null);
                setPageBranch(e.target.value);
              }}
              className={`${inputClass} col-span-2 w-auto sm:col-span-1`}
              aria-label="Branch"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="month"
            value={month}
            max={todayIST().slice(0, 7)}
            onChange={(e) => {
              if (!e.target.value) return;
              setOpenRunId(null);
              setMonth(e.target.value);
            }}
            className={`${inputClass} w-full sm:w-auto font-mono`}
            aria-label="Payroll month"
          />
          <button
            type="button"
            onClick={() => {
              reloadDetail();
              bumpMeta();
            }}
            disabled={loading}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-slate-800">
        <button type="button" className={tabBtn(tab === 'run')} onClick={() => setTab('run')}>Payroll run</button>
        <button type="button" className={tabBtn(tab === 'advances')} onClick={() => setTab('advances')}>Advances</button>
        <button type="button" className={tabBtn(tab === 'history')} onClick={() => setTab('history')}>History</button>
      </div>

      {metaError && <div className="no-print">{errorBanner('Could not load payroll summary', metaError, bumpMeta)}</div>}

      {tab === 'run' && (
        <div className="no-print space-y-6">
          {error && errorBanner('Could not load payroll', error, reloadDetail)}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
            {chip('Staff', String(totals?.staffCount ?? 0))}
            {chip('Gross pay', fmt(totals?.gross ?? 0))}
            {chip('Net pay', fmt(totals?.net ?? 0))}
            {chip('Paid', fmt(totals?.paid ?? 0), 'text-emerald-600 dark:text-emerald-400')}
            {chip('Unpaid', fmt(totals?.unpaid ?? 0), (totals?.unpaid ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-bold text-slate-900 dark:text-white">{monthLabel(month)}</span>
              {run ? <Badge tone={isFinal ? 'green' : 'amber'}>{run.status}</Badge> : <Badge tone="slate">Not generated</Badge>}
              {run && branchKey === 'all' && <span>&middot; {branchName(run.branchId)}</span>}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {detail && (
                <button type="button" onClick={() => exportRun(detail)} className={`${ghostBtn} flex-1 sm:flex-none`}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
              )}
              {!isFinal && (
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  title={branchKey === 'all' ? 'Select a single branch to generate payroll' : undefined}
                  className={`${primaryBtn} flex-1 sm:flex-none`}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span>{isDraft ? 'Regenerate' : 'Generate payroll'}</span>
                </button>
              )}
              {isDraft && (
                <button
                  type="button"
                  onClick={() => setConfirmFinalize(true)}
                  disabled={busy || !detail || detail.payslips.length === 0}
                  className={`${primaryBtn} flex-1 sm:flex-none`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Finalize</span>
                </button>
              )}
            </div>
          </div>

          {branchKey === 'all' && !run && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Select a single branch from the branch switcher to generate payroll, or open an existing run from History. Totals above cover all branches.
            </div>
          )}

          {isDraft && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Draft: edit bonus, deductions and advance recovery in the table. Regenerating refreshes attendance figures and keeps these edits.
            </p>
          )}

          {detail && detail.warnings.unmarkedSlips > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-bold">Attendance is incomplete</p>
                <p>
                  {detail.warnings.messages.join(' ')} Mark attendance and regenerate while the run is still a draft.
                </p>
              </div>
            </div>
          )}

          {loading && !detail && !error && loadingBox('Loading payroll...')}

          {!loading && !error && !detail && branchKey !== 'all' && (
            <div className={`${cardClass} p-10 text-center text-xs text-slate-500 dark:text-slate-400`}>
              No payroll generated for {monthLabel(month)} yet. Use Generate payroll to build it from attendance.
            </div>
          )}

          {detail && (
            <>
            <div className={`${cardClass} hidden overflow-hidden md:mb-0 md:block`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Staff</th>
                      <th className={thClass}>Pay type</th>
                      <th className={`${thClass} text-right`}>Payable days</th>
                      <th className={`${thClass} text-right`}>Basic</th>
                      <th className={`${thClass} text-right`}>Overtime</th>
                      <th className={`${thClass} text-right`}>Bonus</th>
                      <th className={`${thClass} text-right`}>Deductions</th>
                      <th className={`${thClass} text-right`}>Advance recovery</th>
                      <th className={`${thClass} text-right`}>Net</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {detail.payslips.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-10 text-center text-slate-400 dark:text-slate-500">
                          This run has no payslips.
                        </td>
                      </tr>
                    ) : (
                      detail.payslips.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className={tdClass}>
                            <p className="font-bold text-slate-900 dark:text-white">{p.staffName}</p>
                            {p.designation && <p className="text-[10px] text-slate-500 dark:text-slate-400">{p.designation}</p>}
                          </td>
                          <td className={`${tdClass} text-slate-600 dark:text-slate-300`}>
                            <p className="capitalize">{p.payType}</p>
                            <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{fmt(p.baseRate)}</p>
                          </td>
                          <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>
                            <span className="inline-flex items-center justify-end gap-1">
                              {p.hasUnmarkedDays && (
                                <span title={`${fmtDays(p.unmarkedDays)} unmarked day(s), not paid`}>
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                </span>
                              )}
                              {fmtDays(p.payableDays)}
                            </span>
                            {p.overtimeHours > 0 && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">{fmtDays(p.overtimeHours)}h OT</p>
                            )}
                          </td>
                          <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(p.basicPay)}</td>
                          <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(p.overtimePay)}</td>
                          <td className={`${tdClass} text-right`}>
                            <EditableAmount value={p.bonus} disabled={!isDraft} label={`Bonus for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'bonus')} />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <EditableAmount value={p.otherDeductions} disabled={!isDraft} label={`Deductions for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'otherDeductions')} />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <EditableAmount value={p.advanceRecovered} disabled={!isDraft} label={`Advance recovery for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'advanceRecovered')} />
                            {isDraft && p.advanceBalance > 0 && (
                              <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">of {fmt(p.advanceBalance)} open</p>
                            )}
                          </td>
                          <td className={`${tdClass} text-right font-mono font-bold text-slate-900 dark:text-white`}>{fmt(p.netPay)}</td>
                          <td className={tdClass}>
                            {isDraft ? (
                              <Badge tone="slate">Draft</Badge>
                            ) : p.status === 'Paid' ? (
                              <div>
                                <Badge tone="green">Paid</Badge>
                                <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{p.paidOn} &middot; {p.paymentMethod}</p>
                              </div>
                            ) : (
                              <Badge tone="amber">Unpaid</Badge>
                            )}
                          </td>
                          <td className={tdClass}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {isFinal && p.status === 'Unpaid' && (
                                <>
                                  <select
                                    value={payMethods[p.id] || 'Cash'}
                                    onChange={(e) => setPayMethods((m) => ({ ...m, [p.id]: e.target.value as PaymentMethod }))}
                                    aria-label={`Payment method for ${p.staffName}`}
                                    className={`${inputClass} w-auto`}
                                  >
                                    {PAY_METHODS.map((m) => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                  <button type="button" onClick={() => handlePay(p)} disabled={busy} className={primaryBtn}>
                                    Pay
                                  </button>
                                  {canSettle(p) && (
                                    <button
                                      type="button"
                                      onClick={() => handleSettle(p)}
                                      disabled={busy}
                                      title={`Take ${fmt(Math.min(p.advanceBalance, p.netPay))} of the advance out of this salary and pay the rest`}
                                      className={ghostBtn}
                                    >
                                      Settle &amp; pay
                                    </button>
                                  )}
                                </>
                              )}
                              <button type="button" onClick={() => setPrintSlip(p)} className={ghostBtn} title="Print payslip">
                                <Printer className="h-3.5 w-3.5" />
                                <span>Print payslip</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {detail.payslips.length > 0 && (
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white">
                      <tr>
                        <td className={tdClass} colSpan={3}>Total</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(detail.payslips.reduce((a, p) => a + p.basicPay, 0))}</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(detail.payslips.reduce((a, p) => a + p.overtimePay, 0))}</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(detail.payslips.reduce((a, p) => a + p.bonus, 0))}</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(detail.payslips.reduce((a, p) => a + p.otherDeductions, 0))}</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(advanceRecoveryTotal)}</td>
                        <td className={`${tdClass} text-right font-mono`}>{fmt(detail.totals.net)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
            <div className="space-y-3 md:hidden">
              {detail.payslips.length === 0 ? (
                <div className={`${cardClass} p-8 text-center text-xs text-slate-400 dark:text-slate-500`}>This run has no payslips.</div>
              ) : (
                detail.payslips.map((p) => (
                  <div key={p.id} className={`${cardClass} space-y-3 p-4 text-xs`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-bold text-slate-900 dark:text-white">{p.staffName}</p>
                        {p.designation && <p className="text-[10px] text-slate-500 dark:text-slate-400">{p.designation}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        {isDraft ? (
                          <Badge tone="slate">Draft</Badge>
                        ) : p.status === 'Paid' ? (
                          <div>
                            <Badge tone="green">Paid</Badge>
                            <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{p.paidOn} &middot; {p.paymentMethod}</p>
                          </div>
                        ) : (
                          <Badge tone="amber">Unpaid</Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <p className={labelClass}>Days</p>
                        <p className="flex items-center gap-1 font-mono text-slate-700 dark:text-slate-300">
                          {p.hasUnmarkedDays && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                          {fmtDays(p.payableDays)}
                          {p.overtimeHours > 0 && <span className="text-[10px] text-slate-400 dark:text-slate-500">({fmtDays(p.overtimeHours)}h OT)</span>}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className={labelClass}>Basic</p>
                        <p className="break-all font-mono text-slate-700 dark:text-slate-300">{fmt(p.basicPay)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className={labelClass}>Overtime</p>
                        <p className="break-all font-mono text-slate-700 dark:text-slate-300">{fmt(p.overtimePay)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className={labelClass}>Net</p>
                        <p className="break-all font-mono font-bold text-slate-900 dark:text-white">{fmt(p.netPay)}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className={labelClass}>Bonus</p>
                        <EditableAmount className="w-full" value={p.bonus} disabled={!isDraft} label={`Bonus for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'bonus')} />
                      </div>
                      <div>
                        <p className={labelClass}>Deductions</p>
                        <EditableAmount className="w-full" value={p.otherDeductions} disabled={!isDraft} label={`Deductions for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'otherDeductions')} />
                      </div>
                      <div>
                        <p className={labelClass}>Advance recovery</p>
                        <EditableAmount className="w-full" value={p.advanceRecovered} disabled={!isDraft} label={`Advance recovery for ${p.staffName}`} fmt={fmt} onCommit={commitField(p, 'advanceRecovered')} />
                        {isDraft && p.advanceBalance > 0 && (
                          <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">of {fmt(p.advanceBalance)} open</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isFinal && p.status === 'Unpaid' && (
                        <>
                          <select
                            value={payMethods[p.id] || 'Cash'}
                            onChange={(e) => setPayMethods((m) => ({ ...m, [p.id]: e.target.value as PaymentMethod }))}
                            aria-label={`Payment method for ${p.staffName}`}
                            className={`${inputClass} min-w-0 flex-1`}
                          >
                            {PAY_METHODS.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => handlePay(p)} disabled={busy} className={`${primaryBtn} min-h-10`}>
                            Pay
                          </button>
                          {canSettle(p) && (
                            <button
                              type="button"
                              onClick={() => handleSettle(p)}
                              disabled={busy}
                              className={`${ghostBtn} min-h-10 w-full`}
                            >
                              Settle &amp; pay (take {fmt(Math.min(p.advanceBalance, p.netPay))} advance)
                            </button>
                          )}
                        </>
                      )}
                      <button type="button" onClick={() => setPrintSlip(p)} className={`${ghostBtn} min-h-10 ${isFinal && p.status === 'Unpaid' ? '' : 'flex-1'}`} title="Print payslip">
                        <Printer className="h-3.5 w-3.5" />
                        <span>Print</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
              {detail.payslips.length > 0 && (
                <div className={`${cardClass} space-y-1 bg-slate-50 p-4 text-xs font-bold text-slate-900 dark:bg-slate-800/60 dark:text-white`}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</p>
                  {[
                    ['Basic', detail.payslips.reduce((a, p) => a + p.basicPay, 0)],
                    ['Overtime', detail.payslips.reduce((a, p) => a + p.overtimePay, 0)],
                    ['Bonus', detail.payslips.reduce((a, p) => a + p.bonus, 0)],
                    ['Deductions', detail.payslips.reduce((a, p) => a + p.otherDeductions, 0)],
                    ['Advance recovery', advanceRecoveryTotal],
                    ['Net', detail.totals.net]
                  ].map(([label, amount]) => (
                    <div key={label as string} className="flex justify-between gap-2">
                      <span>{label}</span>
                      <span className="font-mono">{fmt(amount as number)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
          )}
        </div>
      )}

      {tab === 'advances' && (
        <div className="no-print space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {chip('Outstanding advances', fmt(summary?.advancesOutstanding ?? 0), (summary?.advancesOutstanding ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}
            {chip('Open advances', String(summary?.openAdvanceCount ?? 0))}
          </div>

          <form onSubmit={handleAdvance} className={`${cardClass} p-4 sm:p-5`}>
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Give advance</h3>
            {branchKey === 'all' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Select a single branch from the branch switcher to give an advance.</p>
            ) : (
              <div className="space-y-3">
                {rosterFailed && staffOptions.length === 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    The staff roster could not be loaded. Generate payroll for a month to pick staff from its payslips, or retry later.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="min-w-0 lg:col-span-2">
                    <label className={labelClass} htmlFor="adv-staff">Staff</label>
                    <select id="adv-staff" value={advStaff} onChange={(e) => setAdvStaff(e.target.value)} className={inputClass}>
                      <option value="">Select staff...</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className={labelClass} htmlFor="adv-amount">Amount</label>
                    <input
                      id="adv-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={advAmount}
                      onChange={(e) => setAdvAmount(e.target.value)}
                      placeholder="0.00"
                      className={`${inputClass} text-right font-mono`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className={labelClass} htmlFor="adv-method">Method</label>
                    <select id="adv-method" value={advMethod} onChange={(e) => setAdvMethod(e.target.value as AdvanceMethod)} className={inputClass}>
                      {ADVANCE_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className={labelClass} htmlFor="adv-date">Given on</label>
                    <input
                      id="adv-date"
                      type="date"
                      value={advDate}
                      max={todayIST()}
                      onChange={(e) => e.target.value && setAdvDate(e.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass} htmlFor="adv-reason">Reason</label>
                  <input
                    id="adv-reason"
                    type="text"
                    maxLength={200}
                    value={advReason}
                    onChange={(e) => setAdvReason(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    Recorded as a cash book entry (money out, Salary advance) and recovered through payroll.
                  </p>
                  <button type="submit" disabled={busy || !advStaff || !advAmount} className={`${primaryBtn} w-full sm:w-auto`}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span>Give advance</span>
                  </button>
                </div>
              </div>
            )}
          </form>

          {advError && errorBanner('Could not load advances', advError, bumpMeta)}

          <div className={`${cardClass} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-slate-800">
              <span className="text-sm font-bold text-slate-900 dark:text-white">Advances</span>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <select
                  value={advStaffFilter}
                  onChange={(e) => setAdvStaffFilter(e.target.value)}
                  aria-label="Filter by staff"
                  className={`${inputClass} w-full sm:w-auto`}
                  disabled={branchKey === 'all'}
                >
                  <option value="">All staff</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <select value={advStatusFilter} onChange={(e) => setAdvStatusFilter(e.target.value)} aria-label="Filter by status" className={`${inputClass} w-full sm:w-auto`}>
                  <option value="">All statuses</option>
                  <option value="Open">Open</option>
                  <option value="Recovered">Recovered</option>
                </select>
              </div>
            </div>
            {advLoading && advances.length === 0 ? (
              <div className="flex items-center justify-center gap-2 p-10 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading advances...</span>
              </div>
            ) : (
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Date</th>
                      {branchKey === 'all' && <th className={thClass}>Branch</th>}
                      <th className={thClass}>Staff</th>
                      <th className={`${thClass} text-right`}>Amount</th>
                      <th className={`${thClass} text-right`}>Recovered</th>
                      <th className={`${thClass} text-right`}>Balance</th>
                      <th className={thClass}>Method</th>
                      <th className={thClass}>Reason</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {advances.length === 0 ? (
                      <tr>
                        <td colSpan={branchKey === 'all' ? 10 : 9} className="py-10 text-center text-slate-400 dark:text-slate-500">
                          No advances found.
                        </td>
                      </tr>
                    ) : (
                      advances.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className={`${tdClass} font-mono text-slate-700 dark:text-slate-300`}>{a.givenOn}</td>
                          {branchKey === 'all' && <td className={`${tdClass} text-slate-600 dark:text-slate-300`}>{branchName(a.branchId)}</td>}
                          <td className={`${tdClass} font-bold text-slate-900 dark:text-white`}>{a.staffName}</td>
                          <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(a.amount)}</td>
                          <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(a.recoveredAmount)}</td>
                          <td className={`${tdClass} text-right font-mono font-bold text-slate-900 dark:text-white`}>{fmt(a.balance)}</td>
                          <td className={`${tdClass} text-slate-600 dark:text-slate-300`}>{a.method}</td>
                          <td className={`${tdClass} text-slate-500 dark:text-slate-400`}>{a.reason || '-'}</td>
                          <td className={tdClass}>
                            <Badge tone={a.status === 'Open' ? 'amber' : 'green'}>{a.status}</Badge>
                          </td>
                          <td className={`${tdClass} text-right`}>
                            {a.recoveredAmount <= 0 && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleDeleteAdvance(a)}
                                aria-label={`Delete advance for ${a.staffName}`}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!(advLoading && advances.length === 0) && (
              <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
                {advances.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">No advances found.</p>
                ) : (
                  advances.map((a) => (
                    <div key={a.id} className="space-y-3 p-4 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words font-bold text-slate-900 dark:text-white">{a.staffName}</p>
                          <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            {a.givenOn}{branchKey === 'all' ? ` · ${branchName(a.branchId)}` : ''}
                          </p>
                        </div>
                        <Badge tone={a.status === 'Open' ? 'amber' : 'green'}>{a.status}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="min-w-0">
                          <p className={labelClass}>Amount</p>
                          <p className="break-all font-mono text-slate-700 dark:text-slate-300">{fmt(a.amount)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className={labelClass}>Recovered</p>
                          <p className="break-all font-mono text-slate-700 dark:text-slate-300">{fmt(a.recoveredAmount)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className={labelClass}>Balance</p>
                          <p className="break-all font-mono font-bold text-slate-900 dark:text-white">{fmt(a.balance)}</p>
                        </div>
                      </div>
                      <p className="break-words text-slate-600 dark:text-slate-300">
                        {a.method}
                        {a.reason ? <span className="text-slate-500 dark:text-slate-400"> &middot; {a.reason}</span> : null}
                      </p>
                      {a.recoveredAmount <= 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDeleteAdvance(a)}
                          className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 text-xs font-bold text-rose-600 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" /> Delete this advance
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className={`no-print ${cardClass} overflow-hidden`}>
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900 sm:px-5 dark:border-slate-800 dark:text-white">
            Past payroll runs
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Month</th>
                  {branchKey === 'all' && <th className={thClass}>Branch</th>}
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-right`}>Staff</th>
                  <th className={`${thClass} text-right`}>Gross</th>
                  <th className={`${thClass} text-right`}>Net</th>
                  <th className={`${thClass} text-right`}>Paid</th>
                  <th className={`${thClass} text-right`}>Unpaid</th>
                  <th className={thClass}>Finalized</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={branchKey === 'all' ? 10 : 9} className="py-10 text-center text-slate-400 dark:text-slate-500">
                      No payroll runs yet.
                    </td>
                  </tr>
                ) : (
                  history.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${run?.id === r.id ? 'bg-slate-50 dark:bg-slate-800/30' : ''}`}
                    >
                      <td className={`${tdClass} font-bold text-slate-900 dark:text-white`}>{monthLabel(r.month)}</td>
                      {branchKey === 'all' && <td className={`${tdClass} text-slate-600 dark:text-slate-300`}>{branchName(r.branchId)}</td>}
                      <td className={tdClass}>
                        <Badge tone={r.status === 'Finalized' ? 'green' : 'amber'}>{r.status}</Badge>
                      </td>
                      <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{r.staffCount}</td>
                      <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(r.gross)}</td>
                      <td className={`${tdClass} text-right font-mono font-bold text-slate-900 dark:text-white`}>{fmt(r.net)}</td>
                      <td className={`${tdClass} text-right font-mono text-emerald-600 dark:text-emerald-400`}>{fmt(r.paid)}</td>
                      <td className={`${tdClass} text-right font-mono text-slate-700 dark:text-slate-300`}>{fmt(r.unpaid)}</td>
                      <td className={`${tdClass} text-slate-500 dark:text-slate-400`}>
                        {r.finalizedAt ? new Date(r.finalizedAt).toLocaleDateString('en-IN') : '-'}
                      </td>
                      <td className={tdClass}>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => openFromHistory(r)} className={ghostBtn}>
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span>Open</span>
                          </button>
                          <button type="button" onClick={() => exportById(r.id)} className={ghostBtn} title="Export CSV">
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>CSV</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
            {history.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">No payroll runs yet.</p>
            ) : (
              history.map((r) => (
                <div key={r.id} className={`space-y-3 p-4 text-xs ${run?.id === r.id ? 'bg-slate-50 dark:bg-slate-800/30' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white">{monthLabel(r.month)}</p>
                      {branchKey === 'all' && <p className="text-[10px] text-slate-500 dark:text-slate-400">{branchName(r.branchId)}</p>}
                    </div>
                    <Badge tone={r.status === 'Finalized' ? 'green' : 'amber'}>{r.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <p className={labelClass}>Net</p>
                      <p className="break-all font-mono font-bold text-slate-900 dark:text-white">{fmt(r.net)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className={labelClass}>Unpaid</p>
                      <p className="break-all font-mono text-slate-700 dark:text-slate-300">{fmt(r.unpaid)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openFromHistory(r)} className={`${ghostBtn} min-h-10 flex-1`}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>Open</span>
                    </button>
                    <button type="button" onClick={() => exportById(r.id)} className={`${ghostBtn} min-h-10 flex-1`} title="Export CSV">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      <span>CSV</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {confirmFinalize && detail && run && (
        <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[100dvh] w-full max-w-sm overflow-y-auto rounded-xl rounded-b-none sm:rounded-b-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Finalize {monthLabel(run.month)} payroll?</h3>
            <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between"><span>Payslips</span><span className="font-mono">{detail.totals.staffCount}</span></div>
              <div className="flex justify-between"><span>Gross</span><span className="font-mono">{fmt(detail.totals.gross)}</span></div>
              <div className="flex justify-between"><span>Advance recovery</span><span className="font-mono">{fmt(advanceRecoveryTotal)}</span></div>
              <div className="flex justify-between font-bold text-slate-900 dark:text-white"><span>Net payable</span><span className="font-mono">{fmt(detail.totals.net)}</span></div>
              {detail.warnings.unmarkedSlips > 0 && (
                <p className="pt-2 font-bold text-amber-700 dark:text-amber-400">
                  {detail.warnings.unmarkedSlips} payslip(s) still have unmarked attendance days.
                </p>
              )}
              <p className="pt-2">
                Payslips become locked and the advance recovery is applied to the oldest open advances. This cannot be undone.
              </p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmFinalize(false)} disabled={busy} className={`${ghostBtn} w-full sm:w-auto`}>
                Cancel
              </button>
              <button type="button" onClick={handleFinalize} disabled={busy} className={`${primaryBtn} w-full sm:w-auto`}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Finalize</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {printSlip && run && (
        <>
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-0 sm:p-4" role="dialog" aria-modal="true">
            <div className="flex max-h-[100dvh] sm:max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
                <span className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-white">Payslip - {printSlip.staffName}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => window.print()} className={primaryBtn}>
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintSlip(null)}
                    aria-label="Close"
                    className="rounded-lg p-2.5 sm:p-1.5 text-slate-400 hover:bg-slate-200 cursor-pointer dark:hover:bg-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-100 p-4 dark:bg-slate-950">
                <div className="bg-white p-4 shadow-xs">
                  <PayslipSheet slip={printSlip} runStatus={run.status} month={run.month} branchName={branchName(run.branchId)} companyName={companyName} fmt={fmt} />
                </div>
              </div>
            </div>
          </div>
          {createPortal(
            <div id="payslip-print-root" className="hidden print-only bg-white p-8 text-black">
              <style>{`@media print { body > *:not(#payslip-print-root) { display: none !important; } }`}</style>
              <PayslipSheet slip={printSlip} runStatus={run.status} month={run.month} branchName={branchName(run.branchId)} companyName={companyName} fmt={fmt} />
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
};
