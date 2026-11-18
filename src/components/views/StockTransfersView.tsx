import React, { useState } from 'react';
import {
  Plus,
  Search,
  Truck,
  Eye,
  PackageCheck,
  RefreshCw,
  Loader2,
  AlertTriangle,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { StockTransfer, StockTransferStatus } from '../../types/erp';
import { canManageHeadOfficeStock, canActOnBranchStock } from '../../services/stockApi';

const statusBadges: Record<StockTransferStatus, string> = {
  Draft: 'text-slate-700 dark:text-slate-300',
  Requested: 'text-slate-700 dark:text-slate-300',
  Approved: 'text-blue-700 dark:text-blue-300',
  Dispatched: 'text-indigo-700 dark:text-indigo-300',
  'In Transit': 'text-amber-700 dark:text-amber-300',
  'Partially Received': 'text-teal-700 dark:text-teal-300',
  Received: 'text-emerald-700 dark:text-emerald-300',
  Cancelled: 'text-rose-700 dark:text-rose-300'
};

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const primaryBtn =
  'rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-700 dark:hover:bg-slate-600';
const ghostBtn =
  'rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

export const StockTransfersView: React.FC = () => {
  const {
    filteredStockTransfers,
    stockLoading,
    stockError,
    refreshStock,
    warehouses,
    approveStockTransfer,
    dispatchStockTransfer,
    receiveStockTransfer,
    cancelStockTransfer,
    showToast,
    openQuickAdd,
    currentRole
  } = useERP();
  const { userProfile, assignedBranchId } = useAuth();

  const userBranchId = userProfile?.branchId || assignedBranchId || 'branch-1';
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const canManageHO = canManageHeadOfficeStock(currentRole, userBranchId);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dispatch modal
  const [dispatchTr, setDispatchTr] = useState<StockTransfer | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');

  // Receive modal: per-item good and damaged quantities, short is derived.
  const [receiveTr, setReceiveTr] = useState<StockTransfer | null>(null);
  const [receiveRows, setReceiveRows] = useState<Record<string, { received: string; damaged: string }>>({});

  // Always read the live record so the details modal reflects refreshes.
  const selectedTransfer = filteredStockTransfers.find(t => t.id === selectedTransferId) || null;

  const filtered = filteredStockTransfers.filter((tr) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      tr.transferNumber.toLowerCase().includes(q) ||
      tr.requestedBy.toLowerCase().includes(q) ||
      (tr.vehicleNumber || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || tr.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const whName = (id: string) => warehouses.find(w => w.id === id)?.name || id;

  const run = async (id: string, fn: () => Promise<unknown>, failTitle: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await fn();
      return true;
    } catch (error: any) {
      showToast(failTitle, error?.message || 'Request failed', 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openDispatch = (tr: StockTransfer) => {
    setVehicleNo('');
    setDriverName('');
    setDriverPhone('');
    setDispatchTr(tr);
  };

  const handleConfirmDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchTr) return;
    const ok = await run(
      dispatchTr.id,
      () => dispatchStockTransfer(dispatchTr.id, {
        vehicleNumber: vehicleNo.trim() || undefined,
        driverName: driverName.trim() || undefined,
        driverPhone: driverPhone.trim() || undefined
      }),
      'Dispatch failed'
    );
    if (ok) setDispatchTr(null);
  };

  const openReceive = (tr: StockTransfer) => {
    const rows: Record<string, { received: string; damaged: string }> = {};
    tr.items.forEach(it => {
      rows[it.productId] = { received: String(it.dispatchedQty || it.requestedQty), damaged: '0' };
    });
    setReceiveRows(rows);
    setReceiveTr(tr);
  };

  const parseQty = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  const receiveProblems = (tr: StockTransfer): string | null => {
    for (const it of tr.items) {
      const row = receiveRows[it.productId];
      const dispatched = it.dispatchedQty || it.requestedQty;
      if (!row) continue;
      if (parseQty(row.received) + parseQty(row.damaged) > dispatched) {
        return `${it.productName}: received plus damaged cannot exceed ${dispatched}.`;
      }
    }
    return null;
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveTr) return;
    const problem = receiveProblems(receiveTr);
    if (problem) {
      showToast('Check quantities', problem, 'warning');
      return;
    }
    const ok = await run(
      receiveTr.id,
      () => receiveStockTransfer(
        receiveTr.id,
        receiveTr.items.map(it => ({
          productId: it.productId,
          receivedQty: parseQty(receiveRows[it.productId]?.received ?? '0'),
          damagedQty: parseQty(receiveRows[it.productId]?.damaged ?? '0')
        }))
      ),
      'Receive failed'
    );
    if (ok) setReceiveTr(null);
  };

  const handleCancel = (tr: StockTransfer) => {
    if (!window.confirm(`Cancel transfer ${tr.transferNumber}?`)) return;
    run(tr.id, () => cancelStockTransfer(tr.id), 'Cancel failed');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Inter-Branch Stock Transfers & In-Transit
            </h1>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {filteredStockTransfers.length} Transfers
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Stock leaves the Head Office on dispatch, shows as In Transit at the branch, and is added to branch stock once the branch verifies receipt.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshStock()}
            disabled={stockLoading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${stockLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {canManageHO ? (
            <button
              onClick={() => openQuickAdd('transfer')}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-700 cursor-pointer dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <Plus className="h-4 w-4" />
              <span>Request Transfer</span>
            </button>
          ) : (
            <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Transfers are approved and dispatched by the Head Office
            </div>
          )}
        </div>
      </div>

      {stockError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Could not load stock records: {stockError}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by transfer #, requester, vehicle #"
            aria-label="Search transfers"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Transfer status"
            className="h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All Transfer States</option>
            <option value="Requested">Requested</option>
            <option value="Approved">Approved</option>
            <option value="In Transit">In Transit (Dispatched)</option>
            <option value="Received">Received & Closed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Transfers Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4">Transfer #</th>
                <th className="py-3 px-4">Source (From)</th>
                <th className="py-3 px-4">Destination (To)</th>
                <th className="py-3 px-4 text-center">Request Date</th>
                <th className="py-3 px-4 text-right">Items & Qty</th>
                <th className="py-3 px-4">Logistics / Vehicle</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {stockLoading && filteredStockTransfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading stock transfers...
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No stock transfers found matching filters.
                  </td>
                </tr>
              ) : (
                filtered.map((tr) => {
                  const busy = busyId === tr.id;
                  const canReceive = canActOnBranchStock(currentRole, userBranchId, tr.toBranchId);
                  const canCancel =
                    (tr.status === 'Requested' || tr.status === 'Approved') &&
                    (canManageHO || canActOnBranchStock(currentRole, userBranchId, tr.toBranchId));

                  return (
                    <tr key={tr.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {tr.transferNumber}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{whName(tr.fromWarehouseId)}</p>
                        <p className="text-[10px] text-slate-400">Req By: {tr.requestedBy}</p>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {whName(tr.toWarehouseId)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-500">
                        {tr.requestDate}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {tr.items.map((it, i) => (
                          <div key={i} className="font-mono">
                            <span className="font-bold text-slate-900 dark:text-white">{it.requestedQty} {it.unit}</span>
                            <span className="text-[10px] text-slate-500 ml-1">({it.productName.split(' ')[0]})</span>
                          </div>
                        ))}
                      </td>
                      <td className="py-3 px-4">
                        {tr.vehicleNumber ? (
                          <div>
                            <p className="font-mono font-semibold text-slate-900 dark:text-white">{tr.vehicleNumber}</p>
                            {tr.driverName && (
                              <p className="text-[10px] text-slate-400">{tr.driverName}{tr.driverPhone ? ` - ${tr.driverPhone}` : ''}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Not Dispatched</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block text-[11px] font-bold ${statusBadges[tr.status]}`}>
                          {tr.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedTransferId(tr.id)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="View Transfer Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {canManageHO && tr.status === 'Requested' && (
                            <button
                              disabled={busy}
                              onClick={() => run(tr.id, () => approveStockTransfer(tr.id), 'Approval failed')}
                              className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-50 cursor-pointer dark:bg-slate-700"
                            >
                              {busy ? 'Approving...' : 'Approve'}
                            </button>
                          )}

                          {canManageHO && tr.status === 'Approved' && (
                            <button
                              disabled={busy}
                              onClick={() => openDispatch(tr)}
                              className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-slate-700 disabled:opacity-50 cursor-pointer dark:bg-slate-700"
                            >
                              <Truck className="h-3 w-3" />
                              <span>Dispatch</span>
                            </button>
                          )}

                          {canReceive && (tr.status === 'In Transit' || tr.status === 'Dispatched') && (
                            <button
                              disabled={busy}
                              onClick={() => openReceive(tr)}
                              className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-slate-700 disabled:opacity-50 cursor-pointer dark:bg-slate-700"
                            >
                              <PackageCheck className="h-3 w-3" />
                              <span>Receive</span>
                            </button>
                          )}

                          {canCancel && (
                            <button
                              disabled={busy}
                              onClick={() => handleCancel(tr)}
                              className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            >
                              Cancel
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

      {/* Dispatch Modal */}
      {dispatchTr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Dispatch Transfer Shipment</h3>
                <p className="text-xs text-slate-500">Transfer #{dispatchTr.transferNumber} to {whName(dispatchTr.toWarehouseId)}</p>
              </div>
              <button
                onClick={() => setDispatchTr(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmDispatch} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Vehicle / Truck Number</label>
                <input
                  type="text"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  placeholder="TN-45-AB-1234"
                  className={`${inputCls} font-mono uppercase`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Driver Name</label>
                  <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Driver Phone</label>
                  <input type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <p className="font-semibold">Stock movement</p>
                <p className="mt-0.5 text-[11px]">
                  Dispatch deducts the requested quantities from the Head Office warehouse and shows them as In Transit at the destination until it confirms receipt.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => setDispatchTr(null)} className={ghostBtn}>Close</button>
                <button type="submit" disabled={busyId === dispatchTr.id} className={primaryBtn}>
                  {busyId === dispatchTr.id ? 'Dispatching...' : 'Dispatch Shipment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {receiveTr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Verify and Receive Shipment</h3>
                <p className="text-xs text-slate-500">Transfer #{receiveTr.transferNumber} into {whName(receiveTr.toWarehouseId)}</p>
              </div>
              <button
                onClick={() => setReceiveTr(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReceive} className="p-4 space-y-3">
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3 text-right">Dispatched</th>
                      <th className="py-2 px-3 text-right">Received (good)</th>
                      <th className="py-2 px-3 text-right">Damaged</th>
                      <th className="py-2 px-3 text-right">Short</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {receiveTr.items.map((it) => {
                      const dispatched = it.dispatchedQty || it.requestedQty;
                      const row = receiveRows[it.productId] || { received: '0', damaged: '0' };
                      const short = dispatched - parseQty(row.received) - parseQty(row.damaged);
                      return (
                        <tr key={it.productId}>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-slate-900 dark:text-white">{it.productName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{it.sku}</p>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{dispatched} {it.unit}</td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={row.received}
                              onChange={(e) => setReceiveRows(prev => ({ ...prev, [it.productId]: { ...row, received: e.target.value } }))}
                              className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={row.damaged}
                              onChange={(e) => setReceiveRows(prev => ({ ...prev, [it.productId]: { ...row, damaged: e.target.value } }))}
                              className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-semibold ${short < 0 ? 'text-rose-600' : short > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                            {short}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Only good received units are added to branch stock. Damaged and short units are written off against the in-transit quantity and recorded in the stock ledger.
              </p>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => setReceiveTr(null)} className={ghostBtn}>Close</button>
                <button type="submit" disabled={busyId === receiveTr.id} className={primaryBtn}>
                  {busyId === receiveTr.id ? 'Saving...' : 'Confirm Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Details Modal */}
      {selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold font-mono text-slate-900 dark:text-white">Transfer #{selectedTransfer.transferNumber}</h3>
                <span className={`mt-1 inline-block text-[11px] font-bold ${statusBadges[selectedTransfer.status]}`}>
                  {selectedTransfer.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedTransferId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3.5 text-xs dark:bg-slate-800/60">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">From</span>
                  <p className="font-semibold text-slate-900 dark:text-white">{whName(selectedTransfer.fromWarehouseId)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">To</span>
                  <p className="font-semibold text-slate-900 dark:text-white">{whName(selectedTransfer.toWarehouseId)}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Transferred Material Items</h4>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                      <tr>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3 text-right">Requested</th>
                        <th className="py-2 px-3 text-right">Dispatched</th>
                        <th className="py-2 px-3 text-right">Received</th>
                        <th className="py-2 px-3 text-right">Damaged</th>
                        <th className="py-2 px-3 text-right">Short</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedTransfer.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-slate-900 dark:text-white">{it.productName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{it.sku}</p>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{it.requestedQty}</td>
                          <td className="py-2 px-3 text-right font-mono">{it.dispatchedQty}</td>
                          <td className="py-2 px-3 text-right font-mono">{it.receivedQty}</td>
                          <td className="py-2 px-3 text-right font-mono">{it.damagedQty}</td>
                          <td className="py-2 px-3 text-right font-mono">{it.shortQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedTransfer.vehicleNumber && (
                <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <p className="font-bold text-slate-800 dark:text-slate-200">Transit Details</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                    Vehicle: <b className="font-mono text-slate-900 dark:text-white">{selectedTransfer.vehicleNumber}</b>
                    {selectedTransfer.driverName && ` | Driver: ${selectedTransfer.driverName}`}
                    {selectedTransfer.driverPhone && ` (${selectedTransfer.driverPhone})`}
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Timeline</h4>
                {selectedTransfer.timeline.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No events recorded yet.</p>
                ) : (
                  <ol className="space-y-2 border-l border-slate-200 pl-4 dark:border-slate-700">
                    {selectedTransfer.timeline.map((ev, i) => (
                      <li key={i} className="text-xs">
                        <p className="font-semibold text-slate-900 dark:text-white">{ev.stage}</p>
                        <p className="text-[11px] text-slate-500">{ev.date} - {ev.user}</p>
                        {ev.notes && <p className="text-[11px] text-slate-600 dark:text-slate-400">{ev.notes}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3 text-right dark:border-slate-800 dark:bg-slate-800/50">
              <button
                onClick={() => setSelectedTransferId(null)}
                className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-700 dark:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
