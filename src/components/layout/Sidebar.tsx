import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Boxes,
  ArrowLeftRight,
  Building2,
  Users,
  Truck,
  Wallet,
  BarChart3,
  UserCheck,
  Settings,
  History,
  ShieldCheck,
  BookOpen,
  Zap,
  PhoneCall,
  SlidersHorizontal,
  PackageCheck,
  Tractor,
  PackagePlus,
  Landmark,
  Wrench,
  MessageCircle,
  Store,
  CalendarCheck,
  Banknote,
  FilePlus2,
  UserPlus,
  Undo2,
  Sparkles,
  Briefcase
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { usePendingAccessCount } from '../../hooks/usePendingAccessCount';
import { ViewType } from '../../types/erp';
import { canSeeAccessRequests, canSeeInsights, canSeePredictions, canUseAttendance, canUseInvoices } from '../../utils/access';

interface NavSection {
  title: string;
  items: {
    id: ViewType;
    label: string;
    icon: React.ElementType;
    badge?: number | string;
    badgeColor?: string;
    highlight?: boolean;
  }[];
}

export const Sidebar: React.FC = () => {
  const {
    currentView,
    setCurrentView,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    salesOrders,
    stockTransfers,
    currentUser,
    currentRole,
    currentBranchName,
    auditLogs,
    expiringWarrantiesCount
  } = useERP();

  const { isSuperAdmin } = useAuth();

  // People who work in a branch (or the Head Office store) are shown by their branch, never by their own name.
  const isBranchStaff = currentRole === 'Branch Person' || currentRole === 'Branch Manager';
  const footerName = isBranchStaff ? currentBranchName : currentUser.name;
  const pendingAccessCount = usePendingAccessCount();

  // Below the lg breakpoint the sidebar becomes a slide-in drawer instead of squeezing the page.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (isMobile) setIsSidebarCollapsed(true);
  }, [isMobile]);
  const compact = isSidebarCollapsed && !isMobile;
  const drawerOpen = isMobile && !isSidebarCollapsed;

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const isBranchUser = !isOwner;

  const pendingSalesCount = salesOrders.filter(s => s.status === 'Confirmed' || s.status === 'Draft').length;
  const inTransitTransferCount = stockTransfers.filter(t => t.status === 'In Transit' || t.status === 'Requested').length;

  const accessItems = canSeeAccessRequests(isSuperAdmin, currentRole)
    ? [{
        id: 'access-requests' as ViewType,
        label: 'Access Requests',
        icon: UserPlus,
        badge: pendingAccessCount > 0 ? pendingAccessCount : undefined,
        badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      }]
    : [];

  const navSections: NavSection[] = isBranchUser
    ? [
        {
          title: '',
          items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'desk', label: 'Business Desk', icon: Briefcase }, { id: 'predictions', label: 'Predictions', icon: Sparkles }]
        },
        {
          title: 'Sell',
          items: [
            { id: 'quick-sale', label: 'Quick Sale', icon: Zap, highlight: true },
            { id: 'documents', label: 'Invoices & Quotations', icon: FilePlus2 },
            { id: 'machine-sales', label: 'Machine Sales', icon: Tractor },
            { id: 'returns', label: 'Return Product', icon: Undo2 },
            { id: 'customers', label: 'Customers', icon: Users },
            { id: 'follow-ups', label: 'Follow-ups', icon: PhoneCall }
          ]
        },
        {
          title: 'Stock & Money',
          items: [
            { id: 'inventory', label: 'Inventory', icon: Boxes },
            { id: 'finance', label: 'Ledger & Cash Book', icon: Wallet },
            { id: 'history', label: 'History', icon: History },
            { id: 'reports', label: 'Insights', icon: BarChart3 }
          ]
        },
        {
          title: 'Service & Staff',
          items: [
            { id: 'job-cards', label: 'Service Job Cards', icon: Wrench },
            { id: 'attendance', label: 'Staff Attendance & Directory', icon: CalendarCheck },
            ...(currentRole === 'Accountant' ? [{ id: 'payroll' as ViewType, label: 'Payroll & Salary', icon: Banknote }] : []),
            { id: 'messages', label: 'WhatsApp Messages', icon: MessageCircle }
          ]
        },
        ...(accessItems.length ? [{ title: 'Admin', items: accessItems }] : [])
      ]
    : [
        {
          title: '',
          items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'desk', label: 'Business Desk', icon: Briefcase }, { id: 'predictions', label: 'Predictions', icon: Sparkles }]
        },
        {
          title: 'Sell',
          items: [
            { id: 'quick-sale', label: 'Quick Sale', icon: Zap },
            { id: 'documents', label: 'Invoices & Quotations', icon: FilePlus2 },
            { id: 'machine-sales', label: 'Machine Sales', icon: Tractor },
            { id: 'returns', label: 'Return Product', icon: Undo2 },
            { id: 'customers', label: 'Customers', icon: Users }
          ]
        },
        {
          title: 'Stock',
          items: [
            { id: 'inventory', label: 'Inventory', icon: Boxes },
            { id: 'spare-books', label: 'Spare Books', icon: BookOpen },
            { id: 'stock-transfers', label: 'Stock Transfer & Ledger', icon: ArrowLeftRight, badge: inTransitTransferCount, badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300' },
          ]
        },
        {
          title: 'Money',
          items: [
            { id: 'finance', label: 'Ledger & Cash Book', icon: Wallet },
            { id: 'history', label: 'History', icon: History },
            { id: 'payroll', label: 'Payroll & Salary', icon: Banknote },
            { id: 'reports', label: 'Reports & Insights', icon: BarChart3 }
          ]
        },
        {
          title: 'Service & Staff',
          items: [
            { id: 'job-cards', label: 'Service Job Cards', icon: Wrench },
            { id: 'warranties', label: 'Warranty', icon: ShieldCheck, badge: expiringWarrantiesCount > 0 ? `${expiringWarrantiesCount} alert` : undefined, badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
            { id: 'messages', label: 'WhatsApp Messages', icon: MessageCircle },
            { id: 'attendance', label: 'Staff Attendance & Directory', icon: CalendarCheck },
            { id: 'employees', label: 'Staff Directory', icon: UserCheck }
          ]
        },
        {
          title: 'Admin',
          items: [
            ...accessItems,
            { id: 'branches', label: 'Branches', icon: Store },
            { id: 'settings', label: 'Control Center', icon: SlidersHorizontal },
            { id: 'activity-logs', label: 'Activity Logs', icon: History }
          ]
        }
      ];

  // Invoices & Quotations and Staff Attendance are only for Super Admin, owner and branch manager.
  const hiddenIds: string[] = [];
  if (!canUseInvoices(currentRole)) hiddenIds.push('documents');
  // People who can use attendance get the directory inside it; everyone else keeps the plain directory entry.
  if (!canUseAttendance(currentRole)) hiddenIds.push('attendance');
  else hiddenIds.push('employees');
  if (!canSeeInsights(currentRole)) hiddenIds.push('reports');
  if (!canSeePredictions(isSuperAdmin, currentRole)) hiddenIds.push('predictions');
  const visibleSections = hiddenIds.length
    ? navSections
        .map((sec) => ({ ...sec, items: sec.items.filter((i) => !hiddenIds.includes(i.id)) }))
        .filter((sec) => sec.items.length > 0)
    : navSections;

  return (
    <>
    {drawerOpen && (
      <div className="fixed inset-0 z-30 bg-slate-900/50 xl:hidden" onClick={() => setIsSidebarCollapsed(true)} aria-hidden="true" />
    )}
    <aside
      className={`flex flex-col shrink-0 border-r border-white/60 bg-white/65 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_-1px_0_0_rgba(255,255,255,0.7),6px_0_30px_-12px_rgba(30,41,90,0.18)] transition-all duration-300 ease-in-out dark:border-white/10 dark:bg-slate-900/65 dark:shadow-[inset_-1px_0_0_rgba(255,255,255,0.06),6px_0_30px_-12px_rgba(0,0,0,0.5)] h-full ${
        isMobile
          ? `fixed inset-y-0 left-0 z-40 w-64 shadow-xl ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`
          : `relative z-[35] ${compact ? 'w-18' : 'w-64'}`
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm text-white font-bold shadow-md ring-1 ring-white/20">
            PS
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-white truncate block">
                ACME <span className="text-blue-600">AGRO</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-3">
        {visibleSections.map((sec, secIndex) => (
          <div key={sec.title || `section-${secIndex}`} className="space-y-0.5">
            {!compact && sec.title && (
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-1 select-none">
                {sec.title}
              </div>
            )}
            {sec.items.map((item) => {
              const Icon = item.icon;
              const isActive =
                currentView === item.id ||
                (item.id === 'stock-transfers' && (currentView === 'transfers' || currentView === 'stock-ledger')) ||
                (item.id === 'attendance' && currentView === 'employees') ||
                (item.id === 'inventory' && currentView === 'warehouses') ||
                (item.id === 'finance' && currentView === 'cash-book');

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setCurrentView(item.id);
                    if (isMobile) setIsSidebarCollapsed(true);
                  }}
                  title={compact ? item.label : undefined}
                  className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200 cursor-pointer ${
                    item.highlight
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-md shadow-blue-600/20 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg active:scale-98'
                      : isActive
                      ? 'bg-gradient-to-r from-blue-50 to-blue-50/40 text-blue-700 font-semibold shadow-2xs dark:from-blue-950/70 dark:to-blue-950/20 dark:text-blue-300'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 hover:translate-x-0.5 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >

                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      item.highlight
                        ? 'text-white'
                        : isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                    }`}
                  />

                  {!compact && (
                    <div className="flex flex-1 items-center justify-between overflow-hidden">
                      <span className="truncate">{item.label}</span>
                      {item.badge !== undefined && Number(item.badge) > 0 && (
                        <span className={`ml-2 rounded-full px-1.5 py-0.2 font-mono text-[10px] font-bold ${item.badgeColor}`}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Tooltip for collapsed state */}
                  {compact && (
                    <div className="pointer-events-none absolute left-full ml-2 hidden rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md group-hover:block dark:bg-slate-800 z-50 whitespace-nowrap">
                      {item.label}
                      {item.badge !== undefined && Number(item.badge) > 0 && ` (${item.badge})`}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Info Bottom Strip */}
      <div className="shrink-0 p-3 border-t border-slate-100 dark:border-slate-800">
        <div
          onClick={() => setCurrentView('employees')}
          className="flex items-center gap-3 p-2 hover:bg-slate-100/80 dark:hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 ring-2 ring-white dark:ring-slate-900 dark:from-blue-900/60 dark:to-indigo-900/60 flex items-center justify-center font-bold text-xs text-blue-700 dark:text-blue-300 shrink-0 shadow-xs">
            {footerName.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {footerName}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {currentRole}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
    </>
  );
};
