import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Ban, Building2, Copy, Download, Eye, MoreVertical, FileText, Loader2, MessageCircle, Pencil, Plus, Printer, RefreshCw, Repeat, Search, Send, Trash2, Wallet } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { useCompanies } from '../../hooks/useCompanies';
import type { CompanyId } from '../../services/companyApi';
import {
  INVOICE_STATUSES,
  QUOTATION_STATUSES,
  documentApi,
  type DocType,
  type DocumentDetail,
  type DocumentRow,
  type DocumentSummary,
  type InvoiceKind
} from '../../services/documentApi';
import { buildWhatsAppLink, formatMessageAmount, formatMessageDate } from '../../utils/whatsapp';
import { DocumentBuilder } from '../documents/DocumentBuilder';
import { CompanyDetailsModal } from '../documents/CompanyDetailsModal';
import { ConfirmDialog, IssueDialog, PaymentDialog, PreviewModal, rowFlags, type DocAction } from '../documents/DocumentDialogs';
import { formatDate, todayIst } from '../documents/calc';
import { BTN_GHOST, BTN_PRIMARY, CARD, ICON_BTN, INPUT, Modal, StatusBadge, useApiScope } from '../documents/ui';

// Short tags keep the list compact; the full name is in the tooltip.
const COMPANY_TAG: Record<CompanyId, string> = { main: 'Main', second: 'Second' };

type DialogState = { kind: 'cancel' | 'convert' | 'issue' | 'payment' | 'delete'; row: DocumentRow } | null;
type BuilderState = { docType: DocType; invoiceKind?: InvoiceKind; existing?: DocumentDetail } | null;

const Stat: React.FC<{ label: string; value: string; hint?: string; tone?: 'default' | 'warn' | 'good' }> = ({ label, value, hint, tone = 'default' }) => (
  <div className={`${CARD} p-4`}>
    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
    <p
      className={`mt-1 text-lg font-bold ${
        tone === 'warn' ? 'text-rose-600 dark:text-rose-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
      }`}
    >
      {value}
    </p>
    {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
  </div>
);

// Small, quiet filter controls: they sit in one row and wrap on narrow screens.
// The financial year (April to March) we are in now, as the year it started in
const thisFinancialYear = () => {
  const t = new Date(Date.now() + 5.5 * 3600_000);
  return t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
};

const FILTER =
  'h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';


// The three-dot menu on every row: all the actions in one place. It floats over the page (so a scrolling table cannot cut
// it off), opens upward when there is no room below, and closes on a tap outside, Escape or scroll.
interface MenuItem {
  key: string;
  label: string;
  icon: React.ElementType;
  danger?: boolean;
  run: () => void;
}

const RowMenu: React.FC<{ items: MenuItem[]; label: string }> = ({ items, label }) => {
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos, close]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const need = items.length * 40 + 16;
    const up = window.innerHeight - r.bottom < need && r.top > need;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), up });
  };

  return (
    <>
      <button ref={btnRef} type="button" className={ICON_BTN} aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={close} />
            <div
              role="menu"
              style={{ top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, right: pos.right }}
              className="fixed z-[61] w-56 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 dark:border-slate-700 dark:bg-slate-900"
            >
              {items.map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      close();
                      it.run();
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold ${
                      it.danger
                        ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {it.label}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </>
  );
};

export const DocumentsView: React.FC = () => {
  const { settings, branches, selectedBranchId, showToast, addAuditLog, warranties, deleteWarranty, currentRole } = useERP();
  const { isSuperAdmin } = useAuth();
  // Only the Super Admin can delete an invoice that was already issued or paid.
  const canForceDelete = isSuperAdmin && currentRole === 'Super Admin';
  const { scope, branchParam, isOwner } = useApiScope();
  const { companies, getCompany } = useCompanies();
  const currency = settings.currencySymbol || '₹';
  const money = (n: number) => `${currency}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const [tab, setTab] = useState<DocType>('invoice');
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [companyFilter, setCompanyFilter] = useState<'all' | CompanyId>('all');
  const [subsidyFilter, setSubsidyFilter] = useState<'all' | 'only' | 'exclude'>('all');
  const [companyModal, setCompanyModal] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [builder, setBuilder] = useState<BuilderState>(null);
  const [preview, setPreview] = useState<{ id: string; autoPrint: boolean; autoDownload?: boolean } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const req = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        documentApi.list(scope, {
          type: tab,
          branchId: branchParam,
          companyId: companyFilter === 'all' ? undefined : companyFilter,
          status: statusFilter,
          subsidy: tab === 'invoice' && subsidyFilter !== 'all' ? subsidyFilter : undefined,
          q: debouncedSearch,
          from,
          to
        }),
        documentApi.summary(
          scope,
          tab,
          branchParam,
          companyFilter === 'all' ? undefined : companyFilter,
          tab === 'invoice' && subsidyFilter !== 'all' ? subsidyFilter : undefined,
          from || undefined,
          to || undefined
        )
      ]);
      if (req !== requestRef.current) return;
      setRows(list);
      setSummary(sum);
    } catch (e: any) {
      if (req !== requestRef.current) return;
      setError(e.message || 'Failed to load documents');
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, [scope, branchParam, tab, statusFilter, companyFilter, subsidyFilter, debouncedSearch, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    setPreviewKey((k) => k + 1);
  };

  const switchTab = (next: DocType) => {
    if (next === tab) return;
    setTab(next);
    setStatusFilter('All');
    setRows([]);
  };

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || id;
  const statuses = tab === 'invoice' ? INVOICE_STATUSES : QUOTATION_STATUSES;
  const today = todayIst();

  const shareWhatsApp = async (d: DocumentRow) => {
    let billLink = '';
    // An issued invoice goes to the customer's WhatsApp by itself when the business API is set up.
    if (d.docType === 'invoice' && ['Issued', 'Partially Paid', 'Paid'].includes(String(d.status))) {
      try {
        const r = await documentApi.sendBill(scope, d.id, branchParam);
        if (r.status === 'sent') {
          showToast('Bill sent', `${d.docNumber} was sent to ${d.customerName} on WhatsApp`, 'success');
          return;
        }
        if (r.url) billLink = r.url;
        if (r.status === 'failed') showToast('Automatic sending failed', r.detail, 'warning');
      } catch (e: any) {
        showToast('Could not send the bill', e.message, 'error');
      }
    }
    const profile = getCompany(d.companyId);
    const company = profile.legalName || profile.displayName;
    const total = formatMessageAmount(d.grandTotal, currency);
    const isInvoice = d.docType === 'invoice';
    const lines = [
      `Dear ${d.customerName},`,
      '',
      `${isInvoice ? 'Invoice' : 'Quotation'} ${d.docNumber} from ${company}.`,
      `Total: ${total}`,
      ...(billLink ? [`View your bill: ${billLink}`] : []),
      isInvoice ? `Due date: ${formatMessageDate(d.dueDate)}` : `Valid until: ${formatMessageDate(d.validUntil)}`,
      '',
      `Thank you,`,
      company
    ];
    const link = buildWhatsAppLink(d.customerPhone, lines.join('\n'));
    if (!link) {
      showToast('No WhatsApp number', 'Add a valid 10-digit mobile number for this customer first', 'warning');
      return;
    }
    window.open(link, '_blank', 'noopener');
  };

  const quickStatus = async (d: DocumentRow, status: 'Sent' | 'Accepted' | 'Rejected') => {
    try {
      await documentApi.setStatus(scope, d.id, status, branchParam);
      addAuditLog(`Quotation ${status.toLowerCase()}`, 'Billing', `${d.docNumber} for ${d.customerName}`);
      showToast('Quotation updated', `${d.docNumber} marked as ${status}`, 'success');
      refresh();
    } catch (e: any) {
      showToast('Could not update quotation', e.message, 'error');
    }
  };

  // Every action a row can take, in one list for the three-dot menu.
  const menuFor = (r: DocumentRow): MenuItem[] => {
    const f = rowFlags(r, canForceDelete);
    const items: MenuItem[] = [{ key: 'view', label: 'View', icon: Eye, run: () => act('view', r) }];
    if (f.edit) items.push({ key: 'edit', label: 'Edit', icon: Pencil, run: () => act('edit', r) });
    if (f.issue) items.push({ key: 'issue', label: 'Issue invoice', icon: Send, run: () => act('issue', r) });
    if (f.pay) items.push({ key: 'payment', label: 'Record payment', icon: Wallet, run: () => act('payment', r) });
    if (f.convert) items.push({ key: 'convert', label: 'Convert to invoice', icon: Repeat, run: () => act('convert', r) });
    items.push(
      { key: 'download', label: 'Download PDF', icon: Download, run: () => act('download', r) },
      { key: 'print', label: 'Print', icon: Printer, run: () => act('print', r) },
      { key: 'whatsapp', label: 'Share on WhatsApp', icon: MessageCircle, run: () => act('whatsapp', r) },
      { key: 'duplicate', label: 'Duplicate', icon: Copy, run: () => act('duplicate', r) }
    );
    if (f.cancel) items.push({ key: 'cancel', label: 'Cancel', icon: Ban, danger: true, run: () => act('cancel', r) });
    if (r.storedStatus === 'Draft' || r.storedStatus === 'Cancelled' || (r.docType === 'quotation' && r.storedStatus === 'Rejected') || (canForceDelete && r.docType === 'invoice')) {
      items.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, run: () => act('delete' as any, r) });
    }
    return items;
  };

  const act = async (action: DocAction, d: DocumentRow) => {
    switch (action) {
      case 'view':
        return setPreview({ id: d.id, autoPrint: false });
      case 'print':
        return setPreview({ id: d.id, autoPrint: true });
      case 'download':
        return setPreview({ id: d.id, autoPrint: false, autoDownload: true });
      case 'whatsapp':
        return shareWhatsApp(d);
      case 'edit':
        try {
          const detail = await documentApi.get(scope, d.id, branchParam);
          setPreview(null);
          setBuilder({ docType: d.docType, invoiceKind: d.invoiceKind, existing: detail });
        } catch (e: any) {
          showToast('Could not open document', e.message, 'error');
        }
        return;
      case 'duplicate':
        try {
          const copy = await documentApi.duplicate(scope, d.id, branchParam);
          addAuditLog(`Duplicated ${d.docType}`, 'Billing', `${d.docNumber} -> ${copy.docNumber}`);
          showToast('Draft created', `${copy.docNumber} is a copy of ${d.docNumber}`, 'success');
          setPreview(null);
          if (copy.docType !== tab) switchTab(copy.docType);
          refresh();
        } catch (e: any) {
          showToast('Could not duplicate', e.message, 'error');
        }
        return;
      case 'sent':
        return quickStatus(d, 'Sent');
      case 'accepted':
        return quickStatus(d, 'Accepted');
      case 'rejected':
        return quickStatus(d, 'Rejected');
      case 'convert':
      case 'cancel':
      case 'issue':
      case 'payment':
        return setDialog({ kind: action, row: d });
      case 'delete' as any:
        return setDialog({ kind: 'delete', row: d });
    }
  };

  const openLinked = (id: string, type: DocType) => {
    if (type !== tab) switchTab(type);
    setPreview({ id, autoPrint: false });
  };

  // what the four boxes cover: the year picked above, or everything
  const periodText = (() => {
    if (from === '1900-01-01' && to === '1900-01-01') return 'no date';
    const m = /^(\d{4})-04-01$/.exec(from);
    if (m && to === `${Number(m[1]) + 1}-03-31`) return `${m[1]}-${Number(m[1]) + 1}`;
    return from || to ? 'chosen dates' : 'all years';
  })();

  const summaryStats = useMemo(() => {
    if (!summary) return null;
    if (tab === 'invoice') {
      return [
        <Stat key="a" label="Invoiced" value={money(summary.invoiced)} hint={`${summary.total} invoices · ${periodText}`} />,
        <Stat key="b" label="Collected" value={money(summary.collected)} tone="good" />,
        <Stat key="c" label="Outstanding" value={money(summary.outstanding)} tone={summary.outstanding > 0 ? 'warn' : 'default'} />,
        <Stat
          key="d"
          label="Overdue"
          value={String(summary.overdueCount)}
          hint={summary.overdueCount ? money(summary.overdueAmount) : 'Nothing overdue'}
          tone={summary.overdueCount ? 'warn' : 'default'}
        />
      ];
    }
    return [
      <Stat key="a" label="Open quotations" value={money(summary.openValue)} hint="Draft, sent and accepted" />,
      <Stat key="b" label="Accepted" value={money(summary.acceptedValue)} tone="good" hint={`${summary.counts.Accepted || 0} quotations`} />,
      <Stat key="c" label="Awaiting reply" value={String(summary.counts.Sent || 0)} />,
      <Stat key="d" label="Expired" value={String(summary.counts.Expired || 0)} tone={summary.counts.Expired ? 'warn' : 'default'} />
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, tab, currency, periodText]);

  const label = tab === 'invoice' ? 'invoice' : 'quotation';

  return (
    <div className="space-y-6 pb-12">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Invoices and Quotations</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">GST documents numbered by financial year, with print, share and payment tracking</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} className={BTN_GHOST} aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isOwner && (
            <button onClick={() => setCompanyModal(true)} className={BTN_GHOST}>
              <Building2 className="h-3.5 w-3.5" /> Company details
            </button>
          )}
          <button onClick={() => setBuilder({ docType: 'quotation' })} className={BTN_GHOST}>
            <Plus className="h-3.5 w-3.5" /> New quotation
          </button>
          {/* One button: Tax Invoice (GST) or Invoice only (no GST) is chosen inside the form. */}
          <button onClick={() => setBuilder({ docType: 'invoice', invoiceKind: 'tax' })} className={BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" /> New invoice
          </button>
        </div>
      </div>

      <div className="no-print flex gap-1.5">
        {(['quotation', 'invoice'] as DocType[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === t
                ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {t === 'quotation' ? 'Quotations' : 'Invoices'}
          </button>
        ))}
      </div>

      {summaryStats && <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">{summaryStats}</div>}

      <div className="no-print flex flex-wrap items-center gap-2">
        <label htmlFor="doc-year" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          Year
        </label>
        <select
          value={from === '1900-01-01' && to === '1900-01-01' ? 'nodate' : (() => { const m = /^(\d{4})-04-01$/.exec(from); return m && to === `${Number(m[1]) + 1}-03-31` ? m[1] : from || to ? 'custom' : 'all'; })()}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'all') { setFrom(''); setTo(''); }
            else if (val === 'nodate') { setFrom('1900-01-01'); setTo('1900-01-01'); }
            else if (val !== 'custom') { setFrom(`${val}-04-01`); setTo(`${Number(val) + 1}-03-31`); }
          }}
          id="doc-year"
          className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none sm:h-8 sm:w-auto sm:max-w-[14rem] sm:text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          aria-label="Show one financial year"
        >
          <option value="all">All years</option>
          {(from || to) && !(from === '1900-01-01' && to === '1900-01-01') && !/^(\d{4})-04-01$/.test(from) && <option value="custom">Custom dates</option>}
          {Array.from({ length: Math.max(1, thisFinancialYear() - 2013 + 1) }, (_, i) => thisFinancialYear() - i).map((y) => (
            <option key={y} value={String(y)}>{`${y}-${y + 1}`}</option>
          ))}
          <option value="nodate">No date</option>
        </select>
        {from === '1900-01-01' && to === '1900-01-01' && <span className="text-[11px] text-slate-500">Old bills that had no date written on them</span>}
        {/^(\d{4})-04-01$/.test(from) && to === `${Number(from.slice(0, 4)) + 1}-03-31` && <span className="text-[11px] text-slate-500">Only {from.slice(0, 4)}-{Number(from.slice(0, 4)) + 1} is shown</span>}
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, customer or phone"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value as 'all' | CompanyId)}
          className={FILTER}
          aria-label="Company"
        >
          <option value="all">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
        {tab === 'invoice' && (
          <select
            value={subsidyFilter}
            onChange={(e) => setSubsidyFilter(e.target.value as 'all' | 'only' | 'exclude')}
            className={FILTER}
            aria-label="Subsidy invoices"
          >
            <option value="all">All invoices</option>
            <option value="only">Subsidy invoices only</option>
            <option value="exclude">Without subsidy</option>
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={FILTER} aria-label="Status">
          <option value="All">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
              {summary ? ` (${summary.counts[s] ?? 0})` : ''}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={FILTER} aria-label="From date" />
          <span>to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={FILTER} aria-label="To date" />
          {(from || to) && (
            <button
              onClick={() => {
                setFrom('');
                setTo('');
              }}
              className="font-semibold underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Phones: one card per document */}
      <div className="no-print space-y-3 md:hidden">
        {loading && rows.length === 0 ? (
          <div className={`${CARD} py-10 text-center text-xs text-slate-500`}>
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
            Loading {label}s
          </div>
        ) : error ? (
          <div className={`${CARD} py-10 text-center`}>
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{error}</p>
            <button onClick={load} className={`${BTN_PRIMARY} mt-3`}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className={`${CARD} py-10 text-center text-slate-400`}>
            <FileText className="mx-auto mb-2 h-10 w-10 stroke-1" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No {label}s found</p>
            <p className="mt-0.5 text-xs">Change the filters or create a new {label}.</p>
          </div>
        ) : (
          rows.map((r) => {
            const overdue = r.docType === 'invoice' && !!r.dueDate && r.dueDate < today && r.balance > 0;
            const settled = r.docType === 'invoice' && r.storedStatus !== 'Draft' && r.storedStatus !== 'Cancelled';
            return (
              <div key={r.id} onClick={() => act('view', r)} className={`${CARD} cursor-pointer p-3.5`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{r.docNumber}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {COMPANY_TAG[r.companyId] ?? getCompany(r.companyId).displayName} ·{' '}
                      {r.docType === 'quotation' ? 'Quote' : r.invoiceKind === 'plain' ? 'Invoice only' : 'Tax'}
                      {selectedBranchId === 'all' ? ` · ${branchName(r.branchId)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={r.status} />
                    <RowMenu items={menuFor(r)} label={r.docNumber} />
                  </div>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.customerName}</p>
                    <p className="text-[11px] text-slate-500">
                      {r.customerPhone || '-'} · {formatDate(r.docDate)}
                    </p>
                    {overdue && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">Overdue since {formatDate(r.dueDate)}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-extrabold text-slate-900 dark:text-white">{money(r.grandTotal)}</p>
                    {settled && (
                      <p className={`text-[11px] font-semibold ${r.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {r.balance > 0 ? `Due ${money(r.balance)}` : 'Settled'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={`no-print hidden overflow-hidden md:block ${CARD}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">{tab === 'invoice' ? 'Due' : 'Valid until'}</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">{tab === 'invoice' ? 'Paid / Balance' : 'GST'}</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                    Loading {label}s
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
                    <p className="font-semibold text-slate-700 dark:text-slate-300">{error}</p>
                    <button onClick={load} className={`${BTN_PRIMARY} mt-3`}>
                      Retry
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileText className="mx-auto mb-2 h-10 w-10 stroke-1 text-slate-300 dark:text-slate-600" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">No {label}s found</p>
                    <p className="mt-0.5 text-xs">Change the filters or create a new {label}.</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const f = rowFlags(r, canForceDelete);
                  const overdue = r.docType === 'invoice' && !!r.dueDate && r.dueDate < today && r.balance > 0;
                  return (
                    <tr key={r.id} onClick={() => act('view', r)} className="cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-slate-900 dark:text-white">{r.docNumber}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <span
                            title={getCompany(r.companyId).displayName}
                            className="inline-flex whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {COMPANY_TAG[r.companyId] ?? getCompany(r.companyId).displayName}
                          </span>
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              r.docType === 'quotation'
                                ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300'
                                : r.invoiceKind === 'plain'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                                  : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300'
                            }`}
                          >
                            {r.docType === 'quotation' ? (r.invoiceKind === 'plain' ? 'Quote, no GST' : 'Quote') : r.invoiceKind === 'plain' ? 'Invoice only' : 'Tax'}
                          </span>
                        </span>
                        {selectedBranchId === 'all' && <span className="block text-[10px] text-slate-400">{branchName(r.branchId)}</span>}
                        {r.sourceQuotationId && <span className="block text-[10px] text-indigo-600 dark:text-indigo-400">From quotation</span>}
                        {r.machineSaleNumber && (
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400">Machine sale {r.machineSaleNumber}</span>
                        )}
                        {r.isSubsidy && (
                          <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Subsidy{r.subsidyStatus ? `: ${r.subsidyStatus}` : ''}
                            {r.subsidyAmount ? ` ${money(r.subsidyAmount)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 dark:text-white">{r.customerName}</span>
                        <span className="block text-[11px] text-slate-400">{r.customerPhone || '-'}</span>
                      </td>
                      <td className="px-4 py-3">{formatDate(r.docDate)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const d = r.docType === 'invoice' ? r.dueDate : r.validUntil;
                          return overdue ? (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{formatDate(d)} (overdue)</span>
                          ) : (
                            formatDate(d)
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">{money(r.grandTotal)}</td>
                      <td className="px-4 py-3 text-right">
                        {r.docType === 'invoice' ? (
                          r.storedStatus === 'Draft' || r.storedStatus === 'Cancelled' ? (
                            <span className="text-slate-400">-</span>
                          ) : (
                            <>
                              <span>{money(r.paidAmount)}</span>
                              <span className={`block text-[11px] ${r.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {r.balance > 0 ? `Due ${money(r.balance)}` : 'Settled'}
                              </span>
                            </>
                          )
                        ) : (
                          <span>{money(r.cgst + r.sgst + r.igst)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <RowMenu items={menuFor(r)} label={r.docNumber} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {builder && (
        <DocumentBuilder
          docType={builder.docType}
          initialKind={builder.invoiceKind}
          existing={builder.existing}
          onClose={() => setBuilder(null)}
          onSaved={(doc) => {
            setBuilder(null);
            if (doc.docType !== tab) switchTab(doc.docType);
            setPreview({ id: doc.id, autoPrint: false });
            refresh();
          }}
        />
      )}

      {companyModal && <CompanyDetailsModal onClose={() => setCompanyModal(false)} />}

      {preview && (
        <PreviewModal
          key={preview.id}
          id={preview.id}
          autoPrint={preview.autoPrint}
          autoDownload={preview.autoDownload}
          reloadKey={previewKey}
          onClose={() => setPreview(null)}
          onAction={act}
          onOpenLinked={openLinked}
        />
      )}

      {dialog && (dialog.kind === 'cancel' || dialog.kind === 'convert') && (
        <ConfirmDialog
          kind={dialog.kind}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={(res, kind) => {
            setDialog(null);
            if (kind === 'convert') {
              setTab('invoice');
              setStatusFilter('All');
              setPreview({ id: res.id, autoPrint: false });
            }
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal title={`Delete ${dialog.row.docType}`} subtitle={dialog.row.docNumber} onClose={() => setDialog(null)} size="sm">
          <div className="space-y-4 p-5 text-xs text-slate-700 dark:text-slate-300">
            {dialog.row.docType === 'invoice' && dialog.row.storedStatus !== 'Draft' && dialog.row.storedStatus !== 'Cancelled' && (
              <p className="rounded-lg bg-rose-50 p-2.5 font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                This invoice was already issued
                {dialog.row.paidAmount > 0 ? ` and ${dialog.row.paidAmount.toLocaleString('en-IN')} has been received on it` : ''}. Deleting it
                removes its payments and the cash book entries they made, and puts back any stock that was taken off for it.
              </p>
            )}
            <p>
              Delete <strong>{dialog.row.docNumber}</strong> for {dialog.row.customerName}? This cannot be undone.
              {dialog.row.docType === 'invoice' &&
                warranties.some((w) => w.invoiceId === dialog.row.id || (w.invoiceNumber && w.invoiceNumber === dialog.row.docNumber))
                ? ' The warranty registered against this invoice is deleted with it.'
                : ''}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(null)} className={BTN_GHOST}>
                Keep
              </button>
              <button
                onClick={async () => {
                  const row = dialog.row;
                  try {
                    await documentApi.remove(scope, row.id, branchParam, row.docType === 'invoice' && row.storedStatus !== 'Draft' && row.storedStatus !== 'Cancelled');
                    // the warranties of this invoice go with it
                    warranties
                      .filter((w) => w.invoiceId === row.id || (w.invoiceNumber && w.invoiceNumber === row.docNumber))
                      .forEach((w) => deleteWarranty(w.id));
                    addAuditLog('Deleted Document', 'Billing', `${row.docType} ${row.docNumber} for ${row.customerName} was deleted (${row.storedStatus}${row.paidAmount > 0 ? `, ${row.paidAmount} received` : ''}).`, { severity: 'warning', entityType: 'Invoice', entityId: row.id });
                    showToast('Deleted', `${row.docNumber} was deleted`, 'info');
                    setDialog(null);
                    refresh();
                  } catch (e: any) {
                    showToast('Could not delete', e.message || 'Request failed', 'error');
                    setDialog(null);
                  }
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500"
              >
                Yes, delete
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'issue' && (
        <IssueDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'payment' && (
        <PaymentDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
    </div>
  );
};
