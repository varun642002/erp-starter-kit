import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Wrench,
  User,
  Building2,
  Calendar,
  FileText,
  Send,
  Plus,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Phone,
  Mail,
  RefreshCw,
  Info,
  Layers,
  ArrowRight,
  FileSpreadsheet,
  Trash2
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ProductWarranty, WarrantyStatus, WarrantyServiceRecord, Customer } from '../../types/erp';

export const WarrantyView: React.FC = () => {
  const {
    warranties,
    filteredWarranties,
    products, activeProducts,
    customers,
    branches,
    invoices,
    settings,
    selectedBranchId,
    addWarranty,
    updateWarranty,
    deleteWarranty,
    addWarrantyClaim,
    updateWarrantyClaimStatus,
    sendWarrantyAlert,
    dismissWarrantyAlert,
    setCurrentView,
    showToast
  } = useERP();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | WarrantyStatus>('All');
  const [coverageFilter, setCoverageFilter] = useState<string>('All');
  const [branchFilter, setBranchFilter] = useState<string>('All');

  // Modal States
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [selectedWarrantyDetails, setSelectedWarrantyDetails] = useState<ProductWarranty | null>(null);
  const [warrantyToDelete, setWarrantyToDelete] = useState<ProductWarranty | null>(null);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [warrantyForClaim, setWarrantyForClaim] = useState<ProductWarranty | null>(null);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [warrantyForAlert, setWarrantyForAlert] = useState<ProductWarranty | null>(null);
  const [alertChannel, setAlertChannel] = useState<'WhatsApp' | 'Email' | 'SMS'>('WhatsApp');
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  // Customer Quick Profile Modal
  const [customerModalData, setCustomerModalData] = useState<Customer | null>(null);

  // New Warranty Form State
  const [formData, setFormData] = useState({
    serialNumber: '',
    chassisNumber: '',
    engineNumber: '',
    productId: '',
    customerId: '',
    branchId: selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id || 'branch-1'),
    invoiceId: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    durationMonths: 12,
    coverageType: 'Full Comprehensive' as ProductWarranty['coverageType'],
    notes: ''
  });

  // Claim Form State
  const [claimData, setClaimData] = useState({
    issueDescription: '',
    technicianName: '',
    replacedParts: '',
    claimCost: 0,
    status: 'Submitted' as WarrantyServiceRecord['status']
  });

  // Today reference
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => today.toISOString().split('T')[0], [today]);

  // Currency
  const currency = settings.currencySymbol || '₹';

  // Calculate Days Remaining helper
  const getWarrantyValidityInfo = (endDateStr: string) => {
    const end = new Date(endDateStr);
    const diffTime = end.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: `Expired ${Math.abs(diffDays)} days ago`,
        badgeClass: 'text-rose-800 dark:text-rose-300',
        isExpired: true,
        isExpiringSoon: false,
        days: diffDays
      };
    } else if (diffDays <= 30) {
      return {
        text: `${diffDays} days left (Expiring Soon)`,
        badgeClass: 'text-amber-800 dark:text-amber-300 animate-pulse',
        isExpired: false,
        isExpiringSoon: true,
        days: diffDays
      };
    } else {
      return {
        text: `${diffDays} days left`,
        badgeClass: 'text-emerald-800 dark:text-emerald-300',
        isExpired: false,
        isExpiringSoon: false,
        days: diffDays
      };
    }
  };

  // Filtered Warranties list
  const filteredList = useMemo(() => {
    return filteredWarranties.filter((w) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        w.serialNumber.toLowerCase().includes(query) ||
        (w.chassisNumber && w.chassisNumber.toLowerCase().includes(query)) ||
        (w.engineNumber && w.engineNumber.toLowerCase().includes(query)) ||
        w.warrantyCode.toLowerCase().includes(query) ||
        w.productName.toLowerCase().includes(query) ||
        w.productSku.toLowerCase().includes(query) ||
        w.customerName.toLowerCase().includes(query);

      const validity = getWarrantyValidityInfo(w.warrantyEndDate);

      let matchesStatus = true;
      if (statusFilter === 'Active') {
        matchesStatus = !validity.isExpired && w.status !== 'Claim In Review' && w.status !== 'Void';
      } else if (statusFilter === 'Expiring Soon') {
        matchesStatus = validity.isExpiringSoon;
      } else if (statusFilter === 'Expired') {
        matchesStatus = validity.isExpired || w.status === 'Expired';
      } else if (statusFilter === 'Claim In Review') {
        matchesStatus = w.status === 'Claim In Review';
      } else if (statusFilter !== 'All') {
        matchesStatus = w.status === statusFilter;
      }

      const matchesCoverage = coverageFilter === 'All' || w.coverageType === coverageFilter;
      const matchesBranch = branchFilter === 'All' || w.branchId === branchFilter;

      return matchesSearch && matchesStatus && matchesCoverage && matchesBranch;
    });
  }, [filteredWarranties, searchQuery, statusFilter, coverageFilter, branchFilter, today]);

  // Key KPI metrics
  const stats = useMemo(() => {
    const total = filteredWarranties.length;
    let active = 0;
    let expiringSoon = 0;
    let expired = 0;
    let inClaim = 0;

    filteredWarranties.forEach((w) => {
      const validity = getWarrantyValidityInfo(w.warrantyEndDate);
      if (w.status === 'Claim In Review') inClaim++;
      if (validity.isExpired) {
        expired++;
      } else if (validity.isExpiringSoon) {
        expiringSoon++;
        active++;
      } else {
        active++;
      }
    });

    return { total, active, expiringSoon, expired, inClaim };
  }, [filteredWarranties, today]);

  // Urgent expiring list (< 30 days)
  const expiringSoonAlerts = useMemo(() => {
    return filteredWarranties.filter((w) => {
      if (w.expirationAlertDismissed) return false;
      const validity = getWarrantyValidityInfo(w.warrantyEndDate);
      return validity.isExpiringSoon;
    });
  }, [filteredWarranties, today]);

  // Open Alert Modal with generated message
  const handleOpenAlertModal = (w: ProductWarranty, defaultChannel: 'WhatsApp' | 'Email' = 'WhatsApp') => {
    setWarrantyForAlert(w);
    setAlertChannel(defaultChannel);

    const validity = getWarrantyValidityInfo(w.warrantyEndDate);
    const branchObj = branches.find((b) => b.id === w.branchId);

    const messageText = `Dear ${w.customerName},\n\nThis is an official equipment warranty notification from ${settings.companyName || 'Agro Machinery & Spares Hub'}.\n\nYour registered agricultural machinery:\n• Equipment: ${w.productName}\n• Serial Number: ${w.serialNumber}\n• Coverage: ${w.coverageType}\n• Expiration Date: ${w.warrantyEndDate} (${validity.text})\n\nTo ensure continued protection against field breakdowns during the active cropping season and to inspect your powertrain/gearbox components, please contact your nearest branch (${branchObj?.name || 'Local Branch'}, Phone: ${branchObj?.phone || settings.supportPhone || '+91 98420 11223'}) to renew your Annual Maintenance Contract (AMC) or book a complimentary final warranty inspection.\n\nThank you,\nCustomer Service & Warranty Desk`;

    setAlertMessage(messageText);
    setIsAlertModalOpen(true);
  };

  // Dispatch alert
  const handleDispatchAlert = () => {
    if (!warrantyForAlert) return;

    if (alertChannel === 'WhatsApp') {
      const phoneClean = warrantyForAlert.customerPhone.replace(/[^0-9]/g, '');
      const waUrl = phoneClean.length >= 10
        ? `https://wa.me/${phoneClean.startsWith('91') ? phoneClean : '91' + phoneClean}?text=${encodeURIComponent(alertMessage)}`
        : `https://wa.me/?text=${encodeURIComponent(alertMessage)}`;
      window.open(waUrl, '_blank');
    } else if (alertChannel === 'Email') {
      const subject = encodeURIComponent(`Warranty Expiration Notice: ${warrantyForAlert.productName} (S/N: ${warrantyForAlert.serialNumber})`);
      window.location.href = `mailto:${warrantyForAlert.customerEmail || ''}?subject=${subject}&body=${encodeURIComponent(alertMessage)}`;
    }

    sendWarrantyAlert(warrantyForAlert.id, alertChannel);
    setIsAlertModalOpen(false);
  };

  // Copy serial number
  const handleCopySerial = (sn: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sn);
      setCopiedSerial(sn);
      showToast('Serial Copied', `Serial number ${sn} copied to clipboard.`, 'info');
      setTimeout(() => setCopiedSerial(null), 2000);
    }
  };

  // View Customer Profile Helper
  const handleViewCustomerProfile = (customerId: string) => {
    const cust = customers.find((c) => c.id === customerId);
    if (cust) {
      setCustomerModalData(cust);
    }
  };

  // Submit New Warranty
  const handleRegisterWarranty = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.serialNumber.trim()) {
      showToast('Error', 'Machine Serial Number is required.', 'error');
      return;
    }
    if (!formData.productId) {
      showToast('Error', 'Please select a product/machinery model.', 'error');
      return;
    }
    if (!formData.customerId) {
      showToast('Error', 'Please select the purchasing customer.', 'error');
      return;
    }

    // Calculate End Date
    const start = new Date(formData.purchaseDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(formData.durationMonths));
    const endDateStr = end.toISOString().split('T')[0];

    const prod = products.find((p) => p.id === formData.productId);
    const cust = customers.find((c) => c.id === formData.customerId);
    const br = branches.find((b) => b.id === formData.branchId);

    const code = `WAR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    addWarranty({
      warrantyCode: code,
      serialNumber: formData.serialNumber.trim().toUpperCase(),
      chassisNumber: formData.chassisNumber ? formData.chassisNumber.trim().toUpperCase() : undefined,
      engineNumber: formData.engineNumber ? formData.engineNumber.trim().toUpperCase() : undefined,
      productId: formData.productId,
      productName: prod?.name || 'Agro Equipment',
      productSku: prod?.sku || 'AGR-SKU',
      productCategory: prod?.category || 'Finished Agricultural Machinery',
      customerId: formData.customerId,
      customerName: cust?.companyName || cust?.name || 'Customer',
      customerPhone: cust?.phone || '',
      customerEmail: cust?.email,
      branchId: formData.branchId,
      branchName: br?.name,
      invoiceId: formData.invoiceId || undefined,
      purchaseDate: formData.purchaseDate,
      warrantyStartDate: formData.purchaseDate,
      warrantyEndDate: endDateStr,
      durationMonths: Number(formData.durationMonths),
      coverageType: formData.coverageType,
      status: 'Active',
      notes: formData.notes,
      serviceRecords: []
    });

    setIsRegisterModalOpen(false);
    setFormData({
      serialNumber: '',
      chassisNumber: '',
      engineNumber: '',
      productId: '',
      customerId: '',
      branchId: selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id || 'branch-1'),
      invoiceId: '',
      purchaseDate: todayStr,
      durationMonths: 12,
      coverageType: 'Full Comprehensive',
      notes: ''
    });
  };

  // Submit Claim
  const handleSubmitClaim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!warrantyForClaim || !claimData.issueDescription.trim()) {
      showToast('Validation Error', 'Issue description is required.', 'error');
      return;
    }

    const replacedPartsArr = claimData.replacedParts
      ? claimData.replacedParts.split(',').map((p) => p.trim()).filter(Boolean)
      : [];

    addWarrantyClaim(warrantyForClaim.id, {
      claimDate: todayStr,
      issueDescription: claimData.issueDescription.trim(),
      technicianName: claimData.technicianName.trim() || 'Service Engineer',
      replacedParts: replacedPartsArr,
      claimCost: Number(claimData.claimCost) || 0,
      status: claimData.status
    });

    setIsClaimModalOpen(false);
    setWarrantyForClaim(null);
    setClaimData({
      issueDescription: '',
      technicianName: '',
      replacedParts: '',
      claimCost: 0,
      status: 'Submitted'
    });
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredList.length === 0) {
      showToast('Export Empty', 'No warranty records to export.', 'warning');
      return;
    }

    const headers = [
      'Warranty Code',
      'Serial Number',
      'Chassis Number',
      'Engine Number',
      'Equipment Name',
      'SKU',
      'Category',
      'Customer',
      'Phone',
      'Branch',
      'Purchase Date',
      'Warranty Start',
      'Warranty End',
      'Status',
      'Coverage'
    ];

    const rows = filteredList.map((w) => [
      w.warrantyCode,
      w.serialNumber,
      w.chassisNumber || 'N/A',
      w.engineNumber || 'N/A',
      `"${w.productName.replace(/"/g, '""')}"`,
      w.productSku,
      `"${w.productCategory}"`,
      `"${w.customerName.replace(/"/g, '""')}"`,
      w.customerPhone,
      `"${w.branchName || w.branchId}"`,
      w.purchaseDate,
      w.warrantyStartDate,
      w.warrantyEndDate,
      w.status,
      `"${w.coverageType}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `AgroMachinery_Warranty_Master_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Export Successful', `Exported ${filteredList.length} warranty records.`, 'success');
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner & Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Agro Machinery Warranty & Serial Management
                <span className="rounded-md bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
                  {stats.total} Tracked Units
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Serial number tracking, chassis/engine registry, automated expiration alerts, and direct customer profile links across 6 branches.
              </p>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 cursor-pointer shadow-2xs transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Export CSV
          </button>
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="h-4 w-4" />
            Register Machinery Warranty
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {/* Total Registered */}
        <div
          onClick={() => setStatusFilter('All')}
          className={`cursor-pointer rounded-xl border p-4 transition-all ${
            statusFilter === 'All'
              ? 'border-blue-500 bg-blue-50/50 dark:border-blue-500/80 dark:bg-blue-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Tracked</span>
            <ShieldCheck className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-mono">
            {stats.total}
          </p>
          <span className="text-[11px] text-slate-400">All registered serials</span>
        </div>

        {/* Active Warranties */}
        <div
          onClick={() => setStatusFilter('Active')}
          className={`cursor-pointer rounded-xl border p-4 transition-all ${
            statusFilter === 'Active'
              ? 'border-emerald-500 bg-emerald-50/50 dark:border-emerald-500/80 dark:bg-emerald-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Active Coverage</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 font-mono">
            {stats.active}
          </p>
          <span className="text-[11px] text-emerald-600/80">Valid manufacturer terms</span>
        </div>

        {/* Expiring Soon (< 30 Days) */}
        <div
          onClick={() => setStatusFilter('Expiring Soon')}
          className={`cursor-pointer rounded-xl border p-4 transition-all ${
            statusFilter === 'Expiring Soon'
              ? 'border-amber-500 bg-amber-50/70 dark:border-amber-500/80 dark:bg-amber-950/30 ring-2 ring-amber-400/40'
              : 'border-amber-200/80 bg-amber-50/30 hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              Expiring Soon
            </span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300 font-mono">
            {stats.expiringSoon}
          </p>
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
            &lt; 30 Days expiration alerts
          </span>
        </div>

        {/* Claims in Review */}
        <div
          onClick={() => setStatusFilter('Claim In Review')}
          className={`cursor-pointer rounded-xl border p-4 transition-all ${
            statusFilter === 'Claim In Review'
              ? 'border-purple-500 bg-purple-50/50 dark:border-purple-500/80 dark:bg-purple-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">Claims in Review</span>
            <Wrench className="h-4 w-4 text-purple-500" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400 font-mono">
            {stats.inClaim}
          </p>
          <span className="text-[11px] text-purple-600/80">Active workshop repairs</span>
        </div>

        {/* Expired / Renewal Pipeline */}
        <div
          onClick={() => setStatusFilter('Expired')}
          className={`cursor-pointer rounded-xl border p-4 transition-all col-span-2 sm:col-span-1 ${
            statusFilter === 'Expired'
              ? 'border-rose-500 bg-rose-50/50 dark:border-rose-500/80 dark:bg-rose-950/20'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Expired (AMC Opp.)</span>
            <XCircle className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-700 dark:text-slate-300 font-mono">
            {stats.expired}
          </p>
          <span className="text-[11px] text-slate-400">Eligible for paid AMC renewal</span>
        </div>
      </div>

      {/* Urgent Expiration Alert Carousel / Notice Banner */}
      {expiringSoonAlerts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 shadow-xs dark:border-amber-800/80 dark:bg-amber-950/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-amber-500/20 p-2 text-amber-700 dark:text-amber-300 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100 flex items-center gap-2">
                  Warranty Expiration Notice ({expiringSoonAlerts.length} Units Expiring Within 30 Days)
                </h3>
                <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                  Proactively notify customers via WhatsApp or Email to schedule pre-expiration warranty checkups and offer extended AMC coverage before seasonal farming operations commence.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter('Expiring Soon')}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 cursor-pointer shadow-2xs transition-colors"
              >
                View All {expiringSoonAlerts.length} Alerts
              </button>
            </div>
          </div>

          {/* Quick Alert Ticker for Urgent Units */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {expiringSoonAlerts.slice(0, 3).map((w) => {
              const validity = getWarrantyValidityInfo(w.warrantyEndDate);
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-white/80 p-2.5 text-xs dark:border-amber-900/50 dark:bg-slate-900/80"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-slate-900 dark:text-white truncate">{w.productName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                        {w.serialNumber}
                      </span>
                      <span className="text-slate-400">•</span>
                      <span className="font-bold text-amber-700 dark:text-amber-400">
                        {validity.text}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">
                      Customer: {w.customerName}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => handleOpenAlertModal(w, 'WhatsApp')}
                      className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 cursor-pointer flex items-center gap-1"
                    >
                      <Send className="h-2.5 w-2.5" />
                      Alert WA
                    </button>
                    <button
                      onClick={() => dismissWarrantyAlert(w.id)}
                      className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer text-center"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search and filters: small controls in one row that wraps on narrow screens */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search Box */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Serial, chassis, engine, customer, product"
            aria-label="Search warranties"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {(['All', 'Active', 'Expiring Soon', 'Claim In Review', 'Expired'] as const).map((st) => {
            const isActive = statusFilter === st;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            );
          })}
        </div>

        {/* Branch */}
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          aria-label="Branch"
          className="h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="All">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {/* Coverage */}
        <select
          value={coverageFilter}
          onChange={(e) => setCoverageFilter(e.target.value)}
          aria-label="Coverage"
          className="h-8 w-auto max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="All">All coverages</option>
          <option value="Full Comprehensive">Full Comprehensive</option>
          <option value="Powertrain & Gearbox">Powertrain & Gearbox</option>
          <option value="Manufacturing Defects">Manufacturing Defects</option>
          <option value="Spares & Labor">Spares & Labor</option>
          <option value="Extended Warranty">Extended Warranty</option>
        </select>
      </div>

      {/* Warranties Master Data Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4">Serial & Identification</th>
                <th className="py-3 px-4">Agricultural Machinery / Model</th>
                <th className="py-3 px-4">Customer Profile (Linked)</th>
                <th className="py-3 px-4">Branch Depot</th>
                <th className="py-3 px-4">Warranty Period & Expiry</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Claims</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <ShieldCheck className="h-10 w-10 mx-auto text-slate-300 dark:text-slate-600 mb-2 stroke-1" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">No machinery warranties found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Try adjusting your search criteria or register a new machinery warranty.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredList.map((w) => {
                  const validity = getWarrantyValidityInfo(w.warrantyEndDate);
                  const isCopied = copiedSerial === w.serialNumber;
                  const hasClaims = (w.serviceRecords && w.serviceRecords.length > 0);

                  return (
                    <tr
                      key={w.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Serial & IDs */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-700 dark:text-blue-400 text-xs">
                            {w.serialNumber}
                          </span>
                          <button
                            onClick={() => handleCopySerial(w.serialNumber)}
                            title="Copy Serial Number"
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5"
                          >
                            {isCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                        <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                          Code: {w.warrantyCode}
                        </p>
                        {w.chassisNumber && (
                          <p className="text-[10px] text-slate-500 font-mono">
                            Chassis: {w.chassisNumber}
                          </p>
                        )}
                        {w.engineNumber && w.engineNumber !== 'N/A' && (
                          <p className="text-[10px] text-slate-500 font-mono">
                            Engine: {w.engineNumber}
                          </p>
                        )}
                      </td>

                      {/* Machinery Model */}
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900 dark:text-white">{w.productName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-500">{w.productSku}</span>
                          <span className="text-slate-300 dark:text-slate-700">•</span>
                          <span className="text-[10px] text-slate-500">{w.coverageType}</span>
                        </div>
                      </td>

                      {/* Customer Profile Link */}
                      <td className="py-3 px-4">
                        <div className="flex items-start justify-between gap-1">
                          <div>
                            <button
                              onClick={() => handleViewCustomerProfile(w.customerId)}
                              className="font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400 text-left cursor-pointer flex items-center gap-1 group"
                              title="Click to view Customer Profile & Ledger"
                            >
                              <span>{w.customerName}</span>
                              <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                            <p className="text-[10px] text-slate-400 mt-0.5">{w.customerPhone}</p>
                          </div>
                        </div>
                      </td>

                      {/* Branch */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {w.branchName || w.branchId}
                        </span>
                      </td>

                      {/* Period & Countdown */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold w-fit ${validity.badgeClass}`}
                          >
                            <Clock className="h-2.5 w-2.5" />
                            {validity.text}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {w.warrantyStartDate} to {w.warrantyEndDate} ({w.durationMonths}m)
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block text-[11px] font-bold ${
                            w.status === 'Active'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : w.status === 'Expiring Soon'
                              ? 'text-amber-800 dark:text-amber-300'
                              : w.status === 'Claim In Review'
                              ? 'text-purple-700 dark:text-purple-300'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {w.status}
                        </span>
                      </td>

                      {/* Claims History Count */}
                      <td className="py-3 px-4 text-center">
                        {hasClaims ? (
                          <button
                            onClick={() => setSelectedWarrantyDetails(w)}
                            className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 font-mono text-[11px] font-bold text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:text-purple-300 cursor-pointer"
                          >
                            <Wrench className="h-3 w-3" />
                            {w.serviceRecords.length} {w.serviceRecords.length === 1 ? 'Record' : 'Records'}
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Alert Button */}
                          <button
                            onClick={() => handleOpenAlertModal(w, 'WhatsApp')}
                            title="Send Expiration Alert / Notification to Customer"
                            className="rounded-md border border-amber-200 bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 cursor-pointer"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>

                          {/* Log Claim Button */}
                          <button
                            onClick={() => {
                              setWarrantyForClaim(w);
                              setIsClaimModalOpen(true);
                            }}
                            title="Log Service / Warranty Claim"
                            className="rounded-md border border-purple-200 bg-purple-50 p-1.5 text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300 cursor-pointer"
                          >
                            <Wrench className="h-3.5 w-3.5" />
                          </button>

                          <button
                            onClick={() => setWarrantyToDelete(w)}
                            title="Delete this warranty"
                            aria-label="Delete this warranty"
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-rose-950/40 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>

                          {/* Full Details Button */}
                          <button
                            onClick={() => setSelectedWarrantyDetails(w)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                          >
                            Details
                          </button>
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

      {/* ======================================================== */}
      {/* 1. REGISTER NEW MACHINERY WARRANTY MODAL                 */}
      {/* ======================================================== */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Register Agricultural Machinery Warranty
                  </h3>
                  <p className="text-xs text-slate-500">
                    Assign serial number, engine/chassis codes, and configure manufacturer warranty coverage.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterWarranty} className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Customer & Branch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Customer / Dealer / FPO <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.customerId}
                    onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select Customer / Buyer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName} ({c.name} • {c.city})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Issuing Branch Depot <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.branchId}
                    onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.city})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Model */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Equipment / Implement Model <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.productId}
                  onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Select Agricultural Machinery / Assembly</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.sku}] - {p.category}
                    </option>
                  ))}
                </select>
              </div>

              {/* Serials: Machine S/N, Chassis, Engine */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/20">
                <div>
                  <label className="font-bold text-blue-900 dark:text-blue-200">
                    Machine Serial # <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    placeholder="e.g. ROT-7FT-99120"
                    className="mt-1 w-full rounded-lg border border-blue-200 bg-white p-2 font-mono text-xs uppercase dark:border-blue-800 dark:bg-slate-900 dark:text-white"
                  />
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">Primary serial plate</p>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Chassis / Frame Serial
                  </label>
                  <input
                    type="text"
                    value={formData.chassisNumber}
                    onChange={(e) => setFormData({ ...formData, chassisNumber: e.target.value })}
                    placeholder="e.g. CHS-2026-081"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Implement chassis frame</p>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Engine Serial (if powered)
                  </label>
                  <input
                    type="text"
                    value={formData.engineNumber}
                    onChange={(e) => setFormData({ ...formData, engineNumber: e.target.value })}
                    placeholder="e.g. ENG-KIR-8HP-441"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Diesel engine / prime mover</p>
                </div>
              </div>

              {/* Purchase Date, Duration, Coverage */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Commissioning / Purchase Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.purchaseDate}
                    onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Duration (Months)
                  </label>
                  <select
                    value={formData.durationMonths}
                    onChange={(e) => setFormData({ ...formData, durationMonths: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value={6}>6 Months (Standard Season)</option>
                    <option value={12}>12 Months (1 Full Year)</option>
                    <option value={24}>24 Months (2 Years Commercial)</option>
                    <option value={36}>36 Months (3 Years Fleet Plan)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Coverage Scope
                  </label>
                  <select
                    value={formData.coverageType}
                    onChange={(e) => setFormData({ ...formData, coverageType: e.target.value as any })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Full Comprehensive">Full Comprehensive</option>
                    <option value="Powertrain & Gearbox">Powertrain & Gearbox</option>
                    <option value="Manufacturing Defects">Manufacturing Defects</option>
                    <option value="Spares & Labor">Spares & Labor</option>
                    <option value="Extended Warranty">Extended Warranty</option>
                  </select>
                </div>
              </div>

              {/* Linked Invoice & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Link Tax Invoice (Optional)
                  </label>
                  <select
                    value={formData.invoiceId}
                    onChange={(e) => setFormData({ ...formData, invoiceId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select Billed Invoice</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} - {inv.customerName} ({currency}{inv.grandTotal.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Special Warranty Terms / Notes
                  </label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="e.g. Free 1st gearbox oil replacement at 50 operating hours"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4 flex justify-end gap-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 shadow-xs cursor-pointer"
                >
                  Confirm & Register Warranty
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. LOG SERVICE CLAIM MODAL                               */}
      {/* ======================================================== */}
      {isClaimModalOpen && warrantyForClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Log Service Claim: S/N {warrantyForClaim.serialNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {warrantyForClaim.productName} • {warrantyForClaim.customerName}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsClaimModalOpen(false);
                  setWarrantyForClaim(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitClaim} className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Reported Issue / Defect Description <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={claimData.issueDescription}
                  onChange={(e) => setClaimData({ ...claimData, issueDescription: e.target.value })}
                  placeholder="e.g. Gearbox side oil seal leakage during paddy field cultivation; hydraulic cylinder piston seal weeping"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Attending Technician / Engineer
                  </label>
                  <input
                    type="text"
                    value={claimData.technicianName}
                    onChange={(e) => setClaimData({ ...claimData, technicianName: e.target.value })}
                    placeholder="e.g. V. Murugan (Sr. Tech)"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Estimated / Actual Claim Cost ({currency})
                  </label>
                  <input
                    type="number"
                    value={claimData.claimCost}
                    onChange={(e) => setClaimData({ ...claimData, claimCost: Number(e.target.value) })}
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Parts Replaced / Requisitioned (Comma-separated)
                </label>
                <input
                  type="text"
                  value={claimData.replacedParts}
                  onChange={(e) => setClaimData({ ...claimData, replacedParts: e.target.value })}
                  placeholder="e.g. NBR Oil Seal 55x72x10, Bevel Pinion Shim Pack"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Initial Claim Status
                </label>
                <select
                  value={claimData.status}
                  onChange={(e) => setClaimData({ ...claimData, status: e.target.value as any })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Submitted">Submitted (Awaiting Factory Inspection)</option>
                  <option value="In Repair">In Repair (Work in Progress at Branch)</option>
                  <option value="Approved">Approved</option>
                  <option value="Resolved">Resolved & Closed</option>
                </select>
              </div>

              <div className="border-t border-slate-200 pt-4 flex justify-end gap-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsClaimModalOpen(false);
                    setWarrantyForClaim(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-purple-600 px-4 py-2 font-bold text-white hover:bg-purple-700 shadow-xs cursor-pointer"
                >
                  Record Claim
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. SEND EXPIRATION ALERT MODAL                           */}
      {/* ======================================================== */}
      {isAlertModalOpen && warrantyForAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <Send className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Send Warranty Expiration Notice
                  </h3>
                  <p className="text-xs text-slate-500">
                    To: {warrantyForAlert.customerName} ({warrantyForAlert.customerPhone})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAlertModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Channel Selector */}
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Dispatch Channel:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAlertChannel('WhatsApp')}
                    className={`rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      alertChannel === 'WhatsApp'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <Send className="h-3 w-3" />
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlertChannel('Email')}
                    className={`rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      alertChannel === 'Email'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <Mail className="h-3 w-3" />
                    Email
                  </button>
                </div>
              </div>

              {/* Message Preview */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Message Draft:
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(alertMessage);
                        showToast('Copied', 'Alert text copied.', 'info');
                      }
                    }}
                    className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                  >
                    Copy Text
                  </button>
                </div>
                <textarea
                  rows={9}
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 focus:bg-white focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="border-t border-slate-200 pt-4 flex justify-end gap-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAlertModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDispatchAlert}
                  className={`rounded-lg px-4 py-2 font-bold text-white shadow-xs cursor-pointer flex items-center gap-1.5 ${
                    alertChannel === 'WhatsApp' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  Dispatch via {alertChannel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. WARRANTY DETAILS & SERVICE HISTORY DRAWER/MODAL       */}
      {/* ======================================================== */}
      {warrantyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Delete warranty</h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              Delete the warranty <strong>{warrantyToDelete.warrantyCode}</strong> for {warrantyToDelete.productName} (S/N{' '}
              {warrantyToDelete.serialNumber}, {warrantyToDelete.customerName})? Its service records are removed too. This cannot be undone.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setWarrantyToDelete(null)}
                className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Keep
              </button>
              <button
                onClick={() => {
                  deleteWarranty(warrantyToDelete.id);
                  if (selectedWarrantyDetails?.id === warrantyToDelete.id) setSelectedWarrantyDetails(null);
                  setWarrantyToDelete(null);
                }}
                className="cursor-pointer rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedWarrantyDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 font-bold">
                  {selectedWarrantyDetails.warrantyCode}
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {selectedWarrantyDetails.productName}
                </h3>
                <p className="text-xs text-slate-500">
                  Serial Number: {selectedWarrantyDetails.serialNumber}
                </p>
              </div>
              <button
                onClick={() => setSelectedWarrantyDetails(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Equipment & Serial Specs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Machine S/N</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {selectedWarrantyDetails.serialNumber}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Chassis / Frame</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {selectedWarrantyDetails.chassisNumber || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Engine Code</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {selectedWarrantyDetails.engineNumber || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Coverage Type</span>
                  <p className="font-bold text-blue-600 dark:text-blue-400">
                    {selectedWarrantyDetails.coverageType}
                  </p>
                </div>
              </div>

              {/* Customer Profile Link Card */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-blue-600" />
                    <span className="font-bold text-blue-900 dark:text-blue-200">
                      Registered Customer Profile
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const custId = selectedWarrantyDetails.customerId;
                      setSelectedWarrantyDetails(null);
                      handleViewCustomerProfile(custId);
                    }}
                    className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 cursor-pointer flex items-center gap-1"
                  >
                    View Customer Profile & Ledger
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px]">Company / Name:</span>
                    <p className="font-semibold text-slate-900 dark:text-white">{selectedWarrantyDetails.customerName}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">Contact Phone:</span>
                    <p className="font-semibold text-slate-900 dark:text-white">{selectedWarrantyDetails.customerPhone}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">Email:</span>
                    <p className="font-semibold text-slate-900 dark:text-white">{selectedWarrantyDetails.customerEmail || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Service & Claim Records */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-purple-600" />
                    Service History & Defect Claims ({selectedWarrantyDetails.serviceRecords?.length || 0})
                  </h4>
                  <button
                    onClick={() => {
                      setWarrantyForClaim(selectedWarrantyDetails);
                      setIsClaimModalOpen(true);
                    }}
                    className="rounded bg-purple-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-purple-700 cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    File New Claim
                  </button>
                </div>

                {(!selectedWarrantyDetails.serviceRecords || selectedWarrantyDetails.serviceRecords.length === 0) ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-800/40">
                    No warranty claims or service records filed for this serial number.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedWarrantyDetails.serviceRecords.map((rec) => (
                      <div
                        key={rec.id}
                        className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800 bg-white dark:bg-slate-800/40"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[11px] text-slate-500">
                                {rec.claimDate}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  rec.status === 'Resolved'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : rec.status === 'In Repair'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                }`}
                              >
                                {rec.status}
                              </span>
                            </div>
                            <p className="font-semibold text-slate-900 dark:text-white mt-1">
                              {rec.issueDescription}
                            </p>
                            {rec.resolutionNotes && (
                              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                Resolution: {rec.resolutionNotes}
                              </p>
                            )}
                          </div>

                          <div className="text-right">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {currency}{rec.claimCost.toLocaleString()}
                            </span>
                            <p className="text-[10px] text-slate-400">Tech: {rec.technicianName}</p>
                          </div>
                        </div>

                        {rec.replacedParts && rec.replacedParts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {rec.replacedParts.map((p, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-4 text-right dark:border-slate-800 dark:bg-slate-800/50">
              <button
                onClick={() => setSelectedWarrantyDetails(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-indigo-600 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. CUSTOMER QUICK PROFILE MODAL (DIRECT LINK TARGET)     */}
      {/* ======================================================== */}
      {customerModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {customerModalData.companyName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Contact: {customerModalData.name} • {customerModalData.phone} • {customerModalData.city}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCustomerModalData(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Financial Snapshot */}
              <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3.5 text-center dark:bg-slate-800/60">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Credit Limit</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                    {currency}{customerModalData.creditLimit.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Current Balance</span>
                  <p className="font-mono font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                    {currency}{customerModalData.outstandingBalance.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Total Purchases</span>
                  <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {currency}{customerModalData.totalSales.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* All Machinery Registered to This Customer */}
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    Machinery & Serial Numbers Registered to this Account
                  </span>
                  <span className="font-mono text-xs text-blue-600">
                    {warranties.filter((w) => w.customerId === customerModalData.id).length} Equipment Units
                  </span>
                </h4>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden dark:divide-slate-800 dark:border-slate-800">
                  {warranties.filter((w) => w.customerId === customerModalData.id).length === 0 ? (
                    <p className="p-4 text-center text-slate-400">
                      No serial numbers registered under this customer account.
                    </p>
                  ) : (
                    warranties
                      .filter((w) => w.customerId === customerModalData.id)
                      .map((w) => {
                        const validity = getWarrantyValidityInfo(w.warrantyEndDate);
                        return (
                          <div
                            key={w.id}
                            className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                                  {w.serialNumber}
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                    validity.isExpired
                                      ? 'bg-rose-100 text-rose-700'
                                      : validity.isExpiringSoon
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {validity.text}
                                </span>
                              </div>
                              <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                                {w.productName}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                Valid until: {w.warrantyEndDate} • {w.coverageType}
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setCustomerModalData(null);
                                setSelectedWarrantyDetails(w);
                              }}
                              className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                            >
                              Inspect S/N
                            </button>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-4 flex justify-between items-center dark:border-slate-800 dark:bg-slate-800/50">
              <button
                onClick={() => {
                  setCustomerModalData(null);
                  setCurrentView('customers');
                }}
                className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
              >
                Go to Full Customer Directory →
              </button>
              <button
                onClick={() => setCustomerModalData(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-indigo-600 cursor-pointer"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
