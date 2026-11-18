import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Zap,
  Phone,
  User,
  MapPin,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  Package,
  Wrench,
  Printer,
  FileText,
  DollarSign,
  ArrowRight,
  Sparkles,
  CreditCard,
  Building2,
  Trash2,
  Check,
  RotateCcw,
  Receipt,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Product, Customer, ProductUnit } from '../../types/erp';
import { identifyCustomerByPhone, createSqlCustomer } from '../../services/api';
import { QuickSaleHistory } from './QuickSaleHistory';
import { TamilVoiceAssistant, type VoiceSaleApi, type VoiceSaleLine } from '../voice/TamilVoiceAssistant';

// The Tamil voice assistant is hidden for now; flip this to true to show it again.
const VOICE_ASSISTANT_ENABLED = false;
import { canUseInvoices } from '../../utils/access';
import { defaultSaleUnit, formatStock, unitOptions, unitWord } from '../../utils/units';

export interface QuickSaleRowItem {
  rowId: string;
  productId: string;
  productName: string;
  sku: string;
  hsnCode: string;
  serialNumber: string;
  unit: ProductUnit; // the unit this line is sold in (Piece, Box, Kg)
  unitFactor?: number; // how many of the product's own unit one of this unit holds (a Box of 18 = 18); missing means 1
  quantity: number;
  actualPrice: number; // price of one `unit`
  masterPrice: number;
  stockAvailable: number;
  searchQuery: string;
  isDropdownOpen: boolean;
}

// The matching-products list floats over the page next to the search box. It is drawn outside the table
// so the table's scroll area cannot cut it off, opens upward when there is no room below, and closes
// when the user clicks anywhere else.
const FloatingList: React.FC<{ anchorSelector: string; onClose: () => void; children: React.ReactNode }> = ({
  anchorSelector,
  onClose,
  children
}) => {
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = document.querySelector(anchorSelector) as HTMLElement | null;
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const openUp = below < 220 && above > below;
      const width = Math.min(Math.max(r.width, 380), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos(
        openUp
          ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(360, above) }
          : { left, width, top: r.bottom + 4, maxHeight: Math.min(360, below) }
      );
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorSelector]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      const anchor = document.querySelector(anchorSelector);
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [anchorSelector, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight, zIndex: 80 }}
      className="overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      {children}
    </div>,
    document.body
  );
};

export const QuickSaleView: React.FC = () => {
  const {
    currentUser,
    currentRole,
    currentBranchName,
    selectedBranchId,
    products,
    activeProducts,
    productsLoading,
    productsError,
    refreshProducts,
    customers,
    warehouses,
    recordQuickSale,
    addCustomer,
    setCurrentView,
    setActiveInvoiceForPrint,
    showToast
  } = useERP();

  const activeBranchId = selectedBranchId !== 'all' ? selectedBranchId : 'branch-1';
  const activeWarehouse = warehouses.find((w) => w.branchId === activeBranchId) || warehouses[0];

  // Stock comes only from the SQL-backed catalogue; a missing stock row means zero, never a guess.
  const stockIn = (prod: Product | undefined): number =>
    prod?.warehouseStocks?.find((ws) => ws.warehouseId === activeWarehouse?.id)?.available ?? 0;
  const liveStock = (productId: string): number => stockIn(products.find((p) => p.id === productId));

  // ========================================================
  // 1. CUSTOMER STATE (Selected once for the entire sale)
  // ========================================================
  const [mobileInput, setMobileInput] = useState<string>('');
  const [isSearchingPhone, setIsSearchingPhone] = useState<boolean>(false);
  const [phoneSearchStatus, setPhoneSearchStatus] = useState<'idle' | 'found' | 'not_found'>('idle');
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [saleTab, setSaleTab] = useState<'new' | 'history'>('new');

  // New Customer inline registration form
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustLocality, setNewCustLocality] = useState<string>('');
  const [newCustGstin, setNewCustGstin] = useState<string>('');

  // Dropdown for selecting existing registered customer
  const [isCustomerSelectorOpen, setIsCustomerSelectorOpen] = useState<boolean>(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');

  // ========================================================
  // 2. SALE ITEMS STATE (Multi-Item Relational Rows)
  // ========================================================
  const createInitialRow = (prod?: Product): QuickSaleRowItem => {
    const p = prod;
    const available = stockIn(p);
    const start = defaultSaleUnit(p);
    return {
      rowId: `row-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productId: p ? p.id : '',
      productName: p ? p.name : '',
      sku: p ? p.sku : '',
      hsnCode: p ? (p.hsnCode || '8432') : '8432',
      serialNumber: '',
      unit: (start.unit as ProductUnit) || 'Nos',
      unitFactor: start.factor,
      quantity: 1,
      actualPrice: p ? Math.round(p.sellingPrice * start.factor * 100) / 100 : 0,
      masterPrice: p ? Math.round(p.sellingPrice * start.factor * 100) / 100 : 0,
      stockAvailable: available,
      searchQuery: p ? p.name : '',
      isDropdownOpen: false
    };
  };

  const [rows, setRows] = useState<QuickSaleRowItem[]>([
    createInitialRow()
  ]);

  // ---- support for the voice assistant (manual entry works exactly as before) ----
  const rowsRef = useRef<QuickSaleRowItem[]>(rows);
  rowsRef.current = rows;
  // The pre-filled first row stays "untouched" until the user edits it; a voice order replaces it instead of adding to it.
  const defaultRowIdRef = useRef<string | null>(rows[0]?.productId ? rows[0].rowId : null);
  const releaseDefaultRow = (rowId: string) => {
    if (defaultRowIdRef.current === rowId) defaultRowIdRef.current = null;
  };
  // One id per draft sale: a retried save hits the same sale record instead of creating another one.
  const draftSaleIdRef = useRef<string>(`sale-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  const savingRef = useRef<boolean>(false);

  // Overall sale settings
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  // The day of the sale: today unless a paper bill from an earlier day is being entered.
  const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [saleDate, setSaleDate] = useState<string>(todayIst());
  // Secondary payment: the customer pays part one way (for example UPI) and the rest another way (cash).
  const [splitOn, setSplitOn] = useState(false);
  const [firstAmount, setFirstAmount] = useState(''); // what was paid by the first method
  const [secondMethodPick, setSecondMethodPick] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const isBackDated = saleDate !== todayIst();
  const [saleOverallDiscount, setSaleOverallDiscount] = useState<number>(0);
  const discountRef = useRef<number>(0);
  discountRef.current = saleOverallDiscount;
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Completed sale confirmation modal
  const [completedSale, setCompletedSale] = useState<{
    saleNumber: string;
    invoiceNumber: string;
    grandTotal: number;
    itemCount: number;
    customerName: string;
    payment: string;
    invoiceObj: any;
  } | null>(null);

  // ========================================================
  // CUSTOMER PHONE LOOKUP (Debounced)
  // ========================================================
  useEffect(() => {
    const typed = mobileInput.replace(/\D/g, '');
    // Only a complete mobile number (the last 10 digits) is looked up, so a customer is never picked by guesswork.
    const clean = typed.length >= 10 ? typed.slice(-10) : typed;
    if (clean.length < 10) {
      setPhoneSearchStatus('idle');
      if (clean.length === 0 && !matchedCustomer) {
        setMatchedCustomer(null);
      }
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingPhone(true);
      try {
        const remoteMatches = await identifyCustomerByPhone(clean).catch(() => []);
        const localMatches = customers.filter((c) => {
          const cClean = c.phone.replace(/\D/g, '');
          const altClean = c.alternatePhone ? c.alternatePhone.replace(/\D/g, '') : '';
          return cClean.includes(clean) || altClean.includes(clean);
        });

        const all = remoteMatches.length > 0 ? remoteMatches : localMatches;

        if (all.length > 0) {
          const match = all[0];
          setMatchedCustomer(match);
          setPhoneSearchStatus('found');
          setIsAddCustomerOpen(false);
        } else {
          setPhoneSearchStatus('not_found');
          setMatchedCustomer(null);
          // A number that is not in the directory yet: open the registration form straight away.
          setIsAddCustomerOpen(true);
        }
      } catch (err) {
        setPhoneSearchStatus('not_found');
      } finally {
        setIsSearchingPhone(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [mobileInput, customers]);

  // Handle Quick Inline Customer Creation
  const handleSaveInlineCustomer = async () => {
    if (!newCustName.trim()) {
      showToast('Name needed', "Enter the customer's name.", 'error');
      return;
    }
    if (!newCustLocality.trim()) {
      showToast('Town needed', "Enter the customer's locality or town.", 'error');
      return;
    }
    const digitsOnly = mobileInput.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      showToast('Mobile number needed', "Enter the customer's 10 digit mobile number first.", 'error');
      return;
    }
    const cleanPhone = digitsOnly.slice(-10);
    if (isSavingCustomer) return;
    setIsSavingCustomer(true);

    try {
      const created = await createSqlCustomer({
        name: newCustName.trim(),
        phone: cleanPhone,
        address: newCustLocality.trim(),
        locality: newCustLocality.trim(),
        city: newCustLocality.trim(),
        state: 'Tamil Nadu',
        gstin: newCustGstin.trim().toUpperCase(),
        creditLimit: 200000,
        creditPeriodDays: 30
      });

      const fullCustomer: Customer = {
        id: created.id,
        customerId: created.customerId || `CUST-${Date.now().toString().slice(-4)}`,
        name: created.name,
        companyName: created.companyName || created.name,
        phone: created.phone,
        email: created.email || '',
        address: created.address,
        locality: newCustLocality.trim(),
        city: created.city,
        state: 'Tamil Nadu',
        pincode: created.pincode || '',
        gstin: created.gstin || '',
        creditLimit: created.creditLimit,
        creditPeriodDays: 30,
        outstandingBalance: 0,
        totalSales: 0,
        lastTransactionDate: new Date().toISOString().split('T')[0],
        rating: 'A',
        status: 'Active',
        branchId: activeBranchId
      };

      addCustomer(fullCustomer, { alreadySaved: true });
      setMatchedCustomer(fullCustomer);
      setPhoneSearchStatus('found');
      setIsAddCustomerOpen(false);
      showToast('Customer Created', `Registered ${fullCustomer.name} to this branch.`, 'success');
    } catch (e: any) {
      showToast('Customer not saved', e.message || 'Could not save the customer. Please try again.', 'error');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // ========================================================
  // ROW ACTIONS (Add, Remove, Update, Autocomplete)
  // ========================================================
  const handleAddRow = () => {
    if (defaultRowIdRef.current) defaultRowIdRef.current = null;
    const newRow: QuickSaleRowItem = {
      rowId: `row-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productId: '',
      productName: '',
      sku: '',
      hsnCode: '8432',
      serialNumber: '',
      unit: 'Nos',
      quantity: 1,
      actualPrice: 0,
      masterPrice: 0,
      stockAvailable: 0,
      searchQuery: '',
      isDropdownOpen: true
    };
    setRows((prev) => [...prev, newRow]);
  };

  const handleRemoveRow = (rowId: string) => {
    releaseDefaultRow(rowId);
    if (rows.length === 1) {
      // Clear the single row instead of leaving 0 rows
      setRows([
        {
          rowId: `row-${Date.now()}`,
          productId: '',
          productName: '',
          sku: '',
          hsnCode: '8432',
          serialNumber: '',
          unit: 'Nos',
          quantity: 1,
          actualPrice: 0,
          masterPrice: 0,
          stockAvailable: 0,
          searchQuery: '',
          isDropdownOpen: false
        }
      ]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const handleSelectProductForRow = (rowId: string, prod: Product) => {
    releaseDefaultRow(rowId);
    const available = stockIn(prod);
    // Blades open on the Box; everything else on its own unit.
    const start = defaultSaleUnit(prod);
    const startPrice = Math.round(prod.sellingPrice * start.factor * 100) / 100;
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        return {
          ...r,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          hsnCode: prod.hsnCode || '8432',
          unit: start.unit as ProductUnit,
          unitFactor: start.factor,
          actualPrice: startPrice,
          masterPrice: startPrice,
          stockAvailable: available,
          searchQuery: prod.name,
          isDropdownOpen: false
        };
      })
    );
  };

  // Switching the unit (for example Piece to Box) changes the price to the price of one of that unit.
  const handleChangeUnit = (rowId: string, unit: string) => {
    releaseDefaultRow(rowId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const prod = products.find((p) => p.id === r.productId);
        const opt = unitOptions(prod).find((o) => o.unit === unit);
        if (!prod || !opt) return r;
        const price = Math.round(prod.sellingPrice * opt.factor * 100) / 100;
        return { ...r, unit: opt.unit as ProductUnit, unitFactor: opt.factor, actualPrice: price, masterPrice: price };
      })
    );
  };

  const handleUpdateRowField = (rowId: string, field: keyof QuickSaleRowItem, value: any) => {
    // opening or searching the product box is not an edit; changing the data is
    if (field !== 'isDropdownOpen') releaseDefaultRow(rowId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        return {
          ...r,
          [field]: value
        };
      })
    );
  };

  // Filter products for each row based on search query
  const getFilteredProductsForRow = (query: string): Product[] => {
    const q = query.trim().toLowerCase();
    if (!q) return activeProducts.slice(0, 8);
    return activeProducts
      .filter((p) => {
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.hsnCode?.toLowerCase().includes(q) ||
          (p.oemPartNumber && p.oemPartNumber.toLowerCase().includes(q)) ||
          (p.alternateNames && p.alternateNames.some((n) => n.toLowerCase().includes(q))) ||
          p.category?.toLowerCase().includes(q)
        );
      })
      .slice(0, 10);
  };

  // ========================================================
  // REAL-TIME CALCULATIONS (Instant, No Page Refresh)
  // ========================================================
  const calculations = useMemo(() => {
    // No GST and no per-item discount: each line is quantity x price, and one overall discount comes off the total.
    let subtotal = 0;

    const rowDetails = rows.map((r) => {
      const qty = Math.max(1, r.quantity || 1);
      const price = Math.max(0, r.actualPrice || 0);
      const lineTot = qty * price;
      subtotal += lineTot;
      return { rowId: r.rowId, lineTot };
    });

    const totalDiscount = Math.min(subtotal, Math.max(0, saleOverallDiscount || 0));
    const grandTotal = Math.max(0, subtotal - totalDiscount);

    return {
      subtotal,
      totalDiscount,
      grandTotal,
      rowDetails
    };
  }, [rows, saleOverallDiscount]);

  // Secondary payment numbers: the second method must differ from the first; its amount is what is left after the
  // first payment.
  const billTotal = Math.round(calculations.grandTotal);
  const secondMethod = (secondMethodPick !== paymentMethod ? secondMethodPick : (['Cash', 'UPI', 'Bank Transfer'] as const).find((m) => m !== paymentMethod)!) as 'Cash' | 'UPI' | 'Bank Transfer';
  const firstPaid = Number(firstAmount);
  const splitOk = Number.isFinite(firstPaid) && firstPaid > 0 && firstPaid < billTotal;
  const secondAmount = splitOk ? Math.round((billTotal - firstPaid) * 100) / 100 : 0;

  // ========================================================
  // SAVE SALE (Multi-Item Relational Transaction)
  // ========================================================
  const handleSaveSale = async (): Promise<{ ok: boolean; message?: string; invoiceNumber?: string; total?: number }> => {
    if (savingRef.current) return { ok: false, message: 'A save is already in progress.' };
    // 1. Validation
    setSaveError(null);
    const validRows = rows.filter((r) => r.productId && r.productName.trim() !== '');
    if (validRows.length === 0) {
      showToast('Validation Error', 'Please select at least one product before saving.', 'error');
      return { ok: false, message: 'Please select at least one product before saving.' };
    }

    // Same product on several rows must fit within stock together.
    const requested = new Map<string, number>();
    validRows.forEach((r) => requested.set(r.productId, (requested.get(r.productId) || 0) + r.quantity * (r.unitFactor || 1)));
    for (const [productId, qty] of requested) {
      const available = liveStock(productId);
      if (qty > available) {
        const name = validRows.find((r) => r.productId === productId)?.productName || 'item';
        const prod = products.find((p) => p.id === productId);
        const msg = `Not enough stock for ${name}: ${formatStock(available, prod)} available, ${formatStock(qty, prod)} requested.`;
        setSaveError(msg);
        showToast('Insufficient stock', msg, 'error');
        return { ok: false, message: msg };
      }
    }

    // Two-way payment: the first part must be more than 0 and less than the bill.
    if (splitOn && !splitOk) {
      const msg = 'For a secondary payment, enter how much was paid by the first method: more than 0 and less than the bill total.';
      setSaveError(msg);
      showToast('Check the payment', msg, 'error');
      return { ok: false, message: msg };
    }

    // Every sale is recorded against a named customer with a mobile number (no anonymous walk-in sales).
    if (!matchedCustomer) {
      const msg = 'Enter the customer mobile number and pick or add the customer before saving the sale.';
      setSaveError(msg);
      showToast('Customer needed', msg, 'error');
      return { ok: false, message: msg };
    }
    if (!String(matchedCustomer.phone || '').replace(/\D/g, '')) {
      const msg = 'This customer has no mobile number. Add it on the Customers page first.';
      setSaveError(msg);
      showToast('Mobile number needed', msg, 'error');
      return { ok: false, message: msg };
    }
    const customer = matchedCustomer;

    setIsSaving(true);
    savingRef.current = true;
    try {
      const saleItemsData = validRows.map((r) => {
        const detail = calculations.rowDetails.find((d) => d.rowId === r.rowId);
        return {
          productId: r.productId,
          productName: r.productName,
          sku: r.sku,
          serialNumber: r.serialNumber.trim() || undefined,
          unit: r.unit,
          unitFactor: r.unitFactor || 1,
          quantity: r.quantity,
          unitPrice: r.actualPrice, // price of one `unit`; does NOT touch the master price
          discount: 0,
          gst: 0,
          lineTotal: detail ? detail.lineTot : Math.max(1, r.quantity || 1) * r.actualPrice,
          hsnCode: r.hsnCode
        };
      });

      // Execute atomic transaction in ERPContext:
      // 1. Saves Sale to `sales`
      // 2. Inserts each item into `sale_items`
      // 3. Decrements stock for EVERY product in this transaction
      // 4. Generates Tax Invoice containing ALL items
      // 5. Updates customer totalSales & logs audit trail
      // 6. Calls `/api/sales` backend endpoint
      const result = await recordQuickSale({
        customerId: customer.id,
        customerName: customer.companyName || customer.name,
        customerPhone: customer.phone,
        customerGstin: customer.gstin,
        customerAddress: customer.address,
        branchId: activeBranchId,
        warehouseId: activeWarehouse?.id,
        paymentMethod,
        ...(splitOn && splitOk ? { secondaryPaymentMethod: secondMethod, secondaryPaymentAmount: secondAmount } : {}),
        saleDate,
        discount: calculations.totalDiscount,
        saleId: draftSaleIdRef.current,
        items: saleItemsData
      });
      // the draft is finished: the next one gets its own sale id
      draftSaleIdRef.current = `sale-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      // Show completed summary modal
      setCompletedSale({
        saleNumber: result.sale.saleNumber,
        invoiceNumber: result.invoice.invoiceNumber,
        grandTotal: result.sale.grandTotal,
        itemCount: validRows.length,
        customerName: customer.companyName || customer.name,
        payment:
          splitOn && splitOk
            ? `${paymentMethod} ₹${firstPaid.toLocaleString('en-IN')} + ${secondMethod} ₹${secondAmount.toLocaleString('en-IN')}`
            : paymentMethod,
        invoiceObj: result.invoice
      });

      showToast(
        'Sale Saved Successfully!',
        `Recorded ${validRows.length} item(s) for ${customer.name}. Invoice #${result.invoice.invoiceNumber} generated.`,
        'success'
      );
      return { ok: true, invoiceNumber: result.invoice.invoiceNumber, total: result.sale.grandTotal };
    } catch (err: any) {
      // recordQuickSale already raised a toast for the server's rejection (for example a 409 on stock); show it inline as well.
      setSaveError(err?.message || 'Failed to save multi-item sale.');
      return { ok: false, message: err?.message || 'Failed to save multi-item sale.' };
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleStartNextSale = () => {
    setCompletedSale(null);
    setSplitOn(false);
    setFirstAmount('');
    setMobileInput('');
    setMatchedCustomer(null);
    setPhoneSearchStatus('idle');
    setSaleOverallDiscount(0);
    setSaleDate(todayIst());
    const fresh = createInitialRow();
    defaultRowIdRef.current = fresh.productId ? fresh.rowId : null;
    draftSaleIdRef.current = `sale-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    setRows([fresh]);
  };

  // ========================================================
  // VOICE ASSISTANT BRIDGE (reads and edits this same sale)
  // ========================================================
  const commitRows = (next: QuickSaleRowItem[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const voiceLine = (productId: string): VoiceSaleLine | undefined => {
    const rs = rowsRef.current.filter((r) => r.productId === productId);
    if (!rs.length) return undefined;
    return {
      productId,
      name: rs[0].productName,
      sku: rs[0].sku,
      quantity: rs.reduce((a, r) => a + r.quantity, 0),
      unitPrice: rs[0].actualPrice,
      stock: liveStock(productId)
    };
  };

  const voiceTotals = () => {
    const subtotal = rowsRef.current.reduce((a, r) => (r.productId ? a + Math.max(1, r.quantity || 1) * Math.max(0, r.actualPrice || 0) : a), 0);
    const discount = Math.min(subtotal, Math.max(0, discountRef.current || 0));
    return { subtotal, discount, grandTotal: Math.max(0, subtotal - discount) };
  };

  const voiceApi: VoiceSaleApi = {
    warehouseId: activeWarehouse?.id,
    customerBranchId: selectedBranchId !== 'all' ? selectedBranchId : undefined,
    getLines: () => {
      const ids: string[] = [];
      rowsRef.current.forEach((r) => {
        if (r.productId && !ids.includes(r.productId)) ids.push(r.productId);
      });
      return ids.map((id) => voiceLine(id)!).filter(Boolean);
    },
    getTotals: voiceTotals,
    getCustomerLabel: () => (matchedCustomer ? matchedCustomer.companyName || matchedCustomer.name : null),
    addProduct: (productId, qty) => {
      const prod = products.find((p) => p.id === productId);
      if (!prod) {
        refreshProducts();
        return { ok: false, error: 'This product is not in the loaded list yet.' };
      }
      let base = rowsRef.current;
      if (defaultRowIdRef.current) {
        const dId = defaultRowIdRef.current;
        defaultRowIdRef.current = null;
        base = base.filter((r) => r.rowId !== dId);
      }
      const previous = base.filter((r) => r.productId === productId).reduce((a, r) => a + r.quantity, 0);
      const existing = base.find((r) => r.productId === productId);
      let next: QuickSaleRowItem[];
      if (existing) {
        // the same product again adds to its quantity
        next = base.map((r) => (r.rowId === existing.rowId ? { ...r, quantity: r.quantity + qty } : r));
      } else {
        const row: QuickSaleRowItem = {
          rowId: `row-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          hsnCode: prod.hsnCode || '8432',
          serialNumber: '',
          unit: (prod.unit as ProductUnit) || 'Nos',
          quantity: qty,
          actualPrice: prod.sellingPrice, // the master price, never edited by voice
          masterPrice: prod.sellingPrice,
          stockAvailable: stockIn(prod),
          searchQuery: prod.name,
          isDropdownOpen: false
        };
        const emptyRow = base.find((r) => !r.productId);
        next = emptyRow ? base.map((r) => (r.rowId === emptyRow.rowId ? row : r)) : [...base, row];
      }
      commitRows(next);
      return { ok: true, line: voiceLine(productId), previous };
    },
    setLineQuantity: (productId, qty) => {
      let first = true;
      const next = rowsRef.current
        .map((r) => {
          if (r.productId !== productId) return r;
          if (first) {
            first = false;
            return { ...r, quantity: qty };
          }
          return null; // other rows of the same product are folded into one
        })
        .filter((r): r is QuickSaleRowItem => r !== null);
      if (first) return { ok: false, error: 'not in sale' };
      commitRows(next);
      return { ok: true, line: voiceLine(productId) };
    },
    reduceLine: (productId, by) => {
      const line = voiceLine(productId);
      if (!line) return { ok: false, error: 'not in sale' };
      const target = by !== null && by > 0 ? line.quantity - by : 0;
      const name = line.name;
      if (target <= 0) {
        let next = rowsRef.current.filter((r) => r.productId !== productId);
        if (!next.length) {
          next = [
            {
              rowId: `row-${Date.now()}`,
              productId: '',
              productName: '',
              sku: '',
              hsnCode: '8432',
              serialNumber: '',
              unit: 'Nos',
              quantity: 1,
              actualPrice: 0,
              masterPrice: 0,
              stockAvailable: 0,
              searchQuery: '',
              isDropdownOpen: false
            }
          ];
        }
        commitRows(next);
        return { ok: true, name, removed: true };
      }
      let first = true;
      const next = rowsRef.current
        .map((r) => {
          if (r.productId !== productId) return r;
          if (first) {
            first = false;
            return { ...r, quantity: target };
          }
          return null;
        })
        .filter((r): r is QuickSaleRowItem => r !== null);
      commitRows(next);
      return { ok: true, name, removed: false, now: target };
    },
    clear: () => {
      defaultRowIdRef.current = null;
      commitRows([
        {
          rowId: `row-${Date.now()}`,
          productId: '',
          productName: '',
          sku: '',
          hsnCode: '8432',
          serialNumber: '',
          unit: 'Nos',
          quantity: 1,
          actualPrice: 0,
          masterPrice: 0,
          stockAvailable: 0,
          searchQuery: '',
          isDropdownOpen: false
        }
      ]);
      discountRef.current = 0;
      setSaleOverallDiscount(0);
    },
    setOverallDiscount: (amount) => {
      discountRef.current = amount;
      setSaleOverallDiscount(amount);
    },
    selectCustomer: (c) => {
      const picked: Customer = {
        id: c.id,
        customerId: c.customerId || undefined,
        name: c.name || c.companyName,
        companyName: c.companyName || c.name,
        phone: c.phone,
        alternatePhone: c.alternatePhone || undefined,
        email: c.email || '',
        address: c.address || '',
        locality: c.locality || undefined,
        city: c.city || '',
        state: c.state || 'Tamil Nadu',
        pincode: c.pincode || undefined,
        gstin: c.gstin || '',
        creditLimit: Number(c.creditLimit) || 0,
        creditPeriodDays: Number(c.creditPeriodDays) || 0,
        outstandingBalance: Number(c.outstandingBalance) || 0,
        totalSales: 0,
        lastTransactionDate: c.lastTransactionDate || '',
        rating: (c.rating as Customer['rating']) || 'A',
        status: 'Active',
        branchId: c.branchId || activeBranchId
      };
      setMatchedCustomer(picked);
      setMobileInput(picked.phone || '');
      setPhoneSearchStatus('found');
      setIsAddCustomerOpen(false);
    },
    save: handleSaveSale
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 max-md:pb-28">
      {/* ========================================================
          HEADER BANNER
         ======================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md shadow-inner text-white">
            <Zap className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-black tracking-tight">Quick Sale</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartNextSale}
            className="flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 px-3.5 py-2 text-xs font-bold text-white border border-white/20 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Form</span>
          </button>
          <button
            type="button"
            onClick={() => setCurrentView('billing')}
            className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50 transition-colors cursor-pointer shadow-xs"
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>Invoices & Billing</span>
          </button>
        </div>
      </div>

      {/* Tabs: record a new sale, or look back at the sales already made */}
      <div role="tablist" aria-label="Quick sale" className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {([
          ['new', 'New Sale'],
          ['history', 'Sale History']
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={saleTab === id}
            onClick={() => setSaleTab(id)}
            className={`cursor-pointer rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              saleTab === id
                ? 'bg-white text-blue-700 shadow-2xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {saleTab === 'history' ? (
        <QuickSaleHistory />
      ) : (
      <>
      {productsError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <span>Could not load live stock: {productsError}</span>
          <button type="button" onClick={() => refreshProducts()} className="font-bold underline cursor-pointer">Retry</button>
        </div>
      )}
      {productsLoading && products.length === 0 && !productsError && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
          Loading product catalogue and branch stock...
        </div>
      )}

      {/* Main Single-Screen Form Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-6">
        
        {/* Tamil voice assistant: switched off for now. Set VOICE_ASSISTANT_ENABLED to true to bring it back. */}
        {VOICE_ASSISTANT_ENABLED && <TamilVoiceAssistant api={voiceApi} />}

        {/* ========================================================
            STEP 1: CUSTOMER SELECTION (Entered ONCE for entire sale)
           ======================================================== */}
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Phone className="h-4 w-4 text-blue-600" />
              <span>Customer</span>
            </label>
          </div>

          {!matchedCustomer ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    type="tel"
                    value={mobileInput}
                    onChange={(e) => setMobileInput(e.target.value)}
                    placeholder="Enter Customer Mobile Number (e.g. 9876543210)..."
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-4 pr-10 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isSearchingPhone ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    ) : (
                      <Search className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Not Found Banner */}
              {phoneSearchStatus === 'not_found' && !isAddCustomerOpen && (
                <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        No customer registered with mobile "{mobileInput}"
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        Add this customer in 5 seconds to link this sale to their account.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAddCustomerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-500 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add New Customer</span>
                  </button>
                </div>
              )}

              {/* Inline Customer Registration */}
              {isAddCustomerOpen && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/60 dark:bg-slate-900 space-y-3 animate-in fade-in">
                  <h4 className="text-xs font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    <span>Quick Register Customer for this Sale</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Customer / Farmer Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        placeholder="e.g. Ravi Kumar"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Locality / Town *
                      </label>
                      <input
                        type="text"
                        required
                        value={newCustLocality}
                        onChange={(e) => setNewCustLocality(e.target.value)}
                        placeholder="e.g. Sampletown / Sampletown"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        GSTIN (Optional)
                      </label>
                      <input
                        type="text"
                        value={newCustGstin}
                        onChange={(e) => setNewCustGstin(e.target.value)}
                        placeholder="00AAAAA0000A1Z0"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddCustomerOpen(false)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveInlineCustomer}
                      disabled={isSavingCustomer}
                      className="rounded-lg bg-blue-600 px-4 py-1 text-xs font-bold text-white shadow-xs hover:bg-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingCustomer ? 'Saving...' : 'Save & Select Customer'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Customer Selected Card */
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/40">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold">
                  <Check className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {matchedCustomer.companyName || matchedCustomer.name}
                    </span>
                    <span className="rounded bg-emerald-200/80 px-2 py-0.2 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                      Customer Selected
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Mobile: <strong>{matchedCustomer.phone}</strong> • Locality:{' '}
                    <strong>{matchedCustomer.locality || matchedCustomer.city || 'Sampletown'}</strong>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMatchedCustomer(null);
                  setPhoneSearchStatus('idle');
                  setMobileInput('');
                }}
                className="self-end sm:self-center text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer underline"
              >
                Change Customer
              </button>
            </div>
          )}
        </div>

        {/* ========================================================
            STEP 2: MULTI-ITEM PRODUCTS TABLE (Repeated Rows & + Add Item)
           ======================================================== */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Package className="h-4 w-4 text-blue-600" />
                <span>Products</span>
              </h3>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                {rows.length} {rows.length === 1 ? 'Item' : 'Items'}
              </span>
            </div>
          </div>

          {/* Item Rows Table */}
          {/* Phones show each product as its own card; larger screens keep the table */}
          <div className="md:overflow-x-auto md:rounded-xl md:border md:border-slate-200 md:dark:border-slate-800">
            <table className="block w-full text-left text-xs border-collapse md:table">
              <thead className="hidden border-b border-slate-200 bg-slate-50 font-bold text-slate-700 md:table-header-group dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300">
                <tr>
                  <th className="py-2.5 px-3 w-8 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[280px]">Product Search & Item Details</th>
                  <th className="py-2.5 px-3 w-36 text-center">Qty</th>
                  <th className="py-2.5 px-3 w-28 text-center">Unit</th>
                  <th className="py-2.5 px-3 w-32 text-right">Unit Price (₹)</th>
                  <th className="py-2.5 px-3 w-28 text-right">Total (₹)</th>
                  <th className="py-2.5 px-3 w-10 text-center"></th>
                </tr>
              </thead>

              <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100 md:dark:divide-slate-800">
                {rows.map((row, index) => {
                  const detail = calculations.rowDetails.find((d) => d.rowId === row.rowId);
                  const isCustomPrice = row.actualPrice !== row.masterPrice && row.masterPrice > 0;
                  const filteredList = getFilteredProductsForRow(row.searchQuery);

                  return (
                    <tr
                      key={row.rowId}
                      className="relative grid grid-cols-5 gap-x-3 gap-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none dark:border-slate-800 dark:bg-slate-900 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* 1. Item Index */}
                      <td className="hidden py-3 px-3 text-center font-bold text-slate-400 md:table-cell">
                        {index + 1}
                      </td>

                      {/* 2. Product Search & Autocomplete */}
                      <td className="col-span-5 block pr-9 md:table-cell md:px-3 md:py-3 md:pr-3">
                        <div className="relative">
                          <div className="flex items-center gap-1.5">
                            <div className="relative flex-1">
                              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                              <input
                                type="text"
                                data-qs-row={row.rowId}
                                value={row.searchQuery}
                                onFocus={() => handleUpdateRowField(row.rowId, 'isDropdownOpen', true)}
                                onChange={(e) => {
                                  handleUpdateRowField(row.rowId, 'searchQuery', e.target.value);
                                  handleUpdateRowField(row.rowId, 'isDropdownOpen', true);
                                }}
                                placeholder="Search product name, item no (PT-00125), or HSN..."
                                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-xs font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>
                          </div>

                          {/* Product Details Pills if Selected */}
                          {row.productId && (
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
                                Item: {row.sku}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                HSN: {row.hsnCode}
                              </span>
                              {(row.unitFactor || 1) > 1 && (
                                <span className="text-[10px] text-slate-500">
                                  1 {unitWord(row.unit, 1)} = {row.unitFactor} {unitWord(products.find((p) => p.id === row.productId)?.unit, row.unitFactor)}
                                </span>
                              )}
                              <span className={`text-[10px] font-semibold ${liveStock(row.productId) < row.quantity * (row.unitFactor || 1) ? 'text-rose-600 font-bold' : 'text-emerald-600'}`}>
                                Stock: {formatStock(liveStock(row.productId), products.find((p) => p.id === row.productId))}{liveStock(row.productId) < row.quantity * (row.unitFactor || 1) ? ' (not enough)' : ''}
                              </span>
                            </div>
                          )}

                          {/* Autocomplete Dropdown */}
                          {row.isDropdownOpen && (
                            <FloatingList
                              anchorSelector={`[data-qs-row="${row.rowId}"]`}
                              onClose={() => handleUpdateRowField(row.rowId, 'isDropdownOpen', false)}
                            >
                              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 px-2 py-1 uppercase">
                                <span>Matching Products</span>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateRowField(row.rowId, 'isDropdownOpen', false)}
                                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>

                              {filteredList.map((p) => {
                                const stock = stockIn(p);
                                return (
                                  <div
                                    key={p.id}
                                    onClick={() => handleSelectProductForRow(row.rowId, p)}
                                    className="flex items-center justify-between rounded-lg p-2 hover:bg-blue-50/70 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                                  >
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                                          {p.name}
                                        </span>
                                        <span className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400">
                                          {p.sku}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-500 mt-0.5">
                                        HSN: {p.hsnCode} • Stock: {formatStock(stock, p)}
                                      </p>
                                    </div>

                                    <div className="text-right">
                                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                                        ₹{p.sellingPrice.toLocaleString()}
                                      </span>
                                      <p className="text-[9px] text-slate-400">Master Price</p>
                                    </div>
                                  </div>
                                );
                              })}
                              {filteredList.length === 0 && (
                                <p className="px-2 py-3 text-center text-[11px] text-slate-400">
                                  {products.length === 0 ? 'No products in the catalogue yet.' : 'No product matches this search.'}
                                </p>
                              )}
                            </FloatingList>
                          )}
                        </div>
                      </td>

                      {/* 4. Quantity */}
                      <td className="col-span-3 block md:table-cell md:px-3 md:py-3 md:text-center">
                        <span className="mb-1 block text-[11px] font-semibold text-slate-500 md:hidden">Quantity</span>
                        <div className="flex w-full items-center gap-1 md:inline-flex md:w-auto">
                          <button
                            type="button"
                            onClick={() => handleUpdateRowField(row.rowId, 'quantity', Math.max(1, (row.quantity || 1) - 1))}
                            disabled={(row.quantity || 1) <= 1}
                            aria-label="Decrease quantity"
                            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border md:h-7 md:w-7 border-slate-300 bg-white text-base font-bold leading-none text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, Math.floor(liveStock(row.productId) / (row.unitFactor || 1)))}
                            value={row.quantity}
                            onChange={(e) =>
                              handleUpdateRowField(row.rowId, 'quantity', parseInt(e.target.value, 10) || 1)
                            }
                            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white py-1.5 px-1 text-center font-mono font-bold text-sm md:w-14 md:flex-none md:py-1 md:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateRowField(row.rowId, 'quantity', (row.quantity || 0) + 1)}
                            disabled={!!row.productId && (row.quantity || 1) >= Math.max(1, Math.floor(liveStock(row.productId) / (row.unitFactor || 1)))}
                            aria-label="Increase quantity"
                            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border md:h-7 md:w-7 border-slate-300 bg-white text-base font-bold leading-none text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* 4b. Unit: Piece, Box or Kg. Only the units this product is sold in are offered. */}
                      <td className="col-span-2 block md:table-cell md:px-3 md:py-3 md:text-center">
                        <span className="mb-1 block text-[11px] font-semibold text-slate-500 md:hidden">Unit</span>
                        {row.productId ? (
                          <select
                            value={row.unit}
                            onChange={(e) => handleChangeUnit(row.rowId, e.target.value)}
                            disabled={unitOptions(products.find((p) => p.id === row.productId)).length < 2}
                            aria-label="Unit"
                            className="w-full rounded-lg border border-slate-300 bg-white py-2 px-1.5 text-sm font-semibold md:w-24 md:py-1 md:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-70"
                          >
                            {unitOptions(products.find((p) => p.id === row.productId)).map((o) => (
                              <option key={o.unit} value={o.unit}>
                                {o.unit === 'Nos' ? 'Piece' : o.unit}
                                {o.factor > 1 ? ` (${o.factor})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* 5. Actual Selling Price (Editable inside sale without touching Master Price) */}
                      <td className="col-span-3 block md:table-cell md:px-3 md:py-3 md:text-right">
                        <span className="mb-1 block text-[11px] font-semibold text-slate-500 md:hidden">Unit price (₹)</span>
                        <div className="relative inline-block w-full md:w-28">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₹</span>
                          <input
                            type="number"
                            min={0}
                            value={row.actualPrice}
                            onChange={(e) =>
                              handleUpdateRowField(row.rowId, 'actualPrice', parseFloat(e.target.value) || 0)
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-5 pr-2 text-right font-mono font-bold text-sm md:py-1 md:text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                        {isCustomPrice && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                            (Master: ₹{row.masterPrice.toLocaleString()})
                          </div>
                        )}
                      </td>

                      {/* 6. Line Total */}
                      <td className="col-span-2 block font-mono text-sm font-bold text-slate-900 md:table-cell md:px-3 md:py-3 md:text-right dark:text-white">
                        <span className="mb-1 block font-sans text-[11px] font-semibold text-slate-500 md:hidden">Total</span>
                        ₹{detail ? detail.lineTot.toLocaleString() : (row.quantity * row.actualPrice).toLocaleString()}
                      </td>

                      {/* 7. Remove Item Button */}
                      <td className="absolute right-2 top-2 md:static md:table-cell md:px-3 md:py-3 md:text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.rowId)}
                          title="Remove this item"
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* + Add Item Button Row */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="inline-flex items-center gap-2 rounded-xl border border-dashed border-blue-400 bg-blue-50/60 px-5 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100/70 hover:border-blue-500 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 transition-all cursor-pointer shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              <span>Add Item</span>
            </button>

          </div>
        </div>

        {/* ========================================================
            STEP 3: SUMMARY & REAL-TIME CALCULATION
           ======================================================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
          {/* Payment Method & Transaction Settings */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Payment Method
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Cash', 'UPI', 'Bank Transfer'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`rounded-xl border py-2.5 text-xs font-bold transition-all cursor-pointer ${
                      paymentMethod === method
                        ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* Secondary payment */}
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={splitOn}
                  onChange={(e) => setSplitOn(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                />
                Add a secondary payment (customer pays two ways)
              </label>
              {splitOn && (
                <div className="mt-2 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Paid by {paymentMethod} (first payment)
                    <div className="relative mt-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                      <input
                        type="number"
                        min={1}
                        value={firstAmount}
                        onChange={(e) => setFirstAmount(e.target.value)}
                        placeholder={`Less than ₹${billTotal.toLocaleString('en-IN')}`}
                        className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-6 pr-2 text-right font-mono text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                  </label>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Remaining {splitOk ? <span className="font-mono">₹{secondAmount.toLocaleString('en-IN')}</span> : ''} paid by
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['Cash', 'UPI', 'Bank Transfer'] as const)
                        .filter((m) => m !== paymentMethod)
                        .map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setSecondMethodPick(m)}
                            className={`cursor-pointer rounded-lg border py-2 text-xs font-bold transition-all ${
                              secondMethod === m
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                    </div>
                  </div>
                  <p className={`text-[11px] font-semibold ${splitOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {splitOk
                      ? `${paymentMethod} ₹${firstPaid.toLocaleString('en-IN')} + ${secondMethod} ₹${secondAmount.toLocaleString('en-IN')} = ₹${billTotal.toLocaleString('en-IN')}`
                      : 'Enter the first payment so the rest can be worked out.'}
                  </p>
                </div>
              )}
            </div>

            {/* Sale date */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="quick-sale-date">
                Sale Date
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="quick-sale-date"
                  type="date"
                  value={saleDate}
                  max={todayIst()}
                  onChange={(e) => setSaleDate(e.target.value || todayIst())}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                {isBackDated && (
                  <button
                    type="button"
                    onClick={() => setSaleDate(todayIst())}
                    className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Today
                  </button>
                )}
              </div>
              {isBackDated && (
                <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  This sale and its invoice will be dated {saleDate}. Stock is taken off now.
                </p>
              )}
            </div>

            {/* Additional Overall Discount */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Overall Sale Discount (Optional)
              </label>
              <div className="relative inline-block w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₹</span>
                <input
                  type="number"
                  min={0}
                  value={saleOverallDiscount}
                  onChange={(e) => setSaleOverallDiscount(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-7 pr-3 text-xs font-mono font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Totals Breakdown Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>Subtotal ({rows.length} {rows.length === 1 ? 'item' : 'items'}):</span>
              <span className="font-mono font-semibold">₹{calculations.subtotal.toLocaleString()}</span>
            </div>

            {calculations.totalDiscount > 0 && (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <span>Overall Discount:</span>
                <span className="font-mono">-₹{calculations.totalDiscount.toLocaleString()}</span>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white block">
                  Grand Total
                </span>
                <span className="text-[10px] text-slate-500">Items total less the overall discount</span>
              </div>
              <span className="font-mono text-2xl font-black text-blue-700 dark:text-blue-300">
                ₹{calculations.grandTotal.toLocaleString()}
              </span>
            </div>

            {/* SAVE SALE BUTTON */}
            <div className="pt-2">
              {saveError && (
                <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {saveError}
                </p>
              )}
              <button
                type="button"
                onClick={handleSaveSale}
                disabled={isSaving || productsLoading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-500 active:scale-98 cursor-pointer disabled:opacity-50 transition-all"
              >
                {isSaving ? (
                  <span>Recording Multi-Item Sale...</span>
                ) : (
                  <>
                    <span>SAVE SALE (₹{calculations.grandTotal.toLocaleString()})</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Phones: the total and Save stay in reach while the product list scrolls */}
      {calculations.subtotal > 0 && !completedSale && (
        <div
          className="glass no-print fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-2xl p-2.5 md:hidden"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="min-w-0 pl-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {rows.filter((r) => r.productId).length} {rows.filter((r) => r.productId).length === 1 ? 'item' : 'items'} · Total
            </p>
            <p className="font-mono text-lg font-black leading-tight text-blue-700 dark:text-blue-300">₹{calculations.grandTotal.toLocaleString()}</p>
            {saveError && <p className="truncate text-[10px] font-semibold text-rose-600 dark:text-rose-400">{saveError}</p>}
          </div>
          <button
            type="button"
            onClick={handleSaveSale}
            disabled={isSaving || productsLoading}
            className="ml-auto flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-500 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save sale'}
            {!isSaving && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      )}

      {/* ========================================================
          COMPLETED SALE SUCCESS MODAL / RECEIPT
         ======================================================== */}
      {completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Sale Saved Successfully!
                </h3>
                <p className="text-xs text-slate-500">
                  Transaction completed and inventory stock decremented.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Sale Number:</span>
                <span className="font-mono font-bold text-blue-600">{completedSale.saleNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Number:</span>
                <span className="font-mono font-bold text-indigo-600">#{completedSale.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{completedSale.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Items:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{completedSale.itemCount} Product(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{completedSale.payment}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 dark:border-slate-700 font-bold text-sm">
                <span>Grand Total:</span>
                <span className="font-mono text-emerald-600">₹{completedSale.grandTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActiveInvoiceForPrint(completedSale.invoiceObj);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white hover:bg-blue-500 cursor-pointer shadow-xs"
              >
                <Printer className="h-4 w-4" />
                <span>Print Invoice</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCompletedSale(null);
                  setCurrentView('billing');
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                <span>Invoices List</span>
              </button>

              <button
                type="button"
                onClick={handleStartNextSale}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Next Sale</span>
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
