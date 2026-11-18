import { DISTRICTS, type DistrictKey } from './farmingCalendar.ts';
import { addDays, businessDate } from '../routes/context.ts';

// Live weather from Open-Meteo (free, no key; it sends back rain for the coordinates asked, and we send nothing else).
// Forecast + the last 30 days of observed rain come in one call. Long-run "normal" rain per calendar day is the average of
// the last 11 years from Open-Meteo's historical archive.

export interface RainDay {
  date: string;
  mm: number;
  probability: number | null; // percent, forecast days only
  tmax: number | null;
  past: boolean;
}

export interface DistrictWeather {
  key: DistrictKey;
  label: string;
  ok: boolean;
  days: RainDay[];
  last7mm: number;
  last30mm: number;
  next7mm: number;
  next14mm: number;
  normalLast30mm: number | null;
  departurePercent: number | null; // last 30 days against normal for the same dates
  maxDay: { date: string; mm: number } | null; // wettest day in the next 14
  outlook: 'Heavy rain' | 'Wet' | 'Showers' | 'Mostly dry';
  summary: string;
  rainFactor: number; // what this does to machinery demand over the next two weeks
  rainReason: string;
}

const TTL_FORECAST = 3 * 3600_000;
const TTL_CLIMATE = 7 * 24 * 3600_000;
const cache = new Map<string, { at: number; value: any }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`weather service answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// average rain for each month-day ("10-25") over the last 11 full years
async function climatology(key: DistrictKey): Promise<Map<string, number>> {
  return cached(`clim:${key}`, TTL_CLIMATE, async () => {
    const d = DISTRICTS[key];
    const y = Number(businessDate().slice(0, 4));
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${d.lat}&longitude=${d.lon}&start_date=${y - 11}-01-01&end_date=${y - 1}-12-31&daily=precipitation_sum&timezone=Asia%2FKolkata`;
    const j = await getJson(url);
    const sums = new Map<string, { s: number; n: number }>();
    (j.daily?.time as string[]).forEach((date, i) => {
      const mm = Number(j.daily.precipitation_sum[i]);
      if (!Number.isFinite(mm)) return;
      const md = date.slice(5);
      const cur = sums.get(md) || { s: 0, n: 0 };
      cur.s += mm;
      cur.n += 1;
      sums.set(md, cur);
    });
    return new Map([...sums].map(([k, v]) => [k, v.s / v.n]));
  });
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

// The effect of rain on machinery demand over the next two weeks. These are judgement rules, written down so they can be
// argued with: they are not fitted to sales yet.
export function rainEffect(next7mm: number, next14mm: number, maxDayMm: number, last30mm: number, normal30mm: number | null, landPrepSeason: boolean): { factor: number; reason: string } {
  if (next7mm >= 100 || maxDayMm >= 60) {
    return { factor: 0.85, reason: `Heavy rain coming (${Math.round(next7mm)} mm in 7 days): fields are too wet to work for several days, so spares and implements sell less until it dries` };
  }
  if (next7mm >= 25 && landPrepSeason) {
    return { factor: 1.08, reason: `Good rain coming (${Math.round(next7mm)} mm in 7 days) in a land preparation month: farmers start ploughing once the soil is soft, so expect a rush after it` };
  }
  if (next14mm < 5 && normal30mm !== null && last30mm < normal30mm * 0.5) {
    return { factor: 0.92, reason: 'A dry spell: little rain ahead and the last 30 days were well below normal, so sowing on rain-fed land is delayed' };
  }
  return { factor: 1, reason: 'Rain looks normal for the next two weeks, so no change is made to the sales estimate' };
}

export async function getDistrictWeather(key: DistrictKey, landPrepSeason: boolean): Promise<DistrictWeather> {
  const d = DISTRICTS[key];
  const empty: DistrictWeather = {
    key, label: d.label, ok: false, days: [], last7mm: 0, last30mm: 0, next7mm: 0, next14mm: 0, normalLast30mm: null, departurePercent: null,
    maxDay: null, outlook: 'Mostly dry', summary: 'Weather could not be loaded right now', rainFactor: 1, rainReason: 'Weather not available, so no rain adjustment is made'
  };
  try {
    const f = await cached(`fc:${key}`, TTL_FORECAST, () =>
      getJson(`https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lon}&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max&past_days=30&forecast_days=16&timezone=Asia%2FKolkata`)
    );
    const today = businessDate();
    const days: RainDay[] = (f.daily.time as string[]).map((date, i) => ({
      date,
      mm: Number(f.daily.precipitation_sum[i]) || 0,
      probability: f.daily.precipitation_probability_max?.[i] ?? null,
      tmax: f.daily.temperature_2m_max?.[i] ?? null,
      past: date < today
    }));
    const past = days.filter((x) => x.past);
    const ahead = days.filter((x) => !x.past);
    const last30mm = sum(past.slice(-30).map((x) => x.mm));
    const last7mm = sum(past.slice(-7).map((x) => x.mm));
    const next7mm = sum(ahead.slice(0, 7).map((x) => x.mm));
    const next14mm = sum(ahead.slice(0, 14).map((x) => x.mm));
    const wettest = ahead.slice(0, 14).reduce<RainDay | null>((m, x) => (!m || x.mm > m.mm ? x : m), null);

    let normal: number | null = null;
    try {
      const clim = await climatology(key);
      normal = sum(past.slice(-30).map((x) => clim.get(x.date.slice(5)) ?? 0));
    } catch {
      normal = null; // the weather part still works without the 11-year normal
    }
    const departure = normal !== null && normal > 5 ? Math.round(((last30mm - normal) / normal) * 100) : null;
    const outlook: DistrictWeather['outlook'] = next7mm >= 100 || (wettest?.mm ?? 0) >= 60 ? 'Heavy rain' : next7mm >= 25 ? 'Wet' : next14mm >= 8 ? 'Showers' : 'Mostly dry';
    const eff = rainEffect(next7mm, next14mm, wettest?.mm ?? 0, last30mm, normal, landPrepSeason);
    return {
      key,
      label: d.label,
      ok: true,
      days,
      last7mm: r1(last7mm),
      last30mm: r1(last30mm),
      next7mm: r1(next7mm),
      next14mm: r1(next14mm),
      normalLast30mm: normal === null ? null : r1(normal),
      departurePercent: departure,
      maxDay: wettest ? { date: wettest.date, mm: r1(wettest.mm) } : null,
      outlook,
      summary: `${outlook}: ${Math.round(next7mm)} mm in the next 7 days, ${Math.round(next14mm)} mm in 14`,
      rainFactor: eff.factor,
      rainReason: eff.reason
    };
  } catch (e) {
    console.warn(`weather for ${key} failed:`, (e as Error).message);
    return empty;
  }
}

export async function getAllWeather(landPrep: Record<DistrictKey, boolean>): Promise<DistrictWeather[]> {
  const keys = Object.keys(DISTRICTS) as DistrictKey[];
  return Promise.all(keys.map((k) => getDistrictWeather(k, landPrep[k])));
}

export { addDays };
