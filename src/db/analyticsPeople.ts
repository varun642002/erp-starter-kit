import { sql } from 'drizzle-orm';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { seasonOutlook } from './seasonService.ts';

// People side of the predictions: who is due to buy again, who may pay late, and who needs a service or warranty call.

const round = (n: number) => Math.round(n);
const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);

export interface RepeatReminder {
  customerId: string;
  name: string;
  phone: string | null;
  purchases: number;
  usualGapDays: number;
  daysSinceLast: number;
  lastPurchase: string;
  usualItems: string[];
  dueRatio: number;
  message: string;
}
export interface PaymentRisk {
  key: string;
  kind: 'Invoice' | 'Machine';
  reference: string;
  customerName: string;
  phone: string | null;
  balance: number;
  dueDate: string | null;
  overdueDays: number;
  pastLatePercent: number | null; // share of this customer's earlier invoices paid after the due date; null = no history
  typicalDelayDays: number | null;
  score: number;
  level: 'High' | 'Medium' | 'Low';
  action: string;
}
export interface ServiceCall {
  kind: 'Warranty ending' | 'Service due';
  customerName: string;
  phone: string | null;
  machine: string;
  serial: string | null;
  date: string; // warranty end, or delivery date
  daysAway: number; // days until the warranty ends, or days since delivery
  message: string;
}
export interface CustomerInsights {
  generatedAt: string;
  repeat: { items: RepeatReminder[]; basis: string };
  payments: { items: PaymentRisk[]; totalAtRisk: number; basis: string };
  service: { calls: ServiceCall[]; jobsLast90: number; jobsPrev90: number; openJobs: number; topModels: { model: string; jobs: number }[]; basis: string };
}

let warrantyCache: { at: number; rows: any[] } | null = null;
export async function loadWarranties(): Promise<any[]> {
  if (warrantyCache && Date.now() - warrantyCache.at < 10 * 60_000) return warrantyCache.rows;
  try {
    const app = getApps()[0] || initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    const snap = await getFirestore(app).collection('warranties').get();
    warrantyCache = { at: Date.now(), rows: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) };
  } catch (e) {
    console.warn('warranties not available:', (e as Error).message);
    warrantyCache = { at: Date.now(), rows: [] };
  }
  return warrantyCache.rows;
}

export async function getCustomerInsights(scope: string): Promise<CustomerInsights> {
  const today = businessDate();
  let seasonLine = '';
  try {
    const s = await seasonOutlook(scope);
    const d = s.districts[0];
    if (d && d.status.coming.length) seasonLine = ` ${d.status.coming[0].split(':')[0]} land preparation is starting soon, so it is a good time to check your machine and spares.`;
  } catch {
    seasonLine = '';
  }

  // ---------- who is due to buy again ----------
  const visits = (await db.execute(sql`
    select cid, day::text as day from (
      select s.customer_id as cid, (s.created_at + interval '5 hours 30 minutes')::date as day from sales s
        where s.customer_id is not null ${branchFilter('s.branch_id', scope)}
      union all
      select d.customer_id as cid, d.doc_date::date as day from documents d
        where d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and d.customer_id is not null and d.source_machine_sale_id is null ${branchFilter('d.branch_id', scope)}
    ) x group by cid, day order by cid, day`)).rows as { cid: string; day: string }[];
  const byCust = new Map<string, string[]>();
  for (const v of visits) {
    if (!byCust.has(v.cid)) byCust.set(v.cid, []);
    byCust.get(v.cid)!.push(v.day);
  }
  const repeatIds: { cid: string; days: string[]; gap: number; since: number }[] = [];
  for (const [cid, days] of byCust) {
    if (days.length < 2) continue;
    const gap = dayDiff(days[days.length - 1], days[0]) / (days.length - 1);
    const since = dayDiff(today, days[days.length - 1]);
    if (gap < 1) continue; // several bills on consecutive days is one buying spell, not a habit
    if (since >= Math.max(7, gap)) repeatIds.push({ cid, days, gap, since });
  }
  repeatIds.sort((a, b) => b.since / b.gap - a.since / a.gap);
  const top = repeatIds.slice(0, 20);
  const ids = top.map((t) => t.cid);
  const custRows = ids.length ? ((await db.execute(sql`select id, company_name, name, phone from customers where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)).rows as any[]) : [];
  const itemRows = ids.length
    ? ((await db.execute(sql`
        select s.customer_id as cid, si.product_name as pname, sum(si.quantity)::float as q from sale_items si join sales s on s.id = si.sale_id
        where s.customer_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by 1, 2 order by 1, 3 desc`)).rows as any[])
    : [];
  const itemsBy = new Map<string, string[]>();
  for (const r of itemRows) {
    const list = itemsBy.get(r.cid) || [];
    if (list.length < 3) list.push(r.pname);
    itemsBy.set(r.cid, list);
  }
  const custOf = new Map(custRows.map((c) => [c.id, c]));
  const repeat: RepeatReminder[] = top.map((t) => {
    const c = custOf.get(t.cid);
    const name = c?.name || c?.company_name || 'Customer';
    const items = itemsBy.get(t.cid) || [];
    return {
      customerId: t.cid,
      name,
      phone: c?.phone || null,
      purchases: t.days.length,
      usualGapDays: round(t.gap),
      daysSinceLast: t.since,
      lastPurchase: t.days[t.days.length - 1],
      usualItems: items,
      dueRatio: Math.round((t.since / t.gap) * 10) / 10,
      message: `Hello ${name}, it has been ${t.since} days since your last visit to Acme Agro Equipment.${items.length ? ` You usually buy ${items.join(', ')}.` : ''}${seasonLine} Please let us know what you need and we will keep it ready. Thank you.`
    };
  });

  // ---------- who may pay late ----------
  const open = (await db.execute(sql`
    select d.id, d.doc_number, d.customer_id, d.customer_name, d.customer_phone, d.due_date, d.doc_date, (d.grand_total - d.paid_amount)::float as bal
    from documents d where d.doc_type = 'invoice' and d.status in ('Issued', 'Partially Paid') and d.grand_total - d.paid_amount > 0.5 ${branchFilter('d.branch_id', scope)}`)).rows as any[];
  const machineOpen = (await db.execute(sql`
    select id, sale_number, customer_id, customer_name, customer_phone, delivered_date, (sale_price - advance_paid)::float as bal
    from machine_sales where status = 'Delivered' and sale_price - advance_paid > 0.5 ${branchFilter('branch_id', scope)}`)).rows as any[];
  const histRows = (await db.execute(sql`
    select d.customer_id as cid, d.doc_date, d.due_date, max(p.paid_on) as paid_on
    from documents d join document_payments p on p.document_id = d.id and p.method <> 'Return credit'
    where d.doc_type = 'invoice' and d.status = 'Paid' and d.customer_id is not null group by d.id, d.customer_id, d.doc_date, d.due_date`)).rows as any[];
  const hist = new Map<string, { n: number; late: number; delay: number }>();
  for (const h of histRows) {
    const due = h.due_date || h.doc_date;
    const delay = dayDiff(h.paid_on, due);
    const cur = hist.get(h.cid) || { n: 0, late: 0, delay: 0 };
    cur.n++;
    if (delay > 0) cur.late++;
    cur.delay += Math.max(0, delay);
    hist.set(h.cid, cur);
  }
  const risk: PaymentRisk[] = [];
  const score = (overdue: number, bal: number, h: { n: number; late: number; delay: number } | undefined) => {
    const latePct = h && h.n ? h.late / h.n : null;
    const s = Math.min(50, Math.max(0, overdue) * 1.5) + Math.min(20, (bal / 50000) * 10) + (latePct === null ? 5 : latePct * 20) + (h && h.n && h.delay / h.n > 15 ? 10 : 0);
    return { s: Math.round(s), latePct, delay: h && h.n ? Math.round(h.delay / h.n) : null };
  };
  const level = (s: number): PaymentRisk['level'] => (s >= 55 ? 'High' : s >= 30 ? 'Medium' : 'Low');
  for (const o of open) {
    const overdue = o.due_date ? Math.max(0, dayDiff(today, o.due_date)) : 0;
    const sc = score(overdue, Number(o.bal), hist.get(o.customer_id));
    risk.push({
      key: o.id,
      kind: 'Invoice',
      reference: o.doc_number,
      customerName: o.customer_name,
      phone: o.customer_phone || null,
      balance: round(Number(o.bal)),
      dueDate: o.due_date || null,
      overdueDays: overdue,
      pastLatePercent: sc.latePct === null ? null : round(sc.latePct * 100),
      typicalDelayDays: sc.delay,
      score: sc.s,
      level: level(sc.s),
      action: overdue > 0 ? (sc.s >= 55 ? 'Call today' : 'Send a reminder today') : 'Remind a few days before the due date'
    });
  }
  for (const m of machineOpen) {
    const overdue = m.delivered_date ? Math.max(0, dayDiff(today, m.delivered_date) - 15) : 0; // balance expected within about 15 days of delivery
    const sc = score(overdue, Number(m.bal), hist.get(m.customer_id));
    risk.push({
      key: m.id,
      kind: 'Machine',
      reference: m.sale_number,
      customerName: m.customer_name,
      phone: m.customer_phone || null,
      balance: round(Number(m.bal)),
      dueDate: null,
      overdueDays: overdue,
      pastLatePercent: sc.latePct === null ? null : round(sc.latePct * 100),
      typicalDelayDays: sc.delay,
      score: sc.s,
      level: level(sc.s),
      action: 'Machine delivered with a balance: call about the balance or the subsidy payment'
    });
  }
  risk.sort((a, b) => b.score - a.score || b.balance - a.balance);

  // ---------- warranty and service calls ----------
  const calls: ServiceCall[] = [];
  const ws = await loadWarranties();
  for (const w of ws) {
    if (scope !== 'all' && w.branchId && w.branchId !== scope) continue;
    const end = w.warrantyEndDate;
    if (!end || String(end) < today) continue;
    const away = dayDiff(String(end).slice(0, 10), today);
    if (away > 60) continue;
    calls.push({
      kind: 'Warranty ending',
      customerName: w.customerName || 'Customer',
      phone: w.customerPhone || null,
      machine: w.productName || 'Machine',
      serial: w.serialNumber || null,
      date: String(end).slice(0, 10),
      daysAway: away,
      message: `Hello ${w.customerName || ''}, the warranty on your ${w.productName || 'machine'} ends on ${String(end).slice(0, 10)}. Please bring it in for a free check before then. Acme Agro Equipment.`
    });
  }
  const delivered = (await db.execute(sql`
    select customer_name, customer_phone, machine_name, model, serial_number, delivered_date from machine_sales
    where status = 'Delivered' and delivered_date is not null ${branchFilter('branch_id', scope)}`)).rows as any[];
  for (const m of delivered) {
    const since = dayDiff(today, m.delivered_date);
    const marks = [90, 180, 365];
    const hit = marks.find((x) => since >= x && since < x + 21);
    if (!hit) continue;
    const label = [m.machine_name, m.model].filter(Boolean).join(' ');
    calls.push({
      kind: 'Service due',
      customerName: m.customer_name,
      phone: m.customer_phone || null,
      machine: label,
      serial: m.serial_number || null,
      date: m.delivered_date,
      daysAway: since,
      message: `Hello ${m.customer_name}, your ${label} was delivered ${Math.round(hit / 30)} months ago. It is time for a service check and any wear parts (blades, bearings, oil seals, oil).${seasonLine} Acme Agro Equipment.`
    });
  }
  calls.sort((a, b) => (a.kind === b.kind ? (a.kind === 'Warranty ending' ? a.daysAway - b.daysAway : b.daysAway - a.daysAway) : a.kind === 'Warranty ending' ? -1 : 1));

  const jobs = (await db.execute(sql`
    select
      count(*) filter (where received_on >= ${addDays(today, -90)})::int as last90,
      count(*) filter (where received_on >= ${addDays(today, -180)} and received_on < ${addDays(today, -90)})::int as prev90,
      count(*) filter (where status not in ('Delivered', 'Closed', 'Cancelled'))::int as open
    from job_cards where true ${branchFilter('branch_id', scope)}`)).rows[0] as any;
  const models = (await db.execute(sql`
    select coalesce(nullif(machine_model, ''), 'Not noted') as model, count(*)::int as jobs from job_cards
    where received_on >= ${addDays(today, -180)} ${branchFilter('branch_id', scope)} group by 1 order by 2 desc limit 5`)).rows as any[];

  return {
    generatedAt: new Date().toISOString(),
    repeat: {
      items: repeat,
      basis: 'Customers who have bought on 2 or more different days and have now gone longer than their usual gap. Needs the customer to be saved on the bill'
    },
    payments: {
      items: risk.slice(0, 20),
      totalAtRisk: round(risk.filter((r) => r.level !== 'Low').reduce((s, r) => s + r.balance, 0)),
      basis: 'Open invoices and machine balances ranked by days overdue, size, and how late the same customer paid before'
    },
    service: {
      calls: calls.slice(0, 30),
      jobsLast90: Number(jobs?.last90 || 0),
      jobsPrev90: Number(jobs?.prev90 || 0),
      openJobs: Number(jobs?.open || 0),
      topModels: models.map((m) => ({ model: m.model, jobs: Number(m.jobs) })),
      basis: 'Warranties ending in 60 days, and machines delivered about 3, 6 and 12 months ago'
    }
  };
}
