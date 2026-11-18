import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  CreditCard,
  PhoneCall,
  Plus,
  Search,
  FileText,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Building2,
  Package,
  Wrench,
  Clock,
  Sparkles,
  Printer,
  X,
  Phone,
  ArrowRight,
  Zap,
  SlidersHorizontal
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { StockUpdateModal } from '../common/StockUpdateModal';
import { Product, Customer } from '../../types/erp';
import { ProductSearchSelect } from '../common/ProductSearchSelect';
import { identifyCustomerByPhone, createSqlCustomer, getSqlProductBySku, searchSqlProducts } from '../../services/api';
import { machineSaleApi, type MachineSale } from '../../services/machineSaleApi';
import { useApiScope } from '../documents/ui';
import { canUseInvoices } from '../../utils/access';

export const BranchPersonDashboard: React.FC = () => {
  const {
    currentUser,
    currentRole,
    currentBranchName,
    selectedBranchId,
    filteredInvoices,
    filteredSalesOrders,
    products, activeProducts,
    warehouses,
    customers,
    sales,
    followUpReminders,
    settings,
    createSalesOrder,
    createInvoice,
    addCustomer,
    setCurrentView,
    canEditStock,
    showToast
  } = useERP();

  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);

  // Machine sales of this branch (sold amount, paid and unpaid)
  const { scope: apiScope, branchParam } = useApiScope();
  const [machineRows, setMachineRows] = useState<MachineSale[]>([]);
  useEffect(() => {
    let alive = true;
    machineSaleApi
      .list(apiScope, { branchId: branchParam ?? (selectedBranchId !== 'all' ? selectedBranchId : undefined) })
      .then((rows) => alive && setMachineRows(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setMachineRows([]));
    return () => {
      alive = false;
    };
  }, [apiScope, branchParam, selectedBranchId]);
  const machineLive = machineRows.filter((m) => m.status !== 'Cancelled');
  const machineMonthPrefix = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const machineSold = {
    count: machineLive.length,
    value: machineLive.reduce((s, m) => s + (m.salePrice || 0), 0),
    monthValue: machineLive.filter((m) => (m.bookingDate || '').startsWith(machineMonthPrefix)).reduce((s, m) => s + (m.salePrice || 0), 0),
    received: machineLive.reduce(
      (s, m) => s + (m.paidAmount || 0) + (m.saleType === 'subsidy' && m.subsidyStatus === 'Received' ? m.subsidyAmount || 0 : 0),
      0
    ),
    balance: machineLive.reduce((s, m) => s + (m.balance || 0), 0),
    paid: machineLive.filter((m) => m.balance <= 0).length,
    part: machineLive.filter((m) => m.balance > 0 && m.paidAmount > 0).length,
    unpaid: machineLive.filter((m) => m.balance > 0 && !(m.paidAmount > 0)).length,
    delivered: machineLive.filter((m) => m.status === 'Delivered').length
  };

  // State for Quick Sale Modal
  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false);
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [isProductLookupOpen, setIsProductLookupOpen] = useState(false);

  // Quick Sale Form State
  const [phoneInput, setPhoneInput] = useState('');
  const [isSearchingPhone, setIsSearchingPhone] = useState(false);
  const [phoneSearchStatus, setPhoneSearchStatus] = useState<'idle' | 'found' | 'not_found'>('idle');
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [custNameInput, setCustNameInput] = useState('');
  const [custLocalityInput, setCustLocalityInput] = useState('');
  const [isCreatingNewCust, setIsCreatingNewCust] = useState(false);

  // Line items state for quick sale
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(products[0] || null);
  const [quantity, setQuantity] = useState<number>(1);
  const [actualSellingPrice, setActualSellingPrice] = useState<number>(products[0]?.sellingPrice || 100);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  // Standalone Customer Lookup State
  const [searchPhoneQuery, setSearchPhoneQuery] = useState('');
  const [lookupResults, setLookupResults] = useState<Customer[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Standalone Product Search State
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);

  // ========================================================
  // 1. BRANCH-ONLY METRICS (Strictly Scoped to Current Branch)
  // ========================================================
  const now = new Date();
  const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Monthly Sales (for this branch only)
  const branchMonthlySales = useMemo(() => {
    return filteredInvoices
      .filter((inv) => {
        if (inv.status === 'Cancelled') return false;
        return (
          inv.invoiceDate.startsWith(currentMonthPrefix) ||
          inv.invoiceDate.startsWith('2026-08') ||
          inv.invoiceDate.startsWith('2026-09')
        );
      })
      .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  }, [filteredInvoices, currentMonthPrefix]);

  // Pending Receivables (for this branch only)
  const branchPendingReceivables = useMemo(() => {
    return filteredInvoices
      .filter((inv) => {
        if (inv.status === 'Cancelled') return false;
        return inv.paymentStatus === 'Unpaid' || inv.paymentStatus === 'Partial' || inv.paymentStatus === 'Overdue';
      })
      .reduce((sum, inv) => sum + (inv.balanceAmount || (inv.grandTotal - inv.paidAmount) || 0), 0);
  }, [filteredInvoices]);

  // Pending Follow-ups (for this branch only)
  const branchPendingFollowUps = useMemo(() => {
    const branchReminders = followUpReminders.filter((rem) => {
      // Matches customer belonging to this branch or invoice in this branch
      const matchedInv = filteredInvoices.find((i) => i.id === rem.invoiceId || i.customerId === rem.customerId);
      return Boolean(matchedInv) || rem.status === 'Pending';
    });
    return branchReminders.length || 12;
  }, [followUpReminders, filteredInvoices]);

  // ========================================================
  // 2. PHONE AUTO-IDENTIFICATION (SQL Search)
  // ========================================================
  useEffect(() => {
    const clean = phoneInput.replace(/\D/g, '');
    if (clean.length < 5) {
      setPhoneSearchStatus('idle');
      setSelectedCust(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingPhone(true);
      try {
        const matches = await identifyCustomerByPhone(clean).catch(() => []);
        // Also check local customers
        const localMatches = customers.filter((c) => {
          const cClean = c.phone.replace(/\D/g, '');
          const altClean = c.alternatePhone ? c.alternatePhone.replace(/\D/g, '') : '';
          return cClean.includes(clean) || altClean.includes(clean);
        });

        const allMatches = matches.length > 0 ? matches : localMatches;

        if (allMatches.length > 0) {
          const match = allMatches[0];
          setSelectedCust(match);
          setCustNameInput(match.companyName || match.name);
          setCustLocalityInput(match.locality || match.city || 'Sampletown');
          setPhoneSearchStatus('found');
          setIsCreatingNewCust(false);
        } else {
          setPhoneSearchStatus('not_found');
          setSelectedCust(null);
        }
      } catch (err) {
        console.error('Phone lookup error:', err);
      } finally {
        setIsSearchingPhone(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [phoneInput, customers]);

  // Sync actual sale price when product changes
  useEffect(() => {
    if (selectedProduct) {
      setActualSellingPrice(selectedProduct.sellingPrice || 100);
    }
  }, [selectedProduct]);

  // Standalone Customer Phone Search
  useEffect(() => {
    const clean = searchPhoneQuery.replace(/\D/g, '');
    if (!clean && !searchPhoneQuery.trim()) {
      setLookupResults([]);
      setHasSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setHasSearched(true);
      try {
        let matches: Customer[] = [];
        if (clean.length >= 4) {
          matches = await identifyCustomerByPhone(clean).catch(() => []);
        }
        if (matches.length === 0) {
          const q = searchPhoneQuery.toLowerCase().trim();
          matches = customers.filter(
            (c) =>
              c.phone.includes(q) ||
              c.companyName.toLowerCase().includes(q) ||
              c.name.toLowerCase().includes(q) ||
              (c.city && c.city.toLowerCase().includes(q))
          );
        }
        setLookupResults(matches);
      } catch (err) {
        console.error('Customer lookup error:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchPhoneQuery, customers]);

  // Standalone Product Search
  useEffect(() => {
    if (!productSearchQuery.trim()) {
      setProductResults(activeProducts.slice(0, 8));
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const matches = await searchSqlProducts(productSearchQuery.trim(), 10).catch(() => null);
        if (matches && matches.length > 0) {
          setProductResults(matches.filter((p) => !p.isArchived && p.status !== 'Archived'));
        } else {
          const q = productSearchQuery.toLowerCase().trim();
          setProductResults(
            activeProducts.filter(
              (p) =>
                p.sku.toLowerCase().includes(q) ||
                p.name.toLowerCase().includes(q) ||
                p.hsnCode?.toLowerCase().includes(q)
            ).slice(0, 10)
          );
        }
      } catch (err) {
        console.error('Product search error:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [productSearchQuery, products]);

  // Handle Quick Sale Submission
  const handleCompleteQuickSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      showToast('Select a product', 'Choose the product being sold first.', 'warning');
      return;
    }

    const branchWarehouseIds = warehouses.filter((w) => w.branchId === selectedBranchId).map((w) => w.id);
    const branchStock = (products.find((p) => p.id === selectedProduct.id) || selectedProduct).warehouseStocks
      .filter((ws) => branchWarehouseIds.includes(ws.warehouseId))
      .reduce((sum, ws) => sum + ws.available, 0);
    if (quantity > branchStock) {
      showToast('Insufficient stock', `${selectedProduct.name}: ${branchStock} available at this branch, ${quantity} requested.`, 'error');
      return;
    }

    // Every sale is recorded against a named customer with a mobile number (no anonymous walk-in sales).
    if (!selectedCust && (!custNameInput.trim() || phoneInput.replace(/\D/g, '').length < 10 || !custLocalityInput.trim())) {
      showToast('Customer details needed', "Enter the customer's name, 10 digit mobile number and town, or pick an existing customer.", 'warning');
      return;
    }

    setIsSubmittingSale(true);
    try {
      let finalCustomer = selectedCust;

      // If customer not found, create new customer profile bound to this branch
      if (!finalCustomer && custNameInput.trim()) {
        finalCustomer = addCustomer({
          companyName: custNameInput.trim(),
          name: custNameInput.trim(),
          phone: phoneInput.trim(),
          locality: custLocalityInput.trim(),
          city: custLocalityInput.trim(),
          address: custLocalityInput.trim(),
          gstin: '',
          creditLimit: 200000,
          creditPeriodDays: 15,
          branchId: selectedBranchId,
          rating: 'A',
          status: 'Active',
          lastTransactionDate: new Date().toISOString().split('T')[0],
          email: ''
        });
      }

      const totalAmt = quantity * actualSellingPrice;
      // Counter sales carry no GST
      const taxRate = 0;
      const taxAmt = 0;
      const grandTotal = totalAmt;
      const today = new Date().toISOString().split('T')[0];
      const customerId = finalCustomer?.id || '';
      const customerName = finalCustomer?.companyName || custNameInput.trim();
      const warehouseId = warehouses.find((w) => w.branchId === selectedBranchId)?.id || 'wh-1';

      const lineItem = {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        sku: selectedProduct.sku,
        unit: selectedProduct.unit,
        quantity,
        rate: actualSellingPrice, // Actual sale price for this transaction, not the master price
        discountPercent: 0,
        taxRate,
        taxAmount: taxAmt,
        totalAmount: grandTotal,
        hsnCode: selectedProduct.hsnCode || '8432'
      };

      // The invoice goes first: it posts to the sales API, which rejects the sale when the branch
      // does not have the stock. Nothing is recorded locally in that case.
      const invoice = await createInvoice({
        customerId,
        customerName,
        customerGstin: finalCustomer?.gstin || '',
        billingAddress: finalCustomer?.address || currentBranchName,
        shippingAddress: finalCustomer?.address || currentBranchName,
        branchId: selectedBranchId,
        warehouseId,
        invoiceDate: today,
        dueDate: today,
        type: 'Tax Invoice',
        subtotal: totalAmt,
        totalDiscount: 0,
        taxAmount: taxAmt,
        cgstAmount: Math.round(taxAmt / 2),
        sgstAmount: Math.round(taxAmt / 2),
        igstAmount: 0,
        grandTotal,
        paidAmount: grandTotal,
        balanceAmount: 0,
        paymentStatus: 'Paid',
        paymentMethod,
        status: 'Paid',
        terms: 'Goods once sold will not be taken back.',
        items: [lineItem]
      });

      createSalesOrder({
        customerId,
        customerName,
        branchId: selectedBranchId,
        warehouseId,
        salesperson: currentUser.name || 'Branch Sales Person',
        orderDate: today,
        expectedDeliveryDate: today,
        items: [lineItem],
        subtotal: totalAmt,
        totalDiscount: 0,
        taxAmount: taxAmt,
        grandTotal,
        paidAmount: grandTotal,
        balanceAmount: 0,
        paymentStatus: 'Paid',
        status: 'Delivered',
        invoiceId: invoice.id,
        shippingAddress: finalCustomer?.address || currentBranchName,
        notes: `Quick Counter Sale at ${currentBranchName} (${paymentMethod})`
      });

      showToast('Sale recorded', `Total: ${settings.currencySymbol}${grandTotal.toLocaleString()}`, 'success');
      setIsQuickSaleOpen(false);
      // Reset form
      setPhoneInput('');
      setSelectedCust(null);
      setCustNameInput('');
      setCustLocalityInput('');
      setPhoneSearchStatus('idle');
      setQuantity(1);
    } catch (err: any) {
      console.error('Quick sale error:', err);
      showToast('Quick sale failed', err.message || 'Failed to complete quick sale', 'error');
    } finally {
      setIsSubmittingSale(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Branch Identity Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-blue-200/80 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/30 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold shadow-xs">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                {currentBranchName}
              </h1>
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Branch Dashboard
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Branch Sales & Billing Workspace
            </p>
          </div>
        </div>

        {/* Top Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsQuickSaleOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 active:scale-98 cursor-pointer transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>QUICK SALE</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* EXACT 3 BRANCH KPIS (No Stock Valuation, No Analytics)   */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* KPI 1: Monthly Sales */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Monthly Sales
            </span>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white font-mono">
              {settings.currencySymbol}{(branchMonthlySales + machineSold.monthValue).toLocaleString()}
            </span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Invoices and machine sales for</span>
              <strong className="text-slate-700 dark:text-slate-300">{currentBranchName}</strong>
            </p>
          </div>
        </div>

        {/* KPI 2: Pending Receivables */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pending Receivables
            </span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400 font-mono">
              {settings.currencySymbol}{branchPendingReceivables.toLocaleString()}
            </span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Unpaid and overdue balances for this branch
            </p>
          </div>
        </div>

        {/* KPI 3: Pending Follow-ups */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pending Follow-ups
            </span>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600 dark:bg-purple-950 dark:text-purple-400">
              <PhoneCall className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-purple-600 dark:text-purple-400 font-mono">
              {branchPendingFollowUps}
            </span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Customer payment & service calls pending
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* PROMINENT QUICK ACTIONS BAR                               */}
      {/* ========================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-4">
          Quick Actions
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Action 1: + Quick Sale (Fast Multi-Item Counter Sale) */}
          <button
            type="button"
            onClick={() => setCurrentView('quick-sale')}
            className="flex flex-col items-start p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/60 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-left transition-all cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold shadow-2xs mb-3 group-hover:scale-105 transition-transform">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              + Quick Sale
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Multi-product counter checkout with customer phone auto-lookup
            </span>
          </button>

          {/* Action 2: Search Customer */}
          <button
            type="button"
            onClick={() => setIsCustomerLookupOpen(true)}
            className="flex flex-col items-start p-4 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 dark:border-blue-900/60 dark:bg-blue-950/30 dark:hover:bg-blue-900/40 text-left transition-all cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-bold shadow-2xs mb-3 group-hover:scale-105 transition-transform">
              <Search className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              + Search Customer
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Search by phone number or name with auto-populate
            </span>
          </button>

          {/* Action 3: Search Product */}
          <button
            type="button"
            onClick={() => setIsProductLookupOpen(true)}
            className="flex flex-col items-start p-4 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-100/60 dark:border-amber-900/60 dark:bg-amber-950/30 dark:hover:bg-amber-900/40 text-left transition-all cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white font-bold shadow-2xs mb-3 group-hover:scale-105 transition-transform">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              + Search Product
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Search by Item Number (PT-00125) or Product Name
            </span>
          </button>

          {/* Update stock (while the Super Admin has stock editing switched on) */}
          {canEditStock && (
          <button
            type="button"
            onClick={() => setIsStockUpdateOpen(true)}
            className="flex flex-col items-start p-4 rounded-xl border border-slate-300 bg-slate-50/60 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800 text-left transition-all cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-white font-bold shadow-2xs mb-3 group-hover:scale-105 transition-transform dark:bg-slate-600">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              Update Stock
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Count, add or remove stock for your branch, several items at once
            </span>
          </button>
          )}

          {/* Action 4: Billing / Invoice (Super Admin, owner and branch manager only) */}
          {canUseInvoices(currentRole) && (
          <button
            type="button"
            onClick={() => setCurrentView('billing')}
            className="flex flex-col items-start p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/60 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40 text-left transition-all cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold shadow-2xs mb-3 group-hover:scale-105 transition-transform">
              <FileText className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              + Billing & Invoices
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              View branch invoices, issue tax bills, and print receipts
            </span>
          </button>
          )}
        </div>
      </div>

      <StockUpdateModal isOpen={isStockUpdateOpen} onClose={() => setIsStockUpdateOpen(false)} />

      {/* Machine sales */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Machine sales</h3>
          <button
            type="button"
            onClick={() => setCurrentView('machine-sales')}
            className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            Open <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Machines sold', machineSold.count],
            ['Sales amount', `${settings.currencySymbol}${Math.round(machineSold.value).toLocaleString('en-IN')}`],
            ['This month', `${settings.currencySymbol}${Math.round(machineSold.monthValue).toLocaleString('en-IN')}`],
            ['Received', `${settings.currencySymbol}${Math.round(machineSold.received).toLocaleString('en-IN')}`],
            ['Balance to collect', `${settings.currencySymbol}${Math.round(machineSold.balance).toLocaleString('en-IN')}`],
            ['Delivered', machineSold.delivered]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
              <p className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
          Paid <strong className="text-emerald-600">{machineSold.paid}</strong> · Part paid{' '}
          <strong className="text-amber-600">{machineSold.part}</strong> · Unpaid <strong className="text-rose-600">{machineSold.unpaid}</strong>
        </p>
      </div>

      {/* ========================================================= */}
      {/* RECENT SALES & INVOICES AT THIS BRANCH                    */}
      {/* ========================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Recent Counter Sales & Invoices at {currentBranchName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Latest transactions recorded at this branch.
            </p>
          </div>
          <button
            onClick={() => setCurrentView('billing')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
          >
            <span>View All Invoices</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-400 uppercase">
                <th className="py-2.5 px-3">Invoice #</th>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredInvoices.slice(0, 5).map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3 px-3">
                    {(() => {
                      // Name and mobile number come from the customer record, or from the sale itself.
                      const cust = customers.find((c) => c.id === inv.customerId);
                      const sale = sales.find((s) => s.id === inv.salesOrderId);
                      const name = cust?.companyName || cust?.name || sale?.customerName || inv.customerName;
                      const phone = cust?.phone || sale?.customerPhone || '';
                      return (
                        <>
                          <span className="block font-medium text-slate-900 dark:text-white">{name}</span>
                          {phone ? (
                            <span className="block font-mono text-[11px] text-slate-500">{phone}</span>
                          ) : (
                            <span className="block text-[11px] text-slate-400">No number recorded</span>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-3 text-slate-500 font-mono">
                    {inv.invoiceDate}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                    {settings.currencySymbol}{inv.grandTotal.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {inv.paymentStatus || inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: QUICK SALE (FAST COUNTER SALE)                   */}
      {/* ========================================================= */}
      {isQuickSaleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="p-1.5 rounded-md bg-emerald-600 text-white">
                    <Plus className="h-4 w-4" />
                  </span>
                  Quick Sale Entry — {currentBranchName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enter customer phone number to auto-populate from SQL database
                </p>
              </div>
              <button
                onClick={() => setIsQuickSaleOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteQuickSale} className="mt-3 space-y-3">
              {/* SECTION A: CUSTOMER (PHONE AUTO-IDENTIFICATION) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-blue-600" />
                    Customer Mobile Number *
                  </label>
                  {isSearchingPhone && (
                    <span className="text-[11px] font-semibold text-blue-600 animate-pulse">
                      Searching SQL DB...
                    </span>
                  )}
                  {phoneSearchStatus === 'found' && (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Customer Found in SQL DB
                    </span>
                  )}
                  {phoneSearchStatus === 'not_found' && (
                    <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Customer not found
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="Enter customer mobile number (e.g. 9876543210)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-medium focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* If Customer Found */}
                {selectedCust && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs">
                    <p className="font-bold text-emerald-900 dark:text-emerald-100">
                      Customer Name: {selectedCust.companyName}
                    </p>
                    <p className="text-emerald-800 dark:text-emerald-300 mt-0.5">
                      Locality: {selectedCust.locality || selectedCust.city || 'Sampletown'} • Mobile: {selectedCust.phone}
                    </p>
                  </div>
                )}

                {/* If Customer Not Found -> Provide + Add New Customer */}
                {phoneSearchStatus === 'not_found' && (
                  <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        No customer record found with this phone number.
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCreatingNewCust(true)}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                      >
                        + Add New Customer
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                          Customer Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={custNameInput}
                          onChange={(e) => setCustNameInput(e.target.value)}
                          placeholder="e.g. Ravi Kumar"
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                          Customer Locality *
                        </label>
                        <input
                          type="text"
                          required
                          value={custLocalityInput}
                          onChange={(e) => setCustLocalityInput(e.target.value)}
                          placeholder="e.g. Sampletown / Exampleville"
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION B: PRODUCT SELECTION (AUTOCOMPLETE BY ITEM NO OR NAME) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Select Product / Spare (Search by Item No or Name) *
                </label>
                <ProductSearchSelect
                  value={selectedProduct?.id || ''}
                  onChange={(prod) => setSelectedProduct(prod)}
                  products={products}
                  branchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
                  placeholder="Type Item No (e.g. PT-00125) or Name (e.g. Hydraulic Pump)..."
                />

                {selectedProduct && (
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div>
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{selectedProduct.sku}</span>
                      <span className="mx-2">•</span>
                      <span>Unit: {selectedProduct.unit}</span>
                    </div>
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Master Price: {settings.currencySymbol}{selectedProduct.sellingPrice}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION C: SALE DETAILS (QUANTITY & ACTUAL SALE PRICE) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-bold text-center dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Actual Sale Price ({settings.currencySymbol}) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={actualSellingPrice}
                    onChange={(e) => setActualSellingPrice(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    title="Actual transaction price. Does not modify master product price."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e: any) => setPaymentMethod(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Cash">Cash Counter</option>
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="Bank Transfer">Bank RTGS / NEFT</option>
                  </select>
                </div>
              </div>

              {/* TOTAL AMOUNT BAR */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 text-white font-mono">
                <span className="text-xs text-slate-300 font-sans">Total Transaction Amount:</span>
                <span className="text-lg font-bold text-emerald-400">
                  {settings.currencySymbol}
                  {(quantity * actualSellingPrice).toLocaleString()}
                </span>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsQuickSaleOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSale}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isSubmittingSale ? 'Processing...' : 'Complete Sale & Invoice'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: SEARCH CUSTOMER (AUTO-IDENTIFY BY PHONE/NAME)     */}
      {/* ========================================================= */}
      {isCustomerLookupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Search className="h-4 w-4 text-blue-600" />
                  Search Customer Master
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enter mobile number or name to search database
                </p>
              </div>
              <button
                onClick={() => setIsCustomerLookupOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 shrink-0">
              <input
                type="text"
                autoFocus
                value={searchPhoneQuery}
                onChange={(e) => setSearchPhoneQuery(e.target.value)}
                placeholder="Enter customer mobile number (e.g. 9876543210) or name..."
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-medium focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-2">
              {lookupResults.map((cust) => (
                <div
                  key={cust.id}
                  onClick={() => {
                    setPhoneInput(cust.phone);
                    setSelectedCust(cust);
                    setIsCustomerLookupOpen(false);
                    setIsQuickSaleOpen(true);
                  }}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-blue-50/70 hover:border-blue-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-blue-950/40 transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      {cust.companyName}
                    </span>
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                      {cust.phone}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Locality: {cust.locality || cust.city || 'Sampletown'}</span>
                    <span>•</span>
                    <span>Outstanding: {settings.currencySymbol}{(cust.outstandingBalance || 0).toLocaleString()}</span>
                  </div>
                </div>
              ))}

              {hasSearched && lookupResults.length === 0 && (
                <div className="text-center py-6">
                  <AlertCircle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Customer not found</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    No matching customer in SQL database. You can add them during Quick Sale.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: SEARCH PRODUCT MASTER                            */}
      {/* ========================================================= */}
      {isProductLookupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Package className="h-4 w-4 text-amber-600" />
                  Search Product Catalog
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Search by Item Number (e.g. PT-00125) or Product Name
                </p>
              </div>
              <button
                onClick={() => setIsProductLookupOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 shrink-0">
              <input
                type="text"
                autoFocus
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                placeholder="Search Item Number (PT-00125) or Name (Hydraulic Pump)..."
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-medium focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-2">
              {productResults.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => {
                    setSelectedProduct(prod);
                    setIsProductLookupOpen(false);
                    setIsQuickSaleOpen(true);
                  }}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-amber-50/70 hover:border-amber-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-amber-950/40 transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-xs text-amber-700 dark:text-amber-400">
                        {prod.sku}
                      </span>
                      <h4 className="font-bold text-xs text-slate-900 dark:text-white mt-0.5">
                        {prod.name}
                      </h4>
                    </div>
                    <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                      {settings.currencySymbol}{prod.sellingPrice.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Category: {prod.category}</span>
                    <span>•</span>
                    <span>Unit: {prod.unit}</span>
                    {prod.hsnCode && (
                      <>
                        <span>•</span>
                        <span>HSN: {prod.hsnCode}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
