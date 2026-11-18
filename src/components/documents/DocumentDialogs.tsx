import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, Copy, Download, Loader2, MessageCircle, Pencil, Printer, Repeat, Send, Wallet, ThumbsDown, ThumbsUp } from 'lucide-react';
import { downloadSheetsAsPdf } from '../../utils/pdfDownload';
import { useERP } from '../../context/ERPContext';
import { useCompanies } from '../../hooks/useCompanies';
import {
  PAYMENT_METHODS,
  documentApi,
  type DocumentDetail,
  type DocumentRow,
  type InvoiceKind,
  type PaymentMethod
} from '../../services/documentApi';
import { DocumentPrintPortal, DocumentSheet } from './DocumentSheet';
import { formatDate, todayIst } from './calc';
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, CARD, INPUT, LABEL, Modal, StatusBadge, useApiScope } from './ui';

export type DocAction =
  | 'view'
  | 'print'
  | 'download'
  | 'edit'
  | 'duplicate'
  | 'whatsapp'
  | 'convert'
  | 'cancel'
  | 'issue'
  | 'payment'
  | 'sent'
  | 'accepted'
  | 'rejected';

export function rowFlags(r: Pick<DocumentRow, 'docType' | 'storedStatus' | 'paidAmount' | 'balance'>, canEditIssued = false) {
  const invoice = r.docType === 'invoice';
  const s = r.storedStatus;
  return {
    // the Super Admin can also edit an invoice that was already issued or paid
    edit: invoice ? s === 'Draft' || (canEditIssued && (s === 'Issued' || s === 'Partially Paid' || s === 'Paid')) : s === 'Draft' || s === 'Sent',
    issue: invoice && s === 'Draft',
    pay: invoice && (s === 'Issued' || s === 'Partially Paid') && r.balance > 0,
    convert: !invoice && (s === 'Draft' || s === 'Sent' || s === 'Accepted'),
    cancel: invoice ? (s === 'Draft' || s === 'Issued') && r.paidAmount === 0 : s !== 'Cancelled' && s !== 'Converted',
    markSent: !invoice && s === 'Draft',
    accept: !invoice && (s === 'Draft' || s === 'Sent' || s === 'Rejected'),
    reject: !invoice && (s === 'Draft' || s === 'Sent' || s === 'Accepted')
  };
}

const moneyFor = (symbol: string) => (v: number) =>
  `${symbol}${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DialogError: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  ) : null;

// ---------- cancel / convert ----------

export const ConfirmDialog: React.FC<{
  kind: 'cancel' | 'convert';
  row: DocumentRow;
  onClose: () => void;
  onDone: (result: DocumentDetail, kind: 'cancel' | 'convert') => void;
}> = ({ kind, row, onClose, onDone }) => {
  const { scope, branchParam } = useApiScope();
  const { showToast, addAuditLog, refreshProducts } = useERP();
  const { getCompany } = useCompanies();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A quotation written without GST converts to an invoice without GST unless changed here.
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind>(row.invoiceKind === 'plain' ? 'plain' : 'tax');
  const invoice = row.docType === 'invoice';

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res =
        kind === 'convert'
          ? await documentApi.convert(scope, row.id, branchParam, invoiceKind)
          : await documentApi.cancel(scope, row.id, branchParam);
      addAuditLog(kind === 'convert' ? 'Converted quotation' : `Cancelled ${row.docType}`, 'Billing', `${row.docNumber} for ${row.customerName}`);
      showToast(
        kind === 'convert' ? 'Quotation converted' : 'Document cancelled',
        kind === 'convert' ? `${row.docNumber} is now draft invoice ${res.docNumber}` : `${row.docNumber} was cancelled`,
        'success'
      );
      // Cancelling an issued invoice returns its stock on the server.
      if (kind === 'cancel' && invoice) refreshProducts();
      onDone(res, kind);
    } catch (e: any) {
      setError(e.message);
      showToast(kind === 'convert' ? 'Could not convert' : 'Could not cancel', e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={kind === 'convert' ? 'Convert to invoice' : `Cancel ${row.docType}`} subtitle={row.docNumber} onClose={onClose} size="sm">
      <div className="space-y-4 p-5 text-xs text-slate-700 dark:text-slate-300">
        {kind === 'convert' ? (
          <div className="space-y-3">
            <p>
              A new draft invoice will be created for {row.customerName} with the same items, issued by {getCompany(row.companyId).displayName}. The
              quotation will be marked as Converted and can no longer be edited.
            </p>
            <div>
              <p className={LABEL}>Invoice type</p>
              <div role="radiogroup" aria-label="Invoice type" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {(
                  [
                    ['tax', 'Tax Invoice (GST)'],
                    ['plain', 'Invoice only (no GST)']
                  ] as [InvoiceKind, string][]
                ).map(([k, text]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={invoiceKind === k}
                    onClick={() => setInvoiceKind(k)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      invoiceKind === k ? 'bg-slate-800 text-white dark:bg-slate-700' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {invoiceKind === 'plain' && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">GST is removed: every line is converted at 0% and no tax is charged.</p>
              )}
              {invoiceKind === 'tax' && row.invoiceKind === 'plain' && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">This quotation has no GST, so its lines come across at 0%. Set the GST rates on the draft invoice.</p>
              )}
            </div>
          </div>
        ) : (
          <p>
            Cancel {row.docNumber} for {row.customerName}?{' '}
            {invoice && row.stockDeducted ? 'The stock deducted for this invoice will be returned to the warehouse. ' : ''}This cannot be undone.
          </p>
        )}
        <DialogError message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={BTN_GHOST}>
            Keep
          </button>
          <button onClick={confirm} disabled={busy} className={kind === 'cancel' ? BTN_DANGER : BTN_PRIMARY}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {kind === 'convert' ? 'Convert' : 'Yes, cancel'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------- issue ----------

export const IssueDialog: React.FC<{ row: DocumentRow; onClose: () => void; onDone: (result: DocumentDetail) => void }> = ({ row, onClose, onDone }) => {
  const { scope, branchParam } = useApiScope();
  const { warehouses, showToast, addAuditLog, refreshProducts } = useERP();
  const [deductStock, setDeductStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const branchWarehouses = warehouses.filter((w) => w.branchId === row.branchId);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await documentApi.issue(scope, row.id, { deductStock, warehouseId: deductStock && warehouseId ? warehouseId : undefined }, branchParam);
      addAuditLog('Issued invoice', 'Billing', `${row.docNumber} for ${row.customerName}`);
      showToast('Invoice issued', deductStock ? `${row.docNumber} issued and stock deducted` : `${row.docNumber} issued`, 'success');
      if (deductStock) refreshProducts();
      onDone(res);
    } catch (e: any) {
      setError(e.message);
      showToast('Could not issue invoice', e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Issue invoice" subtitle={row.docNumber} onClose={onClose} size="sm">
      <div className="space-y-4 p-5 text-xs">
        <p className="text-slate-700 dark:text-slate-300">Once issued the invoice can no longer be edited.</p>
        <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={deductStock} onChange={(e) => setDeductStock(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" />
          Deduct stock for product lines
        </label>
        {deductStock && (
          <div>
            <label className={LABEL}>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={INPUT}>
              <option value="">Auto (warehouse with most stock)</option>
              {branchWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <DialogError message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={BTN_GHOST}>
            Back
          </button>
          <button onClick={confirm} disabled={busy} className={BTN_PRIMARY}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Issue invoice
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------- payment ----------

export const PaymentDialog: React.FC<{ row: DocumentRow; onClose: () => void; onDone: (result: DocumentDetail) => void }> = ({ row, onClose, onDone }) => {
  const { scope, branchParam } = useApiScope();
  const { settings, showToast, addAuditLog } = useERP();
  const money = moneyFor(settings.currencySymbol || '₹');
  const [amount, setAmount] = useState(String(row.balance));
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [paidOn, setPaidOn] = useState(todayIst());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter an amount greater than 0');
    if (value > row.balance + 0.005) return setError(`Amount cannot exceed the balance of ${money(row.balance)}`);
    setBusy(true);
    setError('');
    try {
      const res = await documentApi.addPayment(scope, row.id, { amount: value, method, paidOn, reference: reference.trim() || undefined }, branchParam);
      addAuditLog('Invoice payment', 'Billing', `${row.docNumber}: ${money(value)} via ${method}`);
      showToast('Payment recorded', `${money(value)} received by ${method}`, 'success');
      onDone(res);
    } catch (e: any) {
      setError(e.message);
      showToast('Could not record payment', e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Record payment" subtitle={`${row.docNumber} - balance ${money(row.balance)}`} onClose={onClose} size="sm">
      <div className="space-y-3 p-5 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Amount</label>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={INPUT}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Paid on</label>
            <input type="date" value={paidOn} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} placeholder="UTR / cheque no." />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">The payment is also added to the branch cash book as a customer collection.</p>
        <DialogError message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={BTN_GHOST}>
            Cancel
          </button>
          <button onClick={confirm} disabled={busy} className={BTN_PRIMARY}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record payment
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------- preview / print ----------

export const PreviewModal: React.FC<{
  id: string;
  autoPrint: boolean;
  autoDownload?: boolean;
  reloadKey: number;
  onClose: () => void;
  onAction: (action: DocAction, doc: DocumentDetail) => void;
  onOpenLinked: (id: string, type: 'invoice' | 'quotation') => void;
}> = ({ id, autoPrint, autoDownload = false, reloadKey, onClose, onAction, onOpenLinked }) => {
  const { settings, branches, showToast } = useERP();
  const { scope, branchParam } = useApiScope();
  const { getCompany } = useCompanies();
  const money = moneyFor(settings.currencySymbol || '₹');
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState('');
  const printedRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const downloadedRef = useRef(false);
  const [downloading, setDownloading] = useState(false);

  // Saves the document as an A4 PDF file straight to the device.
  const download = async () => {
    if (!doc || !sheetRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSheetsAsPdf(sheetRef.current, doc.docNumber.replace(/[\/:*?"<>|]+/g, '-'));
    } catch (e: any) {
      showToast('Could not download', e?.message || 'The PDF could not be made. Try Print / PDF instead.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setError('');
    documentApi
      .get(scope, id, branchParam)
      .then((d) => alive && setDoc(d))
      .catch((e: any) => alive && setError(e.message || 'Could not load the document'));
    return () => {
      alive = false;
    };
  }, [scope, id, branchParam, reloadKey]);

  useEffect(() => {
    if (!autoPrint || !doc || printedRef.current) return;
    printedRef.current = true;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [autoPrint, doc]);

  // Opened from the Download button in the list: save the file as soon as the page has drawn.
  useEffect(() => {
    if (!autoDownload || !doc || downloadedRef.current) return;
    downloadedRef.current = true;
    const t = setTimeout(() => void download(), 700);
    return () => clearTimeout(t);
  }, [autoDownload, doc]);

  const flags = doc ? rowFlags(doc) : null;
  const branchName = doc ? branches.find((b) => b.id === doc.branchId)?.name : undefined;

  const actionBtn = (action: DocAction, label: string, Icon: React.ElementType, danger = false) => (
    <button key={action} onClick={() => doc && onAction(action, doc)} className={danger ? 'inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40' : BTN_GHOST}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <>
      <Modal
        title={doc ? doc.docNumber : 'Loading document'}
        subtitle={
          doc
            ? `${doc.docType === 'quotation' ? 'Quotation' : doc.invoiceKind === 'plain' ? 'Invoice' : 'Tax invoice'} for ${doc.customerName} - ${getCompany(doc.companyId).displayName}`
            : undefined
        }
        onClose={onClose}
        size="xl"
        actions={
          doc && (
            <>
              <StatusBadge status={doc.status} />
              <button onClick={download} disabled={downloading} className={BTN_PRIMARY}>
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
              </button>
              <button onClick={() => window.print()} className={BTN_GHOST}>
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
            </>
          )
        }
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-slate-700 dark:text-slate-300">{error}</p>
            <button onClick={onClose} className={BTN_GHOST}>
              Close
            </button>
          </div>
        ) : !doc || !flags ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {flags.edit && actionBtn('edit', 'Edit', Pencil)}
              {flags.issue && actionBtn('issue', 'Issue', Send)}
              {flags.markSent && actionBtn('sent', 'Mark as sent', Send)}
              {flags.accept && actionBtn('accepted', 'Accepted', ThumbsUp)}
              {flags.reject && actionBtn('rejected', 'Rejected', ThumbsDown)}
              {flags.convert && actionBtn('convert', 'Convert to invoice', Repeat)}
              {flags.pay && actionBtn('payment', 'Record payment', Wallet)}
              {actionBtn('whatsapp', 'WhatsApp', MessageCircle)}
              {actionBtn('duplicate', 'Duplicate', Copy)}
              {flags.cancel && actionBtn('cancel', 'Cancel', Ban, true)}
              {doc.convertedInvoiceId && (
                <button onClick={() => onOpenLinked(doc.convertedInvoiceId!, 'invoice')} className={BTN_GHOST}>
                  Open converted invoice
                </button>
              )}
              {doc.sourceQuotationId && (
                <button onClick={() => onOpenLinked(doc.sourceQuotationId!, 'quotation')} className={BTN_GHOST}>
                  Open source quotation
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Download PDF saves the full A4 page to your device. Print opens the print dialog.
            </p>

            <div className="overflow-x-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-950">
              <div ref={sheetRef} className="mx-auto w-fit shadow-lg">
                <DocumentSheet doc={doc} settings={settings} branchName={branchName} paper />
              </div>
            </div>

            {doc.docType === 'invoice' && doc.payments.length > 0 && (
              <div className={`${CARD} p-4 text-xs`}>
                <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Payments</h3>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {doc.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-1.5 text-slate-700 dark:text-slate-300">
                      <span>
                        {formatDate(p.paidOn)} <span className="text-slate-400">{p.method}</span>
                        {p.reference && <span className="ml-2 font-mono text-[11px] text-slate-400">{p.reference}</span>}
                      </span>
                      <span className="font-semibold">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
      {doc && <DocumentPrintPortal doc={doc} settings={settings} branchName={branchName} />}
    </>
  );
};
