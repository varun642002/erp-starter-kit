import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

// One row per bill (quick sale invoice, GST invoice, invoice-only bill or machine sale invoice).
export interface SaleRec {
  date: string; // YYYY-MM-DD
  branchId: string;
  total: number;
  paid: number;
  due: string | null; // YYYY-MM-DD
}

interface Props {
  records: SaleRec[];
  branches: { id: string; name: string }[];
  horizon: 'today' | '30d' | 'current-month' | 'fiscal-ytd';
  currency: string;
  stock: { ok: number; low: number; out: number };
  categories: { name: string; cost: number }[];
  showBranches: boolean;
}

const COLORS = { blue: '#3b82f6', green: '#10b981', amber: '#f59e0b', rose: '#f43f5e', violet: '#8b5cf6', slate: '#94a3b8' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// 1,23,456 -> ₹1.2L, 45,000 -> ₹45K
const compact = (n: number, cur: string) => {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 10000000) return `${sign}${cur}${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `${sign}${cur}${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${sign}${cur}${(v / 1000).toFixed(1)}K`;
  return `${sign}${cur}${Math.round(v)}`;
};
const full = (n: number, cur: string) => `${cur}${Math.round(n).toLocaleString('en-IN')}`;

const tooltipStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.7)',
  background: 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 8px 24px -8px rgba(30,41,90,0.3)',
  fontSize: 12
};

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode; className?: string }> = ({ title, hint, children, className = '' }) => (
  <div className={`rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</h3>
      {hint && <span className="text-[10px] font-medium text-slate-400">{hint}</span>}
    </div>
    {children}
  </div>
);

const Empty: React.FC<{ text?: string }> = ({ text = 'Nothing to show yet' }) => (
  <div className="flex h-48 items-center justify-center text-xs text-slate-400">{text}</div>
);

export const KpiCharts: React.FC<Props> = ({ records, branches, horizon, currency, stock, categories, showBranches }) => {
  const today = istToday();

  // 1. Sales over time: daily for a week/month, monthly for "all recorded"
  const trend = useMemo(() => {
    if (horizon === 'fiscal-ytd') {
      const months: { key: string; label: string; billed: number; collected: number }[] = [];
      const base = new Date(`${today}T00:00:00Z`);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
        months.push({ key: d.toISOString().slice(0, 7), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, billed: 0, collected: 0 });
      }
      for (const r of records) {
        const m = months.find((x) => x.key === r.date.slice(0, 7));
        if (m) {
          m.billed += r.total;
          m.collected += r.paid;
        }
      }
      return months;
    }
    const span = horizon === 'today' ? 7 : horizon === '30d' ? 30 : Math.max(7, Number(today.slice(8, 10)));
    const days: { key: string; label: string; billed: number; collected: number }[] = [];
    for (let i = span - 1; i >= 0; i--) {
      const k = shift(today, -i);
      days.push({ key: k, label: dayLabel(k), billed: 0, collected: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.key, i]));
    for (const r of records) {
      const i = idx.get(r.date.slice(0, 10));
      if (i !== undefined) {
        days[i].billed += r.total;
        days[i].collected += r.paid;
      }
    }
    return days;
  }, [records, horizon, today]);

  const trendHasData = trend.some((d) => d.billed > 0);
  const trendTitle =
    horizon === 'fiscal-ytd' ? 'Sales by month (last 12 months)' : horizon === 'today' ? 'Sales, last 7 days' : horizon === '30d' ? 'Sales, last 30 days' : 'Sales this month';

  // 2. Money received vs still to collect, for the same period as the trend
  const split = useMemo(() => {
    const from = trend[0]?.key;
    let billed = 0;
    let paid = 0;
    for (const r of records) {
      const inRange = horizon === 'fiscal-ytd' ? r.date.slice(0, 7) >= (from || '') : r.date.slice(0, 10) >= (from || '');
      if (inRange) {
        billed += r.total;
        paid += Math.min(r.paid, r.total);
      }
    }
    return [
      { name: 'Collected', value: Math.round(paid), color: COLORS.green },
      { name: 'To collect', value: Math.max(0, Math.round(billed - paid)), color: COLORS.amber }
    ];
  }, [records, trend, horizon]);
  const splitTotal = split.reduce((s, x) => s + x.value, 0);

  // 3. How late the unpaid bills are
  const ageing = useMemo(() => {
    const buckets = [
      { name: 'Not due', value: 0, color: COLORS.blue },
      { name: '1-30 days', value: 0, color: COLORS.amber },
      { name: '31-60 days', value: 0, color: '#fb923c' },
      { name: 'Over 60', value: 0, color: COLORS.rose }
    ];
    for (const r of records) {
      const open = r.total - r.paid;
      if (open <= 0.005) continue;
      const late = r.due ? dayDiff(r.due.slice(0, 10), today) : 0;
      const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : 3;
      buckets[b].value += open;
    }
    return buckets.map((b) => ({ ...b, value: Math.round(b.value) }));
  }, [records, today]);
  const ageingHasData = ageing.some((b) => b.value > 0);

  // 4. Stock health
  const stockData = [
    { name: 'In stock', value: stock.ok, color: COLORS.green },
    { name: 'Low', value: stock.low, color: COLORS.amber },
    { name: 'Out of stock', value: stock.out, color: COLORS.rose }
  ];
  const stockTotal = stock.ok + stock.low + stock.out;

  // 5. Sales by branch: today by default, or this week, this month or this financial year (April to March)
  const [branchPeriod, setBranchPeriod] = useState<'day' | 'week' | 'month' | 'year'>('day');
  const branchFrom = useMemo(() => {
    if (branchPeriod === 'day') return today;
    if (branchPeriod === 'week') {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      return shift(today, -((dow + 6) % 7)); // the Monday of this week
    }
    if (branchPeriod === 'month') return `${today.slice(0, 8)}01`;
    const y = Number(today.slice(0, 4));
    return `${Number(today.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
  }, [branchPeriod, today]);
  const branchPeriodLabel = branchPeriod === 'day' ? 'Today' : branchPeriod === 'week' ? `This week, from ${dayLabel(branchFrom)}` : branchPeriod === 'month' ? 'This month' : `This year, from ${dayLabel(branchFrom)} ${branchFrom.slice(0, 4)}`;
  const byBranch = useMemo(() => {
    const from = branchFrom;
    const map = new Map<string, { total: number; count: number }>();
    for (const r of records) {
      const inRange = r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= today;
      if (inRange) {
        const cur = map.get(r.branchId) || { total: 0, count: 0 };
        map.set(r.branchId, { total: cur.total + r.total, count: cur.count + 1 });
      }
    }
    return branches
      .map((b) => ({
        name: b.name.split(',')[0].replace(/ Branch Store$| Store$/i, '').trim(),
        value: Math.round(map.get(b.id)?.total || 0),
        count: map.get(b.id)?.count || 0
      }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [records, branches, branchFrom, today]);
  const branchTotal = byBranch.reduce((s, b) => s + b.value, 0);

  const cats = categories.filter((c) => c.cost > 0).map((c) => ({ name: c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name, value: Math.round(c.cost) }));
  const catColors = [COLORS.blue, COLORS.violet, COLORS.green, COLORS.amber, COLORS.rose];

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Sales and stock graphs">
      <Card title={trendTitle} hint="Billed and collected" className="lg:col-span-2">
        {trendHasData ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="kpiBilled" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="kpiPaid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v, currency)} width={52} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [full(v, currency), n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="billed" name="Billed" stroke={COLORS.blue} strokeWidth={2} fill="url(#kpiBilled)" />
                <Area type="monotone" dataKey="collected" name="Collected" stroke={COLORS.green} strokeWidth={2} fill="url(#kpiPaid)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty text="No sales in this period yet" />
        )}
      </Card>

      <Card title="Collected vs still to collect" hint="Same period">
        {splitTotal > 0 ? (
          <div className="relative h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={split} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} cornerRadius={6} stroke="none">
                  {split.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [full(v, currency), n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Billed</p>
              <p className="text-base font-extrabold text-slate-900 dark:text-white">{compact(splitTotal, currency)}</p>
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </Card>

      <Card title="Unpaid bills by how late they are" hint="All open balances">
        {ageingHasData ? (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageing} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v, currency)} width={52} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [full(v, currency), 'Unpaid']} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {ageing.map((b) => (
                    <Cell key={b.name} fill={b.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty text="Nothing is waiting to be collected" />
        )}
      </Card>

      <Card title="Stock health" hint={`${stockTotal.toLocaleString('en-IN')} items`}>
        {stockTotal > 0 ? (
          <div className="relative h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stockData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} cornerRadius={6} stroke="none">
                  {stockData.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v} items`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Need attention</p>
              <p className="text-base font-extrabold text-slate-900 dark:text-white">{(stock.low + stock.out).toLocaleString('en-IN')}</p>
            </div>
          </div>
        ) : (
          <Empty text="No items yet" />
        )}
      </Card>

      {showBranches ? (
        <Card title="Sales by branch" hint={branchPeriodLabel}>
          <div className="mb-2 inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="tablist" aria-label="Sales by branch period">
            {([
              ['day', 'Day'],
              ['week', 'Week'],
              ['month', 'Month'],
              ['year', 'Year']
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={branchPeriod === id}
                onClick={() => setBranchPeriod(id)}
                className={`cursor-pointer rounded-md px-3 py-1 text-[11px] font-bold ${branchPeriod === id ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {byBranch.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byBranch} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" horizontal={false} />
                  <XAxis type="number" domain={[0, (max: number) => Math.ceil(max * 1.35)]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v, currency)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={84} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, item) => [`${full(v, currency)} · ${(item?.payload as { count?: number })?.count ?? 0} sales`, 'Sales']} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Bar dataKey="value" fill={COLORS.violet} radius={[0, 8, 8, 0]} barSize={14}>
                    <LabelList dataKey="value" position="right" fontSize={10} fontWeight={700} fill="#475569" formatter={(v: number) => compact(v, currency)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text={`No branch sales ${branchPeriod === 'day' ? 'today' : 'in this period'} yet`} />
          )}
          {byBranch.length > 0 && (
            <p className="mt-1 text-[11px] font-semibold text-slate-500">Together: {full(branchTotal, currency)}</p>
          )}
          {byBranch.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {byBranch.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">{b.name}</span>
                  <span className="shrink-0 text-right">
                    <span className="font-bold text-slate-900 dark:text-white">{full(b.value, currency)}</span>
                    <span className="ml-2 text-slate-500">{b.count} {b.count === 1 ? 'sale' : 'sales'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title="Stock value by category" hint="At cost" className={showBranches ? '' : 'lg:col-span-1'}>
        {cats.length > 0 ? (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cats} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v, currency)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={110} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [full(v, currency), 'Value']} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={14}>
                  {cats.map((c, i) => (
                    <Cell key={c.name} fill={catColors[i % catColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty text="No stock value yet (prices not set)" />
        )}
      </Card>
    </div>
  );
};
