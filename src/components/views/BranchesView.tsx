import React, { useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  MapPin,
  Phone,
  Mail,
  Users,
  Warehouse,
  TrendingUp,
  CreditCard,
  ShieldCheck
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Branch } from '../../types/erp';
import { EditBranchModal } from '../common/EditBranchModal';

export const BranchesView: React.FC = () => {
  const {
    branches,
    warehouses,
    employees,
    salesOrders,
    addBranch,
    settings,
    setSelectedBranchId,
    setCurrentView,
    currentRole
  } = useERP();
  const canEditBranch = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const [branchToEdit, setBranchToEdit] = useState<Branch | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Pune');
  const [state, setState] = useState('Maharashtra');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [manager, setManager] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !code) return;

    addBranch({
      name,
      code,
      address,
      city,
      state,
      gstin: gstin || settings.gstin,
      phone: phone || '+91 98200 00000',
      email: `${name.toLowerCase().replace(/\s+/g, '')}@example.com`,
      manager: manager || 'Branch Incharge',
      isActive: true,
      currency: 'INR'
    });

    setIsAddOpen(false);
    setName('');
    setCode('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Branches & Regional Operations
            </h1>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:bg-slate-800/80 dark:text-slate-300">
              {branches.length} Branches
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Multi-branch profit centers, regional revenue attribution, GSTIN registrations, and assigned staff.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-900 active:scale-98"
        >
          <Plus className="h-4 w-4" />
          <span>Add New Branch</span>
        </button>
      </div>

      {/* Branch Cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {branches.map((b) => {
          const branchWarehouses = warehouses.filter(w => w.branchId === b.id);
          const branchStaff = employees.filter(e => e.branchId === b.id);
          const branchOrders = salesOrders.filter(o => o.branchId === b.id);
          const branchRevenue = branchOrders.reduce((sum, o) => sum + o.grandTotal, 0);

          return (
            <div
              key={b.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{b.name}</h3>
                      <p className="text-xs text-slate-500 font-mono">Code: {b.code} • {b.city}, {b.state}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Active Center
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{b.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono text-slate-800 dark:text-slate-200">GSTIN: {b.gstin}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>{b.phone}</span>
                  </div>
                </div>

                {/* Performance Stats */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                    <p className="text-[10px] text-slate-400">Branch Revenue</p>
                    <p className="font-mono font-bold text-slate-800 dark:text-slate-300">
                      {settings.currencySymbol}{(branchRevenue / 100000).toFixed(2)}L
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                    <p className="text-[10px] text-slate-400">Yards / Warehouses</p>
                    <p className="font-mono font-bold text-slate-900 dark:text-white">{branchWarehouses.length} Yards</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                    <p className="text-[10px] text-slate-400">Staff Count</p>
                    <p className="font-mono font-bold text-slate-900 dark:text-white">{branchStaff.length} Members</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                {canEditBranch && (
                  <button
                    onClick={() => setBranchToEdit(b)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Edit details
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedBranchId(b.id);
                    setCurrentView('dashboard');
                  }}
                  className="flex-1 rounded-lg bg-slate-900 py-2 text-center text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-800"
                >
                  Filter ERP View to This Branch
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <EditBranchModal branch={branchToEdit} onClose={() => setBranchToEdit(null)} />

      {/* Add Branch Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register New Branch</h3>
                <p className="text-xs text-slate-500">Create a regional profit and sales center</p>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pune Central Depot"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch Code *</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. BR-PUN"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Full Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Plot 10, MIDC Bhosari"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch Manager</label>
                  <input
                    type="text"
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                    placeholder="e.g. Rajesh Shinde"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Contact Number</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98200 00000"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">State GSTIN</label>
                <input
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="00AAAAA0000A1Z0"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-900"
                >
                  Create Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
