import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { cashClosings, cashEntries } from './schema.cashBook.ts';
import { attendanceRecords, payrollRuns, payslips, salaryAdvances, staff } from './schema.staff.ts';

export class PayrollError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type RunRow = typeof payrollRuns.$inferSelect;
export type PayslipRow = typeof payslips.$inferSelect;
export type AdvanceRow = typeof salaryAdvances.$inferSelect;
type StaffRow = typeof staff.$inferSelect;
type AttendanceRow = typeof attendanceRecords.$inferSelect;
type Reader = Pick<typeof db, 'select'>;

export interface Access {
  isOwner: boolean;
  branchId: string;
}

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;
export const ADVANCE_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'] as const;

export interface PayslipView extends PayslipRow {
  payableDays: number;
  advanceBalance: number;
  hasUnmarkedDays: boolean;
}

export interface RunTotals {
  staffCount: number;
  paidCount: number;
  gross: number;
  net: number;
  paid: number;
  unpaid: number;
}

export interface RunDetail {
  run: RunRow;
  payslips: PayslipView[];
  totals: RunTotals;
  warnings: { unmarkedSlips: number; unmarkedDays: number; messages: string[] };
}

export interface RunListItem extends RunRow, RunTotals {}

export interface AdvanceView extends AdvanceRow {
  staffName: string;
  balance: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPS = 0.005;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
const pad = (n: number) => String(n).padStart(2, '0');

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function assertMonth(month: unknown): asserts month is string {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new PayrollError('Month must be in YYYY-MM format.');
}

export function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new PayrollError('Date must be in YYYY-MM-DD format.');
  }
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function assertBranch(access: Access, branchId: string): void {
  if (!access.isOwner && access.branchId !== branchId) {
    throw new PayrollError('You can only manage payroll of your own branch.', 403);
  }
}

interface Figures {
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  unpaidDays: number;
  unmarkedDays: number;
  overtimeHours: number;
  basicPay: number;
  overtimePay: number;
}

export function payableDaysOf(payType: string, s: { presentDays: number; halfDays: number; paidLeaveDays: number; holidayDays: number }): number {
  const worked = s.presentDays + 0.5 * s.halfDays + s.paidLeaveDays;
  return payType === 'daily' ? worked : worked + s.holidayDays;
}

function computeFigures(s: StaffRow, records: AttendanceRow[], month: string, today: string): Figures {
  const dim = daysInMonth(month);
  let presentDays = 0;
  let halfDays = 0;
  let paidLeaveDays = 0;
  let holidayDays = 0;
  let unpaidDays = 0;
  let overtimeHours = 0;
  const marked = new Set<number>();

  for (const r of records) {
    marked.add(Number(r.workDate.slice(8, 10)));
    overtimeHours += r.overtimeHours || 0;
    switch (r.status) {
      case 'Present': presentDays += 1; break;
      case 'Half Day': halfDays += 1; break;
      case 'Paid Leave': paidLeaveDays += 1; break;
      case 'Holiday':
      case 'Weekly Off': holidayDays += 1; break;
      case 'Absent':
      case 'Unpaid Leave': unpaidDays += 1; break;
      default: break;
    }
  }

  // Days before joining and days after today (for the running month) cannot be unmarked.
  let firstDay = 1;
  if (s.joinedOn && DATE_RE.test(s.joinedOn) && s.joinedOn.slice(0, 7) === month) firstDay = Number(s.joinedOn.slice(8, 10));
  const todayMonth = today.slice(0, 7);
  const lastDay = todayMonth === month ? Number(today.slice(8, 10)) : todayMonth > month ? dim : 0;
  let unmarkedDays = 0;
  for (let d = firstDay; d <= lastDay; d++) if (!marked.has(d)) unmarkedDays += 1;

  const monthly = s.payType !== 'daily';
  const perDay = monthly ? s.baseSalary / dim : s.baseSalary;
  const base = { presentDays, halfDays, paidLeaveDays, holidayDays };
  const payable = payableDaysOf(monthly ? 'monthly' : 'daily', base);
  const basicPay = monthly ? Math.min(s.baseSalary, round2(perDay * payable)) : round2(s.baseSalary * payable);
  const otRate = s.overtimeRate > 0 ? s.overtimeRate : (perDay / 8) * 1.5;

  return {
    ...base,
    unpaidDays,
    unmarkedDays,
    overtimeHours: round2(overtimeHours),
    basicPay,
    overtimePay: round2(overtimeHours * otRate)
  };
}

function totalsOf(basic: number, overtime: number, bonus: number, deductions: number, advance: number) {
  const grossPay = round2(basic + overtime + bonus);
  return { grossPay, netPay: round2(grossPay - deductions - advance) };
}

async function openBalances(r: Reader, staffIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (staffIds.length === 0) return map;
  const rows = await r
    .select({
      staffId: salaryAdvances.staffId,
      balance: sql<number>`coalesce(sum(${salaryAdvances.amount} - ${salaryAdvances.recoveredAmount}), 0)`
    })
    .from(salaryAdvances)
    .where(and(inArray(salaryAdvances.staffId, staffIds), eq(salaryAdvances.status, 'Open')))
    .groupBy(salaryAdvances.staffId);
  for (const row of rows) map.set(row.staffId, Math.max(0, round2(Number(row.balance) || 0)));
  return map;
}

function totalsFromSlips(slips: PayslipRow[]): RunTotals {
  const paidSlips = slips.filter((s) => s.status === 'Paid');
  const gross = round2(slips.reduce((a, s) => a + s.grossPay, 0));
  const net = round2(slips.reduce((a, s) => a + s.netPay, 0));
  const paid = round2(paidSlips.reduce((a, s) => a + s.netPay, 0));
  return { staffCount: slips.length, paidCount: paidSlips.length, gross, net, paid, unpaid: round2(net - paid) };
}

async function buildDetail(r: Reader, run: RunRow): Promise<RunDetail> {
  const slips = await r.select().from(payslips).where(eq(payslips.runId, run.id)).orderBy(asc(payslips.staffName));
  const balances = await openBalances(r, slips.map((s) => s.staffId));
  const views: PayslipView[] = slips.map((s) => ({
    ...s,
    payableDays: payableDaysOf(s.payType, s),
    advanceBalance: balances.get(s.staffId) ?? 0,
    hasUnmarkedDays: s.unmarkedDays > 0
  }));
  const unmarked = views.filter((v) => v.hasUnmarkedDays);
  const unmarkedDays = unmarked.reduce((a, v) => a + v.unmarkedDays, 0);
  const messages: string[] = [];
  if (unmarked.length > 0) {
    messages.push(`${unmarked.length} staff have ${unmarkedDays} unmarked attendance day(s) that are not paid until marked.`);
  }
  return {
    run,
    payslips: views,
    totals: totalsFromSlips(slips),
    warnings: { unmarkedSlips: unmarked.length, unmarkedDays, messages }
  };
}

async function loadRunLocked(tx: Reader, runId: string): Promise<RunRow> {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1).for('update');
  if (!run) throw new PayrollError('Payroll run not found.', 404);
  return run;
}

export async function getRunDetail(runId: string, access: Access): Promise<RunDetail> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw new PayrollError('Payroll run not found.', 404);
  assertBranch(access, run.branchId);
  return buildDetail(db, run);
}

export async function listRuns(branchId: string, month?: string): Promise<RunListItem[]> {
  const conditions = [];
  if (branchId !== 'all') conditions.push(eq(payrollRuns.branchId, branchId));
  if (month) conditions.push(eq(payrollRuns.month, month));
  const rows = await db
    .select({
      ...getTableColumns(payrollRuns),
      staffCount: sql<number>`count(${payslips.id})`,
      paidCount: sql<number>`count(*) filter (where ${payslips.status} = 'Paid')`,
      gross: sql<number>`coalesce(sum(${payslips.grossPay}), 0)`,
      net: sql<number>`coalesce(sum(${payslips.netPay}), 0)`,
      paid: sql<number>`coalesce(sum(case when ${payslips.status} = 'Paid' then ${payslips.netPay} else 0 end), 0)`
    })
    .from(payrollRuns)
    .leftJoin(payslips, eq(payslips.runId, payrollRuns.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(payrollRuns.id)
    .orderBy(desc(payrollRuns.month), asc(payrollRuns.branchId))
    .limit(120);
  return rows.map((r) => {
    const gross = round2(Number(r.gross) || 0);
    const net = round2(Number(r.net) || 0);
    const paid = round2(Number(r.paid) || 0);
    return {
      ...r,
      staffCount: Number(r.staffCount) || 0,
      paidCount: Number(r.paidCount) || 0,
      gross,
      net,
      paid,
      unpaid: round2(net - paid)
    };
  });
}

export async function generateRun(access: Access, branchId: string, month: string, createdBy?: string): Promise<RunDetail> {
  assertBranch(access, branchId);
  assertMonth(month);
  const today = istToday();
  if (month > today.slice(0, 7)) throw new PayrollError('Payroll cannot be generated for a future month.');
  const dim = daysInMonth(month);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${pad(dim)}`;

  const runId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.branchId, branchId), eq(payrollRuns.month, month)))
      .limit(1)
      .for('update');
    if (existing && existing.status !== 'Draft') {
      throw new PayrollError(`Payroll for ${month} is already finalized and cannot be regenerated.`, 409);
    }

    const roster = await tx
      .select()
      .from(staff)
      .where(and(eq(staff.branchId, branchId), eq(staff.status, 'Active')))
      .orderBy(asc(staff.name));
    const eligible = roster.filter((s) => !(s.joinedOn && DATE_RE.test(s.joinedOn) && s.joinedOn > monthEnd));
    if (eligible.length === 0) throw new PayrollError('No active staff found for this branch and month.');

    let run = existing;
    if (!run) {
      const [inserted] = await tx
        .insert(payrollRuns)
        .values({ id: uid('pr'), branchId, month, createdBy: createdBy || null })
        .onConflictDoNothing()
        .returning();
      if (!inserted) throw new PayrollError(`Payroll for ${month} was just created by someone else. Reload and try again.`, 409);
      run = inserted;
    }

    const previous = new Map<string, PayslipRow>();
    if (existing) {
      for (const s of await tx.select().from(payslips).where(eq(payslips.runId, run.id))) previous.set(s.staffId, s);
    }

    const ids = eligible.map((s) => s.id);
    const records = await tx
      .select()
      .from(attendanceRecords)
      .where(and(inArray(attendanceRecords.staffId, ids), gte(attendanceRecords.workDate, monthStart), lte(attendanceRecords.workDate, monthEnd)));
    const byStaff = new Map<string, AttendanceRow[]>();
    for (const rec of records) {
      const list = byStaff.get(rec.staffId);
      if (list) list.push(rec);
      else byStaff.set(rec.staffId, [rec]);
    }
    const balances = await openBalances(tx, ids);

    const rows: (typeof payslips.$inferInsert)[] = eligible.map((s) => {
      const f = computeFigures(s, byStaff.get(s.id) ?? [], month, today);
      const prev = previous.get(s.id);
      const balance = balances.get(s.id) ?? 0;
      const bonus = prev ? prev.bonus : 0;
      const earnedGross = round2(f.basicPay + f.overtimePay + bonus);
      const otherDeductions = prev ? round2(Math.min(prev.otherDeductions, earnedGross)) : 0;
      const advanceRecovered = prev
        ? round2(Math.max(0, Math.min(prev.advanceRecovered, balance, earnedGross - otherDeductions)))
        : round2(Math.min(balance, 0.5 * (f.basicPay + f.overtimePay)));
      const { grossPay, netPay } = totalsOf(f.basicPay, f.overtimePay, bonus, otherDeductions, advanceRecovered);
      return {
        id: uid('ps'),
        runId: run!.id,
        staffId: s.id,
        staffName: s.name,
        designation: s.designation,
        payType: s.payType === 'daily' ? 'daily' : 'monthly',
        baseRate: s.baseSalary,
        daysInMonth: dim,
        ...f,
        bonus,
        otherDeductions,
        advanceRecovered,
        grossPay,
        netPay,
        notes: prev?.notes ?? null,
        status: 'Unpaid'
      };
    });

    if (existing) await tx.delete(payslips).where(eq(payslips.runId, run.id));
    await tx.insert(payslips).values(rows);
    return run.id;
  });

  return getRunDetail(runId, access);
}

export interface PayslipPatch {
  bonus?: number;
  otherDeductions?: number;
  advanceRecovered?: number;
  notes?: string | null;
}

export async function updatePayslip(access: Access, slipId: string, patch: PayslipPatch): Promise<RunDetail> {
  const [pre] = await db.select({ runId: payslips.runId }).from(payslips).where(eq(payslips.id, slipId)).limit(1);
  if (!pre) throw new PayrollError('Payslip not found.', 404);

  const runId = await db.transaction(async (tx) => {
    const run = await loadRunLocked(tx, pre.runId);
    assertBranch(access, run.branchId);
    if (run.status !== 'Draft') throw new PayrollError('This payroll run is finalized; payslips are locked.', 409);

    const [slip] = await tx.select().from(payslips).where(eq(payslips.id, slipId)).limit(1);
    if (!slip) throw new PayrollError('Payslip not found.', 404);

    const bonus = patch.bonus !== undefined ? round2(patch.bonus) : slip.bonus;
    const otherDeductions = patch.otherDeductions !== undefined ? round2(patch.otherDeductions) : slip.otherDeductions;
    const advanceRecovered = patch.advanceRecovered !== undefined ? round2(patch.advanceRecovered) : slip.advanceRecovered;

    if (patch.advanceRecovered !== undefined && advanceRecovered > EPS) {
      const balance = (await openBalances(tx, [slip.staffId])).get(slip.staffId) ?? 0;
      if (advanceRecovered > balance + EPS) {
        throw new PayrollError(`Advance recovery cannot exceed the open advance balance (${balance.toFixed(2)}).`);
      }
    }

    const { grossPay, netPay } = totalsOf(slip.basicPay, slip.overtimePay, bonus, otherDeductions, advanceRecovered);
    if (netPay < 0) {
      throw new PayrollError(`This change would make net pay negative (${netPay.toFixed(2)}). Reduce deductions or advance recovery.`);
    }

    await tx
      .update(payslips)
      .set({
        bonus,
        otherDeductions,
        advanceRecovered,
        grossPay,
        netPay,
        notes: patch.notes !== undefined ? patch.notes : slip.notes
      })
      .where(eq(payslips.id, slipId));
    return run.id;
  });

  return getRunDetail(runId, access);
}

export async function finalizeRun(access: Access, runId: string): Promise<RunDetail> {
  await db.transaction(async (tx) => {
    const run = await loadRunLocked(tx, runId);
    assertBranch(access, run.branchId);
    if (run.status !== 'Draft') throw new PayrollError('This payroll run is already finalized.', 409);

    const slips = await tx.select().from(payslips).where(eq(payslips.runId, runId));
    if (slips.length === 0) throw new PayrollError('This payroll run has no payslips to finalize.');

    for (const slip of slips) {
      if (slip.netPay < 0) throw new PayrollError(`${slip.staffName}: net pay is negative. Fix it before finalizing.`);
      let remaining = slip.advanceRecovered;
      if (remaining <= EPS) continue;

      const open = await tx
        .select()
        .from(salaryAdvances)
        .where(and(eq(salaryAdvances.staffId, slip.staffId), eq(salaryAdvances.status, 'Open')))
        .orderBy(asc(salaryAdvances.givenOn), asc(salaryAdvances.createdAt))
        .for('update');

      for (const adv of open) {
        if (remaining <= EPS) break;
        const take = round2(Math.min(remaining, adv.amount - adv.recoveredAmount));
        if (take <= 0) continue;
        const recovered = round2(adv.recoveredAmount + take);
        await tx
          .update(salaryAdvances)
          .set({ recoveredAmount: recovered, status: adv.amount - recovered <= EPS ? 'Recovered' : 'Open' })
          .where(eq(salaryAdvances.id, adv.id));
        remaining = round2(remaining - take);
      }
      if (remaining > EPS) {
        throw new PayrollError(`${slip.staffName}: advance recovery exceeds the open advance balance. Regenerate or edit the payslip.`, 409);
      }
    }

    await tx.update(payrollRuns).set({ status: 'Finalized', finalizedAt: new Date() }).where(eq(payrollRuns.id, runId));
  });

  return getRunDetail(runId, access);
}

export interface PayInput {
  method: string;
  paidOn?: string;
  createdBy?: string;
}

export async function paySlip(access: Access, slipId: string, input: PayInput): Promise<RunDetail> {
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    throw new PayrollError(`Method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  }
  const today = istToday();
  const paidOn = input.paidOn || today;
  assertDate(paidOn);
  if (paidOn > today) throw new PayrollError('Payment date cannot be in the future.');

  const [pre] = await db.select({ runId: payslips.runId }).from(payslips).where(eq(payslips.id, slipId)).limit(1);
  if (!pre) throw new PayrollError('Payslip not found.', 404);

  const runId = await db.transaction(async (tx) => {
    const run = await loadRunLocked(tx, pre.runId);
    assertBranch(access, run.branchId);
    if (run.status !== 'Finalized') throw new PayrollError('Finalize the payroll run before paying salaries.', 409);

    const [slip] = await tx.select().from(payslips).where(eq(payslips.id, slipId)).limit(1);
    if (!slip) throw new PayrollError('Payslip not found.', 404);
    if (slip.status === 'Paid') throw new PayrollError('This payslip is already paid.', 409);

    await tx.update(payslips).set({ status: 'Paid', paidOn, paymentMethod: input.method }).where(eq(payslips.id, slipId));

    // A fully-recovered slip has nothing to disburse, so no cash movement is recorded.
    if (slip.netPay > 0) {
      await tx.insert(cashEntries).values({
        id: uid('ce'),
        branchId: run.branchId,
        entryDate: paidOn,
        type: 'out',
        category: 'Salary',
        amount: slip.netPay,
        method: input.method,
        description: `Salary ${run.month} - ${slip.staffName}`,
        createdBy: input.createdBy || null
      });
    }
    return run.id;
  });

  return getRunDetail(runId, access);
}

// Settle and pay together: whatever the person still owes on advances is taken out of this payslip
// (as much as the salary covers), and the rest is paid. Only for a finalized, unpaid payslip.
export async function settleAndPaySlip(access: Access, slipId: string, input: PayInput): Promise<RunDetail> {
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    throw new PayrollError(`Method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  }
  const today = istToday();
  const paidOn = input.paidOn || today;
  assertDate(paidOn);
  if (paidOn > today) throw new PayrollError('Payment date cannot be in the future.');

  const [pre] = await db.select({ runId: payslips.runId }).from(payslips).where(eq(payslips.id, slipId)).limit(1);
  if (!pre) throw new PayrollError('Payslip not found.', 404);

  const runId = await db.transaction(async (tx) => {
    const run = await loadRunLocked(tx, pre.runId);
    assertBranch(access, run.branchId);
    if (run.status !== 'Finalized') throw new PayrollError('Finalize the payroll run before settling and paying salaries.', 409);

    const [slip] = await tx.select().from(payslips).where(eq(payslips.id, slipId)).for('update').limit(1);
    if (!slip) throw new PayrollError('Payslip not found.', 404);
    if (slip.status === 'Paid') throw new PayrollError('This payslip is already paid.', 409);

    const open = await tx
      .select()
      .from(salaryAdvances)
      .where(and(eq(salaryAdvances.staffId, slip.staffId), eq(salaryAdvances.status, 'Open')))
      .orderBy(asc(salaryAdvances.givenOn), asc(salaryAdvances.createdAt))
      .for('update');
    const owed = round2(open.reduce((a, adv) => a + (adv.amount - adv.recoveredAmount), 0));
    let extra = round2(Math.min(owed, Math.max(0, slip.netPay)));
    if (extra <= EPS) throw new PayrollError('This person has no advance balance to settle. Use Pay instead.', 409);

    let remaining = extra;
    for (const adv of open) {
      if (remaining <= EPS) break;
      const take = round2(Math.min(remaining, adv.amount - adv.recoveredAmount));
      if (take <= 0) continue;
      const recovered = round2(adv.recoveredAmount + take);
      await tx
        .update(salaryAdvances)
        .set({ recoveredAmount: recovered, status: adv.amount - recovered <= EPS ? 'Recovered' : 'Open' })
        .where(eq(salaryAdvances.id, adv.id));
      remaining = round2(remaining - take);
    }
    extra = round2(extra - remaining);

    const advanceRecovered = round2(slip.advanceRecovered + extra);
    const netPay = round2(slip.netPay - extra);
    const note = `Settled: ${extra.toFixed(2)} advance taken from this salary.`;
    await tx
      .update(payslips)
      .set({
        advanceRecovered,
        netPay,
        status: 'Paid',
        paidOn,
        paymentMethod: input.method,
        notes: slip.notes ? `${slip.notes} ${note}`.slice(0, 500) : note
      })
      .where(eq(payslips.id, slipId));

    // Only the part actually handed over is a cash movement.
    if (netPay > 0) {
      await tx.insert(cashEntries).values({
        id: uid('ce'),
        branchId: run.branchId,
        entryDate: paidOn,
        type: 'out',
        category: 'Salary',
        amount: netPay,
        method: input.method,
        description: `Salary ${run.month} - ${slip.staffName} (after advance ${extra.toFixed(2)})`.slice(0, 300),
        createdBy: input.createdBy || null
      });
    }
    return run.id;
  });

  return getRunDetail(runId, access);
}

export async function listAdvances(
  branchId: string,
  filters: { staffId?: string; status?: string } = {}
): Promise<AdvanceView[]> {
  const conditions = [];
  if (branchId !== 'all') conditions.push(eq(salaryAdvances.branchId, branchId));
  if (filters.staffId) conditions.push(eq(salaryAdvances.staffId, filters.staffId));
  if (filters.status) conditions.push(eq(salaryAdvances.status, filters.status));
  const rows = await db
    .select({ ...getTableColumns(salaryAdvances), staffName: staff.name })
    .from(salaryAdvances)
    .innerJoin(staff, eq(salaryAdvances.staffId, staff.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(salaryAdvances.givenOn), desc(salaryAdvances.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, balance: Math.max(0, round2(r.amount - r.recoveredAmount)) }));
}

export interface AdvanceInput {
  branchId: string;
  staffId: string;
  amount: number;
  method: string;
  reason?: string;
  givenOn?: string;
  createdBy?: string;
}

export async function createAdvance(access: Access, input: AdvanceInput): Promise<AdvanceView> {
  assertBranch(access, input.branchId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new PayrollError('Advance amount must be greater than zero.');
  if (!(ADVANCE_METHODS as readonly string[]).includes(input.method)) {
    throw new PayrollError(`Method must be one of: ${ADVANCE_METHODS.join(', ')}.`);
  }
  const today = istToday();
  const givenOn = input.givenOn || today;
  assertDate(givenOn);
  if (givenOn > today) throw new PayrollError('Advance date cannot be in the future.');
  const amount = round2(input.amount);

  const advance = await db.transaction(async (tx) => {
    const [member] = await tx.select().from(staff).where(eq(staff.id, input.staffId)).limit(1);
    if (!member || member.branchId !== input.branchId) throw new PayrollError('Staff member not found in this branch.', 404);

    const [row] = await tx
      .insert(salaryAdvances)
      .values({
        id: uid('adv'),
        staffId: member.id,
        branchId: input.branchId,
        amount,
        givenOn,
        method: input.method,
        reason: input.reason || null,
        createdBy: input.createdBy || null
      })
      .returning();

    await tx.insert(cashEntries).values({
      id: uid('ce'),
      branchId: input.branchId,
      entryDate: givenOn,
      type: 'out',
      category: 'Salary advance',
      amount,
      method: input.method,
      description: `Advance - ${member.name}${input.reason ? `: ${input.reason}` : ''}`.slice(0, 300),
      createdBy: input.createdBy || null
    });
    return { ...row, staffName: member.name, balance: amount };
  });
  return advance;
}

// Removes an advance that was entered by mistake, together with its cash book entry.
// Not allowed once any of it has been taken back from a salary, or when the cash book day is closed.
export async function deleteAdvance(access: Access, advanceId: string): Promise<{ id: string; staffName: string; amount: number }> {
  return db.transaction(async (tx) => {
    const [adv] = await tx.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId)).for('update').limit(1);
    if (!adv) throw new PayrollError('Advance not found.', 404);
    assertBranch(access, adv.branchId);
    if (adv.recoveredAmount > EPS) {
      throw new PayrollError('Part of this advance has already been recovered from a salary, so it cannot be deleted.', 409);
    }
    const [member] = await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, adv.staffId)).limit(1);
    const name = member?.name || 'staff';

    // The cash entry is not linked by id, so find the one written with this advance.
    const [entry] = await tx
      .select({ id: cashEntries.id })
      .from(cashEntries)
      .where(
        and(
          eq(cashEntries.branchId, adv.branchId),
          eq(cashEntries.entryDate, adv.givenOn),
          eq(cashEntries.type, 'out'),
          eq(cashEntries.category, 'Salary advance'),
          eq(cashEntries.amount, adv.amount),
          eq(cashEntries.method, adv.method),
          sql`${cashEntries.description} like ${`Advance - ${name}%`}`
        )
      )
      .orderBy(desc(cashEntries.createdAt))
      .limit(1);
    if (entry) {
      const [closing] = await tx
        .select({ id: cashClosings.id })
        .from(cashClosings)
        .where(and(eq(cashClosings.branchId, adv.branchId), eq(cashClosings.businessDate, adv.givenOn)))
        .limit(1);
      if (closing) throw new PayrollError(`The cash book for ${adv.givenOn} is already closed. Ask an owner to reopen it first.`, 409);
      await tx.delete(cashEntries).where(eq(cashEntries.id, entry.id));
    }
    await tx.delete(salaryAdvances).where(eq(salaryAdvances.id, advanceId));

    // A draft payslip must not plan to recover more than what is still owed.
    const [bal] = await tx
      .select({ open: sql<number>`coalesce(sum(${salaryAdvances.amount} - ${salaryAdvances.recoveredAmount}), 0)` })
      .from(salaryAdvances)
      .where(and(eq(salaryAdvances.staffId, adv.staffId), eq(salaryAdvances.status, 'Open')));
    const stillOwed = round2(Number(bal?.open) || 0);
    const [clash] = await tx
      .select({ id: payslips.id })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
      .where(and(eq(payslips.staffId, adv.staffId), eq(payrollRuns.status, 'Draft'), sql`${payslips.advanceRecovered} > ${stillOwed + EPS}`))
      .limit(1);
    if (clash) {
      throw new PayrollError(`${name} has a draft payslip that recovers this advance. Set its advance recovery to the new balance (${stillOwed.toFixed(2)}) first, then delete.`, 409);
    }
    return { id: adv.id, staffName: name, amount: adv.amount };
  });
}

export async function getSummary(branchId: string, month: string) {
  assertMonth(month);
  const runs = await listRuns(branchId, month);
  const advConditions = [eq(salaryAdvances.status, 'Open')];
  if (branchId !== 'all') advConditions.push(eq(salaryAdvances.branchId, branchId));
  const [adv] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(${salaryAdvances.amount} - ${salaryAdvances.recoveredAmount}), 0)`,
      openCount: sql<number>`count(*)`
    })
    .from(salaryAdvances)
    .where(and(...advConditions));

  const statuses = new Set(runs.map((r) => r.status));
  const sum = (pick: (r: RunListItem) => number) => round2(runs.reduce((a, r) => a + pick(r), 0));
  return {
    month,
    branchId,
    runCount: runs.length,
    runStatus: runs.length === 0 ? null : statuses.size === 1 ? runs[0].status : 'Mixed',
    staffCount: runs.reduce((a, r) => a + r.staffCount, 0),
    gross: sum((r) => r.gross),
    net: sum((r) => r.net),
    paid: sum((r) => r.paid),
    unpaid: sum((r) => r.unpaid),
    advancesOutstanding: round2(Number(adv?.outstanding) || 0),
    openAdvanceCount: Number(adv?.openCount) || 0
  };
}
