import React, { useState } from 'react';
import {
  X,
  Printer,
  Download,
  Building2,
  Boxes,
  ShoppingCart,
  FileText,
  CheckCircle2,
  Barcode,
  Calendar,
  Layers
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Product, SalesOrder, Invoice } from '../../types/erp';

export interface BatchPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'inventory' | 'sales' | 'invoices';
  selectedInventoryItems?: Product[];
  selectedSalesOrders?: SalesOrder[];
  selectedInvoices?: Invoice[];
}

export const BatchPrintModal: React.FC<BatchPrintModalProps> = ({
  isOpen,
  onClose,
  type,
  selectedInventoryItems = [],
  selectedSalesOrders = [],
  selectedInvoices = []
}) => {
  const { settings, branches, warehouses } = useERP();
  const [printLayout, setPrintLayout] = useState<'manifest' | 'labels'>('manifest');

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  // Compute stats for inventory
  const totalInvStock = selectedInventoryItems.reduce((acc, p) => {
    const stock = p.warehouseStocks?.reduce((s, ws) => s + ws.available, 0) || (p as any).currentStock || 0;
    return acc + stock;
  }, 0);

  const totalInvValue = selectedInventoryItems.reduce((acc, p) => {
    const stock = p.warehouseStocks?.reduce((s, ws) => s + ws.available, 0) || (p as any).currentStock || 0;
    return acc + (stock * p.purchasePrice);
  }, 0);

  // Compute stats for sales orders
  const totalSalesValue = selectedSalesOrders.reduce((acc, so) => acc + so.grandTotal, 0);
  const totalSalesItemsCount = selectedSalesOrders.reduce((acc, so) => acc + so.items.reduce((sum, it) => sum + it.quantity, 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        
        {/* Action Header (Hidden during actual print) */}
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-300">
              {type === 'inventory' ? <Boxes className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {type === 'inventory'
                  ? `Batch Print: ${selectedInventoryItems.length} Materials`
                  : `Batch Print: ${selectedSalesOrders.length} Sales Orders`}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Print preview formatted for standard A4 document & label sheets.
              </p>
            </div>
          </div>

          {type === 'inventory' && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setPrintLayout('manifest')}
                className={`rounded-md px-3 py-1 transition-colors cursor-pointer ${
                  printLayout === 'manifest'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                Stock Manifest
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout('labels')}
                className={`rounded-md px-3 py-1 transition-colors cursor-pointer ${
                  printLayout === 'labels'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                Barcode Labels
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-900 active:scale-98 cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print All Now</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Area */}
        <div className="print-container flex-1 overflow-y-auto p-8 bg-white text-slate-900">
          
          {/* ==================================================== */}
          {/* INVENTORY BATCH PRINT */}
          {/* ==================================================== */}
          {type === 'inventory' && (
            <div>
              {printLayout === 'manifest' ? (
                <div className="space-y-3">
                  {/* Company Header */}
                  <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                    <div>
                      <h1 className="text-xl font-extrabold tracking-tight text-slate-900 uppercase">
                        {settings.companyName}
                      </h1>
                      <p className="text-xs font-semibold text-slate-600">{settings.legalName}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        GSTIN: <span className="font-mono font-bold text-slate-900">{settings.gstin}</span> • PAN: {settings.panNumber}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="inline-block rounded bg-slate-900 px-3 py-1 text-xs font-bold text-white uppercase tracking-wider">
                        Inventory Audit & Stock Manifest
                      </span>
                      <p className="text-xs text-slate-500 mt-2">
                        Generated Date: <span className="font-semibold text-slate-800">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Selected Items: <span className="font-bold text-slate-800 font-mono">{selectedInventoryItems.length} SKUs</span>
                      </p>
                    </div>
                  </div>

                  {/* Summary Metric Strip */}
                  <div className="grid grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Materials</p>
                      <p className="text-sm font-bold text-slate-900 font-mono">{selectedInventoryItems.length} Items</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Available Stock</p>
                      <p className="text-sm font-bold text-slate-900 font-mono">{totalInvStock.toLocaleString()} Units</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Aggregate Valuation</p>
                      <p className="text-sm font-bold text-slate-900 font-mono">{settings.currencySymbol}{totalInvValue.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Valuation Method</p>
                      <p className="text-sm font-bold text-slate-800">FIFO Stock Model</p>
                    </div>
                  </div>

                  {/* Materials Table */}
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-900 bg-slate-100 font-bold text-slate-800">
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">SKU & Barcode</th>
                        <th className="py-2.5 px-3">Material Description</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">HSN Code</th>
                        <th className="py-2.5 px-3 text-right">Cost Price</th>
                        <th className="py-2.5 px-3 text-right">Selling Rate</th>
                        <th className="py-2.5 px-3 text-center">GST %</th>
                        <th className="py-2.5 px-3 text-right">Available Qty</th>
                        <th className="py-2.5 px-3 text-right">Total Valuation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {selectedInventoryItems.map((prod, idx) => {
                        const stock = prod.warehouseStocks?.reduce((s, ws) => s + ws.available, 0) || (prod as any).currentStock || 0;
                        const val = stock * prod.purchasePrice;

                        return (
                          <tr key={prod.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                              {prod.sku}
                              {prod.barcode && <span className="block text-[9px] text-slate-400 font-normal">BC: {prod.barcode}</span>}
                            </td>
                            <td className="py-2.5 px-3">
                              <p className="font-bold text-slate-900">{prod.name}</p>
                              {prod.brand && <p className="text-[10px] text-slate-500">Brand: {prod.brand}</p>}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{prod.category}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-600">{prod.hsnCode || '252329'}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                              {settings.currencySymbol}{prod.purchasePrice.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                              {settings.currencySymbol}{prod.sellingPrice.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono text-slate-600">{prod.gstRate}%</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {stock.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{prod.unit}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {settings.currencySymbol}{val.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                        <td colSpan={8} className="py-2.5 px-3 text-right uppercase tracking-wider">
                          Total Selection Aggregate:
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {totalInvStock.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                          {settings.currencySymbol}{totalInvValue.toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* Sign-off Blocks */}
                  <div className="grid grid-cols-3 gap-3 pt-12 text-xs border-t border-slate-200 mt-8">
                    <div>
                      <div className="border-b border-slate-400 h-10 mb-1" />
                      <p className="font-bold text-slate-800">Prepared By</p>
                      <p className="text-[11px] text-slate-500">Inventory Officer / Storekeeper</p>
                    </div>
                    <div>
                      <div className="border-b border-slate-400 h-10 mb-1" />
                      <p className="font-bold text-slate-800">Verified By</p>
                      <p className="text-[11px] text-slate-500">Warehouse Manager</p>
                    </div>
                    <div>
                      <div className="border-b border-slate-400 h-10 mb-1" />
                      <p className="font-bold text-slate-800">Authorized Signature</p>
                      <p className="text-[11px] text-slate-500">Finance Controller / Auditor</p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Barcode Label Sheet View */
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-3">
                    <h3 className="font-bold text-slate-900 text-sm">Printable Barcode & Material Bin Labels</h3>
                    <p className="text-xs text-slate-500">Standard 2-column or 3-column sticker layout for warehouse racks and bins.</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {selectedInventoryItems.map((prod) => (
                      <div key={prod.id} className="border-2 border-dashed border-slate-300 rounded-xl p-3 bg-white text-center">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{settings.companyName}</p>
                        <p className="font-extrabold text-xs text-slate-900 mt-1 line-clamp-1">{prod.name}</p>
                        <div className="my-2 bg-slate-100 p-2 rounded-lg flex flex-col items-center justify-center">
                          <div className="font-mono text-lg tracking-[0.25em] font-bold text-slate-800">
                            ||||| | |||| ||| ||
                          </div>
                          <span className="font-mono text-[10px] font-semibold text-slate-600 mt-0.5">{prod.barcode || prod.sku}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] border-t border-slate-100 pt-1.5 text-slate-600">
                          <span>SKU: <strong className="font-mono text-slate-900">{prod.sku}</strong></span>
                          <span>MRP: <strong className="font-mono text-slate-900">{settings.currencySymbol}{prod.mrp || prod.sellingPrice}</strong></span>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1">HSN: {prod.hsnCode} • GST: {prod.gstRate}% • Unit: {prod.unit}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* SALES ORDERS BATCH PRINT */}
          {/* ==================================================== */}
          {type === 'sales' && (
            <div className="space-y-8">
              {/* Batch Manifest Header */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                <div>
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900 uppercase">
                    {settings.companyName}
                  </h1>
                  <p className="text-xs font-semibold text-slate-600">{settings.legalName}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    GSTIN: <span className="font-mono font-bold text-slate-900">{settings.gstin}</span> • PAN: {settings.panNumber}
                  </p>
                </div>

                <div className="text-right">
                  <span className="inline-block rounded bg-slate-900 px-3 py-1 text-xs font-bold text-white uppercase tracking-wider">
                    Batch Dispatch & Picking Manifest
                  </span>
                  <p className="text-xs text-slate-500 mt-2">
                    Date: <span className="font-semibold text-slate-800">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Selected Orders: <span className="font-bold text-slate-800 font-mono">{selectedSalesOrders.length} Orders</span>
                  </p>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Sales Orders</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{selectedSalesOrders.length} Orders</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Items To Dispatch</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{totalSalesItemsCount.toLocaleString()} Units</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Gross Manifest Value</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{settings.currencySymbol}{totalSalesValue.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Dispatch Hub</p>
                  <p className="text-sm font-bold text-slate-800">Multi-Branch Logistics</p>
                </div>
              </div>

              {/* Iterating each order as a distinct packing / dispatch slip */}
              <div className="space-y-3">
                {selectedSalesOrders.map((order, orderIdx) => {
                  const branch = branches.find(b => b.id === order.branchId);
                  const warehouse = warehouses.find(w => w.id === order.warehouseId);

                  return (
                    <div
                      key={order.id}
                      className="border border-slate-300 rounded-xl p-4 bg-white text-xs shadow-xs page-break-after"
                    >
                      <div className="flex justify-between items-start border-b border-slate-200 pb-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-900">{order.orderNumber}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                              {order.status}
                            </span>
                          </div>
                          <p className="font-bold text-slate-800 text-sm mt-1">{order.customerName}</p>
                          <p className="text-slate-500 text-[11px] mt-0.5">Shipping Address: {order.shippingAddress}</p>
                        </div>

                        <div className="text-right text-[11px]">
                          <p><span className="text-slate-500">Order Date:</span> <strong className="font-semibold text-slate-800">{order.orderDate}</strong></p>
                          <p><span className="text-slate-500">Expected Delivery:</span> <strong className="font-semibold text-slate-800">{order.expectedDeliveryDate}</strong></p>
                          <p><span className="text-slate-500">Dispatch Branch:</span> <strong className="font-semibold text-slate-800">{warehouse?.name || 'Main Branch'}</strong></p>
                          <p><span className="text-slate-500">Salesperson:</span> <strong className="font-semibold text-slate-800">{order.salesperson}</strong></p>
                        </div>
                      </div>

                      {/* Items Table */}
                      <table className="w-full text-left border-collapse my-2">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700">
                            <th className="py-2 px-2.5">#</th>
                            <th className="py-2 px-2.5">Material SKU & Name</th>
                            <th className="py-2 px-2.5 text-center">Unit</th>
                            <th className="py-2 px-2.5 text-right">Quantity</th>
                            <th className="py-2 px-2.5 text-right">Rate</th>
                            <th className="py-2 px-2.5 text-right">Tax (GST)</th>
                            <th className="py-2 px-2.5 text-right">Total Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {order.items.map((it, itIdx) => (
                            <tr key={itIdx}>
                              <td className="py-1.5 px-2.5 font-mono text-slate-400">{itIdx + 1}</td>
                              <td className="py-1.5 px-2.5">
                                <span className="font-semibold text-slate-900">{it.productName}</span>
                                <span className="text-[10px] text-slate-400 font-mono ml-2">SKU: {it.sku}</span>
                              </td>
                              <td className="py-1.5 px-2.5 text-center text-slate-600">{it.unit}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-900">{it.quantity}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{settings.currencySymbol}{it.rate.toLocaleString()}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono text-slate-500">{settings.currencySymbol}{it.taxAmount.toLocaleString()}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-900">{settings.currencySymbol}{it.totalAmount.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-300 font-bold bg-slate-50/50">
                            <td colSpan={3} className="py-2 px-2.5 text-slate-600">Order Grand Total:</td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">
                              {order.items.reduce((s, it) => s + it.quantity, 0)}
                            </td>
                            <td colSpan={2} />
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">
                              {settings.currencySymbol}{order.grandTotal.toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>

                      {/* Driver & Client Sign-off */}
                      <div className="grid grid-cols-2 gap-3 pt-4 text-[10px] text-slate-500 border-t border-slate-100">
                        <div>
                          <p className="font-semibold text-slate-700">Driver & Vehicle Details:</p>
                          <div className="border-b border-dashed border-slate-300 h-6 mt-1" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-700">Client Goods Received Acknowledgment:</p>
                          <div className="border-b border-dashed border-slate-300 h-6 mt-1" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
