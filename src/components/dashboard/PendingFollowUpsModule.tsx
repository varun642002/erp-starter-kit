import React, { useState, useMemo } from 'react';
import {
  Clock,
  AlertTriangle,
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  Plus,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronRight,
  Filter,
  DollarSign,
  User,
  Building,
  Bell,
  Send,
  Trash2,
  Check,
  Flame,
  ArrowRight
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Invoice, InvoiceFollowUpReminder, Customer } from '../../types/erp';

export const PendingFollowUpsModule: React.FC = () => {
  const {
    filteredInvoices,
    invoices,
    customers,
    settings,
    followUpReminders,
    addFollowUpReminder,
    updateFollowUpReminder,
    deleteFollowUpReminder,
    recordCustomerPayment,
    setCurrentView,
    showToast
  } = useERP();

  const currency = settings.currencySymbol || '₹';

  // Active filter state
  const [filterMode, setFilterMode] = useState<'all-overdue' | 'critical' | 'with-reminders'>('all-overdue');
  const [selectedInvoiceForContact, setSelectedInvoiceForContact] = useState<Invoice | null>(null);
  const [selectedInvoiceForReminder, setSelectedInvoiceForReminder] = useState<Invoice | null>(null);
  const [quickPaymentInvoice, setQuickPaymentInvoice] = useState<Invoice | null>(null);
  const [quickPaymentAmount, setQuickPaymentAmount] = useState<number>(0);

  // Reminder form state
  const [reminderDate, setReminderDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  });
  const [reminderType, setReminderType] = useState<InvoiceFollowUpReminder['reminderType']>('Call');
  const [reminderPriority, setReminderPriority] = useState<InvoiceFollowUpReminder['priority']>('High');
  const [reminderNotes, setReminderNotes] = useState<string>('');
  const [assignedTo, setAssignedTo] = useState<string>('Accounts Receivable Desk');

  // Contact quick message generator state
  const [contactChannel, setContactChannel] = useState<'phone' | 'email' | 'whatsapp'>('whatsapp');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [copiedText, setCopiedText] = useState<boolean>(false);

  // Current system date reference
  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => now.toISOString().split('T')[0], [now]);

  // Map customers for quick lookups
  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((c) => {
      map.set(c.id, c);
    });
    return map;
  }, [customers]);

  // Calculate overdue invoices past due date with remaining balance
  const overdueInvoices = useMemo(() => {
    return filteredInvoices
      .filter((inv) => {
        if (inv.status === 'Cancelled' || inv.status === 'Paid') return false;
        const bal = inv.balanceAmount !== undefined ? inv.balanceAmount : inv.grandTotal - (inv.paidAmount || 0);
        if (bal <= 0) return false;

        // Due date past today or explicitly marked Overdue
        const isPastDue = inv.dueDate && inv.dueDate < todayStr;
        const isOverdueStatus = inv.paymentStatus === 'Overdue';
        return isPastDue || isOverdueStatus;
      })
      .map((inv) => {
        const bal = inv.balanceAmount !== undefined ? inv.balanceAmount : inv.grandTotal - (inv.paidAmount || 0);
        const dueTime = new Date(inv.dueDate).getTime();
        const diffDays = Math.max(1, Math.floor((now.getTime() - dueTime) / (1000 * 60 * 60 * 24)));
        const cust = customerMap.get(inv.customerId);
        const existingReminders = followUpReminders.filter((r) => r.invoiceId === inv.id && r.status === 'Pending');

        return {
          invoice: inv,
          balance: bal,
          daysOverdue: diffDays,
          customer: cust,
          reminders: existingReminders
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [filteredInvoices, todayStr, now, customerMap, followUpReminders]);

  // Summary statistics
  const stats = useMemo(() => {
    const totalOverdueAmount = overdueInvoices.reduce((sum, item) => sum + item.balance, 0);
    const criticalOverdueCount = overdueInvoices.filter((item) => item.daysOverdue >= 15).length;
    const pendingRemindersCount = followUpReminders.filter((r) => r.status === 'Pending').length;
    return {
      totalOverdueAmount,
      totalCount: overdueInvoices.length,
      criticalOverdueCount,
      pendingRemindersCount
    };
  }, [overdueInvoices, followUpReminders]);

  // Filtered list according to tab
  const displayedItems = useMemo(() => {
    if (filterMode === 'critical') {
      return overdueInvoices.filter((item) => item.daysOverdue >= 15 || item.balance >= 100000);
    }
    if (filterMode === 'with-reminders') {
      return overdueInvoices.filter((item) => item.reminders.length > 0);
    }
    return overdueInvoices;
  }, [overdueInvoices, filterMode]);

  // Initiate contact action
  const handleOpenContactModal = (inv: Invoice) => {
    setSelectedInvoiceForContact(inv);
    const cust = customerMap.get(inv.customerId);
    const bal = inv.balanceAmount !== undefined ? inv.balanceAmount : inv.grandTotal - (inv.paidAmount || 0);

    const draftMsg = `Dear ${cust?.companyName || inv.customerName},\nThis is a friendly reminder from ${settings.companyName || 'Finance Team'} regarding Invoice #${inv.invoiceNumber} dated ${inv.invoiceDate} for ${currency}${bal.toLocaleString()}, which was due on ${inv.dueDate}.\n\nPlease arrange for the payment clearance or share the transaction UTR number at your earliest convenience.\nBank details: ${settings.bankDetails?.bankName} | A/C: ${settings.bankDetails?.accountNumber} | IFSC: ${settings.bankDetails?.ifscCode}\n\nThank you,\nAccounts Desk`;
    setCustomMessage(draftMsg);
    setCopiedText(false);
  };

  // Open set reminder modal
  const handleOpenReminderModal = (inv: Invoice) => {
    setSelectedInvoiceForReminder(inv);
    const bal = inv.balanceAmount !== undefined ? inv.balanceAmount : inv.grandTotal - (inv.paidAmount || 0);
    setReminderNotes(`Follow-up with accounts manager regarding balance ${currency}${bal.toLocaleString()}`);
  };

  // Save new reminder
  const handleSaveReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceForReminder) return;

    const bal = selectedInvoiceForReminder.balanceAmount !== undefined
      ? selectedInvoiceForReminder.balanceAmount
      : selectedInvoiceForReminder.grandTotal - (selectedInvoiceForReminder.paidAmount || 0);

    addFollowUpReminder({
      invoiceId: selectedInvoiceForReminder.id,
      invoiceNumber: selectedInvoiceForReminder.invoiceNumber,
      customerId: selectedInvoiceForReminder.customerId,
      customerName: selectedInvoiceForReminder.customerName,
      amountDue: bal,
      reminderDate,
      reminderType,
      priority: reminderPriority,
      notes: reminderNotes,
      status: 'Pending',
      assignedTo
    });

    setSelectedInvoiceForReminder(null);
  };

  // Quick initiate communication
  const handleTriggerDirectCall = (phone?: string) => {
    if (!phone) {
      showToast('No Phone Number', 'Customer does not have a recorded contact number.', 'warning');
      return;
    }
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };

  const handleCopyMessage = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(customMessage);
    setCopiedText(true);
    showToast('Message Copied', 'Reminder template copied to clipboard.', 'success');
    setTimeout(() => setCopiedText(false), 3000);
  };

  const handleSendViaWhatsApp = (phone?: string) => {
    const rawNumber = (phone || '').replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(customMessage);
    const waUrl = rawNumber.length >= 10
      ? `https://wa.me/${rawNumber.startsWith('91') ? rawNumber : '91' + rawNumber}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
    showToast('WhatsApp Launched', 'Payment reminder loaded in WhatsApp chat.', 'info');
  };

  const handleSendViaEmail = (email?: string) => {
    const targetEmail = email || '';
    const subject = encodeURIComponent(`Urgent: Payment Follow-up - Invoice ${selectedInvoiceForContact?.invoiceNumber}`);
    const body = encodeURIComponent(customMessage);
    window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
  };

  // Quick record payment
  const handleQuickPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPaymentInvoice || quickPaymentAmount <= 0) return;

    recordCustomerPayment({
      customerId: quickPaymentInvoice.customerId,
      customerName: quickPaymentInvoice.customerName,
      branchId: quickPaymentInvoice.branchId,
      paymentDate: todayStr,
      amount: quickPaymentAmount,
      paymentMethod: 'Bank Transfer',
      referenceNumber: `TXN-REM-${Date.now().toString().slice(-6)}`,
      invoiceId: quickPaymentInvoice.id,
      notes: 'Cleared via Pending Follow-ups quick payment action',
      receiptType: 'Customer Payment'
    });

    // Mark pending reminders for this invoice as completed
    followUpReminders
      .filter((r) => r.invoiceId === quickPaymentInvoice.id && r.status === 'Pending')
      .forEach((r) => {
        updateFollowUpReminder(r.id, { status: 'Completed' });
      });

    showToast('Payment Logged', `Payment of ${currency}${quickPaymentAmount.toLocaleString()} recorded for ${quickPaymentInvoice.invoiceNumber}.`, 'success');
    setQuickPaymentInvoice(null);
  };

  return (
    <div
      id="pending-followups-module"
      className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 transition-all"
    >
      {/* Header & Metric Counter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-950/80 dark:text-amber-400 shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Pending Follow-ups
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200/60">
                  {stats.totalCount} Overdue Bills
                </span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Highlighting invoices past maturity with quick actions to contact debtors, record notes, or schedule alerts.
            </p>
          </div>
        </div>

        {/* Aggregate KPI Badges & Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/60 text-xs">
            <span className="text-amber-800 dark:text-amber-300 font-medium">Overdue Dues:</span>
            <span className="font-mono font-bold text-amber-900 dark:text-amber-200">
              {currency}{stats.totalOverdueAmount.toLocaleString()}
            </span>
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800 text-xs">
            <button
              type="button"
              id="followup-filter-all"
              onClick={() => setFilterMode('all-overdue')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                filterMode === 'all-overdue'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              All Overdue ({overdueInvoices.length})
            </button>
            <button
              type="button"
              id="followup-filter-critical"
              onClick={() => setFilterMode('critical')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                filterMode === 'critical'
                  ? 'bg-white text-rose-600 shadow-2xs dark:bg-slate-700 dark:text-rose-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Critical ({stats.criticalOverdueCount})
            </button>
            <button
              type="button"
              id="followup-filter-reminders"
              onClick={() => setFilterMode('with-reminders')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                filterMode === 'with-reminders'
                  ? 'bg-white text-emerald-600 shadow-2xs dark:bg-slate-700 dark:text-emerald-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Reminders Set ({stats.pendingRemindersCount})
            </button>
          </div>
        </div>
      </div>

      {/* Main List of Overdue Invoices */}
      <div className="mt-4 space-y-3">
        {displayedItems.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 opacity-80" />
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              No Overdue Follow-ups in Selected Filter
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              All active customer invoices are currently within their agreed payment terms or have already been settled.
            </p>
          </div>
        ) : (
          displayedItems.map(({ invoice, balance, daysOverdue, customer, reminders }) => {
            const isSevere = daysOverdue >= 15;
            return (
              <div
                key={invoice.id}
                id={`followup-item-${invoice.id}`}
                className={`group relative rounded-xl border p-4 transition-all hover:shadow-sm ${
                  isSevere
                    ? 'border-rose-200/80 bg-gradient-to-r from-white to-rose-50/20 dark:border-rose-900/60 dark:from-slate-900 dark:to-rose-950/20'
                    : 'border-amber-200/70 bg-gradient-to-r from-white to-amber-50/20 dark:border-amber-900/50 dark:from-slate-900 dark:to-amber-950/20'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Client & Invoice Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white text-sm hover:text-blue-600 transition-colors">
                        {invoice.customerName}
                      </span>
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {invoice.invoiceNumber}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isSevere
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {isSevere && <Flame className="h-3 w-3 text-rose-500 fill-rose-500" />}
                        {daysOverdue} Days Overdue (Due: {invoice.dueDate})
                      </span>
                      {reminders.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200/60">
                          <Bell className="h-2.5 w-2.5" />
                          {reminders.length} Reminder Scheduled
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-500 dark:text-slate-400">
                      <span>Billed: <strong className="text-slate-700 dark:text-slate-300 font-mono">{currency}{invoice.grandTotal.toLocaleString()}</strong></span>
                      <span>Paid: <strong className="text-slate-700 dark:text-slate-300 font-mono">{currency}{(invoice.paidAmount || 0).toLocaleString()}</strong></span>
                      {customer?.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {customer.phone}
                        </span>
                      )}
                      {customer?.city && (
                        <span className="flex items-center gap-1">
                          <Building className="h-3 w-3 text-slate-400" />
                          {customer.city}
                        </span>
                      )}
                    </div>

                    {/* Active Reminders preview if existing */}
                    {reminders.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {reminders.map((r) => (
                          <div
                            key={r.id}
                            className="inline-flex items-center gap-1.5 rounded-md bg-white/80 dark:bg-slate-800/80 border border-blue-200/80 dark:border-blue-900/60 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                          >
                            <Calendar className="h-3 w-3 text-blue-500" />
                            <span className="font-semibold">{r.reminderType}:</span>
                            <span>{r.reminderDate}</span>
                            <span className="text-slate-400">({r.notes.slice(0, 35)}...)</span>
                            <button
                              type="button"
                              title="Mark reminder as completed"
                              onClick={() => updateFollowUpReminder(r.id, { status: 'Completed' })}
                              className="ml-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 cursor-pointer"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title="Remove reminder"
                              onClick={() => deleteFollowUpReminder(r.id)}
                              className="text-slate-400 hover:text-rose-500 cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Middle Column: Due Amount Display */}
                  <div className="lg:text-right shrink-0">
                    <span className="text-[11px] font-medium text-slate-400 block">Pending Balance:</span>
                    <span className="text-lg font-mono font-extrabold text-rose-600 dark:text-rose-400">
                      {currency}{balance.toLocaleString()}
                    </span>
                    <span className="block text-[10px] text-slate-400 font-mono">
                      Inv Date: {invoice.invoiceDate}
                    </span>
                  </div>

                  {/* Right Column: Interactive Quick Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                    {/* Initiate Contact Button */}
                    <button
                      type="button"
                      id={`btn-contact-${invoice.id}`}
                      onClick={() => handleOpenContactModal(invoice)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                      title="Initiate contact via Phone, Email or WhatsApp"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>Contact</span>
                    </button>

                    {/* Set Reminder Button */}
                    <button
                      type="button"
                      id={`btn-remind-${invoice.id}`}
                      onClick={() => handleOpenReminderModal(invoice)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-300 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                      title="Schedule follow-up reminder date"
                    >
                      <Bell className="h-3.5 w-3.5 text-amber-500" />
                      <span>Set Reminder</span>
                    </button>

                    {/* Quick Record Payment */}
                    <button
                      type="button"
                      id={`btn-pay-${invoice.id}`}
                      onClick={() => {
                        setQuickPaymentInvoice(invoice);
                        setQuickPaymentAmount(balance);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 dark:text-emerald-300 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                      title="Record direct payment received"
                    >
                      <DollarSign className="h-3.5 w-3.5" />
                      <span>Collect</span>
                    </button>

                    {/* Open Full Invoice */}
                    <button
                      type="button"
                      onClick={() => setCurrentView('billing')}
                      className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="View Invoice in Billing View"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL 1: INITIATE CONTACT / DISPATCH REMINDER */}
      {selectedInvoiceForContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-indigo-600" />
                  Initiate Client Follow-up
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Invoice <strong className="text-slate-700 dark:text-slate-200">{selectedInvoiceForContact.invoiceNumber}</strong> • {selectedInvoiceForContact.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoiceForContact(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Client quick details */}
            {(() => {
              const cust = customerMap.get(selectedInvoiceForContact.customerId);
              const bal = selectedInvoiceForContact.balanceAmount !== undefined
                ? selectedInvoiceForContact.balanceAmount
                : selectedInvoiceForContact.grandTotal - (selectedInvoiceForContact.paidAmount || 0);

              return (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Primary Contact:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{cust?.name || 'Authorized Signatory'}</span>
                      <span className="block text-slate-500 font-mono mt-0.5">{cust?.phone || 'No phone'}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 block text-[11px]">Amount Overdue:</span>
                      <span className="text-base font-mono font-bold text-rose-600 dark:text-rose-400">
                        {currency}{bal.toLocaleString()}
                      </span>
                      <span className="block text-[11px] text-slate-500">Matured: {selectedInvoiceForContact.dueDate}</span>
                    </div>
                  </div>

                  {/* Channel Selection */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Select Contact Action / Channel:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setContactChannel('whatsapp')}
                        className={`flex items-center justify-center gap-1.5 rounded-lg p-2.5 text-xs font-semibold border transition-all cursor-pointer ${
                          contactChannel === 'whatsapp'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <MessageSquare className="h-4 w-4 text-emerald-500" />
                        <span>WhatsApp</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setContactChannel('phone')}
                        className={`flex items-center justify-center gap-1.5 rounded-lg p-2.5 text-xs font-semibold border transition-all cursor-pointer ${
                          contactChannel === 'phone'
                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <Phone className="h-4 w-4 text-blue-500" />
                        <span>Direct Call</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setContactChannel('email')}
                        className={`flex items-center justify-center gap-1.5 rounded-lg p-2.5 text-xs font-semibold border transition-all cursor-pointer ${
                          contactChannel === 'email'
                            ? 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <Mail className="h-4 w-4 text-purple-500" />
                        <span>Email Notice</span>
                      </button>
                    </div>
                  </div>

                  {/* Message editor preview */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Follow-up Notice Text:
                      </label>
                      <button
                        type="button"
                        onClick={handleCopyMessage}
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 cursor-pointer flex items-center gap-1"
                      >
                        {copiedText ? <Check className="h-3 w-3 text-emerald-500" /> : null}
                        {copiedText ? 'Copied!' : 'Copy Template'}
                      </button>
                    </div>
                    <textarea
                      rows={5}
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceForContact(null)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Close
                    </button>

                    {contactChannel === 'whatsapp' && (
                      <button
                        type="button"
                        onClick={() => handleSendViaWhatsApp(cust?.phone)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Launch WhatsApp</span>
                      </button>
                    )}

                    {contactChannel === 'phone' && (
                      <button
                        type="button"
                        onClick={() => handleTriggerDirectCall(cust?.phone)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span>Dial Number Now</span>
                      </button>
                    )}

                    {contactChannel === 'email' && (
                      <button
                        type="button"
                        onClick={() => handleSendViaEmail(cust?.email)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        <span>Open Email Client</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL 2: SCHEDULE FOLLOW-UP REMINDER */}
      {selectedInvoiceForReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Bell className="h-5 w-5 text-amber-500" />
                  Schedule Follow-up Reminder
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Set an alert for invoice <strong className="text-slate-700 dark:text-slate-200">{selectedInvoiceForReminder.invoiceNumber}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoiceForReminder(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReminder} className="mt-3 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reminder Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={reminderDate}
                    onChange={(e) => setReminderDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Follow-up Mode
                  </label>
                  <select
                    value={reminderType}
                    onChange={(e) => setReminderType(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="Call">Direct Phone Call</option>
                    <option value="WhatsApp">WhatsApp Ping</option>
                    <option value="Email">Email Statement</option>
                    <option value="In-Person Visit">In-Person Site Visit</option>
                    <option value="Formal Notice">Legal / Formal Demand Notice</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={reminderPriority}
                    onChange={(e) => setReminderPriority(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="High">High (Critical Overdue)</option>
                    <option value="Medium">Medium (Routine)</option>
                    <option value="Low">Low (Courtesy)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Assigned Rep
                  </label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Follow-up Notes / Agenda
                </label>
                <textarea
                  rows={3}
                  required
                  value={reminderNotes}
                  onChange={(e) => setReminderNotes(e.target.value)}
                  placeholder="e.g. Verify RTGS reference, confirm if materials reached site in order..."
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceForReminder(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Save Reminder</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: QUICK RECORD PAYMENT */}
      {quickPaymentInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                  Quick Record Receipt
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {quickPaymentInvoice.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickPaymentInvoice(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickPaymentSubmit} className="mt-3 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Amount ({currency}) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={quickPaymentAmount}
                  onChange={(e) => setQuickPaymentAmount(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-mono font-bold text-slate-900 focus:border-emerald-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <p className="text-[11px] text-slate-400">
                Recording this payment will immediately update the customer balance and close any pending reminders for this invoice.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickPaymentInvoice(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Confirm Receipt</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
