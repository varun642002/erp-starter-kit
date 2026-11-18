import React, { useState, useRef, useEffect } from 'react';
import {
  Boxes,
  Plus,
  Search,
  Filter,
  SlidersHorizontal,
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Warehouse,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  Archive,
  ArchiveRestore,
  Tag,
  CheckSquare,
  Square,
  MinusSquare,
  Printer,
  Download,
  Wrench,
  Cog,
  Sparkles,
  Truck,
  Trash2,
  Layers,
  Check
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Product, ProductCategory } from '../../types/erp';
import { BulkActionToolbar, StatusOption } from '../common/BulkActionToolbar';
import { BatchPrintModal } from '../common/BatchPrintModal';
import { ImportProductsModal } from '../common/ImportProductsModal';
import { ImportOpeningStockModal } from '../common/ImportOpeningStockModal';
import { StockUpdateModal } from '../common/StockUpdateModal';
import { AddMachineryModal } from '../common/AddMachineryModal';
import { AlternateNamesEditor } from '../common/AlternateNamesEditor';
import { ItemNameEditor } from '../common/ItemNameEditor';
import { getProductAliases, saveProductAliases } from '../../services/api';
import { PartDetailsEditor } from '../common/PartDetailsEditor';
import { CategorySelect } from '../common/CategorySelect';
import { AddBranchStockModal } from '../common/AddBranchStockModal';
import { ImportSparesDeliveryModal } from '../common/ImportSparesDeliveryModal';
import { ServicesPanel } from './ServicesPanel';
import { serviceCatalogApi } from '../../services/serviceCatalogApi';
import { HEAD_WAREHOUSE_ID } from '../../services/stockApi';
import { useAuth } from '../../context/AuthContext';
import { UnitsEditor } from '../common/UnitsEditor';
import { formatStock, stockBreakdown, unitWord } from '../../utils/units';

export const InventoryView: React.FC = () => {
  const {
    products,
    filteredProducts,
    warehouses,
    branches,
    settings,
    currentRole,
    categories,
    addCategory,
    deleteCategory,
    stockStatuses,
    addStockStatus,
    deleteStockStatus,
    deleteProduct,
    createStockAdjustment,
    addProduct,
    bulkUpdateProductStatus,
    bulkArchiveProducts,
    bulkUpdateProductCategory,
    bulkDeleteProducts,
    updateProduct,
    startMachineSale,
    productsLoading,
    productsError,
    refreshProducts,
    canEditStock,
    showToast
  } = useERP();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const canBulkDelete = isOwner || currentRole === 'Warehouse Manager';
  const isBranchPerson = currentRole === 'Branch Person';
  // Branch persons can correct item details and add spare parts while the Super Admin has stock editing switched on.
  const canEditDetails = canBulkDelete || (isBranchPerson && canEditStock);
  const { assignedBranchId } = useAuth();
  // A branch person loads new spare parts into their own branch only.
  const spareWarehouses = isBranchPerson
    ? warehouses.filter((w) => w.branchId === (assignedBranchId || 'branch-1'))
    : warehouses;

  const [inventoryMode, setInventoryMode] = useState<'all' | 'spares' | 'machinery' | 'services'>('all');
  const [servicesCount, setServicesCount] = useState<number | null>(null);
  useEffect(() => {
    // The number on the Services tab; it stays empty if the list cannot be loaded.
    serviceCatalogApi
      .list({ role: currentRole, branchId: assignedBranchId || 'branch-1' })
      .then((list) => setServicesCount(list.length))
      .catch(() => {});
  }, [currentRole, assignedBranchId]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>('all');
  const [compatibleModelFilter, setCompatibleModelFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<string>('all');
  const [viewArchived, setViewArchived] = useState<boolean>(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Dynamic Category & Stock Status Management Modal
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  const [newStatusInput, setNewStatusInput] = useState('');

  // Delete / Archive confirmation modal
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // CSV Import Modals
  const [isImportProductsOpen, setIsImportProductsOpen] = useState(false);
  const [isOpeningStockOpen, setIsOpeningStockOpen] = useState(false);
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  // Rows ticked in the list when the stock update dialog was opened from the selection bar.
  const [stockUpdateIds, setStockUpdateIds] = useState<string[]>([]);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isBranchStockOpen, setIsBranchStockOpen] = useState(false);
  const [isMachineryOpen, setIsMachineryOpen] = useState(false);
  const [isImportMachineryOpen, setIsImportMachineryOpen] = useState(false);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isImportSparesOpen, setIsImportSparesOpen] = useState(false);

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBatchPrintOpen, setIsBatchPrintOpen] = useState(false);

  // Permanent bulk delete (up to 2000 at a time): a dry run first, then the real thing
  const [bulkDelete, setBulkDelete] = useState<{
    ids: string[];
    preview: Awaited<ReturnType<typeof bulkDeleteProducts>> | null;
    loading: boolean;
    working: boolean;
    typed: string;
  } | null>(null);

  // Category Reassign Modal
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [targetCategory, setTargetCategory] = useState<ProductCategory>('Tractor Implements');

  // Adjustment Modal State
  const [adjustModalProduct, setAdjustModalProduct] = useState<Product | null>(null);
  const [adjustWhId, setAdjustWhId] = useState(warehouses[0]?.id || '');
  const [adjustType, setAdjustType] = useState<'Addition' | 'Reduction'>('Addition');
  const [adjustQty, setAdjustQty] = useState(10);
  const [adjustReason, setAdjustReason] = useState('Stock Count Correction (Physical Audit)');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const reportFailure = (title: string, error: any) => {
    showToast(title, error?.message || 'The server rejected this request.', 'error');
  };

  // New Standard Product Modal State
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdSku, setNewProdSku] = useState('');
  const [newProdCat, setNewProdCat] = useState<ProductCategory>('Tractor Implements');
  const [newProdUnit, setNewProdUnit] = useState<any>('Nos');
  const [newProdHsn, setNewProdHsn] = useState('843280');
  const [newProdBuy, setNewProdBuy] = useState(45000);
  const [newProdSell, setNewProdSell] = useState(62000);
  const [newProdGst, setNewProdGst] = useState(12);
  const [newProdMin, setNewProdMin] = useState(5);
  const [newProdInitialQty, setNewProdInitialQty] = useState(20);

  // Dedicated Add Spare Part Modal State
  const [isAddSpareOpen, setIsAddSpareOpen] = useState(false);
  const [showMoreSpare, setShowMoreSpare] = useState(false);
  const [spareSkuEdited, setSpareSkuEdited] = useState(false);
  const [spareName, setSpareName] = useState('');
  const [spareSku, setSpareSku] = useState('');
  const [spareCategory, setSpareCategory] = useState<string>('Rotavator');
  const [spareCompatibleModels, setSpareCompatibleModels] = useState('Rotavator 7-ft, 8-ft Multi-Speed, 45HP-55HP Tractor');
  const [spareOemNumber, setSpareOemNumber] = useState('');
  const [spareAltNames, setSpareAltNames] = useState('');
  const [spareSubCategory, setSpareSubCategory] = useState('');
  const [spareBrand, setSpareBrand] = useState('Acme Genuine Spares');
  const [spareRackBin, setSpareRackBin] = useState('');
  const [spareUnit, setSpareUnit] = useState<any>('Piece');
  // Pieces in one box, when the item is also sold by the box. Blades come 18 to a box.
  const [spareBoxCount, setSpareBoxCount] = useState('');
  const [spareHsn, setSpareHsn] = useState('8432');
  const [spareBuy, setSpareBuy] = useState(0);
  const [spareSell, setSpareSell] = useState(0);
  const [spareMrp, setSpareMrp] = useState(760);
  const [spareGst, setSpareGst] = useState(5);
  const [spareMin, setSpareMin] = useState(40);
  const [spareInitialQty, setSpareInitialQty] = useState(120);
  const [spareWarehouseId, setSpareWarehouseId] = useState('');
  const [spareDescription, setSpareDescription] = useState('');

  const selectAllRef = useRef<HTMLInputElement>(null);

  // The stored spare / machine flag decides the section; names and categories never do.
  const isSpareProduct = (p: Product): boolean => Boolean(p.isSparePart);

  const getAvailableStock = (prod: Product): number => {
    if (prod.warehouseStocks && prod.warehouseStocks.length > 0) {
      return prod.warehouseStocks.reduce((sum, ws) => sum + (ws.available || 0), 0);
    }
    return (prod as any).currentStock || 0;
  };

  const getMinStock = (prod: Product): number => {
    return prod.minStock ?? (prod as any).minStockLevel ?? 10;
  };

  const generateSpareSku = (category: string) => {
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

  const openAddSpareModal = () => {
    const initialCat = 'Rotavator';
    setSpareCategory(initialCat);
    setSpareBoxCount('');
    setSpareSku(generateSpareSku(initialCat));
    setSpareName('');
    setSpareCompatibleModels('');
    setSpareOemNumber('');
    setSpareAltNames('');
    setSpareSubCategory('');
    setSpareBrand('Acme Genuine Spares');
    setSpareRackBin('');
    setSpareUnit('Piece');
    setSpareHsn('8432');
    setSpareBuy(0);
    setSpareSell(0);
    setSpareMrp(0);
    setSpareGst(5);
    setSpareMin(10);
    setSpareInitialQty(0);
    setSpareWarehouseId(spareWarehouses[0]?.id || warehouses[0]?.id || '');
    setSpareDescription('');
    setShowMoreSpare(false);
    setSpareSkuEdited(false);
    setIsAddSpareOpen(true);
  };

  // Sub categories typed by the user (the built-in defaults are not listed)
  const DEFAULT_SUBCATEGORIES = ['Machinery', 'Agro Machinery Spares', 'Tractor Machinery Spares'];
  const subCategoryOptions: string[] = Array.from(
    new Set<string>(products.map((p) => (p.subcategory || '').trim()).filter((s) => s && !DEFAULT_SUBCATEGORIES.includes(s)))
  ).sort((a, b) => a.localeCompare(b));

  // Filter products considering mode, archive state, category, model, and search query
  const filteredUnsorted = filteredProducts.filter((p) => {
    const isArchived = Boolean(p.isArchived || p.status === 'Archived');
    if (viewArchived !== isArchived) return false;

    const isSpare = isSpareProduct(p);
    if (inventoryMode === 'spares' && !isSpare) return false;
    if (inventoryMode === 'machinery' && isSpare) return false;

    if (compatibleModelFilter !== 'all') {
      const modelHaystack = `${p.name} ${p.description || ''} ${p.compatibleModels?.join(' ') || ''}`.toLowerCase();
      if (!modelHaystack.includes(compatibleModelFilter.toLowerCase())) return false;
    }

    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.hsnCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.oemPartNumber && p.oemPartNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.shelfBinLocation && p.shelfBinLocation.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.compatibleModels && p.compatibleModels.some(m => m.toLowerCase().includes(searchQuery.toLowerCase()))) ||
      (p.alternateNames && p.alternateNames.some(n => n.toLowerCase().includes(searchQuery.toLowerCase()))) ||
      (p.subcategory && p.subcategory.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesSubCategory = subCategoryFilter === 'all' || (p.subcategory || '').trim() === subCategoryFilter;

    const stock = getAvailableStock(p);
    const minThreshold = getMinStock(p);
    let matchesStock = true;
    if (stockStatusFilter === 'low') {
      matchesStock = stock <= minThreshold && stock > 0;
    } else if (stockStatusFilter === 'out') {
      matchesStock = stock === 0;
    }

    return matchesSearch && matchesCategory && matchesSubCategory && matchesStock;
  });

  // Alphabetical by item name, ascending or descending.
  const filtered = [...filteredUnsorted].sort((a, b) => {
    const cmp = (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base', numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Handle header select all checkbox state
  const isAllSelected = filtered.length > 0 && filtered.every(p => selectedIds.includes(p.id));
  const isPartiallySelected = selectedIds.length > 0 && !isAllSelected && filtered.some(p => selectedIds.includes(p.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      // Unselect all currently visible
      const visibleIds = filtered.map(p => p.id);
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Select all currently visible
      const visibleIds = filtered.map(p => p.id);
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

  // Bulk Operations Handlers
  const handleBulkStatus = async (status: string) => {
    try {
      await bulkUpdateProductStatus(selectedIds, status as any);
      setSelectedIds([]);
    } catch (error: any) {
      reportFailure('Bulk update failed', error);
    }
  };

  const handleBulkArchive = async () => {
    try {
      await bulkArchiveProducts(selectedIds, true);
      setSelectedIds([]);
    } catch (error: any) {
      reportFailure('Archive failed', error);
    }
  };

  const handleBulkRestore = async () => {
    try {
      await bulkArchiveProducts(selectedIds, false);
      setSelectedIds([]);
    } catch (error: any) {
      reportFailure('Restore failed', error);
    }
  };

  const BULK_DELETE_LIMIT = 2000;

  const openBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > BULK_DELETE_LIMIT) {
      showToast('Too many items', `Select at most ${BULK_DELETE_LIMIT} items to delete at once.`, 'error');
      return;
    }
    const ids = [...selectedIds];
    setBulkDelete({ ids, preview: null, loading: true, working: false, typed: '' });
    try {
      const preview = await bulkDeleteProducts(ids, true);
      setBulkDelete((b) => (b ? { ...b, preview, loading: false } : b));
    } catch (error: any) {
      setBulkDelete(null);
      reportFailure('Could not check the selected items', error);
    }
  };

  const confirmBulkDelete = async () => {
    if (!bulkDelete) return;
    setBulkDelete({ ...bulkDelete, working: true });
    try {
      await bulkDeleteProducts(bulkDelete.ids, false);
      setSelectedIds([]);
      setBulkDelete(null);
    } catch (error: any) {
      setBulkDelete((b) => (b ? { ...b, working: false } : b));
      reportFailure('Delete failed', error);
    }
  };

  const handleBulkReassignCategory = async () => {
    try {
      await bulkUpdateProductCategory(selectedIds, targetCategory);
      setIsCategoryModalOpen(false);
      setSelectedIds([]);
    } catch (error: any) {
      reportFailure('Category update failed', error);
    }
  };

  const handleExportCSV = () => {
    const itemsToExport = filtered.filter(p => selectedIds.includes(p.id));
    if (!itemsToExport.length) return;

    let csvContent = 'SKU,Material Name,Category,HSN Code,Purchase Price,Selling Price,GST Rate,Available Stock,Unit,Total Valuation,Status\n';
    itemsToExport.forEach(p => {
      const stock = p.warehouseStocks?.reduce((sum, ws) => sum + ws.available, 0) || (p as any).currentStock || 0;
      const val = stock * p.purchasePrice;
      csvContent += `"${p.sku}","${p.name.replace(/"/g, '""')}","${p.category}","${p.hsnCode || ''}",${p.purchasePrice},${p.sellingPrice},${p.gstRate}%,${stock},"${p.unit}",${val},"${p.status}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Inventory_Bulk_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedInventoryItems = filteredProducts.filter(p => selectedIds.includes(p.id));

  const statusOptions: StatusOption[] = [
    { value: 'In Stock', label: 'In Stock', badgeClass: 'bg-emerald-100 text-emerald-800' },
    { value: 'Low Stock', label: 'Low Stock', badgeClass: 'bg-amber-100 text-amber-800' },
    { value: 'Out of Stock', label: 'Out of Stock', badgeClass: 'bg-rose-100 text-rose-800' },
    { value: 'Archived', label: 'Archived', badgeClass: 'bg-slate-200 text-slate-800' }
  ];

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalProduct || isAdjusting) return;

    const wh = warehouses.find(w => w.id === adjustWhId);
    if (!wh) return;

    setIsAdjusting(true);
    try {
      await createStockAdjustment({
        warehouseId: wh.id,
        productId: adjustModalProduct.id,
        adjustmentType: adjustType === 'Addition' ? 'Increase' : 'Decrease',
        quantity: adjustQty,
        reason: adjustReason
      });
      setAdjustModalProduct(null);
    } catch (error: any) {
      reportFailure('Adjustment failed', error);
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName || !newProdSku || isSavingProduct) return;

    setIsSavingProduct(true);
    try {
      await addProduct({
        name: newProdName,
        sku: newProdSku,
        category: newProdCat,
        subcategory: 'Machinery',
        isSparePart: false,
        brand: 'Acme',
        barcode: '',
        unit: newProdUnit,
        hsnCode: newProdHsn,
        purchasePrice: newProdBuy,
        sellingPrice: newProdSell,
        mrp: Math.round(newProdSell * 1.1),
        gstRate: newProdGst,
        minStock: newProdMin,
        maxStock: newProdMin * 8,
        reorderLevel: Math.round(newProdMin * 1.5),
        description: '',
        status: newProdInitialQty <= 0 ? 'Out of Stock' : newProdInitialQty <= newProdMin ? 'Low Stock' : 'In Stock',
        warehouseStocks: [
          {
            warehouseId: HEAD_WAREHOUSE_ID,
            rack: 'RACK-01',
            row: '01',
            shelf: 'S-A',
            bin: 'B-101',
            available: newProdInitialQty,
            reserved: 0,
            inTransit: 0
          }
        ]
      });
      setIsAddProductOpen(false);
    } catch (error: any) {
      reportFailure('Could not create product', error);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleCreateSpare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spareName.trim() || !spareSku.trim() || isSavingProduct) return;
    if (!spareCategory.trim()) {
      showToast('Category needed', 'Choose a category or type a new one for this spare part.', 'warning');
      return;
    }

    const targetWh = spareWarehouses.find(w => w.id === spareWarehouseId) || spareWarehouses[0] || warehouses[0];

    setIsSavingProduct(true);
    try {
    await addProduct({
      name: spareName.trim(),
      sku: spareSku.trim().toUpperCase(),
      category: spareCategory.trim() as ProductCategory,
      subcategory: spareSubCategory.trim() || 'Agro Machinery Spares',
      brand: spareBrand.trim() || 'Acme Genuine Spares',
      barcode: `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
      hsnCode: spareHsn.trim() || '8432',
      gstRate: spareGst,
      unit: spareUnit,
      ...(Number(spareBoxCount) >= 2 ? { alternateUnit: 'Box' as const, conversionFactor: Math.floor(Number(spareBoxCount)) } : {}),
      purchasePrice: spareBuy,
      sellingPrice: spareSell,
      mrp: spareMrp || Math.round(spareSell * 1.1),
      minStock: spareMin,
      maxStock: spareMin * 8,
      reorderLevel: Math.round(spareMin * 1.5),
      description: spareDescription.trim(),
      isSparePart: true,
      compatibleModels: spareCompatibleModels.split(',').map(m => m.trim()).filter(Boolean),
      oemPartNumber: spareOemNumber.trim() || undefined,
      alternateNames: spareAltNames.split(/[;|,\n]/).map((n) => n.trim()).filter(Boolean),
      shelfBinLocation: spareRackBin.trim() || undefined,
      status: spareInitialQty <= spareMin ? (spareInitialQty === 0 ? 'Out of Stock' : 'Low Stock') : 'In Stock',
      warehouseStocks: [
        {
          warehouseId: targetWh?.id || 'wh-1',
          rack: spareRackBin.split('/')[0]?.replace('Rack', '').trim() || 'RACK-SPR',
          row: '01',
          shelf: 'S-A',
          bin: spareRackBin.split('/')[1]?.replace('Bin', '').trim() || 'B-101',
          available: spareInitialQty,
          reserved: 0,
          inTransit: 0
        }
      ]
    });

    setIsAddSpareOpen(false);
    setInventoryMode('spares');
    } catch (error: any) {
      reportFailure('Could not register spare part', error);
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Metrics for tabs and badges
  const allCount = filteredProducts.filter(p => !p.isArchived && p.status !== 'Archived').length;
  const sparesCount = filteredProducts.filter(p => (!p.isArchived && p.status !== 'Archived') && isSpareProduct(p)).length;
  const machineryCount = filteredProducts.filter(p => (!p.isArchived && p.status !== 'Archived') && !isSpareProduct(p)).length;
  const sparesLowStockCount = filteredProducts.filter(p => (!p.isArchived && p.status !== 'Archived') && isSpareProduct(p) && (getAvailableStock(p) <= getMinStock(p))).length;
  const sparesValuation = filteredProducts
    .filter(p => (!p.isArchived && p.status !== 'Archived') && isSpareProduct(p))
    .reduce((sum, p) => sum + (getAvailableStock(p) * p.purchasePrice), 0);
  const sparesTotalUnits = filteredProducts
    .filter(p => (!p.isArchived && p.status !== 'Archived') && isSpareProduct(p))
    .reduce((sum, p) => sum + getAvailableStock(p), 0);

  return (
    <div className="space-y-6 pb-20 relative">
      {/* Header: title, one add button, one menu for everything else */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Inventory</h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Your machines and spare parts and how many are in stock, and the services you do.
          </p>
        </div>

        <div className="relative flex items-center gap-2">
          {(!isBranchPerson || canEditStock) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen((v) => !v);
                setIsMoreMenuOpen(false);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 dark:bg-slate-700"
            >
              <Plus className="h-4 w-4" />
              <span>Add item</span>
            </button>
            {isAddMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsAddMenuOpen(false)} />
                <div className="absolute left-0 z-40 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  {!isBranchPerson && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsMachineryOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Building2 className="h-4 w-4 text-blue-600" /> Machinery
                  </button>
                  )}
                  {!isBranchPerson && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsAddProductOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Boxes className="h-4 w-4 text-slate-500" /> Other product
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      openAddSpareModal();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Wrench className="h-4 w-4 text-amber-600" /> Spare part
                  </button>
                </div>
              </>
            )}
          </div>
          )}

          {canEditStock && (
            <button
              type="button"
              onClick={() => {
                setStockUpdateIds([]);
                setIsStockUpdateOpen(true);
                setIsAddMenuOpen(false);
                setIsMoreMenuOpen(false);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-2xs hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Update stock</span>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsMoreMenuOpen((v) => !v);
                setIsAddMenuOpen(false);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>More</span>
            </button>
            {isMoreMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsMoreMenuOpen(false)} />
                <div className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  {[
                    ...(canEditStock
                      ? [
                          { label: 'Add stock to a branch', icon: Boxes, run: () => setIsBranchStockOpen(true) },
                          { label: 'Update stock quantities', icon: SlidersHorizontal, run: () => { setStockUpdateIds([]); setIsStockUpdateOpen(true); } }
                        ]
                      : []),
                    // Catalogue imports stay with the owner side; branch persons use the stock updates.
                    ...(!isBranchPerson
                      ? [
                          { label: 'Import machinery (CSV)', icon: FileSpreadsheet, run: () => setIsImportMachineryOpen(true) },
                          { label: 'Import spares (CSV)', icon: FileSpreadsheet, run: () => setIsImportProductsOpen(true) }
                        ]
                      : []),
                    ...(canEditStock ? [{ label: 'Update stock from CSV', icon: Boxes, run: () => setIsOpeningStockOpen(true) }] : []),
                    ...(!isBranchPerson ? [{ label: 'Import spares with delivery', icon: Truck, run: () => setIsImportSparesOpen(true) }] : []),
                    ...(isOwner
                      ? [{ label: 'Categories & statuses', icon: SlidersHorizontal, run: () => setIsManageCategoriesOpen(true) }]
                      : []),
                    {
                      label: viewArchived ? 'Show active items' : 'Show archived items',
                      icon: Archive,
                      run: () => {
                        setViewArchived((v) => !v);
                        setSelectedIds([]);
                      }
                    }
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          item.run();
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Icon className="h-4 w-4 text-slate-500" /> {item.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {(
          [
            { id: 'all', label: 'All', count: allCount },
            { id: 'machinery', label: 'Machinery', count: machineryCount },
            { id: 'spares', label: 'Spares', count: sparesCount },
            { id: 'services', label: 'Services', count: servicesCount }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setInventoryMode(tab.id);
              setCategoryFilter('all');
                setSubCategoryFilter('all');
              setCompatibleModelFilter('all');
            }}
            className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
              inventoryMode === tab.id
                ? 'bg-slate-800 text-white dark:bg-slate-700'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {tab.label}
            {tab.count !== null && <span className="font-mono text-[10px] opacity-70">{tab.count}</span>}
          </button>
        ))}
        {viewArchived && (
          <span className="rounded-md bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Showing archived items
          </span>
        )}
      </div>

      {inventoryMode === 'services' ? (
        <ServicesPanel canEdit={canBulkDelete} onCount={setServicesCount} />
      ) : (
      <>
      {/* Search and filters: small controls in one row that wraps on narrow screens */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 w-full sm:w-72">
          <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, SKU or part number"
            aria-label="Search items"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-sm text-slate-900 sm:h-8 sm:text-[11px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-2.5 cursor-pointer text-xs text-slate-400 hover:text-slate-600 sm:top-2"
            >
              ✕
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {subCategoryOptions.length > 0 && (
          <select
            value={subCategoryFilter}
            onChange={(e) => setSubCategoryFilter(e.target.value)}
            aria-label="Filter by sub category"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All sub categories</option>
            {subCategoryOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          value={stockStatusFilter}
          onChange={(e) => setStockStatusFilter(e.target.value)}
          aria-label="Filter by stock level"
          className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">Any stock level</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <select
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
          aria-label="Sort items by name"
          className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium sm:h-8 sm:w-auto sm:max-w-[12rem] sm:text-[11px] text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="asc">Name A to Z</option>
          <option value="desc">Name Z to A</option>
        </select>
        {(searchQuery || categoryFilter !== 'all' || subCategoryFilter !== 'all' || stockStatusFilter !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setCategoryFilter('all');
              setSubCategoryFilter('all');
              setStockStatusFilter('all');
            }}
            className="col-span-2 h-9 cursor-pointer rounded-lg px-2 text-xs font-semibold text-slate-500 hover:text-slate-800 sm:col-span-1 sm:h-8 sm:text-[11px] dark:hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {/* One-line summary of what is on screen */}
      {(() => {
        const units = filtered.reduce((sum, p) => sum + getAvailableStock(p), 0);
        const low = filtered.filter((p) => {
          const st = getAvailableStock(p);
          return st > 0 && st <= getMinStock(p);
        }).length;
        const out = filtered.filter((p) => getAvailableStock(p) === 0).length;
        return (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-slate-200">{filtered.length}</strong> items,{' '}
            <strong className="text-slate-800 dark:text-slate-200">{units.toLocaleString()}</strong> units in stock
            {low > 0 && <span className="ml-2 font-semibold text-amber-600">{low} low</span>}
            {out > 0 && <span className="ml-2 font-semibold text-rose-600">{out} out of stock</span>}
          </p>
        );
      })()}

      {/* Phones: one card per item */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <Boxes className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {productsLoading && products.length === 0
                ? 'Loading inventory...'
                : productsError && products.length === 0
                ? `Could not load inventory: ${productsError}`
                : products.length === 0
                ? 'No items yet. Use Add item, or More > Import products to load your catalogue.'
                : viewArchived
                ? 'No archived items.'
                : 'No items match your search or filters.'}
            </p>
            {productsError && products.length === 0 && (
              <button
                type="button"
                onClick={() => refreshProducts()}
                className="mt-3 cursor-pointer rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-slate-700"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-slate-800 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
              />
              Select all ({filtered.length})
            </label>
            {filtered.map((prod) => {
              const isSelected = selectedIds.includes(prod.id);
              const stock = getAvailableStock(prod);
              const isLow = stock <= getMinStock(prod) && stock > 0;
              const isOut = stock === 0;
              const isSpare = isSpareProduct(prod);
              const archived = prod.isArchived || prod.status === 'Archived';
              return (
                <div
                  key={prod.id}
                  className={`rounded-xl border p-3.5 shadow-xs ${
                    isSelected
                      ? 'border-slate-400 bg-slate-100/70 dark:border-slate-600 dark:bg-slate-800/60'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(prod.id)}
                      aria-label={`Select ${prod.name}`}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-slate-800 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{prod.name}</p>
                        {isSpare && (
                          <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">SPARE</span>
                        )}
                      </div>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">
                        {prod.sku}
                        {prod.oemPartNumber ? ` · Part no. ${prod.oemPartNumber}` : ''}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {prod.category}
                        {prod.subcategory && !DEFAULT_SUBCATEGORIES.includes(prod.subcategory) ? ` · ${prod.subcategory}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">In stock</p>
                      <p className="font-mono text-base font-bold text-slate-900 dark:text-white">
                        {stock.toLocaleString()} <span className="text-[11px] font-normal text-slate-500">{unitWord(prod.unit, stock)}</span>
                      </p>
                      {stockBreakdown(stock, prod) && <p className="text-[10px] text-slate-500">{stockBreakdown(stock, prod)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Price</p>
                      <p className="font-mono text-base font-bold text-slate-900 dark:text-white">
                        {settings.currencySymbol}
                        {prod.sellingPrice.toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`inline-block shrink-0 text-[11px] font-bold ${
                        archived
                          ? 'text-slate-500 dark:text-slate-400'
                          : isOut
                          ? 'text-rose-600 dark:text-rose-400'
                          : isLow
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {archived ? 'Archived' : isOut ? 'Out of stock' : isLow ? 'Low' : 'In stock'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {!isSpare && !prod.isArchived && (
                      <button
                        onClick={() => startMachineSale(prod.id)}
                        className="min-h-10 flex-1 cursor-pointer rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500"
                      >
                        Sell
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedProduct(prod)}
                      className="min-h-10 flex-1 cursor-pointer rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                    >
                      Where
                    </button>
                    {canEditStock && (
                      <button
                        onClick={() => {
                          setAdjustModalProduct(prod);
                          setAdjustQty(10);
                        }}
                        className="min-h-10 flex-1 cursor-pointer rounded-lg bg-slate-800 px-3 text-xs font-bold text-white hover:bg-slate-900 dark:bg-slate-700"
                      >
                        Update
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setProductToDelete(prod)}
                        aria-label="Delete or archive this item"
                        className="flex min-h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-400 hover:text-rose-600 dark:border-slate-700 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Inventory Table */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs md:block dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    ref={selectAllRef}
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-slate-800 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
                    title="Select all visible items"
                  />
                </th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    className="flex cursor-pointer items-center gap-1 font-bold hover:text-slate-900 dark:hover:text-white"
                    title="Sort by name"
                  >
                    Item <span className="text-[10px]">{sortDir === 'asc' ? 'A-Z' : 'Z-A'}</span>
                  </button>
                </th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">In stock</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Boxes className="h-8 w-8 text-slate-300" />
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        {productsLoading && products.length === 0
                          ? 'Loading inventory...'
                          : productsError && products.length === 0
                          ? `Could not load inventory: ${productsError}`
                          : products.length === 0
                          ? 'No items yet. Use Add item, or More > Import products to load your catalogue.'
                          : viewArchived
                          ? 'No archived items.'
                          : 'No items match your search or filters.'}
                      </p>
                      {productsError && products.length === 0 && (
                        <button
                          type="button"
                          onClick={() => refreshProducts()}
                          className="mt-2 cursor-pointer rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-slate-700"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((prod) => {
                  const isSelected = selectedIds.includes(prod.id);
                  const stock = getAvailableStock(prod);
                  const minThreshold = getMinStock(prod);
                  const isLow = stock <= minThreshold && stock > 0;
                  const isOut = stock === 0;
                  const isSpare = isSpareProduct(prod);

                  return (
                    <tr
                      key={prod.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-slate-100/70 dark:bg-slate-800/60' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(prod.id)}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-slate-800 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-bold text-slate-900 dark:text-white">{prod.name}</p>
                          {isSpare && (
                            <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              SPARE
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {prod.sku}
                          {prod.oemPartNumber ? ` · Part no. ${prod.oemPartNumber}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {prod.category}
                        {prod.subcategory && !DEFAULT_SUBCATEGORIES.includes(prod.subcategory) && (
                          <span className="block text-[10px] text-slate-400">{prod.subcategory}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-white">
                        {settings.currencySymbol}
                        {prod.sellingPrice.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {stock.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{unitWord(prod.unit, stock)}</span>
                        {stockBreakdown(stock, prod) && (
                          <span className="block text-[10px] font-normal text-slate-500">{stockBreakdown(stock, prod)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {prod.isArchived || prod.status === 'Archived' ? (
                          <span className="inline-block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Archived
                          </span>
                        ) : isOut ? (
                          <span className="inline-block text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            Out of stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-block text-[11px] font-bold text-amber-600 dark:text-amber-400">
                            Low
                          </span>
                        ) : (
                          <span className="inline-block text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            In stock
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isSpare && !prod.isArchived && (
                            <button
                              onClick={() => startMachineSale(prod.id)}
                              className="cursor-pointer rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                              title="Start a machine sale for this machine"
                            >
                              Sell
                            </button>
                          )}
                          <button
                            onClick={() => setSelectedProduct(prod)}
                            className="cursor-pointer rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                            title="See stock in each warehouse"
                          >
                            Where
                          </button>
                          {canEditStock && (
                          <button
                            onClick={() => {
                              setAdjustModalProduct(prod);
                              setAdjustQty(10);
                            }}
                            className="cursor-pointer rounded bg-slate-800 px-2 py-1 text-[11px] font-bold text-white hover:bg-slate-900 dark:bg-slate-700"
                            title="Change the stock quantity"
                          >
                            Update
                          </button>
                          )}
                          {isOwner && (
                            <button
                              onClick={() => setProductToDelete(prod)}
                              className="cursor-pointer rounded p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                              title="Delete or archive this item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
      </>
      )}

      {/* Floating Bulk Action Toolbar */}
      <BulkActionToolbar
        selectedCount={selectedIds.length}
        totalCount={filtered.length}
        itemName="material"
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
          ...(canBulkDelete
            ? [
                {
                  id: 'bulk-delete',
                  label: 'Delete permanently',
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  variant: 'danger' as const,
                  onClick: openBulkDelete
                }
              ]
            : []),
          ...(canEditStock
            ? [
                {
                  id: 'update-stock',
                  label: 'Update stock',
                  icon: <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />,
                  onClick: () => {
                    setStockUpdateIds([...selectedIds]);
                    setIsStockUpdateOpen(true);
                  }
                }
              ]
            : []),
          ...(!isBranchPerson
            ? [
                {
                  id: 'category',
                  label: 'Reassign Category',
                  icon: <Tag className="h-3.5 w-3.5 text-amber-400" />,
                  onClick: () => setIsCategoryModalOpen(true)
                }
              ]
            : [])
        ]}
      />

      {/* Batch Print Modal */}
      <BatchPrintModal
        isOpen={isBatchPrintOpen}
        onClose={() => setIsBatchPrintOpen(false)}
        type="inventory"
        selectedInventoryItems={selectedInventoryItems}
      />

      {/* Bulk Category Reassignment Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Reassign Category</h3>
                <p className="text-xs text-slate-500">Apply new category to {selectedIds.length} selected material(s)</p>
              </div>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Target Product Category *
                </label>
                <select
                  value={targetCategory}
                  onChange={(e: any) => setTargetCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Tractor Implements">Tractor Implements</option>
                  <option value="Rotavator Blades & Fasteners">Rotavator Blades & Fasteners</option>
                  <option value="Gearboxes, PTO & Transmissions">Gearboxes, PTO & Transmissions</option>
                  <option value="Hydraulics & Lift Cylinders">Hydraulics & Lift Cylinders</option>
                  <option value="Diesel Engine & Spares">Diesel Engine & Spares</option>
                  <option value="Tillage & Cultivator Parts">Tillage & Cultivator Parts</option>
                  <option value="Harvester & Thresher Parts">Harvester & Thresher Parts</option>
                  <option value="Bearings, Belts & Oil Seals">Bearings, Belts & Oil Seals</option>
                  <option value="Power Tillers & Weeders">Power Tillers & Weeders</option>
                  <option value="Sprayers & Drip Spares">Sprayers & Drip Spares</option>
                  <option value="Raw Materials & Fasteners">Raw Materials & Fasteners</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkReassignCategory}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 cursor-pointer"
                >
                  Update {selectedIds.length} Items
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Distribution Drawer */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0 flex-1 pr-2">
                <ItemNameEditor
                  name={selectedProduct.name}
                  canEdit={canEditDetails}
                  otherNames={products.filter((p) => p.id !== selectedProduct.id).map((p) => p.name)}
                  onSave={async (newName, keepOld) => {
                    const oldName = selectedProduct.name;
                    const saved = await updateProduct({ ...selectedProduct, name: newName } as Product);
                    if (keepOld && oldName.trim().toLowerCase() !== newName.trim().toLowerCase()) {
                      try {
                        const existing = await getProductAliases(selectedProduct.id);
                        if (!existing.some((n) => n.trim().toLowerCase() === oldName.trim().toLowerCase())) {
                          await saveProductAliases(selectedProduct.id, [...existing, oldName]);
                        }
                      } catch {
                        // the rename itself is saved; the old name just was not kept as an alternate
                      }
                    }
                    setSelectedProduct({ ...selectedProduct, ...saved });
                    await refreshProducts();
                  }}
                />
                <p className="text-xs text-slate-500 font-mono">SKU: {selectedProduct.sku} • Category: {selectedProduct.category}</p>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex justify-between rounded-lg bg-indigo-50 p-3 text-xs font-semibold text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                <span>Total Combined Enterprise Stock:</span>
                <span className="text-right font-mono text-sm">{formatStock(getAvailableStock(selectedProduct), selectedProduct)}</span>
              </div>

              <PartDetailsEditor
                partNumber={selectedProduct.oemPartNumber || ''}
                subCategory={DEFAULT_SUBCATEGORIES.includes(selectedProduct.subcategory || '') ? '' : selectedProduct.subcategory || ''}
                suggestions={subCategoryOptions}
                canEdit={canEditDetails}
                onSave={async (pn, sub) => {
                  const fallback = isSpareProduct(selectedProduct) ? 'Agro Machinery Spares' : 'Machinery';
                  const saved = await updateProduct({
                    ...selectedProduct,
                    oemPartNumber: pn || undefined,
                    subcategory: sub || fallback
                  } as Product);
                  setSelectedProduct({ ...selectedProduct, ...saved });
                  showToast('Item Updated', 'Part number and sub category saved.', 'success');
                }}
              />

              <UnitsEditor
                unit={selectedProduct.unit}
                alternateUnit={selectedProduct.alternateUnit}
                conversionFactor={selectedProduct.conversionFactor}
                canEdit={canEditDetails}
                onSave={async (alt, count) => {
                  const saved = await updateProduct({
                    ...selectedProduct,
                    alternateUnit: (alt || null) as any,
                    conversionFactor: (count ?? null) as any
                  } as Product);
                  setSelectedProduct({ ...selectedProduct, ...saved, alternateUnit: alt || undefined, conversionFactor: count ?? undefined });
                  showToast('Item Updated', alt ? `Also sold by the ${alt.toLowerCase()} (${count} in one).` : 'Now sold by the piece only.', 'success');
                }}
              />

              <AlternateNamesEditor
                productId={selectedProduct.id}
                canEdit={canEditDetails}
                initial={selectedProduct.alternateNames}
                onSaved={() => refreshProducts()}
              />

              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Distribution by Branch</h4>
                <div className="space-y-2">
                  {(selectedProduct.warehouseStocks || []).length === 0 && (
                    <p className="text-[11px] text-slate-400">No stock recorded in any warehouse yet.</p>
                  )}
                  {(selectedProduct.warehouseStocks || []).map((ws) => (
                    <div key={ws.warehouseId} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{warehouses.find(w => w.id === ws.warehouseId)?.name || ws.warehouseId}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {ws.inTransit > 0 ? `Incoming: ${ws.inTransit}` : 'In this branch'}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                        {formatStock(ws.available, selectedProduct)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3 text-right dark:border-slate-800 dark:bg-slate-800/50">
              <button
                onClick={() => setSelectedProduct(null)}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-indigo-600 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Stock Level Adjustment</h3>
                <p className="text-xs text-slate-500">{adjustModalProduct.name}</p>
              </div>
              <button
                onClick={() => setAdjustModalProduct(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Target Branch *</label>
                <select
                  value={adjustWhId}
                  onChange={(e) => setAdjustWhId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Current stock at this location: <strong className="font-mono">{adjustModalProduct.warehouseStocks?.find(ws => ws.warehouseId === adjustWhId)?.available ?? 0} {adjustModalProduct.unit}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Adjustment Type *</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustType('Addition')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold cursor-pointer ${
                      adjustType === 'Addition'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'border-slate-200 text-slate-600 dark:border-slate-700'
                    }`}
                  >
                    <PlusCircle className="h-4 w-4" />
                    <span>Inward / Addition (+)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType('Reduction')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold cursor-pointer ${
                      adjustType === 'Reduction'
                        ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : 'border-slate-200 text-slate-600 dark:border-slate-700'
                    }`}
                  >
                    <MinusCircle className="h-4 w-4" />
                    <span>Outward / Deduction (-)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Quantity to Adjust ({adjustModalProduct.unit}) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Reason for Audit Adjustment *</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Stock Count Correction (Physical Audit)">Stock Count Correction (Physical Audit)</option>
                  <option value="Damaged in Storage / Rain">Damaged in Storage / Rain</option>
                  <option value="Supplier Sample / Testing">Supplier Sample / Testing</option>
                  <option value="Transit Shrinkage">Transit Shrinkage</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdjustModalProduct(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdjusting}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-700 disabled:opacity-50 cursor-pointer dark:bg-slate-700"
                >
                  {isAdjusting ? 'Saving...' : 'Save Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New SKU Modal */}
      {isAddProductOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add New Product Master SKU</h3>
                <p className="text-xs text-slate-500">Register new building material in inventory</p>
              </div>
              <button
                onClick={() => setIsAddProductOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Material Name *</label>
                  <input
                    type="text"
                    required
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    placeholder="e.g. Ultratech PPC Cement 50kg"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">SKU Code *</label>
                  <input
                    type="text"
                    required
                    value={newProdSku}
                    onChange={(e) => setNewProdSku(e.target.value)}
                    placeholder="e.g. CEM-ULT-PPC-50"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                  <select
                    value={newProdCat}
                    onChange={(e: any) => setNewProdCat(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Tractor Implements">Tractor Implements</option>
                    <option value="Rotavator Blades & Fasteners">Rotavator Blades & Fasteners</option>
                    <option value="Gearboxes, PTO & Transmissions">Gearboxes, PTO & Transmissions</option>
                    <option value="Hydraulics & Lift Cylinders">Hydraulics & Lift Cylinders</option>
                    <option value="Diesel Engine & Spares">Diesel Engine & Spares</option>
                    <option value="Tillage & Cultivator Parts">Tillage & Cultivator Parts</option>
                    <option value="Harvester & Thresher Parts">Harvester & Thresher Parts</option>
                    <option value="Bearings, Belts & Oil Seals">Bearings, Belts & Oil Seals</option>
                    <option value="Power Tillers & Weeders">Power Tillers & Weeders</option>
                    <option value="Sprayers & Drip Spares">Sprayers & Drip Spares</option>
                    <option value="Raw Materials & Fasteners">Raw Materials & Fasteners</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Measuring Unit *</label>
                  <select
                    value={newProdUnit}
                    onChange={(e: any) => setNewProdUnit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Nos">Nos</option>
                    <option value="Piece">Piece</option>
                    <option value="Set">Set</option>
                    <option value="Kit">Kit</option>
                    <option value="Kg">Kg</option>
                    <option value="Meter">Meter</option>
                    <option value="Liter">Liter</option>
                    <option value="Bags">Bags</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">HSN Code *</label>
                  <input
                    type="text"
                    value={newProdHsn}
                    onChange={(e) => setNewProdHsn(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Purchase Cost ({settings.currencySymbol})</label>
                  <input
                    type="number"
                    value={newProdBuy}
                    onChange={(e) => setNewProdBuy(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Selling Price ({settings.currencySymbol})</label>
                  <input
                    type="number"
                    value={newProdSell}
                    onChange={(e) => setNewProdSell(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">GST Rate (%)</label>
                  <select
                    value={newProdGst}
                    onChange={(e) => setNewProdGst(parseInt(e.target.value) || 18)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Initial Opening Stock Quantity</label>
                  <input
                    type="number"
                    value={newProdInitialQty}
                    onChange={(e) => setNewProdInitialQty(parseInt(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Min Reorder Alert Threshold</label>
                  <input
                    type="number"
                    value={newProdMin}
                    onChange={(e) => setNewProdMin(parseInt(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddProductOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 cursor-pointer"
                >
                  Save Material SKU
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Spare Part Modal: only the essentials are on show, the rest is under "More details" */}
      {isAddSpareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add spare part</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Name and category are enough. Everything else is optional.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddSpareOpen(false)}
                aria-label="Close"
                className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSpare} className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Name *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={spareName}
                  onChange={(e) => setSpareName(e.target.value)}
                  placeholder="e.g. Rotavator L-Type Blade"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                  <CategorySelect
                    value={spareCategory}
                    options={['Rotavator', 'Baler', 'General Spares', 'Tractor Spare', ...categories]}
                    onChange={(v) => {
                      setSpareCategory(v);
                      if (v && !spareSkuEdited) setSpareSku(generateSpareSku(v));
                      if (/blade/i.test(v) && !spareBoxCount) setSpareBoxCount('18');
                    }}
                    aria-label="Spare category"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Part number</label>
                  <input
                    type="text"
                    value={spareOemNumber}
                    onChange={(e) => setSpareOemNumber(e.target.value)}
                    placeholder="e.g. 6308-2RS"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Alternate names <span className="font-normal text-slate-400">other names, separated by ;</span>
                </label>
                <input
                  type="text"
                  value={spareAltNames}
                  onChange={(e) => setSpareAltNames(e.target.value)}
                  placeholder="e.g. ரோட்டவேட்டர் பிளேடு; rotary blade"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Selling price ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={spareSell || ''}
                    onChange={(e) => setSpareSell(parseFloat(e.target.value) || 0)}
                    placeholder="Add later"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Stock in hand</label>
                  <input
                    type="number"
                    min={0}
                    value={spareInitialQty || ''}
                    onChange={(e) => setSpareInitialQty(parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch</label>
                  <select
                    value={spareWarehouseId}
                    onChange={(e) => setSpareWarehouseId(e.target.value)}
                    disabled={!(spareInitialQty > 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-50"
                  >
                    {spareWarehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowMoreSpare(!showMoreSpare)}
                className="cursor-pointer text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                {showMoreSpare ? 'Hide more details' : 'More details (item code, sub category, brand, GST...)'}
              </button>

              {showMoreSpare && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Item code</label>
                      <input
                        type="text"
                        value={spareSku}
                        onChange={(e) => {
                          setSpareSkuEdited(true);
                          setSpareSku(e.target.value.toUpperCase());
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <p className="mt-0.5 text-[10px] text-slate-400">Made for you. Change it only if you have your own code.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Sub category</label>
                      <input
                        type="text"
                        value={spareSubCategory}
                        onChange={(e) => setSpareSubCategory(e.target.value)}
                        list="spare-subcategories"
                        placeholder="e.g. Ball bearings"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <datalist id="spare-subcategories">
                        {subCategoryOptions.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Brand</label>
                      <input
                        type="text"
                        value={spareBrand}
                        onChange={(e) => setSpareBrand(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Unit</label>
                      <select
                        value={spareUnit}
                        onChange={(e: any) => setSpareUnit(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="Piece">Piece</option>
                        <option value="Nos">Nos</option>
                        <option value="Set">Set</option>
                        <option value="Kg">Kg</option>
                        <option value="Litre">Litre</option>
                        <option value="Meter">Meter</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Pieces in one box</label>
                      <input
                        type="number"
                        min={2}
                        step={1}
                        value={spareBoxCount}
                        onChange={(e) => setSpareBoxCount(e.target.value)}
                        placeholder="Not sold by the box"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Fits these machines</label>
                    <input
                      type="text"
                      value={spareCompatibleModels}
                      onChange={(e) => setSpareCompatibleModels(e.target.value)}
                      placeholder="e.g. Rotavator 7-ft, 45HP tractor (separate with commas)"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Purchase cost ({settings.currencySymbol})
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={spareBuy || ''}
                        onChange={(e) => setSpareBuy(parseFloat(e.target.value) || 0)}
                        placeholder="Add later"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">GST %</label>
                      <select
                        value={spareGst}
                        onChange={(e) => setSpareGst(parseInt(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18%</option>
                        <option value={28}>28%</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">HSN code</label>
                      <input
                        type="text"
                        value={spareHsn}
                        onChange={(e) => setSpareHsn(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Low stock alert</label>
                      <input
                        type="number"
                        min={0}
                        value={spareMin}
                        onChange={(e) => setSpareMin(parseInt(e.target.value) || 0)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Notes</label>
                      <input
                        type="text"
                        value={spareDescription}
                        onChange={(e) => setSpareDescription(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddSpareOpen(false)}
                  className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingProduct}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-900 disabled:opacity-60 dark:bg-slate-700"
                >
                  Add spare part
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Spares & Delivery Modal */}
      <ImportSparesDeliveryModal
        isOpen={isImportSparesOpen}
        onClose={() => setIsImportSparesOpen(false)}
        existingProducts={products}
        branches={branches}
        onImportComplete={() => {
          refreshProducts();
          showToast('Spares Delivery Inwarded', 'Spare parts registered and inward delivery stock saved to SQL database.', 'success');
        }}
        showToast={(msg, type) => showToast('Spares Delivery', msg, type)}
      />

      {/* Spare parts CSV import: every row goes to the Spares section */}
      <ImportProductsModal
        isOpen={isImportProductsOpen}
        mode="spares"
        onClose={() => setIsImportProductsOpen(false)}
        existingProducts={products}
        onImportComplete={() => {
          refreshProducts();
          showToast('Spares Imported', 'Spare parts were added to the Spares section.', 'success');
        }}
        showToast={(msg, type) => showToast('Spares Import', msg, type)}
      />

      <StockUpdateModal
        isOpen={isStockUpdateOpen}
        onClose={() => setIsStockUpdateOpen(false)}
        initialProductIds={stockUpdateIds}
        onUploadCsv={() => {
          setIsStockUpdateOpen(false);
          setIsOpeningStockOpen(true);
        }}
      />
      <AddMachineryModal isOpen={isMachineryOpen} onClose={() => setIsMachineryOpen(false)} />
      <ImportProductsModal
        isOpen={isImportMachineryOpen}
        mode="machinery"
        onClose={() => setIsImportMachineryOpen(false)}
        existingProducts={products}
        onImportComplete={() => {
          refreshProducts();
          showToast('Machinery Imported', 'Machines were added to Inventory.', 'success');
        }}
        showToast={(msg, type) => showToast('Machinery Import', msg, type)}
      />
      <AddBranchStockModal isOpen={isBranchStockOpen} onClose={() => setIsBranchStockOpen(false)} />

      <ImportOpeningStockModal
        isOpen={isOpeningStockOpen}
        onClose={() => setIsOpeningStockOpen(false)}
        onImported={() => refreshProducts()}
      />

      {/* Bulk permanent delete */}
      {bulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete {bulkDelete.ids.length} item{bulkDelete.ids.length === 1 ? '' : 's'} permanently
                </h3>
                <p className="text-xs text-slate-500">This cannot be undone.</p>
              </div>
            </div>

            {bulkDelete.loading || !bulkDelete.preview ? (
              <p className="py-6 text-center text-xs text-slate-500">Checking which items can be removed...</p>
            ) : (
              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/40">
                  <p className="font-bold text-rose-700 dark:text-rose-300">
                    {bulkDelete.preview.deleted} item{bulkDelete.preview.deleted === 1 ? '' : 's'} will be erased
                  </p>
                  <p className="mt-0.5 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                    Removed from every branch with {bulkDelete.preview.units} unit{bulkDelete.preview.units === 1 ? '' : 's'} of stock and their stock ledger entries.
                  </p>
                </div>
                {bulkDelete.preview.archived > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                    <p className="font-bold text-amber-800 dark:text-amber-300">
                      {bulkDelete.preview.archived} item{bulkDelete.preview.archived === 1 ? '' : 's'} will be archived instead
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      They are already used in bills, transfers, sales or job cards, so they stay in the records but are hidden from the lists.
                    </p>
                    <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-amber-900 dark:text-amber-200">
                      {bulkDelete.preview.blocked.slice(0, 20).map((b) => (
                        <li key={b.id}>
                          <span className="font-mono">{b.sku}</span> {b.name} <span className="opacity-70">({b.reason})</span>
                        </li>
                      ))}
                      {bulkDelete.preview.blocked.length > 20 && <li>and {bulkDelete.preview.blocked.length - 20} more</li>}
                    </ul>
                  </div>
                )}
                <label className="block font-semibold">
                  Type DELETE to confirm
                  <input
                    value={bulkDelete.typed}
                    onChange={(e) => setBulkDelete((b) => (b ? { ...b, typed: e.target.value } : b))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="DELETE"
                    autoFocus
                  />
                </label>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={bulkDelete.working}
                onClick={() => setBulkDelete(null)}
                className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  bulkDelete.loading ||
                  bulkDelete.working ||
                  !bulkDelete.preview ||
                  bulkDelete.typed.trim() !== 'DELETE'
                }
                onClick={confirmBulkDelete}
                className="cursor-pointer rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkDelete.working ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Archive Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Delete / Archive Product Master</h3>
                <p className="text-xs text-slate-500">Item: {productToDelete.sku}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
              Are you sure you want to remove <strong className="text-slate-900 dark:text-white">"{productToDelete.name}"</strong>?
              <br /><br />
              <span className="text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg block border border-slate-200 dark:border-slate-700">
                <strong>Historical Integrity Protection:</strong> Products are never physically deleted. The item is <strong>Archived</strong>, which hides it from active lists while keeping its stock ledger, sales orders, tax invoices and branch transfers intact for statutory reports.
              </span>
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  const result = await deleteProduct(productToDelete.id);
                  setIsDeleting(false);
                  if (result.success) {
                    setProductToDelete(null);
                  } else {
                    showToast('Could not archive product', result.message, 'error');
                  }
                }}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-500 disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Category & Stock Status Manager Modal */}
      {isManageCategoriesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Configurable Categories & Stock Statuses
                  </h3>
                  <p className="text-[11px] text-slate-500">Custom business classifications defined by Owner</p>
                </div>
              </div>
              <button
                onClick={() => setIsManageCategoriesOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
              
              {/* Section 1: Categories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-indigo-600" />
                    <span>Product Categories ({categories.length})</span>
                  </h4>
                  <span className="text-[10px] text-slate-400">Available across all 6 branches</span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCatInput}
                    onChange={(e) => setNewCatInput(e.target.value)}
                    placeholder="New category name (e.g. Laser Leveller, Harvester)..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newCatInput.trim()) {
                        addCategory(newCatInput.trim());
                        setNewCatInput('');
                      }
                    }}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-indigo-500 cursor-pointer"
                  >
                    + Add
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto">
                  {categories.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <span>{c}</span>
                      <button
                        type="button"
                        onClick={() => deleteCategory(c)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        title="Remove category"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Section 2: Stock Statuses */}
              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span>Stock Statuses ({stockStatuses.length})</span>
                  </h4>
                  <span className="text-[10px] text-slate-400">Inventory lifecycle stages</span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStatusInput}
                    onChange={(e) => setNewStatusInput(e.target.value)}
                    placeholder="New stock status (e.g. Under Refurbishment, Pre-booked)..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newStatusInput.trim()) {
                        addStockStatus(newStatusInput.trim());
                        setNewStatusInput('');
                      }
                    }}
                    className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-500 cursor-pointer"
                  >
                    + Add
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {stockStatuses.map((st) => (
                    <span
                      key={st}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <span>{st}</span>
                      <button
                        type="button"
                        onClick={() => deleteStockStatus(st)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        title="Remove status"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-900 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
