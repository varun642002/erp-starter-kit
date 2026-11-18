import React, { useState, useRef, useEffect } from 'react';
import {
  ShoppingCart,
  Plus,
  Search,
  FileText,
  Truck,
  CheckCircle2,
  Clock,
  Eye,
  ArrowRight,
  MoreVertical,
  Layers,
  FileCheck,
  Archive,
  ArchiveRestore,
  Printer,
  Download,
  ShieldAlert,
  Zap
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { SalesOrder, SalesOrderStatus } from '../../types/erp';
import { BulkActionToolbar, StatusOption } from '../common/BulkActionToolbar';
import { BatchPrintModal } from '../common/BatchPrintModal';

export const SalesView: React.FC = () => {
  const {
    currentRole,
    setCurrentView,
    filteredSalesOrders,
    customers,
    branches,
    warehouses,
    settings,
    openQuickAdd,
    convertSalesOrderToInvoice,
    bulkUpdateSalesOrderStatus,
    bulkArchiveSalesOrders,
    bulkConfirmSalesOrders,
    setActiveInvoiceForPrint
  } = useERP();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto my-12 rounded-2xl border border-amber-200 bg-amber-50/70 p-8 text-center dark:border-amber-900/60 dark:bg-slate-900 shadow-sm animate-in fade-in zoom-in-95">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400 mb-4">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Access Restricted: Business Owner Only
        </h2>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Sales Orders are strictly managed at the executive level by the Business Owner.
          Branch staff must use <strong>+ Quick Sale</strong> for counter transactions and <strong>Billing & Invoices</strong> for customer bills.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => setCurrentView('quick-sale')}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-blue-500 cursor-pointer"
          >
            <Zap className="h-4 w-4" />
            <span>Go to + Quick Sale</span>
          </button>
          <button
            onClick={() => setCurrentView('billing')}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            <span>View Billing & Invoices</span>
          </button>
        </div>
      </div>
    );
  }

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewArchived, setViewArchived] = useState<boolean>(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBatchPrintOpen, setIsBatchPrintOpen] = useState(false);

  const selectAllRef = useRef<HTMLInputElement>(null);

  const filteredOrders = filteredSalesOrders.filter((order) => {
    const isArchived = Boolean(order.isArchived);
    if (viewArchived !== isArchived) return false;

    const matchesSearch =
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.salesperson.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Handle header select all checkbox state
  const isAllSelected = filteredOrders.length > 0 && filteredOrders.every(so => selectedIds.includes(so.id));
  const isPartiallySelected = selectedIds.length > 0 && !isAllSelected && filteredOrders.some(so => selectedIds.includes(so.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const visibleIds = filteredOrders.map(so => so.id);
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      const visibleIds = filteredOrders.map(so => so.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Keyboard shortcut: Esc to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.length > 0) {
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.length]);

  const handleConvertInvoice = (order: SalesOrder) => {
    const newInv = convertSalesOrderToInvoice(order.id);
    if (newInv) {
      setActiveInvoiceForPrint(newInv);
    }
  };

  // Bulk Operations Handlers
  const handleBulkStatus = (status: string) => {
    bulkUpdateSalesOrderStatus(selectedIds, status as SalesOrderStatus);
    setSelectedIds([]);
  };

  const handleBulkArchive = () => {
    bulkArchiveSalesOrders(selectedIds, true);
    setSelectedIds([]);
  };

  const handleBulkRestore = () => {
    bulkArchiveSalesOrders(selectedIds, false);
    setSelectedIds([]);
  };

  const handleBulkConfirm = () => {
    bulkConfirmSalesOrders(selectedIds);
    setSelectedIds([]);
  };

  const handleExportCSV = () => {
    const ordersToExport = filteredOrders.filter(so => selectedIds.includes(so.id));
    if (!ordersToExport.length) return;

    let csvContent = 'Order Number,Customer Name,Salesperson,Branch ID,Order Date,Expected Delivery,Items Count,Subtotal,Tax Amount,Grand Total,Payment Status,Status\n';
    ordersToExport.forEach(so => {
      csvContent += `"${so.orderNumber}","${so.customerName.replace(/"/g, '""')}","${so.salesperson}","${so.branchId}","${so.orderDate}","${so.expectedDeliveryDate}",${so.items.length},${so.subtotal},${so.taxAmount},${so.grandTotal},"${so.paymentStatus}","${so.status}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Sales_Orders_Bulk_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedSalesOrders = filteredSalesOrders.filter(so => selectedIds.includes(so.id));

  const statusOptions: StatusOption[] = [
    { value: 'Draft', label: 'Draft', badgeClass: 'bg-slate-100 text-slate-700' },
    { value: 'Confirmed', label: 'Confirmed', badgeClass: 'bg-slate-200 text-slate-900' },
    { value: 'Processing', label: 'Processing', badgeClass: 'bg-amber-100 text-amber-800' },
    { value: 'Dispatched', label: 'Dispatched', badgeClass: 'bg-indigo-100 text-indigo-800' },
    { value: 'Delivered', label: 'Delivered', badgeClass: 'bg-emerald-100 text-emerald-800' },
    { value: 'Cancelled', label: 'Cancelled', badgeClass: 'bg-rose-100 text-rose-800' }
  ];

  return (
    <div className="space-y-6 pb-20 relative">
      {/* Top Header & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Sales Orders & Quotations
            </h1>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-900 dark:bg-slate-900/80 dark:text-slate-300">
              {filteredSalesOrders.filter(o => !o.isArchived).length} Orders
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage client quotations, confirm material delivery schedules, dispatch batches and generate GST invoices.
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
              Active Orders
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
            <span>Create Sales Order</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by order #, contractor, salesperson"
            aria-label="Search orders"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Order status"
            className="h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Processing">Processing</option>
            <option value="Dispatched">Dispatched</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Main Sales Orders Table */}
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
                    title="Select all visible orders"
                  />
                </th>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Client / Contractor</th>
                <th className="py-3 px-4">Branch & Dispatch Yard</th>
                <th className="py-3 px-4 text-center">Date</th>
                <th className="py-3 px-4 text-right">Items</th>
                <th className="py-3 px-4 text-right">Order Value</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    {viewArchived ? 'No archived sales orders found.' : 'No sales orders found matching selected filters.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const isSelected = selectedIds.includes(order.id);
                  const branch = branches.find(b => b.id === order.branchId);
                  const warehouse = warehouses.find(w => w.id === order.warehouseId);

                  const statusBadges: Record<SalesOrderStatus, string> = {
                    Draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                    Confirmed: 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-800',
                    Processing: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
                    Dispatched: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
                    Delivered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
                    Cancelled: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  };

                  return (
                    <tr
                      key={order.id}
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
                          onChange={() => toggleSelect(order.id)}
                          className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {order.orderNumber}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900 dark:text-white">{order.customerName}</p>
                        <p className="text-[10px] text-slate-400">Rep: {order.salesperson}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <p className="font-medium">{branch?.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">Yard: {warehouse?.name}</p>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">
                        {order.orderDate}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-700 dark:text-slate-300">
                        {order.items.length} SKUs
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {settings.currencySymbol}{order.grandTotal.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${statusBadges[order.status]}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedOrder(order)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                            title="View Order Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {order.status === 'Confirmed' && (
                            <button
                              onClick={() => handleConvertInvoice(order)}
                              className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-emerald-500 cursor-pointer"
                              title="Generate GST Invoice"
                            >
                              <FileCheck className="h-3 w-3" />
                              <span>Invoice</span>
                            </button>
                          )}

                          {order.status === 'Draft' && (
                            <button
                              onClick={() => bulkConfirmSalesOrders([order.id])}
                              className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 cursor-pointer"
                            >
                              Confirm
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
        totalCount={filteredOrders.length}
        itemName="sales order"
        isArchivedView={viewArchived}
        onClearSelection={() => setSelectedIds([])}
        onSelectAll={toggleSelectAll}
        statusOptions={statusOptions}
        onApplyStatus={handleBulkStatus}
        onArchive={handleBulkArchive}
        onRestore={handleBulkRestore}
        onPrintSelection={() => setIsBatchPrintOpen(true)}
        onExportSelection={handleExportCSV}
        customActions={[
          {
            id: 'confirm_all',
            label: 'Confirm All Selected',
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-white" />,
            variant: 'emerald',
            onClick: handleBulkConfirm
          }
        ]}
      />

      {/* Batch Print Modal */}
      <BatchPrintModal
        isOpen={isBatchPrintOpen}
        onClose={() => setIsBatchPrintOpen(false)}
        type="sales"
        selectedSalesOrders={selectedSalesOrders}
      />

      {/* Order Details Drawer / Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                  Sales Order #{selectedOrder.orderNumber}
                </h3>
                <p className="text-xs text-slate-500">Customer: {selectedOrder.customerName}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Order Date</span>
                  <p className="font-mono font-semibold text-slate-900 dark:text-white">{selectedOrder.orderDate}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Delivery By</span>
                  <p className="font-mono font-semibold text-slate-900 dark:text-white">{selectedOrder.expectedDeliveryDate}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Status</span>
                  <p className="font-bold text-slate-800 dark:text-slate-200">{selectedOrder.status}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Salesperson</span>
                  <p className="font-semibold text-slate-900 dark:text-white">{selectedOrder.salesperson}</p>
                </div>
              </div>

              {/* Items */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Booked Line Items</h4>
                <div className="rounded-lg border border-slate-200 overflow-hidden dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3 text-right">Qty</th>
                        <th className="py-2 px-3 text-right">Rate</th>
                        <th className="py-2 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedOrder.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-slate-900 dark:text-white">{it.productName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">SKU: {it.sku}</p>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{it.quantity} {it.unit}</td>
                          <td className="py-2 px-3 text-right font-mono">{settings.currencySymbol}{it.rate}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {settings.currencySymbol}{it.totalAmount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total summary */}
              <div className="flex justify-end pt-2">
                <div className="w-64 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal:</span>
                    <span className="font-mono">{settings.currencySymbol}{selectedOrder.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Tax (GST):</span>
                    <span className="font-mono">{settings.currencySymbol}{selectedOrder.taxAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900 dark:border-slate-800 dark:text-white">
                    <span>Grand Total:</span>
                    <span className="font-mono text-slate-900 dark:text-white">{settings.currencySymbol}{selectedOrder.grandTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                {selectedOrder.status !== 'Delivered' && (
                  <button
                    onClick={() => {
                      bulkUpdateSalesOrderStatus([selectedOrder.id], 'Dispatched');
                      setSelectedOrder(null);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <Truck className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Mark Dispatched</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleConvertInvoice(selectedOrder);
                    setSelectedOrder(null);
                  }}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Generate Invoice</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
