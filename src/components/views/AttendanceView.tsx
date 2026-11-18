import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Save
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import type { ApiScope } from '../../services/apiClient';
import {
  attendanceApi,
  type AttendanceStatus,
  type DayEntry,
  type MonthEntry,
  type MonthResponse
} from '../../services/attendanceApi';
import { downloadCSV } from '../../utils/csvExport';
import { STAFF_MANAGE_ROLES, STAFF_PAY_ROLES } from '../staff/StaffRoster';
import { EmployeesView } from './EmployeesView';
const HISTORY_DAYS = 62;

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface StatusMeta {
  status: AttendanceStatus;
  code: string;
  label: string;
  solid: string;
  soft: string;
  worked: boolean;
}

const STATUS_META: StatusMeta[] = [
  {
    status: 'Present',
    code: 'P',
    label: 'Present',
    solid: 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-600 dark:border-emerald-500',
    soft: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    worked: true
  },
  {
    status: 'Absent',
    code: 'A',
    label: 'Absent',
    solid: 'bg-rose-600 border-rose-600 text-white dark:bg-rose-600 dark:border-rose-500',
    soft: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    worked: false
  },
  {
    status: 'Half Day',
    code: 'HD',
    label: 'Half day',
    solid: 'bg-amber-500 border-amber-500 text-white dark:bg-amber-600 dark:border-amber-500',
    soft: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    worked: true
  },
  {
    status: 'Paid Leave',
    code: 'PL',
    label: 'Paid leave',
    solid: 'bg-sky-600 border-sky-600 text-white dark:bg-sky-600 dark:border-sky-500',
    soft: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    worked: false
  },
  {
    status: 'Unpaid Leave',
    code: 'UL',
    label: 'Unpaid leave',
    solid: 'bg-blue-700 border-blue-700 text-white dark:bg-blue-700 dark:border-blue-600',
    soft: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    worked: false
  },
  {
    status: 'Holiday',
    code: 'H',
    label: 'Holiday',
    solid: 'bg-slate-600 border-slate-600 text-white dark:bg-slate-500 dark:border-slate-400',
    soft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    worked: true
  },
  {
    status: 'Weekly Off',
    code: 'WO',
    label: 'Weekly off',
    solid: 'bg-slate-500 border-slate-500 text-white dark:bg-slate-600 dark:border-slate-500',
    soft: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    worked: true
  }
];

const META_BY_STATUS = Object.fromEntries(STATUS_META.map((m) => [m.status, m])) as Record<AttendanceStatus, StatusMeta>;

const cardClass = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 sm:py-1.5 text-base sm:text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-slate-400';
const primaryBtn =
  'flex min-h-10 sm:min-h-0 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600';
const secondaryBtn =
  'flex min-h-10 sm:min-h-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
const labelClass = 'mb-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400';
const thClass = 'py-3 px-4';

interface TabProps {
  scope: ApiScope;
  branchKey: string;
  isOwner: boolean;
  canSeePay: boolean;
  actor: string;
  branchName: (id: string) => string;
}

const ErrorBanner: React.FC<{ title: string; message: string; onRetry: () => void }> = ({ title, message, onRetry }) => (
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

const LoadingCard: React.FC<{ label: string }> = ({ label }) => (
  <div className={`${cardClass} flex items-center justify-center gap-2 p-12 text-xs text-slate-500 dark:text-slate-400`}>
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>{label}</span>
  </div>
);

const PickBranchNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
    {children}
  </div>
);

const Legend: React.FC = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-600 dark:text-slate-400">
    {STATUS_META.map((m) => (
      <span key={m.status} className="inline-flex items-center gap-1.5">
        <span className={`inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold ${m.soft}`}>{m.code}</span>
        {m.label}
      </span>
    ))}
  </div>
);

// ---------------------------------------------------------------- Mark attendance

interface Draft {
  status: AttendanceStatus | '';
  checkIn: string;
  checkOut: string;
  ot: string;
  notes: string;
}

const toDraft = (e: DayEntry): Draft => ({
  status: e.record?.status ?? '',
  checkIn: e.record?.checkIn ?? '',
  checkOut: e.record?.checkOut ?? '',
  ot: e.record && e.record.overtimeHours > 0 ? String(e.record.overtimeHours) : '',
  notes: e.record?.notes ?? ''
});

const sameDraft = (a: Draft, b: Draft) =>
  a.status === b.status && a.checkIn === b.checkIn && a.checkOut === b.checkOut && Number(a.ot || 0) === Number(b.ot || 0);

const otInvalid = (ot: string) => {
  if (ot.trim() === '') return false;
  const n = Number(ot);
  return !Number.isFinite(n) || n < 0 || n > 12;
};

const MarkTab: React.FC<TabProps> = ({ scope, branchKey, isOwner, actor, branchName }) => {
  const { showToast, addAuditLog } = useERP();
  const today = todayIST();
  const minDate = isOwner ? undefined : shiftDate(today, -HISTORY_DAYS);

  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [baseline, setBaseline] = useState<Record<string, Draft>>({});
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  const needsBranch = branchKey === 'all';

  const applyEntries = useCallback((list: DayEntry[]) => {
    const next: Record<string, Draft> = {};
    for (const e of list) next[e.staffId] = toDraft(e);
    setEntries(list);
    setBaseline(next);
    setDraft(next);
  }, []);

  useEffect(() => {
    if (needsBranch) {
      setLoading(false);
      setError(null);
      applyEntries([]);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    attendanceApi
      .getDay(scope, branchKey, date)
      .then((r) => {
        if (id === requestId.current) applyEntries(r.entries);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        applyEntries([]);
        setError(e.message || 'Failed to load attendance.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [scope, branchKey, date, tick, needsBranch, applyEntries]);

  const changedIds = useMemo(
    () => entries.filter((e) => draft[e.staffId] && draft[e.staffId].status !== '' && baseline[e.staffId] && !sameDraft(draft[e.staffId], baseline[e.staffId])).map((e) => e.staffId),
    [entries, draft, baseline]
  );
  const dirty = changedIds.length > 0;
  const hasInvalid = changedIds.some((id) => otInvalid(draft[id].ot));

  const counts = useMemo(() => {
    const c: Record<string, number> = { unmarked: 0 };
    for (const e of entries) {
      const s = draft[e.staffId]?.status;
      if (!s) c.unmarked++;
      else c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [entries, draft]);

  const update = (staffId: string, patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, [staffId]: { ...d[staffId], ...patch } }));

  const setStatus = (staffId: string, status: AttendanceStatus) => {
    const worked = META_BY_STATUS[status].worked;
    update(staffId, worked ? { status } : { status, checkIn: '', checkOut: '', ot: '' });
  };

  const markAllPresent = () =>
    setDraft((d) => {
      const next = { ...d };
      for (const e of entries) {
        if (!next[e.staffId]?.status) next[e.staffId] = { ...next[e.staffId], status: 'Present' };
      }
      return next;
    });

  const changeDate = (value: string) => {
    if (!value || value === date) return;
    if (value > today) return;
    if (dirty && !window.confirm('You have unsaved attendance changes. Discard them and switch the date?')) return;
    setDate(value);
  };

  const handleSave = async () => {
    if (needsBranch || !dirty) return;
    if (hasInvalid) {
      showToast('Invalid Overtime', 'Overtime hours must be between 0 and 12.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await attendanceApi.saveDay(scope, {
        branchId: branchKey,
        date,
        markedBy: actor,
        records: changedIds.map((id) => {
          const d = draft[id];
          return {
            staffId: id,
            status: d.status as AttendanceStatus,
            checkIn: d.checkIn || null,
            checkOut: d.checkOut || null,
            overtimeHours: d.ot.trim() === '' ? 0 : Number(d.ot),
            notes: d.notes || null
          };
        })
      });
      applyEntries(res.entries);
      addAuditLog('Marked Attendance', 'Attendance', `${branchName(branchKey)}: ${res.saved} record(s) saved for ${date}`);
      showToast('Attendance Saved', `${res.saved} record${res.saved === 1 ? '' : 's'} saved for ${date}.`, 'success');
    } catch (err: any) {
      showToast('Could Not Save Attendance', err.message || 'Request failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderStatus = (e: DayEntry, d: Draft) => (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`Status for ${e.name}`}>
      {STATUS_META.map((m) => {
        const on = d.status === m.status;
        return (
          <button
            key={m.status}
            type="button"
            title={m.label}
            aria-pressed={on}
            onClick={() => setStatus(e.staffId, m.status)}
            className={`h-10 min-w-10 sm:h-7 sm:min-w-8 rounded-md border px-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
              on
                ? m.solid
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {m.code}
          </button>
        );
      })}
    </div>
  );

  if (needsBranch) {
    return <PickBranchNotice>Select a single branch from the branch switcher to mark attendance.</PickBranchNotice>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full items-end gap-2 sm:w-auto">
          <div className="flex-1 sm:flex-none">
            <label htmlFor="att-date" className={labelClass}>Date</label>
            <input
              id="att-date"
              type="date"
              value={date}
              max={today}
              min={minDate}
              onChange={(e) => changeDate(e.target.value)}
              className={`${inputClass} w-full font-mono sm:w-auto`}
            />
          </div>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading || saving}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Reload"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold ${
              dirty
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}
          >
            {dirty ? (
              <>
                <AlertTriangle className="h-3 w-3" />
                {changedIds.length} unsaved
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" />
                All saved
              </>
            )}
          </span>
          <button type="button" onClick={markAllPresent} disabled={loading || saving || counts.unmarked === 0} className={`${secondaryBtn} flex-1 sm:flex-none`}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Mark all present</span>
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty || saving || hasInvalid} className={`${primaryBtn} flex-1 sm:flex-none`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>Save attendance</span>
          </button>
        </div>
      </div>

      {error && <ErrorBanner title="Could not load attendance" message={error} onRetry={() => setTick((t) => t + 1)} />}

      {loading && entries.length === 0 && !error && <LoadingCard label="Loading attendance..." />}

      {!loading && !error && entries.length === 0 && (
        <div className={`${cardClass} p-10 text-center text-xs text-slate-400 dark:text-slate-500`}>
          No active staff in this branch. Add staff from the Staff roster tab first.
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            {STATUS_META.map((m) => (
              <span key={m.status} className={`rounded-md px-2 py-1 ${m.soft}`}>
                {m.code} {counts[m.status] || 0}
              </span>
            ))}
            <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Unmarked {counts.unmarked}
            </span>
          </div>

          <div className={`${cardClass} overflow-hidden`}>
            <div className="space-y-2 p-3 md:hidden">
              {entries.map((e) => {
                const d = draft[e.staffId];
                if (!d) return null;
                const isChanged = changedIds.includes(e.staffId);
                const noTimes = d.status === '' || !META_BY_STATUS[d.status].worked;
                return (
                  <div
                    key={e.staffId}
                    className={`space-y-2 rounded-lg border border-slate-100 p-3 dark:border-slate-800 ${isChanged ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}
                  >
                    <div>
                      <p className="break-words text-xs font-bold text-slate-900 dark:text-white">{e.name}</p>
                      {e.designation && <p className="break-words text-[10px] text-slate-400 dark:text-slate-500">{e.designation}</p>}
                    </div>
                    {renderStatus(e, d)}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <label className={labelClass}>In</label>
                        <input
                          type="time"
                          value={d.checkIn}
                          disabled={noTimes}
                          onChange={(ev) => update(e.staffId, { checkIn: ev.target.value })}
                          className={`${inputClass} w-full font-mono`}
                          aria-label={`Check in for ${e.name}`}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className={labelClass}>Out</label>
                        <input
                          type="time"
                          value={d.checkOut}
                          disabled={noTimes}
                          onChange={(ev) => update(e.staffId, { checkOut: ev.target.value })}
                          className={`${inputClass} w-full font-mono`}
                          aria-label={`Check out for ${e.name}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className={thClass}>Staff</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>In</th>
                    <th className={thClass}>Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((e) => {
                    const d = draft[e.staffId];
                    if (!d) return null;
                    const isChanged = changedIds.includes(e.staffId);
                    const noTimes = d.status === '' || !META_BY_STATUS[d.status].worked;
                    return (
                      <tr
                        key={e.staffId}
                        className={isChanged ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'}
                      >
                        <td className="py-2.5 px-4">
                          <p className="font-bold text-slate-900 dark:text-white">{e.name}</p>
                          {e.designation && <p className="text-[10px] text-slate-400 dark:text-slate-500">{e.designation}</p>}
                        </td>
                        <td className="py-2.5 px-4">
                          {renderStatus(e, d)}
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="time"
                            value={d.checkIn}
                            disabled={noTimes}
                            onChange={(ev) => update(e.staffId, { checkIn: ev.target.value })}
                            className={`${inputClass} w-28 font-mono`}
                            aria-label={`Check in for ${e.name}`}
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="time"
                            value={d.checkOut}
                            disabled={noTimes}
                            onChange={(ev) => update(e.staffId, { checkOut: ev.target.value })}
                            className={`${inputClass} w-28 font-mono`}
                            aria-label={`Check out for ${e.name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Legend />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Monthly sheet

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const SheetTab: React.FC<TabProps> = ({ scope, branchKey, branchName }) => {
  const today = todayIST();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    attendanceApi
      .getMonth(scope, branchKey, month)
      .then((r) => {
        if (id === requestId.current) setData(r);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setData(null);
        setError(e.message || 'Failed to load the monthly sheet.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [scope, branchKey, month, tick]);

  const dayCount = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }, [month]);
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const dd = String(i + 1).padStart(2, '0');
        const iso = `${month}-${dd}`;
        return { n: i + 1, iso, weekday: new Date(`${iso}T00:00:00Z`).getUTCDay() };
      }),
    [month, dayCount]
  );

  const exportCsv = () => {
    if (!data) return;
    downloadCSV(
      `Attendance_${branchKey}_${month}.csv`,
      [
        'Staff',
        'Designation',
        ...days.map((d) => String(d.n)),
        'Present',
        'Half Day',
        'Paid Leave',
        'Unpaid Leave',
        'Absent',
        'Holiday',
        'Weekly Off',
        'Unmarked'
      ],
      data.staff.map((s) => [
        s.name,
        s.designation,
        ...days.map((d) => (s.days[d.iso] ? META_BY_STATUS[s.days[d.iso].status].code : '')),
        s.counts.present,
        s.counts.half,
        s.counts.paidLeave,
        s.counts.unpaidLeave,
        s.counts.absent,
        s.counts.holiday,
        s.counts.weeklyOff,
        s.counts.unmarked
      ])
    );
  };

  const totalCell = 'py-2 px-2 text-center font-mono text-slate-700 dark:text-slate-300';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full items-end gap-2 sm:w-auto">
          <div className="flex-1 sm:flex-none">
            <label htmlFor="att-month" className={labelClass}>Month</label>
            <input
              id="att-month"
              type="month"
              value={month}
              max={today.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className={`${inputClass} w-full font-mono sm:w-auto`}
            />
          </div>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Reload"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <button type="button" onClick={exportCsv} disabled={!data || data.staff.length === 0} className={`${secondaryBtn} w-full sm:w-auto`}>
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {error && <ErrorBanner title="Could not load the monthly sheet" message={error} onRetry={() => setTick((t) => t + 1)} />}
      {loading && !data && !error && <LoadingCard label="Loading monthly sheet..." />}

      {data && data.staff.length === 0 && !error && (
        <div className={`${cardClass} p-10 text-center text-xs text-slate-400 dark:text-slate-500`}>
          No staff or attendance found for {month}.
        </div>
      )}

      {data && data.staff.length > 0 && (
        <>
          <div className={`${cardClass} overflow-hidden`}>
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    <th className="sticky left-0 z-10 min-w-28 sm:min-w-40 border-b border-r border-slate-100 bg-slate-50 py-2 px-3 text-left dark:border-slate-700 dark:bg-slate-800">
                      Staff
                    </th>
                    {days.map((d) => (
                      <th
                        key={d.iso}
                        className={`min-w-7 border-b border-slate-100 px-0.5 py-1 text-center dark:border-slate-700 ${
                          d.weekday === 0 ? 'text-rose-500 dark:text-rose-400' : ''
                        }`}
                      >
                        <div>{d.n}</div>
                        <div className="text-[9px] font-medium opacity-70">{WEEKDAYS[d.weekday]}</div>
                      </th>
                    ))}
                    {['P', 'A', 'HD', 'Leave'].map((h) => (
                      <th key={h} className="min-w-10 border-b border-l border-slate-100 px-2 py-2 text-center dark:border-slate-700 first-of-type:border-l-0">
                        {h}
                      </th>
                    ))}
                    <th className="min-w-12 border-b border-slate-100 px-2 py-2 text-center dark:border-slate-700">Unmarked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((s) => (
                    <tr key={s.staffId} className="group">
                      <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white py-2 px-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="max-w-28 truncate font-bold text-slate-900 sm:max-w-none sm:whitespace-nowrap dark:text-white">
                          {s.name}
                          {s.status !== 'Active' && (
                            <span className="ml-1.5 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Inactive
                            </span>
                          )}
                        </p>
                        <p className="max-w-28 truncate text-[10px] text-slate-400 sm:max-w-none sm:whitespace-nowrap dark:text-slate-500">
                          {[s.designation, branchKey === 'all' ? branchName(s.branchId) : null].filter(Boolean).join(' | ') || '-'}
                        </p>
                      </td>
                      {days.map((d) => {
                        const cell = s.days[d.iso];
                        const meta = cell ? META_BY_STATUS[cell.status] : null;
                        const future = d.iso > data.today;
                        return (
                          <td
                            key={d.iso}
                            className={`border-b border-slate-100 p-0.5 text-center dark:border-slate-800 ${future ? 'opacity-40' : ''}`}
                          >
                            {meta ? (
                              <span
                                title={meta.label}
                                className={`inline-flex h-6 min-w-6 items-center justify-center rounded text-[10px] font-bold ${meta.soft}`}
                              >
                                {meta.code}
                              </span>
                            ) : (
                              <span className="inline-block h-6 min-w-6" />
                            )}
                          </td>
                        );
                      })}
                      <td className={`${totalCell} border-b border-l border-slate-100 dark:border-slate-800`}>{s.counts.present}</td>
                      <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{s.counts.absent}</td>
                      <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{s.counts.half}</td>
                      <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{s.counts.paidLeave + s.counts.unpaidLeave}</td>
                      <td
                        className={`${totalCell} border-b border-slate-100 dark:border-slate-800 ${
                          s.counts.unmarked > 0 ? '!text-amber-600 dark:!text-amber-400' : ''
                        }`}
                      >
                        {s.counts.unmarked}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Legend />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Weekly sheet

const mondayOf = (iso: string) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDate(iso, dow === 0 ? -6 : 1 - dow);
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

const WEEK_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WeekTab: React.FC<TabProps> = ({ scope, branchKey, branchName }) => {
  const today = todayIST();
  const thisMonday = mondayOf(today);
  const [weekStart, setWeekStart] = useState(thisMonday);
  const [rows, setRows] = useState<MonthEntry[] | null>(null);
  const [loadedToday, setLoadedToday] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = shiftDate(weekStart, i);
        return { iso, n: Number(iso.slice(8)), weekday: new Date(`${iso}T00:00:00Z`).getUTCDay() };
      }),
    [weekStart]
  );

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    // A week can run across two months, so ask for both and join them.
    const months = Array.from(new Set([weekStart.slice(0, 7), shiftDate(weekStart, 6).slice(0, 7)]));
    Promise.all(months.map((m) => attendanceApi.getMonth(scope, branchKey, m)))
      .then((list) => {
        if (id !== requestId.current) return;
        const byStaff = new Map<string, MonthEntry>();
        for (const r of list) {
          for (const s of r.staff) {
            const have = byStaff.get(s.staffId);
            byStaff.set(s.staffId, have ? { ...have, days: { ...have.days, ...s.days } } : { ...s, days: { ...s.days } });
          }
        }
        setRows(Array.from(byStaff.values()));
        setLoadedToday(list[0]?.today || today);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setRows(null);
        setError(e.message || 'Failed to load the weekly sheet.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [scope, branchKey, weekStart, tick]);

  const summary = (s: MonthEntry) => {
    let present = 0, half = 0, absent = 0, leave = 0, off = 0, unmarked = 0;
    for (const d of days) {
      const c = s.days[d.iso];
      if (!c) {
        if (d.iso <= loadedToday) unmarked++;
        continue;
      }
      if (c.status === 'Present') present++;
      else if (c.status === 'Half Day') half++;
      else if (c.status === 'Absent') absent++;
      else if (c.status === 'Paid Leave' || c.status === 'Unpaid Leave') leave++;
      else off++; // Holiday or Weekly Off
    }
    return { present, half, absent, leave, off, unmarked };
  };

  const label = `${shortDate(days[0].iso)} – ${shortDate(days[6].iso)} ${days[6].iso.slice(0, 4)}`;
  const isThisWeek = weekStart === thisMonday;

  const exportCsv = () => {
    if (!rows) return;
    downloadCSV(
      `Attendance_${branchKey}_week_${weekStart}.csv`,
      ['Staff', 'Designation', ...days.map((d) => `${WEEK_NAMES[d.weekday]} ${shortDate(d.iso)}`), 'Present', 'Half Day', 'Absent', 'Leave', 'Holiday / Off', 'Unmarked'],
      rows.map((s) => {
        const t = summary(s);
        return [
          s.name,
          s.designation,
          ...days.map((d) => (s.days[d.iso] ? META_BY_STATUS[s.days[d.iso].status].code : '')),
          t.present, t.half, t.absent, t.leave, t.off, t.unmarked
        ];
      })
    );
  };

  const totalCell = 'py-2 px-2 text-center font-mono text-slate-700 dark:text-slate-300';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setWeekStart((w) => shiftDate(w, -7))}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 text-center sm:w-52 sm:flex-none">
            <p className="text-sm font-bold text-slate-900 dark:text-white">{label}</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">{isThisWeek ? 'This week' : 'Monday to Sunday'}</p>
          </div>
          <button
            type="button"
            onClick={() => setWeekStart((w) => shiftDate(w, 7))}
            disabled={isThisWeek}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isThisWeek && (
            <button type="button" onClick={() => setWeekStart(thisMonday)} className={secondaryBtn}>
              This week
            </button>
          )}
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            className="rounded-lg border border-slate-200 p-2.5 sm:p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Reload"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <button type="button" onClick={exportCsv} disabled={!rows || rows.length === 0} className={`${secondaryBtn} w-full sm:w-auto`}>
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {error && <ErrorBanner title="Could not load the weekly sheet" message={error} onRetry={() => setTick((t) => t + 1)} />}
      {loading && !rows && !error && <LoadingCard label="Loading weekly sheet..." />}

      {rows && rows.length === 0 && !error && (
        <div className={`${cardClass} p-10 text-center text-xs text-slate-400 dark:text-slate-500`}>
          No staff or attendance found for this week.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className={`${cardClass} overflow-hidden ${loading ? 'opacity-60' : ''}`}>
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    <th className="sticky left-0 z-10 min-w-28 sm:min-w-40 border-b border-r border-slate-100 bg-slate-50 py-2 px-3 text-left dark:border-slate-700 dark:bg-slate-800">
                      Staff
                    </th>
                    {days.map((d) => (
                      <th
                        key={d.iso}
                        className={`min-w-11 border-b border-slate-100 px-1 py-1.5 text-center dark:border-slate-700 ${
                          d.weekday === 0 ? 'text-rose-500 dark:text-rose-400' : ''
                        } ${d.iso === today ? 'bg-slate-200/70 dark:bg-slate-700' : ''}`}
                      >
                        <div>{WEEK_NAMES[d.weekday]}</div>
                        <div className="text-[9px] font-medium opacity-70">{shortDate(d.iso)}</div>
                      </th>
                    ))}
                    {['P', 'HD', 'A', 'Leave'].map((h, i) => (
                      <th key={h} className={`min-w-10 border-b border-slate-100 px-2 py-2 text-center dark:border-slate-700 ${i === 0 ? 'border-l' : ''}`}>
                        {h}
                      </th>
                    ))}
                    <th className="min-w-12 border-b border-slate-100 px-2 py-2 text-center dark:border-slate-700">Unmarked</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const t = summary(s);
                    return (
                      <tr key={s.staffId}>
                        <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white py-2 px-3 dark:border-slate-800 dark:bg-slate-900">
                          <p className="max-w-28 truncate font-bold text-slate-900 sm:max-w-none sm:whitespace-nowrap dark:text-white">
                            {s.name}
                            {s.status !== 'Active' && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                Inactive
                              </span>
                            )}
                          </p>
                          <p className="max-w-28 truncate text-[10px] text-slate-400 sm:max-w-none sm:whitespace-nowrap dark:text-slate-500">
                            {[s.designation, branchKey === 'all' ? branchName(s.branchId) : null].filter(Boolean).join(' | ') || '-'}
                          </p>
                        </td>
                        {days.map((d) => {
                          const cell = s.days[d.iso];
                          const meta = cell ? META_BY_STATUS[cell.status] : null;
                          const future = d.iso > loadedToday;
                          return (
                            <td key={d.iso} className={`border-b border-slate-100 p-1 text-center dark:border-slate-800 ${future ? 'opacity-40' : ''}`}>
                              {meta ? (
                                <span
                                  title={meta.label}
                                  className={`inline-flex h-7 min-w-8 flex-col items-center justify-center rounded text-[10px] font-bold leading-none ${meta.soft}`}
                                >
                                  {meta.code}
                                </span>
                              ) : (
                                <span className="inline-block h-7 min-w-8" />
                              )}
                            </td>
                          );
                        })}
                        <td className={`${totalCell} border-b border-l border-slate-100 dark:border-slate-800`}>{t.present}</td>
                        <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{t.half}</td>
                        <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{t.absent}</td>
                        <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800`}>{t.leave}</td>
                        <td className={`${totalCell} border-b border-slate-100 dark:border-slate-800 ${t.unmarked > 0 ? '!text-amber-600 dark:!text-amber-400' : ''}`}>
                          {t.unmarked}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Legend />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Page

type Tab = 'mark' | 'week' | 'sheet' | 'roster';

const TABS: { id: Tab; label: string }[] = [
  { id: 'mark', label: 'Mark attendance' },
  { id: 'week', label: 'Weekly sheet' },
  { id: 'sheet', label: 'Monthly sheet' },
  { id: 'roster', label: 'Staff directory' }
];

export const AttendanceView: React.FC<{ initialTab?: Tab }> = ({ initialTab = 'mark' }) => {
  const { currentRole, selectedBranchId, branches } = useERP();
  const { userProfile, assignedBranchId } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  // Owners often browse with "All branches" selected; attendance is per branch, so the page has its own picker.
  const [pageBranch, setPageBranch] = useState<string>(selectedBranchId !== 'all' ? selectedBranchId : 'branch-1');
  useEffect(() => {
    if (selectedBranchId !== 'all') setPageBranch(selectedBranchId);
  }, [selectedBranchId]);

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const canManage = STAFF_MANAGE_ROLES.includes(currentRole);
  const canSeePay = STAFF_PAY_ROLES.includes(currentRole);
  const branchKey = isOwner ? pageBranch : assignedBranchId;
  const scope = useMemo<ApiScope>(
    () => ({
      role: currentRole,
      branchId: isOwner ? pageBranch : assignedBranchId
    }),
    [currentRole, isOwner, pageBranch, assignedBranchId]
  );
  const actor = userProfile?.displayName || currentRole;
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name || id, [branches]);

  if (!canManage) {
    return (
      <div className="space-y-6 pb-12">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Attendance</h2>
        <div className={`${cardClass} p-10 text-center text-xs text-slate-500 dark:text-slate-400`}>
          Your role does not have access to staff and attendance.
        </div>
      </div>
    );
  }

  const tabProps: TabProps = { scope, branchKey, isOwner, canSeePay, actor, branchName };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Staff Attendance</h2>
          <p className="break-words text-xs text-slate-500 dark:text-slate-400">
            {branchKey === 'all' ? 'All branches' : branchName(branchKey)} &middot; daily attendance, weekly and monthly sheets and the staff directory
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {isOwner && (
          <label className="flex w-full items-center gap-2 text-xs sm:w-auto font-semibold text-slate-600 dark:text-slate-300">
            <span>Branch</span>
            <select
              value={pageBranch}
              onChange={(e) => setPageBranch(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-base font-medium sm:flex-none sm:py-1.5 sm:text-xs text-slate-900 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex w-full self-start overflow-x-auto rounded-lg bg-slate-100 p-1 text-xs font-bold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:inline-flex sm:w-auto dark:bg-slate-800" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 whitespace-nowrap rounded-md px-3.5 py-2.5 transition-colors cursor-pointer sm:flex-none sm:py-1.5 ${
                tab === t.id
                  ? 'bg-slate-800 text-white shadow-xs dark:bg-slate-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* Kept mounted so unsaved attendance drafts survive tab switches. */}
      <div className={tab === 'mark' ? '' : 'hidden'}>
        <MarkTab {...tabProps} />
      </div>
      {tab === 'week' && <WeekTab {...tabProps} />}
      {tab === 'sheet' && <SheetTab {...tabProps} />}
      {tab === 'roster' && <EmployeesView />}
    </div>
  );
};
