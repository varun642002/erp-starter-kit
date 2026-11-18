import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  Phone,
  Mail,
  MapPin,
  Building2,
  CreditCard,
  AlertTriangle,
  History,
  CheckCircle2,
  FileText,
  Download,
  FileSpreadsheet,
  ChevronDown,
  CheckSquare,
  Square,
  MinusSquare,
  ShieldCheck,
  ExternalLink,
  Upload,
  MoreVertical,
  Pencil,
  Trash2
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Customer } from '../../types/erp';
import { BulkActionToolbar } from '../common/BulkActionToolbar';
import { exportCustomersToCSV } from '../../utils/csvExport';
import { ImportCustomersModal } from '../common/ImportCustomersModal';
import { EditCustomerModal } from '../common/EditCustomerModal';
import { CustomerPurchases } from './CustomerPurchases';

export const CustomersView: React.FC = () => {
  const {
    customers,
    invoices,
    salesOrders,
    warranties,
    setCurrentView,
    openQuickAdd,
    settings,
    recordCustomerPayment,
    addAuditLog,
    showToast,
    currentRole,
    branches,
    deleteCustomer,
    refreshCustomers
  } = useERP();
  const canDelete = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  // Three-dots menu, drawn fixed so the table's scroll area cannot clip it.
  const [rowMenu, setRowMenu] = useState<{ cust: Customer; x: number; y: number } | null>(null);
  useEffect(() => {
    setSelectedCustomer((cur) => (cur ? customers.find((c) => c.id === cur.id) || cur : cur));
  }, [customers]);
  const canEdit = !['Warehouse Staff', 'Warehouse Manager'].includes(currentRole);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const filteredUnsorted = customers.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      c.companyName.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.alternatePhone && c.alternatePhone.toLowerCase().includes(q)) ||
      (c.customerId && c.customerId.toLowerCase().includes(q)) ||
      c.gstin.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q);

    const matchesCity = cityFilter === 'all' || c.city === cityFilter;
    const matchesBranch = branchFilter === 'all' || c.branchId === branchFilter;

    return matchesSearch && matchesCity && matchesBranch;
  });

  // Alphabetical by customer name, ascending or descending.
  const filtered = [...filteredUnsorted].sort((a, b) => {
    const cmp = (a.companyName || '').localeCompare(b.companyName || '', 'en', { sensitivity: 'base', numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const cities = Array.from(new Set(customers.map(c => c.city)));
  const debtorsCount = customers.filter(c => c.outstandingBalance > 0).length;

  const isAllSelected = filtered.length > 0 && filtered.every(c => selectedIds.includes(c.id));
  const isPartiallySelected = selectedIds.length > 0 && !isAllSelected && filtered.some(c => selectedIds.includes(c.id));

  // Sync indeterminate state on select-all checkbox
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  // Keyboard shortcut: Esc to clear selection or close dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isExportDropdownOpen) setIsExportDropdownOpen(false);
        if (selectedIds.length > 0) setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.length, isExportDropdownOpen]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setIsExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(c => c.id));
    }
  };

  const toggleSelectCustomer = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleExport = (scope: 'selected' | 'filtered' | 'all' | 'debtors') => {
    let listToExport: Customer[] = [];
    let label = '';

    if (scope === 'selected') {
      listToExport = customers.filter(c => selectedIds.includes(c.id));
      label = `${listToExport.length} selected customers`;
    } else if (scope === 'filtered') {
      listToExport = filtered;
      label = `${filtered.length} filtered customers`;
    } else if (scope === 'debtors') {
      listToExport = customers.filter(c => c.outstandingBalance > 0);
      label = `${listToExport.length} debtors with balance`;
    } else {
      listToExport = customers;
      label = `all ${customers.length} master customers`;
    }

    if (!listToExport.length) {
      showToast('No Records', 'No customer records found to export.', 'warning');
      return;
    }

    const filename = exportCustomersToCSV(
      listToExport,
      scope === 'debtors' ? 'AgroMachinery_ERP_Debtors_Outstanding' : 'AgroMachinery_ERP_Customers'
    );

    addAuditLog(
      'Exported Customers CSV',
      'Customers',
      `Manager exported ${listToExport.length} customer records to CSV (${filename}) for external reporting/auditing.`,
      { severity: 'info', entityType: 'Customer' }
    );

    showToast(
      'CSV Export Complete',
      `Successfully exported ${label} to ${filename}`,
      'success'
    );

    setIsExportDropdownOpen(false);
  };

  const warrantyBadge = (cust: (typeof customers)[number]) => {
    const custWarranties = warranties.filter((w) => w.customerId === cust.id);
    if (custWarranties.length === 0) return null;
    const hasExpiring = custWarranties.some((w) => {
      const end = new Date(w.warrantyEndDate);
      const diffDays = Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 30;
    });
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] font-bold ${
          hasExpiring
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 animate-pulse'
            : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
        }`}
      >
        <ShieldCheck className="h-3 w-3" />
        {custWarranties.length} {custWarranties.length === 1 ? 'Machinery S/N' : 'Machinery S/Ns'}
      </span>
    );
  };

  // Same menu as the table's three dots; used by the phone cards too.
  const openRowMenu = (e: React.MouseEvent<HTMLButtonElement>, cust: (typeof customers)[number]) => {
    const r = e.currentTarget.getBoundingClientRect();
    const menuHeight = 132;
    const below = window.innerHeight - r.bottom > menuHeight + 8;
    setRowMenu({
      cust,
      x: Math.max(8, r.right - 176),
      y: below ? r.bottom + 4 : Math.max(8, r.top - menuHeight - 4)
    });
  };

  return (
    <div className="space-y-6 pb-20 relative">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Central Customer Directory
            </h1>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
              {customers.length} Accounts
            </span>
            {debtorsCount > 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:bg-amber-950/80 dark:text-amber-300">
                {debtorsCount} with Due Balances
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:hidden">One customer list for all branches.</p>
          <p className="mt-0.5 hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
            One customer list for all branches: every branch sees the same customers, balances and history. Credit limits, outstanding ledgers and GSTIN in one place.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 max-sm:[&>*]:min-w-0">
          {/* Bulk Export CSV Dropdown */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              type="button"
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-98 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              title="Download customer directory in CSV format for auditing or reporting"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Export<span className="hidden sm:inline"> CSV</span></span>
              {selectedIds.length > 0 && (
                <span className="ml-0.5 rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {selectedIds.length}
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 mt-1.5 z-30 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-800 animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-700/60 mb-1">
                  Export Customers to CSV
                </div>

                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleExport('selected')}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50 cursor-pointer text-left"
                  >
                    <span className="flex items-center gap-2">
                      <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      Export Selected ({selectedIds.length})
                    </span>
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] dark:bg-indigo-900/60">
                      Selected
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleExport('filtered')}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60 cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Current Filtered View
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {filtered.length} rows
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport('all')}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60 cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    All Master Accounts
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {customers.length} total
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport('debtors')}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/50 cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Outstanding Debtors Only
                  </span>
                  <span className="font-mono text-[10px] text-amber-600">
                    {debtorsCount}
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-98 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            title="Import customer accounts from CSV file"
          >
            <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Import<span className="hidden sm:inline"> CSV</span></span>
          </button>

          <button
            onClick={() => openQuickAdd('customer')}
            className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 active:scale-98 cursor-pointer sm:flex-none"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Customer</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, company, GSTIN, phone"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 sm:h-8 sm:text-[11px] focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
            aria-label="Sort customers by name"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="asc">Name A to Z</option>
            <option value="desc">Name Z to A</option>
          </select>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by registered branch"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label="Filter by city"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All cities</option>
            {cities.map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Phones: one card per customer */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900">
            No customers found matching selected criteria.
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
              />
              Select all ({filtered.length})
            </label>
            {filtered.map((cust) => {
              const isSelected = selectedIds.includes(cust.id);
              return (
                <div
                  key={cust.id}
                  onClick={() => setSelectedCustomer(cust)}
                  className={`cursor-pointer rounded-xl border p-3.5 shadow-xs ${
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-950/40'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelectCustomer(cust.id)}
                      aria-label={`Select ${cust.companyName}`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{cust.companyName}</p>
                      {cust.branchId && (
                        <p className="text-[11px] text-slate-400">Registered at {branches.find((b) => b.id === cust.branchId)?.name || cust.branchId}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                        {cust.name && <span className="font-semibold">{cust.name}</span>}
                        {cust.phone && (
                          <a href={`tel:${cust.phone}`} onClick={(e) => e.stopPropagation()} className="font-mono text-indigo-600 dark:text-indigo-400">
                            {cust.phone}
                          </a>
                        )}
                        {cust.city && <span className="text-slate-500">{cust.city}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {cust.rating && (
                          <span className="inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            {cust.rating}
                          </span>
                        )}
                        {warrantyBadge(cust)}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Customer actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRowMenu(e, cust);
                      }}
                      className="-mr-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Customers Table */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs md:block dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-10 py-3 px-3 text-center">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 cursor-pointer"
                    title={isAllSelected ? "Deselect all" : "Select all customers"}
                  />
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    className="flex cursor-pointer items-center gap-1 font-bold hover:text-slate-900 dark:hover:text-white"
                    title="Sort by name"
                  >
                    Customer / Firm <span className="text-[10px]">{sortDir === 'asc' ? 'A-Z' : 'Z-A'}</span>
                  </button>
                </th>
                <th className="py-3 px-4">Contact Person</th>
                <th className="py-3 px-4">City / Region</th>
                <th className="py-3 px-4 text-center">Rating</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No customers found matching selected criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((cust) => {
                  const isSelected = selectedIds.includes(cust.id);

                  return (
                    <tr
                      key={cust.id}
                      onClick={() => setSelectedCustomer(cust)}
                      className={`cursor-pointer transition-colors ${
                        isSelected 
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/40' 
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="w-10 py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectCustomer(cust.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900 dark:text-white">{cust.companyName}</p>
                        {cust.branchId && (
                          <p className="text-[10px] text-slate-400">
                            Registered at {branches.find((b) => b.id === cust.branchId)?.name || cust.branchId}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-slate-400">{cust.email}</p>
                          {warrantyBadge(cust)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{cust.name}</p>
                        <p className="text-[10px] text-slate-400">{cust.phone}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        {cust.city}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {cust.rating}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label="Customer actions"
                          title="Actions"
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            const menuHeight = 132;
                            const below = window.innerHeight - r.bottom > menuHeight + 8;
                            setRowMenu({
                              cust,
                              x: Math.max(8, r.right - 176),
                              y: below ? r.bottom + 4 : Math.max(8, r.top - menuHeight - 4)
                            });
                          }}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
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
        itemName="customer"
        onClearSelection={() => setSelectedIds([])}
        onSelectAll={toggleSelectAll}
        onExportSelection={() => handleExport('selected')}
      />

      {/* Customer Ledger & Details Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{selectedCustomer.companyName}</h3>
                <p className="text-xs text-slate-500">Contact: {selectedCustomer.name} • {selectedCustomer.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={() => setCustomerToEdit(selectedCustomer)}
                    className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-900 dark:bg-slate-700 cursor-pointer"
                  >
                    Edit details
                  </button>
                )}
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Customer details */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-xl border border-slate-200 p-4 text-xs sm:grid-cols-2 dark:border-slate-800">
                {(
                  [
                    ['Customer ID', selectedCustomer.customerId],
                    ['Contact person', selectedCustomer.name],
                    ['Mobile', selectedCustomer.phone],
                    ['Alternate mobile', selectedCustomer.alternatePhone],
                    ['Email', selectedCustomer.email],
                    ['GSTIN', selectedCustomer.gstin],
                    ['Address', selectedCustomer.address],
                    [
                      'Town / state',
                      [selectedCustomer.locality, selectedCustomer.city, selectedCustomer.state, selectedCustomer.pincode]
                        .filter(Boolean)
                        .join(', ')
                    ],
                    ['Branch', branches.find((b) => b.id === selectedCustomer.branchId)?.name || selectedCustomer.branchId],
                    ['Rating', selectedCustomer.rating]
                  ] as [string, string | undefined][]
                )
                  .filter(([label, value]) => !!value || !['Email', 'GSTIN'].includes(label))
                  .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-right font-semibold text-slate-800 dark:text-slate-200 break-words">{value || '-'}</span>
                  </div>
                ))}
              </div>

              {/* Registered Machinery Serials & Warranties */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    Registered Agro Machinery & Serial Numbers
                  </h4>
                  <button
                    onClick={() => {
                      setSelectedCustomer(null);
                      setCurrentView('warranties');
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    Manage in Warranties Hub
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>

                {(() => {
                  const custWarranties = warranties.filter(w => w.customerId === selectedCustomer.id);
                  if (custWarranties.length === 0) {
                    return (
                      <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">
                        No machinery serial numbers or active warranties currently registered for this customer.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {custWarranties.map(w => {
                        const end = new Date(w.warrantyEndDate);
                        const diffDays = Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                        const isExpired = diffDays < 0;
                        const isExpiringSoon = diffDays >= 0 && diffDays <= 30;

                        return (
                          <div
                            key={w.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/40"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                                  {w.serialNumber}
                                </span>
                                {w.engineNumber && w.engineNumber !== 'N/A' && (
                                  <span className="font-mono text-[10px] text-slate-500">
                                    Eng: {w.engineNumber}
                                  </span>
                                )}
                                <span className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                  isExpired
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    : isExpiringSoon
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}>
                                  {isExpired ? `Expired (${Math.abs(diffDays)}d ago)` : isExpiringSoon ? `Expiring in ${diffDays}d` : `${diffDays}d active`}
                                </span>
                              </div>
                              <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                                {w.productName}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                Coverage: {w.coverageType} • Valid until: {w.warrantyEndDate}
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setSelectedCustomer(null);
                                setCurrentView('warranties');
                              }}
                              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300 cursor-pointer"
                            >
                              Warranty Details
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Machines bought and quick sale history */}
              <CustomerPurchases customerId={selectedCustomer.id} customerName={selectedCustomer.companyName || selectedCustomer.name} phone={selectedCustomer.phone} currency={settings.currencySymbol || '₹'} />

              {/* Invoices list */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Billed Tax Invoices</h4>
                <div className="rounded-lg border border-slate-200 overflow-hidden dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="py-2 px-3">Invoice #</th>
                        <th className="py-2 px-3 text-center">Date</th>
                        <th className="py-2 px-3 text-right">Total</th>
                        <th className="py-2 px-3 text-right">Balance Due</th>
                        <th className="py-2 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {invoices
                        .filter(i => i.customerId === selectedCustomer.id)
                        .map(inv => (
                          <tr key={inv.id}>
                            <td className="py-2 px-3 font-mono font-semibold">{inv.invoiceNumber}</td>
                            <td className="py-2 px-3 text-center font-mono text-slate-500">{inv.invoiceDate}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold">
                              {settings.currencySymbol}{inv.grandTotal.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-rose-600">
                              {settings.currencySymbol}{inv.balanceAmount.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                {inv.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3 text-right dark:border-slate-800 dark:bg-slate-800/50">
              <button
                onClick={() => setSelectedCustomer(null)}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-indigo-600 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Customers CSV Modal */}
      {rowMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowMenu(null)} />
          <div
            className="fixed z-50 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900"
            style={{ left: rowMenu.x, top: rowMenu.y }}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedCustomer(rowMenu.cust);
                setRowMenu(null);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <History className="h-4 w-4 text-slate-500" /> Details &amp; ledger
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setCustomerToEdit(rowMenu.cust);
                  setRowMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Pencil className="h-4 w-4 text-slate-500" /> Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  setDeleteError('');
                  setCustomerToDelete(rowMenu.cust);
                  setRowMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
        </>
      )}

      <EditCustomerModal customer={customerToEdit} onClose={() => setCustomerToEdit(null)} />

      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Delete customer?</h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              <strong>{customerToDelete.companyName}</strong> ({customerToDelete.phone}) will be removed from the database. Past
              invoices and orders keep the name they were issued to. This cannot be undone.
            </p>
            {deleteError && (
              <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCustomerToDelete(null)}
                disabled={isDeleting}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsDeleting(true);
                  setDeleteError('');
                  try {
                    await deleteCustomer(customerToDelete.id);
                    setSelectedIds(prev => prev.filter(id => id !== customerToDelete.id));
                    setCustomerToDelete(null);
                  } catch (e: any) {
                    setDeleteError(e?.message || 'Could not delete this customer.');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImportCustomersModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingCustomers={customers}
        onImportComplete={() => {
          refreshCustomers();
          showToast('Customer Import Complete', 'Customer accounts imported into SQL database successfully.', 'success');
        }}
        showToast={(msg, type) => showToast('Customer Import', msg, type)}
      />
    </div>
  );
};

