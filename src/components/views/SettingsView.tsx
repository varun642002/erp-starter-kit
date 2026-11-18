import React, { useState } from 'react';
import {
  Settings,
  Building2,
  Save,
  ShieldCheck,
  CreditCard,
  Hash,
  Globe,
  DollarSign,
  FileText,
  Clock,
  Database,
  RefreshCw,
  Download,
  KeyRound
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { ActivityLogsSection } from './ActivityLogsSection';
import { downloadSqlDatabaseBackup } from '../../services/api';

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    isFirestoreConnected,
    syncStatus,
    syncNowToFirestore,
    auditLogs,
    currentRole,
    branchPersonStockEdit,
    setBranchPersonStockEdit,
    showToast
  } = useERP();
  const { isSuperAdmin } = useAuth();
  // Only the Super Admin account sees and uses the permissions switches (the server enforces it as well).
  const canManagePermissions = isSuperAdmin && currentRole === 'Super Admin';

  const [activeTab, setActiveTab] = useState<'profile' | 'audit_logs' | 'sync' | 'permissions'>('profile');
  const [savingPermission, setSavingPermission] = useState(false);
  const toggleBranchStockEdit = async () => {
    setSavingPermission(true);
    try {
      await setBranchPersonStockEdit(!branchPersonStockEdit);
    } catch (e: any) {
      showToast('Could not save', e?.message || 'The setting was not saved. Please try again.', 'error');
    } finally {
      setSavingPermission(false);
    }
  };

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [legalName, setLegalName] = useState(settings.legalName);
  const [gstin, setGstin] = useState(settings.gstin);
  const [pan, setPan] = useState(settings.pan);
  const [address, setAddress] = useState(settings.address);
  const [city, setCity] = useState(settings.city);
  const [state, setState] = useState(settings.state);
  const [phone, setPhone] = useState(settings.phone);
  const [email, setEmail] = useState(settings.email);

  // Bank Info
  const [bankName, setBankName] = useState(settings.bankDetails.bankName);
  const [accNo, setAccNo] = useState(settings.bankDetails.accountNumber);
  const [ifsc, setIfsc] = useState(settings.bankDetails.ifscCode);
  const [branchName, setBranchName] = useState(settings.bankDetails.branchName);

  // Prefixes
  const [invPrefix, setInvPrefix] = useState(settings.invoicePrefix);
  const [poPrefix, setPoPrefix] = useState(settings.poPrefix);
  const [soPrefix, setSoPrefix] = useState(settings.salesOrderPrefix);

  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      companyName,
      legalName,
      gstin,
      pan,
      address,
      city,
      state,
      phone,
      email,
      bankDetails: {
        bankName,
        accountNumber: accNo,
        ifscCode: ifsc,
        branchName
      },
      invoicePrefix: invPrefix,
      poPrefix,
      salesOrderPrefix: soPrefix
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            System & Enterprise Configuration
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage company master details, GST tax configurations, bank accounts, document sequence prefixes, and immutable audit trails.
          </p>
        </div>

        {isSaved && (
          <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ Settings Saved Successfully
          </span>
        )}
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex gap-2 overflow-x-auto whitespace-nowrap border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'profile'
              ? 'border-slate-800 text-slate-800 dark:border-slate-300 dark:text-slate-300'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Enterprise Profile & Sequences</span>
        </button>

        <button
          type="button"
          id="btn-settings-tab-audit-logs"
          onClick={() => setActiveTab('audit_logs')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'audit_logs'
              ? 'border-slate-800 text-slate-800 dark:border-slate-300 dark:text-slate-300'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Activity Logs</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-900/60 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
            {auditLogs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'sync'
              ? 'border-slate-800 text-slate-800 dark:border-slate-300 dark:text-slate-300'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Cloud Database & Sync</span>
        </button>

        {canManagePermissions && (
          <button
            type="button"
            id="btn-settings-tab-permissions"
            onClick={() => setActiveTab('permissions')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
              activeTab === 'permissions'
                ? 'border-slate-800 text-slate-800 dark:border-slate-300 dark:text-slate-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Permissions</span>
          </button>
        )}
      </div>

      {/* Permissions: switches only the Super Admin controls */}
      {activeTab === 'permissions' && canManagePermissions && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Branch persons can edit stock</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                When on, a branch person can update stock quantities for their own branch (one by one or from a CSV file), add
                spare parts, and correct item names, part numbers and alternate names. Prices, status, categories and deleting
                items always stay with the owner and the Warehouse Manager. Every change is recorded in the stock history.
              </p>
              <p className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Currently {branchPersonStockEdit ? 'ON: branch persons can edit stock.' : 'OFF: branch persons can only view stock.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={branchPersonStockEdit}
              aria-label="Branch persons can edit stock"
              disabled={savingPermission}
              onClick={toggleBranchStockEdit}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
                branchPersonStockEdit ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  branchPersonStockEdit ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Tab 1: Enterprise Profile & Prefixes Form */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Master Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <Building2 className="h-4 w-4 text-slate-800 dark:text-slate-300" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Company & Legal Registration</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Company Trade Name *</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Legal Entity Name *</label>
                <input
                  type="text"
                  required
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">GSTIN Number *</label>
                <input
                  type="text"
                  required
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">PAN Number *</label>
                <input
                  type="text"
                  required
                  value={pan}
                  onChange={(e) => setPan(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Registered Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">State / Region</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Bank Details Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Primary Bank Account (Printed on Invoices)</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Bank Name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Account Number</label>
                <input
                  type="text"
                  value={accNo}
                  onChange={(e) => setAccNo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">IFSC Code</label>
                <input
                  type="text"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Branch Name</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Document Sequence Prefixes */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <Hash className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Document Sequence Number Prefixes</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Invoice Number Prefix</label>
                <input
                  type="text"
                  value={invPrefix}
                  onChange={(e) => setInvPrefix(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Purchase Order Prefix</label>
                <input
                  type="text"
                  value={poPrefix}
                  onChange={(e) => setPoPrefix(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Sales Order Prefix</label>
                <input
                  type="text"
                  value={soPrefix}
                  onChange={(e) => setSoPrefix(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 rounded-xl bg-slate-800 px-6 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-900 active:scale-98"
            >
              <Save className="h-4 w-4" />
              <span>Save Enterprise Configuration</span>
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Dedicated Activity Logs Audit Trail */}
      {activeTab === 'audit_logs' && (
        <ActivityLogsSection />
      )}

      {/* Tab 3: Cloud Database & Sync Status */}
      {activeTab === 'sync' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-800/10 text-slate-800 dark:text-slate-300">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Google Cloud Firestore Persistence
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Real-time cloud synchronization for master data, transaction ledgers, and audit logs.
                  </p>
                </div>
              </div>

              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                syncStatus === 'synced'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : syncStatus === 'syncing'
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}>
                <span className={`w-2 h-2 rounded-full ${syncStatus === 'synced' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                {syncStatus === 'synced' ? 'Cloud Synced' : syncStatus === 'syncing' ? 'Syncing...' : 'Local Cache'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Audit Trail Collection</span>
                <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  {auditLogs.length} Records
                </p>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 block">
                  Immutable audit records
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Security & Role Isolation</span>
                <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  RBAC Active
                </p>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                  Admin & Controller privileges
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Database Node</span>
                <p className="text-sm font-mono font-bold text-slate-900 dark:text-white mt-1 truncate">
                  asia-south1 (Mumbai)
                </p>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                  Low-latency local replica
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={syncNowToFirestore}
                disabled={syncStatus === 'syncing'}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-slate-900 active:scale-98 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>Force Manual Sync Now</span>
              </button>
            </div>
          </div>

          {/* Relational SQL Dump Export Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    PostgreSQL Relational Backup & Disaster Recovery (.sql)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Export complete database structure, foreign key relations, products, sales orders, invoices, and audit logs.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await downloadSqlDatabaseBackup();
                  } catch (e: any) {
                    console.error('SQL Backup Download failed:', e);
                  }
                }}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 active:scale-98 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export Database (.sql Dump)</span>
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Suitable for off-site backup, cloud migration, and standard PostgreSQL restoration using <code className="font-mono text-slate-800 dark:text-slate-200">psql</code>. Binary PDF documents remain referenced by URL and are not bloated into SQL payloads.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

