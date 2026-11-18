import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import {
  TrendingUp,
  CreditCard,
  Boxes,
  ArrowUpRight,
  ArrowRight,
  Clock,
  Building2,
  Warehouse,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Eye,
  Percent,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Receipt,
  DollarSign,
  Package
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { documentApi, type DocumentRow } from '../../services/documentApi';
import { useApiScope } from '../documents/ui';
import { canUseInvoices } from '../../utils/access';
import { KpiCharts, type SaleRec } from './KpiCharts';

type TimeHorizon = 'today' | '30d' | 'current-month' | 'fiscal-ytd';

export const RealTimeKPISection: React.FC = () => {
  const {
    invoices,
    filteredInvoices,
    salesOrders,
    filteredSalesOrders,
    customers,
    products,
    filteredProducts,
    warehouses,
    branches,
    settings,
    selectedBranchId,
    selectedWarehouseId,
    currentBranchName,
    currentWarehouseName,
    setCurrentView,
    openQuickAdd,
    currentRole
  } = useERP();

  // Invoices and quotations (including the invoices made from machine sales) live in the documents module.
  // Only the roles that may open it can read them; for the others the card keeps using quick sale invoices.
  const { scope: docScope, branchParam: docBranch } = useApiScope();
  const [docInvoices, setDocInvoices] = useState<DocumentRow[]>([]);
  const docsAlive = useRef(true);
  useEffect(() => {
    docsAlive.current = true;
    return () => {
      docsAlive.current = false;
    };
  }, []);
  const loadDocs = useCallback(
    (silent: boolean) => {
      if (!canUseInvoices(currentRole)) {
        setDocInvoices([]);
        return;
      }
      documentApi
        .list(docScope, { type: 'invoice', branchId: docBranch, from: new Date(Date.now() + 5.5 * 3600_000 - 400 * 86400_000).toISOString().slice(0, 10) })
        .then((rows) => docsAlive.current && setDocInvoices(Array.isArray(rows) ? rows : []))
        .catch(() => docsAlive.current && !silent && setDocInvoices([]));
    },
    [docScope, docBranch, currentRole]
  );
  useEffect(() => {
    loadDocs(false);
  }, [loadDocs]);
  // Sales and payments made anywhere show up here within seconds.
  useLiveRefresh(() => loadDocs(true), 20_000);
  const liveDocs = useMemo(
    () => docInvoices.filter((d) => ['Issued', 'Partially Paid', 'Paid'].includes(String(d.status))),
    [docInvoices]
  );

  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('today');
  const [showDetailedBreakdown, setShowDetailedBreakdown] = useState<boolean>(false);

  // Currency symbol helper
  const currency = settings.currencySymbol || '₹';

  // Current date reference (Sep 2026 in app context)
  const now = useMemo(() => new Date(), []);
  const currentYearMonth = useMemo(() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }, [now]);

  // ==========================================
  // 1. REAL-TIME TOTAL MONTHLY SALES CALCULATION
  // ==========================================
  const salesMetrics = useMemo(() => {
    // 30 days threshold
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Today's date in the shop's own time zone (YYYY-MM-DD), recalculated on every refresh
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const periodInvoices = filteredInvoices.filter((inv) => {
      if (inv.status === 'Cancelled') return false;
      const invDate = new Date(inv.invoiceDate);

      if (timeHorizon === 'today') {
        return String(inv.invoiceDate).slice(0, 10) === todayIso;
      } else if (timeHorizon === 'current-month') {
        // Current calendar month (e.g. 2026-09)
        return inv.invoiceDate.startsWith(currentYearMonth);
      } else if (timeHorizon === '30d') {
        // Rolling 30 days window or recent active period
        return invDate >= thirtyDaysAgo || inv.invoiceDate.startsWith(currentYearMonth) || inv.invoiceDate.startsWith('2026-08');
      } else {
        // Fiscal YTD (all active invoices)
        return true;
      }
    });

    // Invoices from the documents module (GST invoices, invoice-only bills, machine sale invoices)
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10);
    const periodDocs = liveDocs.filter((d) => {
      const date = String(d.docDate || '');
      if (timeHorizon === 'today') return date.slice(0, 10) === todayIso;
      if (timeHorizon === 'current-month') return date.startsWith(currentYearMonth);
      if (timeHorizon === '30d') return date >= thirtyDaysAgoIso || date.startsWith(currentYearMonth);
      return true;
    });

    const totalBilled =
      periodInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0) + periodDocs.reduce((sum, d) => sum + (d.grandTotal || 0), 0);
    const totalPaid =
      periodInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0) + periodDocs.reduce((sum, d) => sum + (d.paidAmount || 0), 0);
    const balancePending =
      periodInvoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0) +
      periodDocs.reduce((sum, d) => sum + Math.max(0, (d.grandTotal || 0) - (d.paidAmount || 0)), 0);
    const invoiceCount = periodInvoices.length + periodDocs.length;

    // Filtered sales orders in same scope for order conversion tracking
    const periodOrders = filteredSalesOrders.filter((so) => {
      if (so.status === 'Cancelled') return false;
      const orderDate = new Date(so.orderDate);
      if (timeHorizon === 'today') {
        return String(so.orderDate).slice(0, 10) === todayIso;
      } else if (timeHorizon === 'current-month') {
        return so.orderDate.startsWith(currentYearMonth);
      } else if (timeHorizon === '30d') {
        return orderDate >= thirtyDaysAgo || so.orderDate.startsWith(currentYearMonth) || so.orderDate.startsWith('2026-08');
      }
      return true;
    });

    const totalOrdersValue = periodOrders.reduce((sum, so) => sum + (so.grandTotal || 0), 0);
    const ordersCount = periodOrders.length;
    const avgInvoiceValue = invoiceCount > 0 ? Math.round(totalBilled / invoiceCount) : 0;
    const realizationRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

    return {
      totalBilled,
      totalPaid,
      balancePending,
      invoiceCount,
      ordersCount,
      totalOrdersValue,
      avgInvoiceValue,
      realizationRate
    };
  }, [filteredInvoices, filteredSalesOrders, liveDocs, timeHorizon, currentYearMonth, now]);

  // ==========================================
  // 2. REAL-TIME PENDING RECEIVABLES CALCULATION
  // ==========================================
  const receivablesMetrics = useMemo(() => {
    // 1. Customer level total outstanding balance
    const totalCustomerOutstanding = customers.reduce((sum, c) => sum + (c.outstandingBalance || 0), 0);
    const totalCustomerCreditLimit = customers.reduce((sum, c) => sum + (c.creditLimit || 0), 0);
    const debtorsCount = customers.filter((c) => (c.outstandingBalance || 0) > 0).length;

    // 2. Invoice level unpaid / overdue calculation (scoped by active branch/warehouse)
    const unpaidInvoices = filteredInvoices.filter(
      (inv) => inv.status !== 'Cancelled' && (inv.paymentStatus === 'Unpaid' || inv.paymentStatus === 'Partial' || inv.paymentStatus === 'Overdue')
    );

    const docOpen = liveDocs.filter((d) => (d.grandTotal || 0) - (d.paidAmount || 0) > 0.005);
    const invoiceReceivablesTotal =
      unpaidInvoices.reduce((sum, inv) => sum + (inv.balanceAmount || (inv.grandTotal - inv.paidAmount)), 0) +
      docOpen.reduce((sum, d) => sum + ((d.grandTotal || 0) - (d.paidAmount || 0)), 0);

    // Overdue invoices calculation (dueDate before today)
    const todayStr = now.toISOString().split('T')[0];
    const overdueInvoices = unpaidInvoices.filter((inv) => inv.dueDate && inv.dueDate < todayStr);
    const docOverdue = docOpen.filter((d) => d.dueDate && String(d.dueDate) < todayStr);
    const overdueAmount =
      overdueInvoices.reduce((sum, inv) => sum + (inv.balanceAmount || (inv.grandTotal - inv.paidAmount)), 0) +
      docOverdue.reduce((sum, d) => sum + ((d.grandTotal || 0) - (d.paidAmount || 0)), 0);
    const overdueCount = overdueInvoices.length + docOverdue.length;

    // Total pending receivables to display:
    // If a branch/warehouse is strictly selected, reflect invoiceReceivablesTotal; otherwise reflect customer ledger outstanding balance
    const effectiveReceivables = selectedBranchId !== 'all' || selectedWarehouseId !== 'all'
      ? invoiceReceivablesTotal
      : Math.max(totalCustomerOutstanding, invoiceReceivablesTotal);

    const creditUtilizationRate = totalCustomerCreditLimit > 0
      ? Math.min(100, Math.round((totalCustomerOutstanding / totalCustomerCreditLimit) * 100))
      : 0;

    // Top 3 debtor accounts
    const topDebtors = [...customers]
      .filter((c) => c.outstandingBalance > 0)
      .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
      .slice(0, 3);

    return {
      effectiveReceivables,
      invoiceReceivablesTotal,
      debtorsCount,
      overdueAmount,
      overdueCount,
      creditUtilizationRate,
      topDebtors
    };
  }, [customers, filteredInvoices, liveDocs, selectedBranchId, selectedWarehouseId, now]);

  // ==========================================
  // 3. REAL-TIME STOCK VALUATION CALCULATION
  // ==========================================
  const stockValuationMetrics = useMemo(() => {
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let totalPhysicalUnits = 0;
    let lowStockCount = 0;
    let criticalOutCount = 0;

    // Category-wise valuation aggregator
    const categoryTotals: Record<string, { cost: number; units: number; count: number }> = {};

    filteredProducts.forEach((product) => {
      let available = 0;
      let reserved = 0;

      if (selectedWarehouseId !== 'all') {
        const ws = product.warehouseStocks?.find((w) => w.warehouseId === selectedWarehouseId);
        available = ws ? ws.available : 0;
        reserved = ws ? ws.reserved : 0;
      } else if (selectedBranchId !== 'all') {
        const branchWhIds = new Set(warehouses.filter((w) => w.branchId === selectedBranchId).map((w) => w.id));
        const relevantStocks = product.warehouseStocks?.filter((ws) => branchWhIds.has(ws.warehouseId)) || [];
        available = relevantStocks.reduce((sum, ws) => sum + ws.available, 0);
        reserved = relevantStocks.reduce((sum, ws) => sum + ws.reserved, 0);
      } else {
        available = product.warehouseStocks?.reduce((sum, ws) => sum + ws.available, 0) ?? (product as any).currentStock ?? 0;
        reserved = product.warehouseStocks?.reduce((sum, ws) => sum + ws.reserved, 0) ?? 0;
      }

      const totalItemUnits = available + reserved;
      const costVal = totalItemUnits * (product.purchasePrice || 0);
      const retailVal = totalItemUnits * (product.sellingPrice || 0);

      totalCostValuation += costVal;
      totalRetailValuation += retailVal;
      totalPhysicalUnits += totalItemUnits;

      if (available <= 0) {
        criticalOutCount++;
      } else if (available <= (product.reorderLevel || 10)) {
        lowStockCount++;
      }

      // Group by category
      const cat = product.category || 'Other';
      if (!categoryTotals[cat]) {
        categoryTotals[cat] = { cost: 0, units: 0, count: 0 };
      }
      categoryTotals[cat].cost += costVal;
      categoryTotals[cat].units += totalItemUnits;
      categoryTotals[cat].count += 1;
    });

    const potentialGrossMargin = Math.max(0, totalRetailValuation - totalCostValuation);
    const unrealizedMarginPercent = totalRetailValuation > 0
      ? Math.round((potentialGrossMargin / totalRetailValuation) * 100)
      : 0;

    const topCategories = Object.entries(categoryTotals)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 4);

    return {
      totalCostValuation,
      totalRetailValuation,
      potentialGrossMargin,
      unrealizedMarginPercent,
      totalPhysicalUnits,
      activeSKUsCount: filteredProducts.length,
      lowStockCount,
      criticalOutCount,
      topCategories
    };
  }, [filteredProducts, warehouses, selectedBranchId, selectedWarehouseId]);

  // Every bill in scope (quick sale invoices and the invoices from the documents module), for the graphs below.
  const chartRecords = useMemo<SaleRec[]>(() => {
    const quick: SaleRec[] = filteredInvoices
      .filter((inv) => inv.status !== 'Cancelled')
      .map((inv) => ({
        date: String(inv.invoiceDate || '').slice(0, 10),
        branchId: inv.branchId,
        total: inv.grandTotal || 0,
        paid: inv.paidAmount || 0,
        due: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null
      }));
    const docs: SaleRec[] = liveDocs.map((d) => ({
      date: String(d.docDate || '').slice(0, 10),
      branchId: d.branchId,
      total: d.grandTotal || 0,
      paid: d.paidAmount || 0,
      due: d.dueDate ? String(d.dueDate).slice(0, 10) : null
    }));
    return [...quick, ...docs].filter((r) => r.date);
  }, [filteredInvoices, liveDocs]);

  const chartStock = useMemo(
    () => ({
      ok: Math.max(0, stockValuationMetrics.activeSKUsCount - stockValuationMetrics.lowStockCount - stockValuationMetrics.criticalOutCount),
      low: stockValuationMetrics.lowStockCount,
      out: stockValuationMetrics.criticalOutCount
    }),
    [stockValuationMetrics]
  );

  return (
    <div
      id="realtime-kpi-section"
      className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 transition-all"
    >
      {/* Section Header with Live Sync Pulse & Scope Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white flex flex-wrap items-center gap-x-2 gap-y-1">
              Real-Time Key Performance Indicators
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Context Sync
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Active Scope:{' '}
            <strong className="text-slate-700 dark:text-slate-300">
              {selectedBranchId === 'all' ? 'All 6 Enterprise Branches' : currentBranchName}
            </strong>
          </p>
        </div>

        {/* Time Horizon Pills & Breakdown Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex max-w-full overflow-x-auto whitespace-nowrap rounded-full bg-slate-100 p-1 dark:bg-slate-800 text-xs [&_button]:shrink-0">
            <button
              type="button"
              id="kpi-filter-today"
              onClick={() => setTimeHorizon('today')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                timeHorizon === 'today'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              id="kpi-filter-30d"
              onClick={() => setTimeHorizon('30d')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                timeHorizon === '30d'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              id="kpi-filter-current-month"
              onClick={() => setTimeHorizon('current-month')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                timeHorizon === 'current-month'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              id="kpi-filter-ytd"
              onClick={() => setTimeHorizon('fiscal-ytd')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                timeHorizon === 'fiscal-ytd'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              All Recorded
            </button>
          </div>

          <button
            type="button"
            id="btn-toggle-kpi-breakdown"
            onClick={() => setShowDetailedBreakdown(!showDetailedBreakdown)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <span>{showDetailedBreakdown ? 'Hide Breakdown' : 'Quick Breakdown'}</span>
            {showDetailedBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* 3 Core KPI Primary Cards */}
      <div className="grid grid-cols-1 gap-4 mt-4">
        {/* KPI 1: TOTAL MONTHLY SALES */}
        <div
          id="kpi-card-monthly-sales"
          className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br from-white to-blue-50/20 p-4.5 dark:border-slate-800 dark:from-slate-900 dark:to-blue-950/20 shadow-2xs transition-all hover:border-blue-300 dark:hover:border-blue-700"
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {timeHorizon === 'today' ? "Today's Sales" : 'Total Monthly Sales'}
              </span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  {currency}{salesMetrics.totalBilled.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>

          {/* Progress bar showing realization */}
          <div className="mt-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Realized Collections:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {currency}{salesMetrics.totalPaid.toLocaleString()} ({salesMetrics.realizationRate}%)
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${Math.min(100, salesMetrics.realizationRate)}%` }}
              />
            </div>
          </div>

          {/* Sub-metrics */}
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[11px] text-slate-400 block">Pending Balance:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {currency}{salesMetrics.balancePending.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Active Invoices:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {salesMetrics.invoiceCount} ({salesMetrics.ordersCount} SOs)
              </span>
            </div>
          </div>

          {/* Quick link button */}
          <button
            type="button"
            onClick={() => setCurrentView('billing')}
            className="mt-3.5 flex w-full items-center justify-between rounded-lg bg-blue-50/70 hover:bg-blue-100/70 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-300 transition-colors cursor-pointer"
          >
            <span>Explore Invoices & Billing</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Graphs */}
      <KpiCharts
        records={chartRecords}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        horizon={timeHorizon}
        currency={currency}
        stock={chartStock}
        categories={stockValuationMetrics.topCategories.map((c) => ({ name: c.name, cost: c.cost }))}
        showBranches={selectedBranchId === 'all' && branches.length > 1}
      />

      {/* Expandable Real-Time Detailed Breakdown Panel */}
      {showDetailedBreakdown && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-in fade-in duration-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Categories by Inventory Valuation */}
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3.5 dark:border-slate-800/80 dark:bg-slate-800/40">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-emerald-500" />
                  Category Inventory Valuation Breakdown
                </span>
                <span className="text-[10px] text-slate-400 font-medium">Cost Basis</span>
              </div>
              <div className="space-y-2.5">
                {stockValuationMetrics.topCategories.map((cat) => {
                  const percentOfTotal = stockValuationMetrics.totalCostValuation > 0
                    ? Math.round((cat.cost / stockValuationMetrics.totalCostValuation) * 100)
                    : 0;
                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{cat.name}</span>
                        <span className="font-mono text-slate-900 dark:text-white font-semibold">
                          {currency}{cat.cost.toLocaleString()}{' '}
                          <span className="text-[10px] text-slate-400">({percentOfTotal}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-200/70 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${percentOfTotal}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Customer Debtor Balances */}
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3.5 dark:border-slate-800/80 dark:bg-slate-800/40">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-amber-500" />
                  Top Debtor Accounts (Pending Receivables)
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentView('customers')}
                  className="text-[10px] text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-semibold cursor-pointer"
                >
                  All Clients →
                </button>
              </div>
              <div className="space-y-2">
                {receivablesMetrics.topDebtors.map((debtor) => (
                  <div
                    key={debtor.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800/50 text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {debtor.companyName}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {debtor.city} • Credit Limit: {currency}{debtor.creditLimit.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        {currency}{debtor.outstandingBalance.toLocaleString()}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {debtor.creditPeriodDays}d term
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
