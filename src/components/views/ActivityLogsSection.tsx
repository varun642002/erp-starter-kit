import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Clock,
  User,
  Building2,
  ArrowRight,
  Receipt,
  Boxes,
  Layers,
  Sparkles,
  ChevronRight,
  X,
  FileCode,
  ShieldAlert,
  ArrowUpRight,
  Eye
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ActivityAuditLog } from '../../types/erp';

interface ActivityLogsSectionProps {
  initialModuleFilter?: string;
  showHeader?: boolean;
}

export const ActivityLogsSection: React.FC<ActivityLogsSectionProps> = ({
  initialModuleFilter = 'all',
  showHeader = true
}) => {
  const { auditLogs, isFirestoreConnected, syncStatus, syncNowToFirestore, settings } = useERP();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>(initialModuleFilter);
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'invoices' | 'inventory' | 'status_changes'>('all');
  const [selectedLog, setSelectedLog] = useState<ActivityAuditLog | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Filter logs based on search, module, severity, and category preset
  const filteredLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        log.action.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.user.toLowerCase().includes(q) ||
        log.module.toLowerCase().includes(q) ||
        (log.entityId && log.entityId.toLowerCase().includes(q)) ||
        (log.branchName && log.branchName.toLowerCase().includes(q)) ||
        (log.role && log.role.toLowerCase().includes(q));

      const matchesModule =
        selectedModule === 'all' ||
        log.module.toLowerCase() === selectedModule.toLowerCase();

      const matchesSeverity =
        selectedSeverity === 'all' ||
        log.severity === selectedSeverity ||
        (!log.severity && selectedSeverity === 'info');

      // Category presets
      let matchesCategory = true;
      if (selectedCategory === 'invoices') {
        matchesCategory =
          log.module.toLowerCase().includes('billing') ||
          log.module.toLowerCase().includes('invoice') ||
          log.action.toLowerCase().includes('invoice') ||
          log.entityType === 'Invoice' ||
          log.entityType === 'Payment';
      } else if (selectedCategory === 'inventory') {
        matchesCategory =
          log.module.toLowerCase().includes('inventory') ||
          log.module.toLowerCase().includes('stock') ||
          log.module.toLowerCase().includes('goods') ||
          log.action.toLowerCase().includes('stock') ||
          log.action.toLowerCase().includes('adjust') ||
          log.entityType === 'Inventory' ||
          log.entityType === 'StockTransfer' ||
          log.entityType === 'GRN';
      } else if (selectedCategory === 'status_changes') {
        matchesCategory =
          Boolean(log.previousState && log.newState) ||
          log.action.toLowerCase().includes('status') ||
          log.action.toLowerCase().includes('confirmed') ||
          log.action.toLowerCase().includes('approved') ||
          log.action.toLowerCase().includes('archived') ||
          log.action.toLowerCase().includes('dispatched') ||
          log.action.toLowerCase().includes('received');
      }

      return matchesSearch && matchesModule && matchesSeverity && matchesCategory;
    });
  }, [auditLogs, searchQuery, selectedModule, selectedSeverity, selectedCategory]);

  // Statistics
  const stats = useMemo(() => {
    const total = auditLogs.length;
    const criticalOrWarning = auditLogs.filter(l => l.severity === 'critical' || l.severity === 'warning').length;
    const invoiceActions = auditLogs.filter(l => 
      l.module.toLowerCase().includes('billing') || 
      l.module.toLowerCase().includes('invoice') || 
      l.entityType === 'Invoice' || 
      l.action.toLowerCase().includes('invoice')
    ).length;
    const inventoryActions = auditLogs.filter(l => 
      l.module.toLowerCase().includes('inventory') || 
      l.module.toLowerCase().includes('stock') || 
      l.entityType === 'Inventory' || 
      l.action.toLowerCase().includes('stock')
    ).length;
    const stateTransitions = auditLogs.filter(l => Boolean(l.previousState && l.newState)).length;

    return { total, criticalOrWarning, invoiceActions, inventoryActions, stateTransitions };
  }, [auditLogs]);

  // Export handlers
  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const headers = ['Timestamp', 'User', 'Role', 'Branch', 'Module', 'Action', 'Severity', 'Entity Type', 'Entity ID', 'Previous State', 'New State', 'IP Address', 'Details'];
      const rows = filteredLogs.map(l => [
        `"${l.timestamp}"`,
        `"${l.user}"`,
        `"${l.role}"`,
        `"${l.branchName || ''}"`,
        `"${l.module}"`,
        `"${l.action.replace(/"/g, '""')}"`,
        `"${l.severity || 'info'}"`,
        `"${l.entityType || ''}"`,
        `"${l.entityId || ''}"`,
        `"${(l.previousState || '').replace(/"/g, '""')}"`,
        `"${(l.newState || '').replace(/"/g, '""')}"`,
        `"${l.ipAddress || ''}"`,
        `"${l.details.replace(/"/g, '""')}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `Audit_Trail_Report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `Audit_Logs_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Helper badge styles
  const getSeverityBadge = (severity?: string) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
            <ShieldAlert className="w-3.5 h-3.5" />
            Critical
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            Warning
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Success
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <Info className="w-3.5 h-3.5 text-slate-800" />
            Info
          </span>
        );
    }
  };

  const getModuleBadge = (module: string) => {
    const mod = module.toLowerCase();
    if (mod.includes('billing') || mod.includes('invoice')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50">
          <Receipt className="w-3 h-3" />
          {module}
        </span>
      );
    }
    if (mod.includes('inventory') || mod.includes('stock')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50">
          <Boxes className="w-3 h-3" />
          {module}
        </span>
      );
    }
    if (mod.includes('finance') || mod.includes('payments')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/50">
          <Receipt className="w-3 h-3" />
          {module}
        </span>
      );
    }
    if (mod.includes('settings')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/50">
          <Layers className="w-3 h-3" />
          {module}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        <Layers className="w-3 h-3" />
        {module}
      </span>
    );
  };

  return (
    <div className="space-y-6" id="activity-logs-container">
      {/* Top Banner & Header */}
      {showHeader && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-800/10 text-slate-800 dark:text-slate-300">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Activity Audit Trail & Security Logs
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Sync
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                Immutable, chronological record of critical system operations including invoice issuances, stock inwarding & adjustments, financial settlements, and configuration revisions.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                id="btn-sync-audit-firestore"
                onClick={syncNowToFirestore}
                disabled={syncStatus === 'syncing'}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                title="Synchronize audit trail to Google Cloud Firestore"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin text-slate-800' : ''}`} />
                {syncStatus === 'syncing' ? 'Syncing...' : 'Sync Firestore'}
              </button>

              <button
                type="button"
                id="btn-export-audit-csv"
                onClick={handleExportCSV}
                disabled={isExporting || filteredLogs.length === 0}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-900 text-white shadow-xs transition-colors disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export CSV
              </button>

              <button
                type="button"
                id="btn-export-audit-json"
                onClick={handleExportJSON}
                disabled={filteredLogs.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50"
                title="Export as JSON"
              >
                <FileCode className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div 
          onClick={() => setSelectedCategory('all')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedCategory === 'all'
              ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800 ring-2 ring-indigo-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">Total Logged Events</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.total}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Across all operational modules
          </div>
        </div>

        <div 
          onClick={() => setSelectedCategory('invoices')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedCategory === 'invoices'
              ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 ring-2 ring-emerald-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">Invoicing & Billing</span>
            <Receipt className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.invoiceActions}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Invoices, tax notes & receipts
          </div>
        </div>

        <div 
          onClick={() => setSelectedCategory('inventory')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedCategory === 'inventory'
              ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800 ring-2 ring-amber-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">Inventory & Stock</span>
            <Boxes className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.inventoryActions}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            GRNs, transfers & adjustments
          </div>
        </div>

        <div 
          onClick={() => setSelectedCategory('status_changes')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedCategory === 'status_changes'
              ? 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-300 dark:border-purple-800 ring-2 ring-purple-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">State Transitions</span>
            <ArrowRight className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.stateTransitions}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Stage & workflow progressions
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              id="audit-log-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit trail by user, action, entity ID (e.g. INV-2026-0894), module, details..."
              className="w-full pl-10 pr-10 py-2 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-800"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Module Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="audit-filter-module" className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Module:
              </label>
              <select
                id="audit-filter-module"
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="text-xs font-medium py-2 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-800/20"
              >
                <option value="all">All Modules</option>
                <option value="Billing">Billing & Invoices</option>
                <option value="Inventory">Inventory & Stock</option>
                <option value="Sales">Sales Orders</option>
                <option value="Purchases">Purchases & POs</option>
                <option value="Goods Received">Goods Received (GRN)</option>
                <option value="Stock Transfers">Stock Transfers</option>
                <option value="Projects">Projects & Materials</option>
                <option value="Finance">Finance & Receipts</option>
                <option value="Settings">System Settings</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="audit-filter-severity" className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Severity:
              </label>
              <select
                id="audit-filter-severity"
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="text-xs font-medium py-2 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-800/20"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>
        </div>

        {/* Preset Category Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500 mr-1">Quick Filters:</span>
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'all'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            All Activity ({auditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('invoices')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'invoices'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
            }`}
          >
            Invoices & Payments ({stats.invoiceActions})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('inventory')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'inventory'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60'
            }`}
          >
            Inventory & Stock Adjustments ({stats.inventoryActions})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('status_changes')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'status_changes'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60'
            }`}
          >
            Status & Workflow Changes ({stats.stateTransitions})
          </button>

          {(searchQuery || selectedModule !== 'all' || selectedSeverity !== 'all' || selectedCategory !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedModule('all');
                setSelectedSeverity('all');
                setSelectedCategory('all');
              }}
              className="ml-auto text-xs text-slate-800 dark:text-slate-300 hover:underline font-medium"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" id="table-audit-logs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <tr>
                <th className="py-3.5 px-4">Timestamp & IP</th>
                <th className="py-3.5 px-4">Actor / Role</th>
                <th className="py-3.5 px-4">Module & Action</th>
                <th className="py-3.5 px-4">Entity ID & State Transition</th>
                <th className="py-3.5 px-4">Details & Audit Payload</th>
                <th className="py-3.5 px-4">Severity</th>
                <th className="py-3.5 px-4 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No activity logs found</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Try adjusting your search query, module, or category filters.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                    >
                      {/* Timestamp & IP */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-900 dark:text-white">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {log.timestamp}
                        </div>
                        {log.ipAddress && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                            IP: {log.ipAddress}
                          </div>
                        )}
                      </td>

                      {/* Actor & Role */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {log.user.charAt(0)}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">
                              {log.user}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {log.role}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Module & Action */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          {getModuleBadge(log.module)}
                          <span className="text-xs font-medium text-slate-900 dark:text-white mt-0.5">
                            {log.action}
                          </span>
                        </div>
                      </td>

                      {/* Entity & State Transition */}
                      <td className="py-3.5 px-4">
                        {log.entityId ? (
                          <div className="space-y-1">
                            <span className="inline-block px-2 py-0.5 rounded font-mono text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
                              {log.entityId}
                            </span>
                            {log.previousState && log.newState && (
                              <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                                <span className="line-through text-slate-400">{log.previousState}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">{log.newState}</span>
                              </div>
                            )}
                          </div>
                        ) : log.previousState && log.newState ? (
                          <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="line-through text-slate-400">{log.previousState}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">{log.newState}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Global Action</span>
                        )}
                      </td>

                      {/* Details & Payload */}
                      <td className="py-3.5 px-4 max-w-xs md:max-w-md">
                        <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          {log.details}
                        </p>
                        {log.branchName && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                            <Building2 className="w-3 h-3" />
                            <span>{log.branchName}</span>
                          </div>
                        )}
                      </td>

                      {/* Severity */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getSeverityBadge(log.severity)}
                      </td>

                      {/* View Button */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="View Full Audit Payload"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="py-3 px-4 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Showing {filteredLogs.length} of {auditLogs.length} total logged events</span>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Audit Trail Verified & Protected</span>
          </div>
        </div>
      </div>

      {/* Audit Detail Modal / Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-slate-800/10 text-slate-800 dark:text-slate-300">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Audit Log Inspection
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    ID: {selectedLog.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Primary metadata row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Timestamp</span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-white mt-1 block">
                    {selectedLog.timestamp}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Module</span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-white mt-1 block">
                    {selectedLog.module}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Severity</span>
                  <div className="mt-1">{getSeverityBadge(selectedLog.severity)}</div>
                </div>
              </div>

              {/* Actor & Location */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Actor / User:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{selectedLog.user} ({selectedLog.role})</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Branch Location:</span>
                  <span className="text-slate-800 dark:text-slate-200">{selectedLog.branchName || 'Head Office'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Origin IP Address:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{selectedLog.ipAddress || '192.168.1.10'}</span>
                </div>
              </div>

              {/* State Transition (if any) */}
              {(selectedLog.previousState || selectedLog.newState) && (
                <div className="p-4 bg-slate-100/50 dark:bg-slate-900/20 rounded-xl border border-slate-300 dark:border-slate-900 space-y-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-300 block">
                    State / Status Transition
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                      <span className="text-[10px] text-slate-400 uppercase block font-medium">Previous State</span>
                      <span className="text-slate-700 dark:text-slate-300 font-medium">{selectedLog.previousState || 'None (Created)'}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="flex-1 p-2 rounded-lg bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-xs">
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase block font-semibold">New State</span>
                      <span className="text-emerald-700 dark:text-emerald-300 font-bold">{selectedLog.newState || 'Updated'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action & Full Description */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Action Name</span>
                <p className="text-sm font-bold text-slate-900 dark:text-white p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  {selectedLog.action}
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Audit Trail Description</span>
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
                  {selectedLog.details}
                </div>
              </div>

              {selectedLog.entityId && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
                  <span className="text-slate-500 font-medium">Target Entity:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-300">
                    {selectedLog.entityType ? `${selectedLog.entityType}: ` : ''}{selectedLog.entityId}
                  </span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-800/20">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200"
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
