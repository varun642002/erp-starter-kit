import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, MapPin, Pencil, Phone, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { useApiScope } from '../documents/ui';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { ProductSearchSelect } from '../common/ProductSearchSelect';
import { deleteFirestoreDoc, saveFirestoreDoc } from '../../lib/firestoreService';
import { quickSaleApi, type QuickSaleRecord } from '../../services/quickSaleApi';
import { identifyCustomerByPhone } from '../../services/api';
import { defaultSaleUnit, unitOptions, unitWord } from '../../utils/units';

type Period = 'today' | '7d' | '30d' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All' }
];

const shopDate = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const FIELD =
  'h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
// The calendar day (India time) of a timestamp, as YYYY-MM-DD.
const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-base text-slate-900 focus:border-blue-500 focus:outline-none sm:py-1.5 sm:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white';

interface EditLine {
  key: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  hsnCode: string | null;
  serialNumber: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
}

export const QuickSaleHistory: React.FC = () => {
  const { currentRole, branches, showToast, addAuditLog, refreshProducts, settings, products } = useERP();
  const { isSuperAdmin } = useAuth();
  const { scope, isOwner, branchParam } = useApiScope();
  const canManage = isSuperAdmin && currentRole === 'Super Admin';
  const money = (n: number) => `${settings.currencySymbol || '₹'}${Math.round(n || 0).toLocaleString('en-IN')}`;

  const [period, setPeriod] = useState<Period>('7d');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<QuickSaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [editing, setEditing] = useState<QuickSaleRecord | null>(null);
  const [saleDate, setSaleDate] = useState('');
  const [deleting, setDeleting] = useState<QuickSaleRecord | null>(null);
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

  const range = useMemo(() => {
    if (period === 'today') return { from: shopDate(0), to: shopDate(0) };
    if (period === '7d') return { from: shopDate(6), to: shopDate(0) };
    if (period === '30d') return { from: shopDate(29), to: shopDate(0) };
    return { from: undefined, to: undefined };
  }, [period]);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }
      try {
        const data = await quickSaleApi.list(scope, { branchId: branchParam, q: debounced, from: range.from, to: range.to, limit: 500 });
        if (!alive.current) return;
        setRows(Array.isArray(data) ? data : []);
        setUpdatedAt(new Date());
        setError('');
      } catch (e: any) {
        if (alive.current && !silent) setError(e?.message || 'Could not load the sales.');
      } finally {
        if (alive.current && !silent) setLoading(false);
      }
    },
    [scope, branchParam, debounced, range.from, range.to]
  );

  useEffect(() => {
    load(false);
  }, [load]);
  useLiveRefresh(() => load(true), 30_000);

  const total = rows.reduce((s, r) => s + (r.grandTotal || 0), 0);

  // ---- delete -----------------------------------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setDialogError('');
    try {
      const res = await quickSaleApi.remove(scope, deleting.id);
      // The screens that read sales and invoices from the shared store drop them too.
      deleteFirestoreDoc('sales', deleting.id);
      for (const invId of res.invoiceIds || []) deleteFirestoreDoc('invoices', invId);
      addAuditLog('Deleted Quick Sale', 'Quick Sale', `Sale ${deleting.saleNumber} for ${deleting.customerName} (${money(deleting.grandTotal)}) was deleted and its stock returned.`, {
        severity: 'warning',
        entityType: 'Sale',
        entityId: deleting.id
      });
      showToast('Sale deleted', `${deleting.saleNumber} was removed and its stock returned.`, 'success');
      setDeleting(null);
      setRows((prev) => prev.filter((r) => r.id !== deleting.id));
      refreshProducts();
    } catch (e: any) {
      setDialogError(e?.message || 'Could not delete the sale.');
    } finally {
      setBusy(false);
    }
  };

  // ---- edit -------------------------------------------------------------------------------------------------
  const [lines, setLines] = useState<EditLine[]>([]);
  const [custName, setCustName] = useState('');
  const [payment, setPayment] = useState('Cash');
  // Secondary payment: part of the bill paid another way. The first payment is the total minus this.
  const [payment2, setPayment2] = useState('');
  const [payment2Amount, setPayment2Amount] = useState('');
  const [overallDiscount, setOverallDiscount] = useState('0');
  // Pick the right customer for a sale (for example an old walk-in sale) by their mobile number.
  const [pickedCustomer, setPickedCustomer] = useState<{ id: string; name: string; phone: string; city?: string } | null>(null);
  const [lookup, setLookup] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [matches, setMatches] = useState<{ id: string; name: string; phone: string; city?: string }[]>([]);
  const [lookupNote, setLookupNote] = useState('');

  const findCustomer = async () => {
    const digits = lookup.replace(/\D/g, '');
    if (digits.length < 5) {
      setLookupNote('Type at least 5 digits of the mobile number.');
      return;
    }
    setLookupBusy(true);
    setLookupNote('');
    try {
      const found = await identifyCustomerByPhone(digits);
      const list = (Array.isArray(found) ? found : []).map((c: any) => ({ id: c.id, name: c.companyName || c.name, phone: c.phone, city: c.city }));
      setMatches(list);
      setLookupNote(list.length ? '' : 'No customer has this number yet. Add the customer in Customers first.');
    } catch (e: any) {
      setLookupNote(e?.message || 'Could not search.');
    } finally {
      setLookupBusy(false);
    }
  };

  const openEdit = (r: QuickSaleRecord) => {
    setEditing(r);
    setDialogError('');
    setCustName(r.customerName);
    setPayment(r.paymentMethod || 'Cash');
    setPayment2(r.secondaryPaymentMethod || '');
    setPayment2Amount(r.secondaryPaymentMethod ? String(r.secondaryPaymentAmount || '') : '');
    setSaleDate(istDay(r.createdAt));
    setOverallDiscount(String(r.discount || 0));
    setPickedCustomer(null);
    setLookup('');
    setMatches([]);
    setLookupNote('');
    setLines(
      r.items.map((it) => ({
        key: `l-${it.id}`,
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        hsnCode: it.hsnCode,
        serialNumber: it.serialNumber,
        unit: it.unit,
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
        discount: String(it.discount || 0)
      }))
    );
  };

  // Changing a line's unit (Piece to Box) puts the price of one of that unit in the box.
  const changeLineUnit = (line: EditLine, unit: string) => {
    const prod = products.find((p) => p.id === line.productId);
    const opt = unitOptions(prod).find((o) => o.unit === unit);
    if (!prod || !opt) return;
    patchLine(line.key, { unit: opt.unit, unitPrice: String(Math.round(prod.sellingPrice * opt.factor * 100) / 100) });
  };

  const patchLine = (key: string, change: Partial<EditLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const computed = useMemo(() => {
    const lineTotals = lines.map((l) => Math.max(0, Number(l.quantity) * Number(l.unitPrice) - Number(l.discount || 0)) || 0);
    const subtotal = lineTotals.reduce((s, n) => s + n, 0);
    const grand = Math.max(0, Math.round(subtotal - (Number(overallDiscount) || 0)));
    return { lineTotals, subtotal, grand };
  }, [lines, overallDiscount]);

  const problem = useMemo(() => {
    if (!custName.trim()) return 'Customer name cannot be empty.';
    if (lines.length === 0) return 'A sale needs at least one product.';
    for (const l of lines) {
      const q = Number(l.quantity);
      if (!Number.isInteger(q) || q <= 0) return `${l.productName}: quantity must be a whole number above 0.`;
      if (!(Number(l.unitPrice) >= 0)) return `${l.productName}: enter a valid price.`;
      if (!(Number(l.discount || 0) >= 0)) return `${l.productName}: discount cannot be negative.`;
    }
    if (!(Number(overallDiscount || 0) >= 0)) return 'Discount cannot be negative.';
    if (payment2) {
      if (payment2 === payment) return 'The secondary payment must be a different method from the first.';
      const a = Number(payment2Amount);
      if (!(a > 0) || a >= computed.grand) return `The secondary payment must be more than 0 and less than the bill total (${money(computed.grand)}).`;
    }
    return '';
  }, [custName, lines, overallDiscount, payment, payment2, payment2Amount, computed.grand]);

  const saveEdit = async () => {
    if (!editing || busy || problem) return;
    setBusy(true);
    setDialogError('');
    try {
      const saved = await quickSaleApi.update(scope, editing.id, {
        customerName: custName.trim(),
        customerId: pickedCustomer?.id,
        paymentMethod: payment,
        secondaryPaymentMethod: payment2 || '',
        secondaryPaymentAmount: payment2 ? Number(payment2Amount) : 0,
        saleDate: saleDate || undefined,
        discount: Number(overallDiscount) || 0,
        items: lines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          sku: l.sku,
          serialNumber: l.serialNumber,
          hsnCode: l.hsnCode,
          unit: l.unit,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount || 0)
        }))
      });

      // Keep the shared copies the dashboards read in line with the corrected sale.
      const savedDay = istDay(saved.createdAt);
      saveFirestoreDoc('sales', saved.id, {
        createdAt: savedDay,
        customerName: saved.customerName,
        subtotal: saved.subtotal,
        discount: saved.discount,
        gst: saved.gst,
        grandTotal: saved.grandTotal,
        paymentMethod: saved.paymentMethod,
        items: saved.items.map((it) => ({
          id: `si-${it.id}`,
          saleId: saved.id,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discount: it.discount,
          gst: it.gst,
          lineTotal: it.lineTotal,
          hsnCode: it.hsnCode
        }))
      });
      if (saved.invoiceId) {
        saveFirestoreDoc('invoices', saved.invoiceId, {
          invoiceDate: savedDay,
          dueDate: savedDay,
          customerName: saved.customerName,
          subtotal: saved.subtotal,
          totalDiscount: saved.discount,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          taxAmount: 0,
          grandTotal: saved.grandTotal,
          paidAmount: saved.grandTotal,
          balanceAmount: 0,
          paymentMethod: saved.paymentMethod,
          items: saved.items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            unit: it.unit || 'Nos',
            quantity: it.quantity,
            rate: it.unitPrice,
            discountPercent: it.discount && it.quantity * it.unitPrice ? Math.round((it.discount / (it.quantity * it.unitPrice)) * 100) : 0,
            taxRate: 0,
            taxAmount: 0,
            totalAmount: it.lineTotal,
            hsnCode: it.hsnCode
          }))
        });
      }
      addAuditLog('Edited Quick Sale', 'Quick Sale', `Sale ${saved.saleNumber} for ${saved.customerName} was corrected (now ${money(saved.grandTotal)}).`, {
        severity: 'info',
        entityType: 'Sale',
        entityId: saved.id
      });
      showToast('Sale updated', `${saved.saleNumber} was saved and stock adjusted.`, 'success');
      setEditing(null);
      setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      refreshProducts();
    } catch (e: any) {
      setDialogError(e?.message || 'Could not save the changes.');
    } finally {
      setBusy(false);
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, mobile number, sale no or product"
            aria-label="Search sales"
            className={`${FIELD} w-full pl-8 pr-3`}
          />
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                period === p.id ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live{updatedAt ? ` · ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <strong className="text-slate-800 dark:text-slate-200">{rows.length}</strong> sale{rows.length === 1 ? '' : 's'} ·{' '}
        <strong className="text-slate-800 dark:text-slate-200">{money(total)}</strong>
        {!isOwner && <span> · your branch</span>}
        {!canManage && <span className="text-slate-400"> · view only</span>}
      </p>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <span>{error}</span>
          <button type="button" onClick={() => load(false)} className="cursor-pointer font-bold underline">
            Retry
          </button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-10 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sales...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">
          No quick sales found for this selection.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{r.saleNumber}</span>
                    {r.invoiceNumber && (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Receipt className="h-3 w-3" /> {r.invoiceNumber}
                      </span>
                    )}
                    <span className="text-slate-400">{when(r.createdAt)}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {r.branchName || r.branchId}
                    {r.createdBy ? ` · by ${r.createdBy}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {r.secondaryPaymentMethod && r.secondaryPaymentAmount > 0
                      ? `${r.paymentMethod} ${money(r.grandTotal - r.secondaryPaymentAmount)} + ${r.secondaryPaymentMethod} ${money(r.secondaryPaymentAmount)}`
                      : r.paymentMethod}{' '}
                    · {r.paymentStatus}
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{money(r.grandTotal)}</span>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        title="Edit this sale"
                        aria-label="Edit sale"
                        className="cursor-pointer rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDialogError('');
                          setDeleting(r);
                        }}
                        title="Delete this sale"
                        aria-label="Delete sale"
                        className="cursor-pointer rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-4 px-4 py-3 md:grid-cols-[16rem_1fr]">
                {/* Customer details */}
                <div className="space-y-1 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Customer</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{r.customerName}</p>
                  {r.customerPhone ? (
                    <p className="flex items-center gap-1.5 font-mono text-slate-700 dark:text-slate-300">
                      <Phone className="h-3 w-3 text-slate-400" /> {r.customerPhone}
                      {r.customerAlternatePhone ? <span className="text-slate-400"> / {r.customerAlternatePhone}</span> : null}
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 text-slate-400">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{r.customerId ? 'No mobile number on this customer' : 'No customer was attached to this sale'}</span>
                    </p>
                  )}
                  {(r.customerAddress || r.customerCity) && (
                    <p className="flex items-start gap-1.5 text-slate-500">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                      <span>{[r.customerAddress, r.customerCity].filter(Boolean).join(', ')}</span>
                    </p>
                  )}
                  {r.customerCode && <p className="font-mono text-[10px] text-slate-400">{r.customerCode}</p>}
                </div>

                {/* Products bought */}
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase text-slate-400">
                        <th className="pb-1 pr-3"><span className="sr-only">Product</span></th>
                        <th className="pb-1 pr-3 text-right font-semibold">Qty</th>
                        <th className="pb-1 pr-3 text-right font-semibold">Price</th>
                        <th className="pb-1 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {r.items.map((it) => (
                        <tr key={it.id}>
                          <td className="py-1.5 pr-3">
                            <span className="font-medium text-slate-900 dark:text-white">{it.productName}</span>
                            {it.sku && <span className="block font-mono text-[10px] text-slate-400">{it.sku}</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {it.quantity}
                            {it.unit && <span className="ml-1 font-sans text-[10px] text-slate-500">{unitWord(it.unit, it.quantity)}</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono">{money(it.unitPrice)}</td>
                          <td className="py-1.5 text-right font-mono font-semibold">{money(it.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.discount > 0 && <p className="mt-1 text-right text-[11px] text-slate-500">Discount: -{money(r.discount)}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Edit dialog (Super Admin) */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:p-4">
          <div className="flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Edit sale {editing.saleNumber}</h2>
                <p className="text-xs text-slate-500">
                  Stock follows your changes. {editing.customerPhone ? `Mobile ${editing.customerPhone} is changed in Customers.` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
                  Customer name
                  <input value={custName} onChange={(e) => setCustName(e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Sale date
                  <input
                    type="date"
                    value={saleDate}
                    max={istDay(new Date().toISOString())}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Payment
                  <select value={payment} onChange={(e) => setPayment(e.target.value)} className={`${INPUT} mt-1`}>
                    {['Cash', 'UPI', 'Bank Transfer'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3 sm:col-span-4">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Secondary payment
                    <select value={payment2} onChange={(e) => setPayment2(e.target.value)} className={`${INPUT} mt-1`}>
                      <option value="">None</option>
                      {['Cash', 'UPI', 'Bank Transfer'].filter((m) => m !== payment).map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  {payment2 && (
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Amount paid by {payment2}
                      <input type="number" min="1" step="any" value={payment2Amount} onChange={(e) => setPayment2Amount(e.target.value)} className={`${INPUT} mt-1 text-right font-mono`} />
                    </label>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Customer on this sale:{' '}
                  <span className="text-slate-900 dark:text-white">
                    {pickedCustomer ? `${pickedCustomer.name} · ${pickedCustomer.phone}` : `${editing.customerName}${editing.customerPhone ? ` · ${editing.customerPhone}` : ' · no mobile number'}`}
                  </span>
                </p>
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={lookup}
                    onChange={(e) => setLookup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        findCustomer();
                      }
                    }}
                    inputMode="numeric"
                    placeholder="Find the customer by mobile number"
                    className={`${INPUT} flex-1 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={findCustomer}
                    disabled={lookupBusy}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-3 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-700"
                  >
                    {lookupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Find
                  </button>
                </div>
                {lookupNote && <p className="mt-1 text-[11px] text-amber-600">{lookupNote}</p>}
                {matches.length > 0 && (
                  <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPickedCustomer(m);
                            setCustName(m.name);
                            setMatches([]);
                            setLookupNote('');
                          }}
                          className="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <span className="font-semibold text-slate-900 dark:text-white">{m.name}</span>
                          <span className="font-mono text-slate-500">
                            {m.phone}
                            {m.city ? ` · ${m.city}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={l.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/30">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        {i + 1}. {l.productName}
                        {l.sku && <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{l.sku}</span>}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        aria-label="Remove product"
                        className="cursor-pointer rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block text-[10px] font-semibold text-slate-500">
                        Qty
                        <input type="number" min="1" step="1" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} className={`${INPUT} mt-0.5 text-right font-mono`} />
                      </label>
                      <label className="block text-[10px] font-semibold text-slate-500">
                        Unit
                        <select
                          value={l.unit || ''}
                          onChange={(e) => changeLineUnit(l, e.target.value)}
                          disabled={unitOptions(products.find((p) => p.id === l.productId)).length < 2}
                          className={`${INPUT} mt-0.5 disabled:opacity-70`}
                        >
                          {(() => {
                            const opts = unitOptions(products.find((p) => p.id === l.productId));
                            const shown = l.unit && !opts.some((o) => o.unit === l.unit) ? [{ unit: l.unit, factor: 1 }, ...opts] : opts;
                            return shown.map((o) => (
                              <option key={o.unit} value={o.unit}>
                                {o.unit === 'Nos' ? 'Piece' : o.unit}
                                {o.factor > 1 ? ` (${o.factor})` : ''}
                              </option>
                            ));
                          })()}
                        </select>
                      </label>
                      <label className="block text-[10px] font-semibold text-slate-500">
                        Price
                        <input type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => patchLine(l.key, { unitPrice: e.target.value })} className={`${INPUT} mt-0.5 text-right font-mono`} />
                      </label>
                      <label className="block text-[10px] font-semibold text-slate-500">
                        Discount
                        <input type="number" min="0" step="any" value={l.discount} onChange={(e) => patchLine(l.key, { discount: e.target.value })} className={`${INPUT} mt-0.5 text-right font-mono`} />
                      </label>
                    </div>
                    <p className="mt-1 text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">{money(computed.lineTotals[i] || 0)}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <Plus className="h-3 w-3" /> Add another product
                </p>
                <ProductSearchSelect
                  value=""
                  onChange={(p) =>
                    setLines((prev) => [
                      ...prev,
                      {
                        key: `n-${Date.now()}-${prev.length}`,
                        productId: p.id,
                        productName: p.name,
                        sku: p.sku,
                        hsnCode: p.hsnCode || null,
                        serialNumber: null,
                        unit: defaultSaleUnit(p).unit,
                        quantity: '1',
                        unitPrice: String(Math.round((p.sellingPrice || 0) * defaultSaleUnit(p).factor * 100) / 100),
                        discount: '0'
                      }
                    ])
                  }
                  placeholder="Search a product to add to this sale"
                />
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Overall discount
                  <input type="number" min="0" step="any" value={overallDiscount} onChange={(e) => setOverallDiscount(e.target.value)} className={`${INPUT} mt-1 w-32 text-right font-mono`} />
                </label>
                <div className="text-right text-xs text-slate-500">
                  Subtotal {money(computed.subtotal)}
                  <p className="font-mono text-base font-bold text-slate-900 dark:text-white">Total {money(computed.grand)}</p>
                </div>
              </div>

              {(problem || dialogError) && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {dialogError || problem}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy || !!problem}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation (Super Admin) */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Delete sale {deleting.saleNumber}?</h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {deleting.customerName} · {money(deleting.grandTotal)}. The sale and its invoice{deleting.invoiceNumber ? ` (${deleting.invoiceNumber})` : ''} are removed, and the products go back into stock. This cannot be undone.
            </p>
            {dialogError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {dialogError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Delete sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
