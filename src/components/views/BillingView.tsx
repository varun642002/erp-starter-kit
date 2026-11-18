import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Plus,
  Search,
  Filter,
  Printer,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Eye,
  Download,
  Calendar,
  Building2,
  Clock,
  Archive,
  ArchiveRestore
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Invoice, PaymentStatus } from '../../types/erp';
import { BulkActionToolbar, StatusOption } from '../common/BulkActionToolbar';
import { BatchPrintModal } from '../common/BatchPrintModal';

export const BillingView: React.FC = () => {
  const {
    filteredInvoices,
    settings,
    openQuickAdd,
    setSelectedInvoiceForPrint,
    recordCustomerPayment,
    bulkUpdateInvoiceStatus,
    bulkArchiveInvoices,
    branches
  } = useERP();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewArchived, setViewArchived] = useState<boolean>(false);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'Bank Transfer' | 'Cheque' | 'Cash' | 'UPI'>('Bank Transfer');
  const [paymentRef, setPaymentRef] = useState('');

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const filtered = filteredInvoices.filter((inv) => {
    const isArchived = Boolean(inv.isArchived);
    if (viewArchived !== isArchived) return false;

    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customerGstin.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || inv.paymentStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const isAllSelected = filtered.length > 0 && filtered.every(inv => selectedIds.includes(inv.id));
  const isPartiallySelected = selectedIds.length > 0 && !isAllSelected && filtered.some(inv => selectedIds.includes(inv.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const visibleIds = filtered.map(inv => inv.id);
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      const visibleIds = filtered.map(inv => inv.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.length > 0) {
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.length]);

  const handleOpenPayment = (inv: Invoice) => {
    setPaymentModalInvoice(inv);
    setPaymentAmount(inv.balanceAmount);
  };

  const handleSavePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInvoice || paymentAmount <= 0) return;

    recordCustomerPayment(
      paymentModalInvoice.customerId,
      paymentModalInvoice.id,
      paymentAmount,
      paymentMethod,
      paymentRef || `TXN-${Date.now().toString().slice(-6)}`
    );

    setPaymentModalInvoice(null);
  };

  const handleBulkStatus = (status: string) => {
    bulkUpdateInvoiceStatus(selectedIds, status as any);
    setSelectedIds([]);
  };

  const handleBulkArchive = () => {
    bulkArchiveInvoices(selectedIds, true);
    setSelectedIds([]);
  };

  const handleBulkRestore = () => {
    bulkArchiveInvoices(selectedIds, false);
    setSelectedIds([]);
  };

  const handleExportCSV = () => {
    const itemsToExport = filtered.filter(inv => selectedIds.includes(inv.id));
    if (!itemsToExport.length) return;

    let csvContent = 'Invoice #,Customer Name,GSTIN,Invoice Date,Due Date,Taxable Amount,GST Tax,Grand Total,Balance Due,Payment Status,Invoice Status\n';
    itemsToExport.forEach(inv => {
      const tax = inv.cgstAmount + inv.sgstAmount + inv.igstAmount;
      csvContent += `"${inv.invoiceNumber}","${inv.customerName.replace(/"/g, '""')}","${inv.customerGstin}","${inv.invoiceDate}","${inv.dueDate}",${inv.subtotal},${tax},${inv.grandTotal},${inv.balanceAmount},"${inv.paymentStatus}","${inv.status}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Invoices_Bulk_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusOptions: StatusOption[] = [
    { value: 'Issued', label: 'Issued', badgeClass: 'bg-slate-200 text-slate-900' },
    { value: 'Paid', label: 'Paid', badgeClass: 'bg-emerald-100 text-emerald-800' },
    { value: 'Cancelled', label: 'Cancelled', badgeClass: 'bg-rose-100 text-rose-800' },
    { value: 'Refunded', label: 'Refunded', badgeClass: 'bg-purple-100 text-purple-800' }
  ];

  return (
    <div className="space-y-6 pb-20 relative">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Billing & Tax Invoices (GST)
            </h1>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
              {filteredInvoices.filter(i => !i.isArchived).length} Invoices
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            GST-compliant invoices, HSN code classification, CGST/SGST splits, payment collections, and printing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Active / Archive Toggle */}
          <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setViewArchived(false);
                setSelectedIds([]);
              }}
              className={`rounded-lg px-3 py-1.5 transition-colors cursor-pointer ${
                !viewArchived
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Active Invoices
            </button>
            <button
              type="button"
              onClick={() => {
                setViewArchived(true);
                setSelectedIds([]);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors cursor-pointer ${
                viewArchived
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archived</span>
            </button>
          </div>

          <button
            onClick={() => openQuickAdd('sale')}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 active:scale-98 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Invoice</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by invoice number, contractor, GSTIN..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="all">All Payment States</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Unpaid">Unpaid</option>
          </select>
        </div>
      </div>

      {/* Invoices Data Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                {/* Select All Checkbox Header */}
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    ref={selectAllRef}
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                    title="Select all visible invoices"
                  />
                </th>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4 text-center">Invoice Date</th>
                <th className="py-3 px-4 text-center">Due Date</th>
                <th className="py-3 px-4 text-right">Taxable</th>
                <th className="py-3 px-4 text-right">GST (Tax)</th>
                <th className="py-3 px-4 text-right">Grand Total</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    {viewArchived ? 'No archived invoices found.' : 'No invoices matching the specified criteria.'}
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const isSelected = selectedIds.includes(inv.id);
                  const branch = branches.find(b => b.id === inv.branchId);

                  const paymentBadges: Record<PaymentStatus, string> = {
                    Paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
                    Partial: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
                    Unpaid: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
                    Overdue: 'bg-red-100 text-red-800 border border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900'
                  };

                  return (
                    <tr
                      key={inv.id}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-slate-100/70 dark:bg-slate-800/40'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Row Checkbox */}
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(inv.id)}
                          className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900 dark:text-white">{inv.customerName}</p>
                        <p className="text-[10px] text-slate-400 font-mono">GST: {inv.customerGstin}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {branch?.name || 'Main Branch'}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">
                        {inv.invoiceDate}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">
                        {inv.dueDate}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">
                        {settings.currencySymbol}{inv.subtotal.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500">
                        {settings.currencySymbol}{(inv.cgstAmount + inv.sgstAmount + inv.igstAmount).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {settings.currencySymbol}{inv.grandTotal.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {settings.currencySymbol}{inv.balanceAmount.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${paymentBadges[inv.paymentStatus]}`}>
                          {inv.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedInvoiceForPrint(inv)}
                            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                            title="Print / View Tax Invoice"
                          >
                            <Printer className="h-3 w-3 text-slate-800" />
                            <span>Print</span>
                          </button>

                          {inv.balanceAmount > 0 && (
                            <button
                              onClick={() => handleOpenPayment(inv)}
                              className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-slate-900 cursor-pointer"
                              title="Record Payment Collection"
                            >
                              <CreditCard className="h-3 w-3" />
                              <span>Collect</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Bulk Action Toolbar */}
      <BulkActionToolbar
        selectedCount={selectedIds.length}
        totalCount={filtered.length}
        itemName="invoice"
        isArchivedView={viewArchived}
        onClearSelection={() => setSelectedIds([])}
        onSelectAll={toggleSelectAll}
        statusOptions={statusOptions}
        onApplyStatus={handleBulkStatus}
        onArchive={handleBulkArchive}
        onRestore={handleBulkRestore}
        onExportSelection={handleExportCSV}
      />

      {/* Payment Collection Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Record Customer Payment</h3>
                <p className="text-xs text-slate-500">Invoice: {paymentModalInvoice.invoiceNumber}</p>
              </div>
              <button
                onClick={() => setPaymentModalInvoice(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePayment} className="p-4 space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Customer:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{paymentModalInvoice.customerName}</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Total Invoice Amount:</span>
                  <span className="font-mono">{settings.currencySymbol}{paymentModalInvoice.grandTotal.toLocaleString()}</span>
                </div>
                <div className="mt-1 flex justify-between font-bold text-rose-600 dark:text-rose-400">
                  <span>Remaining Outstanding Due:</span>
                  <span className="font-mono">{settings.currencySymbol}{paymentModalInvoice.balanceAmount.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Payment Amount ({settings.currencySymbol}) *</label>
                <input
                  type="number"
                  required
                  max={paymentModalInvoice.balanceAmount}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Payment Mode *</label>
                <select
                  value={paymentMethod}
                  onChange={(e: any) => setPaymentMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Bank Transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="Cheque">Bank Cheque</option>
                  <option value="UPI">UPI Payment</option>
                  <option value="Cash">Cash in Hand</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Transaction / Cheque Reference #</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. UTR-HDFC9823412 or Cheque #004312"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPaymentModalInvoice(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 cursor-pointer"
                >
                  Post Payment & Update Ledger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
