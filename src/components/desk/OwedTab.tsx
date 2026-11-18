import React, { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, HandCoins, ListChecks, MessageCircle, Phone, Search, Tractor, Wallet } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { analyticsApi } from '../../services/analyticsApi';
import { fetchMessageQueue } from '../../services/messageApi';
import { SettleDialog, type SettleTarget } from './SettleDialog';
import { Good, Hero, Note, Panel, Stat, Stepper, TabState, Tip, WhatsAppButton, compact, full, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

const LEVEL_STYLE = { High: 'text-rose-600 dark:text-rose-400', Medium: 'text-amber-600 dark:text-amber-400', Low: 'text-slate-500 dark:text-slate-400' } as const;
const LEVEL_BAR = { High: 'from-rose-500 to-red-500', Medium: 'from-amber-400 to-orange-500', Low: 'from-sky-400 to-indigo-500' } as const;

const GlassTip: React.FC<any> = ({ active, payload, label, cur }) =>
  active && payload?.length ? (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
      <p className="font-bold text-slate-800 dark:text-slate-100">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {full(Number(p.value), cur)}
        </p>
      ))}
    </div>
  ) : null;

// Who owes money, ranked by who is least likely to pay on time, and when the money will arrive.
export const OwedTab: React.FC = () => {
  const { settings, selectedBranchId, setCurrentView } = useERP();
  const { scope, branchParam } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const people = useTabData(() => analyticsApi.customers(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const money = useTabData(() => analyticsApi.money(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const queue = useTabData(() => fetchMessageQueue(scope, branchParam), [scope, branchParam, selectedBranchId]);
  const [settle, setSettle] = useState<SettleTarget | null>(null);
  const [find, setFind] = useState('');
  const refreshAll = () => {
    people.reload();
    money.reload();
    queue.reload();
  };
  const settleButton = (t: SettleTarget) => (
    <button type="button" onClick={() => setSettle(t)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
      <HandCoins className="h-3.5 w-3.5" /> Settle
    </button>
  );

  const steps: Step[] = [];
  const pay = people.data?.payments;
  if (pay) {
    steps.push({
      id: 'call',
      label: 'Who to call',
      title: 'Who owes you money',
      hint: 'The people most likely to pay late come first.',
      icon: Phone,
      content: (
        <div className="space-y-4">
          <Hero tone={pay.totalAtRisk > 0 ? 'amber' : 'emerald'} label="Money waiting to be collected" value={compact(pay.totalAtRisk, cur)} sub={`${pay.items.length} unpaid bill${pay.items.length === 1 ? '' : 's'} on invoices and machine sales`} />
          {pay.items.length === 0 ? (
            <Good>No unpaid invoices or machine balances</Good>
          ) : (
            <ul className="space-y-3">
              {pay.items.slice(0, 15).map((p) => (
                <li key={p.key} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{p.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {p.kind} {p.reference}
                        {p.dueDate ? ` · due ${shortDate(p.dueDate)}` : ''}
                        {p.overdueDays > 0 ? ` · ${p.overdueDays} days late` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{compact(p.balance, cur)}</p>
                      <p className={`text-[11px] font-extrabold ${LEVEL_STYLE[p.level]}`}>{p.level} risk</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full bg-gradient-to-r ${LEVEL_BAR[p.level]}`} style={{ width: `${Math.min(100, Math.max(6, p.score))}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {p.pastLatePercent === null ? 'No earlier invoices to judge by.' : `Paid ${p.pastLatePercent}% of earlier invoices late${p.typicalDelayDays ? `, usually about ${p.typicalDelayDays} days after the due date` : ''}.`} {p.action}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <WhatsAppButton
                      phone={p.phone}
                      label="Remind"
                      text={`Hello ${p.customerName}, this is Acme Agro Equipment. A balance of ${cur}${Math.round(p.balance).toLocaleString('en-IN')} is pending on ${p.reference}${p.dueDate ? ` (due ${p.dueDate})` : ''}. Kindly arrange the payment. Thank you.`}
                    />
                    {settleButton({ source: p.kind === 'Machine' ? 'machine-sale' : 'invoice', id: p.key, number: p.reference, customerName: p.customerName, balance: p.balance })}
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        <Phone className="h-3 w-3" /> Call {p.phone}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Tip title="Send many at once">
            Want to remind everyone together, with a Pay Now button?{' '}
            <button type="button" onClick={() => setCurrentView('messages')} className="inline-flex cursor-pointer items-center gap-1 font-bold underline">
              <MessageCircle className="h-3.5 w-3.5" /> Open WhatsApp Messages
            </button>
          </Tip>
          <p className="text-[11px] text-slate-400">{pay.basis}.</p>
        </div>
      )
    });
  }

  const bills = queue.data?.overdueInvoices;
  if (bills) {
    const q = find.trim().toLowerCase();
    const shown = bills.filter((b) => !q || b.customerName.toLowerCase().includes(q) || b.invoiceNumber.toLowerCase().includes(q) || (b.phone || '').includes(q));
    const total = bills.reduce((s, b) => s + b.balance, 0);
    const label = { invoice: 'Invoice', 'machine-sale': 'Machine sale', 'job-card': 'Job card' } as const;
    steps.push({
      id: 'unpaid',
      label: 'Settle bills',
      title: 'Settle an unpaid bill',
      hint: 'Every unpaid invoice, machine sale and job card. Press Settle when the money is received.',
      icon: ListChecks,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Unpaid bills" value={bills.length.toLocaleString('en-IN')} />
            <Stat label="Total to collect" value={compact(total, cur)} tone={total > 0 ? 'bad' : undefined} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Search by customer, bill number or mobile"
              aria-label="Search unpaid bills"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          {bills.length === 0 ? (
            <Good>Every bill is paid</Good>
          ) : shown.length === 0 ? (
            <Note>No unpaid bill matches that search.</Note>
          ) : (
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.slice(0, 60).map((b) => (
                  <li key={`${b.source}-${b.invoiceId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{b.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {label[b.source || 'invoice']} {b.invoiceNumber}
                        {b.dueDate ? ` · due ${shortDate(b.dueDate)}` : ''}
                        {b.daysOverdue > 0 ? ` · ${b.daysOverdue} days late` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-base font-black tabular-nums text-slate-900 dark:text-white">{compact(b.balance, cur)}</p>
                      {settleButton({ source: b.source || 'invoice', id: b.invoiceId, number: b.invoiceNumber, customerName: b.customerName, balance: b.balance })}
                    </div>
                  </li>
                ))}
              </ul>
              {shown.length > 60 && <p className="mt-2 text-[11px] text-slate-400">Showing the first 60 of {shown.length}. Search to narrow the list.</p>}
            </Panel>
          )}
          <Tip title="Part payment">The amount starts as the whole balance. Type a smaller amount if the customer pays part now. The rest stays due.</Tip>
        </div>
      )
    });
  }

  const m = money.data;
  if (m) {
    steps.push({
      id: 'cash',
      label: 'Cash ahead',
      title: 'Will the cash last? The next 4 weeks',
      hint: 'Money coming in and going out, week by week.',
      icon: Wallet,
      content: (
        <div className="space-y-4">
          {m.cash.firstShortWeek && <Note tone="warn">Cash could run short from the week of {shortDate(m.cash.firstShortWeek)} (lowest point about {full(m.cash.lowestRunning, cur)}). Collect the overdue invoices and delay non-urgent purchases.</Note>}
          <Panel>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={m.cash.weeks.map((w) => ({ label: shortDate(w.weekStart), In: w.totalIn, Out: w.totalOut, Running: w.running }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => compact(v, cur)} />
                  <Tooltip content={<GlassTip cur={cur} />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="In" name="Money in" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Out" name="Money out" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Line type="monotone" dataKey="Running" name="Running total" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: '#6366f1', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">
            {m.cash.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )
    });

    const waiting = m.machines.pipelineWeeks.reduce((s, w) => s + w.count, 0);
    steps.push({
      id: 'machines',
      label: 'Machine balances',
      title: 'Machine balances: when the money arrives',
      hint: 'What is still to be collected on machines, and the subsidy still to come.',
      icon: Tractor,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Waiting to be delivered" value={waiting} sub="Booked, ready or on the way" />
            <Stat label="Balance to collect" value={compact(m.machines.pipelineWeeks.reduce((s, w) => s + w.balance, 0) + m.machines.laterBalance, cur)} sub="After delivery" />
            <Stat label="At risk of slipping" value={m.machines.atRiskCount} tone={m.machines.atRiskCount ? 'bad' : undefined} sub={m.machines.atRiskCount ? `${compact(m.machines.atRiskBalance, cur)} of balances` : undefined} />
            <Stat label="Subsidy still to receive" value={compact(m.machines.subsidy.amount, cur)} sub={`${m.machines.subsidy.count} machine${m.machines.subsidy.count === 1 ? '' : 's'}`} />
          </div>
          {m.machines.atRisk.length > 0 && (
            <Panel title="Machines where the money may be late">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {m.machines.atRisk.slice(0, 8).map((a) => (
                  <li key={a.saleNumber} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">
                        {a.customerName} <span className="font-normal text-slate-500">· {a.machine}</span>
                      </p>
                      <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {a.reason}</p>
                    </div>
                    <p className="shrink-0 text-sm font-extrabold text-slate-800 dark:text-slate-200">{compact(a.balance, cur)}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {m.machines.subsidy.byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.machines.subsidy.byStatus.map((s) => (
                <span key={s.status} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Subsidy {s.status}: {s.count} · {compact(s.amount, cur)}
                </span>
              ))}
            </div>
          )}
          {waiting === 0 && m.machines.atRiskCount === 0 && <Good>No machines are waiting for delivery</Good>}
        </div>
      )
    });
  }

  return (
    <>
      <TabState loading={people.loading && money.loading && queue.loading} error={people.error && money.error && queue.error ? people.error : ''} hasData={steps.length > 0} reload={refreshAll}>
        {steps.length > 0 && <Stepper steps={steps} resetKey={`owed-${scope.branchId}-${branchParam}`} />}
      </TabState>
      <SettleDialog target={settle} cur={cur} onClose={() => setSettle(null)} onDone={refreshAll} />
    </>
  );
};
