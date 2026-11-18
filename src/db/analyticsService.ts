import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { seasonOutlook, type SeasonOutlook } from './seasonService.ts';

// Predictions are read from real records only, with plain statistics (no black box), and every figure says what it is based on.

export interface WeekPoint {
  weekStart: string; // Monday, YYYY-MM-DD
  total: number;
  forecast?: boolean;
  low?: number;
  high?: number;
}

export interface StockRisk {
  productId: string;
  sku: string;
  name: string;
  stock: number; // in the product's own unit (pieces)
  unit: string;
  perDay: number;
  perMonth: number;
  daysLeft: number; // 0 when already out
  runOutDate: string | null;
  level: 'Out' | 'Critical' | 'Soon' | 'Watch';
  suggestQty: number; // in the product's own unit
  suggestLabel: string;
}

export interface Predictions {
  generatedAt: string;
  scope: string;
  sales: {
    basis: string;
    weeks: WeekPoint[];
    nextWeeks: WeekPoint[];
    next30Days: { low: number; expected: number; high: number };
    last4Weeks: number;
    prev4Weeks: number;
    trendPercent: number | null; // last 4 full weeks against the 4 before
    busiestDay: { name: string; sharePercent: number } | null;
    enoughData: boolean;
    // Before there are 4 full weeks: today's pace carried forward, with a rough range
    pace: { days: number; perDay: number; next30: { low: number; expected: number; high: number } } | null;
    // What the farming season and the rain do to the estimate (the numbers above already include it)
    season: {
      factor: number;
      withoutSeason30: number; // the next 30 days from the sales run-rate alone
      reasons: string[];
      districts: { key: string; label: string; weightPercent: number; level: string; index: number; now: string[]; coming: string[]; outlook: string; rainSummary: string; rainReason: string }[];
      available: boolean;
    };
  };
  stock: { basis: string; risks: StockRisk[]; outCount: number; criticalCount: number };
  machines: {
    monthly: { month: string; delivered: number; value: number }[];
    avgPerMonth: number;
    avgBasis: 'full-months' | 'this-month' | 'none';
    pipeline: { status: string; count: number; value: number; balance: number }[];
    dueThisMonth: number;
  };
  collections: { overdue: number; dueNext30: number; overdueCount: number; dueNext30Count: number };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const round = (n: number) => Math.round(n);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

// Least-squares line through the points (x = 0..n-1). Returns the value on the line at the last point and the slope.
export function fitLine(ys: number[]): { last: number; slope: number; residual: number } {
  const n = ys.length;
  if (n === 0) return { last: 0, slope: 0, residual: 0 };
  if (n === 1) return { last: ys[0], slope: 0, residual: 0 };
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, x) => {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
  });
  const slope = sxx ? sxy / sxx : 0;
  const a = my - slope * mx;
  const last = a + slope * (n - 1);
  const res = Math.sqrt(ys.reduce((s, y, x) => s + (y - (a + slope * x)) ** 2, 0) / Math.max(1, n - 2));
  return { last, slope, residual: res };
}

// Next `count` weeks from the recent full weeks: the latest level, the trend carried forward at 60% (so one busy or quiet
// week cannot run away), never below zero, with a range of one typical miss either side.
export function forecastWeeks(history: number[], count: number): { expected: number; low: number; high: number }[] {
  const recent = history.slice(-8);
  const { last, slope, residual } = fitLine(recent);
  const cap = Math.max(...recent, 0) * 2;
  const out: { expected: number; low: number; high: number }[] = [];
  for (let k = 1; k <= count; k++) {
    const expected = Math.min(cap, Math.max(0, last + slope * 0.6 * k));
    out.push({ expected: round(expected), low: round(Math.max(0, expected - residual)), high: round(expected + residual) });
  }
  return out;
}

const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);

export async function getPredictions(scope: string): Promise<Predictions> {
  const today = businessDate();
  const thisMonday = mondayOf(today);
  const fromDay = addDays(thisMonday, -7 * 12); // 12 full weeks back

  // ---- sales per day: counter sales plus invoices that did not come from a machine sale ----
  const dayRows = (await db.execute(sql`
    select day::text as day, sum(total)::float as total from (
      select (s.created_at + interval '5 hours 30 minutes')::date as day, s.grand_total as total
        from sales s where true ${branchFilter('s.branch_id', scope)}
      union all
      select d.doc_date::date as day, d.grand_total as total
        from documents d
        where d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and d.source_machine_sale_id is null
          ${branchFilter('d.branch_id', scope)}
    ) x where day >= ${fromDay}::date and day < ${today}::date + 1 group by 1`)).rows as { day: string; total: number }[];
  const daily = new Map(dayRows.map((r) => [r.day, Number(r.total)]));

  const weeks: WeekPoint[] = [];
  for (let i = 12; i >= 1; i--) {
    const ws = addDays(thisMonday, -7 * i);
    let total = 0;
    for (let d = 0; d < 7; d++) total += daily.get(addDays(ws, d)) || 0;
    weeks.push({ weekStart: ws, total: round(total) });
  }
  // Weeks before the first sale are not "zero sales", they are "no data": drop them from the front.
  const firstWithSales = weeks.findIndex((w) => w.total > 0);
  const usable = firstWithSales === -1 ? [] : weeks.slice(firstWithSales);
  const enoughData = usable.length >= 4;
  let season: SeasonOutlook | null = null;
  try {
    season = await seasonOutlook(scope);
  } catch (e) {
    console.warn('season outlook failed:', (e as Error).message); // the sales forecast still works without it
  }
  const wf = (i: number) => season?.weekFactors[i] ?? 1;
  const baseFc = enoughData ? forecastWeeks(usable.map((w) => w.total), 4) : [];
  const withoutSeason30 = round(sum(baseFc.map((f) => f.expected)) * (30 / 28));
  // the calendar is a guess, so the range is also made a little wider than the sales alone would give
  const fc = baseFc.map((f, i) => ({ expected: round(f.expected * wf(i)), low: round(f.low * wf(i) * 0.9), high: round(f.high * wf(i) * 1.1) }));
  const nextWeeks: WeekPoint[] = fc.map((f, i) => ({ weekStart: addDays(thisMonday, 7 * i), total: f.expected, low: f.low, high: f.high, forecast: true }));
  const last4 = sum(usable.slice(-4).map((w) => w.total));
  const prev4 = sum(usable.slice(-8, -4).map((w) => w.total));
  const next30 = {
    expected: round(sum(fc.map((f) => f.expected)) * (30 / 28)),
    low: round(sum(fc.map((f) => f.low)) * (30 / 28)),
    high: round(sum(fc.map((f) => f.high)) * (30 / 28))
  };

  // Early days: a week or two of sales cannot make a weekly forecast, but it does show the pace.
  let pace: Predictions['sales']['pace'] = null;
  let paceBase = 0;
  {
    const days = [...daily.keys()].filter((d) => d < today).sort();
    if (days.length) {
      const span = Math.round((new Date(`${addDays(today, -1)}T00:00:00Z`).getTime() - new Date(`${days[0]}T00:00:00Z`).getTime()) / 86400000) + 1;
      const total = days.reduce((s, d) => s + (daily.get(d) || 0), 0);
      if (span >= 7 && total > 0) {
        const perDay = total / span;
        const f = season?.next30Factor ?? 1;
        paceBase = round(perDay * 30);
        pace = { days: span, perDay: round(perDay), next30: { low: round(perDay * 30 * 0.75 * f * 0.9), expected: round(perDay * 30 * f), high: round(perDay * 30 * 1.25 * f * 1.1) } };
      }
    }
  }

  // busiest weekday over the last 8 full weeks
  const byDow = new Array(7).fill(0);
  for (let i = 8; i >= 1; i--) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(thisMonday, -7 * i + d);
      byDow[(d + 1) % 7] += daily.get(date) || 0; // Monday = index 1
    }
  }
  const dowTotal = sum(byDow);
  let busiest: { name: string; sharePercent: number } | null = null;
  if (dowTotal > 0) {
    const idx = byDow.indexOf(Math.max(...byDow));
    busiest = { name: DAY_NAMES[idx], sharePercent: round((byDow[idx] / dowTotal) * 100) };
  }

  // ---- stock run-out from how fast each item has been selling over the last 90 days ----
  const soldRows = (await db.execute(sql`
    select si.product_id as pid, sum(si.quantity * si.unit_factor)::float as qty, min(s.created_at) as first_at
    from sale_items si join sales s on s.id = si.sale_id
    where si.product_id is not null and s.created_at >= now() - interval '90 days' ${branchFilter('s.branch_id', scope)}
    group by si.product_id`)).rows as { pid: string; qty: number; first_at: string | Date }[];
  const stockRows = (await db.execute(sql`
    select ws.product_id as pid, sum(ws.available)::float as stock
    from warehouse_stocks ws join warehouses w on w.id = ws.warehouse_id
    where true ${branchFilter('w.branch_id', scope)}
    group by ws.product_id`)).rows as { pid: string; stock: number }[];
  const prodRows = (await db.execute(sql`
    select id, sku, name, unit, alternate_unit, conversion_factor, min_stock
    from products where is_archived = false and status <> 'Archived'`)).rows as any[];
  const stockOf = new Map(stockRows.map((r) => [r.pid, Number(r.stock)]));
  const prodOf = new Map(prodRows.map((r) => [r.id, r]));
  const nowMs = Date.now();
  const risks: StockRisk[] = [];
  for (const s of soldRows) {
    const p = prodOf.get(s.pid);
    if (!p || Number(s.qty) < 3) continue; // too little selling to say anything
    const days = Math.min(90, Math.max(14, Math.ceil((nowMs - new Date(s.first_at).getTime()) / 86400000)));
    const perDay = Number(s.qty) / days;
    const stock = Math.max(0, stockOf.get(s.pid) ?? 0);
    const daysLeft = perDay > 0 ? stock / perDay : Infinity;
    if (daysLeft > 30) continue;
    const level: StockRisk['level'] = stock <= 0 ? 'Out' : daysLeft <= 7 ? 'Critical' : daysLeft <= 14 ? 'Soon' : 'Watch';
    const factor = p.alternate_unit && Number(p.conversion_factor) > 1 ? Number(p.conversion_factor) : 0;
    let suggestQty = Math.max(0, Math.ceil(perDay * 45 - stock)); // enough to last about 45 days
    let label = `${suggestQty} ${p.unit}`;
    if (factor && suggestQty > 0) {
      const boxes = Math.ceil(suggestQty / factor);
      suggestQty = boxes * factor;
      label = `${boxes} ${String(p.alternate_unit).toLowerCase()}${boxes === 1 ? '' : 'es'} (${suggestQty} ${p.unit})`;
    }
    risks.push({
      productId: s.pid,
      sku: p.sku,
      name: p.name,
      stock: round(stock),
      unit: p.unit,
      perDay: Math.round(perDay * 100) / 100,
      perMonth: round(perDay * 30),
      daysLeft: stock <= 0 ? 0 : Math.floor(daysLeft),
      runOutDate: stock <= 0 ? null : addDays(today, Math.floor(daysLeft)),
      level,
      suggestQty,
      suggestLabel: label
    });
  }
  risks.sort((a, b) => a.daysLeft - b.daysLeft || b.perMonth - a.perMonth);

  // ---- machine sales ----
  const monthRows = (await db.execute(sql`
    select substring(delivered_date from 1 for 7) as month, count(*)::int as delivered, coalesce(sum(sale_price), 0)::float as value
    from machine_sales
    where status = 'Delivered' and delivered_date >= ${addDays(today, -180)} ${branchFilter('branch_id', scope)}
    group by 1 order by 1`)).rows as { month: string; delivered: number; value: number }[];
  const thisMonth = today.slice(0, 7);
  const fullMonths = monthRows.filter((m) => m.month < thisMonth).slice(-3);
  const nowMonthRow = monthRows.find((m) => m.month === thisMonth);
  const avgPerMonth = fullMonths.length
    ? Math.round((sum(fullMonths.map((m) => m.delivered)) / fullMonths.length) * 10) / 10
    : nowMonthRow
      ? nowMonthRow.delivered
      : 0;
  const avgBasis: Predictions['machines']['avgBasis'] = fullMonths.length ? 'full-months' : nowMonthRow ? 'this-month' : 'none';
  const pipe = (await db.execute(sql`
    select status, count(*)::int as count, coalesce(sum(sale_price), 0)::float as value, coalesce(sum(sale_price - advance_paid), 0)::float as balance
    from machine_sales where status in ('Booked', 'Ready for Delivery', 'Dispatched') ${branchFilter('branch_id', scope)}
    group by status`)).rows as { status: string; count: number; value: number; balance: number }[];
  const dueRow = (await db.execute(sql`
    select count(*)::int as n from machine_sales
    where status in ('Booked', 'Ready for Delivery', 'Dispatched') and substring(expected_delivery_date from 1 for 7) = ${thisMonth} ${branchFilter('branch_id', scope)}`)).rows as { n: number }[];

  // ---- money still to come in from invoices ----
  const col = (await db.execute(sql`
    select
      coalesce(sum(case when due_date < ${today} then grand_total - paid_amount else 0 end), 0)::float as overdue,
      count(case when due_date < ${today} then 1 end)::int as overdue_n,
      coalesce(sum(case when due_date >= ${today} and due_date <= ${addDays(today, 30)} then grand_total - paid_amount else 0 end), 0)::float as due30,
      count(case when due_date >= ${today} and due_date <= ${addDays(today, 30)} then 1 end)::int as due30_n
    from documents
    where doc_type = 'invoice' and status in ('Issued', 'Partially Paid') and grand_total - paid_amount > 0.5 and due_date is not null
      ${branchFilter('branch_id', scope)}`)).rows[0] as any;

  return {
    generatedAt: new Date().toISOString(),
    scope,
    sales: {
      basis: 'Counter sales and invoices (machine sales are shown separately), by week, last 12 weeks',
      weeks: usable,
      nextWeeks,
      next30Days: next30,
      last4Weeks: round(last4),
      prev4Weeks: round(prev4),
      trendPercent: prev4 > 0 ? round(((last4 - prev4) / prev4) * 100) : null,
      busiestDay: busiest,
      enoughData,
      pace,
      season: {
        available: !!season,
        factor: season?.next30Factor ?? 1,
        withoutSeason30: enoughData ? withoutSeason30 : paceBase,
        reasons: season?.reasons ?? [],
        districts: (season?.districts ?? []).map((d) => ({
          key: d.key,
          label: d.label,
          weightPercent: Math.round(d.weight * 100),
          level: d.status.level,
          index: d.status.index,
          now: d.status.now,
          coming: d.status.coming,
          outlook: d.weather.outlook,
          rainSummary: d.weather.summary,
          rainReason: d.weather.rainReason
        }))
      }
    },
    stock: {
      basis: 'How fast each item sold over the last 90 days against what is in stock now',
      risks: risks.slice(0, 25),
      outCount: risks.filter((r) => r.level === 'Out').length,
      criticalCount: risks.filter((r) => r.level === 'Critical').length
    },
    machines: {
      monthly: monthRows.map((m) => ({ month: m.month, delivered: Number(m.delivered), value: round(Number(m.value)) })),
      avgPerMonth,
      avgBasis,
      pipeline: pipe.map((r) => ({ status: r.status, count: Number(r.count), value: round(Number(r.value)), balance: round(Number(r.balance)) })),
      dueThisMonth: Number(dueRow[0]?.n || 0)
    },
    collections: {
      overdue: round(Number(col?.overdue || 0)),
      overdueCount: Number(col?.overdue_n || 0),
      dueNext30: round(Number(col?.due30 || 0)),
      dueNext30Count: Number(col?.due30_n || 0)
    }
  };
}
