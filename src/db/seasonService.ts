import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';
import { DISTRICTS, CALENDAR_SOURCES, HISTORY_WEIGHT, averageDemand, demandIndexByMonth, districtOfBranch, seasonStatus, setHistoryIndex, type DistrictKey } from './farmingCalendar.ts';
import { getDistrictWeather, type DistrictWeather } from './weatherService.ts';

// How much of the calendar's effect is trusted. The calendar is a well-sourced guess about when land is prepared; it is not
// yet checked against this business's own seasons, so it only moves the estimate 60% of the way.
const CALENDAR_TRUST = 0.6;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DistrictOutlook {
  key: DistrictKey;
  label: string;
  weight: number; // share of the sales this outlook is built for
  branches: string[];
  status: ReturnType<typeof seasonStatus>;
  next30CalendarFactor: number;
  weather: DistrictWeather;
  neNormalMm: number;
  swNormalMm: number;
  monthlyIndex: number[]; // machinery demand for Jan..Dec, 1 = an average month
  seasons: { name: string; startMonth: number; endMonth: number }[];
}

export interface SeasonOutlook {
  today: string;
  districts: DistrictOutlook[];
  weekFactors: number[]; // for the 4 forecast weeks starting this week's Monday: calendar and rain together
  calendarFactors: number[];
  rainFactors: number[];
  next30Factor: number;
  reasons: string[];
  sources: typeof CALENDAR_SOURCES;
  // what the business's own machine sales say about the months (null until there are enough sales)
  history: { units: number; fromYear: number; toYear: number; weight: number; monthly: number[] } | null;
}

// Machine sales by month over all the years, smoothed with the neighbouring months so one busy week does not make a spike.
let historyCache: { at: number; value: SeasonOutlook['history'] } | null = null;
async function machineHistory(): Promise<SeasonOutlook['history']> {
  if (historyCache && Date.now() - historyCache.at < 6 * 3600_000) return historyCache.value;
  let value: SeasonOutlook['history'] = null;
  try {
    const rows = (await db.execute(sql`
      select substr(booking_date, 6, 2)::int as m, count(*)::int as n, min(substr(booking_date, 1, 4)::int) as y0, max(substr(booking_date, 1, 4)::int) as y1
      from machine_sales where status <> 'Cancelled' and booking_date <> '1900-01-01' group by 1`)).rows as any[];
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    if (total >= 300) {
      const raw = Array.from({ length: 12 }, (_, i) => Number(rows.find((r) => Number(r.m) === i + 1)?.n ?? 0));
      const smooth = raw.map((v, i) => 0.25 * raw[(i + 11) % 12] + 0.5 * v + 0.25 * raw[(i + 1) % 12]);
      const mean = smooth.reduce((a, b) => a + b, 0) / 12;
      value = {
        units: total,
        fromYear: Math.min(...rows.map((r) => Number(r.y0))),
        toYear: Math.max(...rows.map((r) => Number(r.y1))),
        weight: HISTORY_WEIGHT,
        monthly: smooth.map((v) => Math.round((v / mean) * 100) / 100)
      };
    }
  } catch (e) {
    console.warn('machine sales history not loaded:', (e as Error).message);
  }
  historyCache = { at: Date.now(), value };
  return value;
}

export async function branchesWithDistricts(): Promise<{ id: string; name: string; district: DistrictKey }[]> {
  const rows = (await db.execute(sql`select id, name from branches order by id`)).rows as { id: string; name: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, district: districtOfBranch(r.name) }));
}

function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

// scope: 'all' or one branch id
export async function seasonOutlook(scope: string): Promise<SeasonOutlook> {
  const history = await machineHistory();
  setHistoryIndex(history ? history.monthly : null);
  const today = businessDate();
  const thisMonday = mondayOf(today);
  const branches = await branchesWithDistricts();

  // weight each district by what its branches sold in the last 30 days (equal weights when nothing sold)
  const sold = (await db.execute(sql`
    select branch_id, coalesce(sum(grand_total), 0)::float as total from sales
    where created_at >= now() - interval '30 days' group by branch_id`)).rows as { branch_id: string; total: number }[];
  const soldBy = new Map(sold.map((r) => [r.branch_id, Number(r.total)]));
  const weight = new Map<DistrictKey, number>();
  const inScope = branches.filter((b) => scope === 'all' || b.id === scope);
  const useBranches = inScope.length ? inScope : branches;
  for (const b of useBranches) weight.set(b.district, (weight.get(b.district) || 0) + (scope === 'all' ? soldBy.get(b.id) || 0 : 1));
  let total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) {
    weight.clear();
    for (const b of useBranches) weight.set(b.district, (weight.get(b.district) || 0) + 1);
    total = [...weight.values()].reduce((a, b) => a + b, 0);
  }

  const districts: DistrictOutlook[] = [];
  for (const [key, w] of weight) {
    const status = seasonStatus(key, today);
    const weather = await getDistrictWeather(key, status.index >= 1.05);
    const base = averageDemand(key, addDays(today, -28), 28);
    const next = averageDemand(key, today, 30);
    districts.push({
      key,
      label: DISTRICTS[key].label,
      weight: r2(w / total),
      branches: branches.filter((b) => b.district === key && (scope === 'all' || b.id === scope)).map((b) => b.name),
      status,
      next30CalendarFactor: r2(clamp(1 + CALENDAR_TRUST * (next / base - 1), 0.6, 1.5)),
      weather,
      neNormalMm: DISTRICTS[key].neNormalMm,
      swNormalMm: DISTRICTS[key].swNormalMm,
      monthlyIndex: demandIndexByMonth(key).map((v) => Math.round(v * 100) / 100),
      seasons: DISTRICTS[key].seasons.map((x) => ({ name: x.name, startMonth: x.startMonth, endMonth: x.endMonth }))
    });
  }

  // four forecast weeks, each against the average of the last 28 days
  const calendarFactors: number[] = [];
  const rainFactors: number[] = [];
  const weekFactors: number[] = [];
  for (let i = 0; i < 4; i++) {
    const weekStart = addDays(thisMonday, 7 * i);
    let cal = 0;
    let rain = 0;
    for (const d of districts) {
      const base = averageDemand(d.key, addDays(today, -28), 28);
      const wk = averageDemand(d.key, weekStart, 7);
      cal += d.weight * clamp(1 + CALENDAR_TRUST * (wk / base - 1), 0.6, 1.5);
      // rain only changes the next two weeks; it fades after that
      rain += d.weight * (i <= 1 ? d.weather.rainFactor : 1);
    }
    calendarFactors.push(r2(cal));
    rainFactors.push(r2(rain));
    weekFactors.push(r2(cal * rain));
  }
  const next30Factor = r2((weekFactors.reduce((a, b) => a + b, 0) / 4));

  const reasons: string[] = [];
  for (const d of districts) {
    const tag = districts.length > 1 ? `${d.label}: ` : '';
    for (const s of d.status.now.slice(0, 2)) reasons.push(`${tag}${s}`);
    if (d.weather.ok && d.weather.rainFactor !== 1) reasons.push(`${tag}${d.weather.rainReason}`);
  }
  const pct = Math.round((next30Factor - 1) * 100);
  reasons.unshift(
    pct === 0 ? 'Season and rain together leave the sales estimate about where it is' : `Season and rain together move the sales estimate ${pct > 0 ? 'up' : 'down'} by ${Math.abs(pct)}%`
  );

  return { today, districts, weekFactors, calendarFactors, rainFactors, next30Factor, reasons, sources: CALENDAR_SOURCES, history };
}
