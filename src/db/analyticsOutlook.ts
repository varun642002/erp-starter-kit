import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { businessDate } from '../routes/context.ts';

// The year ahead, worked out from the business's own records: how many machines will sell in each month of this
// financial year and the next, and how much of each product will be needed. Everything here comes from the numbers in
// the ERP (the old bills included); nothing is invented, and the method is written out so it can be checked.

const NO_DATE = '1900-01-01';
const round = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN_FULL_YEAR = 30; // a year is only counted as fully recorded when it is at least this many machines and about a third of a typical year
const fullYearLimit = (units: number[]) => {
  const v = units.filter((n) => n > 0).sort((a, b) => a - b);
  const median = v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2 : 0;
  return Math.max(MIN_FULL_YEAR, Math.round(median * 0.35));
};

export interface OutlookYear {
  fy: number;
  label: string;
  units: number;
  value: number;
  avgPrice: number;
  recorded: boolean; // false: no records, or too few to count as a full year
}
export interface OutlookMonth {
  month: string; // YYYY-MM
  label: string;
  actual: number | null; // machines already sold that month (this year only)
  expected: number;
  low: number;
  high: number;
  value: number;
  past: boolean;
}
export interface OutlookPeriod {
  fy: number;
  label: string;
  kind: 'current' | 'next';
  months: OutlookMonth[];
  totalUnits: number;
  totalValue: number;
  low: number;
  high: number;
  soldSoFar: number;
}
export interface OutlookWeek {
  start: string; // the Monday, YYYY-MM-DD
  label: string;
  kind: 'past' | 'now' | 'next';
  actual: number | null;
  expected: number;
  low: number;
  high: number;
  value: number;
}
export interface ProductNeed {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  soldLast12: number;
  trend: number;
  expectedNext12: number;
  inStock: number;
  toBuy: number;
}
export interface OldItem {
  name: string;
  perYear: { fy: number; qty: number }[];
  avgPerYear: number;
}
export interface Outlook {
  today: string;
  thisFy: number;
  method: {
    historyLevel: number;
    paceLevel: number | null;
    expected: number;
    low: number;
    high: number;
    avgPrice: number;
    recordedYears: string[];
    gapYears: string[];
    totalSales: number;
    notes: string[];
  };
  history: OutlookYear[];
  monthIndex: number[]; // Jan..Dec, 1 = an average month
  periods: OutlookPeriod[];
  weeks: OutlookWeek[];
  models: { model: string; share: number; next12: number }[];
  products: ProductNeed[];
  oldItems: OldItem[];
}

const fyOf = (ymd: string) => (Number(ymd.slice(5, 7)) >= 4 ? Number(ymd.slice(0, 4)) : Number(ymd.slice(0, 4)) - 1);
const fyLabel = (fy: number) => `${fy}-${fy + 1}`;

export async function getOutlook(scope: string): Promise<Outlook> {
  const today = businessDate();
  const thisFy = fyOf(today);
  const bf = branchFilter('branch_id', scope);

  // ---- machines sold in each financial year
  const yearRows = (await db.execute(sql`
    select (case when substr(booking_date, 6, 2)::int >= 4 then substr(booking_date, 1, 4)::int else substr(booking_date, 1, 4)::int - 1 end) as fy,
           count(*)::int as units, coalesce(sum(sale_price), 0)::float8 as value
    from machine_sales where status <> 'Cancelled' and booking_date <> ${NO_DATE} ${bf} group by 1 order by 1`)).rows as any[];
  const byFy = new Map<number, { units: number; value: number }>(yearRows.map((r) => [Number(r.fy), { units: Number(r.units), value: Number(r.value) }]));
  const first = Math.min(thisFy, ...yearRows.map((r) => Number(r.fy)));
  const history: OutlookYear[] = [];
  const limit = fullYearLimit([...byFy.values()].map((v) => v.units));
  for (let y = first; y <= thisFy; y++) {
    const v = byFy.get(y) ?? { units: 0, value: 0 };
    history.push({ fy: y, label: fyLabel(y), units: v.units, value: round(v.value), avgPrice: v.units ? round(v.value / v.units) : 0, recorded: v.units >= limit });
  }
  const totalSales = history.reduce((s, y) => s + y.units, 0);

  // ---- which months machines sell in (all years together, smoothed with the neighbouring months)
  const monthRows = (await db.execute(sql`
    select substr(booking_date, 6, 2)::int as m, count(*)::int as n from machine_sales
    where status <> 'Cancelled' and booking_date <> ${NO_DATE} ${bf} group by 1`)).rows as any[];
  const raw = Array.from({ length: 12 }, (_, i) => Number(monthRows.find((r) => Number(r.m) === i + 1)?.n ?? 0));
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const smooth = raw.map((v, i) => 0.25 * raw[(i + 11) % 12] + 0.5 * v + 0.25 * raw[(i + 1) % 12]);
  const mean = smooth.reduce((a, b) => a + b, 0) / 12;
  const monthIndex = rawTotal >= 60 && mean > 0 ? smooth.map((v) => r1(v / mean * 100) / 100) : new Array(12).fill(1);
  const share = (m: number) => monthIndex[m - 1] / monthIndex.reduce((a, b) => a + b, 0); // share of a year's machines sold in month m (1..12)

  // ---- the level: recent recorded years, newest counting most
  const recorded = history.filter((y) => y.recorded && y.fy < thisFy);
  const lastFour = recorded.slice(-4);
  const weights = lastFour.map((_, i) => i + 1);
  const historyLevel = lastFour.length ? round(lastFour.reduce((s, y, i) => s + y.units * weights[i], 0) / weights.reduce((a, b) => a + b, 0)) : 0;
  const unitsPrice = lastFour.reduce((s, y) => s + y.units, 0);
  const avgPrice = unitsPrice ? round(lastFour.reduce((s, y) => s + y.value, 0) / unitsPrice) : 0;

  // ---- this year so far
  const fyStart = `${thisFy}-04-01`;
  const fyEnd = `${thisFy + 1}-03-31`;
  const nowRows = (await db.execute(sql`
    select substr(booking_date, 1, 7) as ym, count(*)::int as n, coalesce(sum(sale_price), 0)::float8 as v from machine_sales
    where status <> 'Cancelled' and booking_date >= ${fyStart} and booking_date <= ${fyEnd} ${bf} group by 1`)).rows as any[];
  const actual = new Map<string, { n: number; v: number }>(nowRows.map((r) => [r.ym, { n: Number(r.n), v: Number(r.v) }]));
  const soldSoFar = [...actual.values()].reduce((s, a) => s + a.n, 0);
  const soldValue = [...actual.values()].reduce((s, a) => s + a.v, 0);
  // how much of a year's machine sales the months gone by usually hold (the part of the current month that has passed counts too)
  const liveRow = (await db.execute(sql`
    select min(booking_date) as d from machine_sales
    where status <> 'Cancelled' and not is_historical and booking_date >= ${fyStart} and booking_date <= ${fyEnd} ${bf}`)).rows[0] as any;
  const liveStart: string | null = liveRow?.d ?? null; // before this day nothing was entered in the ERP, so those months say nothing
  const monthNow = Number(today.slice(5, 7));
  const dayNow = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), monthNow, 0)).getUTCDate();
  const fyMonths = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  let elapsedShare = 0;
  if (liveStart) {
    const sm = Number(liveStart.slice(5, 7));
    const sd = Number(liveStart.slice(8, 10));
    for (const m of fyMonths.slice(fyMonths.indexOf(sm))) {
      const dim = new Date(Date.UTC(m >= 4 ? thisFy : thisFy + 1, m, 0)).getUTCDate();
      const from = m === sm ? sd : 1;
      const to = m === monthNow ? dayNow : dim;
      elapsedShare += share(m) * ((to - from + 1) / dim);
      if (m === monthNow) break;
    }
  }
  const paceLevel = liveStart && elapsedShare >= 0.05 ? round(soldSoFar / elapsedShare) : null;
  const priceNow = soldSoFar >= 5 ? round(soldValue / soldSoFar) : avgPrice;
  const price = priceNow || avgPrice;

  // ---- the three estimates for a full year
  let expected = historyLevel;
  let low = historyLevel;
  let high = historyLevel;
  if (paceLevel !== null && historyLevel) {
    expected = round((historyLevel + paceLevel) / 2);
    low = Math.min(historyLevel, paceLevel);
    high = Math.max(historyLevel, paceLevel);
  } else if (paceLevel !== null) {
    expected = low = high = paceLevel;
  } else if (lastFour.length > 1) {
    // no pace yet: the spread of the recent years shows how much it can move
    low = Math.min(...lastFour.map((y) => y.units));
    high = Math.max(...lastFour.map((y) => y.units));
  }

  // ---- month by month for this financial year and the next
  const periods: OutlookPeriod[] = [];
  for (const [kind, fy] of [['current', thisFy], ['next', thisFy + 1]] as const) {
    const months: OutlookMonth[] = [];
    let totalUnits = 0;
    let totalLow = 0;
    let totalHigh = 0;
    for (const m of fyMonths) {
      const year = m >= 4 ? fy : fy + 1;
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const past = ym < today.slice(0, 7);
      const a = actual.get(ym);
      const unrecorded = kind === 'current' && past && (!liveStart || ym < liveStart.slice(0, 7)) && !a; // nothing was entered in the ERP for that month
      const exp = expected * share(m);
      const lo = low * share(m);
      const hi = high * share(m);
      let units: number;
      let lowU: number;
      let highU: number;
      if (kind === 'current' && past) {
        units = lowU = highU = a?.n ?? 0;
      } else if (kind === 'current' && ym === today.slice(0, 7)) {
        // the month under way: what is already sold, or the month's usual figure if that is more
        units = Math.max(a?.n ?? 0, exp);
        lowU = Math.max(a?.n ?? 0, lo);
        highU = Math.max(a?.n ?? 0, hi);
      } else {
        units = exp;
        lowU = lo;
        highU = hi;
      }
      totalUnits += units;
      totalLow += lowU;
      totalHigh += highU;
      months.push({ month: ym, label: `${MONTHS[m - 1]} ${year}`, actual: kind === 'current' && (past || ym === today.slice(0, 7)) && !unrecorded ? a?.n ?? 0 : null, expected: r1(units), low: r1(lowU), high: r1(highU), value: round(units * price), past: kind === 'current' && past });
    }
    periods.push({ fy, label: fyLabel(fy), kind, months, totalUnits: round(totalUnits), totalValue: round(totalUnits * price), low: round(totalLow), high: round(totalHigh), soldSoFar: kind === 'current' ? soldSoFar : 0 });
  }

  // ---- week by week: the last 8 weeks as sold, then the next 14 weeks as expected
  const weekDayShare = (d: Date) => {
    const m = d.getUTCMonth() + 1;
    return share(m) / new Date(Date.UTC(d.getUTCFullYear(), m, 0)).getUTCDate();
  };
  const mondayOf = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const thisMonday = mondayOf(today);
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekRows = (await db.execute(sql`
    select to_char(date_trunc('week', booking_date::date), 'YYYY-MM-DD') as wk, count(*)::int as n from machine_sales
    where status <> 'Cancelled' and booking_date <> ${NO_DATE} and booking_date >= ${addDays(thisMonday, -56)} ${bf} group by 1`)).rows as any[];
  const soldWeek = new Map<string, number>(weekRows.map((r) => [r.wk, Number(r.n)]));
  const weeks: OutlookWeek[] = [];
  for (let i = -8; i < 14; i++) {
    const start = addDays(thisMonday, i * 7);
    let e = 0;
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 7; k++) {
      const d = new Date(`${addDays(start, k)}T12:00:00Z`);
      const f = weekDayShare(d);
      e += expected * f;
      lo += low * f;
      hi += high * f;
    }
    const kind = i < 0 ? 'past' : i === 0 ? 'now' : 'next';
    const recordedWeek = !liveStart || start >= mondayOf(liveStart) || start < fyStart; // weeks before anything was entered in the ERP say nothing
    const a = kind === 'next' ? null : soldWeek.has(start) ? soldWeek.get(start)! : recordedWeek && start >= fyStart ? 0 : null;
    const [yy, mm, dd] = start.split('-').map(Number);
    weeks.push({
      start,
      label: `${dd} ${MONTHS[mm - 1]}`,
      kind,
      actual: a,
      expected: r1(kind === 'now' ? Math.max(e, a ?? 0) : e),
      low: r1(kind === 'now' ? Math.max(lo, a ?? 0) : lo),
      high: r1(kind === 'now' ? Math.max(hi, a ?? 0) : hi),
      value: round((kind === 'now' ? Math.max(e, a ?? 0) : e) * price)
    });
    void yy;
  }

  // ---- which machines: the mix of the recent recorded years and this year
  const mixYears = [...lastFour.map((y) => y.fy), thisFy];
  const modelRows = (await db.execute(sql`
    select coalesce(nullif(model, ''), machine_name) as model, count(*)::int as n from machine_sales
    where status <> 'Cancelled' and booking_date <> ${NO_DATE} ${bf}
      and (case when substr(booking_date, 6, 2)::int >= 4 then substr(booking_date, 1, 4)::int else substr(booking_date, 1, 4)::int - 1 end) in (${sql.join(mixYears.map((y) => sql`${y}`), sql`, `)})
    group by 1 order by 2 desc limit 8`)).rows as any[];
  const modelTotal = modelRows.reduce((s, r) => s + Number(r.n), 0);
  const next12 = periods[1].totalUnits;
  const models = modelRows.map((r) => ({ model: String(r.model), share: modelTotal ? r1((Number(r.n) / modelTotal) * 1000) / 10 : 0, next12: modelTotal ? round((Number(r.n) / modelTotal) * next12) : 0 }));

  // ---- products: what was sold in the last 12 months, and what that means for the next 12
  const stockBranch = scope && scope !== 'all' ? sql`and w.branch_id = ${scope}` : sql``;
  const saleBranch = branchFilter('s.branch_id', scope);
  const docBranch = branchFilter('d.branch_id', scope);
  const prodRows = (await db.execute(sql`
    with sold as (
      select si.product_id as pid, (s.created_at >= now() - interval '183 days') as recent, sum(si.quantity * coalesce(si.unit_factor, 1))::float8 as q
      from sale_items si join sales s on s.id = si.sale_id
      where si.product_id is not null and s.created_at >= now() - interval '365 days' ${saleBranch} group by 1, 2
      union all
      select di.product_id, (d.doc_date >= to_char(now() - interval '183 days', 'YYYY-MM-DD')), sum(di.quantity)::float8
      from document_items di join documents d on d.id = di.document_id
      where di.product_id is not null and d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and not d.is_historical
        and d.doc_date >= to_char(now() - interval '365 days', 'YYYY-MM-DD') ${docBranch} group by 1, 2
    ), agg as (
      select pid, sum(q) as total, sum(case when recent then q else 0 end) as h2, sum(case when recent then 0 else q end) as h1 from sold group by pid
    )
    select p.id, p.name, p.sku, p.unit, a.total::float8 as total, a.h1::float8 as h1, a.h2::float8 as h2,
      coalesce((select sum(ws.available) from warehouse_stocks ws join warehouses w on w.id = ws.warehouse_id where ws.product_id = p.id ${stockBranch}), 0)::float8 as stock
    from agg a join products p on p.id = a.pid where p.is_archived = false order by a.total desc limit 40`)).rows as any[];
  const products: ProductNeed[] = prodRows.map((r) => {
    const total = Number(r.total);
    const trend = Number(r.h1) > 0 && Number(r.h2) > 0 ? Math.min(1.25, Math.max(0.8, Number(r.h2) / Number(r.h1))) : 1;
    const expectedNext12 = round(total * trend);
    const inStock = round(Number(r.stock));
    return { productId: r.id, name: r.name, sku: r.sku, unit: r.unit, soldLast12: round(total), trend: r1(trend * 100) / 100, expectedNext12, inStock, toBuy: Math.max(0, expectedNext12 - inStock) };
  });

  // ---- spares and parts on the old bills, year by year (they were not linked to products, so they are matched by name)
  const oldRows = (await db.execute(sql`
    select lower(regexp_replace(trim(di.description), '\\s+', ' ', 'g')) as name, max(di.description) as shown,
      (case when substr(d.doc_date, 6, 2)::int >= 4 then substr(d.doc_date, 1, 4)::int else substr(d.doc_date, 1, 4)::int - 1 end) as fy, sum(di.quantity)::float8 as q
    from document_items di join documents d on d.id = di.document_id
    where d.is_historical and d.doc_date <> ${NO_DATE} and di.rate < 20000 and di.description !~* '(MSC|MSG|baler|tractor|bagger)' ${docBranch}
    group by 1, 3`)).rows as any[];
  const oldBy = new Map<string, { name: string; perYear: Map<number, number> }>();
  for (const r of oldRows) {
    const e = oldBy.get(r.name) ?? { name: r.shown, perYear: new Map() };
    e.perYear.set(Number(r.fy), Number(r.q));
    oldBy.set(r.name, e);
  }
  const recYears = recorded.map((y) => y.fy);
  const oldItems: OldItem[] = [...oldBy.values()]
    .map((e) => {
      const ws = recYears.slice(-4);
      const wsum = ws.reduce((s, _, i) => s + i + 1, 0);
      const avg = wsum ? ws.reduce((s, y, i) => s + (e.perYear.get(y) ?? 0) * (i + 1), 0) / wsum : 0;
      return { name: e.name, perYear: [...e.perYear.entries()].sort((a, b) => a[0] - b[0]).map(([fy, qty]) => ({ fy, qty: round(qty) })), avgPerYear: round(avg) };
    })
    .filter((e) => e.avgPerYear > 0)
    .sort((a, b) => b.avgPerYear - a.avgPerYear)
    .slice(0, 25);

  const gapYears = history.filter((y) => !y.recorded && y.fy < thisFy).map((y) => y.label);
  const notes = [
    `Machines sold each year come from ${totalSales.toLocaleString('en-IN')} machine sales in the ERP, including the old bills.`,
    lastFour.length ? `The level is the recent years' average, newest counting most: ${lastFour.map((y) => `${y.label} (${y.units})`).join(', ')}.` : 'There are not enough recorded years to set a level yet.',
    paceLevel !== null ? `This year's pace (${soldSoFar} machines sold since ${liveStart}, which is the first sale entered in the ERP this year, worked out to ${paceLevel} for a full year) is averaged with that level.` : 'There are not enough sales entered this year yet to use this year\'s pace.',
    `The months follow when machines sold across all the years (more in February to March and December).`,
    gapYears.length ? `No sales are recorded for ${gapYears.join(', ')}, so those years are left out of the level.` : ''
  ].filter(Boolean);

  return {
    today,
    thisFy,
    method: { historyLevel, paceLevel, expected, low, high, avgPrice: price, recordedYears: recorded.map((y) => y.label), gapYears, totalSales, notes },
    history,
    monthIndex,
    periods,
    weeks,
    models,
    products,
    oldItems
  };
}

// ---------------------------------------------------------------- machines in detail

export interface MachineStats {
  kpis: {
    totalUnits: number;
    totalValue: number;
    noDateUnits: number;
    avgPrice: number;
    firstYear: string | null;
    lastYear: string | null;
    bestYear: { label: string; units: number } | null;
    bestMonth: { name: string; units: number } | null;
    quietMonth: { name: string; units: number } | null;
    peakShare: number; // % of machines sold in February and March
    avgPerMonth: number; // in the recorded years
    growth: { from: string; to: string; percent: number } | null;
    buyers: number;
    biggestBuyer: { name: string; units: number } | null;
  };
  years: { fy: number; label: string; units: number; value: number; avgPrice: number; growth: number | null; topModel: string | null; recorded: boolean }[];
  grid: { fy: number; label: string; months: number[]; total: number }[]; // April..March
  gridMonths: string[];
  models: string[];
  modelsByYear: { fy: number; label: string; counts: number[]; other: number }[];
  modelTotals: { model: string; units: number; value: number; avgPrice: number }[];
  kinds: { fy: number; label: string; Rotavator: number; Baler: number; Tractor: number; Other: number }[];
  buyers: { name: string; units: number; value: number; last: string | null }[];
  monthTotals: { name: string; units: number }[]; // Jan..Dec, all years
}

const KIND_SQL = sql`(case when machine_name ~* '(baler|AB-?\\s?(series|1000))' then 'Baler' when machine_name ~* 'tractor' then 'Tractor' when machine_name ~* '(GES|MSC|MSG|AE-?\\d|rotavator|tiller)' then 'Rotavator' else 'Other' end)`;
const FY_SQL = sql`(case when substr(booking_date, 6, 2)::int >= 4 then substr(booking_date, 1, 4)::int else substr(booking_date, 1, 4)::int - 1 end)`;

export async function getMachineStats(scope: string): Promise<MachineStats> {
  const bf = branchFilter('branch_id', scope);
  const live = sql`status <> 'Cancelled' and booking_date <> ${NO_DATE}`;
  const yearRows = (await db.execute(sql`select ${FY_SQL} as fy, count(*)::int as n, coalesce(sum(sale_price), 0)::float8 as v from machine_sales where ${live} ${bf} group by 1 order by 1`)).rows as any[];
  const gridRows = (await db.execute(sql`select ${FY_SQL} as fy, substr(booking_date, 6, 2)::int as m, count(*)::int as n from machine_sales where ${live} ${bf} group by 1, 2`)).rows as any[];
  const modelRows = (await db.execute(sql`select ${FY_SQL} as fy, coalesce(nullif(model, ''), machine_name) as model, count(*)::int as n, coalesce(sum(sale_price), 0)::float8 as v from machine_sales where ${live} ${bf} group by 1, 2`)).rows as any[];
  const kindRows = (await db.execute(sql`select ${FY_SQL} as fy, ${KIND_SQL} as kind, count(*)::int as n from machine_sales where ${live} ${bf} group by 1, 2`)).rows as any[];
  const buyerRows = (await db.execute(sql`
    select customer_name as name, count(*)::int as n, coalesce(sum(sale_price), 0)::float8 as v, max(nullif(booking_date, ${NO_DATE})) as last
    from machine_sales where status <> 'Cancelled' ${bf} group by 1 order by 2 desc, 3 desc`)).rows as any[];
  const noDate = ((await db.execute(sql`select count(*)::int as n from machine_sales where status <> 'Cancelled' and booking_date = ${NO_DATE} ${bf}`)).rows[0] as any).n as number;

  const byFy = new Map<number, { n: number; v: number }>(yearRows.map((r) => [Number(r.fy), { n: Number(r.n), v: Number(r.v) }]));
  const firstFy = yearRows.length ? Number(yearRows[0].fy) : 0;
  const lastFy = yearRows.length ? Number(yearRows[yearRows.length - 1].fy) : 0;
  const fyList: number[] = [];
  for (let y = firstFy; y <= lastFy && firstFy; y++) fyList.push(y);

  // models: the ten that sold most, the rest together
  const modelTotal = new Map<string, { n: number; v: number }>();
  for (const r of modelRows) {
    const e = modelTotal.get(r.model) ?? { n: 0, v: 0 };
    e.n += Number(r.n);
    e.v += Number(r.v);
    modelTotal.set(r.model, e);
  }
  const ranked = [...modelTotal.entries()].sort((a, b) => b[1].n - a[1].n);
  const models = ranked.slice(0, 10).map(([m]) => m);
  const topModelOf = new Map<number, { m: string; n: number }>();
  for (const r of modelRows) {
    const fy = Number(r.fy);
    const cur = topModelOf.get(fy);
    if (!cur || Number(r.n) > cur.n) topModelOf.set(fy, { m: r.model, n: Number(r.n) });
  }

  const fullLimit = fullYearLimit([...byFy.values()].map((v) => v.n));
  const years: MachineStats['years'] = fyList.map((fy, i) => {
    const v = byFy.get(fy) ?? { n: 0, v: 0 };
    const prev = i > 0 ? byFy.get(fyList[i - 1]) : undefined;
    return {
      fy,
      label: fyLabel(fy),
      units: v.n,
      value: round(v.v),
      avgPrice: v.n ? round(v.v / v.n) : 0,
      growth: prev && prev.n >= fullLimit && v.n ? Math.round(((v.n - prev.n) / prev.n) * 100) : null,
      topModel: topModelOf.get(fy)?.m ?? null,
      recorded: v.n >= fullLimit
    };
  });

  const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const grid = fyList.map((fy) => {
    const months = order.map((m) => Number(gridRows.find((r) => Number(r.fy) === fy && Number(r.m) === m)?.n ?? 0));
    return { fy, label: fyLabel(fy), months, total: months.reduce((a, b) => a + b, 0) };
  });
  const modelsByYear = fyList.map((fy) => {
    const counts = models.map((m) => Number(modelRows.find((r) => Number(r.fy) === fy && r.model === m)?.n ?? 0));
    const total = byFy.get(fy)?.n ?? 0;
    return { fy, label: fyLabel(fy), counts, other: Math.max(0, total - counts.reduce((a, b) => a + b, 0)) };
  });
  const kinds = fyList.map((fy) => {
    const get = (k: string) => Number(kindRows.find((r) => Number(r.fy) === fy && r.kind === k)?.n ?? 0);
    return { fy, label: fyLabel(fy), Rotavator: get('Rotavator'), Baler: get('Baler'), Tractor: get('Tractor'), Other: get('Other') };
  });

  const monthTotalsArr = Array.from({ length: 12 }, (_, i) => grid.reduce((s, g) => s + g.months[order.indexOf(i + 1)], 0));
  const monthTotals = monthTotalsArr.map((n, i) => ({ name: MONTHS[i], units: n }));
  const totalUnits = years.reduce((s, y) => s + y.units, 0);
  const totalValue = years.reduce((s, y) => s + y.value, 0);
  const rec = years.filter((y) => y.recorded);
  const best = [...years].sort((a, b) => b.units - a.units)[0];
  const bestM = [...monthTotals].sort((a, b) => b.units - a.units)[0];
  const quietM = [...monthTotals].sort((a, b) => a.units - b.units)[0];
  const lastTwo = rec.slice(-2);
  const buyers = buyerRows.slice(0, 12).map((r) => ({ name: r.name, units: Number(r.n), value: round(Number(r.v)), last: r.last ?? null }));

  return {
    kpis: {
      totalUnits,
      totalValue: round(totalValue),
      noDateUnits: noDate,
      avgPrice: totalUnits ? round(totalValue / totalUnits) : 0,
      firstYear: years[0]?.label ?? null,
      lastYear: years[years.length - 1]?.label ?? null,
      bestYear: best ? { label: best.label, units: best.units } : null,
      bestMonth: bestM && bestM.units ? bestM : null,
      quietMonth: quietM ?? null,
      peakShare: totalUnits ? Math.round(((monthTotalsArr[1] + monthTotalsArr[2]) / totalUnits) * 100) : 0,
      avgPerMonth: rec.length ? r1(rec.reduce((s, y) => s + y.units, 0) / (rec.length * 12)) : 0,
      growth: lastTwo.length === 2 && lastTwo[0].units ? { from: lastTwo[0].label, to: lastTwo[1].label, percent: Math.round(((lastTwo[1].units - lastTwo[0].units) / lastTwo[0].units) * 100) } : null,
      buyers: buyerRows.length,
      biggestBuyer: buyerRows[0] ? { name: buyerRows[0].name, units: Number(buyerRows[0].n) } : null
    },
    years,
    grid,
    gridMonths: order.map((m) => MONTHS[m - 1]),
    models,
    modelsByYear,
    modelTotals: ranked.slice(0, 12).map(([model, e]) => ({ model, units: e.n, value: round(e.v), avgPrice: e.n ? round(e.v / e.n) : 0 })),
    kinds,
    buyers,
    monthTotals
  };
}
