import type { Express, Request, Response } from 'express';
import {
  ATTENDANCE_STATUSES,
  getDay,
  getMonth,
  isValidDate,
  isValidMonth,
  saveDay,
  type AttendanceStatus,
  type DayRecordInput
} from '../db/attendanceService.ts';
import {
  StaffError,
  createStaff,
  getStaff,
  listStaff,
  redactStaff,
  updateStaff,
  type StaffPatch,
  type StaffStatus
} from '../db/staffService.ts';
import { actorName, addDays, businessDate, getAuthContext, newId, scopedBranch } from './context.ts';

const MANAGE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager', 'Branch Person', 'Accountant'];
const PAY_ROLES = ['Super Admin', 'Business Owner', 'Accountant'];
// Marking and viewing attendance: Super Admin, owner and branch manager only.
const ATTENDANCE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager'];
const HISTORY_DAYS = 62;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(res: Response, e: any, label: string) {
  if (e instanceof StaffError) return res.status(e.status).json({ error: e.message });
  console.error(`${label}:`, e);
  return res.status(500).json({ error: e.message || label });
}

// Returns false (after sending 403) when the caller's role may not manage staff or attendance.
function allowed(req: Request, res: Response): boolean {
  const { role } = getAuthContext(req);
  if (MANAGE_ROLES.includes(role)) return true;
  res.status(403).json({ error: 'Your role does not have access to staff and attendance.' });
  return false;
}

function allowedAttendance(req: Request, res: Response): boolean {
  const { role } = getAuthContext(req);
  if (ATTENDANCE_ROLES.includes(role)) return true;
  res.status(403).json({ error: 'Staff attendance is only for the Super Admin, owner and branch manager.' });
  return false;
}

function canSeePay(req: Request): boolean {
  return PAY_ROLES.includes(getAuthContext(req).role);
}

function writeBranch(req: Request): string | null {
  const { isOwner, branchId } = getAuthContext(req);
  if (!isOwner) return branchId;
  const requested = (req.body?.branchId as string) || (req.query.branch_id as string);
  return requested && requested !== 'all' ? requested : null;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, max);
  return t || null;
}

function nonNegative(raw: unknown, label: string): number {
  const n = Number(raw);
  if (raw === '' || raw === null || !Number.isFinite(n) || n < 0) {
    throw new StaffError(`${label} must be a number of zero or more.`);
  }
  return Math.round(n * 100) / 100;
}

export function registerAttendanceRoutes(app: Express): void {
  app.get('/api/staff', async (req: Request, res: Response) => {
    try {
      if (!allowed(req, res)) return;
      const rawStatus = req.query.status as string | undefined;
      const status: StaffStatus | undefined = rawStatus === 'Active' || rawStatus === 'Inactive' ? rawStatus : undefined;
      const rows = await listStaff(scopedBranch(req), status);
      const pay = canSeePay(req);
      res.json(rows.map((r) => redactStaff(r, pay)));
    } catch (e: any) {
      fail(res, e, 'Failed to load staff');
    }
  });

  app.post('/api/staff', async (req: Request, res: Response) => {
    try {
      if (!allowed(req, res)) return;
      const body = req.body || {};
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to add a staff member.' });

      const name = text(body.name, 80);
      if (!name) return res.status(400).json({ error: 'Name is required.' });
      const payType = body.payType ?? 'monthly';
      if (payType !== 'monthly' && payType !== 'daily') {
        return res.status(400).json({ error: 'Pay type must be "monthly" or "daily".' });
      }
      const joinedOn = text(body.joinedOn, 10);
      if (joinedOn && !isValidDate(joinedOn)) return res.status(400).json({ error: 'Joined date must be YYYY-MM-DD.' });

      const pay = canSeePay(req);
      const row = await createStaff(
        {
          branchId: branch,
          name,
          phone: text(body.phone, 20),
          designation: text(body.designation, 60),
          payType,
          baseSalary: pay && body.baseSalary !== undefined ? nonNegative(body.baseSalary, 'Base salary') : 0,
          overtimeRate: pay && body.overtimeRate !== undefined ? nonNegative(body.overtimeRate, 'Overtime rate') : 0,
          joinedOn
        },
        newId('st')
      );
      res.status(201).json(redactStaff(row, pay));
    } catch (e: any) {
      fail(res, e, 'Failed to add staff member');
    }
  });

  app.patch('/api/staff/:id', async (req: Request, res: Response) => {
    try {
      if (!allowed(req, res)) return;
      const { isOwner, branchId } = getAuthContext(req);
      const body = req.body || {};
      const existing = await getStaff(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Staff member not found.' });
      if (!isOwner && existing.branchId !== branchId) {
        return res.status(403).json({ error: 'You can only edit staff of your own branch.' });
      }

      const patch: StaffPatch = {};
      if (body.name !== undefined) {
        const name = text(body.name, 80);
        if (!name) return res.status(400).json({ error: 'Name is required.' });
        patch.name = name;
      }
      if (body.phone !== undefined) patch.phone = text(body.phone, 20);
      if (body.designation !== undefined) patch.designation = text(body.designation, 60);
      if (body.payType !== undefined) {
        if (body.payType !== 'monthly' && body.payType !== 'daily') {
          return res.status(400).json({ error: 'Pay type must be "monthly" or "daily".' });
        }
        patch.payType = body.payType;
      }
      if (body.joinedOn !== undefined) {
        const joinedOn = text(body.joinedOn, 10);
        if (joinedOn && !isValidDate(joinedOn)) return res.status(400).json({ error: 'Joined date must be YYYY-MM-DD.' });
        patch.joinedOn = joinedOn;
      }
      if (body.status !== undefined) {
        if (body.status !== 'Active' && body.status !== 'Inactive') {
          return res.status(400).json({ error: 'Status must be "Active" or "Inactive".' });
        }
        patch.status = body.status;
      }
      if (body.branchId !== undefined && body.branchId !== existing.branchId) {
        if (!isOwner) return res.status(403).json({ error: 'Only an owner can move staff to another branch.' });
        if (!body.branchId || body.branchId === 'all') return res.status(400).json({ error: 'Choose a specific branch.' });
        patch.branchId = body.branchId;
      }

      const pay = canSeePay(req);
      if (pay && body.baseSalary !== undefined) patch.baseSalary = nonNegative(body.baseSalary, 'Base salary');
      if (pay && body.overtimeRate !== undefined) patch.overtimeRate = nonNegative(body.overtimeRate, 'Overtime rate');

      const row = await updateStaff(existing.id, patch);
      res.json(redactStaff(row, pay));
    } catch (e: any) {
      fail(res, e, 'Failed to update staff member');
    }
  });

  app.get('/api/attendance/day', async (req: Request, res: Response) => {
    try {
      if (!allowedAttendance(req, res)) return;
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : businessDate();
      if (!isValidDate(date)) return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
      const branch = scopedBranch(req);
      if (branch === 'all') return res.status(400).json({ error: 'Select a specific branch to view daily attendance.' });
      res.json({ date, branchId: branch, entries: await getDay(branch, date) });
    } catch (e: any) {
      fail(res, e, 'Failed to load attendance');
    }
  });

  app.put('/api/attendance/day', async (req: Request, res: Response) => {
    try {
      if (!allowedAttendance(req, res)) return;
      const { isOwner, role } = getAuthContext(req);
      const body = req.body || {};
      const branch = writeBranch(req);
      if (!branch) return res.status(400).json({ error: 'Select a specific branch to mark attendance.' });

      const today = businessDate();
      const date = typeof body.date === 'string' && body.date ? body.date : today;
      if (!isValidDate(date)) return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
      if (date > today) return res.status(400).json({ error: 'Attendance cannot be marked for a future date.' });
      if (!isOwner && date < addDays(today, -HISTORY_DAYS)) {
        return res.status(400).json({ error: `Attendance older than ${HISTORY_DAYS} days can only be changed by an owner.` });
      }

      let markAllAs: AttendanceStatus | null = null;
      if (body.markAllAs !== undefined && body.markAllAs !== null && body.markAllAs !== '') {
        if (!ATTENDANCE_STATUSES.includes(body.markAllAs)) {
          return res.status(400).json({ error: `markAllAs must be one of: ${ATTENDANCE_STATUSES.join(', ')}.` });
        }
        markAllAs = body.markAllAs;
      }

      if (body.records !== undefined && !Array.isArray(body.records)) {
        return res.status(400).json({ error: 'records must be an array.' });
      }
      const rawRecords: any[] = body.records || [];
      if (rawRecords.length === 0 && !markAllAs) return res.status(400).json({ error: 'No attendance records to save.' });
      if (rawRecords.length > 500) return res.status(400).json({ error: 'Too many records in one request.' });

      const seen = new Set<string>();
      const records: DayRecordInput[] = [];
      for (const r of rawRecords) {
        if (!r || typeof r.staffId !== 'string' || !r.staffId) return res.status(400).json({ error: 'Each record needs a staffId.' });
        if (seen.has(r.staffId)) return res.status(400).json({ error: 'A staff member appears more than once.' });
        seen.add(r.staffId);
        if (!ATTENDANCE_STATUSES.includes(r.status)) {
          return res.status(400).json({ error: `Status must be one of: ${ATTENDANCE_STATUSES.join(', ')}.` });
        }
        const checkIn = text(r.checkIn, 5);
        const checkOut = text(r.checkOut, 5);
        if ((checkIn && !TIME_RE.test(checkIn)) || (checkOut && !TIME_RE.test(checkOut))) {
          return res.status(400).json({ error: 'Times must be in HH:MM format.' });
        }
        let overtimeHours = 0;
        if (r.overtimeHours !== undefined && r.overtimeHours !== null && r.overtimeHours !== '') {
          overtimeHours = Number(r.overtimeHours);
          if (!Number.isFinite(overtimeHours) || overtimeHours < 0 || overtimeHours > 12) {
            return res.status(400).json({ error: 'Overtime hours must be between 0 and 12.' });
          }
          overtimeHours = Math.round(overtimeHours * 100) / 100;
        }
        records.push({ staffId: r.staffId, status: r.status, checkIn, checkOut, overtimeHours, notes: text(r.notes, 200) });
      }

      const markedBy = actorName(req, body.markedBy, role);
      const result = await saveDay(branch, date, records, markAllAs, markedBy);
      res.json({ ...result, date, branchId: branch, entries: await getDay(branch, date) });
    } catch (e: any) {
      fail(res, e, 'Failed to save attendance');
    }
  });

  app.get('/api/attendance/month', async (req: Request, res: Response) => {
    try {
      if (!allowedAttendance(req, res)) return;
      const today = businessDate();
      const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : today.slice(0, 7);
      if (!isValidMonth(month)) return res.status(400).json({ error: 'Month must be in YYYY-MM format.' });
      const branch = scopedBranch(req);
      res.json({ month, branchId: branch, today, staff: await getMonth(branch, month, today) });
    } catch (e: any) {
      fail(res, e, 'Failed to load monthly attendance');
    }
  });
}
