import React from 'react';
import { AlertTriangle, ArrowRight, Banknote, Boxes, ClipboardCheck, HandCoins, Wrench } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { deskApi } from '../../services/deskApi';
import { buildWhatsAppLink } from '../../utils/whatsapp';
import { Good, Hero, Panel, Stat, TabState, compact, full, shortDate, useTabData } from '../dashboard/predictions/ui';

const SOURCE: Record<string, string> = { invoice: 'Invoice', 'machine-sale': 'Machine sale', 'job-card': 'Job card' };

const Link: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
    {children} <ArrowRight className="h-3 w-3" />
  </button>
);

// The morning page: today's sales, cash, who owes, what is running out, in one screen.
export const TodayTab: React.FC = () => {
  const { settings, selectedBranchId, setCurrentView } = useERP();
  const { scope, branchParam, isOwner } = useApiScope();
  const cur = settings.currencySymbol || '₹';
  const { data: d, loading, error, reload } = useTabData(() => deskApi.today(scope, branchParam), [scope, branchParam, selectedBranchId]);

  return (
    <TabState loading={loading} error={error} hasData={!!d} reload={reload}>
      {d && (
        <div className="space-y-4">
          {d.notClosedYesterday.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Yesterday's cash book was not closed{d.notClosedYesterday.length > 1 || scope.role === 'Business Owner' ? `: ${d.notClosedYesterday.map((b) => b.name).join(', ')}` : ''}.
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {isOwner &&
                  d.notClosedYesterday.map((b) => {
                    const link = buildWhatsAppLink(b.phone, `Hello${b.manager ? ` ${b.manager}` : ''}, yesterday's cash book for ${b.name} is not closed yet. Please count the cash and close the day in the ERP so the cash in hand stays right. Thank you.`);
                    return link ? (
                      <a key={b.branchId} href={link} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500">
                        Remind {b.name} on WhatsApp
                      </a>
                    ) : (
                      <span key={b.branchId} className="text-[11px] text-amber-700 dark:text-amber-300">{b.name}: no phone number saved</span>
                    );
                  })}
                <Link onClick={() => setCurrentView('cash-book')}>Close it now</Link>
              </span>
            </div>
          )}

          <Hero tone="sky" label={`Sales today · ${d.scopeLabel}`} value={compact(d.sales.total, cur)} sub={`${shortDate(d.date)}${d.sales.count ? ` · ${d.sales.count} sale${d.sales.count === 1 ? '' : 's'}` : ''}${d.sales.serviceCollections ? ` · ${compact(d.sales.serviceCollections, cur)} from service` : ''}`}>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                ['Cash', d.sales.cash],
                ['UPI', d.sales.upi],
                ['Bank or card', d.sales.bank],
                ['On credit', d.sales.credit]
              ].map(([label, v]) => (
                <div key={String(label)} className="rounded-xl bg-white/15 px-2 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">{label}</p>
                  <p className="text-sm font-black tabular-nums">{compact(Number(v), cur)}</p>
                </div>
              ))}
            </div>
          </Hero>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Cash expected today" value={full(d.cashExpected, cur)} sub={d.closedToday === null ? 'all branches' : d.closedToday ? 'day is closed' : 'day is still open'} />
            <Stat label="Cash in hand now" value={full(d.cashInHand, cur)} sub={d.handovers.count ? `${d.handovers.count} handover${d.handovers.count === 1 ? '' : 's'} today` : undefined} tone="good" />
            <Stat label="Owed to you" value={compact(d.dues.total, cur)} sub={`${d.dues.count} unpaid bill${d.dues.count === 1 ? '' : 's'}`} tone={d.dues.total > 0 ? 'bad' : undefined} />
            <Stat label="Service jobs open" value={d.jobs.open} sub={d.jobs.ready ? `${d.jobs.ready} ready to hand over` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={<><HandCoins className="h-4 w-4 text-rose-500" /> Who owes the most</>}>
              {d.dues.top.length === 0 ? (
                <Good>No unpaid bills</Good>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.dues.top.map((p) => (
                    <li key={`${p.source}-${p.number}`} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {SOURCE[p.source] || p.source} {p.number}
                          {p.daysOverdue > 0 ? ` · ${p.daysOverdue} days late` : ''}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-black tabular-nums text-slate-900 dark:text-white">{compact(p.balance, cur)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2">
                <Link onClick={() => setCurrentView('messages')}>Send payment reminders</Link>
              </div>
            </Panel>

            <Panel title={<><Boxes className="h-4 w-4 text-amber-500" /> Running out soon</>}>
              {d.stock.items.length === 0 ? (
                <Good>Nothing needs ordering</Good>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.stock.items.map((s) => (
                    <li key={s.name} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{s.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {s.stock} {s.unit} left · {s.daysLeft >= 999 ? 'no recent sales' : `${s.daysLeft} days left`}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-[11px] font-extrabold text-indigo-600 dark:text-indigo-300">Order {s.order}</p>
                    </li>
                  ))}
                </ul>
              )}
              {d.stock.count > d.stock.items.length && <p className="mt-1 text-[11px] text-slate-400">and {d.stock.count - d.stock.items.length} more in the Buy list.</p>}
            </Panel>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Link onClick={() => setCurrentView('quick-sale')}>
              <Banknote className="h-3.5 w-3.5" /> Quick Sale
            </Link>
            <Link onClick={() => setCurrentView('cash-book')}>
              <ClipboardCheck className="h-3.5 w-3.5" /> Cash Book
            </Link>
            <Link onClick={() => setCurrentView('job-cards')}>
              <Wrench className="h-3.5 w-3.5" /> Job cards
            </Link>
          </div>
        </div>
      )}
    </TabState>
  );
};
