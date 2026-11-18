import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { businessDate } from '../routes/context.ts';

// A forecasting model for machine sales, trained on the business's own records.
//
// What it learns: how many machines sell in each month of a financial year (April to March), and how a year's total
// follows from the years before it. It is trained and tested like any model: the years it has not seen are held back, it
// forecasts them, and the result is compared with what really happened (a rolling backtest). Several models compete and the
// one that does best on the held-back years is used. Everything runs inside the ERP; nothing is sent anywhere.

const NO_DATE = '1900-01-01';
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const CAL_MONTH = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; // calendar month of each position in the financial year
const round = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export interface YearRow {
  fy: number;
  label: string;
  months: number[]; // April..March
  total: number;
  used: boolean; // false: not a fully recorded year, so it is not used for training or testing
  reason: string | null;
}

export interface ModelScore {
  id: string;
  name: string;
  about: string;
  yearError: number; // average % error of the year's total on years it had not seen
  monthError: number; // % error month by month (sum of misses over machines sold)
  shapeError: number; // the same, once the year's total is given: how good the month pattern is
  inRange: number; // % of held-back months inside its 80% range
  folds: number;
}

export interface FoldDetail {
  fy: number;
  label: string;
  actual: number;
  trainedOn: string[];
  predicted: Record<string, number>;
}

export interface ForecastMonth {
  month: string; // YYYY-MM
  label: string;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}
export interface ForecastYear {
  fy: number;
  label: string;
  months: ForecastMonth[];
  total: { mean: number; p10: number; p50: number; p90: number };
}

export interface TrainedModel {
  trainedAt: string;
  signature: string;
  samples: number; // machine sales used
  firstYear: string;
  lastYear: string;
  years: YearRow[];
  trainingYears: number;
  scores: ModelScore[];
  chosen: string;
  folds: FoldDetail[];
  shape: number[]; // learned share of a year's machines in each month (April..March)
  glm: { monthEffects: number[]; elasticity: number; intercept: number; rows: number } | null;
  uncertainty: { yearSigma: number; dispersion: number };
  forecast: ForecastYear[];
  notes: string[];
}

// ------------------------------------------------------------------ data

const fyOf = (ymd: string) => (Number(ymd.slice(5, 7)) >= 4 ? Number(ymd.slice(0, 4)) : Number(ymd.slice(0, 4)) - 1);
const label = (fy: number) => `${fy}-${fy + 1}`;

function fullYearLimit(units: number[]): number {
  const v = units.filter((n) => n > 0).sort((a, b) => a - b);
  const median = v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2 : 0;
  return Math.max(30, Math.round(median * 0.35));
}

async function loadYears(): Promise<{ years: YearRow[]; samples: number; signature: string }> {
  const rows = (await db.execute(sql`
    select (case when substr(booking_date, 6, 2)::int >= 4 then substr(booking_date, 1, 4)::int else substr(booking_date, 1, 4)::int - 1 end) as fy,
           substr(booking_date, 6, 2)::int as m, count(*)::int as n
    from machine_sales where status <> 'Cancelled' and booking_date <> ${NO_DATE} group by 1, 2`)).rows as any[];
  const by = new Map<number, number[]>();
  for (const r of rows) {
    const fy = Number(r.fy);
    const arr = by.get(fy) ?? new Array(12).fill(0);
    arr[CAL_MONTH.indexOf(Number(r.m))] += Number(r.n);
    by.set(fy, arr);
  }
  const fys = [...by.keys()].sort((a, b) => a - b);
  const thisFy = fyOf(businessDate());
  const first = fys.length ? fys[0] : thisFy;
  const limit = fullYearLimit(fys.map((f) => sum(by.get(f)!)));
  const years: YearRow[] = [];
  for (let fy = first; fy <= thisFy; fy++) {
    const months = by.get(fy) ?? new Array(12).fill(0);
    const total = sum(months);
    let used = total >= limit && fy < thisFy;
    let reason: string | null = null;
    if (fy === thisFy) reason = 'this year is not over';
    else if (total === 0) reason = 'no records';
    else if (total < limit) reason = `only ${total} machines recorded, far below a normal year`;
    if (fy === thisFy) used = false;
    years.push({ fy, label: label(fy), months, total, used, reason });
  }
  const samples = sum(years.map((y) => y.total));
  const signature = `${samples}:${years.map((y) => y.total).join(',')}`;
  return { years, samples, signature };
}

// ------------------------------------------------------------------ pieces the models share

// Share of a year's machines in each month, learned from the training years (each year counts by its own shape), smoothed
// with the neighbouring months so one busy week cannot make a spike.
function learnShape(train: YearRow[]): number[] {
  const acc = new Array(12).fill(0);
  let n = 0;
  for (const y of train) {
    if (y.total <= 0) continue;
    for (let i = 0; i < 12; i++) acc[i] += y.months[i] / y.total;
    n++;
  }
  const mean = acc.map((v) => v / Math.max(1, n));
  const smooth = mean.map((v, i) => 0.25 * mean[(i + 11) % 12] + 0.5 * v + 0.25 * mean[(i + 1) % 12]);
  const t = sum(smooth) || 1;
  return smooth.map((v) => v / t);
}

const weighted = (vals: number[], w: number[]) => sum(vals.map((v, i) => v * w[i])) / (sum(w) || 1);
const lastK = (train: YearRow[], k: number) => train.slice(-k);

function levelWeighted(train: YearRow[]): number {
  const t = lastK(train, 3);
  return weighted(t.map((y) => y.total), t.map((_, i) => i + 1));
}
function levelMedian(train: YearRow[]): number {
  const v = lastK(train, 3).map((y) => y.total).sort((a, b) => a - b);
  return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2 : 0;
}
// a gentle trend: the slope of the log of the totals over the last four years, halved so it does not run away
function levelTrend(train: YearRow[]): number {
  const t = lastK(train, 4);
  if (t.length < 3) return levelWeighted(train);
  const xs = t.map((_, i) => i);
  const ys = t.map((y) => Math.log(Math.max(1, y.total)));
  const mx = sum(xs) / xs.length;
  const my = sum(ys) / ys.length;
  const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / (sum(xs.map((x) => (x - mx) ** 2)) || 1);
  return Math.exp(my + slope * 0.5 * (xs.length - mx));
}

// ------------------------------------------------------------------ the Poisson regression (a real trained model)

interface Glm {
  beta: number[]; // intercept, 11 month effects (April is the base), log of the level of the years before
  monthEffects: number[];
  elasticity: number;
  intercept: number;
  rows: number;
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c] || 1e-9;
    for (let k = c; k <= n; k++) m[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r) => r[n]);
}

const features = (month: number, logPrev: number) => {
  const x = new Array(13).fill(0);
  x[0] = 1;
  if (month > 0) x[month] = 1;
  x[12] = logPrev;
  return x;
};

// level of the years before year i, as a model would know it at the time
const prevLevel = (years: YearRow[], i: number) => {
  const t = years.slice(Math.max(0, i - 3), i);
  return t.length ? weighted(t.map((y) => y.total), t.map((_, k) => k + 1)) : 0;
};

function fitGlm(train: YearRow[]): Glm | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 1; i < train.length; i++) {
    const lp = Math.log(Math.max(1, prevLevel(train, i)));
    for (let m = 0; m < 12; m++) {
      X.push(features(m, lp));
      y.push(train[i].months[m]);
    }
  }
  if (X.length < 24) return null;
  const p = 13;
  const ridge = 0.5; // keeps the month effects from chasing noise
  let beta = new Array(p).fill(0);
  beta[0] = Math.log(Math.max(0.5, sum(y) / y.length));
  for (let it = 0; it < 40; it++) {
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtZ = new Array(p).fill(0);
    for (let r = 0; r < X.length; r++) {
      let eta = 0;
      for (let k = 0; k < p; k++) eta += X[r][k] * beta[k];
      eta = Math.max(-8, Math.min(8, eta));
      const mu = Math.exp(eta);
      const z = eta + (y[r] - mu) / mu;
      for (let a = 0; a < p; a++) {
        if (!X[r][a]) continue;
        XtZ[a] += X[r][a] * mu * z;
        for (let b = 0; b < p; b++) if (X[r][b]) XtWX[a][b] += X[r][a] * mu * X[r][b];
      }
    }
    for (let k = 1; k < p; k++) XtWX[k][k] += k === 12 ? 40 : ridge; // the link to earlier years is held back hard: a few years cannot support a strong one
    const next = solve(XtWX, XtZ);
    const delta = Math.max(...next.map((v, k) => Math.abs(v - beta[k])));
    beta = next;
    if (delta < 1e-6) break;
  }
  return { beta, monthEffects: [0, ...beta.slice(1, 12)], elasticity: beta[12], intercept: beta[0], rows: X.length };
}

function predictGlm(g: Glm, level: number): number[] {
  const lp = Math.log(Math.max(1, level));
  return Array.from({ length: 12 }, (_, m) => {
    let eta = 0;
    const x = features(m, lp);
    for (let k = 0; k < 13; k++) eta += x[k] * g.beta[k];
    return Math.exp(Math.max(-8, Math.min(8, eta)));
  });
}

// ------------------------------------------------------------------ the competing models

type Predict = (train: YearRow[]) => number[]; // twelve monthly means for the year after the training years

const seasonal = (levelFn: (t: YearRow[]) => number): Predict => (train) => {
  const s = learnShape(train);
  const L = levelFn(train);
  return s.map((v) => v * L);
};

const MODELS: { id: string; name: string; about: string; predict: Predict }[] = [
  { id: 'last', name: 'Same as last year', about: 'Repeats the year before, month by month.', predict: (t) => (t.length ? [...t[t.length - 1].months] : new Array(12).fill(0)) },
  { id: 'weighted', name: 'Season x recent average', about: 'The usual month pattern, scaled to the average of the last 3 years (newest counts most).', predict: seasonal(levelWeighted) },
  { id: 'median', name: 'Season x recent median', about: 'The same pattern, scaled to the middle of the last 3 years, so one huge year does not pull it up.', predict: seasonal(levelMedian) },
  { id: 'trend', name: 'Season x trend', about: 'The same pattern, scaled to where the last 4 years were heading (half the trend is kept).', predict: seasonal(levelTrend) },
  {
    id: 'glm',
    name: 'Trained regression',
    about: 'A Poisson regression that learns each month\'s effect and how strongly a year follows the years before it.',
    predict: (t) => {
      const g = fitGlm(t);
      return g ? predictGlm(g, levelWeighted(t)) : seasonal(levelWeighted)(t);
    }
  }
];

const ENSEMBLE_IDS = ['weighted', 'median', 'trend', 'glm'];
const ensemble: Predict = (t) => {
  const outs = ENSEMBLE_IDS.map((id) => MODELS.find((m) => m.id === id)!.predict(t));
  return Array.from({ length: 12 }, (_, i) => sum(outs.map((o) => o[i])) / outs.length);
};
const ALL = [...MODELS, { id: 'ensemble', name: 'All four together', about: 'The average of the four models above (recent average, median, trend and regression).', predict: ensemble }];

// ------------------------------------------------------------------ testing on years it has not seen

function backtest(used: YearRow[]) {
  const folds: FoldDetail[] = [];
  const stats = new Map<string, { yearErr: number[]; absMiss: number; actual: number; shapeMiss: number }>();
  for (const m of ALL) stats.set(m.id, { yearErr: [], absMiss: 0, actual: 0, shapeMiss: 0 });
  const residuals: { mu: number; y: number }[] = [];
  const yearLogErr: number[] = [];
  for (let f = 2; f < used.length; f++) {
    const train = used.slice(0, f);
    const held = used[f];
    const pred: Record<string, number> = {};
    for (const m of ALL) {
      const mu = m.predict(train);
      const total = sum(mu);
      pred[m.id] = round(total);
      const st = stats.get(m.id)!;
      st.yearErr.push(Math.abs(total - held.total) / held.total);
      let miss = 0;
      let shapeMiss = 0;
      const scale = total > 0 ? held.total / total : 0;
      for (let i = 0; i < 12; i++) {
        miss += Math.abs(mu[i] - held.months[i]);
        shapeMiss += Math.abs(mu[i] * scale - held.months[i]);
      }
      st.absMiss += miss;
      st.shapeMiss += shapeMiss;
      st.actual += held.total;
      if (m.id === 'ensemble') {
        yearLogErr.push(Math.log(Math.max(1, held.total) / Math.max(1, total)));
        for (let i = 0; i < 12; i++) residuals.push({ mu: mu[i] * scale, y: held.months[i] });
      }
    }
    folds.push({ fy: held.fy, label: held.label, actual: held.total, trainedOn: train.map((t) => t.label), predicted: pred });
  }
  return { folds, stats, residuals, yearLogErr };
}

// ------------------------------------------------------------------ ranges: simulate the year total and the months

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
}
function gamma(rand: () => number, shape: number): number {
  if (shape < 1) return gamma(rand, shape + 1) * Math.pow(rand(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rand);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    if (Math.log(rand()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
function poisson(rand: () => number, lambda: number): number {
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rand)));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

function simulate(mu: number[], yearSigma: number, dispersion: number) {
  const rand = mulberry32(20261026);
  const N = 2000;
  const months: number[][] = Array.from({ length: 12 }, () => []);
  const totals: number[] = [];
  const base = sum(mu);
  for (let s = 0; s < N; s++) {
    const level = Math.exp(yearSigma * normal(rand) - (yearSigma ** 2) / 2); // keeps the average where the model put it
    let tot = 0;
    for (let i = 0; i < 12; i++) {
      const m = mu[i] * level;
      const k = dispersion > 0.001 ? 1 / dispersion : 1e6;
      const lam = m > 0 ? gamma(rand, k) * (m / k) : 0;
      const n = poisson(rand, lam);
      months[i].push(n);
      tot += n;
    }
    totals.push(tot);
  }
  void base;
  const qs = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  };
  return { months: months.map(qs), total: qs(totals) };
}

// ------------------------------------------------------------------ training

export async function trainModel(): Promise<TrainedModel> {
  const { years, samples, signature } = await loadYears();
  const used = years.filter((y) => y.used);
  const notes: string[] = [];
  const excluded = years.filter((y) => !y.used && y.fy < fyOf(businessDate()));
  if (excluded.length) notes.push(`Left out of training: ${excluded.map((y) => `${y.label} (${y.reason})`).join('; ')}.`);

  if (used.length < 3) {
    return {
      trainedAt: new Date().toISOString(),
      signature,
      samples,
      firstYear: years[0]?.label ?? '-',
      lastYear: years[years.length - 1]?.label ?? '-',
      years,
      trainingYears: used.length,
      scores: [],
      chosen: 'none',
      folds: [],
      shape: new Array(12).fill(1 / 12),
      glm: null,
      uncertainty: { yearSigma: 0.6, dispersion: 0.3 },
      forecast: [],
      notes: [...notes, 'There are not enough fully recorded years yet (at least 3 are needed) to train and test a model.']
    };
  }

  const { folds, stats, residuals, yearLogErr } = backtest(used);

  // uncertainty learned from the test years
  const meanLog = sum(yearLogErr) / yearLogErr.length;
  const yearSigma = Math.max(0.25, Math.sqrt(sum(yearLogErr.map((e) => (e - meanLog) ** 2)) / Math.max(1, yearLogErr.length - 1)));
  const dispersion = Math.max(0.05, Math.min(2, sum(residuals.map((r) => (r.y - r.mu) ** 2 - r.mu)) / (sum(residuals.map((r) => r.mu ** 2)) || 1)));

  // how often a held-back month fell inside the model's own 80% range
  const inRangeOf = new Map<string, number>();
  for (const m of ALL) {
    let inside = 0;
    let n = 0;
    for (let f = 2; f < used.length; f++) {
      const mu = m.predict(used.slice(0, f));
      const sim = simulate(mu, yearSigma, dispersion);
      for (let i = 0; i < 12; i++) {
        n++;
        if (used[f].months[i] >= sim.months[i].p10 && used[f].months[i] <= sim.months[i].p90) inside++;
      }
    }
    inRangeOf.set(m.id, n ? Math.round((inside / n) * 100) : 0);
  }

  const scores: ModelScore[] = ALL.map((m) => {
    const st = stats.get(m.id)!;
    return {
      id: m.id,
      name: m.name,
      about: m.about,
      yearError: Math.round((sum(st.yearErr) / st.yearErr.length) * 100),
      monthError: st.actual ? Math.round((st.absMiss / st.actual) * 100) : 0,
      shapeError: st.actual ? Math.round((st.shapeMiss / st.actual) * 100) : 0,
      inRange: inRangeOf.get(m.id) ?? 0,
      folds: st.yearErr.length
    };
  });
  // the winner is the one with the smallest month-by-month miss on years it had not seen
  const best = [...scores].sort((a, b) => a.monthError - b.monthError || a.yearError - b.yearError)[0];
  const chosenModel = ALL.find((m) => m.id === best.id)!;

  // final fit on every fully recorded year, then the forecast for this year and the next
  const shape = learnShape(used);
  const glmFit = fitGlm(used);
  const thisFy = fyOf(businessDate());
  const forecast: ForecastYear[] = [];
  const history = [...used];
  for (const fy of [thisFy, thisFy + 1]) {
    const mu = chosenModel.predict(history);
    const sim = simulate(mu, yearSigma, dispersion);
    forecast.push({
      fy,
      label: label(fy),
      months: mu.map((m, i) => {
        const cal = CAL_MONTH[i];
        const year = cal >= 4 ? fy : fy + 1;
        return { month: `${year}-${String(cal).padStart(2, '0')}`, label: `${MONTHS[i]} ${year}`, mean: r1(m), p10: sim.months[i].p10, p50: sim.months[i].p50, p90: sim.months[i].p90 };
      }),
      total: { mean: round(sum(mu)), p10: sim.total.p10, p50: sim.total.p50, p90: sim.total.p90 }
    });
    // the second year is forecast as if the first had turned out as expected
    history.push({ fy, label: label(fy), months: mu, total: sum(mu), used: true, reason: null });
  }

  notes.push(`${folds.length} test years were held back one at a time, each forecast only from the years before it.`);
  if (used.length < 6) notes.push('There are only a few full years, so the ranges are wide. They narrow as more years are added.');
  notes.push('A year\'s total moves a lot from year to year (subsidy budgets decide it), so the month pattern is far more reliable than the total.');

  return {
    trainedAt: new Date().toISOString(),
    signature,
    samples,
    firstYear: years[0].label,
    lastYear: years[years.length - 1].label,
    years,
    trainingYears: used.length,
    scores,
    chosen: best.id,
    folds,
    shape: shape.map(r3),
    glm: glmFit ? { monthEffects: glmFit.monthEffects.map(r3), elasticity: r3(glmFit.elasticity), intercept: r3(glmFit.intercept), rows: glmFit.rows } : null,
    uncertainty: { yearSigma: r3(yearSigma), dispersion: r3(dispersion) },
    forecast,
    notes
  };
}

// ------------------------------------------------------------------ keeping the trained model

export async function ensureModelTable(): Promise<void> {
  await db.execute(sql`create table if not exists forecast_models (
    id serial primary key, trained_at timestamptz not null default now(), trained_by text, signature text not null, samples integer not null, payload jsonb not null)`);
}

export async function latestModel(): Promise<TrainedModel | null> {
  const r = (await db.execute(sql`select payload from forecast_models order by id desc limit 1`)).rows as any[];
  return r[0]?.payload ?? null;
}

export async function trainAndSave(by: string): Promise<TrainedModel> {
  await ensureModelTable();
  const model = await trainModel();
  await db.execute(sql`insert into forecast_models (trained_by, signature, samples, payload) values (${by}, ${model.signature}, ${model.samples}, ${JSON.stringify(model)}::jsonb)`);
  await db.execute(sql`delete from forecast_models where id not in (select id from forecast_models order by id desc limit 8)`);
  return model;
}

// The model learns again by itself when the records have changed since it was last trained (new bills uploaded).
export async function currentModel(by = 'system'): Promise<{ model: TrainedModel; retrained: boolean }> {
  await ensureModelTable();
  const last = await latestModel();
  const { signature } = await loadYears();
  if (last && last.signature === signature) return { model: last, retrained: false };
  return { model: await trainAndSave(by), retrained: true };
}
