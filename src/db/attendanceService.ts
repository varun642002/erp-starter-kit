import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './index.ts';
import { attendanceRecords, staff } from './schema.staff.ts';
import { StaffError } from './staffService.ts';

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Half Day', 'Paid Leave', 'Unpaid Leave', 'Holiday', 'Weekly Off'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceRow = typeof attendanceRecords.$inferSelect;

export interface DayRecordInput {
  staffId: string;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  overtimeHours?: number;
  notes?: string | null;
}

export interface DayEntry {
  staffId: string;
  name: string;
  designation: string | null;
  record: {
    status: AttendanceStatus;
    checkIn: string | null;
    checkOut: string | null;
    overtimeHours: number;
    notes: string | null;
  } | null;
}

export interface MonthCounts {
  present: number;
  half: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  holiday: number;
  weeklyOff: number;
  overtimeHours: number;
  unmarked: number;
}

export interface MonthEntry {
  staffId: string;
  branchId: string;
  name: string;
  designation: string | null;
  status: string;
  days: Record<string, { status: AttendanceStatus; overtimeHours: number }>;
  counts: MonthCounts;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function getDay(branchId: string, date: string): Promise<DayEntry[]> {
  const [people, records] = await Promise.all([
    db
      .select({ id: staff.id, name: staff.name, designation: staff.designation })
      .from(staff)
      .where(and(eq(staff.branchId, branchId), eq(staff.status, 'Active')))
      .orderBy(asc(staff.name)),
    db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.branchId, branchId), eq(attendanceRecords.workDate, date)))
  ]);
  const byStaff = new Map(records.map((r) => [r.staffId, r]));
  return people.map((p) => {
    const r = byStaff.get(p.id);
    return {
      staffId: p.id,
      name: p.name,
      designation: p.designation,
      record: r
        ? {
            status: r.status as AttendanceStatus,
            checkIn: r.checkIn,
            checkOut: r.checkOut,
            overtimeHours: r.overtimeHours,
            notes: r.notes
          }
        : null
    };
  });
}

export async function saveDay(
  branchId: string,
  date: string,
  records: DayRecordInput[],
  markAllAs: AttendanceStatus | null,
  markedBy: string | null
): Promise<{ saved: number }> {
  const saved = await db.transaction(async (tx) => {
    const active = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.branchId, branchId), eq(staff.status, 'Active')));
    const activeIds = new Set(active.map((s) => s.id));

    const ids = records.map((r) => r.staffId);
    if (ids.length) {
      const owned = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.branchId, branchId), inArray(staff.id, ids)));
      const ownedIds = new Set(owned.map((s) => s.id));
      const stranger = ids.find((id) => !ownedIds.has(id));
      if (stranger) throw new StaffError('One or more staff members do not belong to this branch.');
    }

    const rows = new Map<string, DayRecordInput>();
    if (markAllAs) {
      const existing = await tx
        .select({ staffId: attendanceRecords.staffId })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.branchId, branchId), eq(attendanceRecords.workDate, date)));
      const marked = new Set(existing.map((e) => e.staffId));
      for (const id of activeIds) {
        if (!marked.has(id)) rows.set(id, { staffId: id, status: markAllAs });
      }
    }
    for (const r of records) rows.set(r.staffId, r);

    const now = new Date();
    for (const r of rows.values()) {
      // Absences and leave never carry worked hours.
      const worked = r.status !== 'Absent' && r.status !== 'Paid Leave' && r.status !== 'Unpaid Leave';
      const values = {
        staffId: r.staffId,
        branchId,
        workDate: date,
        status: r.status,
        checkIn: worked ? (r.checkIn ?? null) : null,
        checkOut: worked ? (r.checkOut ?? null) : null,
        overtimeHours: worked ? (r.overtimeHours ?? 0) : 0,
        notes: r.notes ?? null,
        markedBy
      };
      await tx
        .insert(attendanceRecords)
        .values(values)
        .onConflictDoUpdate({
          target: [attendanceRecords.staffId, attendanceRecords.workDate],
          set: {
            status: values.status,
            checkIn: values.checkIn,
            checkOut: values.checkOut,
            overtimeHours: values.overtimeHours,
            notes: values.notes,
            markedBy,
            updatedAt: now
          }
        });
    }
    return rows.size;
  });
  return { saved };
}

export async function getMonth(branchId: string, month: string, today: string): Promise<MonthEntry[]> {
  const total = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(total).padStart(2, '0')}`;
  const branchFilter = branchId === 'all' ? undefined : eq(staff.branchId, branchId);

  const [people, records] = await Promise.all([
    db.select().from(staff).where(branchFilter).orderBy(asc(staff.name)),
    db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          branchId === 'all' ? undefined : eq(attendanceRecords.branchId, branchId),
          gte(attendanceRecords.workDate, first),
          lte(attendanceRecords.workDate, last)
        )
      )
  ]);

  const recordsByStaff = new Map<string, AttendanceRow[]>();
  for (const r of records) {
    const list = recordsByStaff.get(r.staffId);
    if (list) list.push(r);
    else recordsByStaff.set(r.staffId, [r]);
  }

  const out: MonthEntry[] = [];
  for (const p of people) {
    const mine = recordsByStaff.get(p.id) ?? [];
    // Inactive staff only appear when they have history in the month.
    if (p.status !== 'Active' && mine.length === 0) continue;

    const counts: MonthCounts = {
      present: 0,
      half: 0,
      paidLeave: 0,
      unpaidLeave: 0,
      absent: 0,
      holiday: 0,
      weeklyOff: 0,
      overtimeHours: 0,
      unmarked: 0
    };
    const days: MonthEntry['days'] = {};
    for (const r of mine) {
      const status = r.status as AttendanceStatus;
      days[r.workDate] = { status, overtimeHours: r.overtimeHours };
      counts.overtimeHours += r.overtimeHours;
      if (status === 'Present') counts.present++;
      else if (status === 'Half Day') counts.half++;
      else if (status === 'Paid Leave') counts.paidLeave++;
      else if (status === 'Unpaid Leave') counts.unpaidLeave++;
      else if (status === 'Absent') counts.absent++;
      else if (status === 'Holiday') counts.holiday++;
      else if (status === 'Weekly Off') counts.weeklyOff++;
    }
    counts.overtimeHours = Math.round(counts.overtimeHours * 100) / 100;

    if (p.status === 'Active') {
      for (let d = 1; d <= total; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        if (date > today) break;
        if (p.joinedOn && date < p.joinedOn) continue;
        if (!days[date]) counts.unmarked++;
      }
    }

    out.push({
      staffId: p.id,
      branchId: p.branchId,
      name: p.name,
      designation: p.designation,
      status: p.status,
      days,
      counts
    });
  }
  return out;
}
