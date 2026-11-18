import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Loader2, PackageCheck, PackageX, Phone, Search, Undo2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope, BTN_GHOST, BTN_PRIMARY, CARD, INPUT, LABEL, Modal } from '../documents/ui';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { returnApi, type CreditBalance, type OpenInvoice, type PurchaseLine, type ReturnRecord } from '../../services/returnApi';

type Tab = 'new' | 'history' | 'damaged';
type Condition = 'Not damaged' | 'Damaged';

const FIELD =
  'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

interface CustomerGroup {
  key: string;
  name: string;
  phone: string | null;
  branch: string | null;
  lines: PurchaseLine[];
  lastDate: string;
}

const dayLabel = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const ReturnsView: React.FC = () => {
  const { showToast, addAuditLog, refreshProducts, settings } = useERP();
  const { scope, branchParam } = useApiScope();
  const money = (n: number) => `${settings.currencySymbol || '₹'}${Math.round(n || 0).toLocaleString('en-IN')}`;

  const [tab, setTab] = useState<Tab>('new');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [history, setHistory] = useState<ReturnRecord[]>([]);
  const [damaged, setDamaged] = useState<ReturnRecord[]>([]);
  const [credits, setCredits] = useState<CreditBalance[]>([]);
  const [usingCredit, setUsingCredit] = useState<{ group: CustomerGroup; balance: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<PurchaseLine | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const [p, h, d, cr] = await Promise.all([
          returnApi.purchases(scope, { branchId: branchParam, q: debounced }),
          returnApi.list(scope, { branchId: branchParam, q: debounced }),
          returnApi.list(scope, { branchId: branchParam, q: debounced, condition: 'Damaged' }),
          returnApi.credits(scope).catch(() => [] as CreditBalance[])
        ]);
        if (!alive.current) return;
        setLines(p);
        setHistory(h);
        setDamaged(d);
        setCredits(cr);
      } catch (e: any) {
        if (alive.current && !silent) setError(e?.message || 'Could not load the purchases.');
      } finally {
        if (alive.current && !silent) setLoading(false);
      }
    },
    [scope, branchParam, debounced]
  );
  useEffect(() => {
    load(false);
  }, [load]);
  useLiveRefresh(() => load(true), 30_000);

  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const l of lines) {
      let g = map.get(l.customerKey);
      if (!g) {
        g = { key: l.customerKey, name: l.customerName, phone: l.customerPhone, branch: l.branchName, lines: [], lastDate: l.date };
        map.set(l.customerKey, g);
      }
      g.lines.push(l);
      if (l.date > g.lastDate) g.lastDate = l.date;
    }
    return [...map.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  }, [lines]);

  // a search that narrows to a few customers opens them straight away
  const creditOf = (g: CustomerGroup) => credits.find((c) => c.customerKey === g.key)?.balance ?? 0;
  const isOpen = (g: CustomerGroup) => open[g.key] ?? (debounced.length > 0 && groups.length <= 3);

  const onDone = (r: ReturnRecord) => {
    setPicked(null);
    showToast(
      `Return ${r.returnNumber} saved`,
      [
        r.restocked ? `${r.quantity} ${r.unit || ''} of ${r.productName} went back into stock.` : r.condition === 'Damaged' ? `${r.quantity} ${r.unit || ''} of ${r.productName} was added to the damaged products list.` : `${r.productName} was recorded as returned.`,
        r.balanceReduced > 0 ? `${money(r.balanceReduced)} taken off the invoice balance.` : '',
        r.creditAdded > 0 ? `${money(r.creditAdded)} kept as credit for ${r.customerName}.` : '',
        r.cashRefunded > 0 ? `${money(r.cashRefunded)} refunded (${r.refundMethod || 'Cash'}) and noted in the Cash Book.` : ''
      ]
        .filter(Boolean)
        .join(' '),
      'success'
    );
    addAuditLog('Product Return', 'Returns', `${r.returnNumber}: ${r.customerName} returned ${r.quantity} ${r.unit || ''} of ${r.productName} from ${r.sourceNumber} (${r.condition}).`, { severity: r.condition === 'Damaged' ? 'warning' : 'info' } as any);
    if (r.restocked) refreshProducts();
    load(true);
  };

  const onDamageChanged = (r: ReturnRecord) => {
    showToast(
      `${r.productName}: ${r.damageStatus}`,
      r.damageStatus === 'Repaired' ? `${r.stockQuantity} ${r.unit || ''} went back into stock.` : r.damageStatus === 'Scrapped' ? 'It was written off the damaged list.' : 'It is marked as sent to the supplier.',
      'success'
    );
    addAuditLog('Damaged Product Update', 'Returns', `${r.returnNumber}: ${r.quantity} ${r.unit || ''} of ${r.productName} marked ${r.damageStatus}.`, { severity: 'info' } as any);
    if (r.damageStatus === 'Repaired') refreshProducts();
    load(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Return Product</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Pick the customer and what they bought, then record what came back. Not damaged goods go back into stock; damaged goods go to the damaged products list.</p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {([
            ['new', 'New return'],
            ['history', `Returns made${history.length ? ` (${history.length})` : ''}`],
            ['damaged', `Damaged products${damaged.length ? ` (${damaged.length})` : ''}`]
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`cursor-pointer whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-semibold ${tab === id ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === 'new' ? 'Search customer, phone, product or bill number' : 'Search returns'}
          aria-label="Search"
          className={`${FIELD} w-full pl-8 pr-3`}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : tab === 'new' ? (
        groups.length === 0 ? (
          <div className={`${CARD} px-4 py-10 text-center text-sm text-slate-500`}>{debounced ? 'No purchases match that search.' : 'No purchases to return yet.'}</div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-slate-500">
              {groups.length} customer{groups.length === 1 ? '' : 's'} · tap a customer to see what they bought
            </p>
            {groups.map((g) => {
              const expanded = isOpen(g);
              return (
                <div key={g.key} className={`${CARD} overflow-hidden`}>
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))} aria-expanded={expanded} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{g.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                        {g.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {g.phone}
                          </span>
                        )}
                        {g.branch && <span>{g.branch}</span>}
                        <span>
                          {g.lines.length} item{g.lines.length === 1 ? '' : 's'} bought · last {dayLabel(g.lastDate)}
                        </span>
                        {creditOf(g) > 0 && <span className="font-bold text-emerald-600">Credit with us {money(creditOf(g))}</span>}
                      </p>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && creditOf(g) > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-emerald-50/60 px-3.5 py-2.5 dark:border-slate-800 dark:bg-emerald-950/20">
                      <p className="text-[12px] text-emerald-800 dark:text-emerald-300">
                        {g.name} has <b>{money(creditOf(g))}</b> credit from returns.
                      </p>
                      <button type="button" onClick={() => setUsingCredit({ group: g, balance: creditOf(g) })} className={`${BTN_GHOST} whitespace-nowrap`}>
                        Use credit on an invoice
                      </button>
                    </div>
                  )}
                  {expanded && (
                    <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {g.lines.map((l) => (
                        <li key={`${l.sourceType}-${l.lineId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
                          <div className="min-w-0 flex-1 basis-56">
                            <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{l.productName}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {l.sourceType === 'sale' ? 'Counter sale' : 'Invoice'} {l.number} · {dayLabel(l.date)}
                              {l.sku ? ` · ${l.sku}` : ''}
                            </p>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            <p>
                              Bought <b>{l.quantity}</b> {l.unit} at {money(l.unitValue)}
                            </p>
                            {l.returned > 0 && <p className="font-semibold text-amber-700 dark:text-amber-300">Returned {l.returned}</p>}
                          </div>
                          <button type="button" disabled={l.remaining <= 0} onClick={() => setPicked(l)} className={`${BTN_GHOST} whitespace-nowrap`}>
                            <Undo2 className="h-3.5 w-3.5" /> {l.remaining <= 0 ? 'All returned' : 'Return'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'damaged' ? (
        <DamagedList rows={damaged} money={money} searching={debounced.length > 0} onChanged={onDamageChanged} />
      ) : history.length === 0 ? (
        <div className={`${CARD} px-4 py-10 text-center text-sm text-slate-500`}>{debounced ? 'No returns match that search.' : 'No returns have been recorded yet.'}</div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5 font-bold">Return</th>
                <th className="px-3 py-2.5 font-bold">Customer</th>
                <th className="px-3 py-2.5 font-bold">Product</th>
                <th className="px-3 py-2.5 font-bold">Qty</th>
                <th className="px-3 py-2.5 font-bold">Condition</th>
                <th className="px-3 py-2.5 font-bold">Stock</th>
                <th className="px-3 py-2.5 font-bold">Customer's money</th>
                <th className="px-3 py-2.5 text-right font-bold">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-slate-900 dark:text-white">{r.returnNumber}</p>
                    <p className="text-[11px] text-slate-500">
                      {dayLabel(r.returnDate)} · {r.sourceNumber}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{r.customerName}</p>
                    {r.branchName && <p className="text-[11px] text-slate-500">{r.branchName}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">
                    {r.productName}
                    {r.reason && <p className="text-[11px] text-slate-500">{r.reason}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {r.quantity} {r.unit}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2.5 font-bold ${r.condition === 'Damaged' ? 'text-rose-600' : 'text-emerald-600'}`}>{r.condition}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.stockNote}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                    {r.balanceReduced > 0 && <p>{money(r.balanceReduced)} off the bill's balance</p>}
                    {r.creditAdded > 0 && <p>{money(r.creditAdded)} kept as credit</p>}
                    {r.cashRefunded > 0 && (
                      <p>
                        {money(r.cashRefunded)} refunded{r.refundMethod ? ` (${r.refundMethod})` : ''}
                      </p>
                    )}
                    {r.balanceReduced + r.creditAdded + r.cashRefunded <= 0 && <p>-</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{money(r.refundValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usingCredit && (
        <UseCreditDialog
          group={usingCredit.group}
          balance={usingCredit.balance}
          money={money}
          onClose={() => setUsingCredit(null)}
          onDone={(applied) => {
            setUsingCredit(null);
            showToast('Credit used', `${money(applied)} of ${usingCredit.group.name}'s credit was taken off the invoice.`, 'success');
            addAuditLog('Customer Credit Used', 'Returns', `${money(applied)} of ${usingCredit.group.name}'s return credit was applied to an invoice.`, { severity: 'info' } as any);
            load(true);
          }}
        />
      )}
      {picked && <ReturnDialog line={picked} money={money} onClose={() => setPicked(null)} onDone={onDone} />}
    </div>
  );
};

const ReturnDialog: React.FC<{ line: PurchaseLine; money: (n: number) => string; onClose: () => void; onDone: (r: ReturnRecord) => void }> = ({ line, money, onClose, onDone }) => {
  const { scope } = useApiScope();
  const [qty, setQty] = useState(String(Math.min(1, line.remaining) || 1));
  const [condition, setCondition] = useState<Condition | ''>('');
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<'credit' | 'refund' | ''>('');
  const [refundMethod, setRefundMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const n = Number(qty);
  const validQty = Number.isInteger(n) && n > 0 && n <= line.remaining;
  const putsBack = condition === 'Not damaged' && line.stockTracked;
  const value = Math.round(line.unitValue * (validQty ? n : 0) * 100) / 100;
  const offBill = Math.min(value, line.billBalance);
  const rest = Math.round((value - offBill) * 100) / 100;
  const needsChoice = validQty && rest > 0.5;

  const submit = async () => {
    if (!validQty || !condition || busy || (needsChoice && !settlement)) return;
    setBusy(true);
    setErr('');
    try {
      const r = await returnApi.create(scope, { sourceType: line.sourceType, sourceId: line.sourceId, lineId: line.lineId, quantity: n, condition, reason: reason.trim() || undefined, settlement: needsChoice ? settlement || undefined : undefined, refundMethod: needsChoice && settlement === 'refund' ? refundMethod : undefined });
      onDone(r);
    } catch (e: any) {
      setErr(e?.message || 'Could not save the return.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Return product"
      subtitle={`${line.customerName} · ${line.sourceType === 'sale' ? 'Counter sale' : 'Invoice'} ${line.number}`}
      onClose={onClose}
      size="md"
      actions={undefined}
    >
      <div className="space-y-4 p-4">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{line.productName}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Bought {line.quantity} {line.unit} at {money(line.unitValue)}
            {line.returned > 0 ? ` · ${line.returned} already returned` : ''} · {line.remaining} can still be returned
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="ret-qty">
            How many are coming back ({line.unit})
          </label>
          <input id="ret-qty" type="number" inputMode="numeric" min={1} max={line.remaining} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className={INPUT} />
          {!validQty && qty !== '' && <p className="mt-1 text-[11px] font-semibold text-rose-600">Enter a whole number from 1 to {line.remaining}.</p>}
        </div>

        <div>
          <p className={LABEL}>Condition of the returned goods</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCondition('Not damaged')}
              aria-pressed={condition === 'Not damaged'}
              className={`cursor-pointer rounded-xl border-2 p-3 text-left ${condition === 'Not damaged' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
            >
              <PackageCheck className="mb-1 h-5 w-5 text-emerald-600" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">Not damaged</p>
              <p className="text-[11px] text-slate-500">Goes back into stock</p>
            </button>
            <button
              type="button"
              onClick={() => setCondition('Damaged')}
              aria-pressed={condition === 'Damaged'}
              className={`cursor-pointer rounded-xl border-2 p-3 text-left ${condition === 'Damaged' ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
            >
              <PackageX className="mb-1 h-5 w-5 text-rose-600" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">Damaged</p>
              <p className="text-[11px] text-slate-500">Goes to the damaged products list</p>
            </button>
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor="ret-reason">
            Reason (optional)
          </label>
          <input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: wrong size, not suitable" className={INPUT} />
        </div>

        {validQty && (
          <div className="space-y-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Customer's money: {money(value)}</p>
            {offBill > 0.5 && <p className="text-[12px] text-slate-600 dark:text-slate-300">{money(offBill)} is taken off what the customer still owes on this invoice ({money(line.billBalance)} owing).</p>}
            {needsChoice ? (
              <>
                <p className="text-[12px] text-slate-600 dark:text-slate-300">{offBill > 0.5 ? `For the other ${money(rest)}:` : 'The bill is already paid, so:'}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSettlement('credit')} aria-pressed={settlement === 'credit'} className={`cursor-pointer rounded-lg border-2 p-2.5 text-left ${settlement === 'credit' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white">Keep as credit</p>
                    <p className="text-[11px] text-slate-500">Use it on their next invoice</p>
                  </button>
                  <button type="button" onClick={() => setSettlement('refund')} aria-pressed={settlement === 'refund'} className={`cursor-pointer rounded-lg border-2 p-2.5 text-left ${settlement === 'refund' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white">Refund now</p>
                    <p className="text-[11px] text-slate-500">Paid out, noted in the Cash Book</p>
                  </button>
                </div>
                {settlement === 'refund' && (
                  <div>
                    <label className={LABEL} htmlFor="ret-method">
                      Refunded by
                    </label>
                    <select id="ret-method" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as 'Cash' | 'UPI' | 'Bank Transfer')} className={INPUT}>
                      <option>Cash</option>
                      <option>UPI</option>
                      <option>Bank Transfer</option>
                    </select>
                  </div>
                )}
              </>
            ) : (
              offBill > 0.5 && <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">Nothing more is owed to the customer.</p>
            )}
          </div>
        )}
        {condition === 'Not damaged' && !line.stockTracked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">This bill never took stock out, so nothing will be added back.</p>}
        {validQty && condition && <p className="text-xs text-slate-600 dark:text-slate-300">{putsBack ? `${n * line.unitFactor} will be added back to stock.` : 'Stock will not change; it goes to the damaged products list.'}</p>}
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!validQty || !condition || busy || (needsChoice && !settlement)} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save return
          </button>
        </div>
      </div>
    </Modal>
  );
};

// Damaged goods that customers brought back: kept out of stock until they are sent back, repaired or scrapped.
type DamageFilter = 'open' | 'Repaired' | 'Scrapped' | 'all';
const DAMAGE_FILTERS: { id: DamageFilter; label: string }[] = [
  { id: 'open', label: 'Still with us' },
  { id: 'Repaired', label: 'Repaired' },
  { id: 'Scrapped', label: 'Scrapped' },
  { id: 'all', label: 'All' }
];
const statusColour = (s: string) =>
  s === 'Repaired' ? 'text-emerald-600' : s === 'Scrapped' ? 'text-slate-500' : s === 'Sent to supplier' ? 'text-sky-600' : 'text-rose-600';

const DamagedList: React.FC<{ rows: ReturnRecord[]; money: (n: number) => string; searching: boolean; onChanged: (r: ReturnRecord) => void }> = ({ rows, money, searching, onChanged }) => {
  const [filter, setFilter] = useState<DamageFilter>('open');
  const [acting, setActing] = useState<ReturnRecord | null>(null);

  const shown = useMemo(
    () => rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? r.damageStatus === 'Held' || r.damageStatus === 'Sent to supplier' : r.damageStatus === filter)),
    [rows, filter]
  );
  const byProduct = useMemo(() => {
    const m = new Map<string, { name: string; sku: string | null; units: number; value: number; returns: number }>();
    for (const r of shown) {
      const g = m.get(r.productId) ?? { name: r.productName, sku: r.sku, units: 0, value: 0, returns: 0 };
      g.units += r.stockQuantity;
      g.value += r.refundValue;
      g.returns += 1;
      m.set(r.productId, g);
    }
    return [...m.values()].sort((a, b) => b.units - a.units);
  }, [shown]);
  const totalUnits = byProduct.reduce((s, g) => s + g.units, 0);
  const totalValue = byProduct.reduce((s, g) => s + g.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {DAMAGE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`cursor-pointer whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f.id ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={`${CARD} px-4 py-10 text-center text-sm text-slate-500`}>
          {searching ? 'No damaged products match that search.' : filter === 'open' ? 'Nothing damaged is waiting. Goods returned as Damaged are listed here.' : 'Nothing here yet.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className={`${CARD} p-3`}>
              <p className="text-[11px] font-semibold text-slate-500">Damaged items</p>
              <p className="text-xl font-extrabold text-rose-600">{totalUnits}</p>
              <p className="text-[11px] text-slate-500">
                {byProduct.length} product{byProduct.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className={`${CARD} p-3`}>
              <p className="text-[11px] font-semibold text-slate-500">Value at sale price</p>
              <p className="text-xl font-extrabold text-slate-900 dark:text-white">{money(totalValue)}</p>
            </div>
          </div>

          <div className={`${CARD} overflow-x-auto`}>
            <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800">By product</p>
            <table className="w-full text-left text-xs" data-no-stack="true">
              <thead className="text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-bold">Product</th>
                  <th className="px-3 py-2 text-right font-bold">Damaged</th>
                  <th className="px-3 py-2 text-right font-bold">Returns</th>
                  <th className="px-3 py-2 text-right font-bold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {byProduct.map((g) => (
                  <tr key={g.name + g.sku}>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{g.name}</p>
                      {g.sku && <p className="text-[11px] text-slate-500">{g.sku}</p>}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-rose-600">{g.units}</td>
                    <td className="px-3 py-2 text-right">{g.returns}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(g.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800">Each damaged return</p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((r) => {
                const final = r.damageStatus === 'Repaired' || r.damageStatus === 'Scrapped';
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-52">
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{r.productName}</p>
                      <p className="text-[11px] text-slate-500">
                        {r.returnNumber} · {dayLabel(r.returnDate)} · {r.customerName}
                        {r.branchName ? ` · ${r.branchName}` : ''}
                      </p>
                      {r.reason && <p className="text-[11px] text-slate-500">Reason: {r.reason}</p>}
                      {r.damageNote && <p className="text-[11px] text-slate-500">Note: {r.damageNote}</p>}
                    </div>
                    <div className="text-right">
                      <p className="whitespace-nowrap text-xs font-bold text-rose-600">
                        {r.quantity} {r.unit}
                      </p>
                      <p className={`whitespace-nowrap text-[11px] font-bold ${statusColour(r.damageStatus)}`}>{r.damageStatus === 'Held' ? 'Waiting' : r.damageStatus}</p>
                    </div>
                    {!final && (
                      <button type="button" onClick={() => setActing(r)} className={`${BTN_GHOST} whitespace-nowrap`}>
                        Mark as...
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {acting && (
        <DamageDialog
          row={acting}
          onClose={() => setActing(null)}
          onDone={(r) => {
            setActing(null);
            onChanged(r);
          }}
        />
      )}
    </div>
  );
};

const DAMAGE_OPTIONS: { id: 'Sent to supplier' | 'Repaired' | 'Scrapped'; title: string; hint: string }[] = [
  { id: 'Sent to supplier', title: 'Sent to supplier', hint: 'Sent back to the supplier. Stock does not change.' },
  { id: 'Repaired', title: 'Repaired', hint: 'Fixed and usable. It goes back into stock.' },
  { id: 'Scrapped', title: 'Scrapped', hint: 'Thrown away or written off. Stock does not change.' }
];

const DamageDialog: React.FC<{ row: ReturnRecord; onClose: () => void; onDone: (r: ReturnRecord) => void }> = ({ row, onClose, onDone }) => {
  const { scope } = useApiScope();
  const [status, setStatus] = useState<'Sent to supplier' | 'Repaired' | 'Scrapped' | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!status || busy) return;
    setBusy(true);
    setErr('');
    try {
      onDone(await returnApi.markDamaged(scope, row.id, { status, note: note.trim() || undefined }));
    } catch (e: any) {
      setErr(e?.message || 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Damaged product" subtitle={`${row.returnNumber} · ${row.customerName}`} onClose={onClose} size="md" actions={undefined}>
      <div className="space-y-4 p-4">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{row.productName}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {row.quantity} {row.unit} damaged{row.damageStatus === 'Sent to supplier' ? ' · currently with the supplier' : ''}
          </p>
        </div>
        <div className="space-y-2">
          {DAMAGE_OPTIONS.filter((o) => o.id !== row.damageStatus).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setStatus(o.id)}
              aria-pressed={status === o.id}
              className={`w-full cursor-pointer rounded-xl border-2 p-3 text-left ${status === o.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
            >
              <p className="text-sm font-bold text-slate-900 dark:text-white">{o.title}</p>
              <p className="text-[11px] text-slate-500">{o.hint}</p>
            </button>
          ))}
        </div>
        <div>
          <label className={LABEL} htmlFor="dmg-note">
            Note (optional)
          </label>
          <input id="dmg-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For example: supplier credit note due" className={INPUT} />
        </div>
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!status || busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
};

// Using a customer's return credit against one of their open invoices.
const UseCreditDialog: React.FC<{ group: CustomerGroup; balance: number; money: (n: number) => string; onClose: () => void; onDone: (applied: number) => void }> = ({ group, balance, money, onClose, onDone }) => {
  const { scope, branchParam } = useApiScope();
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);
  const [picked, setPicked] = useState<OpenInvoice | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    returnApi
      .openInvoices(scope, group.key, branchParam)
      .then((r) => live && setInvoices(r))
      .catch((e) => live && (setErr(e?.message || 'Could not load the invoices.'), setInvoices([])));
    return () => {
      live = false;
    };
  }, [scope, group.key, branchParam]);

  const choose = (i: OpenInvoice) => {
    setPicked(i);
    setAmount(String(Math.min(balance, i.balance)));
  };
  const amt = Number(amount);
  const valid = !!picked && Number.isFinite(amt) && amt > 0 && amt <= Math.min(balance, picked.balance) + 0.001;

  const submit = async () => {
    if (!picked || !valid || busy) return;
    setBusy(true);
    setErr('');
    try {
      await returnApi.applyCredit(scope, { customerKey: group.key, documentId: picked.id, amount: amt });
      onDone(amt);
    } catch (e: any) {
      setErr(e?.message || 'Could not apply the credit.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Use credit on an invoice" subtitle={`${group.name} · credit ${money(balance)}`} onClose={onClose} size="md" actions={undefined}>
      <div className="space-y-4 p-4">
        {invoices === null ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </p>
        ) : invoices.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800/60">This customer has no invoice with money owing. The credit stays for their next bill.</p>
        ) : (
          <div className="space-y-2">
            {invoices.map((i) => (
              <button key={i.id} type="button" onClick={() => choose(i)} aria-pressed={picked?.id === i.id} className={`w-full cursor-pointer rounded-xl border-2 p-3 text-left ${picked?.id === i.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{i.number}</p>
                <p className="text-[11px] text-slate-500">
                  {dayLabel(i.date)}
                  {i.dueDate ? ` · due ${dayLabel(i.dueDate)}` : ''} · {money(i.balance)} owing of {money(i.total)}
                </p>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div>
            <label className={LABEL} htmlFor="credit-amt">
              Amount of credit to use
            </label>
            <input id="credit-amt" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
            <p className="mt-1 text-[11px] text-slate-500">Up to {money(Math.min(balance, picked.balance))}.</p>
          </div>
        )}
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!valid || busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Use credit
          </button>
        </div>
      </div>
    </Modal>
  );
};
