import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { branchesWithDistricts, seasonOutlook } from './seasonService.ts';

// Money and machines: when machine balances will arrive, which models sell, how each branch is doing, and a 4 week cash view.

const round = (n: number) => Math.round(n);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

export interface MachineWeek {
  weekStart: string;
  label: string;
  count: number;
  balance: number;
  atRisk: number;
}
export interface BranchRow {
  branchId: string;
  name: string;
  district: string;
  last30: number;
  prev30: number;
  changePercent: number | null;
  next30: number;
  sales30Count: number;
  slowing: boolean;
}
export interface CashWeek {
  weekStart: string;
  counterSales: number;
  invoices: number;
  machines: number;
  totalIn: number;
  expenses: number;
  purchases: number;
  payroll: number;
  totalOut: number;
  net: number;
  running: number;
}
export interface MoneyInsights {
  generatedAt: string;
  machines: {
    pipelineWeeks: MachineWeek[];
    laterBalance: number;
    undated: number;
    atRiskCount: number;
    atRiskBalance: number;
    atRisk: { saleNumber: string; customerName: string; machine: string; status: string; expected: string | null; balance: number; reason: string }[];
    subsidy: { count: number; amount: number; byStatus: { status: string; count: number; amount: number }[] };
    models: { name: string; bookings: number; delivered: number; value: number; avgDaysToDeliver: number | null }[];
    bookingsByMonth: { month: string; bookings: number }[];
    expectedBookings30: number | null;
    expectedBasis: string;
  };
  branches: BranchRow[];
  cash: { weeks: CashWeek[]; assumptions: string[]; lowestRunning: number; firstShortWeek: string | null };
}

export async function getMoneyInsights(scope: string): Promise<MoneyInsights> {
  const today = businessDate();
  const monday = mondayOf(today);

  let season: Awaited<ReturnType<typeof seasonOutlook>> | null = null;
  try {
    season = await seasonOutlook(scope);
  } catch {
    season = null;
  }
  const f30 = season?.next30Factor ?? 1;

  // ---------- machine pipeline ----------
  const pipe = (await db.execute(sql`
    select sale_number, customer_name, machine_name, model, status, expected_delivery_date, booking_date, sale_price, advance_paid,
           sale_type, subsidy_amount, subsidy_status
    from machine_sales where status in ('Booked', 'Ready for Delivery', 'Dispatched') ${branchFilter('branch_id', scope)}`)).rows as any[];
  const weeks: MachineWeek[] = [];
  for (let i = 0; i < 6; i++) {
    const ws = addDays(monday, 7 * i);
    weeks.push({ weekStart: ws, label: i === 0 ? 'This week' : `Week of ${ws.slice(8)}/${ws.slice(5, 7)}`, count: 0, balance: 0, atRisk: 0 });
  }
  let later = 0;
  let undated = 0;
  const atRisk: MoneyInsights['machines']['atRisk'] = [];
  for (const m of pipe) {
    const subsidyLater = m.sale_type === 'subsidy' && m.subsidy_status !== 'Received' ? Number(m.subsidy_amount) || 0 : 0;
    const bal = Math.max(0, Number(m.sale_price) - Number(m.advance_paid) - subsidyLater);
    const exp: string | null = m.expected_delivery_date || null;
    const machine = [m.machine_name, m.model].filter(Boolean).join(' ');
    let reason = '';
    if (!exp) {
      undated++;
      if (dayDiff(today, m.booking_date) > 30) reason = `Booked ${dayDiff(today, m.booking_date)} days ago with no delivery date`;
    } else if (exp < today) reason = `Delivery date ${exp} has passed`;
    else if (m.status === 'Booked' && dayDiff(today, m.booking_date) > 45) reason = `Still only booked after ${dayDiff(today, m.booking_date)} days`;
    const when = exp && exp >= today ? exp : exp ? today : null; // late ones are counted in the current week
    if (when) {
      const idx = Math.floor(dayDiff(when, monday) / 7);
      if (idx >= 0 && idx < weeks.length) {
        weeks[idx].count++;
        weeks[idx].balance += bal;
        if (reason) weeks[idx].atRisk += bal;
      } else later += bal;
    }
    if (reason) atRisk.push({ saleNumber: m.sale_number, customerName: m.customer_name, machine, status: m.status, expected: exp, balance: round(bal), reason });
  }
  const sub = (await db.execute(sql`
    select coalesce(subsidy_status, 'Not started') as status, count(*)::int as n, coalesce(sum(subsidy_amount), 0)::float as amt
    from machine_sales where sale_type = 'subsidy' and status <> 'Cancelled' and coalesce(subsidy_status, '') <> 'Received' and coalesce(subsidy_status, '') <> 'Rejected' ${branchFilter('branch_id', scope)}
    group by 1 order by 3 desc`)).rows as any[];

  // ---------- which models sell ----------
  const modelRows = (await db.execute(sql`
    select coalesce(nullif(trim(machine_name), ''), 'Machine') as name,
           count(*)::int as bookings, count(*) filter (where status = 'Delivered')::int as delivered, coalesce(sum(sale_price), 0)::float as value,
           avg(case when status = 'Delivered' and delivered_date is not null then (delivered_date::date - booking_date::date) end)::float as days
    from machine_sales where status <> 'Cancelled' and booking_date >= ${addDays(today, -365)} ${branchFilter('branch_id', scope)}
    group by 1 order by 2 desc, 4 desc limit 8`)).rows as any[];
  const monthRows = (await db.execute(sql`
    select substring(booking_date from 1 for 7) as month, count(*)::int as n from machine_sales
    where status <> 'Cancelled' and booking_date >= ${addDays(today, -180)} ${branchFilter('branch_id', scope)} group by 1 order by 1`)).rows as any[];
  const thisMonth = today.slice(0, 7);
  const fullMonths = monthRows.filter((m) => m.month < thisMonth).slice(-3);
  const dayOfMonth = Number(today.slice(8));
  const nowRow = monthRows.find((m) => m.month === thisMonth);
  let expectedBookings: number | null = null;
  let expectedBasis = 'No machine bookings on record yet';
  if (fullMonths.length) {
    expectedBookings = Math.round((sum(fullMonths.map((m) => Number(m.n))) / fullMonths.length) * f30 * 10) / 10;
    expectedBasis = `Average of the last ${fullMonths.length} full month${fullMonths.length > 1 ? 's' : ''}, adjusted for the season and rain`;
  } else if (nowRow && dayOfMonth >= 7) {
    expectedBookings = Math.round(((Number(nowRow.n) / dayOfMonth) * 30) * f30 * 10) / 10;
    expectedBasis = `This month's pace so far (${nowRow.n} in ${dayOfMonth} days), adjusted for the season and rain`;
  }

  // ---------- branches against each other ----------
  const branches = await branchesWithDistricts();
  const brRows = (await db.execute(sql`
    select bid, sum(case when day >= ${addDays(today, -29)}::date then total else 0 end)::float as last30,
           sum(case when day < ${addDays(today, -29)}::date then total else 0 end)::float as prev30,
           count(*) filter (where day >= ${addDays(today, -29)}::date)::int as bills
    from (
      select s.branch_id as bid, (s.created_at + interval '5 hours 30 minutes')::date as day, s.grand_total as total from sales s
      union all
      select d.branch_id, d.doc_date::date, d.grand_total from documents d
        where d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and d.source_machine_sale_id is null
    ) x where day >= ${addDays(today, -59)}::date group by bid`)).rows as any[];
  const brBy = new Map(brRows.map((r) => [r.bid, r]));
  let districtFactor = new Map<string, number>();
  if (scope === 'all') {
    try {
      const all = await seasonOutlook('all');
      districtFactor = new Map(all.districts.map((d) => [d.key, d.next30CalendarFactor * (1 + (d.weather.rainFactor - 1) * 0.5)]));
    } catch {
      districtFactor = new Map();
    }
  }
  const branchRows: BranchRow[] = (scope === 'all' ? branches : branches.filter((b) => b.id === scope)).map((b) => {
    const r = brBy.get(b.id);
    const last30 = round(Number(r?.last30 || 0));
    const prev30 = round(Number(r?.prev30 || 0));
    const change = prev30 > 0 ? round(((last30 - prev30) / prev30) * 100) : null;
    return {
      branchId: b.id,
      name: b.name,
      district: b.district,
      last30,
      prev30,
      changePercent: change,
      next30: round(last30 * (districtFactor.get(b.district) ?? f30)),
      sales30Count: Number(r?.bills || 0),
      slowing: change !== null && change <= -15
    };
  }).sort((a, b) => b.last30 - a.last30);

  // ---------- 4 week cash view ----------
  const cashWeeks: CashWeek[] = [];
  const recent = (await db.execute(sql`
    select coalesce(sum(grand_total), 0)::float as total, count(distinct (created_at + interval '5 hours 30 minutes')::date)::int as days
    from sales where created_at >= now() - interval '28 days' ${branchFilter('branch_id', scope)}`)).rows[0] as any;
  const firstSale = (await db.execute(sql`select min(created_at) as at from sales where true ${branchFilter('branch_id', scope)}`)).rows[0] as any;
  const spanDays = firstSale?.at ? Math.min(28, Math.max(7, Math.ceil((Date.now() - new Date(firstSale.at).getTime()) / 86400000))) : 28;
  const counterPerWeek = (Number(recent?.total || 0) / spanDays) * 7;

  const openInv = (await db.execute(sql`
    select due_date, (grand_total - paid_amount)::float as bal from documents
    where doc_type = 'invoice' and status in ('Issued', 'Partially Paid') and grand_total - paid_amount > 0.5 ${branchFilter('branch_id', scope)}`)).rows as any[];
  const delivOpen = (await db.execute(sql`
    select (sale_price - advance_paid - case when sale_type = 'subsidy' and coalesce(subsidy_status, '') <> 'Received' then subsidy_amount else 0 end)::float as bal
    from machine_sales where status = 'Delivered' and sale_price - advance_paid > 0.5 ${branchFilter('branch_id', scope)}`)).rows as any[];

  const cashOut = (await db.execute(sql`
    select coalesce(sum(amount), 0)::float as total, min(entry_date) as first from cash_entries
    where type = 'out' and entry_date >= ${addDays(today, -56)} ${branchFilter('branch_id', scope)}`)).rows[0] as any;
  const purch = (await db.execute(sql`
    select coalesce(sum(gi.accepted_quantity * gi.rate), 0)::float as total, min(g.received_date) as first
    from goods_receipt_items gi join goods_receipts g on g.id = gi.receipt_id where g.received_date >= ${addDays(today, -56)}`)).rows[0] as any;
  const weeksOf = (first: string | null) => (first ? Math.min(8, Math.max(1, dayDiff(today, first) / 7)) : 1);
  const expensesPerWeek = cashOut?.first ? Number(cashOut.total) / weeksOf(cashOut.first) : 0;
  const purchasesPerWeek = purch?.first ? Number(purch.total) / weeksOf(purch.first) : 0;
  const staffRows = (await db.execute(sql`
    select pay_type, base_salary from staff where status = 'Active' ${branchFilter('branch_id', scope)}`)).rows as any[];
  const payrollMonth = sum(staffRows.map((s) => (s.pay_type === 'daily' ? Number(s.base_salary) * 26 : Number(s.base_salary))));
  const monthEnd = (() => {
    const [y, m] = today.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  })();

  const overdueTotal = sum(openInv.filter((o) => o.due_date && o.due_date < today).map((o) => Number(o.bal))) + sum(delivOpen.map((o) => Number(o.bal)));
  let running = 0;
  let lowest = 0;
  let firstShort: string | null = null;
  for (let i = 0; i < 4; i++) {
    const ws = addDays(monday, 7 * i);
    const we = addDays(ws, 6);
    const counter = counterPerWeek * (season?.weekFactors[i] ?? 1);
    const inv = sum(openInv.filter((o) => o.due_date && o.due_date >= ws && o.due_date <= we && o.due_date >= today).map((o) => Number(o.bal))) + overdueTotal * 0.2 * (i === 0 ? 1 : 1);
    const mach = weeks[i]?.balance ?? 0;
    const payroll = monthEnd >= ws && monthEnd <= we ? payrollMonth : 0;
    const totalIn = counter + inv + mach;
    const totalOut = expensesPerWeek + purchasesPerWeek + payroll;
    running += totalIn - totalOut;
    if (running < lowest) lowest = running;
    if (running < 0 && !firstShort) firstShort = ws;
    cashWeeks.push({
      weekStart: ws,
      counterSales: round(counter),
      invoices: round(inv),
      machines: round(mach),
      totalIn: round(totalIn),
      expenses: round(expensesPerWeek),
      purchases: round(purchasesPerWeek),
      payroll: round(payroll),
      totalOut: round(totalOut),
      net: round(totalIn - totalOut),
      running: round(running)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    machines: {
      pipelineWeeks: weeks.map((w) => ({ ...w, balance: round(w.balance), atRisk: round(w.atRisk) })),
      laterBalance: round(later),
      undated,
      atRiskCount: atRisk.length,
      atRiskBalance: round(sum(atRisk.map((a) => a.balance))),
      atRisk: atRisk.sort((a, b) => b.balance - a.balance).slice(0, 10),
      subsidy: {
        count: sum(sub.map((s) => Number(s.n))),
        amount: round(sum(sub.map((s) => Number(s.amt)))),
        byStatus: sub.map((s) => ({ status: s.status, count: Number(s.n), amount: round(Number(s.amt)) }))
      },
      models: modelRows.map((m) => ({ name: m.name, bookings: Number(m.bookings), delivered: Number(m.delivered), value: round(Number(m.value)), avgDaysToDeliver: m.days === null ? null : round(Number(m.days)) })),
      bookingsByMonth: monthRows.map((m) => ({ month: m.month, bookings: Number(m.n) })),
      expectedBookings30: expectedBookings,
      expectedBasis
    },
    branches: branchRows,
    cash: {
      weeks: cashWeeks,
      lowestRunning: round(lowest),
      firstShortWeek: firstShort,
      assumptions: [
        ...(expensesPerWeek === 0 && purchasesPerWeek === 0 && payrollMonth === 0
          ? ['Nothing is recorded yet for expenses, stock purchases or salaries, so money going out shows as zero and the running total is too optimistic']
          : []),
        `Counter sales continue at about ${round(counterPerWeek)} a week, moved by the season and rain`,
        'Overdue invoices and delivered-machine balances come in at 20% of the total each week; other invoices on their due date',
        'Machine balances arrive in the week of the expected delivery (subsidy not yet received is left out until it is paid)',
        `Expenses and stock purchases continue at their recent weekly average (${round(expensesPerWeek)} and ${round(purchasesPerWeek)} a week)`,
        `Salaries (${round(payrollMonth)} a month) fall in the week the month ends`
      ]
    }
  };
}
