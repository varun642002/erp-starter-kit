import React, { useState } from 'react';
import { ArrowRight, Boxes, ClipboardPlus, Copy, Download, Loader2, Printer, Repeat, Snowflake, Star } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { useApiScope } from '../documents/ui';
import { deskApi } from '../../services/deskApi';
import { canSeeAllDeskTabs } from '../../utils/access';
import { analyticsApi, type StockPlan } from '../../services/analyticsApi';
import { Good, Hero, Note, Panel, Stat, Stepper, TabState, Tip, WhatsAppButton, compact, useTabData, type Step } from '../dashboard/predictions/ui';

const ABC_STYLE = { A: 'bg-rose-500', B: 'bg-amber-500', C: 'bg-slate-400' } as const;
const INPUT = 'mt-1 block h-11 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

function readSetting(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* a private window can refuse storage; the setting just is not remembered */
  }
}

function downloadCsv(plan: StockPlan) {
  const rows = [['Supplier', 'Item', 'SKU', 'In stock', 'Sells per month', 'Days left', 'Order']];
  for (const o of plan.orders) for (const l of o.lines) rows.push([o.supplierName, l.name, l.sku, String(l.stock), String(l.perMonth), String(l.daysLeft), l.label]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `buy-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// What to buy, from whom, and how much, grouped by supplier and ready to send on WhatsApp.
export const BuyListTab: React.FC = () => {
  const { settings, selectedBranchId, showToast, setCurrentView, currentRole, addAuditLog } = useERP();
  const { isSuperAdmin } = useAuth();
  const { scope, branchParam } = useApiScope();
  // Saving an order with a supplier, and seeing what is already on order, is for the Super Admin and the owner.
  const canOrder = canSeeAllDeskTabs(isSuperAdmin, currentRole);
  const [savingFor, setSavingFor] = useState('');
  const cur = settings.currencySymbol || '₹';
  const [lead, setLead] = useState(() => readSetting('desk.lead', 7));
  const [cover, setCover] = useState(() => readSetting('desk.cover', 30));
  const { data: plan, loading, error, reload } = useTabData(() => analyticsApi.stockPlan(scope, branchParam, lead, cover), [scope, branchParam, selectedBranchId, lead, cover]);

  const onOrder = useTabData(() => (canOrder ? deskApi.orders(scope, branchParam, 'Ordered') : Promise.resolve([])), [scope, branchParam, selectedBranchId, canOrder]);
  // what is already on order, by item number
  const ordered = new Map<string, string[]>();
  for (const o of onOrder.data || []) for (const l of o.lines) if (l.sku) ordered.set(l.sku, [...(ordered.get(l.sku) || []), o.orderNo]);

  const saveOrder = async (o: StockPlan['orders'][number]) => {
    setSavingFor(o.supplierName);
    try {
      const due = new Date(Date.now() + lead * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const saved = await deskApi.createOrder(scope, {
        supplierName: o.supplierName,
        supplierPhone: o.supplierPhone,
        branchId: branchParam && branchParam !== 'all' ? branchParam : undefined,
        expectedDate: due,
        lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, qty: l.orderQty, unit: l.unit, label: l.label }))
      });
      addAuditLog('Supplier order saved', 'Purchases', `${saved.orderNo}: ${o.lines.length} item${o.lines.length === 1 ? '' : 's'} ordered from ${o.supplierName}.`, { severity: 'info', entityType: 'Supplier', entityId: saved.id });
      showToast('Order saved', `${saved.orderNo} to ${o.supplierName}. Find it under Supplier orders.`, 'success');
      onOrder.reload();
    } catch (e: any) {
      showToast('Could not save the order', e?.message || 'Please try again.', 'error');
    } finally {
      setSavingFor('');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied', 'The order message is ready to paste', 'success');
    } catch {
      showToast('Could not copy', 'Select the text and copy it by hand', 'error');
    }
  };

  const steps: Step[] = [];
  if (plan) {
    steps.push({
      id: 'order',
      label: 'Order list',
      title: 'What to buy now',
      hint: 'Grouped by supplier. Send each one on WhatsApp, or copy, print or download it.',
      icon: Boxes,
      content: (
        <div className="space-y-4">
          <Hero tone={plan.orderLineCount > 0 ? 'amber' : 'emerald'} label="Items to order" value={plan.orderLineCount} sub={plan.orderLineCount ? `from ${plan.orders.length} supplier${plan.orders.length === 1 ? '' : 's'}` : 'Nothing needs ordering right now'} />
          <Panel title="How much to order">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-slate-500">
                Days a supplier takes to deliver
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={lead}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(60, Number(e.target.value) || 0));
                    setLead(v);
                    saveSetting('desk.lead', v || 7);
                  }}
                  className={INPUT}
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Days of stock to order for
                <input
                  type="number"
                  min={7}
                  max={120}
                  value={cover}
                  onChange={(e) => {
                    const v = Math.max(7, Math.min(120, Number(e.target.value) || 7));
                    setCover(v);
                    saveSetting('desk.cover', v);
                  }}
                  className={INPUT}
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Sales speed is multiplied by <b className="text-slate-800 dark:text-slate-200">{plan.seasonFactor.toFixed(2)}</b> for the coming season and rain.
            </p>
          </Panel>
          {plan.orders.length === 0 ? (
            <Good>Nothing needs ordering right now</Good>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadCsv(plan)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <Download className="h-3.5 w-3.5" /> Download CSV
                </button>
                <button type="button" onClick={() => window.print()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
              </div>
              {plan.orders.map((o) => (
                <div key={o.supplierName} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white">{o.supplierName}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => copy(o.message)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        <Copy className="h-3.5 w-3.5" /> Copy message
                      </button>
                      <WhatsAppButton phone={o.supplierPhone} text={o.message} label="Send order" />
                      {canOrder && (
                        <button type="button" disabled={savingFor === o.supplierName} onClick={() => saveOrder(o)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900">
                          {savingFor === o.supplierName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPlus className="h-3.5 w-3.5" />} Save as order
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                    {o.lines.map((l) => (
                      <li key={l.productId} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 break-words text-sm font-bold text-slate-900 dark:text-white">
                            <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-black text-white ${ABC_STYLE[l.abc]}`} title={l.abc === 'A' ? 'Top seller: never let it run out' : l.abc === 'B' ? 'Steady seller' : 'Slow seller'}>{l.abc}</span>
                            {l.name}
                            {ordered.has(l.sku) && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">on order · {ordered.get(l.sku)![0]}</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {l.stock} {l.unit} left · sells about {l.perMonth} a month · {l.daysLeft >= 999 ? 'no sales yet' : `${l.daysLeft} days left`}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-xs font-extrabold text-indigo-600 dark:text-indigo-300">Order {l.label}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {plan.orders.some((o) => o.supplierName === 'No supplier on record') && (
                <Tip title="Items with no supplier">Items under "No supplier on record" have never been received through a goods receipt. Receive stock once from a supplier and they will group under that supplier next time.</Tip>
              )}
            </>
          )}
        </div>
      )
    });

    steps.push({
      id: 'abc',
      label: 'Never run out',
      title: 'Items that earn the most',
      hint: 'Never let these run out.',
      icon: Star,
      content:
        plan.abc.length === 0 ? (
          <Note>Needs some sales of saved products first.</Note>
        ) : (
          <Panel>
            <ul className="space-y-3">
              {plan.abc.slice(0, 12).map((a) => (
                <li key={a.productId}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-1.5 break-words text-sm font-bold text-slate-900 dark:text-white">
                      <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-black text-white ${ABC_STYLE[a.abc]}`}>{a.abc}</span>
                      {a.name}
                    </p>
                    <p className="shrink-0 text-right text-[11px] text-slate-500">
                      {compact(a.revenue, cur)} · {a.sharePercent}% of sales
                    </p>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full ${a.abc === 'A' ? 'bg-gradient-to-r from-rose-500 to-orange-400' : a.abc === 'B' ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : 'bg-slate-400'}`} style={{ width: `${Math.min(100, a.sharePercent * 4)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {a.stock} {a.unit} in stock{a.daysLeft !== null ? ` · about ${a.daysLeft} days` : ''}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-400">A: together about 80% of sales. B: the next 15%. C: the rest. Last 90 days.</p>
          </Panel>
        )
    });

    steps.push({
      id: 'transfer',
      label: 'Move stock',
      title: 'Move stock instead of buying more',
      hint: 'One branch has extra of something another branch is short of.',
      icon: Repeat,
      content:
        plan.transfers.length === 0 ? (
          <Good>No branch has stock that another branch needs</Good>
        ) : (
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {plan.transfers.slice(0, 12).map((t, i) => (
                <li key={t.productId + i} className="py-2.5">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">{t.fromBranch}</span> <ArrowRight className="h-3 w-3 text-slate-400" /> <span className="font-semibold">{t.toBranch}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      {t.qty} {t.unit}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">{t.reason}</p>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setCurrentView('stock-transfers')} className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
              Make the move in Stock Transfers <ArrowRight className="h-3 w-3" />
            </button>
          </Panel>
        )
    });

    steps.push({
      id: 'slow',
      label: 'Not selling',
      title: 'Stock that is not selling',
      hint: 'Money lying on the shelf.',
      icon: Snowflake,
      content: (
        <div className="space-y-4">
          {!plan.slow.reliable && <Note tone="warn">{plan.slow.basis}. This list becomes reliable after about 60 days of sales.</Note>}
          {plan.slow.items.length === 0 ? (
            <Good>Everything in stock has sold recently</Good>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Items not moving" value={plan.slow.items.length} />
                <Stat label="Money tied up" value={compact(plan.slow.totalValue, cur)} />
              </div>
              <Panel>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {plan.slow.items.slice(0, 15).map((s) => (
                    <li key={s.productId} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{s.name}</p>
                        <p className="text-[11px] text-slate-500">{s.daysSinceSale === null ? 'No sale on record' : `Last sold ${s.daysSinceSale} days ago`}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                          {s.stock} {s.unit}
                        </p>
                        <p className="text-[11px] text-slate-500">{s.value > 0 ? `${compact(s.value, cur)} at ${s.valueBasis}` : 'Price not set'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Tip title="Ideas">Offer it with a fast seller, discount it before the season turns, or move it to a busier branch.</Tip>
            </>
          )}
        </div>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!plan} reload={reload}>
      {plan && <Stepper steps={steps} resetKey={`buy-${scope.branchId}-${branchParam}`} />}
    </TabState>
  );
};
