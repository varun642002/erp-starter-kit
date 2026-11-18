import React, { useState, useMemo } from 'react';
import {
  Warehouse as WarehouseIcon,
  Plus,
  Search,
  Building2,
  Phone,
  Boxes,
  MapPin,
  CheckCircle2,
  ArrowLeftRight,
  TrendingUp,
  AlertTriangle,
  Layers,
  Wrench,
  Filter,
  Eye,
  SlidersHorizontal,
  X,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Package,
  Calendar,
  DollarSign,
  Maximize2,
  BarChart3,
  Flame,
  ShieldAlert
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Warehouse, Product, WarehouseStockLocation } from '../../types/erp';
import type { StockAdjustmentInput } from '../../services/stockApi';
import { StockUpdateModal } from '../common/StockUpdateModal';
import { AddBranchStockModal } from '../common/AddBranchStockModal';

export const WarehousesView: React.FC = () => {
  const {
    warehouses,
    branches,
    products, activeProducts,
    selectedBranchId: erpSelectedBranchId,
    currentRole,
    addWarehouse,
    createStockAdjustment,
    settings,
    openQuickAdd,
    setCurrentView,
    showToast
  } = useERP();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  // Branch Scope: If branch user, enforce their branch; if owner, allow filtering
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>(
    isOwner ? 'all' : erpSelectedBranchId !== 'all' ? erpSelectedBranchId : 'branch-1'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewLayout, setViewLayout] = useState<'grid' | 'table'>('grid');
  const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false);
  const [isBranchStockOpen, setIsBranchStockOpen] = useState(false);

  // Inspect Warehouse Modal / Drawer State
  const [inspectingWarehouse, setInspectingWarehouse] = useState<Warehouse | null>(null);
  const [inspectSearchQuery, setInspectSearchQuery] = useState<string>('');
  const [inspectCategoryFilter, setInspectCategoryFilter] = useState<string>('all');
  const [inspectLowStockOnly, setInspectLowStockOnly] = useState<boolean>(false);

  // Add Warehouse Modal State
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [newWhName, setNewWhName] = useState<string>('');
  const [newWhCode, setNewWhCode] = useState<string>('');
  const [newWhBranchId, setNewWhBranchId] = useState<string>(branches[0]?.id || 'branch-1');
  const [newWhLocation, setNewWhLocation] = useState<string>('');
  const [newWhSupervisor, setNewWhSupervisor] = useState<string>('');
  const [newWhPhone, setNewWhPhone] = useState<string>('');
  const [newWhCapacity, setNewWhCapacity] = useState<number>(35000);

  // Quick Stock Adjustment Modal State
  const [adjustModalWh, setAdjustModalWh] = useState<Warehouse | null>(null);
  const [adjustProductId, setAdjustProductId] = useState<string>('');
  const [adjustType, setAdjustType] = useState<'Physical Count' | 'Damage / Scrap' | 'Found / Surplus'>('Physical Count');
  const [adjustNewCount, setAdjustNewCount] = useState<number>(10);
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false);

  // -------------------------------------------------------------
  // WAREHOUSE CALCULATIONS & STATS
  // -------------------------------------------------------------
  const warehouseStats = useMemo(() => {
    return warehouses.map((wh) => {
      let machineryUnits = 0;
      let machinerySkus = 0;
      let spareUnits = 0;
      let spareSkus = 0;
      let totalSkus = 0;
      let totalAvailableUnits = 0;
      let lowStockItemsCount = 0;

      products.forEach((prod) => {
        // Archived items are not part of the live stock picture.
        if (prod.isArchived || prod.status === 'Archived') return;
        const ws = prod.warehouseStocks.find((x) => x.warehouseId === wh.id);
        if (ws && ws.available > 0) {
          totalSkus += 1;
          totalAvailableUnits += ws.available;
          if (prod.isSparePart) {
            spareUnits += ws.available;
            spareSkus += 1;
          } else {
            machineryUnits += ws.available;
            machinerySkus += 1;
          }
          if (ws.available <= (prod.minStock || 10)) lowStockItemsCount += 1;
        }
      });

      return {
        ...wh,
        machineryUnits,
        machinerySkus,
        spareUnits,
        spareSkus,
        computedSkus: totalSkus,
        computedUnits: totalAvailableUnits,
        computedLowStock: lowStockItemsCount
      };
    });
  }, [warehouses, products]);

  // Filtered Warehouses according to active branch and search query
  const filteredWarehouses = useMemo(() => {
    return warehouseStats.filter((wh) => {
      // Branch filter
      if (selectedBranchFilter !== 'all' && wh.branchId !== selectedBranchFilter) {
        return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = wh.name.toLowerCase().includes(q);
        const matchesCode = wh.code.toLowerCase().includes(q);
        const matchesSupervisor = wh.supervisor.toLowerCase().includes(q);
        const matchesLocation = wh.location.toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesSupervisor && !matchesLocation) return false;
      }

      return true;
    });
  }, [warehouseStats, selectedBranchFilter, searchQuery]);

  const totalMachineryUnits = filteredWarehouses.reduce((sum, w) => sum + w.machineryUnits, 0);
  const totalSpareUnits = filteredWarehouses.reduce((sum, w) => sum + w.spareUnits, 0);

  // -------------------------------------------------------------
  // ITEMS LOCATED IN THE CURRENTLY INSPECTED WAREHOUSE
  // -------------------------------------------------------------
  const inspectedItems = useMemo(() => {
    if (!inspectingWarehouse) return [];

    const items: {
      product: Product;
      stockLoc: WarehouseStockLocation;
      available: number;
      reserved: number;
      location: string;
      lineValuation: number;
      isLowStock: boolean;
    }[] = [];

    products.forEach((prod) => {
      if (prod.isArchived || prod.status === 'Archived') return;
      const loc = prod.warehouseStocks.find((ws) => ws.warehouseId === inspectingWarehouse.id);
      if (loc && loc.available > 0) {
        const isLow = loc.available <= (prod.minStock || 10);
        items.push({
          product: prod,
          stockLoc: loc,
          available: loc.available,
          reserved: loc.reserved || 0,
          location: [loc.rack, loc.row, loc.shelf, loc.bin].filter(Boolean).join(' / ') || 'Unassigned',
          lineValuation: loc.available * (prod.purchasePrice || 350),
          isLowStock: isLow
        });
      }
    });

    return items.filter((item) => {
      // Category filter
      if (inspectCategoryFilter !== 'all' && item.product.category !== inspectCategoryFilter) {
        return false;
      }
      // Low stock filter
      if (inspectLowStockOnly && !item.isLowStock) {
        return false;
      }
      // Search
      if (inspectSearchQuery.trim()) {
        const q = inspectSearchQuery.toLowerCase().trim();
        const matchesName = item.product.name.toLowerCase().includes(q);
        const matchesSku = item.product.sku.toLowerCase().includes(q);
        const matchesLoc = item.location.toLowerCase().includes(q);
        if (!matchesName && !matchesSku && !matchesLoc) return false;
      }
      return true;
    });
  }, [inspectingWarehouse, products, inspectCategoryFilter, inspectLowStockOnly, inspectSearchQuery]);

  // Unique categories for the inspector filter
  const inspectCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [products]);

  // Handle Create Warehouse Submit
  const handleCreateWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim() || !newWhCode.trim()) {
      showToast('Validation Error', 'Warehouse name and code are required.', 'error');
      return;
    }

    addWarehouse({
      name: newWhName.trim(),
      code: newWhCode.trim().toUpperCase(),
      branchId: newWhBranchId,
      location: newWhLocation.trim() || 'Central Storage Yard',
      supervisor: newWhSupervisor.trim() || 'Yard Supervisor',
      phone: newWhPhone.trim() || '+91 97654 32100',
      capacitySqFt: Number(newWhCapacity) || 30000,
      utilizationPercentage: 40,
      totalProductsCount: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      status: 'Active'
    });

    setIsAddOpen(false);
    setNewWhName('');
    setNewWhCode('');
    setNewWhLocation('');
    setNewWhSupervisor('');
    setNewWhPhone('');
  };

  // Handle Quick Stock Adjustment: one server adjustment per changed product
  const handleStockAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalWh || !adjustProductId || isAdjusting) return;

    const prod = products.find((p) => p.id === adjustProductId);
    if (!prod) return;

    const reason = adjustReason.trim();
    if (!reason) {
      showToast('Reason required', 'Enter the audit note or reason for this adjustment.', 'warning');
      return;
    }

    const currentLoc = prod.warehouseStocks.find((ws) => ws.warehouseId === adjustModalWh.id);
    const prevCount = currentLoc ? currentLoc.available : 0;
    const diff = adjustNewCount - prevCount;

    if (diff === 0) {
      showToast('No change', 'The counted quantity matches the system stock, so nothing was adjusted.', 'info');
      return;
    }

    let payload: StockAdjustmentInput;
    if (adjustType === 'Damage / Scrap') {
      if (diff > 0) {
        showToast('Check quantity', 'A damage or scrap write-off cannot increase stock.', 'warning');
        return;
      }
      payload = { warehouseId: adjustModalWh.id, productId: prod.id, adjustmentType: 'Decrease', quantity: -diff, reason: `${adjustType}: ${reason}` };
    } else if (adjustType === 'Found / Surplus') {
      if (diff < 0) {
        showToast('Check quantity', 'A surplus receipt cannot reduce stock.', 'warning');
        return;
      }
      payload = { warehouseId: adjustModalWh.id, productId: prod.id, adjustmentType: 'Increase', quantity: diff, reason: `${adjustType}: ${reason}` };
    } else {
      payload = { warehouseId: adjustModalWh.id, productId: prod.id, adjustmentType: 'Recount', quantity: adjustNewCount, reason: `${adjustType}: ${reason}` };
    }

    setIsAdjusting(true);
    try {
      await createStockAdjustment(payload);
      setAdjustModalWh(null);
      setAdjustProductId('');
      setAdjustReason('');
    } catch (error: any) {
      showToast('Adjustment failed', error?.message || 'The server rejected this adjustment.', 'error');
    } finally {
      setIsAdjusting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Warehouses & Spares Depots
            </h1>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
              {filteredWarehouses.length} Warehouses
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Machinery and spare parts available at each branch warehouse.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsBranchStockOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-slate-900 dark:bg-slate-700 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Stock to Branch</span>
          </button>

          <button
            type="button"
            onClick={() => setIsStockUpdateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-600" />
            <span>Update Stock</span>
          </button>

          <button
            type="button"
            onClick={() => openQuickAdd('transfer')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Stock Transfer</span>
          </button>

          {isOwner && (
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 active:scale-98 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add Storage Depot</span>
            </button>
          )}
        </div>
      </div>

      <AddBranchStockModal
        isOpen={isBranchStockOpen}
        onClose={() => setIsBranchStockOpen(false)}
        defaultWarehouseId={filteredWarehouses[0]?.id}
      />
      <StockUpdateModal
        isOpen={isStockUpdateOpen}
        onClose={() => setIsStockUpdateOpen(false)}
        defaultWarehouseId={filteredWarehouses[0]?.id}
      />

      {/* Summary: machinery and spares available */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase text-slate-500">Machinery available</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900 dark:text-white">
            {totalMachineryUnits.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase text-slate-500">Spares available</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900 dark:text-white">
            {totalSpareUnits.toLocaleString()}
          </p>
        </div>
      </div>


      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search depot by name, code (e.g. BR-PMV-01) or location..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Branch Filter Selector */}
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={selectedBranchFilter}
              disabled={!isOwner}
              onChange={(e) => setSelectedBranchFilter(e.target.value)}
              className={`rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 focus:outline-none ${
                !isOwner ? 'opacity-85 cursor-not-allowed bg-slate-50' : ''
              }`}
            >
              {isOwner && <option value="all">All Regional Branches ({branches.length})</option>}
              {branches
                .filter((b) => isOwner || b.id === selectedBranchFilter)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex max-w-full items-center overflow-x-auto bg-slate-100 p-0.5 rounded-lg dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewLayout('grid')}
              className={`px-2 py-1 rounded text-xs font-semibold ${
                viewLayout === 'grid'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('table')}
              className={`px-2 py-1 rounded text-xs font-semibold ${
                viewLayout === 'table'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Warehouse cards: machinery and spares availability only */}
      {viewLayout === 'grid' ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredWarehouses.map((wh) => {
            const branch = branches.find((b) => b.id === wh.branchId);
            return (
              <div
                key={wh.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
                      <WarehouseIcon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="line-clamp-1 text-sm font-bold text-slate-900 dark:text-white">{wh.name}</h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{branch?.name || 'Regional Branch'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl border border-slate-100 bg-white/50 p-3 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Machinery</p>
                      <p className="mt-0.5 font-mono text-lg font-extrabold text-slate-900 dark:text-white">
                        {wh.machineryUnits.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-500">{wh.machinerySkus} models in stock</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white/50 p-3 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Spares</p>
                      <p className="mt-0.5 font-mono text-lg font-extrabold text-slate-900 dark:text-white">
                        {wh.spareUnits.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-500">{wh.spareSkus} parts in stock</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setInspectingWarehouse(wh);
                      setInspectSearchQuery('');
                      setInspectCategoryFilter('all');
                      setInspectLowStockOnly(false);
                    }}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2 text-xs font-bold text-white shadow-2xs transition-all hover:bg-slate-700 active:scale-98 dark:bg-slate-700"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>View Stock</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustModalWh(wh);
                      setAdjustProductId(products[0]?.id || '');
                    }}
                    title="Audit or adjust the stock count"
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Audit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3 text-right">Machinery</th>
                  <th className="px-3 py-3 text-right">Spares</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredWarehouses.map((wh) => {
                  const branch = branches.find((b) => b.id === wh.branchId);
                  return (
                    <tr key={wh.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3.5">
                        <span className="block font-bold text-slate-900 dark:text-white">{wh.name}</span>
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-slate-700 dark:text-slate-300">
                        {branch?.name || 'Regional Branch'}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {wh.machineryUnits.toLocaleString()}
                        <span className="block text-[10px] font-normal text-slate-400">{wh.machinerySkus} models</span>
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {wh.spareUnits.toLocaleString()}
                        <span className="block text-[10px] font-normal text-slate-400">{wh.spareSkus} parts</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingWarehouse(wh);
                            setInspectSearchQuery('');
                            setInspectCategoryFilter('all');
                            setInspectLowStockOnly(false);
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View Stock</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: DEEP YARD STOCK INSPECTOR DRAWER / MODAL         */}
      {/* ========================================================= */}
      {inspectingWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white font-bold">
                  <WarehouseIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {inspectingWarehouse.name}
                    </h2>
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded">
                      {inspectingWarehouse.code}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Location: {inspectingWarehouse.location} • {inspectingWarehouse.phone}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openQuickAdd('transfer')}
                  className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-blue-600" />
                  <span>Transfer Stock</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInspectingWarehouse(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Filter Sub-bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={inspectSearchQuery}
                  onChange={(e) => setInspectSearchQuery(e.target.value)}
                  placeholder="Search item name, SKU, or rack/bin location..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={inspectCategoryFilter}
                  onChange={(e) => setInspectCategoryFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="all">All Product Groups ({inspectCategories.length})</option>
                  {inspectCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setInspectLowStockOnly(!inspectLowStockOnly)}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    inspectLowStockOnly
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Low Stock Only</span>
                </button>
              </div>
            </div>

            {/* Items Table Body */}
            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Item & Part Number</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3 text-right">Available Qty</th>
                    <th className="py-2.5 px-3 text-right">Inventory Valuation</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {inspectedItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        <Package className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                        <p className="font-bold text-slate-700 dark:text-slate-300">No parts found</p>
                        <p className="text-xs text-slate-500">Try changing your search or category filter criteria.</p>
                      </td>
                    </tr>
                  ) : (
                    inspectedItems.map((item) => (
                      <tr key={item.product.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-3">
                          <span className="font-bold text-slate-900 dark:text-white block line-clamp-1">
                            {item.product.name}
                          </span>
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                            {item.product.sku}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {item.product.category}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-sm text-slate-900 dark:text-white">
                          {item.available} <span className="text-[10px] text-slate-400 font-sans">{item.product.unit || 'Nos'}</span>
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {settings.currencySymbol}{item.lineValuation.toLocaleString()}
                        </td>

                        <td className="py-3 px-3 text-center">
                          {item.isLowStock ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                              <AlertTriangle className="h-3 w-3" /> Low Stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              In Stock
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.product.isSparePart && (
                              <button
                                type="button"
                                onClick={() => {
                                  setInspectingWarehouse(null);
                                  setCurrentView('spare-books');
                                }}
                                title="View in Spare Book"
                                className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                              >
                                <BookOpen className="h-3.5 w-3.5" />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setAdjustModalWh(inspectingWarehouse);
                                setAdjustProductId(item.product.id);
                                setAdjustNewCount(item.available);
                              }}
                              className="text-[11px] font-bold text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Count Audit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-xs">
              <span className="text-slate-500">
                Displaying <strong>{inspectedItems.length}</strong> items in depot
              </span>
              <button
                type="button"
                onClick={() => setInspectingWarehouse(null)}
                className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: ADD NEW STORAGE YARD / DEPOT                     */}
      {/* ========================================================= */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Storage Yard / Depot</h3>
                <p className="text-xs text-slate-500">Configure new regional agricultural parts depot</p>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWarehouse} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Depot / Yard Name *
                </label>
                <input
                  type="text"
                  required
                  value={newWhName}
                  onChange={(e) => setNewWhName(e.target.value)}
                  placeholder="e.g. Sampletown Agro Machinery Stockyard"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Depot Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={newWhCode}
                    onChange={(e) => setNewWhCode(e.target.value)}
                    placeholder="e.g. BR-NMK-07"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Associated Branch *
                  </label>
                  <select
                    value={newWhBranchId}
                    onChange={(e) => setNewWhBranchId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-none"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.city})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Location / Yard Address
                </label>
                <input
                  type="text"
                  value={newWhLocation}
                  onChange={(e) => setNewWhLocation(e.target.value)}
                  placeholder="e.g. Salem Main Road, Sampletown Bypass"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Yard Supervisor
                  </label>
                  <input
                    type="text"
                    value={newWhSupervisor}
                    onChange={(e) => setNewWhSupervisor(e.target.value)}
                    placeholder="e.g. K. Murugesan"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Supervisor Phone
                  </label>
                  <input
                    type="text"
                    value={newWhPhone}
                    onChange={(e) => setNewWhPhone(e.target.value)}
                    placeholder="e.g. +91 97654 32107"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Storage Yard Capacity (Sq. Ft.)
                </label>
                <input
                  type="number"
                  value={newWhCapacity}
                  onChange={(e) => setNewWhCapacity(Number(e.target.value))}
                  placeholder="35000"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 shadow-xs"
                >
                  Save Warehouse Depot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: QUICK PHYSICAL COUNT AUDIT ADJUSTMENT            */}
      {/* ========================================================= */}
      {adjustModalWh && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Physical Count Adjustment</h3>
                <p className="text-xs text-slate-500">Depot: {adjustModalWh.name}</p>
              </div>
              <button
                onClick={() => setAdjustModalWh(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStockAdjustmentSubmit} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Select Product / Part *
                </label>
                <select
                  value={adjustProductId}
                  onChange={(e) => {
                    setAdjustProductId(e.target.value);
                    const prod = products.find((p) => p.id === e.target.value);
                    const loc = prod?.warehouseStocks.find((ws) => ws.warehouseId === adjustModalWh.id);
                    setAdjustNewCount(loc ? loc.available : 0);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Adjustment Type
                </label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Physical Count">Physical Count Verification</option>
                  <option value="Damage / Scrap">Damage / Scrap Write-off</option>
                  <option value="Found / Surplus">Found / Surplus Receipt</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Verified Physical Count (Units) *
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={adjustNewCount}
                  onChange={(e) => setAdjustNewCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono font-bold text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Audit Notes / Reason *
                </label>
                <textarea
                  rows={2}
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. End of month physical verification by supervisor."
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdjustModalWh(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdjusting}
                  className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white hover:bg-slate-700 shadow-xs disabled:opacity-50 dark:bg-slate-700"
                >
                  {isAdjusting ? 'Saving...' : 'Commit Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
