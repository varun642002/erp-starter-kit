import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Package,
  Users,
  Truck,
  FileText,
  ShieldCheck,
  Warehouse,
  Building2,
  ArrowRight,
  ArrowLeftRight,
  Wrench,
  Plus,
  Tag
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ViewType, Product } from '../../types/erp';

export const GlobalSearchModal: React.FC = () => {
  const {
    isGlobalSearchOpen,
    setIsGlobalSearchOpen,
    products,
    customers,
    suppliers,
    invoices,
    salesOrders,
    warranties,
    warehouses,
    branches,
    stockTransfers,
    setCurrentView,
    openQuickAdd,
    settings
  } = useERP();

  const [query, setQuery] = useState('');

  const isSpareProduct = (p: Product): boolean => Boolean(p.isSparePart);

  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase().trim();

    const matchedSpares = products
      .filter(p => isSpareProduct(p) && (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.oemPartNumber && p.oemPartNumber.toLowerCase().includes(q)) ||
        (p.shelfBinLocation && p.shelfBinLocation.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.compatibleModels && p.compatibleModels.some(m => m.toLowerCase().includes(q)))
      ))
      .slice(0, 4);

    const matchedProducts = products
      .filter(p => !isSpareProduct(p) && (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      ))
      .slice(0, 3);

    const matchedCustomers = customers
      .filter(c => c.companyName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedSuppliers = suppliers
      .filter(s => s.companyName.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedInvoices = invoices
      .filter(i => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedOrders = salesOrders
      .filter(o => o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedWarranties = warranties
      .filter(w => w.serialNumber.toLowerCase().includes(q) || w.productName.toLowerCase().includes(q) || w.customerName.toLowerCase().includes(q) || w.engineNumber.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedTransfers = stockTransfers
      .filter(t => t.transferNumber.toLowerCase().includes(q) || t.requestedBy.toLowerCase().includes(q))
      .slice(0, 3);

    const matchedWarehouses = warehouses
      .filter(w => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q))
      .slice(0, 3);

    const hasResults =
      matchedSpares.length > 0 ||
      matchedProducts.length > 0 ||
      matchedCustomers.length > 0 ||
      matchedSuppliers.length > 0 ||
      matchedInvoices.length > 0 ||
      matchedOrders.length > 0 ||
      matchedWarranties.length > 0 ||
      matchedTransfers.length > 0 ||
      matchedWarehouses.length > 0;

    return {
      hasResults,
      matchedSpares,
      matchedProducts,
      matchedCustomers,
      matchedSuppliers,
      matchedInvoices,
      matchedOrders,
      matchedWarranties,
      matchedTransfers,
      matchedWarehouses
    };
  }, [query, products, customers, suppliers, invoices, salesOrders, warranties, stockTransfers, warehouses]);

  if (!isGlobalSearchOpen) return null;

  const navigateTo = (view: ViewType) => {
    setCurrentView(view);
    setIsGlobalSearchOpen(false);
    setQuery('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-16 backdrop-blur-xs sm:pt-20">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-slate-200 px-4 dark:border-slate-800">
          <Search className="h-4.5 w-4.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, serials, customers, invoices, warehouses, transfers..."
            className="h-13 w-full bg-transparent px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white dark:placeholder:text-slate-500"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="mr-2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            ESC
          </kbd>
          <button
            onClick={() => setIsGlobalSearchOpen(false)}
            className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results Container */}
        <div className="max-h-96 overflow-y-auto p-3">
          {!query.trim() && (
            <div className="py-8 text-center">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick Navigation</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {[
                  { label: '⚙️ Spares Hub', view: 'inventory' as ViewType },
                  { label: 'Products Master', view: 'inventory' as ViewType },
                  { label: 'Sales Orders', view: 'sales' as ViewType },
                  { label: 'Invoices', view: 'billing' as ViewType },
                  { label: 'Warranties & Serials', view: 'warranties' as ViewType },
                  { label: 'Stock Transfers', view: 'stock-transfers' as ViewType }
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => navigateTo(item.view)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.trim() && searchResults && !searchResults.hasResults && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No records found matching "{query}"</p>
            </div>
          )}

          {searchResults && searchResults.hasResults && (
            <div className="space-y-3">
              {/* Spare Parts & Components */}
              {searchResults.matchedSpares.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                      <Wrench className="h-3 w-3" /> Spare Parts & Components ({searchResults.matchedSpares.length})
                    </div>
                  </div>
                  <div className="space-y-1">
                    {searchResults.matchedSpares.map(p => {
                      const stock = p.warehouseStocks?.reduce((acc, ws) => acc + (ws.available || 0), 0) || (p as any).currentStock || 0;
                      return (
                        <div
                          key={p.id}
                          onClick={() => navigateTo('inventory')}
                          className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 hover:bg-amber-50/60 dark:hover:bg-slate-800 border border-transparent hover:border-amber-200 dark:hover:border-slate-700 transition-all"
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-slate-900 dark:text-white">{p.name}</p>
                              <span className="rounded bg-slate-100 px-1 font-mono text-[9px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {p.sku}
                              </span>
                              {p.oemPartNumber && (
                                <span className="rounded bg-blue-50 px-1 font-mono text-[9px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                  OEM: {p.oemPartNumber}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">
                              {p.category} {p.shelfBinLocation && `• 📍 ${p.shelfBinLocation}`} • {stock} {p.unit} in stock
                            </p>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {settings.currencySymbol}{p.sellingPrice.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Machinery Products */}
              {searchResults.matchedProducts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-bold text-slate-400 uppercase">
                    <Package className="h-3 w-3" /> Finished Machinery & Equipment
                  </div>
                  <div className="space-y-1">
                    {searchResults.matchedProducts.map(p => (
                      <div
                        key={p.id}
                        onClick={() => navigateTo('inventory')}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">{p.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">SKU: {p.sku} • {p.category}</p>
                        </div>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {settings.currencySymbol}{p.sellingPrice.toLocaleString()} / {p.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Customers */}
              {searchResults.matchedCustomers.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-bold text-slate-400 uppercase">
                    <Users className="h-3 w-3" /> Customers
                  </div>
                  <div className="space-y-1">
                    {searchResults.matchedCustomers.map(c => (
                      <div
                        key={c.id}
                        onClick={() => navigateTo('customers')}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">{c.companyName}</p>
                          <p className="text-[11px] text-slate-500">Contact: {c.name} • {c.city}</p>
                        </div>
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          Bal: {settings.currencySymbol}{c.outstandingBalance.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoices */}
              {searchResults.matchedInvoices.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-bold text-slate-400 uppercase">
                    <FileText className="h-3 w-3" /> Invoices
                  </div>
                  <div className="space-y-1">
                    {searchResults.matchedInvoices.map(i => (
                      <div
                        key={i.id}
                        onClick={() => navigateTo('billing')}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <div>
                          <p className="text-xs font-semibold font-mono text-slate-900 dark:text-white">{i.invoiceNumber}</p>
                          <p className="text-[11px] text-slate-500">{i.customerName} • {i.invoiceDate}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {settings.currencySymbol}{i.grandTotal.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warranties & Serials */}
              {searchResults.matchedWarranties.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-bold text-slate-400 uppercase">
                    <ShieldCheck className="h-3 w-3" /> Machinery Warranties & Serials
                  </div>
                  <div className="space-y-1">
                    {searchResults.matchedWarranties.map(w => (
                      <div
                        key={w.id}
                        onClick={() => navigateTo('warranties')}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white font-mono">{w.serialNumber} • {w.productName}</p>
                          <p className="text-[11px] text-slate-500">Customer: {w.customerName} • Engine: {w.engineNumber}</p>
                        </div>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          w.status === 'Active' 
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : w.status === 'Expiring Soon'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        }`}>
                          {w.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span>Search across 10 interconnected ERP modules</span>
          </div>
          <span className="font-mono text-[10px]">ESC to close</span>
        </div>
      </div>
    </div>
  );
};
