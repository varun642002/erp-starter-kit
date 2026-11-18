import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { CustomerPhoneLookup } from '../common/CustomerPhoneLookup';
import { BulkMarketing } from './BulkMarketing';
import { GroupGreeting } from './GroupGreeting';
import { DailyReportPanel } from './DailyReportPanel';
import { Customer } from '../../types/erp';
import {
  fetchAutoSendStatus,
  fetchMessageLog,
  fetchMessageQueue,
  fetchReminderStatus,
  sendPaymentReminders,
  type ReminderStatus,
  type AutoSendStatus,
  postMessageLog,
  type MessageKind,
  type MessageLogEntry,
  type MessageQueue
} from '../../services/messageApi';
import {
  CUSTOM_TEMPLATES,
  buildWhatsAppLink,
  formatMessageAmount,
  formatMessageDate,
  jobReadyMessage,
  paymentReminderMessage,
  pickValidPhone,
  warrantyExpiryMessage,
  type MessageLanguage
} from '../../utils/whatsapp';

type TabId = 'payment' | 'warranty' | 'jobs' | 'custom' | 'bulk' | 'daily' | 'history';

interface QueueRow {
  key: string;
  kind: MessageKind;
  source?: 'invoice' | 'machine-sale' | 'job-card';
  refType: string;
  refId: string;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  phone: string | null; // normalized, null when unusable
  rawPhone: string | null;
  title: string;
  details: string[];
  badge?: { text: string; tone: 'red' | 'amber' | 'green' };
  lastMessagedAt: string | null;
  body: string;
}

const KIND_LABELS: Record<MessageKind, string> = {
  'payment-reminder': 'Payment reminder',
  'warranty-expiry': 'Warranty expiry',
  'job-ready': 'Job ready',
  invoice: 'Invoice',
  custom: 'Custom',
  marketing: 'Marketing',
  'thank-you': 'Thank you'
};

const TONE_CLASS = {
  red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
};

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500';
const cardCls = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function recentTag(iso: string | null): string | null {
  const d = daysAgo(iso);
  if (d === null || d > 7) return null;
  return d === 0 ? 'Messaged today' : `Messaged ${d}d ago`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const MessagesView: React.FC = () => {
  const { currentRole, selectedBranchId, settings, showToast, addAuditLog, customers } = useERP();
  const { userProfile, assignedBranchId } = useAuth();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const scope = useMemo(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  const branchQuery = isOwner ? selectedBranchId : undefined;
  const sentBy = userProfile?.displayName || userProfile?.email || undefined;

  const company = settings.companyName || 'our shop';
  const currency = settings.currencySymbol || 'Rs.';

  const [tab, setTab] = useState<TabId>('payment');
  const [language, setLanguage] = useState<MessageLanguage>('en');

  const [queue, setQueue] = useState<MessageQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [history, setHistory] = useState<MessageLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | MessageKind>('all');

  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      setQueue(await fetchMessageQueue(scope, branchQuery));
    } catch (e: any) {
      setQueueError(e.message || 'Failed to load the message queue.');
    } finally {
      setQueueLoading(false);
    }
  }, [scope, branchQuery]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(
        await fetchMessageLog(scope, {
          branchId: branchQuery,
          kind: kindFilter === 'all' ? undefined : kindFilter,
          limit: 100
        })
      );
    } catch (e: any) {
      setHistoryError(e.message || 'Failed to load message history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [scope, branchQuery, kindFilter]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const rows = useMemo(() => {
    const base = { language, company, currencySymbol: currency };
    const payment: QueueRow[] = (queue?.overdueInvoices || []).map((i) => {
      const phone = pickValidPhone(i.phone, i.alternatePhone);
      const source = i.source || 'invoice';
      const billLabel = source === 'machine-sale' ? 'Machine sale' : source === 'job-card' ? 'Job card' : 'Invoice';
      return {
        key: `${source}-${i.invoiceId}`,
        source,
        kind: 'payment-reminder',
        refType: source,
        refId: i.invoiceId,
        customerId: i.customerId,
        customerName: i.customerName,
        branchId: i.branchId,
        phone,
        rawPhone: i.phone,
        title: i.customerName,
        details: [
          `${billLabel} ${i.invoiceNumber}`,
          i.dueDate ? `Due ${formatMessageDate(i.dueDate)}` : i.billDate ? `Billed ${formatMessageDate(i.billDate)}` : 'Pending',
          `Balance ${formatMessageAmount(i.balance, currency)}`
        ],
        badge: i.daysOverdue > 0 ? { text: `${i.daysOverdue}d overdue`, tone: i.daysOverdue > 30 ? 'red' : 'amber' } : { text: 'Pending', tone: 'green' },
        lastMessagedAt: i.lastMessagedAt,
        body: paymentReminderMessage({
          ...base,
          customerName: i.customerName,
          invoiceNumber: i.invoiceNumber,
          amountDue: i.balance,
          dueDate: i.dueDate,
          billLabel: source === 'invoice' ? undefined : billLabel,
          payUrl: i.payUrl
        })
      };
    });

    const warranty: QueueRow[] = (queue?.warrantyExpiring || []).map((w) => {
      const phone = pickValidPhone(w.phone, w.alternatePhone);
      const expired = w.daysLeft < 0;
      return {
        key: `war-${w.warrantyId}`,
        kind: 'warranty-expiry',
        refType: 'warranty',
        refId: w.warrantyId,
        customerId: w.customerId,
        customerName: w.customerName,
        branchId: w.branchId,
        phone,
        rawPhone: w.phone,
        title: w.customerName,
        details: [w.productName, `S/N ${w.serialNumber}`, `Expiry ${formatMessageDate(w.expiryDate)}`],
        badge: expired
          ? { text: `Expired ${Math.abs(w.daysLeft)}d ago`, tone: 'red' }
          : { text: `${w.daysLeft}d left`, tone: w.daysLeft <= 7 ? 'amber' : 'green' },
        lastMessagedAt: w.lastMessagedAt,
        body: warrantyExpiryMessage({
          ...base,
          customerName: w.customerName,
          productName: w.productName,
          serialNumber: w.serialNumber,
          expiryDate: w.expiryDate,
          daysLeft: w.daysLeft
        })
      };
    });

    const jobs: QueueRow[] = (queue?.jobsReady || []).map((j) => {
      const phone = pickValidPhone(j.phone, j.alternatePhone);
      return {
        key: `job-${j.jobCardId}`,
        kind: 'job-ready',
        refType: 'job-card',
        refId: j.jobCardId,
        customerId: j.customerId,
        customerName: j.customerName,
        branchId: j.branchId,
        phone,
        rawPhone: j.phone,
        title: j.customerName,
        details: [`Job ${j.jobNumber}`, j.machineModel || 'Machine not recorded', `Balance ${formatMessageAmount(j.balanceDue, currency)}`],
        badge: { text: j.balanceDue > 0 ? 'Balance due' : 'Fully paid', tone: j.balanceDue > 0 ? 'amber' : 'green' },
        lastMessagedAt: j.lastMessagedAt,
        body: jobReadyMessage({
          ...base,
          customerName: j.customerName,
          jobNumber: j.jobNumber,
          machineModel: j.machineModel,
          balanceDue: j.balanceDue
        })
      };
    });

    return { payment, warranty, jobs };
  }, [queue, language, company, currency]);

  // Opens the chat, then logs it. Logged even if staff cancel in WhatsApp: this records "opened", not delivery.
  const sendAndLog = async (entry: {
    key: string;
    kind: MessageKind;
    refType?: string;
    refId?: string;
    customerId: string | null;
    customerName: string;
    phone: string;
    branchId?: string | null;
    body: string;
  }): Promise<boolean> => {
    const url = buildWhatsAppLink(entry.phone, entry.body);
    if (!url) {
      showToast('Invalid number', 'This phone number cannot be used for WhatsApp.', 'warning');
      return false;
    }
    window.open(url, '_blank', 'noopener');
    setSendingKey(entry.key);
    try {
      await postMessageLog(
        scope,
        {
          kind: entry.kind,
          refType: entry.refType,
          refId: entry.refId,
          customerId: entry.customerId,
          customerName: entry.customerName,
          phone: entry.phone,
          language,
          body: entry.body,
          branchId: entry.branchId,
          sentBy
        },
        branchQuery
      );
      addAuditLog('WhatsApp Opened', 'Messages', `${KIND_LABELS[entry.kind]} chat opened for ${entry.customerName} (${entry.phone})`);
      showToast('WhatsApp opened', `Message for ${entry.customerName} is ready to send in WhatsApp.`, 'success');
      await Promise.all([loadQueue(), tab === 'history' ? loadHistory() : Promise.resolve()]);
      return true;
    } catch (e: any) {
      showToast('Log not saved', e.message || 'WhatsApp opened, but the message could not be logged.', 'error');
      return true;
    } finally {
      setSendingKey(null);
    }
  };

  const sendRow = (row: QueueRow) => {
    if (!row.phone) return;
    void sendAndLog({
      key: row.key,
      kind: row.kind,
      refType: row.refType,
      refId: row.refId,
      customerId: row.customerId,
      customerName: row.customerName,
      phone: row.phone,
      branchId: row.branchId,
      body: row.body
    });
  };

  // Custom composer state
  const [customCustomer, setCustomCustomer] = useState<Customer | null>(null);
  const [customName, setCustomName] = useState('');
  const [customPhone, setCustomPhone] = useState('');
  const [templateId, setTemplateId] = useState<string>('free');
  const [customBody, setCustomBody] = useState('');

  const applyTemplate = (id: string, lang: MessageLanguage, name: string) => {
    const tpl = CUSTOM_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setCustomBody(tpl.build({ language: lang, company, customerName: name || 'Customer', currencySymbol: currency }));
  };

  const handlePickCustomer = (c: Customer) => {
    setCustomCustomer(c);
    const name = c.name || c.companyName;
    setCustomName(name);
    setCustomPhone(c.phone);
    if (templateId !== 'free') applyTemplate(templateId, language, name);
  };

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    if (id !== 'free') applyTemplate(id, language, customName);
  };

  const handleLanguageChange = (lang: MessageLanguage) => {
    setLanguage(lang);
    if (tab === 'custom' && templateId !== 'free') applyTemplate(templateId, lang, customName);
  };

  const customPhoneNormalized = pickValidPhone(customPhone);
  const canSendCustom = !!customPhoneNormalized && customBody.trim().length > 0;

  const handleSendCustom = async () => {
    if (!customPhoneNormalized || !customBody.trim()) return;
    const ok = await sendAndLog({
      key: 'custom',
      kind: 'custom',
      customerId: customCustomer?.id ?? null,
      customerName: customName.trim() || customCustomer?.companyName || 'Customer',
      phone: customPhoneNormalized,
      branchId: customCustomer?.branchId,
      body: customBody.trim()
    });
    if (ok) {
      setCustomBody('');
      setTemplateId('free');
    }
  };

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'payment', label: 'Payment reminders', count: queue ? rows.payment.length : undefined },
    { id: 'warranty', label: 'Warranty expiring', count: queue ? rows.warranty.length : undefined },
    { id: 'jobs', label: 'Jobs ready', count: queue ? rows.jobs.length : undefined },
    { id: 'custom', label: 'Custom message' },
    // Bulk marketing is for the owner side only.
    ...(isOwner ? [{ id: 'bulk' as TabId, label: 'Bulk marketing' }, { id: 'daily' as TabId, label: 'Daily report' }] : []),
    { id: 'history', label: 'History' }
  ];

  const emptyText: Record<'payment' | 'warranty' | 'jobs', string> = {
    payment: 'Nobody has a pending payment right now.',
    warranty: 'No warranties expiring in the next 30 days or expired in the last 15 days.',
    jobs: 'No job cards are waiting for pickup.'
  };

  const renderQueue = (list: QueueRow[], emptyKey: 'payment' | 'warranty' | 'jobs') => {
    if (queueLoading && !queue) {
      return (
        <div className="flex items-center justify-center gap-2 p-10 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue...
        </div>
      );
    }
    if (queueError) {
      return (
        <div className="flex flex-col items-center gap-3 p-10 text-center text-xs">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" /> {queueError}
          </div>
          <button
            onClick={loadQueue}
            className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            Retry
          </button>
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-xs text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          {emptyText[emptyKey]}
        </div>
      );
    }
    return (
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {list.map((row) => {
          const tag = recentTag(row.lastMessagedAt);
          const busy = sendingKey === row.key;
          return (
            <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{row.title}</span>
                  {row.badge && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASS[row.badge.tone]}`}>
                      {row.badge.text}
                    </span>
                  )}
                  {tag && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      {tag}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {row.details.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                  <span className="font-mono">{row.rawPhone || 'No phone'}</span>
                </div>
              </div>
              {row.phone ? (
                <button
                  onClick={() => sendRow(row)}
                  disabled={busy}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                  WhatsApp
                </button>
              ) : (
                <button
                  disabled
                  className="inline-flex shrink-0 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                >
                  No valid phone
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const [autoStatus, setAutoStatus] = useState<AutoSendStatus | null>(null);
  const [reminderStatus, setReminderStatus] = useState<ReminderStatus | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  useEffect(() => {
    fetchReminderStatus(scope)
      .then(setReminderStatus)
      .catch(() => setReminderStatus(null));
  }, [scope]);
  const pendingTotal = useMemo(() => (queue?.overdueInvoices || []).reduce((sum, i) => sum + (i.balance || 0), 0), [queue]);

  // Sends the first reminder to the owner's own number, so the message and the Pay now button can be seen before real ones go out.
  const sendTestReminder = async () => {
    const first = rows.payment[0];
    if (!first) return;
    if (testNumber.replace(/\D/g, '').length < 10) {
      showToast('Your number', 'Type your own 10 digit WhatsApp number for the test.', 'warning');
      return;
    }
    setSendingAll(true);
    try {
      const r = await sendPaymentReminders(scope, { items: [{ source: first.source || 'invoice', refId: first.refId }], sentBy, testTo: testNumber });
      if (r.sent) showToast('Test sent', `A test reminder was sent to ${testNumber}. Nothing was sent to the customer.`, 'success');
      else showToast('Test not sent', r.failures[0]?.error || r.stoppedEarly || 'Please try again.', 'error');
    } catch (e: any) {
      showToast('Could not send the test', e?.message || 'Please try again.', 'error');
    } finally {
      setSendingAll(false);
    }
  };

  // Sends the approved WhatsApp template to everyone with a pending payment and a valid number, in one go.
  const sendAllReminders = async () => {
    const targets = rows.payment.filter((r) => r.phone);
    if (!targets.length) {
      showToast('Nobody to send to', 'None of the people with a pending payment has a valid WhatsApp number.', 'warning');
      return;
    }
    const first = targets.slice(0, reminderStatus?.maxAtOnce ?? 300);
    if (!window.confirm(`Send a payment reminder on WhatsApp to ${first.length} ${first.length === 1 ? 'person' : 'people'} now?`)) return;
    setSendingAll(true);
    try {
      const r = await sendPaymentReminders(scope, { items: first.map((t) => ({ source: t.source || 'invoice', refId: t.refId })), sentBy });
      const parts = [`Sent ${r.sent}`];
      if (r.skippedWhy.recent) parts.push(`${r.skippedWhy.recent} reminded recently`);
      if (r.skippedWhy.noNumber) parts.push(`${r.skippedWhy.noNumber} without a number`);
      if (r.skippedWhy.notOwing) parts.push(`${r.skippedWhy.notOwing} already paid`);
      if (r.failed) parts.push(`${r.failed} failed${r.failures[0] ? ` (${r.failures[0].error})` : ''}`);
      const trouble = r.failed > 0 || !!r.stoppedEarly;
      showToast(trouble ? 'Reminders sent with problems' : 'Reminders sent', `${parts.join(', ')}.${r.stoppedEarly ? ` ${r.stoppedEarly}` : ''}`, trouble ? 'warning' : 'success');
      loadQueue();
    } catch (e: any) {
      showToast('Could not send', e?.message || 'Please try again.', 'error');
    } finally {
      setSendingAll(false);
    }
  };
  useEffect(() => {
    fetchAutoSendStatus(scope)
      .then(setAutoStatus)
      .catch(() => setAutoStatus(null));
  }, [scope]);

  return (
    <div className="space-y-6 pb-12">
      {autoStatus && (
        <div
          className={`rounded-xl border p-4 text-xs ${
            autoStatus.configured
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          <p className="font-bold">
            {autoStatus.configured ? 'Automatic bill sending is ON' : 'Automatic bill sending is not set up yet'}
          </p>
          <p className="mt-1">
            {autoStatus.configured
              ? `Every issued invoice is sent to the customer's WhatsApp with a link to the bill (template "${autoStatus.templateName}").`
              : `Until it is set up, use the WhatsApp button on an invoice to open the message yourself. Missing: ${autoStatus.missing.join(', ')}.`}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">WhatsApp Messages</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Send reminders to farmers through WhatsApp. The message opens in a new tab and you press Send.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {(['en', 'ta'] as const).map((l) => (
              <button
                key={l}
                onClick={() => handleLanguageChange(l)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  language === l
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {l === 'en' ? 'English' : 'Tamil'}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              loadQueue();
              if (tab === 'history') loadHistory();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${queueLoading || historyLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold ${
              tab === t.id
                ? 'border-slate-800 text-slate-900 dark:border-slate-200 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Messages are logged when WhatsApp is opened. This shows that the chat was opened, not that the message was sent or delivered.
      </p>

      {tab === 'payment' && (
        <>
          {queue && rows.payment.length > 0 && (
            <div className={`${cardCls} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {rows.payment.length} {rows.payment.length === 1 ? 'person has' : 'people have'} a pending payment
                </p>
                <p className="mt-0.5">
                  Total pending {formatMessageAmount(pendingTotal, currency)}, {rows.payment.filter((r) => r.phone).length} with a WhatsApp number.{' '}
                  {reminderStatus && !reminderStatus.configured
                    ? `Automatic sending is not set up yet (missing ${reminderStatus.missing.join(', ')}); use the WhatsApp button on each row.`
                    : reminderStatus
                      ? `Reminders go through the approved template "${reminderStatus.templateName}". The same bill is not reminded again for ${reminderStatus.cooldownDays} days.`
                      : ''}
                </p>
                {reminderStatus?.usesLink && (
                  <p className={`mt-0.5 font-semibold ${reminderStatus.payLink?.ready ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    {reminderStatus.payLink?.ready
                      ? 'Each reminder has a Pay now button (UPI, straight to your account).'
                      : `The Pay now button is not ready yet. Missing: ${reminderStatus.payLink?.missing.join(', ') || 'unknown'}.`}
                  </p>
                )}
                {isOwner && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className={`${inputCls} !w-40`}
                      inputMode="numeric"
                      placeholder="Your 10 digit number"
                      aria-label="Your WhatsApp number for a test"
                      value={testNumber}
                      onChange={(e) => setTestNumber(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={sendTestReminder}
                      disabled={sendingAll || !reminderStatus?.configured}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      <Send className="h-3.5 w-3.5" /> Send a test to me
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={sendAllReminders}
                disabled={sendingAll || !reminderStatus?.configured}
                className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send all on WhatsApp
              </button>
            </div>
          )}
          <div className={cardCls}>{renderQueue(rows.payment, 'payment')}</div>
        </>
      )}
      {tab === 'warranty' && <div className={cardCls}>{renderQueue(rows.warranty, 'warranty')}</div>}
      {tab === 'jobs' && <div className={cardCls}>{renderQueue(rows.jobs, 'jobs')}</div>}

      {tab === 'custom' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className={`${cardCls} space-y-4 p-4`}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Customer</label>
              <CustomerPhoneLookup
                selectedCustomer={customCustomer}
                onSelectCustomer={handlePickCustomer}
                customers={customers}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Name</label>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Customer name"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">WhatsApp number</label>
                <input
                  value={customPhone}
                  onChange={(e) => setCustomPhone(e.target.value)}
                  placeholder="9876543210"
                  inputMode="tel"
                  className={inputCls}
                />
                {customPhone && !customPhoneNormalized && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">Enter a valid 10-digit Indian mobile number.</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Template</label>
              <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className={inputCls}>
                <option value="free">Free text</option>
                {CUSTOM_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label[language]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Message</label>
              <textarea
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                rows={8}
                placeholder="Type your message"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleSendCustom}
              disabled={!canSendCustom || sendingKey === 'custom'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              {sendingKey === 'custom' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Open in WhatsApp
            </button>
          </div>

          <div className={`${cardCls} p-4`}>
            <h2 className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Preview</h2>
            <div className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/30">
              {customBody.trim() ? (
                <p className="whitespace-pre-wrap break-words text-xs text-slate-800 dark:text-slate-100">{customBody}</p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">The message preview appears here.</p>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              To: {customPhoneNormalized ? `+${customPhoneNormalized}` : 'no valid number yet'}
            </p>
          </div>
        </div>
      )}

      {tab === 'bulk' && isOwner && <GroupGreeting scope={scope} sentBy={sentBy} />}

      {tab === 'bulk' && isOwner && <BulkMarketing scope={scope} language={language} sentBy={sentBy} />}

      {tab === 'daily' && isOwner && <DailyReportPanel scope={scope} />}

      {tab === 'history' && (
        <div className={`${cardCls} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-3 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Last 100 messages opened</span>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as 'all' | MessageKind)}
              className={`${inputCls} !w-auto`}
            >
              <option value="all">All kinds</option>
              {(Object.keys(KIND_LABELS) as MessageKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {historyLoading && history.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-10 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history...
            </div>
          ) : historyError ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-xs">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4" /> {historyError}
              </div>
              <button
                onClick={loadHistory}
                className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
              >
                Retry
              </button>
            </div>
          ) : history.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">No messages logged yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Time</th>
                    <th className="px-4 py-2 font-semibold">Customer</th>
                    <th className="px-4 py-2 font-semibold">Phone</th>
                    <th className="px-4 py-2 font-semibold">Kind</th>
                    <th className="px-4 py-2 font-semibold">Message</th>
                    <th className="px-4 py-2 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((m) => (
                    <tr key={m.id} className="text-slate-700 dark:text-slate-300">
                      <td className="whitespace-nowrap px-4 py-2">{formatDateTime(m.createdAt)}</td>
                      <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{m.customerName}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.phone}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {KIND_LABELS[m.kind] || m.kind} ({m.language === 'ta' ? 'Tamil' : 'English'})
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-slate-500 dark:text-slate-400" title={m.body}>
                        {m.body.replace(/\s+/g, ' ')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">{m.sentBy || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
