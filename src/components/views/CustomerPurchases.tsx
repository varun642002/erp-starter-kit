import React, { useEffect, useState } from 'react';
import { Copy, Download, FileText, Loader2, Receipt, ShoppingBag, Tractor } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { fetchMessageQueue, type OverdueInvoiceItem } from '../../services/messageApi';
import { buildWhatsAppLink } from '../../utils/whatsapp';
import { downloadStatementPdf } from '../../utils/statementPdf';
import { useApiScope } from '../documents/ui';
import { quickSaleApi, type QuickSaleRecord } from '../../services/quickSaleApi';
import { machineSaleApi, NO_DATE, type MachineSale } from '../../services/machineSaleApi';
import { unitWord } from '../../utils/units';

const day = (ymd: string) => (!ymd || ymd === NO_DATE ? 'No date' : new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

// Everything one customer bought: the machines (with serial numbers) and every quick (counter) sale with its products.
export const CustomerPurchases: React.FC<{ customerId: string; customerName: string; phone?: string; currency: string }> = ({ customerId, customerName, phone, currency }) => {
  const { scope } = useApiScope();
  const { showToast, settings } = useERP();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dues, setDues] = useState<OverdueInvoiceItem[] | null>(null);
  const money = (n: number) => `${currency}${Math.round(n || 0).toLocaleString('en-IN')}`;
  const [machines, setMachines] = useState<MachineSale[] | null>(null);
  const [quick, setQuick] = useState<QuickSaleRecord[] | null>(null);
  const [machineNote, setMachineNote] = useState('');
  const [quickNote, setQuickNote] = useState('');

  useEffect(() => {
    let alive = true;
    setMachines(null);
    setQuick(null);
    setMachineNote('');
    setQuickNote('');
    setDues(null);
    fetchMessageQueue(scope)
      .then((q) => alive && setDues((q.overdueInvoices || []).filter((b) => b.customerId === customerId)))
      .catch(() => alive && setDues([]));
    machineSaleApi
      .list(scope, { customerId })
      .then((r) => alive && setMachines(r.filter((m) => m.status !== 'Cancelled')))
      .catch((e: any) => {
        if (!alive) return;
        setMachines([]);
        setMachineNote(e?.message || 'Could not load the machines.');
      });
    quickSaleApi
      .list(scope, { customerId, limit: 1000 })
      .then((r) => alive && setQuick(Array.isArray(r) ? r : []))
      .catch((e: any) => {
        if (!alive) return;
        setQuick([]);
        setQuickNote(e?.message || 'Could not load the quick sales.');
      });
    return () => {
      alive = false;
    };
  }, [customerId, scope]);

  const KIND = { invoice: 'Invoice', 'machine-sale': 'Machine sale', 'job-card': 'Job card' } as const;
  const dueTotal = (dues || []).reduce((s, b) => s + b.balance, 0);
  const statement = (() => {
    if (!dues || dues.length === 0) return '';
    const lines = dues.map((b, i) => `${i + 1}. ${KIND[b.source || 'invoice']} ${b.invoiceNumber}: ${money(b.balance)} due${b.dueDate ? ` (by ${b.dueDate})` : ''}${b.payUrl ? `\n   Pay now: ${b.payUrl}` : ''}`);
    return `Hello ${customerName}, this is Acme Agro Equipment. Your account statement:\n${lines.join('\n')}\nTotal due: ${money(dueTotal)}.\nKindly arrange the payment. Thank you.`;
  })();
  const link = statement ? buildWhatsAppLink(phone, statement) : null;
  const copyStatement = async () => {
    try {
      await navigator.clipboard.writeText(statement);
      showToast('Copied', 'The statement is ready to paste.', 'success');
    } catch {
      showToast('Could not copy', 'Select the text and copy it by hand.', 'error');
    }
  };

  const savePdf = async () => {
    if (!dues || dues.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    try {
      await downloadStatementPdf({
        companyName: (settings as any)?.companyName || 'Acme Agro Equipment',
        customerName,
        phone,
        lines: dues.map((b) => ({ kind: KIND[b.source || 'invoice'], number: b.invoiceNumber, dueDate: b.dueDate || null, daysOverdue: b.daysOverdue || 0, balance: b.balance, payUrl: b.payUrl || null })),
        fileName: `Statement-${customerName}`
      });
    } catch (e: any) {
      showToast('Could not make the PDF', e?.message || 'Please try again.', 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const quickTotal = (quick || []).reduce((s, r) => s + (r.grandTotal || 0), 0);
  const machineTotal = (machines || []).reduce((s, m) => s + (m.salePrice || 0), 0);

  return (
    <div className="space-y-3">
      {/* Money due and the statement */}
      <div>
        <h4 className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
          <FileText className="h-4 w-4 text-rose-600" /> Money due
          {dues && dues.length > 0 && <span className="font-normal text-slate-500">· {dues.length} bill{dues.length === 1 ? '' : 's'} · {money(dueTotal)}</span>}
        </h4>
        {dues === null ? (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what is due
          </p>
        ) : dues.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">Nothing is due from this customer.</p>
        ) : (
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900 dark:bg-rose-950/20">
            <ul className="divide-y divide-rose-100 text-xs dark:divide-rose-900/50">
              {dues.map((b) => (
                <li key={`${b.source}-${b.invoiceId}`} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 break-words text-slate-700 dark:text-slate-200">
                    {KIND[b.source || 'invoice']} <span className="font-mono">{b.invoiceNumber}</span>
                    {b.daysOverdue > 0 ? <span className="text-rose-600"> · {b.daysOverdue} days late</span> : null}
                  </span>
                  <span className="shrink-0 font-mono font-bold text-slate-900 dark:text-white">{money(b.balance)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-500">
                  Send statement on WhatsApp
                </a>
              ) : (
                <span className="text-[11px] text-slate-400">No valid mobile number to send to</span>
              )}
              <button type="button" onClick={copyStatement} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <Copy className="h-3.5 w-3.5" /> Copy statement
              </button>
              <button type="button" onClick={savePdf} disabled={pdfBusy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-[11px] font-bold text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Machines bought */}
      <div>
        <h4 className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
          <Tractor className="h-4 w-4 text-emerald-600" /> Machines bought
          {machines && machines.length > 0 && (
            <span className="font-normal text-slate-500">
              · {machines.length} · {money(machineTotal)}
            </span>
          )}
        </h4>
        {machines === null ? (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading machines
          </p>
        ) : machines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">{machineNote || 'No machine sales for this customer.'}</p>
        ) : (
          <ul className="space-y-2">
            {machines.map((m) => (
              <li key={m.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white">{m.machineName}{m.model && m.model !== m.machineName ? ` · ${m.model}` : ''}</p>
                    <p className="text-[11px] text-slate-500">
                      <span className="font-mono">{m.saleNumber}</span> · {day(m.status === 'Delivered' && m.deliveredDate ? m.deliveredDate : m.bookingDate)}
                      {m.isHistorical ? ' · old bill' : ''}
                    </p>
                    {(m.serialNumber || m.engineNumber) && (
                      <p className="font-mono text-[10px] text-slate-500">
                        {m.serialNumber ? `S/N ${m.serialNumber}` : ''}
                        {m.engineNumber ? `  Eng ${m.engineNumber}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{money(m.salePrice)}</p>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{m.status}</span>
                    {!m.isHistorical && m.balance > 0 && <p className="mt-0.5 text-[10px] font-semibold text-rose-600">{money(m.balance)} due</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick sale history */}
      <div>
        <h4 className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
          <ShoppingBag className="h-4 w-4 text-indigo-600" /> Quick sale history
          {quick && quick.length > 0 && (
            <span className="font-normal text-slate-500">
              · {quick.length} sale{quick.length === 1 ? '' : 's'} · {money(quickTotal)}
            </span>
          )}
        </h4>
        {quick === null ? (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading quick sales
          </p>
        ) : quick.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">{quickNote || 'No quick sales for this customer.'}</p>
        ) : (
          <ul className="space-y-2">
            {quick.map((r) => (
              <li key={r.id} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/50">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{r.saleNumber}</span>
                    {r.invoiceNumber && (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Receipt className="h-3 w-3" /> {r.invoiceNumber}
                      </span>
                    )}
                    <span className="text-slate-400">{when(r.createdAt)}</span>
                    {r.branchName && <span className="text-slate-400">· {r.branchName}</span>}
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {r.secondaryPaymentMethod && r.secondaryPaymentAmount > 0 ? `${r.paymentMethod} + ${r.secondaryPaymentMethod}` : r.paymentMethod} · {r.paymentStatus}
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{money(r.grandTotal)}</span>
                  </p>
                </div>
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {r.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5">
                          <span className="font-medium text-slate-900 dark:text-white">{it.productName}</span>
                          {it.sku && <span className="block font-mono text-[10px] text-slate-400">{it.sku}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {it.quantity}
                          {it.unit && <span className="ml-1 font-sans text-[10px] text-slate-500">{unitWord(it.unit, it.quantity)}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-500">{money(it.unitPrice)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{money(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.discount > 0 && <p className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-500 dark:border-slate-800">Discount: -{money(r.discount)}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
