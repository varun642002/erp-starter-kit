import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShoppingCart,
  FileText,
  ShoppingBag,
  Users,
  Truck,
  ArrowLeftRight,
  SlidersHorizontal,
  Wallet,
  Receipt,
  Plus,
  Trash2,
  CheckCircle2,
  Wrench,
  Search,
  RefreshCw,
  Boxes,
  Package,
  Tag,
  Sparkles,
  Layers,
  ArrowUpRight,
  Warehouse,
  Zap,
  Banknote
} from 'lucide-react';
import { CashHandoverForm } from './CashHandoverForm';
import { ProductSearchSelect } from './ProductSearchSelect';
import { CategorySelect } from './CategorySelect';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { ledgerApi } from '../../services/ledgerApi';
import { ProductUnit, ProductCategory, Product } from '../../types/erp';
import { HEAD_WAREHOUSE_ID } from '../../services/stockApi';

export const QuickAddModal: React.FC = () => {
  const {
    currentRole,
    selectedBranchId,
    isQuickAddOpen,
    setIsQuickAddOpen,
    quickAddInitialTab,
    branches,
    warehouses,
    products, activeProducts,
    customers,
    settings,
    createSalesOrder,
    createStockTransfer,
    createStockAdjustment,
    recordCustomerPayment,
    addExpense,
    addCustomer,
    addSupplier,
    addProduct,
    showToast,
    categories,
    setCurrentView
  } = useERP();

  const [activeTab, setActiveTab] = useState(quickAddInitialTab || 'sale');

  useEffect(() => {
    if (quickAddInitialTab) {
      // The spares tab is gone: anything that still asks for it lands on the first tab.
      setActiveTab(quickAddInitialTab === 'spare' || quickAddInitialTab === 'spares' ? 'transfer' : quickAddInitialTab);
    }
  }, [quickAddInitialTab, isQuickAddOpen]);

  // Form states for Quick Sale / Invoice
  const [saleCustomerId, setSaleCustomerId] = useState(customers[0]?.id || '');
  const [saleBranchId, setSaleBranchId] = useState(branches[0]?.id || '');
  const [saleWarehouseId, setSaleWarehouseId] = useState(warehouses[0]?.id || '');
  const [saleItems, setSaleItems] = useState([
    { productId: products[0]?.id || '', quantity: 10, rate: products[0]?.sellingPrice || 400, discountPercent: 0 }
  ]);

  // Form state for Quick Customer
  const [newCustName, setNewCustName] = useState('');
  const [newCustCompany, setNewCustCompany] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustCity, setNewCustCity] = useState('');
  const [newCustGstin, setNewCustGstin] = useState('');
  const [newCustCreditLimit, setNewCustCreditLimit] = useState(1000000);

  // Form state for Quick Transfer
  // Transfers always leave the Head Office (wh-1); only the destination is chosen.
  const [toWhId, setToWhId] = useState(warehouses.find(w => w.id !== HEAD_WAREHOUSE_ID)?.id || '');
  const [trItems, setTrItems] = useState<{ productId: string; qty: number }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state for Quick Expense
  const [expCategory, setExpCategory] = useState<any>('Transport & Freight');
  const [expVendor, setExpVendor] = useState('');
  const [expAmount, setExpAmount] = useState(15000);
  const [expDesc, setExpDesc] = useState('');
  const [expMethod, setExpMethod] = useState<'Cash' | 'Bank Transfer' | 'UPI'>('Cash');
  const [expBranch, setExpBranch] = useState('');
  const [expSaving, setExpSaving] = useState(false);
  const { scope: apiScope, isOwner: apiIsOwner, assignedBranchId } = useApiScope();

  // States for Spares: Search & Add
  const [spareSubMode, setSpareSubMode] = useState<'search' | 'add'>('search');
  const [spareSearchText, setSpareSearchText] = useState('');
  const [spareCategoryFilter, setSpareCategoryFilter] = useState('all');
  const [spareModelFilter, setSpareModelFilter] = useState('all');

  // Add Spare Part Form State
  const [newSpareName, setNewSpareName] = useState('');
  const [newSpareSku, setNewSpareSku] = useState('SPR-BLD-102');
  const [newSpareCategory, setNewSpareCategory] = useState<string>('Rotavator');
  const [newSpareAltNames, setNewSpareAltNames] = useState('');
  const [newSpareCompatibleModels, setNewSpareCompatibleModels] = useState('Rotavator 7-ft / 8-ft Multi-Speed, 45HP-55HP Tractor');
  const [newSpareOem, setNewSpareOem] = useState('');
  const [newSpareSubCategory, setNewSpareSubCategory] = useState('');
  const [newSpareBrand, setNewSpareBrand] = useState('Acme Genuine Spares');
  const [newSpareRackBin, setNewSpareRackBin] = useState('Rack RACK-BLD / Bin B-102');
  const [newSpareUnit, setNewSpareUnit] = useState<ProductUnit>('Piece');
  const [newSpareHsn, setNewSpareHsn] = useState('8432');
  const [newSpareBuyPrice, setNewSpareBuyPrice] = useState(0);
  const [newSpareSellPrice, setNewSpareSellPrice] = useState(0);
  const [newSpareMrp, setNewSpareMrp] = useState(760);
  const [newSpareGstRate, setNewSpareGstRate] = useState(5);
  const [newSpareMinStock, setNewSpareMinStock] = useState(30);
  const [newSpareInitialStock, setNewSpareInitialStock] = useState(100);
  const [newSpareWarehouseId, setNewSpareWarehouseId] = useState(warehouses[0]?.id || '');
  const [newSpareDescription, setNewSpareDescription] = useState('');

  const isSpareProduct = (p: Product): boolean => Boolean(p.isSparePart);

  const generateSpareSkuCode = (category: string) => {
    let prefix = 'SPR-GEN';
    if (category === 'Baler') prefix = 'SPR-BAL';
    else if (category === 'Rotavator') prefix = 'SPR-BLD';
    else if (category === 'General Spares') prefix = 'SPR-GEN';
    else if (category === 'Tractor Spare') prefix = 'SPR-TCT';
    else if (category.includes('Blades') || category.includes('Fasteners')) prefix = 'SPR-BLD';
    else if (category.includes('PTO') || category.includes('Gearbox') || category.includes('Transmission')) prefix = 'SPR-PTO';
    else if (category.includes('Hydraulic') || category.includes('Cylinder')) prefix = 'SPR-HYD';
    else if (category.includes('Engine') || category.includes('Spares')) prefix = 'SPR-ENG';
    else if (category.includes('Bearing') || category.includes('Belt') || category.includes('Seal')) prefix = 'SPR-BRG';
    return `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
  };

  // Filtered Spares list for Search tab
  const matchedSpares = useMemo(() => {
    return activeProducts.filter(p => {
      if (!isSpareProduct(p)) return false;

      if (spareCategoryFilter !== 'all' && p.category !== spareCategoryFilter) {
        return false;
      }

      if (spareModelFilter !== 'all') {
        const modelsText = `${p.compatibleModels?.join(' ') || ''} ${p.name} ${p.description || ''}`.toLowerCase();
        if (!modelsText.includes(spareModelFilter.toLowerCase())) {
          return false;
        }
      }

      if (spareSearchText.trim()) {
        const q = spareSearchText.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku.toLowerCase().includes(q);
        const matchesOem = p.oemPartNumber?.toLowerCase().includes(q);
        const matchesBin = p.shelfBinLocation?.toLowerCase().includes(q);
        const matchesBrand = p.brand?.toLowerCase().includes(q);
        const matchesModels = p.compatibleModels?.some(m => m.toLowerCase().includes(q));
        const matchesAlt = p.alternateNames?.some(n => n.toLowerCase().includes(q));
        if (!matchesName && !matchesSku && !matchesOem && !matchesBin && !matchesBrand && !matchesModels && !matchesAlt) {
          return false;
        }
      }

      return true;
    });
  }, [products, spareSearchText, spareCategoryFilter, spareModelFilter]);

  const handleQuickStockAdd = async (product: Product, qty: number) => {
    const wh = warehouses.find(w => w.id === newSpareWarehouseId) || warehouses[0];
    if (!wh || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createStockAdjustment({
        warehouseId: wh.id,
        productId: product.id,
        adjustmentType: 'Increase',
        quantity: qty,
        reason: 'Quick inward top-up via Spares manager'
      });
    } catch (error: any) {
      showToast('Stock top-up failed', error?.message || 'The server rejected this adjustment.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isQuickAddOpen) return null;

  const handleSaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cust = customers.find(c => c.id === saleCustomerId);
    if (!cust) return;

    let subtotal = 0;
    let taxAmount = 0;

    const formattedItems = saleItems.map(it => {
      const prod = products.find(p => p.id === it.productId);
      const rate = it.rate || prod?.sellingPrice || 100;
      const base = rate * it.quantity;
      const disc = base * (it.discountPercent / 100);
      const taxable = base - disc;
      const tax = taxable * ((prod?.gstRate || 18) / 100);
      const total = taxable + tax;

      subtotal += taxable;
      taxAmount += tax;

      return {
        productId: it.productId,
        productName: prod?.name || 'Product',
        sku: prod?.sku || 'SKU-001',
        unit: prod?.unit || 'Nos',
        quantity: it.quantity,
        rate,
        discountPercent: it.discountPercent,
        taxRate: prod?.gstRate || 18,
        taxAmount: tax,
        totalAmount: total,
        hsnCode: prod?.hsnCode
      };
    });

    const grandTotal = subtotal + taxAmount;

    createSalesOrder({
      customerId: cust.id,
      customerName: cust.companyName,
      branchId: saleBranchId,
      warehouseId: saleWarehouseId,
      salesperson: 'Admin User',
      orderDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
      items: formattedItems,
      subtotal,
      totalDiscount: 0,
      taxAmount,
      grandTotal,
      paidAmount: 0,
      balanceAmount: grandTotal,
      paymentStatus: 'Unpaid',
      status: 'Confirmed',
      shippingAddress: cust.address
    });

    setIsQuickAddOpen(false);
  };

  const handleCustomerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustCompany.trim()) return;
    if (newCustPhone.replace(/\D/g, '').length < 10) {
      showToast('Mobile number needed', "Enter the customer's 10 digit mobile number.", 'error');
      return;
    }
    if (!newCustCity.trim()) {
      showToast('Town needed', "Enter the customer's town or city.", 'error');
      return;
    }

    addCustomer({
      name: newCustName || newCustCompany,
      companyName: newCustCompany,
      phone: newCustPhone.trim(),
      email: '',
      address: newCustCity.trim(),
      city: newCustCity,
      gstin: newCustGstin.trim().toUpperCase(),
      creditLimit: newCustCreditLimit,
      creditPeriodDays: 30,
      lastTransactionDate: new Date().toISOString().split('T')[0],
      rating: 'A',
      status: 'Active',
      branchId: branches[0]?.id || 'branch-1'
    });

    setIsQuickAddOpen(false);
  };

  const headStock = (productId: string) =>
    products.find((p) => p.id === productId)?.warehouseStocks?.find((w) => w.warehouseId === HEAD_WAREHOUSE_ID)?.available ?? 0;

  const addTransferProduct = (product: { id: string }) => {
    setTrItems((prev) =>
      prev.some((i) => i.productId === product.id)
        ? prev.map((i) => (i.productId === product.id ? { ...i, qty: i.qty + 1 } : i))
        : [...prev, { productId: product.id, qty: 1 }]
    );
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const toWh = warehouses.find(w => w.id === toWhId);

    if (!toWh || trItems.length === 0) {
      showToast('Transfer incomplete', 'Choose a destination branch and add at least one product.', 'warning');
      return;
    }
    const over = trItems.find((i) => i.qty > headStock(i.productId));
    if (over) {
      const name = products.find((p) => p.id === over.productId)?.name || 'a product';
      showToast('Not enough Head Office stock', `${name}: only ${headStock(over.productId)} available.`, 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await createStockTransfer({
        toBranchId: toWh.branchId,
        toWarehouseId: toWh.id,
        items: trItems.map((i) => ({ productId: i.productId, requestedQty: i.qty })),
        notes: 'Transfer request from header action menu'
      });
      setTrItems([]);
      setIsQuickAddOpen(false);
    } catch (error: any) {
      showToast('Transfer request failed', error?.message || 'The server rejected this request.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // The quick-form categories mapped onto the cash book's expense categories.
  const LEDGER_CATEGORY: Record<string, string> = {
    'Rent': 'Rent',
    'Electricity & Water': 'Electricity',
    'Transport & Freight': 'Transport',
    'Fuel': 'Fuel',
    'Maintenance & Repair': 'Repairs & maintenance',
    'Office Expenses': 'Office supplies',
    'Marketing': 'Marketing'
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expSaving) return;
    // Owners choose the branch; everyone else spends from their own branch.
    const targetBranch = apiIsOwner ? (expBranch || (selectedBranchId !== 'all' ? selectedBranchId : '')) : assignedBranchId;
    if (!targetBranch) {
      showToast('Choose a Branch', 'Select the branch this expense was spent from.', 'error');
      return;
    }
    if (!Number.isFinite(expAmount) || expAmount <= 0) {
      showToast('Invalid Amount', 'Enter an amount greater than zero.', 'error');
      return;
    }
    // Written to the cash book first, so a cash expense reduces the cash in hand and bank / UPI ones leave it alone.
    setExpSaving(true);
    try {
      await ledgerApi.addExpense(apiScope, {
        branchId: targetBranch,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        category: LEDGER_CATEGORY[expCategory] || 'Other',
        vendor: expVendor.trim(),
        amount: expAmount,
        method: expMethod,
        description: expDesc.trim(),
        createdBy: currentRole
      });
    } catch (err: any) {
      showToast('Could Not Record Expense', err?.message || 'The expense was not saved to the cash book.', 'error');
      setExpSaving(false);
      return;
    }
    setExpSaving(false);
    addExpense({
      branchId: targetBranch,
      category: expCategory,
      vendor: expVendor || 'Local Vendor',
      amount: expAmount,
      // Same amount as the cash book entry, so Reports and the Ledger agree.
      taxAmount: 0,
      totalAmount: expAmount,
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      paidFrom: expMethod === 'Cash' ? 'Cash in hand' : expMethod === 'UPI' ? 'UPI' : 'HDFC Corporate Current A/c',
      paymentMethod: expMethod,
      description: expDesc || `Expense logged for ${expCategory}`,
      hasAttachment: false,
      recordedBy: 'Admin User'
    });
    setIsQuickAddOpen(false);
  };

  const handleSpareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpareName.trim() || !newSpareSku.trim() || isSubmitting) return;

    const targetWh = warehouses.find(w => w.id === newSpareWarehouseId) || warehouses[0];

    setIsSubmitting(true);
    try {
    await addProduct({
      name: newSpareName.trim(),
      sku: newSpareSku.trim().toUpperCase(),
      category: newSpareCategory.trim() as ProductCategory,
      subcategory: newSpareSubCategory.trim() || 'Agro Machinery Spares',
      brand: newSpareBrand.trim() || 'Acme Genuine Spares',
      barcode: `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
      hsnCode: newSpareHsn.trim() || '8432',
      gstRate: newSpareGstRate,
      unit: newSpareUnit,
      purchasePrice: newSpareBuyPrice,
      sellingPrice: newSpareSellPrice,
      mrp: newSpareMrp || Math.round(newSpareSellPrice * 1.1),
      minStock: newSpareMinStock,
      maxStock: newSpareMinStock * 8,
      reorderLevel: Math.round(newSpareMinStock * 1.5),
      description: newSpareDescription.trim() || `Compatible: ${newSpareCompatibleModels}. OEM: ${newSpareOem || 'N/A'}. Location: ${newSpareRackBin}`,
      isSparePart: true,
      compatibleModels: newSpareCompatibleModels.split(',').map(m => m.trim()).filter(Boolean),
      alternateNames: newSpareAltNames.split(/[;|,\n]/).map(n => n.trim()).filter(Boolean),
      oemPartNumber: newSpareOem.trim() || undefined,
      shelfBinLocation: newSpareRackBin.trim() || undefined,
      status: newSpareInitialStock <= newSpareMinStock ? (newSpareInitialStock === 0 ? 'Out of Stock' : 'Low Stock') : 'In Stock',
      warehouseStocks: [
        {
          warehouseId: targetWh?.id || 'wh-1',
          rack: newSpareRackBin.split('/')[0]?.replace('Rack', '').trim() || 'RACK-SPR',
          row: '01',
          shelf: 'S-A',
          bin: newSpareRackBin.split('/')[1]?.replace('Bin', '').trim() || 'B-101',
          available: newSpareInitialStock,
          reserved: 0,
          inTransit: 0
        }
      ]
    });

    setSpareSearchText(newSpareSku.trim().toUpperCase());
    setSpareSubMode('search');
    } catch (error: any) {
      showToast('Could not register spare part', error?.message || 'The server rejected this product.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const shownTab = isOwner && activeTab === 'sale' ? 'transfer' : activeTab;

  const quickTabs = [
    ...(isOwner ? [] : [{ id: 'sale', label: '+ Quick Sale', icon: Zap }]),
    { id: 'transfer', label: 'Stock Transfer', icon: ArrowLeftRight },
    { id: 'customer', label: 'New Customer', icon: Users },
    { id: 'expense', label: 'Log Expense', icon: Receipt },
    { id: 'handover', label: 'Cash Handover', icon: Banknote }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Quick Action Creator</h2>
            <p className="text-xs text-slate-500">Fast-entry workflow across core ERP modules</p>
          </div>
          <button
            onClick={() => setIsQuickAddOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Pills */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 sm:flex-nowrap sm:overflow-x-auto dark:border-slate-800 dark:bg-slate-800/40">
          {quickTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = shownTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* TAB 1: SALE - BRANCH USER DIRECTS TO QUICK SALE */}
          {shownTab === 'sale' && !isOwner && (
            <div className="text-center py-8 space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Zap className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Fast Quick Sale Counter
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                  Branch staff use the dedicated Quick Sale screen with multi-item support, instant customer mobile lookup, and automated invoice creation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickAddOpen(false);
                  setCurrentView('quick-sale');
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500 shadow-xs cursor-pointer active:scale-98 transition-all"
              >
                <Zap className="h-4 w-4" />
                <span>Open + Quick Sale Screen</span>
              </button>
            </div>
          )}

          {/* TAB 1: SALES ORDER - BUSINESS OWNER ONLY */}
          {/* TAB 2: STOCK TRANSFER */}
          {shownTab === 'transfer' && (
            <form onSubmit={handleTransferSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">From (Source)</label>
                  <div className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    {warehouses.find(w => w.id === HEAD_WAREHOUSE_ID)?.name || 'Head Office Store'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">To Branch (Destination) *</label>
                  <select
                    value={toWhId}
                    onChange={(e) => setToWhId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {warehouses.filter(w => w.id !== HEAD_WAREHOUSE_ID).map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Add products *</label>
                <div className="mt-1">
                  <ProductSearchSelect
                    value=""
                    onChange={addTransferProduct}
                    warehouseId={HEAD_WAREHOUSE_ID}
                    placeholder="Search by name or SKU and pick to add. Add as many as you need."
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                {trItems.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">No products added yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {trItems.map((it) => {
                      const p = products.find((x) => x.id === it.productId);
                      const avail = headStock(it.productId);
                      return (
                        <li key={it.productId} className="flex items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{p?.name || it.productId}</p>
                            <p className={`text-[11px] ${it.qty > avail ? 'font-bold text-rose-600' : 'text-slate-500'}`}>
                              {p?.sku} · Head Office has {avail} {p?.unit || ''}
                            </p>
                          </div>
                          <input
                            type="number"
                            min="1"
                            value={it.qty}
                            onChange={(e) => {
                              const q = Math.max(1, parseInt(e.target.value) || 1);
                              setTrItems((prev) => prev.map((x) => (x.productId === it.productId ? { ...x, qty: q } : x)));
                            }}
                            className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            aria-label="Quantity"
                          />
                          <button
                            type="button"
                            onClick={() => setTrItems((prev) => prev.filter((x) => x.productId !== it.productId))}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer dark:hover:bg-rose-950/40"
                            aria-label="Remove product"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
                <p className="font-semibold">Workflow Information:</p>
                <p className="mt-0.5 text-[11px] opacity-90">
                  Submitting creates a Transfer Request against Head Office stock. Stock only moves when the Head Office dispatches it, and it joins branch stock once the branch confirms receipt.
                </p>
              </div>

              <div className="mt-3 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700"
                >
                  {isSubmitting ? 'Submitting...' : `Submit Transfer Request${trItems.length ? ` (${trItems.length} item${trItems.length === 1 ? '' : 's'})` : ''}`}
                </button>
              </div>
            </form>
          )}

          {/* CASH HANDOVER: cash taken from one branch to another */}
          {shownTab === 'handover' && <CashHandoverForm onDone={() => setIsQuickAddOpen(false)} onCancel={() => setIsQuickAddOpen(false)} />}

          {/* TAB 3: NEW CUSTOMER */}
          {shownTab === 'customer' && (
            <form onSubmit={handleCustomerSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Dealer / Farmer / FPO Name *</label>
                  <input
                    type="text"
                    required
                    value={newCustCompany}
                    onChange={(e) => setNewCustCompany(e.target.value)}
                    placeholder="e.g. Kisan Agro Equipment & Spares Hub"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Primary Contact Person</label>
                  <input
                    type="text"
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    placeholder="e.g. Gurpreet Singh Sandhu"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Phone Number</label>
                  <input
                    type="text"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    placeholder="+91 98200 00000"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">City / State</label>
                  <input
                    type="text"
                    value={newCustCity}
                    onChange={(e) => setNewCustCity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">GSTIN Number</label>
                  <input
                    type="text"
                    value={newCustGstin}
                    onChange={(e) => setNewCustGstin(e.target.value)}
                    placeholder="00AAAAA0000A1Z0"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Credit Limit ({settings.currencySymbol})</label>
                <input
                  type="number"
                  value={newCustCreditLimit}
                  onChange={(e) => setNewCustCreditLimit(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="mt-3 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500"
                >
                  Save Customer
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: LOG EXPENSE */}
          {shownTab === 'expense' && (
            <form onSubmit={handleExpenseSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {[
                      'Rent',
                      'Electricity & Water',
                      'Transport & Freight',
                      'Fuel',
                      'Salaries',
                      'Maintenance & Repair',
                      'Office Expenses',
                      'Branch Operations',
                      'Marketing',
                      'Misc'
                    ].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Amount ({settings.currencySymbol}) *</label>
                  <input
                    type="number"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {apiIsOwner && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch *</label>
                  <select
                    value={expBranch || (selectedBranchId !== 'all' ? selectedBranchId : '')}
                    onChange={(e) => setExpBranch(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Spent by *</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {([['Cash', 'Cash'], ['Bank Transfer', 'Account'], ['UPI', 'UPI']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setExpMethod(value)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                        expMethod === value
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Payee / Vendor Name</label>
                <input
                  type="text"
                  value={expVendor}
                  onChange={(e) => setExpVendor(e.target.value)}
                  placeholder="e.g. V-Trans Logistics, MSEDCL"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Description / Reference</label>
                <textarea
                  rows={2}
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="Details of the expenditure..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="mt-3 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expSaving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                >
                  {expSaving ? 'Saving...' : 'Record Expense'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
