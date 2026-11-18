import { and, asc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { staff } from './schema.staff.ts';

export class StaffError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type StaffRow = typeof staff.$inferSelect;
export type StaffStatus = 'Active' | 'Inactive';
export type PayType = 'monthly' | 'daily';

export interface StaffInput {
  branchId: string;
  name: string;
  phone?: string | null;
  designation?: string | null;
  payType?: PayType;
  baseSalary?: number;
  overtimeRate?: number;
  joinedOn?: string | null;
}

export interface StaffPatch {
  branchId?: string;
  name?: string;
  phone?: string | null;
  designation?: string | null;
  payType?: PayType;
  baseSalary?: number;
  overtimeRate?: number;
  joinedOn?: string | null;
  status?: StaffStatus;
}

// Pay figures are only visible to roles that handle payroll.
export function redactStaff(row: StaffRow, includePay: boolean): Omit<StaffRow, 'baseSalary' | 'overtimeRate'> & Partial<Pick<StaffRow, 'baseSalary' | 'overtimeRate'>> {
  if (includePay) return row;
  const { baseSalary: _b, overtimeRate: _o, ...rest } = row;
  return rest;
}

export async function listStaff(branchId: string, status?: StaffStatus): Promise<StaffRow[]> {
  const conditions = [];
  if (branchId !== 'all') conditions.push(eq(staff.branchId, branchId));
  if (status) conditions.push(eq(staff.status, status));
  return db
    .select()
    .from(staff)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(staff.name));
}

export async function getStaff(id: string): Promise<StaffRow | null> {
  const rows = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createStaff(input: StaffInput, id: string): Promise<StaffRow> {
  const [row] = await db
    .insert(staff)
    .values({
      id,
      branchId: input.branchId,
      name: input.name,
      phone: input.phone ?? null,
      designation: input.designation ?? null,
      payType: input.payType ?? 'monthly',
      baseSalary: input.baseSalary ?? 0,
      overtimeRate: input.overtimeRate ?? 0,
      joinedOn: input.joinedOn ?? null
    })
    .returning();
  return row;
}

export async function updateStaff(id: string, patch: StaffPatch): Promise<StaffRow> {
  const values: Partial<typeof staff.$inferInsert> = { updatedAt: new Date() };
  if (patch.branchId !== undefined) values.branchId = patch.branchId;
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.phone !== undefined) values.phone = patch.phone;
  if (patch.designation !== undefined) values.designation = patch.designation;
  if (patch.payType !== undefined) values.payType = patch.payType;
  if (patch.baseSalary !== undefined) values.baseSalary = patch.baseSalary;
  if (patch.overtimeRate !== undefined) values.overtimeRate = patch.overtimeRate;
  if (patch.joinedOn !== undefined) values.joinedOn = patch.joinedOn;
  if (patch.status !== undefined) values.status = patch.status;

  const [row] = await db.update(staff).set(values).where(eq(staff.id, id)).returning();
  if (!row) throw new StaffError('Staff member not found.', 404);
  return row;
}
