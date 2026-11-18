import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Check, Package, Wrench, ChevronDown, AlertCircle } from 'lucide-react';
import { Product } from '../../types/erp';
import { searchSqlProducts } from '../../services/api';
import { useERP } from '../../context/ERPContext';
import { formatStock } from '../../utils/units';

// One shared empty list, so the default prop does not create a new array on every render.
const NO_PRODUCTS: Product[] = [];

interface ProductSearchSelectProps {
  value: string; // product id or sku
  onChange: (product: Product) => void;
  products?: Product[]; // fallback list used only while the context catalogue is empty
  placeholder?: string;
  className?: string;
  filterSpareOnly?: boolean;
  filterMachineryOnly?: boolean;
  // Scope the displayed stock to one warehouse or branch; omitted means the total across all warehouses.
  warehouseId?: string;
  branchId?: string;
}

export const ProductSearchSelect: React.FC<ProductSearchSelectProps> = ({
  value,
  onChange,
  products: productsProp = NO_PRODUCTS,
  placeholder = 'Search by Item No (SKU) or Product Name...',
  className = '',
  filterSpareOnly = false,
  filterMachineryOnly = false,
  warehouseId,
  branchId
}) => {
  const { products: contextProducts, activeProducts, warehouses, productsLoading } = useERP();
  // The context catalogue is SQL-backed, so it is the source of truth for the empty-search list and live stock.
  // Removed (archived) items are never offered.
  // Kept in useMemo: the search effect below depends on this list, so it must keep the same identity between renders.
  const useContextList = contextProducts.length > 0;
  const products = useMemo(
    () => (useContextList ? activeProducts : productsProp).filter((p) => !p.isArchived && p.status !== 'Archived'),
    // the fallback list only matters while the context catalogue is empty
    [useContextList, activeProducts, useContextList ? null : productsProp]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find currently selected product
  const selectedProduct =
    productsProp.find((p) => p.id === value || p.sku === value) ||
    contextProducts.find((p) => p.id === value || p.sku === value);

  const scopedWarehouseIds: string[] | null = warehouseId
    ? [warehouseId]
    : branchId
      ? warehouses.filter((w) => w.branchId === branchId).map((w) => w.id)
      : null;

  const stockFor = (prod: Product): number => {
    // Search results may omit stock rows, so read quantities from the live catalogue when possible.
    const live = contextProducts.find((p) => p.id === prod.id) || prod;
    return (live.warehouseStocks || [])
      .filter((ws) => !scopedWarehouseIds || scopedWarehouseIds.includes(ws.warehouseId))
      .reduce((acc, ws) => acc + (ws.available || 0), 0);
  };

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        if (searchTerm.trim()) {
          // Query backend SQL search endpoint
          const serverMatches = await searchSqlProducts(searchTerm.trim(), 20).catch(() => null);
          let filtered = serverMatches ? serverMatches.filter((p) => !p.isArchived && p.status !== 'Archived') : serverMatches;

          if (!filtered) {
            // Fallback to local products array
            const q = searchTerm.toLowerCase().trim();
            filtered = products.filter(
              (p) =>
                p.sku.toLowerCase().includes(q) ||
                p.name.toLowerCase().includes(q) ||
                (p.oemPartNumber && p.oemPartNumber.toLowerCase().includes(q)) ||
                (p.alternateNames && p.alternateNames.some((n) => n.toLowerCase().includes(q))) ||
                p.category.toLowerCase().includes(q)
            );
          }

          if (filterSpareOnly) {
            filtered = filtered.filter((p) => p.isSparePart || p.sku.startsWith('SPR-'));
          } else if (filterMachineryOnly) {
            filtered = filtered.filter((p) => !p.isSparePart && !p.sku.startsWith('SPR-'));
          }

          setResults(filtered.slice(0, 20));
        } else {
          let initialList = products;
          if (filterSpareOnly) {
            initialList = initialList.filter((p) => p.isSparePart || p.sku.startsWith('SPR-'));
          } else if (filterMachineryOnly) {
            initialList = initialList.filter((p) => !p.isSparePart && !p.sku.startsWith('SPR-'));
          }
          setResults(initialList.slice(0, 15));
        }
      } catch (err) {
        console.error('Product search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchTerm, isOpen, products, filterSpareOnly, filterMachineryOnly]);

  const handleSelect = (product: Product) => {
    onChange(product);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected Value Bar / Trigger */}
      <div
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen && !searchTerm) {
            let initial = products;
            if (filterSpareOnly) initial = initial.filter((p) => p.isSparePart || p.sku.startsWith('SPR-'));
            setResults(initial.slice(0, 15));
          }
        }}
        className="flex min-h-[44px] w-full cursor-pointer sm:min-h-[38px] items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs transition-colors hover:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
      >
        {selectedProduct ? (
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {selectedProduct.sku}
            </span>
            <span className="truncate font-medium text-slate-900 dark:text-white">
              {selectedProduct.name}
            </span>
            <span className="hidden sm:inline-block shrink-0 text-[11px] text-slate-400">
              ({selectedProduct.category})
            </span>
          </div>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        <div className="flex items-center gap-1 text-slate-400">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
          {/* Search Input in Dropdown */}
          <div className="sticky top-0 border-b border-slate-100 bg-slate-50/90 p-2 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-800/90">
            <div className="relative">
              <Search className="absolute left-2.5 top-3.5 h-3.5 w-3.5 text-slate-400 sm:top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Type Item No (e.g. PT-00125) or Name (e.g. hyd)..."
                className="w-full rounded-md border border-slate-200 bg-white py-2.5 pl-8 pr-7 text-base text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 sm:py-1.5 sm:text-xs focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                autoFocus
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-3 text-slate-400 hover:text-slate-600 sm:top-2 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Results List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 p-1">
            {isLoading || (productsLoading && products.length === 0) ? (
              <div className="p-4 text-center text-xs text-slate-400">Loading product catalogue...</div>
            ) : results.length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-500">
                <AlertCircle className="mx-auto h-5 w-5 text-slate-400 mb-1 opacity-70" />
                <p>{searchTerm ? `No products match "${searchTerm}"` : 'No products in the catalogue yet'}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Try searching by partial Item No or Name</p>
              </div>
            ) : (
              results.map((prod) => {
                const isSelected = selectedProduct?.id === prod.id || selectedProduct?.sku === prod.sku;
                const stock = stockFor(prod);
                const isSpare = prod.isSparePart || prod.sku.startsWith('SPR-');

                return (
                  <div
                    key={prod.id}
                    onClick={() => handleSelect(prod)}
                    className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[10px] font-bold rounded bg-slate-100 px-1.5 py-0.5 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                          {prod.sku}
                        </span>
                        {isSpare ? (
                          <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-0.5">
                            <Wrench className="h-2.5 w-2.5" /> SPARE
                          </span>
                        ) : (
                          <span className="rounded bg-blue-50 px-1 py-0.2 text-[9px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            MACHINE
                          </span>
                        )}
                        <span className="truncate font-semibold text-xs text-slate-900 dark:text-white">
                          {prod.name}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span>{prod.category}</span>
                        {prod.oemPartNumber && <span>• OEM: {prod.oemPartNumber}</span>}
                        {prod.shelfBinLocation && <span>• Bin: {prod.shelfBinLocation}</span>}
                        <span>• {scopedWarehouseIds ? 'Stock' : 'Total stock'}: {formatStock(stock, contextProducts.find((p) => p.id === prod.id) || prod)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-right">
                      <div>
                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-white block">
                          ₹{prod.sellingPrice?.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          Cost: ₹{prod.purchasePrice?.toLocaleString()}
                        </span>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
