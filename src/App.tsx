import React, { Suspense, lazy, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { AuthGate } from './components/auth/AuthGate';
import { ERPProvider, useERP } from './context/ERPContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ResponsiveTables } from './components/layout/ResponsiveTables';
import { GlobalSearchModal } from './components/common/GlobalSearchModal';
import { NotificationDrawer } from './components/common/NotificationDrawer';
import { QuickAddModal } from './components/common/QuickAddModal';
import { InvoicePrintModal } from './components/common/InvoicePrintModal';
import { ToastContainer } from './components/common/ToastContainer';
import { AppUpdater } from './components/common/AppUpdater';
import { useAuth } from './context/AuthContext';
import { canSeeAccessRequests, canSeeInsights, canSeePredictions, canUseAttendance, canUseInvoices } from './utils/access';

// Views
// The dashboard carries the chart library, so it loads like the other pages and the sign-in and shell appear first.
const loadDashboardView = () => import('./components/views/DashboardView').then((m) => ({ default: m.DashboardView }));
const DashboardView = lazy(loadDashboardView);
// Start fetching the dashboard now, in parallel with sign-in, so it is ready the moment the profile loads.
void loadDashboardView().catch(() => {});
import { PendingFollowUpsModule } from './components/dashboard/PendingFollowUpsModule';

// Pages load when first opened, so the first screen is quick; the rest are fetched quietly once the app is idle.
const loadStockMovementView = () => import('./components/views/StockMovementView').then((m) => ({ default: m.StockMovementView }));
const StockMovementView = lazy(loadStockMovementView);
const loadMachineSalesView = () => import('./components/views/MachineSalesView').then((m) => ({ default: m.MachineSalesView }));
const MachineSalesView = lazy(loadMachineSalesView);
const loadInventoryWarehouseView = () => import('./components/views/InventoryWarehouseView').then((m) => ({ default: m.InventoryWarehouseView }));
const InventoryWarehouseView = lazy(loadInventoryWarehouseView);
const loadBranchesView = () => import('./components/views/BranchesView').then((m) => ({ default: m.BranchesView }));
const BranchesView = lazy(loadBranchesView);
const loadCustomersView = () => import('./components/views/CustomersView').then((m) => ({ default: m.CustomersView }));
const CustomersView = lazy(loadCustomersView);
const loadHistoryView = () => import('./components/views/HistoryView').then((m) => ({ default: m.HistoryView }));
const HistoryView = lazy(loadHistoryView);
const loadFinanceHubView = () => import('./components/views/FinanceHubView').then((m) => ({ default: m.FinanceHubView }));
const FinanceHubView = lazy(loadFinanceHubView);
const loadReportsView = () => import('./components/views/ReportsView').then((m) => ({ default: m.ReportsView }));
const ReportsView = lazy(loadReportsView);
const loadEmployeesView = () => import('./components/views/EmployeesView').then((m) => ({ default: m.EmployeesView }));
const EmployeesView = lazy(loadEmployeesView);
const loadActivityLogsView = () => import('./components/views/ActivityLogsView').then((m) => ({ default: m.ActivityLogsView }));
const ActivityLogsView = lazy(loadActivityLogsView);
const loadSettingsView = () => import('./components/views/SettingsView').then((m) => ({ default: m.SettingsView }));
const SettingsView = lazy(loadSettingsView);
const loadWarrantyView = () => import('./components/views/WarrantyView').then((m) => ({ default: m.WarrantyView }));
const WarrantyView = lazy(loadWarrantyView);
const loadSpareBooksView = () => import('./components/views/SpareBooksView').then((m) => ({ default: m.SpareBooksView }));
const SpareBooksView = lazy(loadSpareBooksView);
const loadQuickSaleView = () => import('./components/views/QuickSaleView').then((m) => ({ default: m.QuickSaleView }));
const QuickSaleView = lazy(loadQuickSaleView);
const loadJobCardsView = () => import('./components/views/JobCardsView').then((m) => ({ default: m.JobCardsView }));
const JobCardsView = lazy(loadJobCardsView);
const loadMessagesView = () => import('./components/views/MessagesView').then((m) => ({ default: m.MessagesView }));
const MessagesView = lazy(loadMessagesView);
const loadReturnsView = () => import('./components/views/ReturnsView').then((m) => ({ default: m.ReturnsView }));
const ReturnsView = lazy(loadReturnsView);
const loadPredictionsView = () => import('./components/views/PredictionsView').then((m) => ({ default: m.PredictionsView }));
const PredictionsView = lazy(loadPredictionsView);
const loadBusinessDeskView = () => import('./components/views/BusinessDeskView').then((m) => ({ default: m.BusinessDeskView }));
const BusinessDeskView = lazy(loadBusinessDeskView);
const loadAttendanceView = () => import('./components/views/AttendanceView').then((m) => ({ default: m.AttendanceView }));
const AttendanceView = lazy(loadAttendanceView);
const loadPayrollView = () => import('./components/views/PayrollView').then((m) => ({ default: m.PayrollView }));
const PayrollView = lazy(loadPayrollView);
const loadDocumentsView = () => import('./components/views/DocumentsView').then((m) => ({ default: m.DocumentsView }));
const DocumentsView = lazy(loadDocumentsView);
const loadAccessRequestsView = () => import('./components/views/AccessRequestsView').then((m) => ({ default: m.AccessRequestsView }));
const AccessRequestsView = lazy(loadAccessRequestsView);

const prefetchViews = [
  loadStockMovementView,
  loadMachineSalesView,
  loadInventoryWarehouseView,
  loadBranchesView,
  loadCustomersView,
  loadFinanceHubView,
  loadReportsView,
  loadEmployeesView,
  loadActivityLogsView,
  loadSettingsView,
  loadWarrantyView,
  loadSpareBooksView,
  loadQuickSaleView,
  loadJobCardsView,
  loadMessagesView,
  loadReturnsView,
  loadPredictionsView,
  loadBusinessDeskView,
  loadAttendanceView,
  loadPayrollView,
  loadDocumentsView,
  loadAccessRequestsView
];

// Shown while a screen's code loads: a soft outline of a page instead of bare text.
const ViewLoading: React.FC = () => (
  <div className="space-y-4" role="status" aria-label="Loading">
    <div className="skeleton h-7 w-56" />
    <div className="skeleton h-3.5 w-80 max-w-full" />
    <div className="grid grid-cols-2 gap-3 pt-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-24 rounded-xl" />
      ))}
    </div>
    <div className="skeleton h-64 w-full rounded-xl" />
  </div>
);

export const MainLayout: React.FC = () => {
  const { currentView, isSidebarCollapsed, currentRole } = useERP();
  const { isSuperAdmin } = useAuth();

  useEffect(() => {
    const warm = () => prefetchViews.forEach((load) => void load().catch(() => undefined));
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 8000 });
    else setTimeout(warm, 4000);
  }, []);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'quick-sale':
        return <QuickSaleView />;
      case 'spare-books':
        return <SpareBooksView />;
      case 'follow-ups':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Customer Payment Follow-ups</h1>
              <p className="text-xs text-slate-500">Track pending receivables, schedule reminder phone calls and record customer collections.</p>
            </div>
            <PendingFollowUpsModule />
          </div>
        );
      case 'machine-sales':
        return <MachineSalesView />;
      case 'stock-ledger':
        return <StockMovementView />;
      case 'inventory':
      case 'warehouses':
        return <InventoryWarehouseView />;
      case 'stock-transfers':
      case 'transfers':
        return <StockMovementView />;
      case 'warranties':
        return <WarrantyView />;
      case 'branches':
        return <BranchesView />;
      case 'customers':
        return <CustomersView />;
      case 'finance':
      case 'cash-book':
        return <FinanceHubView />;
      case 'history':
        return <HistoryView />;
      case 'reports':
        return canSeeInsights(currentRole) ? <ReportsView /> : <DashboardView />;
      case 'employees':
        // The directory lives inside Staff Attendance for those who can use it.
        return canUseAttendance(currentRole) ? <AttendanceView key="employees" initialTab="roster" /> : <EmployeesView />;
      case 'activity-logs':
        return <ActivityLogsView />;
      case 'settings':
        return <SettingsView />;
      case 'job-cards':
        return <JobCardsView />;
      case 'messages':
        return <MessagesView />;
      case 'returns':
        return <ReturnsView />;
      case 'predictions':
        return canSeePredictions(isSuperAdmin, currentRole) ? <PredictionsView /> : <DashboardView />;
      case 'desk':
        return <BusinessDeskView />;
      case 'attendance':
        return canUseAttendance(currentRole) ? <AttendanceView /> : <DashboardView />;
      case 'payroll':
        return <PayrollView />;
      case 'sales':
      case 'billing':
      case 'documents':
        return canUseInvoices(currentRole) ? <DocumentsView /> : <DashboardView />;
      case 'access-requests':
        return canSeeAccessRequests(isSuperAdmin, currentRole) ? <AccessRequestsView /> : <DashboardView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      {/* Liquid glass: soft colour behind the panels */}
      <div className="glass-backdrop no-print" aria-hidden="true">
        <i />
      </div>
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main App Container */}
      {/* No z-index here: a layer would trap every pop-up window below the side menu */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Scrollable Workspace */}
        <main className="flex-1 overflow-y-auto p-4 pb-6 sm:p-6 lg:p-8">
          <div key={currentView} className="page-enter mx-auto max-w-7xl">
            <Suspense fallback={<ViewLoading />}>{renderView()}</Suspense>
          </div>
        </main>
      </div>

      <ResponsiveTables />

      {/* Global Modals & Notifications */}
      <GlobalSearchModal />
      <NotificationDrawer />
      <QuickAddModal />
      <InvoicePrintModal />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <ERPProvider>
          <MainLayout />
        </ERPProvider>
      </AuthGate>
      {/* Outside the sign-in gate, so the sign-in screen is kept up to date too */}
      <AppUpdater />
    </AuthProvider>
  );
}
