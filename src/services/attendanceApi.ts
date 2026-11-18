import { apiRequest, type ApiScope } from './apiClient';

export type AttendanceStatus = 'Present' | 'Absent' | 'Half Day' | 'Paid Leave' | 'Unpaid Leave' | 'Holiday' | 'Weekly Off';
export type PayType = 'monthly' | 'daily';
export type StaffStatus = 'Active' | 'Inactive';

export interface StaffMember {
  id: string;
  branchId: string;
  name: string;
  phone: string | null;
  designation: string | null;
  payType: PayType;
  baseSalary?: number; // omitted by the server for roles that cannot see pay
  overtimeRate?: number;
  joinedOn: string | null;
  status: StaffStatus;
  uid: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffPayload {
  branchId?: string;
  name?: string;
  phone?: string;
  designation?: string;
  payType?: PayType;
  baseSalary?: number;
  overtimeRate?: number;
  joinedOn?: string;
  status?: StaffStatus;
}

export interface DayRecord {
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  overtimeHours: number;
  notes: string | null;
}

export interface DayEntry {
  staffId: string;
  name: string;
  designation: string | null;
  record: DayRecord | null;
}

export interface DayResponse {
  date: string;
  branchId: string;
  entries: DayEntry[];
}

export interface DayRecordInput {
  staffId: string;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  overtimeHours?: number;
  notes?: string | null;
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
  status: StaffStatus;
  days: Record<string, { status: AttendanceStatus; overtimeHours: number }>;
  counts: MonthCounts;
}

export interface MonthResponse {
  month: string;
  branchId: string;
  today: string;
  staff: MonthEntry[];
}

export const attendanceApi = {
  listStaff: (scope: ApiScope, branchId: string, status?: StaffStatus) =>
    apiRequest<StaffMember[]>('/staff', scope, { query: { branch_id: branchId, status } }),
  createStaff: (scope: ApiScope, body: StaffPayload & { branchId: string; name: string }) =>
    apiRequest<StaffMember>('/staff', scope, { method: 'POST', body }),
  updateStaff: (scope: ApiScope, id: string, body: StaffPayload) =>
    apiRequest<StaffMember>(`/staff/${encodeURIComponent(id)}`, scope, { method: 'PATCH', body }),
  getDay: (scope: ApiScope, branchId: string, date: string) =>
    apiRequest<DayResponse>('/attendance/day', scope, { query: { branch_id: branchId, date } }),
  saveDay: (
    scope: ApiScope,
    body: { branchId: string; date: string; records?: DayRecordInput[]; markAllAs?: AttendanceStatus; markedBy?: string }
  ) => apiRequest<DayResponse & { saved: number }>('/attendance/day', scope, { method: 'PUT', body }),
  getMonth: (scope: ApiScope, branchId: string, month: string) =>
    apiRequest<MonthResponse>('/attendance/month', scope, { query: { branch_id: branchId, month } })
};
