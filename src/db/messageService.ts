import { and, desc, eq, gt, lt, gte, lte, ne, or, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from './index.ts';
import { customers, invoices, warranties } from './schema.ts';
import { jobCards } from './schema.jobCards.ts';
import { messageLog } from './schema.messages.ts';
import { addDays, businessDate, newId } from '../routes/context.ts';

export const MESSAGE_KINDS = ['payment-reminder', 'warranty-expiry', 'job-ready', 'invoice', 'custom', 'marketing', 'thank-you'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

const QUEUE_CAP = 200;
const WARRANTY_AHEAD_DAYS = 30;
const WARRANTY_BEHIND_DAYS = 15;

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// Latest log time for the same ref, as an ISO string (created_at is stored in UTC).
function lastMessagedAt(refType: string, refCol: AnyColumn) {
  return sql<string | null>`(select to_char(max(${messageLog.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from ${messageLog} where ${messageLog.refType} = ${refType} and ${messageLog.refId} = ${refCol})`;
}

function branchCond(col: AnyColumn, branchId: string): SQL | undefined {
  return branchId && branchId !== 'all' ? eq(col, branchId) : undefined;
}

// Everyone who still owes money, from every place a balance can sit: shop invoices, machine sales and job cards.
// A bill that is not yet due is listed too (daysOverdue 0); old bills entered from the bill files never are.
// A machine sale counts what the customer himself owes, so a subsidy still to come from the department is not asked of him.
export interface PendingPaymentRow {
  source: 'invoice' | 'machine-sale' | 'job-card';
  invoiceId: string; // id of the invoice, machine sale or job card
  invoiceNumber: string;
  branchId: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  alternatePhone: string | null;
  balance: number;
  dueDate: string | null;
  billDate: string | null;
  daysOverdue: number;
  lastMessagedAt: string | null;
}

const lastMsgSql = (refType: string, idCol: string) =>
  sql`(select to_char(max(ml.created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from message_log ml where ml.ref_type = ${refType} and ml.ref_id = ${sql.raw(idCol)})`;

export async function getPendingPayments(branchId: string): Promise<PendingPaymentRow[]> {
  const today = businessDate();
  const bf = (col: string) => (branchId && branchId !== 'all' ? sql`and ${sql.raw(col)} = ${branchId}` : sql``);
  const res = await db.execute(sql`
    select * from (
      select 'invoice'::text as source, d.id as ref_id, d.doc_number as number, d.branch_id, d.customer_id, d.customer_name,
        coalesce(nullif(c.phone, ''), nullif(d.customer_phone, '')) as phone, c.alternate_phone,
        (d.grand_total - d.paid_amount)::float8 as balance, d.due_date, d.doc_date as bill_date, ${lastMsgSql('invoice', 'd.id')} as last_msg
      from documents d left join customers c on c.id = d.customer_id
      where d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and not d.is_historical and d.source_machine_sale_id is null
        and d.grand_total - d.paid_amount > 0.005 ${bf('d.branch_id')}
      union all
      select 'machine-sale', m.id, m.sale_number, m.branch_id, m.customer_id, m.customer_name,
        coalesce(nullif(c.phone, ''), nullif(m.customer_phone, '')), c.alternate_phone, x.rem::float8, null, m.booking_date, ${lastMsgSql('machine-sale', 'm.id')}
      from machine_sales m
      left join customers c on c.id = m.customer_id
      cross join lateral (select greatest(m.sale_price
          - coalesce((select sum(p.amount) from machine_sale_payments p where p.sale_id = m.id), 0)
          - (case when m.sale_type = 'subsidy' and coalesce(m.subsidy_status, '') <> 'Rejected' then m.subsidy_amount else 0 end), 0) as rem) x
      where m.status <> 'Cancelled' and not m.is_historical and x.rem > 0.005 ${bf('m.branch_id')}
      union all
      select 'job-card', j.id, j.job_number, j.branch_id, j.customer_id, j.customer_name,
        coalesce(nullif(j.customer_phone, ''), nullif(c.phone, '')), c.alternate_phone, (j.total - j.paid_amount)::float8, null, j.received_on, ${lastMsgSql('job-card', 'j.id')}
      from job_cards j left join customers c on c.id = j.customer_id
      where j.status in ('Ready', 'Delivered') and j.total - j.paid_amount > 0.005 ${bf('j.branch_id')}
    ) x limit 1500`);
  const rows: PendingPaymentRow[] = (res.rows as any[]).map((r) => ({
    source: r.source,
    invoiceId: r.ref_id,
    invoiceNumber: r.number,
    branchId: r.branch_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    phone: r.phone,
    alternatePhone: r.alternate_phone,
    balance: Math.round(Number(r.balance) * 100) / 100,
    dueDate: r.due_date || null,
    billDate: r.bill_date || null,
    daysOverdue: r.due_date ? Math.max(0, dayDiff(r.due_date, today)) : 0,
    lastMessagedAt: r.last_msg || null
  }));
  // longest overdue first, then the biggest balance
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
  return rows;
}

export async function getMessageQueue(branchId: string) {
  const today = businessDate();

  const [overdueLegacy, pending, warranty, jobs] = await Promise.all([
    db
      .select({
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        branchId: invoices.branchId,
        customerId: invoices.customerId,
        customerName: invoices.customerName,
        phone: customers.phone,
        alternatePhone: customers.alternatePhone,
        balance: invoices.balanceAmount,
        dueDate: invoices.dueDate,
        lastMessagedAt: lastMessagedAt('invoice', invoices.id)
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          gt(invoices.balanceAmount, 0),
          lt(invoices.dueDate, today),
          ne(invoices.status, 'Cancelled'),
          branchCond(invoices.branchId, branchId)
        )
      )
      .orderBy(invoices.dueDate)
      .limit(QUEUE_CAP),

    getPendingPayments(branchId),

    db
      .select({
        warrantyId: warranties.id,
        serialNumber: warranties.serialNumber,
        productName: warranties.productName,
        branchId: customers.branchId,
        customerId: warranties.customerId,
        customerName: warranties.customerName,
        phone: customers.phone,
        alternatePhone: customers.alternatePhone,
        expiryDate: warranties.warrantyExpiryDate,
        lastMessagedAt: lastMessagedAt('warranty', warranties.id)
      })
      .from(warranties)
      .leftJoin(customers, eq(warranties.customerId, customers.id))
      .where(
        and(
          gte(warranties.warrantyExpiryDate, addDays(today, -WARRANTY_BEHIND_DAYS)),
          lte(warranties.warrantyExpiryDate, addDays(today, WARRANTY_AHEAD_DAYS)),
          branchCond(customers.branchId, branchId)
        )
      )
      .orderBy(warranties.warrantyExpiryDate)
      .limit(QUEUE_CAP),

    db
      .select({
        jobCardId: jobCards.id,
        jobNumber: jobCards.jobNumber,
        branchId: jobCards.branchId,
        customerId: jobCards.customerId,
        customerName: jobCards.customerName,
        phone: sql<string | null>`coalesce(nullif(${jobCards.customerPhone}, ''), ${customers.phone})`,
        alternatePhone: customers.alternatePhone,
        machineModel: jobCards.machineModel,
        total: jobCards.total,
        paidAmount: jobCards.paidAmount,
        lastMessagedAt: lastMessagedAt('job-card', jobCards.id)
      })
      .from(jobCards)
      .leftJoin(customers, eq(jobCards.customerId, customers.id))
      .where(and(eq(jobCards.status, 'Ready'), branchCond(jobCards.branchId, branchId)))
      .orderBy(jobCards.receivedOn)
      .limit(QUEUE_CAP)
  ]);

  return {
    // everyone with a pending payment; rows from the old invoice table (if any are left) come first as invoices
    overdueInvoices: [
      ...overdueLegacy.map(({ dueDate, ...r }) => ({
        ...r,
        source: 'invoice' as const,
        billDate: null as string | null,
        dueDate,
        daysOverdue: dueDate ? Math.max(0, dayDiff(dueDate, today)) : 0
      })),
      ...pending
    ],
    warrantyExpiring: warranty.map((r) => ({ ...r, daysLeft: dayDiff(today, r.expiryDate) })),
    jobsReady: jobs.map(({ total, paidAmount, ...r }) => ({
      ...r,
      balanceDue: Math.max(0, Math.round((total - paidAmount) * 100) / 100)
    }))
  };
}

export interface MessageLogInput {
  branchId: string;
  kind: MessageKind;
  refType?: string | null;
  refId?: string | null;
  customerId?: string | null;
  customerName: string;
  phone: string;
  language: 'en' | 'ta';
  body: string;
  sentBy?: string | null;
}

export async function logMessage(input: MessageLogInput) {
  const row = {
    id: newId('msg'),
    branchId: input.branchId,
    kind: input.kind,
    refType: input.refType || null,
    refId: input.refId || null,
    customerId: input.customerId || null,
    customerName: input.customerName,
    phone: input.phone,
    channel: 'whatsapp',
    language: input.language,
    body: input.body,
    sentBy: input.sentBy || null,
    createdAt: new Date()
  };
  const [saved] = await db.insert(messageLog).values(row).returning();
  return saved;
}

export async function listMessages(branchId: string, limit: number, kind?: string) {
  return db
    .select()
    .from(messageLog)
    .where(and(branchCond(messageLog.branchId, branchId), kind ? eq(messageLog.kind, kind) : undefined))
    .orderBy(desc(messageLog.createdAt))
    .limit(limit);
}

// Bulk marketing progress. `done` are the numbers already opened in this campaign; `recent` are numbers that got a
// marketing message in some other campaign during the last `days` days (so the same people are not messaged twice).
export async function marketingSent(campaign: string, days: number) {
  const done = await db
    .selectDistinct({ phone: messageLog.phone })
    .from(messageLog)
    .where(and(eq(messageLog.kind, 'marketing'), eq(messageLog.refId, campaign), ne(messageLog.status, 'failed')));

  let recent: { phone: string }[] = [];
  if (days > 0) {
    const since = new Date(Date.now() - days * 86400000);
    recent = await db
      .selectDistinct({ phone: messageLog.phone })
      .from(messageLog)
      .where(
        and(
          eq(messageLog.kind, 'marketing'),
          ne(messageLog.status, 'failed'),
          gte(messageLog.createdAt, since),
          or(isNull(messageLog.refId), ne(messageLog.refId, campaign))
        )
      );
  }
  return { done: done.map((r) => r.phone), recent: recent.map((r) => r.phone) };
}
