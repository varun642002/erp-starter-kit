import { addDays } from '../routes/context.ts';

// Example farming calendar for three Tamil Nadu districts. Replace it with the districts and crops of your own region. Sowing months come from the TNAU rice-season tables and
// the TNAU sugarcane planting seasons; rainfall normals are TNAU district normals. Machinery (rotavators, blades, spares) is
// bought and used for land preparation, so demand runs from one month BEFORE a sowing window until it ends.
// The demand index is an estimate built from this calendar. It is not fitted to your sales, which only started in October 2026.

export type DistrictKey = 'Namakkal' | 'Karur' | 'Tiruchirappalli';

export interface SeasonWindow {
  name: string;
  startMonth: number; // 1-12, sowing / planting starts
  endMonth: number; // 1-12, may be smaller than start when it wraps the year end
  weight: number; // how much land this season covers compared with the main rice seasons
}

export interface DistrictInfo {
  key: DistrictKey;
  label: string;
  lat: number;
  lon: number;
  neNormalMm: number; // Oct-Dec northeast monsoon, TNAU
  swNormalMm: number; // Jun-Sep southwest monsoon, TNAU
  seasons: SeasonWindow[];
}

// Sugarcane is planted in four seasons in these districts (early Dec-Jan, mid Feb-Mar, late Apr-May, special Jun-Jul)
const cane = (w = 0.6): SeasonWindow[] => [
  { name: 'Sugarcane planting (early)', startMonth: 12, endMonth: 1, weight: w },
  { name: 'Sugarcane planting (mid)', startMonth: 2, endMonth: 3, weight: w },
  { name: 'Sugarcane planting (late)', startMonth: 4, endMonth: 5, weight: w },
  { name: 'Sugarcane planting (special)', startMonth: 6, endMonth: 7, weight: w * 0.7 }
];

export const DISTRICTS: Record<DistrictKey, DistrictInfo> = {
  Namakkal: {
    key: 'Namakkal',
    label: 'Namakkal',
    lat: 11.22126,
    lon: 78.16524,
    neNormalMm: 269,
    swNormalMm: 336,
    seasons: [
      { name: 'Navarai rice', startMonth: 12, endMonth: 1, weight: 1 },
      { name: 'Sornavari / Early Kar rice', startMonth: 4, endMonth: 5, weight: 1 },
      { name: 'Kar rice', startMonth: 5, endMonth: 6, weight: 1 },
      { name: 'Groundnut (Vaigasi)', startMonth: 5, endMonth: 6, weight: 0.7 },
      { name: 'Samba rice', startMonth: 8, endMonth: 8, weight: 1 },
      { name: 'Late Samba / Thaladi rice', startMonth: 9, endMonth: 10, weight: 0.8 },
      ...cane()
    ]
  },
  Karur: {
    key: 'Karur',
    label: 'Karur',
    lat: 10.95771,
    lon: 78.08095,
    neNormalMm: 300,
    swNormalMm: 199,
    seasons: [
      { name: 'Kar rice', startMonth: 5, endMonth: 6, weight: 1 },
      { name: 'Kuruvai rice', startMonth: 6, endMonth: 7, weight: 1 },
      { name: 'Groundnut (Anipattam)', startMonth: 6, endMonth: 7, weight: 0.7 },
      { name: 'Samba rice', startMonth: 8, endMonth: 9, weight: 1 },
      { name: 'Late Samba / Thaladi rice', startMonth: 9, endMonth: 11, weight: 0.8 },
      { name: 'Navarai rice', startMonth: 12, endMonth: 1, weight: 1 },
      ...cane()
    ]
  },
  Tiruchirappalli: {
    key: 'Tiruchirappalli',
    label: 'Tiruchirappalli',
    lat: 10.8155,
    lon: 78.69651,
    neNormalMm: 378,
    swNormalMm: 277,
    seasons: [
      { name: 'Kuruvai rice', startMonth: 6, endMonth: 7, weight: 1 },
      { name: 'Groundnut (Anipattam)', startMonth: 6, endMonth: 7, weight: 0.7 },
      { name: 'Samba rice', startMonth: 8, endMonth: 9, weight: 1 },
      { name: 'Late Samba / Thaladi rice', startMonth: 9, endMonth: 11, weight: 0.8 },
      { name: 'Navarai rice', startMonth: 12, endMonth: 1, weight: 1 },
      ...cane()
    ]
  }
};

export const CALENDAR_SOURCES = [
  { label: 'TNAU rice seasons by district', url: 'https://agritech.tnau.ac.in/agriculture/agri_seasonandvarieties_rice.html' },
  { label: 'TNAU sugarcane planting seasons', url: 'https://agritech.tnau.ac.in/expert_system/sugar/faq.html' },
  { label: 'TNAU southwest monsoon district normals', url: 'https://agritech.tnau.ac.in/tnaupressnotes/pdf/2021/Press%20Note%20-%20Seasonal%20rainfall%20forecast%20for%20Southwest%20Monsoon%202021%20-%20English.pdf' },
  { label: 'TNAU northeast monsoon district normals', url: 'https://agritech.tnau.ac.in/tnaupressnotes/pdf/2023/TNAU seasonal rainfall forecast for Northeast monsoon, 2023 - Eng.pdf' },
  { label: 'Live weather and rainfall history (Open-Meteo)', url: 'https://open-meteo.com/' }
];

// Which district a branch belongs to, from its name ("Town, Karur"). Unknown names fall back to the first district.
export function districtOfBranch(branchName: string): DistrictKey {
  const n = (branchName || '').toLowerCase();
  if (n.includes('karur')) return 'Karur';
  if (n.includes('tiruchi') || n.includes('trichy')) return 'Tiruchirappalli';
  return 'Namakkal';
}

const inWindow = (month: number, start: number, end: number) => (start <= end ? month >= start && month <= end : month >= start || month <= end);
const prevMonth = (m: number) => (m === 1 ? 12 : m - 1);

// Machinery demand for each calendar month (1 = an average month): land preparation starts the month before sowing.
function monthlyIndex(d: DistrictInfo): number[] {
  const raw = new Array(12).fill(0).map((_, i) => {
    const month = i + 1;
    let v = 0;
    for (const s of d.seasons) {
      if (inWindow(month, prevMonth(s.startMonth), s.endMonth)) v += s.weight;
    }
    return v + 0.35; // some buying never stops: breakdowns, repairs, wear parts
  });
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  return raw.map((v) => v / mean);
}

// The business's own machine sales by month over the years (1 = an average month). When it is known it counts for
// HISTORY_WEIGHT of the monthly pattern; the sowing calendar supplies the rest.
export const HISTORY_WEIGHT = 0.3;
let HISTORY: number[] | null = null;
const INDEX_CACHE: Partial<Record<DistrictKey, number[]>> = {};
export function setHistoryIndex(index: number[] | null): void {
  const same = JSON.stringify(index) === JSON.stringify(HISTORY);
  HISTORY = index;
  if (!same) for (const k of Object.keys(INDEX_CACHE)) delete INDEX_CACHE[k as DistrictKey];
}
export function demandIndexByMonth(key: DistrictKey): number[] {
  if (INDEX_CACHE[key]) return INDEX_CACHE[key]!;
  const calendar = monthlyIndex(DISTRICTS[key]);
  if (!HISTORY) return (INDEX_CACHE[key] = calendar);
  const mixed = calendar.map((v, i) => v * (1 - HISTORY_WEIGHT) + HISTORY![i] * HISTORY_WEIGHT);
  const mean = mixed.reduce((a, b) => a + b, 0) / 12;
  return (INDEX_CACHE[key] = mixed.map((v) => v / mean));
}

// Index on one day, smoothed between the middles of neighbouring months so it does not jump on the 1st.
export function demandOn(key: DistrictKey, iso: string): number {
  const idx = demandIndexByMonth(key);
  const [y, m, d] = iso.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pos = (d - 1) / dim; // 0..1 through the month
  const cur = idx[m - 1];
  if (pos < 0.5) {
    const prev = idx[(m + 10) % 12];
    return prev + (cur - prev) * (0.5 + pos);
  }
  const next = idx[m % 12];
  return cur + (next - cur) * (pos - 0.5);
}

export function averageDemand(key: DistrictKey, fromIso: string, days: number): number {
  let sum = 0;
  for (let i = 0; i < days; i++) sum += demandOn(key, addDays(fromIso, i));
  return sum / days;
}

// What is happening on the land now and next, in plain words.
export function seasonStatus(key: DistrictKey, iso: string): { now: string[]; coming: string[]; level: 'Peak' | 'Busy' | 'Steady' | 'Quiet'; index: number } {
  const d = DISTRICTS[key];
  const month = Number(iso.split('-')[1]);
  const next = month === 12 ? 1 : month + 1;
  const now: string[] = [];
  const coming: string[] = [];
  for (const s of d.seasons) {
    if (inWindow(month, s.startMonth, s.endMonth)) now.push(`${s.name}: sowing or planting now`);
    else if (inWindow(month, prevMonth(s.startMonth), prevMonth(s.startMonth))) now.push(`${s.name}: land preparation now, sowing starts next month`);
    else if (inWindow(next, prevMonth(s.startMonth), prevMonth(s.startMonth))) coming.push(`${s.name}: land preparation starts next month`);
  }
  const index = demandOn(key, iso);
  const level = index >= 1.35 ? 'Peak' : index >= 1.05 ? 'Busy' : index >= 0.8 ? 'Steady' : 'Quiet';
  return { now, coming, level, index: Math.round(index * 100) / 100 };
}
