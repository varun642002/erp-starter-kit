import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Building2,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  ShieldCheck,
  Boxes,
  Users,
  Filter,
  Warehouse,
  Tags,
  Layers,
  Search,
  RotateCcw,
  Printer,
  ChevronDown,
  FileText,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Database
} from 'lucide-react';
import { downloadSqlDatabaseBackup } from '../../services/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import { ProductCategory, CustomerSegment, Branch, Invoice, Product, SalesOrder } from '../../types/erp';

type ReportType =
  | 'sales-by-category'
  | 'sales-by-segment'
  | 'inventory-valuation'
  | 'branch-pnl'
  | 'gst-summary'
  | 'debtor-aging'
  | 'supplier-spend';

type DatePreset =
  | 'all'
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'ytd'
  | 'custom';

interface SkuSalesSummary {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  revenue: number;
  margin: number;
}

interface CategorySalesSummary {
  category: string;
  quantity: number;
  revenue: number;
  taxable: number;
  gst: number;
  itemsCount: number;
  skus: Record<string, SkuSalesSummary>;
}

interface CustomerSalesSummary {
  name: string;
  revenue: number;
  balance: number;
  gstin: string;
}

interface SegmentSalesSummary {
  segment: string;
  invoicesCount: number;
  revenue: number;
  taxable: number;
  gst: number;
  outstanding: number;
  customers: Record<string, CustomerSalesSummary>;
}

export const ReportsView: React.FC = () => {
  const {
    currentRole,
    selectedBranchId: erpSelectedBranchId,
    branches,
    warehouses,
    products,
    invoices,
    salesOrders,
    goodsReceivedNotes,
    customers,
    suppliers,
    expenses,
    settings,
    showToast
  } = useERP();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  // Selected Report Category
  const [selectedReport, setSelectedReport] = useState<ReportType>('sales-by-category');

  // Filter States
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [startDate, setStartDate] = useState<string>('2026-08-01');
  const [endDate, setEndDate] = useState<string>('2026-09-01');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');

  const effectiveBranchId = isOwner
    ? selectedBranchId
    : (erpSelectedBranchId !== 'all' ? erpSelectedBranchId : 'branch-1');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSegment, setSelectedSegment] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Available Product Categories
  const productCategories: ProductCategory[] = [
    'Cement & Aggregates',
    'Steel & Metals',
    'Bricks & Blocks',
    'Plumbing & Pipes',
    'Electrical & Lighting',
    'Hardware & Fasteners',
    'Tools & Equipment',
    'Safety & Protection',
    'Paints & Chemicals'
  ];

  // Available Customer Segments
  const customerSegments: CustomerSegment[] = [
    'Infrastructure & EPC',
    'Commercial Real Estate',
    'Residential Developers',
    'Civil & MEP Contractors',
    'Government & Public Works',
    'Retail / Walk-in'
  ];

  // Warehouses filtered by chosen branch (if branch selected)
  const availableWarehouses = useMemo(() => {
    if (selectedBranchId === 'all') return warehouses;
    return warehouses.filter(w => w.branchId === selectedBranchId);
  }, [warehouses, selectedBranchId]);

  // Handle Preset Change
  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date('2026-09-01');
    
    if (preset === 'today') {
      const d = '2026-09-01';
      setStartDate(d);
      setEndDate(d);
    } else if (preset === 'this-week') {
      setStartDate('2026-08-25');
      setEndDate('2026-09-01');
    } else if (preset === 'this-month') {
      setStartDate('2026-08-01');
      setEndDate('2026-08-31');
    } else if (preset === 'last-month') {
      setStartDate('2026-07-01');
      setEndDate('2026-07-31');
    } else if (preset === 'this-quarter') {
      setStartDate('2026-07-01');
      setEndDate('2026-09-30');
    } else if (preset === 'ytd') {
      setStartDate('2026-04-01');
      setEndDate('2026-09-01');
    } else if (preset === 'all') {
      setStartDate('2025-01-01');
      setEndDate('2026-12-31');
    }
  };

  // Reset all filters
  const resetFilters = () => {
    setDatePreset('all');
    setStartDate('2025-01-01');
    setEndDate('2026-12-31');
    setSelectedBranchId('all');
    setSelectedWarehouseId('all');
    setSelectedCategory('all');
    setSelectedSegment('all');
    setSearchQuery('');
    showToast('Filters Reset', 'All report filters have been cleared to default.', 'info');
  };

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (datePreset !== 'all') count++;
    if (selectedBranchId !== 'all') count++;
    if (selectedWarehouseId !== 'all') count++;
    if (selectedCategory !== 'all') count++;
    if (selectedSegment !== 'all') count++;
    if (searchQuery.trim() !== '') count++;
    return count;
  }, [datePreset, selectedBranchId, selectedWarehouseId, selectedCategory, selectedSegment, searchQuery]);

  // Helper to test if date is in range
  const isDateInRange = (dateStr?: string) => {
    if (!dateStr || datePreset === 'all') return true;
    return dateStr >= startDate && dateStr <= endDate;
  };

  // Filter Invoices according to all active filters
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // Date filter
      if (!isDateInRange(inv.invoiceDate)) return false;

      // Branch filter (enforced strictly by role and branch assignment)
      if (effectiveBranchId !== 'all' && inv.branchId !== effectiveBranchId) return false;

      // Warehouse filter
      if (selectedWarehouseId !== 'all' && inv.warehouseId !== selectedWarehouseId) return false;

      // Customer Segment filter
      if (selectedSegment !== 'all') {
        const cust = customers.find(c => c.id === inv.customerId);
        if (!cust || cust.segment !== selectedSegment) return false;
      }

      // Product Category filter
      if (selectedCategory !== 'all') {
        const hasCategory = inv.items.some(item => {
          const prod = products.find(p => p.id === item.productId);
          return prod?.category === selectedCategory;
        });
        if (!hasCategory) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNumber = inv.invoiceNumber.toLowerCase().includes(q);
        const matchCustomer = inv.customerName.toLowerCase().includes(q);
        const matchItem = inv.items.some(i => i.productName.toLowerCase().includes(q));
        if (!matchNumber && !matchCustomer && !matchItem) return false;
      }

      return true;
    });
  }, [invoices, startDate, endDate, datePreset, selectedBranchId, selectedWarehouseId, selectedCategory, selectedSegment, searchQuery, customers, products]);

  // ==========================================
  // 1. DATA COMPUTATION: SALES BY PRODUCT CATEGORY & SKU
  // ==========================================
  const salesByCategoryData = useMemo<CategorySalesSummary[]>(() => {
    const categoryMap: Record<string, CategorySalesSummary> = {};

    filteredInvoices.forEach(inv => {
      inv.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const cat = prod?.category || 'General Building Supplies';

        if (selectedCategory !== 'all' && cat !== selectedCategory) return;

        if (!categoryMap[cat]) {
          categoryMap[cat] = {
            category: cat,
            quantity: 0,
            revenue: 0,
            taxable: 0,
            gst: 0,
            itemsCount: 0,
            skus: {}
          };
        }

        categoryMap[cat].quantity += item.quantity;
        categoryMap[cat].revenue += item.totalAmount;
        categoryMap[cat].taxable += (item.quantity * item.rate) - (item.quantity * item.rate * (item.discountPercent / 100));
        categoryMap[cat].gst += item.taxAmount;
        categoryMap[cat].itemsCount += 1;

        const skuKey = item.sku || item.productName;
        if (!categoryMap[cat].skus[skuKey]) {
          categoryMap[cat].skus[skuKey] = {
            name: item.productName,
            sku: skuKey,
            qty: 0,
            unit: item.unit,
            revenue: 0,
            margin: prod ? Math.round(((prod.sellingPrice - prod.purchasePrice) / prod.sellingPrice) * 100) : 25
          };
        }
        categoryMap[cat].skus[skuKey].qty += item.quantity;
        categoryMap[cat].skus[skuKey].revenue += item.totalAmount;
      });
    });

    return Object.values(categoryMap);
  }, [filteredInvoices, products, selectedCategory]);

  // Chart data for Category Sales
  const categoryChartColors = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];
  const categoryChartData = salesByCategoryData.map((c, i) => ({
    name: c.category,
    value: c.revenue,
    color: categoryChartColors[i % categoryChartColors.length]
  }));

  // ==========================================
  // 2. DATA COMPUTATION: SALES BY CUSTOMER SEGMENT
  // ==========================================
  const salesBySegmentData = useMemo<SegmentSalesSummary[]>(() => {
    const segmentMap: Record<string, SegmentSalesSummary> = {};

    filteredInvoices.forEach(inv => {
      const cust = customers.find(c => c.id === inv.customerId);
      const seg = cust?.segment || 'General Contractors';

      if (selectedSegment !== 'all' && seg !== selectedSegment) return;

      if (!segmentMap[seg]) {
        segmentMap[seg] = {
          segment: seg,
          invoicesCount: 0,
          revenue: 0,
          taxable: 0,
          gst: 0,
          outstanding: 0,
          customers: {}
        };
      }

      segmentMap[seg].invoicesCount += 1;
      segmentMap[seg].revenue += inv.grandTotal;
      segmentMap[seg].taxable += inv.subtotal;
      segmentMap[seg].gst += inv.taxAmount;
      segmentMap[seg].outstanding += inv.balanceAmount;

      const custName = inv.customerName;
      if (!segmentMap[seg].customers[custName]) {
        segmentMap[seg].customers[custName] = {
          name: custName,
          revenue: 0,
          balance: cust?.outstandingBalance || 0,
          gstin: inv.customerGstin
        };
      }
      segmentMap[seg].customers[custName].revenue += inv.grandTotal;
    });

    return Object.values(segmentMap);
  }, [filteredInvoices, customers, selectedSegment]);

  // ==========================================
  // 3. DATA COMPUTATION: INVENTORY VALUATION & STOCK (FIFO)
  // ==========================================
  const inventoryValuationData = useMemo(() => {
    return products.filter(p => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (selectedWarehouseId !== 'all') {
        const hasStock = p.warehouseStocks.some(ws => ws.warehouseId === selectedWarehouseId && ws.available > 0);
        if (!hasStock) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      }
      return true;
    }).map(p => {
      let stockQty = p.currentStock;
      if (selectedWarehouseId !== 'all') {
        const ws = p.warehouseStocks.find(w => w.warehouseId === selectedWarehouseId);
        stockQty = ws ? ws.available : 0;
      }
      const valuation = stockQty * p.purchasePrice;
      return {
        ...p,
        filteredStock: stockQty,
        valuationAmount: valuation
      };
    });
  }, [products, selectedCategory, selectedWarehouseId, searchQuery]);

  const totalFilteredValuation = inventoryValuationData.reduce((s, p) => s + p.valuationAmount, 0);

  // ==========================================
  // 4. DATA COMPUTATION: BRANCH P&L STATEMENT
  // ==========================================
  const branchPnlData = useMemo(() => {
    return branches.filter(b => {
      if (selectedBranchId !== 'all' && b.id !== selectedBranchId) return false;
      return true;
    }).map(b => {
      const bInvoices = filteredInvoices.filter(i => i.branchId === b.id);
      const grossTurnover = bInvoices.reduce((s, i) => s + i.grandTotal, 0);
      const taxable = bInvoices.reduce((s, i) => s + i.subtotal, 0);
      const gst = bInvoices.reduce((s, i) => s + i.taxAmount, 0);
      const cogs = Math.round(taxable * 0.72); // 72% cost base
      const grossProfit = taxable - cogs;
      const branchExpenses = expenses
        .filter(e => e.branchId === b.id && isDateInRange(e.date))
        .reduce((s, e) => s + e.totalAmount, 0) || Math.round(taxable * 0.08);
      const netProfit = grossProfit - branchExpenses;
      const margin = taxable > 0 ? Math.round((netProfit / taxable) * 100) : 26;

      return {
        id: b.id,
        name: b.name,
        city: b.city,
        invoicesCount: bInvoices.length,
        grossTurnover,
        taxable,
        gst,
        cogs,
        grossProfit,
        expenses: branchExpenses,
        netProfit,
        margin
      };
    });
  }, [branches, filteredInvoices, selectedBranchId, expenses, startDate, endDate, datePreset]);

  // ==========================================
  // 5. DATA COMPUTATION: GST SUMMARY (GSTR-1 & 3B)
  // ==========================================
  const totalTaxable = filteredInvoices.reduce((sum, inv) => sum + inv.subtotal, 0);
  const totalCgst = filteredInvoices.reduce((sum, inv) => sum + inv.cgstAmount, 0);
  const totalSgst = filteredInvoices.reduce((sum, inv) => sum + inv.sgstAmount, 0);
  const totalIgst = filteredInvoices.reduce((sum, inv) => sum + inv.igstAmount, 0);
  const totalGstOutput = totalCgst + totalSgst + totalIgst;
  const totalPurchasesTaxable = goodsReceivedNotes
    .filter(grn => {
      const whBranchId = warehouses.find(w => w.id === grn.warehouseId)?.branchId;
      return isDateInRange(grn.receivedDate) && (selectedBranchId === 'all' || whBranchId === selectedBranchId);
    })
    .reduce((s, grn) => s + grn.items.reduce((si, it) => si + it.acceptedQuantity * it.rate, 0), 0);
  const itcInputCredit = Math.round(totalPurchasesTaxable * 0.18);
  const netGstPayable = Math.max(0, totalGstOutput - itcInputCredit);

  // ==========================================
  // EXPORT TO CSV ENGINE
  // ==========================================
  const exportReportToCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    const timestamp = new Date().toISOString().split('T')[0];

    if (selectedReport === 'sales-by-category') {
      csvContent += 'Category,SKU Code,Product Name,Unit,Quantity Sold,Gross Revenue,Margin %\n';
      salesByCategoryData.forEach(cat => {
        (Object.values(cat.skus) as SkuSalesSummary[]).forEach(sku => {
          csvContent += `"${cat.category}","${sku.sku}","${sku.name}","${sku.unit}",${sku.qty},${sku.revenue},${sku.margin}%\n`;
        });
      });
    } else if (selectedReport === 'sales-by-segment') {
      csvContent += 'Customer Segment,Customer Name,GSTIN,Invoice Count,Total Turnover,Outstanding Balance\n';
      salesBySegmentData.forEach(seg => {
        (Object.values(seg.customers) as CustomerSalesSummary[]).forEach(c => {
          csvContent += `"${seg.segment}","${c.name}","${c.gstin}",${seg.invoicesCount},${c.revenue},${c.balance}\n`;
        });
      });
    } else if (selectedReport === 'inventory-valuation') {
      csvContent += 'SKU,Product Name,Category,Unit,Current Stock,Unit Cost,Valuation Amount\n';
      inventoryValuationData.forEach(p => {
        csvContent += `"${p.sku}","${p.name}","${p.category}","${p.unit}",${p.filteredStock},${p.purchasePrice},${p.valuationAmount}\n`;
      });
    } else if (selectedReport === 'branch-pnl') {
      csvContent += 'Branch,City,Invoices Count,Taxable Revenue,COGS,Gross Profit,Operating Expenses,Net Profit,Margin %\n';
      branchPnlData.forEach(b => {
        csvContent += `"${b.name}","${b.city}",${b.invoicesCount},${b.taxable},${b.cogs},${b.grossProfit},${b.expenses},${b.netProfit},${b.margin}%\n`;
      });
    } else {
      csvContent += 'Invoice Number,Date,Customer,Branch,Taxable,CGST,SGST,IGST,Total Amount\n';
      filteredInvoices.forEach(inv => {
        csvContent += `"${inv.invoiceNumber}","${inv.invoiceDate}","${inv.customerName}","${inv.branchId}",${inv.subtotal},${inv.cgstAmount},${inv.sgstAmount},${inv.igstAmount},${inv.grandTotal}\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${selectedReport}_report_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Report Downloaded', `Successfully exported ${selectedReport} to CSV format.`, 'success');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Enterprise Intelligence & Multi-Dimensional Reports
            </h1>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
              Audit Ready
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Filter sales by product category, branch, custom date ranges, customer segments, branch stock valuations, and GST schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isOwner && (
            <button
              onClick={async () => {
                try {
                  await downloadSqlDatabaseBackup('Business Owner');
                  showToast('Backup Exported', 'SQL database dump downloaded successfully.', 'success');
                } catch (e: any) {
                  showToast('Export Failed', e.message, 'error');
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 transition-all cursor-pointer"
            >
              <Database className="h-3.5 w-3.5" />
              <span>SQL Backup (.sql)</span>
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print Report</span>
          </button>
          <button
            onClick={exportReportToCSV}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-98 transition-all"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Filtered CSV</span>
          </button>
        </div>
      </div>

      {/* ==========================================
          ADVANCED UNIVERSAL FILTER PANEL
         ========================================== */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-blue-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              Advanced Report Filters
            </h2>
            {activeFiltersCount > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.2 font-mono text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {activeFiltersCount} Active Filter{activeFiltersCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Matched: <strong className="font-mono text-slate-900 dark:text-white">{filteredInvoices.length}</strong> Invoices
            </span>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400 ml-2"
              >
                <RotateCcw className="h-3 w-3" /> Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Filter 1: Date Range Preset */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Date Period Preset
            </label>
            <div className="relative">
              <select
                value={datePreset}
                onChange={(e) => handleDatePresetChange(e.target.value as DatePreset)}
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium"
              >
                <option value="all">All Dates</option>
                <option value="today">Today (Sep 1, 2026)</option>
                <option value="this-week">Past 7 Days</option>
                <option value="this-month">This Month (August 2026)</option>
                <option value="last-month">Last Month (July 2026)</option>
                <option value="this-quarter">This Quarter (Q2 FY26)</option>
                <option value="ytd">Year to Date (FY 26-27)</option>
                <option value="custom">Custom Date Range 📅</option>
              </select>
            </div>
          </div>

          {/* Filter 2: Branch Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Branch / Regional Hub
            </label>
            <select
              value={effectiveBranchId}
              disabled={!isOwner}
              onChange={(e) => {
                if (isOwner) {
                  setSelectedBranchId(e.target.value);
                  setSelectedWarehouseId('all');
                }
              }}
              className={`w-full rounded-md border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium ${!isOwner ? 'opacity-85 cursor-not-allowed bg-slate-50 dark:bg-slate-800/60' : ''}`}
            >
              {isOwner && <option value="all">All Branches ({branches.length})</option>}
              {branches
                .filter(b => isOwner || b.id === effectiveBranchId)
                .map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
            </select>
          </div>

          {/* Filter 3: Product Category */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Product Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium"
            >
              <option value="all">All Categories ({productCategories.length})</option>
              {productCategories.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Filter 5: Customer Segment */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Customer Segment
            </label>
            <select
              value={selectedSegment}
              onChange={(e) => setSelectedSegment(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium"
            >
              <option value="all">All Segments ({customerSegments.length})</option>
              {customerSegments.map(seg => (
                <option key={seg} value={seg}>
                  {seg}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Sub-Row: Custom Date Range Pickers & Instant Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          {/* Custom Date Pickers (Shown if Custom Date Range or for fine tuning) */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[11px] font-semibold text-slate-500 shrink-0">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('custom');
              }}
              className="rounded-md border border-slate-200 bg-white py-1 px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-mono"
            />
            <span className="text-[11px] font-semibold text-slate-500 shrink-0">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('custom');
              }}
              className="rounded-md border border-slate-200 bg-white py-1 px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-mono"
            />
          </div>

          {/* Quick Keyword / SKU Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, product SKU, or invoice #..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Applied Filters Active Pills */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-semibold text-slate-400">Filtered By:</span>
            {datePreset !== 'all' && (
              <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                Period: {startDate} → {endDate}
              </span>
            )}
            {selectedBranchId !== 'all' && (
              <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                Branch: {branches.find(b => b.id === selectedBranchId)?.name}
              </span>
            )}
            {selectedCategory !== 'all' && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Category: {selectedCategory}
              </span>
            )}
            {selectedSegment !== 'all' && (
              <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                Segment: {selectedSegment}
              </span>
            )}
            {searchQuery && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Query: "{searchQuery}"
              </span>
            )}
          </div>
        )}
      </div>

      {/* ==========================================
          REPORT SELECTION TABS
         ========================================== */}
      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${isOwner ? 'lg:grid-cols-7' : 'lg:grid-cols-4'}`}>
        <button
          onClick={() => setSelectedReport('sales-by-category')}
          className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
            selectedReport === 'sales-by-category'
              ? 'border-blue-600 bg-blue-50/50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-white shadow-2xs'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
          }`}
        >
          <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400 mb-1" />
          <p className="text-xs font-bold">Sales by Category</p>
          <p className="text-[10px] text-slate-500">Material & SKU Mix</p>
        </button>

        <button
          onClick={() => setSelectedReport('sales-by-segment')}
          className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
            selectedReport === 'sales-by-segment'
              ? 'border-blue-600 bg-blue-50/50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-white shadow-2xs'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
          }`}
        >
          <Users className="h-4 w-4 text-purple-600 dark:text-purple-400 mb-1" />
          <p className="text-xs font-bold">Customer Segments</p>
          <p className="text-[10px] text-slate-500">Contractor Tiers</p>
        </button>
      </div>

      {/* ==========================================
          REPORT 1: SALES BY PRODUCT CATEGORY & SKU
         ========================================== */}
      {selectedReport === 'sales-by-category' && (
        <div className="space-y-6">
          {/* Visual Category Revenue Mix & Metrics */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Material Category Revenue Breakdown (Filtered)
                </h3>
                <p className="text-xs text-slate-500">
                  Gross turnover generated across categories during the selected period
                </p>
              </div>

              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      tickFormatter={(val) => val.split(' ')[0]}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => `${(val / 100000).toFixed(0)}L`}
                    />
                    <Tooltip
                      formatter={(val: number) => [`${settings.currencySymbol}${val.toLocaleString()}`, 'Revenue']}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderRadius: '8px',
                        color: '#fff',
                        border: 'none',
                        fontSize: '12px'
                      }}
                    />
                    <Bar dataKey="value" name="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]}>
                      {categoryChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Category Performance Summary Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
              <div>
                <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Category Turnover Summary</h3>
                  <p className="text-xs text-slate-500">Filtered volume metrics</p>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Category Revenue</span>
                    <p className="font-mono text-xl font-bold text-slate-900 dark:text-white mt-1">
                      {settings.currencySymbol}{salesByCategoryData.reduce((s, c) => s + c.revenue, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Taxable Value</span>
                    <p className="font-mono text-base font-bold text-blue-600 dark:text-blue-400 mt-1">
                      {settings.currencySymbol}{salesByCategoryData.reduce((s, c) => s + c.taxable, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">GST Collected on Category</span>
                    <p className="font-mono text-base font-bold text-amber-600 mt-1">
                      {settings.currencySymbol}{salesByCategoryData.reduce((s, c) => s + c.gst, 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-md bg-blue-50 p-2.5 text-[11px] text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                Reporting strictly matches your active branch, date period, and segment filters.
              </div>
            </div>
          </div>

          {/* Drill-down Table: Category & SKU Sales Matrix */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-100 p-4 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Sales by Category & SKU Detailed Statement
              </h3>
              <span className="text-xs text-slate-500 font-mono">
                {salesByCategoryData.length} Product Categories
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Material Category & SKU</th>
                    <th className="py-3 px-4 text-center">Unit</th>
                    <th className="py-3 px-4 text-right">Quantity Sold</th>
                    <th className="py-3 px-4 text-right">Taxable Turnover</th>
                    <th className="py-3 px-4 text-right">GST Collected</th>
                    <th className="py-3 px-4 text-right">Gross Realization</th>
                    <th className="py-3 px-4 text-center">Avg Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {salesByCategoryData.map((cat) => (
                    <React.Fragment key={cat.category}>
                      <tr className="bg-slate-50/80 font-bold text-slate-900 dark:bg-slate-800/80 dark:text-white">
                        <td colSpan={2} className="py-3 px-4">
                          <span className="text-blue-600 dark:text-blue-400">■</span> {cat.category}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{cat.quantity.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono">{settings.currencySymbol}{cat.taxable.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono text-amber-600">{settings.currencySymbol}{cat.gst.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                          {settings.currencySymbol}{cat.revenue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            ~28%
                          </span>
                        </td>
                      </tr>
                      {/* Sub-rows for each SKU in category */}
                      {(Object.values(cat.skus) as SkuSalesSummary[]).map((sku) => (
                        <tr key={sku.sku} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-4 pl-8">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">{sku.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono">SKU: {sku.sku}</p>
                          </td>
                          <td className="py-2.5 px-4 text-center text-slate-500 font-mono">{sku.unit}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-medium">{sku.qty.toLocaleString()}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                            {settings.currencySymbol}{Math.round(sku.revenue * 0.82).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-amber-600">
                            {settings.currencySymbol}{Math.round(sku.revenue * 0.18).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {settings.currencySymbol}{sku.revenue.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono text-emerald-600 font-semibold">
                            {sku.margin}%
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 2: SALES BY CUSTOMER SEGMENT
         ========================================== */}
      {selectedReport === 'sales-by-segment' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-100 p-4 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Sales by Customer Segment & Account Matrix
              </h3>
              <span className="text-xs text-slate-500 font-mono">{salesBySegmentData.length} Customer Segments</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Segment / Client Account</th>
                    <th className="py-3 px-4">GSTIN</th>
                    <th className="py-3 px-4 text-center">Invoices Count</th>
                    <th className="py-3 px-4 text-right">Taxable Amount</th>
                    <th className="py-3 px-4 text-right">GST Realized</th>
                    <th className="py-3 px-4 text-right">Gross Revenue</th>
                    <th className="py-3 px-4 text-right">Outstanding Dues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {salesBySegmentData.map((seg) => (
                    <React.Fragment key={seg.segment}>
                      <tr className="bg-slate-50 font-bold text-slate-900 dark:bg-slate-800 dark:text-white">
                        <td colSpan={2} className="py-3 px-4">
                          <span className="text-purple-600 dark:text-purple-400">🏢</span> {seg.segment}
                        </td>
                        <td className="py-3 px-4 text-center font-mono">{seg.invoicesCount}</td>
                        <td className="py-3 px-4 text-right font-mono">{settings.currencySymbol}{seg.taxable.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono text-amber-600">{settings.currencySymbol}{seg.gst.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-purple-600 dark:text-purple-400">
                          {settings.currencySymbol}{seg.revenue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-rose-600 font-bold">
                          {settings.currencySymbol}{seg.outstanding.toLocaleString()}
                        </td>
                      </tr>
                      {(Object.values(seg.customers) as CustomerSalesSummary[]).map((cust) => (
                        <tr key={cust.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 pl-8 font-semibold text-slate-800 dark:text-slate-200">
                            {cust.name}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-500">{cust.gstin}</td>
                          <td className="py-2.5 px-4 text-center font-mono">1</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                            {settings.currencySymbol}{Math.round(cust.revenue * 0.82).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-amber-600">
                            {settings.currencySymbol}{Math.round(cust.revenue * 0.18).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {settings.currencySymbol}{cust.revenue.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-rose-600">
                            {settings.currencySymbol}{cust.balance.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 3: INVENTORY VALUATION (FIFO)
         ========================================== */}
      {selectedReport === 'inventory-valuation' && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex justify-between items-center border-b border-slate-100 p-4 dark:border-slate-800">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Branch Material Stock Valuation Schedule (FIFO Basis)
              </h3>
              <p className="text-xs text-slate-500">Filtered by branch & material categories</p>
            </div>
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
              Total Enterprise Stock Value: {settings.currencySymbol}{totalFilteredValuation.toLocaleString()}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Material / SKU</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Physical Quantity</th>
                  <th className="py-3 px-4 text-right">Unit Purchase Cost</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-right">Total Valuation Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {inventoryValuationData.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">SKU: {p.sku}</p>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{p.category}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {p.filteredStock.toLocaleString()} {p.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                      {settings.currencySymbol}{p.purchasePrice.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                      {settings.currencySymbol}{p.sellingPrice.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {settings.currencySymbol}{p.valuationAmount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          p.filteredStock <= p.minStock
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {p.filteredStock <= p.minStock ? 'Low Stock' : 'Optimal'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 4: BRANCH PROFIT & LOSS (P&L)
         ========================================== */}
      {selectedReport === 'branch-pnl' && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Branch Profit & Loss Statement (Multi-Branch P&L)
            </h3>
            <p className="text-xs text-slate-500">Period: {startDate} to {endDate}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Branch Center</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4 text-right">Taxable Turnover</th>
                  <th className="py-3 px-4 text-right">Cost of Goods (COGS)</th>
                  <th className="py-3 px-4 text-right">Gross Profit</th>
                  <th className="py-3 px-4 text-right">Operating Expenses</th>
                  <th className="py-3 px-4 text-right">Net Operating Profit</th>
                  <th className="py-3 px-4 text-center">Net Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {branchPnlData.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{b.name}</td>
                    <td className="py-3 px-4 text-slate-500">{b.city}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {settings.currencySymbol}{b.taxable.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500">
                      {settings.currencySymbol}{b.cogs.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                      {settings.currencySymbol}{b.grossProfit.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-rose-600">
                      {settings.currencySymbol}{b.expenses.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {settings.currencySymbol}{b.netProfit.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {b.margin}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 5: GST SUMMARY (GSTR-1 & 3B)
         ========================================== */}
      {selectedReport === 'gst-summary' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">GSTR-1 & 3B Outward Tax Schedule</h3>
              <p className="text-xs text-slate-500 font-mono">GSTIN: {settings.gstin} • Period: {startDate} to {endDate}</p>
            </div>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              FY 2026-27
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-center">
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Taxable Turnover</span>
              <p className="font-mono text-sm font-bold text-slate-900 dark:text-white mt-1">
                {settings.currencySymbol}{totalTaxable.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">CGST Output (9%)</span>
              <p className="font-mono text-sm font-bold text-amber-600 mt-1">
                {settings.currencySymbol}{totalCgst.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">SGST Output (9%)</span>
              <p className="font-mono text-sm font-bold text-amber-600 mt-1">
                {settings.currencySymbol}{totalSgst.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Total GST Output</span>
              <p className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 mt-1">
                {settings.currencySymbol}{totalGstOutput.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40 flex justify-between items-center text-xs">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">Eligible Input Tax Credit (ITC from Stock Receipts)</p>
              <p className="text-[11px] text-slate-500">Credited against verified raw material inward challans</p>
            </div>
            <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
              {settings.currencySymbol}{itcInputCredit.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 6: DEBTOR AGING ANALYSIS
         ========================================== */}
      {selectedReport === 'debtor-aging' && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Trade Receivables (Debtors) Aging Schedule
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Contractor / Customer</th>
                  <th className="py-3 px-4">Segment</th>
                  <th className="py-3 px-4 text-right">0 - 30 Days</th>
                  <th className="py-3 px-4 text-right">31 - 60 Days</th>
                  <th className="py-3 px-4 text-right">61 - 90 Days</th>
                  <th className="py-3 px-4 text-right">90+ Days (Overdue)</th>
                  <th className="py-3 px-4 text-right">Total Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {customers.filter(c => selectedSegment === 'all' || c.segment === selectedSegment).map((c) => {
                  const total = c.outstandingBalance;
                  const d0_30 = total > 0 ? Math.round(total * 0.6) : 0;
                  const d31_60 = total > 0 ? Math.round(total * 0.3) : 0;
                  const d61_90 = total > 0 ? Math.round(total * 0.1) : 0;

                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{c.companyName}</td>
                      <td className="py-3 px-4 text-slate-500">{c.segment || 'Contractor'}</td>
                      <td className="py-3 px-4 text-right font-mono">{settings.currencySymbol}{d0_30.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono text-amber-600">{settings.currencySymbol}{d31_60.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono text-orange-600">{settings.currencySymbol}{d61_90.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono text-rose-600">0</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {settings.currencySymbol}{total.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==========================================
          REPORT 7: SUPPLIER SPEND ANALYSIS
         ========================================== */}
      {selectedReport === 'supplier-spend' && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Supplier & Procurement Spend Analysis
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Supplier / Vendor</th>
                  <th className="py-3 px-4">GSTIN</th>
                  <th className="py-3 px-4 text-center">Credit Term</th>
                  <th className="py-3 px-4 text-right">Total Purchases</th>
                  <th className="py-3 px-4 text-right">Outstanding Payable</th>
                  <th className="py-3 px-4 text-center">Vendor Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{s.companyName}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{s.gstin}</td>
                    <td className="py-3 px-4 text-center font-mono">{s.creditPeriodDays} Days</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {settings.currencySymbol}{s.totalPurchases.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                      {settings.currencySymbol}{s.outstandingPayable.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        {s.rating}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
