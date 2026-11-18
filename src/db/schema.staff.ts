import { doublePrecision, index, integer, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

// Shop staff roster (separate from Firebase login users; optionally linked by uid).
// payType: 'monthly' (baseSalary = monthly amount) | 'daily' (baseSalary = per-day wage)
export const staff = pgTable(
  'staff',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    designation: text('designation'),
    payType: text('pay_type').default('monthly').notNull(),
    baseSalary: doublePrecision('base_salary').default(0).notNull(),
    overtimeRate: doublePrecision('overtime_rate').default(0).notNull(), // per hour; 0 = derive from daily rate
    joinedOn: text('joined_on'),
    status: text('status').default('Active').notNull(), // Active | Inactive
    uid: text('uid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (t) => [index('idx_staff_branch').on(t.branchId), index('idx_staff_status').on(t.status)]
);

// One row per staff member per day.
// status: Present | Absent | Half Day | Paid Leave | Unpaid Leave | Holiday | Weekly Off
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: serial('id').primaryKey(),
    staffId: text('staff_id')
      .references(() => staff.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: text('branch_id').notNull(),
    workDate: text('work_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull(),
    checkIn: text('check_in'), // HH:MM
    checkOut: text('check_out'), // HH:MM
    overtimeHours: doublePrecision('overtime_hours').default(0).notNull(),
    notes: text('notes'),
    markedBy: text('marked_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (t) => [
    unique('uq_attendance_staff_date').on(t.staffId, t.workDate),
    index('idx_attendance_branch_date').on(t.branchId, t.workDate)
  ]
);

// Cash or other advances given to staff, recovered through payroll.
export const salaryAdvances = pgTable(
  'salary_advances',
  {
    id: text('id').primaryKey(),
    staffId: text('staff_id')
      .references(() => staff.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: text('branch_id').notNull(),
    amount: doublePrecision('amount').notNull(),
    recoveredAmount: doublePrecision('recovered_amount').default(0).notNull(),
    givenOn: text('given_on').notNull(), // YYYY-MM-DD
    method: text('method').default('Cash').notNull(),
    reason: text('reason'),
    status: text('status').default('Open').notNull(), // Open | Recovered
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_salary_advances_staff').on(t.staffId), index('idx_salary_advances_branch').on(t.branchId)]
);

// One payroll run per branch per month. status: Draft | Finalized
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull(),
    month: text('month').notNull(), // YYYY-MM
    status: text('status').default('Draft').notNull(),
    createdBy: text('created_by'),
    finalizedAt: timestamp('finalized_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [unique('uq_payroll_branch_month').on(t.branchId, t.month)]
);

// One payslip per staff member per run (staff details are snapshotted).
// status: Unpaid | Paid
export const payslips = pgTable(
  'payslips',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .references(() => payrollRuns.id, { onDelete: 'cascade' })
      .notNull(),
    staffId: text('staff_id').notNull(),
    staffName: text('staff_name').notNull(),
    designation: text('designation'),
    payType: text('pay_type').notNull(),
    baseRate: doublePrecision('base_rate').notNull(),
    daysInMonth: integer('days_in_month').notNull(),
    presentDays: doublePrecision('present_days').default(0).notNull(),
    halfDays: doublePrecision('half_days').default(0).notNull(),
    paidLeaveDays: doublePrecision('paid_leave_days').default(0).notNull(),
    holidayDays: doublePrecision('holiday_days').default(0).notNull(),
    unpaidDays: doublePrecision('unpaid_days').default(0).notNull(),
    unmarkedDays: doublePrecision('unmarked_days').default(0).notNull(),
    overtimeHours: doublePrecision('overtime_hours').default(0).notNull(),
    basicPay: doublePrecision('basic_pay').default(0).notNull(),
    overtimePay: doublePrecision('overtime_pay').default(0).notNull(),
    bonus: doublePrecision('bonus').default(0).notNull(),
    otherDeductions: doublePrecision('other_deductions').default(0).notNull(),
    advanceRecovered: doublePrecision('advance_recovered').default(0).notNull(),
    grossPay: doublePrecision('gross_pay').default(0).notNull(),
    netPay: doublePrecision('net_pay').default(0).notNull(),
    notes: text('notes'),
    status: text('status').default('Unpaid').notNull(),
    paidOn: text('paid_on'),
    paymentMethod: text('payment_method'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_payslips_run').on(t.runId), index('idx_payslips_staff').on(t.staffId)]
);
