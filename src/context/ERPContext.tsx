import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { markStartup } from '../utils/startupTiming';
import {
  Role,
  ViewType,
  Product,
  ProductCategory,
  Branch,
  Warehouse,
  Customer,
  Supplier,
  SalesOrder,
  SalesOrderStatus,
  Invoice,
  GoodsReceivedNote,
  StockTransfer,
  StockAdjustment,
  StockMovement,
  ContractorProject,
  ProjectTask,
  ProjectMilestone,
  ProjectMaterialIssue,
  PaymentReceipt,
  Expense,
  ChartOfAccount,
  AccountLedgerEntry,
  EmployeeUser,
  ERPNotification,
  ActivityAuditLog,
  CompanySettings,
  InvoiceFollowUpReminder,
  ProductWarranty,
  WarrantyServiceRecord,
  WarrantyStatus,
  Sale,
  SaleItem,
  OrderItem
} from '../types/erp';
import { recordMultiItemSaleApi, getSqlProducts, createSqlProduct, patchSqlProduct, bulkPatchSqlProducts, bulkDeleteSqlProducts, getSqlCustomers, createSqlCustomer, deleteSqlCustomer, updateSqlCustomer, getSqlBranches, updateSqlBranch } from '../services/api';
import type { ApiScope } from '../services/apiClient';
import {
  createReceiptApi,
  listReceiptsApi,
  createTransferApi,
  listTransfersApi,
  approveTransferApi,
  dispatchTransferApi,
  receiveTransferApi,
  cancelTransferApi,
  createAdjustmentApi,
  listAdjustmentsApi,
  StockTransferInput,
  DispatchDetails,
  ReceiveItemInput,
  StockAdjustmentInput
} from '../services/stockApi';
import {
  initialCompanySettings,
  initialBranches,
  initialWarehouses,
  initialCustomers,
  initialSuppliers,
  initialSalesOrders,
  initialInvoices,
  initialProjects,
  initialPayments,
  initialExpenses,
  initialChartOfAccounts,
  initialLedgerEntries,
  initialEmployees,
  initialNotifications,
  initialAuditLogs,
  initialWarranties
} from '../data/mockData';
import {
  saveFirestoreDoc,
  deleteFirestoreDoc,
  subscribeToCollection,
  seedInitialFirestoreData
} from '../lib/firestoreService';
import { useAuth } from './AuthContext';
import { getAppSettings, saveAppSettings } from '../services/appSettingsApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
}

interface ERPContextType {
  // Navigation & Preferences
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedBranchId: string; // 'all' or branch-id
  setSelectedBranchId: (branchId: string) => void;
  selectedWarehouseId: string; // 'all' or wh-id
  setSelectedWarehouseId: (whId: string) => void;
  currentUser: EmployeeUser;
  setCurrentUser: (user: EmployeeUser) => void;
  currentRole: Role;
  setCurrentRole: (role: Role) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Search & Modal Overlays
  isGlobalSearchOpen: boolean;
  setIsGlobalSearchOpen: (open: boolean) => void;
  isQuickAddOpen: boolean;
  setIsQuickAddOpen: (open: boolean) => void;
  quickAddInitialTab?: string;
  openQuickAdd: (tab?: string) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (open: boolean) => void;
  activeInvoiceForPrint: Invoice | null;
  setActiveInvoiceForPrint: (invoice: Invoice | null) => void;

  // Toasts
  toasts: ToastMessage[];
  showToast: (title: string, message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  dismissToast: (id: string) => void;

  // Cloud Firestore Sync
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
  isFirestoreConnected: boolean;
  syncNowToFirestore: () => Promise<void>;

  // Data Stores
  settings: CompanySettings;
  updateSettings: (newSettings: Partial<CompanySettings>) => void;
  branches: Branch[];
  warehouses: Warehouse[];
  products: Product[];
  // items that are not archived: what pickers (Quick Sale, stock update, invoices) should offer
  activeProducts: Product[];
  productsLoading: boolean;
  productsError: string | null;
  refreshProducts: () => Promise<void>;
  // Reloads products, transfers, receipts and adjustments from the SQL stock API.
  refreshStock: () => Promise<void>;
  // Super Admin switch: may branch persons update stock, add spare parts and correct item details?
  branchPersonStockEdit: boolean;
  // True when the signed-in role may change stock right now (only branch persons are ever switched off).
  canEditStock: boolean;
  setBranchPersonStockEdit: (enabled: boolean) => Promise<void>;
  stockLoading: boolean;
  stockError: string | null;
  customers: Customer[];
  suppliers: Supplier[];
  salesOrders: SalesOrder[];
  invoices: Invoice[];
  goodsReceivedNotes: GoodsReceivedNote[];
  stockTransfers: StockTransfer[];
  stockAdjustments: StockAdjustment[];
  stockMovements: StockMovement[];
  projects: ContractorProject[];
  payments: PaymentReceipt[];
  expenses: Expense[];
  chartOfAccounts: ChartOfAccount[];
  ledgerEntries: AccountLedgerEntry[];
  employees: EmployeeUser[];
  notifications: ERPNotification[];
  auditLogs: ActivityAuditLog[];
  followUpReminders: InvoiceFollowUpReminder[];
  addFollowUpReminder: (reminder: Omit<InvoiceFollowUpReminder, 'id' | 'createdAt'>) => InvoiceFollowUpReminder;
  updateFollowUpReminder: (reminderId: string, updates: Partial<InvoiceFollowUpReminder>) => void;
  deleteFollowUpReminder: (reminderId: string) => void;

  // Warranties & Serial Tracking
  warranties: ProductWarranty[];
  filteredWarranties: ProductWarranty[];
  expiringWarrantiesCount: number;
  addWarranty: (warranty: Omit<ProductWarranty, 'id' | 'createdAt'>) => ProductWarranty;
  // Quiet add-or-update used by machine sales: the warranty is found by its code (WR-<sale number>)
  syncMachineWarranty: (warranty: Omit<ProductWarranty, 'id' | 'createdAt'>) => void;
  updateWarranty: (id: string, updates: Partial<ProductWarranty>) => void;
  deleteWarranty: (id: string) => void;
  addWarrantyClaim: (warrantyId: string, claim: Omit<WarrantyServiceRecord, 'id'>) => WarrantyServiceRecord;
  updateWarrantyClaimStatus: (warrantyId: string, claimId: string, status: WarrantyServiceRecord['status'], resolutionNotes?: string) => void;
  sendWarrantyAlert: (warrantyId: string, channel: 'WhatsApp' | 'Email' | 'SMS') => void;
  dismissWarrantyAlert: (warrantyId: string) => void;
  getWarrantiesForCustomer: (customerId: string) => ProductWarranty[];
  getWarrantyBySerial: (serialNumber: string) => ProductWarranty | undefined;
  addAuditLog: (
    action: string,
    module: string,
    details: string,
    meta?: {
      severity?: 'info' | 'warning' | 'critical' | 'success';
      entityId?: string;
      entityType?: ActivityAuditLog['entityType'];
      previousState?: string;
      newState?: string;
    }
  ) => void;
  clearAuditLogs: () => void;

  // Action methods with full business logic
  createSalesOrder: (order: Omit<SalesOrder, 'id' | 'orderNumber' | 'createdAt'>) => SalesOrder;
  confirmSalesOrder: (id: string) => void;
  convertSalesOrderToInvoice: (orderId: string) => Invoice;
  // Records the invoice and moves stock through the sales API (rejects on insufficient stock).
  createInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => Promise<Invoice>;
  recordInvoicePayment: (invoiceId: string, amount: number, method: any, reference: string) => void;
  // Stock mutators are server-backed: they reject with the server's error message and refresh stock state on success.
  createGoodsReceivedNote: (grn: Omit<GoodsReceivedNote, 'id' | 'grnNumber' | 'isStockUpdated' | 'warehouseId'> & { warehouseId?: string }) => Promise<GoodsReceivedNote>;
  createStockTransfer: (transfer: StockTransferInput) => Promise<StockTransfer>;
  approveStockTransfer: (id: string) => Promise<StockTransfer>;
  dispatchStockTransfer: (id: string, details?: DispatchDetails) => Promise<StockTransfer>;
  receiveStockTransfer: (id: string, receivedItems: ReceiveItemInput[]) => Promise<StockTransfer>;
  cancelStockTransfer: (id: string) => Promise<StockTransfer>;
  createStockAdjustment: (adj: StockAdjustmentInput) => Promise<StockAdjustment>;
  issueMaterialToProject: (projectId: string, warehouseId: string, items: { productId: string; issuedQty: number }[]) => void;
  recordProjectConsumption: (projectId: string, issueId: string, updates: { productId: string; consumedQty: number; returnedQty: number; wastageQty: number }[]) => void;
  recordCustomerPayment: (payment: Omit<PaymentReceipt, 'id' | 'receiptNumber'>) => PaymentReceipt;
  recordSupplierPayment: (payment: Omit<PaymentReceipt, 'id' | 'receiptNumber'>) => PaymentReceipt;
  addExpense: (expense: Omit<Expense, 'id' | 'expenseNumber'>) => Expense;
  addProduct: (product: Omit<Product, 'id' | 'sku' | 'createdAt'> & { sku?: string }) => Promise<Product>;
  updateProduct: (product: Product) => Promise<Product>;
  // Archives the product (soft delete) so ledger and transaction history stay intact.
  deleteProduct: (id: string) => Promise<{ success: boolean; message: string }>;
  addBranch: (branchData: Partial<Branch>) => Branch;
  updateBranch: (branch: Branch) => Promise<void>;
  addWarehouse: (warehouseData: Partial<Warehouse>) => Warehouse;
  updateWarehouse: (warehouseId: string, updates: Partial<Warehouse>) => void;

  // Configurable Categories & Stock Statuses
  categories: string[];
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;
  // Machine from the catalogue to open a new machine sale with (set by "Sell" in Inventory)
  machineSaleSeedProductId: string | null;
  startMachineSale: (productId: string) => void;
  clearMachineSaleSeed: () => void;
  stockStatuses: string[];
  addStockStatus: (status: string) => void;
  deleteStockStatus: (status: string) => void;

  // Quick Sales (Multi-item Relational Transactions)
  sales: Sale[];
  filteredSales: Sale[];
  recordQuickSale: (saleData: {
    customerId: string;
    customerName: string;
    customerPhone?: string;
    customerGstin?: string;
    customerAddress?: string;
    branchId: string;
    warehouseId?: string;
    paymentMethod: 'Cash' | 'UPI' | 'Bank Transfer';
    secondaryPaymentMethod?: 'Cash' | 'UPI' | 'Bank Transfer';
    secondaryPaymentAmount?: number;
    items: SaleItem[];
    discount?: number;
    notes?: string;
    saleId?: string; // stays the same across retries of one draft
    saleDate?: string; // YYYY-MM-DD; defaults to today, never a future day
  }) => Promise<{ sale: Sale; invoice: Invoice }>;

  // A customer already saved in the database passes its own id and { alreadySaved: true }; otherwise it is saved in the background.
  addCustomer: (customer: Omit<Customer, 'id' | 'totalSales' | 'outstandingBalance'> & { id?: string }, options?: { alreadySaved?: boolean }) => Customer;
  updateCustomer: (customer: Customer) => void;
  deleteCustomer: (id: string) => Promise<void>;
  saveCustomerEdits: (customer: Customer) => Promise<void>;
  refreshCustomers: (base?: Customer[], opts?: { background?: boolean }) => Promise<void>;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'totalPurchases' | 'outstandingPayable'>) => Supplier;
  updateSupplier: (supplier: Supplier) => void;
  addProject: (project: Omit<ContractorProject, 'id' | 'projectNumber' | 'actualMaterialCost' | 'actualLabourCost' | 'actualExpenseCost' | 'billedAmount' | 'receivedAmount' | 'materialIssues' | 'expenses' | 'labourLogs'>) => ContractorProject;
  updateProject: (project: ContractorProject) => void;
  addProjectTask: (projectId: string, task: Omit<ProjectTask, 'id' | 'projectId'>) => ProjectTask;
  updateProjectTask: (projectId: string, task: ProjectTask) => void;
  deleteProjectTask: (projectId: string, taskId: string) => void;
  addProjectMilestone: (projectId: string, milestone: Omit<ProjectMilestone, 'id' | 'projectId'>) => ProjectMilestone;
  updateProjectMilestone: (projectId: string, milestone: ProjectMilestone) => void;
  deleteProjectMilestone: (projectId: string, milestoneId: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  // Bulk operations
  bulkUpdateProductStatus: (ids: string[], status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Archived') => Promise<void>;
  bulkArchiveProducts: (ids: string[], archive?: boolean) => Promise<void>;
  bulkUpdateProductCategory: (ids: string[], category: ProductCategory) => Promise<void>;
  // dryRun=true only reports what would be erased (no history) and what would be archived instead
  bulkDeleteProducts: (ids: string[], dryRun?: boolean) => Promise<import('../services/api').BulkDeleteProductsResult>;
  bulkUpdateSalesOrderStatus: (ids: string[], status: SalesOrderStatus) => void;
  bulkArchiveSalesOrders: (ids: string[], archive?: boolean) => void;
  bulkConfirmSalesOrders: (ids: string[]) => void;
  bulkUpdateInvoiceStatus: (ids: string[], status: 'Issued' | 'Paid' | 'Cancelled' | 'Refunded') => void;
  bulkArchiveInvoices: (ids: string[], archive?: boolean) => void;

  // Filtered views helpers
  filteredBranches: Branch[];
  filteredWarehouses: Warehouse[];
  filteredProducts: Product[];
  filteredCustomers: Customer[];
  filteredSalesOrders: SalesOrder[];
  filteredInvoices: Invoice[];
  filteredStockTransfers: StockTransfer[];
  filteredProjects: ContractorProject[];
  filteredPayments: PaymentReceipt[];
  filteredExpenses: Expense[];
  filteredNotifications: ERPNotification[];
  currentBranchName: string;
  currentWarehouseName: string;
  activeMetrics: {
    todaySales: number;
    todayPurchases: number;
    totalReceivables: number;
    totalPayables: number;
    inventoryValue: number;
    grossProfit: number;
  };
}

const ERPContext = createContext<ERPContextType | undefined>(undefined);

export const ERPProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // User profile & assigned branch from AuthContext
  const { firebaseUser, userProfile, assignedBranchId } = useAuth();

  // Navigation & View state
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    userProfile && userProfile.role !== 'Business Owner' && userProfile.role !== 'Super Admin'
      ? (userProfile.branchId || assignedBranchId || 'branch-1')
      : 'all'
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [currentRole, setCurrentRole] = useState<Role>(userProfile?.role || 'Business Owner');
  const [employees, setEmployees] = useState<EmployeeUser[]>(initialEmployees);
  const [currentUser, setCurrentUser] = useState<EmployeeUser>(initialEmployees[0]);

  // Automatically enforce user role & assigned branch on login/profile update
  useEffect(() => {
    if (userProfile) {
      if (userProfile.role) {
        setCurrentRole(userProfile.role);
      }
      if (userProfile.role !== 'Business Owner' && userProfile.role !== 'Super Admin') {
        const branchToUse = userProfile.branchId || assignedBranchId || 'branch-1';
        setSelectedBranchId(branchToUse);
      }
    }
  }, [userProfile, assignedBranchId]);

  // Active branch for Firestore queries and strict branch data isolation
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const effectiveBranchId = isOwner
    ? (selectedBranchId === 'all' ? undefined : selectedBranchId)
    : (userProfile?.branchId || assignedBranchId || (selectedBranchId !== 'all' ? selectedBranchId : 'branch-1'));

  // Modal & Overlay state
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);
  const [quickAddInitialTab, setQuickAddInitialTab] = useState<string>('sale');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [activeInvoiceForPrint, setActiveInvoiceForPrint] = useState<Invoice | null>(null);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Main Data States
  const [settings, setSettings] = useState<CompanySettings>(initialCompanySettings);
  const [branches, setBranches] = useState<Branch[]>(initialBranches);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  // Stock is owned by Postgres: these start empty and are filled from the API.
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState<boolean>(true);
  const activeProducts = useMemo(() => products.filter(p => !p.isArchived && p.status !== 'Archived'), [products]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [stockLoading, setStockLoading] = useState<boolean>(true);
  const [stockError, setStockError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [goodsReceivedNotes, setGoodsReceivedNotes] = useState<GoodsReceivedNote[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>([]);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [projects, setProjects] = useState<ContractorProject[]>([]);
  const [payments, setPayments] = useState<PaymentReceipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>(initialChartOfAccounts);
  const [ledgerEntries, setLedgerEntries] = useState<AccountLedgerEntry[]>([]);
  const [notifications, setNotifications] = useState<ERPNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<ActivityAuditLog[]>([]);
  const [warranties, setWarranties] = useState<ProductWarranty[]>([]);
  const [followUpReminders, setFollowUpReminders] = useState<InvoiceFollowUpReminder[]>([]);

  const [machineSaleSeedProductId, setMachineSaleSeedProductId] = useState<string | null>(null);

  const [categories, setCategories] = useState<string[]>([
    'Rotavator',
    'Baler',
    'General Spares',
    'Power Tiller',
    'Tractor Spare',
    'Hydraulic',
    'Electrical',
    'Rotavator Blades & Fasteners',
    'Gearboxes, PTO & Transmissions',
    'Hydraulics & Lift Cylinders',
    'Bearings, Belts & Oil Seals',
    'Diesel Engine & Spares',
    'Tractor Implements'
  ]);

  const [stockStatuses, setStockStatuses] = useState<string[]>([
    'In Stock',
    'Low Stock',
    'Out of Stock',
    'Under Inspection',
    'In Transit',
    'Archived'
  ]);

  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) {
      showToast('Category Exists', `"${trimmed}" is already in categories.`, 'info');
      return;
    }
    setCategories(prev => [...prev, trimmed]);
    addAuditLog('Created Product Category', 'Control Center', `Added new product category: "${trimmed}"`);
    showToast('Category Added', `Added "${trimmed}" to category master.`, 'success');
  };

  const deleteCategory = (name: string) => {
    setCategories(prev => prev.filter(c => c !== name));
    addAuditLog('Deleted Product Category', 'Control Center', `Removed product category: "${name}"`);
    showToast('Category Removed', `Removed "${name}" from categories.`, 'info');
  };

  const addStockStatus = (status: string) => {
    const trimmed = status.trim();
    if (!trimmed) return;
    if (stockStatuses.includes(trimmed)) {
      showToast('Status Exists', `"${trimmed}" is already in stock statuses.`, 'info');
      return;
    }
    setStockStatuses(prev => [...prev, trimmed]);
    addAuditLog('Created Stock Status', 'Control Center', `Added new stock status: "${trimmed}"`);
    showToast('Stock Status Added', `Added "${trimmed}" to stock statuses.`, 'success');
  };

  const deleteStockStatus = (status: string) => {
    setStockStatuses(prev => prev.filter(s => s !== status));
    addAuditLog('Deleted Stock Status', 'Control Center', `Removed stock status: "${status}"`);
    showToast('Stock Status Removed', `Removed "${status}".`, 'info');
  };

  // Firestore Sync States
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('synced');
  const [isFirestoreConnected, setIsFirestoreConnected] = useState<boolean>(true);

  // SQL stock API access. The ref keeps long-lived callbacks on the latest role/branch.
  const apiScope: ApiScope = { role: currentRole, branchId: effectiveBranchId || 'branch-1' };
  const apiScopeRef = useRef<ApiScope>(apiScope);
  apiScopeRef.current = apiScope;
  const productsReqId = useRef(0);
  const stockReqId = useRef(0);

  const refreshProducts = async (): Promise<void> => {
    const reqId = ++productsReqId.current;
    setProductsLoading(true);
    try {
      const data = await getSqlProducts();
      if (reqId !== productsReqId.current) return;
      setProducts(data);
      setProductsError(null);
    } catch (err: any) {
      if (reqId !== productsReqId.current) return;
      setProductsError(err?.message || 'Failed to load products');
    } finally {
      if (reqId === productsReqId.current) setProductsLoading(false);
      markStartup('products-loaded');
    }
  };

  // Transfers, receipts and adjustments (products are refreshed alongside by refreshStock).
  const refreshStockDocs = async (): Promise<void> => {
    const reqId = ++stockReqId.current;
    setStockLoading(true);
    const scope = apiScopeRef.current;
    const results = await Promise.allSettled([
      listTransfersApi(scope),
      listReceiptsApi(scope),
      listAdjustmentsApi(scope)
    ]);
    if (reqId !== stockReqId.current) return;
    const [transfers, receipts, adjustments] = results;
    if (transfers.status === 'fulfilled') setStockTransfers(transfers.value);
    if (receipts.status === 'fulfilled') setGoodsReceivedNotes(receipts.value);
    if (adjustments.status === 'fulfilled') setStockAdjustments(adjustments.value);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setStockError(failed ? (failed.reason?.message || 'Failed to load stock records') : null);
    setStockLoading(false);
  };

  const refreshStock = async (): Promise<void> => {
    await Promise.all([refreshProducts(), refreshStockDocs()]);
  };

  // Load stock once the provider mounts (it only mounts for approved users) and when the role/branch scope changes.
  useEffect(() => {
    refreshProducts();
  }, []);

  useEffect(() => {
    refreshStockDocs();
  }, [currentRole, effectiveBranchId]);

  // Initialize Firestore seeding & snapshot listeners with branch query isolation
  useEffect(() => {
    let isMounted = true;
    const unsubs: (() => void)[] = [];

    const initFirestore = async () => {
      try {
        setSyncStatus('syncing');
        // One-time setup check; it must not hold up the data below, so it runs alongside them.
        void seedInitialFirestoreData({
          products: [],
          projects: [],
          customers: [],
          suppliers: [],
          warehouses: initialWarehouses,
          branches: initialBranches,
          salesOrders: [],
          invoices: [],
          expenses: [],
          payments: [],
          settings: initialCompanySettings,
          auditLogs: []
        });

        // 1. Shared catalog collections (accessible across branches)
        unsubs.push(subscribeToCollection<ContractorProject>('projects', (data) => {
          if (data && isMounted) setProjects(data);
        }));
        unsubs.push(subscribeToCollection<Supplier>('suppliers', (data) => {
          if (data && isMounted) setSuppliers(data);
        }));
        unsubs.push(subscribeToCollection<ProductWarranty>('warranties', (data) => {
          if (data && isMounted) setWarranties(data);
        }));

        // 2. Branch-isolated collections (strictly filtered at Firestore query level by assigned branch)
        // Central directory: every branch reads the same customer list.
        unsubs.push(subscribeToCollection<Customer>('customers', (data) => {
          if (data && isMounted) {
            setCustomers(data);
            // Customers added through the SQL API (CSV import, quick sale) are folded back in.
            refreshCustomers(data, { background: true });
          }
        }));

        unsubs.push(subscribeToCollection<SalesOrder>('salesOrders', (data) => {
          if (data && isMounted) setSalesOrders(data);
        }, effectiveBranchId));

        unsubs.push(subscribeToCollection<Invoice>('invoices', (data) => {
          if (data && isMounted) setInvoices(data);
        }, effectiveBranchId));

        unsubs.push(subscribeToCollection<Sale>('sales', (data) => {
          if (data && isMounted) setSales(data);
        }, effectiveBranchId));

        unsubs.push(subscribeToCollection<Expense>('expenses', (data) => {
          if (data && isMounted) setExpenses(data);
        }, effectiveBranchId));

        unsubs.push(subscribeToCollection<PaymentReceipt>('payments', (data) => {
          if (data && isMounted) setPayments(data);
        }, effectiveBranchId));

        // The activity history grows with every action, so the owner's all-branch view loads the newest 50 only.
        unsubs.push(subscribeToCollection<ActivityAuditLog>('auditLogs', (data) => {
          if (data && isMounted) setAuditLogs(data);
        }, effectiveBranchId, undefined, { field: 'timestamp', max: 50 }));

        // Branch details are saved to the database and then announced here, so every signed-in branch user
        // re-reads them at once instead of waiting for a page reload.
        unsubs.push(subscribeToCollection<Branch>('branches', () => {
          if (isMounted) loadSqlBranches();
        }));

        if (isMounted) {
          setSyncStatus('synced');
          setIsFirestoreConnected(true);
          markStartup('firestore-listeners-started');
        }
      } catch (err) {
        console.warn('Firestore initialization notice:', err);
        if (isMounted) {
          setSyncStatus('offline');
        }
      }
    };

    initFirestore();

    return () => {
      isMounted = false;
      unsubs.forEach(fn => fn());
    };
  }, [effectiveBranchId]);

  const syncNowToFirestore = async () => {
    setSyncStatus('syncing');
    try {
      await seedInitialFirestoreData({
        products: [],
        projects,
        customers,
        suppliers,
        warehouses,
        branches,
        salesOrders,
        invoices,
        expenses,
        payments,
        settings,
        auditLogs
      });
      setSyncStatus('synced');
      showToast('Firestore Synchronized', 'All enterprise records and audit trails pushed to Google Cloud Firestore.');
    } catch (err: any) {
      setSyncStatus('error');
      showToast('Sync Error', err.message || 'Failed to sync to Cloud Firestore', 'error');
    }
  };

  // Sync role to matching employee user
  useEffect(() => {
    const matched = employees.find(e => e.role === currentRole) || employees[0];
    setCurrentUser(matched);
  }, [currentRole, employees]);

  // Keyboard shortcut for Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleSidebar = () => setIsSidebarCollapsed(prev => !prev);

  const showToast = (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast = { id, title, message, type };
    setToasts(prev => [newToast, ...prev]);

    setTimeout(() => {
      dismissToast(id);
    }, 4000);
  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const openQuickAdd = (tab: string = 'sale') => {
    setQuickAddInitialTab(tab);
    setIsQuickAddOpen(true);
  };

  const addAuditLog = (
    action: string,
    module: string,
    details: string,
    meta?: {
      severity?: 'info' | 'warning' | 'critical' | 'success';
      entityId?: string;
      entityType?: ActivityAuditLog['entityType'];
      previousState?: string;
      newState?: string;
    }
  ) => {
    const branch = branches.find(b => b.id === (selectedBranchId !== 'all' ? selectedBranchId : 'branch-1'))?.name || 'Metro Flagship Branch';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    
    const newLog: ActivityAuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: `${dateStr} ${timeStr}`,
      user: currentUser?.name || 'Authorized User',
      role: currentRole,
      action,
      module,
      branchName: branch,
      details,
      ipAddress: '192.168.1.10',
      severity: meta?.severity || 'info',
      entityId: meta?.entityId,
      entityType: meta?.entityType,
      previousState: meta?.previousState,
      newState: meta?.newState
    };

    setAuditLogs(prev => [newLog, ...prev]);
    saveFirestoreDoc('auditLogs', newLog.id, newLog).catch(err => {
      console.warn('Could not persist audit log to Firestore:', err);
    });
  };

  const clearAuditLogs = () => {
    setAuditLogs([]);
    showToast('Audit Trail Archived', 'Activity audit logs have been archived/cleared.', 'info');
  };

  // ERP BUSINESS LOGIC ACTIONS

  // 1. Create Sales Order
  const createSalesOrder = (orderData: Omit<SalesOrder, 'id' | 'orderNumber' | 'createdAt'>): SalesOrder => {
    const nextNum = (salesOrders.length + 454).toString().padStart(5, '0');
    const orderNumber = `${settings.soPrefix}${nextNum}`;
    const newOrder: SalesOrder = {
      ...orderData,
      id: `so-${Date.now()}`,
      orderNumber,
      createdAt: new Date().toISOString().split('T')[0]
    };

    setSalesOrders(prev => [newOrder, ...prev]);
    addAuditLog('Created Sales Order', 'Sales', `Created Order ${orderNumber} for ${orderData.customerName} (Total: ${settings.currencySymbol}${orderData.grandTotal.toLocaleString()})`, {
      severity: 'success',
      entityType: 'SalesOrder',
      entityId: newOrder.id,
      newState: 'Draft / Placed'
    });
    showToast('Sales Order Created', `Order ${orderNumber} has been created successfully.`);
    return newOrder;
  };

  // 2. Confirm Sales Order (stock reservation is not tracked yet)
  const confirmSalesOrder = (id: string) => {
    setSalesOrders(prev => prev.map(so => so.id === id ? { ...so, status: 'Confirmed' as const } : so));

    addAuditLog('Confirmed Sales Order', 'Sales', `Confirmed Sales Order #${id}.`, {
      severity: 'info',
      entityType: 'SalesOrder',
      entityId: id,
      previousState: 'Draft / Placed',
      newState: 'Confirmed'
    });
    showToast('Sales Order Confirmed', 'Order confirmed and ready for dispatch / invoicing.');
  };

  // 3. Convert Sales Order to Invoice
  const convertSalesOrderToInvoice = (orderId: string): Invoice => {
    const so = salesOrders.find(o => o.id === orderId);
    if (!so) throw new Error('Sales order not found');

    const nextInvNum = (invoices.length + 894).toString().padStart(5, '0');
    const invoiceNumber = `${settings.invoicePrefix}${nextInvNum}`;

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber,
      salesOrderId: so.id,
      customerId: so.customerId,
      customerName: so.customerName,
      customerGstin: customers.find(c => c.id === so.customerId)?.gstin || '',
      billingAddress: customers.find(c => c.id === so.customerId)?.address || 'Head Office Address',
      shippingAddress: so.shippingAddress,
      branchId: so.branchId,
      warehouseId: so.warehouseId,
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      type: 'Tax Invoice',
      items: so.items,
      subtotal: so.subtotal,
      totalDiscount: so.totalDiscount,
      cgstAmount: Math.round(so.taxAmount / 2),
      sgstAmount: Math.round(so.taxAmount / 2),
      igstAmount: 0,
      taxAmount: so.taxAmount,
      grandTotal: so.grandTotal,
      paidAmount: so.paidAmount,
      balanceAmount: so.balanceAmount,
      paymentStatus: so.paymentStatus,
      status: so.paymentStatus === 'Paid' ? 'Paid' : 'Issued',
      notes: `Generated from Sales Order ${so.orderNumber}`,
      terms: 'Payment due within 30 days. Subject to Mumbai jurisdiction.'
    };

    setInvoices(prev => [newInvoice, ...prev]);
    setSalesOrders(prev => prev.map(o => o.id === orderId ? { ...o, invoiceId: newInvoice.id, status: 'Dispatched' } : o));

    // Update customer outstanding
    if (newInvoice.balanceAmount > 0) {
      setCustomers(custList => custList.map(c => {
        if (c.id === so.customerId) {
          return {
            ...c,
            outstandingBalance: c.outstandingBalance + newInvoice.balanceAmount,
            totalSales: c.totalSales + newInvoice.grandTotal,
            lastTransactionDate: newInvoice.invoiceDate
          };
        }
        return c;
      }));
    }

    addAuditLog('Generated Invoice', 'Billing', `Generated Tax Invoice ${invoiceNumber} from Order ${so.orderNumber} (Grand Total: ${settings.currencySymbol}${newInvoice.grandTotal.toLocaleString()})`, {
      severity: 'success',
      entityType: 'Invoice',
      entityId: newInvoice.id,
      previousState: `Order ${so.orderNumber} Dispatched`,
      newState: `Invoice ${invoiceNumber} Issued`
    });
    showToast('Invoice Generated', `Tax Invoice ${invoiceNumber} created and customer balance updated.`);
    return newInvoice;
  };

  // 4. Create Direct Invoice
  const createInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber'>): Promise<Invoice> => {
    const nextInvNum = (invoices.length + 894).toString().padStart(5, '0');
    const invoiceNumber = `${settings.invoicePrefix}${nextInvNum}`;
    const whId = invoiceData.warehouseId || warehouses.find(w => w.branchId === invoiceData.branchId)?.id || 'wh-1';
    const newInvoice: Invoice = {
      ...invoiceData,
      warehouseId: whId,
      id: `inv-${Date.now()}`,
      invoiceNumber
    };

    // Stock moves only on the server. If it rejects (e.g. insufficient stock) nothing is recorded locally.
    const lineItems = newInvoice.items.filter(it => it.productId && it.quantity > 0);
    if (lineItems.length > 0) {
      const saleItems = lineItems.map(it => {
        const gross = it.quantity * it.rate;
        const discount = Math.round(gross * ((it.discountPercent || 0) / 100));
        const taxable = gross - discount;
        const gst = it.taxAmount ?? Math.round(taxable * ((it.taxRate || 0) / 100));
        return {
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.rate,
          discount,
          gst,
          lineTotal: taxable,
          hsnCode: it.hsnCode
        };
      });
      await recordMultiItemSaleApi({
        customerId: newInvoice.customerId,
        customerName: newInvoice.customerName,
        branchId: newInvoice.branchId,
        warehouseId: whId,
        paymentMethod: newInvoice.paymentMethod || 'Cash',
        paymentStatus: newInvoice.paymentStatus,
        createdBy: currentUser?.name,
        grandTotal: newInvoice.grandTotal,
        items: saleItems
      }, apiScope.role, newInvoice.branchId || apiScope.branchId);
      await refreshProducts();
    }

    setInvoices(prev => [newInvoice, ...prev]);

    // Update customer balance & total sales
    setCustomers(custList => custList.map(c => {
      if (c.id === newInvoice.customerId) {
        return {
          ...c,
          outstandingBalance: c.outstandingBalance + newInvoice.balanceAmount,
          totalSales: c.totalSales + newInvoice.grandTotal,
          lastTransactionDate: newInvoice.invoiceDate
        };
      }
      return c;
    }));

    addAuditLog('Created Direct Invoice', 'Billing', `Issued Invoice ${invoiceNumber} for ${newInvoice.customerName} (${settings.currencySymbol}${newInvoice.grandTotal.toLocaleString()})`, {
      severity: 'success',
      entityType: 'Invoice',
      entityId: newInvoice.id,
      newState: 'Issued / Unpaid'
    });
    showToast('Invoice Created', `Invoice ${invoiceNumber} generated successfully.`);
    return newInvoice;
  };

  // 4b. Record Quick Sale (Multi-item Relational Transaction). The server validates and deducts stock;
  // nothing is recorded locally unless it accepts the sale.
  const recordQuickSale = async (saleData: {
    customerId: string;
    customerName: string;
    customerPhone?: string;
    customerGstin?: string;
    customerAddress?: string;
    branchId: string;
    warehouseId?: string;
    paymentMethod: 'Cash' | 'UPI' | 'Bank Transfer';
    secondaryPaymentMethod?: 'Cash' | 'UPI' | 'Bank Transfer';
    secondaryPaymentAmount?: number;
    items: SaleItem[];
    discount?: number;
    notes?: string;
    saleId?: string;
    saleDate?: string;
  }): Promise<{ sale: Sale; invoice: Invoice }> => {
    const saleId = saleData.saleId || `sale-${Date.now()}`;
    const saleNum = `QS-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const today = saleData.saleDate || new Date().toISOString().split('T')[0];
    const discount = saleData.discount || 0;

    let subtotal = 0;
    let totalGst = 0;
    const finalItems: SaleItem[] = saleData.items.map((it, idx) => {
      const itemTot = it.lineTotal || (it.quantity * it.unitPrice) - (it.discount || 0);
      subtotal += itemTot;
      totalGst += it.gst || 0;
      return {
        ...it,
        id: it.id || `si-${Date.now()}-${idx}`,
        saleId,
        lineTotal: itemTot
      };
    });

    const grandTotal = Math.max(0, Math.round(subtotal + totalGst - discount));

    const isOwnerRole = currentRole === 'Business Owner' || currentRole === 'Super Admin';
    const targetBranch = isOwnerRole
      ? saleData.branchId
      : (userProfile?.branchId || assignedBranchId || selectedBranchId || 'branch-1');
    const targetWhId = saleData.warehouseId || (warehouses.find(w => w.branchId === targetBranch)?.id || 'wh-1');
    const createdBy = currentUser?.name || userProfile?.displayName || 'Branch Staff';

    let serverResult: Awaited<ReturnType<typeof recordMultiItemSaleApi>>;
    try {
      serverResult = await recordMultiItemSaleApi({
        id: saleId,
        saleNumber: saleNum,
        saleDate: saleData.saleDate,
        customerId: saleData.customerId,
        customerName: saleData.customerName,
        branchId: targetBranch,
        warehouseId: targetWhId,
        paymentMethod: saleData.paymentMethod,
        secondaryPaymentMethod: saleData.secondaryPaymentMethod,
        secondaryPaymentAmount: saleData.secondaryPaymentAmount,
        createdBy,
        discount,
        grandTotal,
        items: finalItems
      }, currentRole, targetBranch);
    } catch (err: any) {
      showToast('Sale Not Recorded', err?.message || 'The server rejected this sale.', 'error');
      // Stock may have changed under us (that is the usual cause of a rejection).
      refreshProducts();
      throw err;
    }

    const newSale: Sale = {
      id: serverResult.sale?.id || saleId,
      saleNumber: serverResult.sale?.saleNumber || saleNum,
      customerId: saleData.customerId,
      customerName: saleData.customerName,
      customerPhone: saleData.customerPhone,
      branchId: targetBranch,
      createdBy,
      createdAt: today,
      items: finalItems,
      subtotal,
      discount,
      gst: totalGst,
      grandTotal,
      paymentMethod: saleData.paymentMethod,
      secondaryPaymentMethod: saleData.secondaryPaymentMethod || null,
      secondaryPaymentAmount: saleData.secondaryPaymentAmount || 0,
      paymentStatus: 'Paid'
    };

    setSales(prev => [newSale, ...prev]);
    saveFirestoreDoc('sales', newSale.id, newSale);

    // Generate connected Tax Invoice containing ALL items (Requirement 10)
    const nextInvNum = (invoices.length + 894).toString().padStart(5, '0');
    const invoiceNumber = serverResult.invoice?.invoiceNumber || `${settings.invoicePrefix}${nextInvNum}`;
    const invoiceItems: OrderItem[] = finalItems.map(fi => ({
      productId: fi.productId,
      productName: fi.productName,
      sku: fi.sku,
      unit: fi.unit || 'Nos',
      quantity: fi.quantity,
      rate: fi.unitPrice,
      discountPercent: fi.discount ? Math.round((fi.discount / (fi.quantity * fi.unitPrice)) * 100) : 0,
      taxRate: fi.gst > 0 ? 12 : 0,
      taxAmount: fi.gst,
      totalAmount: fi.lineTotal,
      hsnCode: fi.hsnCode || '8432'
    }));

    const newInvoice: Invoice = {
      id: serverResult.invoice?.id || `inv-${Date.now()}`,
      invoiceNumber,
      salesOrderId: newSale.id,
      customerId: saleData.customerId,
      customerName: saleData.customerName,
      customerGstin: saleData.customerGstin || '',
      billingAddress: saleData.customerAddress || 'Sampletown, Sample State',
      shippingAddress: saleData.customerAddress || 'Sampletown, Sample State',
      branchId: targetBranch,
      warehouseId: targetWhId,
      invoiceDate: today,
      dueDate: today,
      type: 'Tax Invoice',
      items: invoiceItems,
      subtotal,
      totalDiscount: discount,
      cgstAmount: Math.round(totalGst / 2),
      sgstAmount: Math.round(totalGst / 2),
      igstAmount: 0,
      taxAmount: totalGst,
      grandTotal,
      paidAmount: grandTotal,
      balanceAmount: 0,
      paymentStatus: 'Paid',
      paymentMethod: saleData.paymentMethod,
      status: 'Issued',
      notes: `Quick Counter Sale #${newSale.saleNumber} (${finalItems.length} items)`,
      terms: 'Subject to Sampletown Jurisdiction. Goods once sold will not be taken back.'
    };

    setInvoices(prev => [newInvoice, ...prev]);
    saveFirestoreDoc('invoices', newInvoice.id, newInvoice);

    setCustomers(custList => custList.map(c => {
      if (c.id === saleData.customerId) {
        return {
          ...c,
          totalSales: c.totalSales + grandTotal,
          lastTransactionDate: today
        };
      }
      return c;
    }));

    addAuditLog(
      'Completed Multi-Item Quick Sale',
      'Quick Sale',
      `Processed Quick Sale ${newSale.saleNumber} with ${finalItems.length} items for ${saleData.customerName} (Total: ${settings.currencySymbol}${grandTotal.toLocaleString()}). Invoice #${invoiceNumber} issued and inventory deducted.`,
      {
        severity: 'success',
        entityType: 'SalesOrder',
        entityId: newSale.id,
        newState: 'Completed / Paid'
      }
    );

    showToast(
      'Sale Recorded Successfully',
      `Saved ${finalItems.length} items (Total: ${settings.currencySymbol}${grandTotal.toLocaleString()}). Invoice #${invoiceNumber} generated.`,
      'success'
    );

    await refreshProducts();
    return { sale: newSale, invoice: newInvoice };
  };

  // 5. Record Invoice Payment
  const recordInvoicePayment = (invoiceId: string, amount: number, method: any, reference: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const newPaid = inv.paidAmount + amount;
    const newBal = Math.max(0, inv.grandTotal - newPaid);
    const newStatus: any = newBal === 0 ? 'Paid' : 'Partial';

    setInvoices(prev => prev.map(i => i.id === invoiceId ? {
      ...i,
      paidAmount: newPaid,
      balanceAmount: newBal,
      paymentStatus: newStatus,
      paymentMethod: method,
      status: newBal === 0 ? 'Paid' : i.status
    } : i));

    // Update Customer outstanding
    setCustomers(custList => custList.map(c => {
      if (c.id === inv.customerId) {
        return {
          ...c,
          outstandingBalance: Math.max(0, c.outstandingBalance - amount),
          lastTransactionDate: new Date().toISOString().split('T')[0]
        };
      }
      return c;
    }));

    // Record Payment Receipt
    const receiptNum = `REC-2026-${(payments.length + 504).toString().padStart(5, '0')}`;
    const newReceipt: PaymentReceipt = {
      id: `pay-${Date.now()}`,
      receiptNumber: receiptNum,
      type: 'Customer Receipt',
      partyId: inv.customerId,
      partyName: inv.customerName,
      branchId: inv.branchId,
      amount,
      paymentMethod: method,
      referenceNumber: reference || `REF-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      invoiceOrPoNumber: inv.invoiceNumber,
      allocatedInvoices: [{ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amount }],
      bankAccount: 'HDFC Corporate Current A/c',
      notes: `Payment for Invoice ${inv.invoiceNumber}`
    };
    setPayments(prev => [newReceipt, ...prev]);

    addAuditLog('Recorded Payment', 'Finance', `Recorded ${settings.currencySymbol}${amount.toLocaleString()} receipt against ${inv.invoiceNumber} (Method: ${method})`, {
      severity: 'success',
      entityType: 'Payment',
      entityId: invoiceId,
      previousState: `Balance: ${settings.currencySymbol}${inv.balanceAmount.toLocaleString()}`,
      newState: `New Balance: ${settings.currencySymbol}${newBal.toLocaleString()} (${newStatus})`
    });
    showToast('Payment Recorded', `Payment of ${settings.currencySymbol}${amount.toLocaleString()} applied to ${inv.invoiceNumber}`);
  };

  // Goods Received Note (GRN): the server writes the note and adds the accepted quantity to the Head Office warehouse.
  const createGoodsReceivedNote = async (
    grnData: Omit<GoodsReceivedNote, 'id' | 'grnNumber' | 'isStockUpdated' | 'warehouseId'> & { warehouseId?: string }
  ): Promise<GoodsReceivedNote> => {
    const saved = await createReceiptApi(apiScope, {
      supplierId: grnData.supplierId,
      supplierInvoiceNumber: grnData.supplierInvoiceNumber,
      challanNumber: grnData.challanNumber,
      receivedDate: grnData.receivedDate,
      receivedBy: grnData.receivedBy,
      verifiedBy: grnData.verifiedBy,
      qualityStatus: grnData.qualityStatus,
      notes: grnData.notes,
      items: grnData.items.map(it => ({
        productId: it.productId,
        receivedQuantity: it.receivedQuantity,
        damagedQuantity: it.damagedQuantity,
        rate: it.rate,
        notes: it.notes
      }))
    });

    const addedAmount = (saved.items || []).reduce((acc, it) => acc + (it.acceptedQuantity * it.rate), 0);
    setSuppliers(supList => supList.map(s => s.id === saved.supplierId ? {
      ...s,
      outstandingPayable: s.outstandingPayable + addedAmount,
      totalPurchases: s.totalPurchases + addedAmount,
      lastPurchaseDate: saved.receivedDate
    } : s));

    addAuditLog('Inwarded Goods Received Note', 'Goods Received', `Generated GRN ${saved.grnNumber} from ${saved.supplierName} and updated Head Office inventory.`, {
      severity: 'success',
      entityType: 'GRN',
      entityId: saved.id
    });
    showToast('Goods Inwarded (GRN)', `GRN ${saved.grnNumber} generated. Stock has been added to Head Office inventory.`);
    await refreshStock();
    return saved;
  };

  // 9. Stock Transfer Workflow (Head Office -> branches). Quantities move on the server only.
  const createStockTransfer = async (transferData: StockTransferInput): Promise<StockTransfer> => {
    const saved = await createTransferApi(apiScope, {
      toBranchId: transferData.toBranchId,
      toWarehouseId: transferData.toWarehouseId,
      notes: transferData.notes,
      items: transferData.items.map(it => ({ productId: it.productId, requestedQty: it.requestedQty }))
    });
    addAuditLog('Created Stock Transfer Request', 'Stock Transfers', `Requested Transfer ${saved.transferNumber} from Head Office to ${saved.toWarehouseId}.`, {
      entityType: 'StockTransfer',
      entityId: saved.id
    });
    showToast('Transfer Requested', `Stock Transfer ${saved.transferNumber} submitted for authorization.`);
    await refreshStock();
    return saved;
  };

  const approveStockTransfer = async (id: string): Promise<StockTransfer> => {
    const saved = await approveTransferApi(apiScope, id);
    addAuditLog('Approved Stock Transfer', 'Stock Transfers', `Approved Transfer ${saved.transferNumber}`, {
      entityType: 'StockTransfer',
      entityId: saved.id,
      newState: 'Approved'
    });
    showToast('Transfer Approved', 'Stock transfer approved and ready to dispatch.');
    await refreshStock();
    return saved;
  };

  const dispatchStockTransfer = async (id: string, details: DispatchDetails = {}): Promise<StockTransfer> => {
    const saved = await dispatchTransferApi(apiScope, id, details);
    addAuditLog('Dispatched Stock Transfer', 'Stock Transfers', `Dispatched Transfer ${saved.transferNumber}${details.vehicleNumber ? ` in vehicle ${details.vehicleNumber}` : ''}`, {
      entityType: 'StockTransfer',
      entityId: saved.id,
      newState: saved.status
    });
    showToast('Stock Dispatched', 'Stock deducted from Head Office and marked In Transit to the branch.');
    await refreshStock();
    return saved;
  };

  const receiveStockTransfer = async (id: string, receivedItems: ReceiveItemInput[]): Promise<StockTransfer> => {
    const saved = await receiveTransferApi(apiScope, id, receivedItems);
    addAuditLog('Received Stock Transfer', 'Stock Transfers', `Received and verified transfer ${saved.transferNumber} at the destination warehouse.`, {
      entityType: 'StockTransfer',
      entityId: saved.id,
      newState: saved.status
    });
    showToast('Stock Received & Verified', 'Destination warehouse inventory updated.');
    await refreshStock();
    return saved;
  };

  const cancelStockTransfer = async (id: string): Promise<StockTransfer> => {
    const saved = await cancelTransferApi(apiScope, id);
    addAuditLog('Cancelled Stock Transfer', 'Stock Transfers', `Cancelled Transfer ${saved.transferNumber}`, {
      severity: 'warning',
      entityType: 'StockTransfer',
      entityId: saved.id,
      newState: 'Cancelled'
    });
    showToast('Transfer Cancelled', `Transfer ${saved.transferNumber} was cancelled.`, 'info');
    await refreshStock();
    return saved;
  };

  // 10. Stock Adjustment (Increase / Decrease / Recount), applied and ledgered by the server
  const createStockAdjustment = async (adjData: StockAdjustmentInput): Promise<StockAdjustment> => {
    const saved = await createAdjustmentApi(apiScope, adjData);
    const unit = saved.unit || products.find(p => p.id === adjData.productId)?.unit || 'Nos';
    addAuditLog('Stock Adjusted', 'Inventory', `Adjusted inventory for "${saved.productName}" by ${saved.adjustedQty > 0 ? '+' : ''}${saved.adjustedQty} ${unit} (${adjData.reason})`, {
      severity: saved.adjustedQty < 0 ? 'warning' : 'info',
      entityType: 'Inventory',
      entityId: adjData.productId,
      previousState: `Available: ${saved.oldStock} ${unit}`,
      newState: `Available: ${saved.newStock} ${unit} (Net ${saved.adjustedQty > 0 ? '+' : ''}${saved.adjustedQty})`
    });
    showToast('Stock Adjusted', `Inventory updated for ${saved.productName} (${saved.adjustedQty > 0 ? '+' : ''}${saved.adjustedQty} ${unit}).`);
    await refreshStock();
    return saved;
  };

  // 11. Project Material Issue (project cost record only; warehouse stock is not touched here)
  const issueMaterialToProject = (projectId: string, warehouseId: string, items: { productId: string; issuedQty: number }[]) => {
    let issueCost = 0;
    const issueItems = items.map(it => {
      const prod = products.find(p => p.id === it.productId);
      const cost = (prod?.purchasePrice || 100) * it.issuedQty;
      issueCost += cost;
      return {
        productId: it.productId,
        productName: prod?.name || 'Material Item',
        sku: prod?.sku || 'SKU-001',
        unit: prod?.unit || 'Nos',
        issuedQty: it.issuedQty,
        consumedQty: 0,
        returnedQty: 0,
        wastageQty: 0,
        unitCost: prod?.purchasePrice || 100,
        totalCost: cost
      };
    });

    const newIssue: ProjectMaterialIssue = {
      id: `iss-${Date.now()}`,
      issueNumber: `ISS-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      projectId,
      warehouseId,
      date: new Date().toISOString().split('T')[0],
      issuedBy: currentUser.name,
      receivedBy: 'Site Engineer',
      items: issueItems,
      totalIssueCost: issueCost,
      status: 'Issued'
    };

    setProjects(prjList => prjList.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        actualMaterialCost: p.actualMaterialCost + issueCost,
        materialIssues: [newIssue, ...(p.materialIssues || [])]
      };
    }));

    addAuditLog('Issued Project Materials', 'Projects', `Issued materials valued at ${settings.currencySymbol}${issueCost.toLocaleString()} to project.`);
    showToast('Materials Issued to Project', `Project cost updated.`);
  };

  // 12. Record Project Consumption
  const recordProjectConsumption = (
    projectId: string,
    issueId: string,
    updates: { productId: string; consumedQty: number; returnedQty: number; wastageQty: number }[]
  ) => {
    setProjects(prjList => prjList.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        materialIssues: p.materialIssues.map(iss => {
          if (iss.id !== issueId) return iss;
          return {
            ...iss,
            items: iss.items.map(it => {
              const u = updates.find(x => x.productId === it.productId);
              if (!u) return it;
              return {
                ...it,
                consumedQty: u.consumedQty,
                returnedQty: u.returnedQty,
                wastageQty: u.wastageQty
              };
            }),
            status: updates.some(u => u.returnedQty > 0) ? 'Partially Returned' : 'Fully Consumed'
          };
        })
      };
    }));

    addAuditLog('Updated Material Consumption', 'Projects', `Updated material usage & returns for project.`);
    showToast('Consumption Recorded', 'Project material records updated.');
  };

  // 13. Payments (Customer Receipt & Supplier Payment)
  const recordCustomerPayment = (paymentData: Omit<PaymentReceipt, 'id' | 'receiptNumber'>): PaymentReceipt => {
    const receiptNumber = `REC-2026-${(payments.length + 505).toString().padStart(5, '0')}`;
    const newPayment: PaymentReceipt = {
      ...paymentData,
      id: `pay-${Date.now()}`,
      receiptNumber
    };
    setPayments(prev => [newPayment, ...prev]);

    // Reduce Customer Outstanding
    setCustomers(custList => custList.map(c => {
      if (c.id === paymentData.partyId) {
        return {
          ...c,
          outstandingBalance: Math.max(0, c.outstandingBalance - paymentData.amount),
          lastTransactionDate: paymentData.date
        };
      }
      return c;
    }));

    addAuditLog('Recorded Customer Receipt', 'Finance', `Received ${settings.currencySymbol}${paymentData.amount.toLocaleString()} from ${paymentData.partyName}`);
    showToast('Payment Receipt Created', `Receipt ${receiptNumber} generated.`);
    return newPayment;
  };

  const recordSupplierPayment = (paymentData: Omit<PaymentReceipt, 'id' | 'receiptNumber'>): PaymentReceipt => {
    const receiptNumber = `PAY-2026-${(payments.length + 215).toString().padStart(5, '0')}`;
    const newPayment: PaymentReceipt = {
      ...paymentData,
      id: `pay-${Date.now()}`,
      receiptNumber
    };
    setPayments(prev => [newPayment, ...prev]);

    // Reduce Supplier Payable
    setSuppliers(supList => supList.map(s => {
      if (s.id === paymentData.partyId) {
        return {
          ...s,
          outstandingPayable: Math.max(0, s.outstandingPayable - paymentData.amount),
          lastPurchaseDate: paymentData.date
        };
      }
      return s;
    }));

    addAuditLog('Paid Supplier', 'Finance', `Paid ${settings.currencySymbol}${paymentData.amount.toLocaleString()} to ${paymentData.partyName}`);
    showToast('Supplier Payment Recorded', `Payment ${receiptNumber} recorded.`);
    return newPayment;
  };

  // 14. Expenses
  const addExpense = (expenseData: Omit<Expense, 'id' | 'expenseNumber'>): Expense => {
    const expNum = `EXP-2026-${(expenses.length + 145).toString().padStart(5, '0')}`;
    const newExpense: Expense = {
      ...expenseData,
      id: `exp-${Date.now()}`,
      expenseNumber: expNum
    };
    setExpenses(prev => [newExpense, ...prev]);

    // Add to Branch Expense Total
    setBranches(bList => bList.map(b => {
      if (b.id === expenseData.branchId) {
        return { ...b, totalExpenses: b.totalExpenses + expenseData.totalAmount };
      }
      return b;
    }));

    addAuditLog('Recorded Expense', 'Finance', `Logged ${settings.currencySymbol}${expenseData.totalAmount.toLocaleString()} under ${expenseData.category}`);
    showToast('Expense Recorded', `Expense ${expNum} logged successfully.`);
    return newExpense;
  };

  // 15. Entity Masters CRUD
  // Product master data lives in Postgres; stock quantities are only ever changed by the stock endpoints.
  const addProduct = async (prodData: Omit<Product, 'id' | 'sku' | 'createdAt'> & { sku?: string }): Promise<Product> => {
    const isSpare =
      typeof prodData.isSparePart === 'boolean'
        ? prodData.isSparePart
        : Boolean(prodData.sku?.startsWith('SPR-') || prodData.category.includes('Spares') || prodData.category.includes('Blades') || prodData.category.includes('Fasteners'));
    const defaultPrefix = isSpare ? 'SPR' : prodData.category.slice(0, 3).toUpperCase();
    const sku = prodData.sku || `${defaultPrefix}-${Math.floor(100 + Math.random() * 900)}`;
    const { warehouseStocks: seedStocks, compatibleModels, ...rest } = prodData;
    const openingStock = (seedStocks || []).find(ws => ws.available > 0);

    const saved = await createSqlProduct({
      ...rest,
      sku,
      isSparePart: isSpare,
      compatibleModels: compatibleModels?.join(', '),
      initialStock: openingStock?.available || 0,
      warehouseId: openingStock?.warehouseId
    });
    addAuditLog('Added Product Master', 'Inventory', `Added new ${isSpare ? 'spare part' : 'product'} ${saved.name} (${saved.sku})`, {
      entityType: 'Product',
      entityId: saved.id
    });
    showToast(isSpare ? 'Spare Part Registered' : 'Product Created', `${saved.name} (${saved.sku}) added to catalog.`);
    await refreshProducts();
    return saved;
  };

  const updateProduct = async (product: Product): Promise<Product> => {
    const prev = products.find(p => p.id === product.id);
    const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
    const { warehouseStocks: _stocks, id: _id, createdAt: _createdAt, compatibleModels, ...fields } = product;
    const patch: Record<string, unknown> = { ...fields, compatibleModels: compatibleModels?.join(', ') };

    // Enforce Centralized Master Pricing: Branch users cannot alter global master selling price!
    if (!isOwner && prev && product.sellingPrice !== prev.sellingPrice) {
      patch.sellingPrice = prev.sellingPrice;
      showToast('Master Price Locked', 'Only the Business Owner is authorized to modify the Central Master Price.', 'warning');
    }

    const saved = await patchSqlProduct(product.id, patch, apiScope.role, apiScope.branchId);

    addAuditLog('Updated Product Master', 'Inventory', `Modified product details for ${saved.name} (${saved.sku}). Selling Price: ${settings.currencySymbol}${saved.sellingPrice}`, {
      severity: 'info',
      entityType: 'Inventory',
      entityId: saved.id,
      previousState: `${settings.currencySymbol}${prev?.sellingPrice ?? 0}`,
      newState: `${settings.currencySymbol}${saved.sellingPrice}`
    });
    showToast('Product Updated', `Saved changes for ${saved.name}.`);
    await refreshProducts();
    return saved;
  };

  // Delete means archive: the product row stays so stock ledger and transactions keep their reference.
  const deleteProduct = async (id: string): Promise<{ success: boolean; message: string }> => {
    const prod = products.find(p => p.id === id);
    if (!prod) return { success: false, message: 'Product not found.' };

    try {
      await patchSqlProduct(id, { isArchived: true, status: 'Archived' }, apiScope.role, apiScope.branchId);
    } catch (err: any) {
      return { success: false, message: err?.message || 'Could not archive the product.' };
    }
    addAuditLog('Archived Product Master', 'Inventory', `Product "${prod.name}" (${prod.sku}) was archived to preserve transaction history and statutory audit records.`, {
      severity: 'warning',
      entityId: id,
      entityType: 'Inventory'
    });
    showToast('Product Archived', `"${prod.name}" was archived. Its stock ledger and history are preserved.`, 'info');
    await refreshProducts();
    return { success: true, message: 'Archived to preserve historical transaction records.' };
  };

  // Branch details live in the database; the screens start from the built-in list and are overlaid with it.
  const loadSqlBranches = async () => {
    try {
      const rows: any[] = await getSqlBranches();
      if (!rows.length) return;
      setBranches(prev => {
        const known = new Set(prev.map(b => b.id));
        const added: Branch[] = rows
          .filter(r => !known.has(r.id))
          .map(r => ({
            id: r.id,
            name: r.name || r.id,
            code: r.code || '',
            city: r.city ?? '',
            state: r.state ?? '',
            address: r.address ?? '',
            phone: r.phone ?? '',
            email: r.email ?? '',
            manager: r.manager ?? '',
            gstin: r.gstin ?? '',
            warehouseIds: [],
            totalSales: 0,
            totalPurchases: 0,
            totalExpenses: 0,
            employeeCount: 0,
            status: (r.status as Branch['status']) || 'Active'
          }));
        const merged = prev.map(b => {
          const r = rows.find(x => x.id === b.id);
          if (!r) return b;
          return {
            ...b,
            name: r.name || b.name,
            code: r.code || b.code,
            city: r.city ?? b.city,
            state: r.state ?? b.state,
            address: r.address ?? b.address,
            phone: r.phone ?? b.phone,
            email: r.email ?? b.email,
            manager: r.manager ?? b.manager,
            gstin: r.gstin ?? b.gstin,
            status: (r.status as Branch['status']) || b.status
          };
        });
        return added.length ? [...merged, ...added] : merged;
      });
    } catch (err) {
      console.warn('Could not load branch details:', err);
    }
  };

  // Super Admin's switch for branch-person stock editing. On until switched off; re-read often so a change reaches
  // everyone without a refresh.
  const [branchPersonStockEdit, setBranchPersonStockEditState] = useState<boolean>(true);
  const loadAppSettings = async () => {
    try {
      const s = await getAppSettings(apiScopeRef.current);
      setBranchPersonStockEditState(s.branchPersonStockEdit !== false);
    } catch {
      /* keep the last known value */
    }
  };
  useEffect(() => {
    loadAppSettings();
  }, [currentRole]);
  useLiveRefresh(loadAppSettings, 20_000);
  const setBranchPersonStockEdit = async (enabled: boolean) => {
    const saved = await saveAppSettings(apiScopeRef.current, { branchPersonStockEdit: enabled });
    setBranchPersonStockEditState(saved.branchPersonStockEdit !== false);
    showToast(
      enabled ? 'Branch persons can edit stock' : 'Branch persons cannot edit stock',
      enabled ? 'Branch persons can now update stock, add spare parts and correct item details.' : 'Stock editing is now switched off for branch persons.',
      enabled ? 'success' : 'info'
    );
  };
  const canEditStock = currentRole !== 'Branch Person' || branchPersonStockEdit;

  useEffect(() => {
    loadSqlBranches();
    // Safety net next to the live updates: re-read when the user comes back to the tab, and once a minute.
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadSqlBranches();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const updateBranch = async (branch: Branch): Promise<void> => {
    await updateSqlBranch(branch.id, {
      name: branch.name,
      code: branch.code,
      city: branch.city,
      state: branch.state,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      manager: branch.manager,
      gstin: branch.gstin,
      status: branch.status
    });
    setBranches(prev => prev.map(b => (b.id === branch.id ? { ...b, ...branch } : b)));
    saveFirestoreDoc('branches', branch.id, branch);
    addAuditLog('UPDATE_BRANCH', 'Branches', `Updated branch details: ${branch.name} (${branch.code})`);
    showToast('Branch Updated', `${branch.name} details saved.`, 'success');
  };

  const addBranch = (branchData: Partial<Branch>): Branch => {
    const newId = `branch-${Date.now()}`;
    const newBranch: Branch = {
      id: newId,
      name: branchData.name || 'New Regional Branch',
      code: branchData.code || `BR-${Math.floor(10 + Math.random() * 90)}`,
      city: branchData.city || 'Sampletown',
      state: branchData.state || 'Tamil Nadu',
      address: branchData.address || '',
      phone: branchData.phone || '+91 97654 32100',
      email: branchData.email || 'branch@example.com',
      manager: branchData.manager || 'Branch Manager',
      gstin: branchData.gstin || settings.gstin,
      warehouseIds: branchData.warehouseIds || [],
      totalSales: 0,
      totalPurchases: 0,
      totalExpenses: 0,
      employeeCount: 5,
      status: 'Active'
    };
    setBranches(prev => [...prev, newBranch]);
    saveFirestoreDoc('branches', newBranch.id, newBranch);
    addAuditLog('CREATE_BRANCH', 'Branches', `Added new branch: ${newBranch.name} (${newBranch.code})`);
    showToast('Branch Created', `${newBranch.name} registered successfully.`, 'success');
    return newBranch;
  };

  const addWarehouse = (whData: Partial<Warehouse>): Warehouse => {
    const newId = `wh-${Date.now()}`;
    const newWarehouse: Warehouse = {
      id: newId,
      branchId: whData.branchId || branches[0]?.id || 'branch-1',
      name: whData.name || 'New Spares Depot',
      code: whData.code || `WH-${Math.floor(10 + Math.random() * 90)}`,
      location: whData.location || (whData as any).address || 'Industrial Agro Depot',
      supervisor: whData.supervisor || (whData as any).manager || 'Yard Supervisor',
      phone: whData.phone || (whData as any).contact || '+91 97654 32100',
      capacitySqFt: whData.capacitySqFt || (whData as any).capacity || 25000,
      utilizationPercentage: whData.utilizationPercentage || 45,
      totalProductsCount: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      status: 'Active'
    };
    setWarehouses(prev => [...prev, newWarehouse]);
    saveFirestoreDoc('warehouses', newWarehouse.id, newWarehouse);
    addAuditLog('CREATE_WAREHOUSE', 'Warehouses', `Added storage warehouse: ${newWarehouse.name} (${newWarehouse.code})`);
    showToast('Warehouse Registered', `${newWarehouse.name} created successfully.`, 'success');
    return newWarehouse;
  };

  const updateWarehouse = (warehouseId: string, updates: Partial<Warehouse>): void => {
    setWarehouses(prev => prev.map(w => {
      if (w.id === warehouseId) {
        const updated = { ...w, ...updates };
        saveFirestoreDoc('warehouses', updated.id, updated);
        return updated;
      }
      return w;
    }));
    addAuditLog('UPDATE_WAREHOUSE', 'Warehouses', `Updated storage warehouse: ${warehouseId}`);
    showToast('Warehouse Updated', `Storage warehouse details updated.`, 'success');
  };

  const addCustomer = (
    custData: Omit<Customer, 'id' | 'totalSales' | 'outstandingBalance'> & { id?: string },
    options?: { alreadySaved?: boolean }
  ): Customer => {
    const isOwnerRole = currentRole === 'Business Owner' || currentRole === 'Super Admin';
    const targetBranch = isOwnerRole
      ? (custData.branchId || (selectedBranchId !== 'all' ? selectedBranchId : 'branch-1'))
      : (userProfile?.branchId || assignedBranchId || selectedBranchId || 'branch-1');

    // One mobile number is one customer for the whole company, whichever branch enters it.
    const digits = (custData.phone || '').replace(/\D/g, '');
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      const existing = customersRef.current.find(c => {
        const p = (c.phone || '').replace(/\D/g, '');
        const a = (c.alternatePhone || '').replace(/\D/g, '');
        return p.endsWith(last10) || a.endsWith(last10);
      });
      if (existing) {
        showToast('Already in the directory', `${existing.companyName} already uses this mobile number.`, 'info');
        return existing;
      }
    }

    // The same customer is never added twice, and a customer that came from the database keeps its own id.
    const wantedId = custData.id || `cust-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sameId = customersRef.current.find(c => c.id === wantedId);
    if (sameId) return sameId;

    const newCust: Customer = {
      ...custData,
      id: wantedId,
      branchId: targetBranch,
      totalSales: 0,
      outstandingBalance: 0
    };
    setCustomers(prev => (prev.some(c => c.id === newCust.id) ? prev : [newCust, ...prev]));
    saveFirestoreDoc('customers', newCust.id, newCust);
    if (!options?.alreadySaved) void saveCustomerToDatabase(newCust);

    addAuditLog('Added Customer', 'Customers', `Created customer profile for ${newCust.companyName} (${newCust.city})`, {
      severity: 'success',
      entityType: 'Customer',
      entityId: newCust.id,
      newState: 'Active'
    });
    showToast('Customer Created', `${newCust.companyName} added to CRM.`);
    return newCust;
  };

  // Saves a new customer to the database in the background, trying again a few times if the connection or the
  // server hiccups, so a customer added on screen is never left only on this device.
  const saveCustomerToDatabase = async (cust: Customer): Promise<void> => {
    const delays = [0, 700, 2000];
    let lastMessage = '';
    for (const wait of delays) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try {
        const saved = await createSqlCustomer({
          id: cust.id,
          companyName: cust.companyName,
          name: cust.name,
          phone: cust.phone,
          alternatePhone: cust.alternatePhone || undefined,
          email: cust.email || undefined,
          address: cust.address || undefined,
          locality: cust.locality || undefined,
          city: cust.city || undefined,
          state: cust.state || undefined,
          pincode: cust.pincode || undefined,
          gstin: cust.gstin || undefined,
          branchId: cust.branchId,
          creditLimit: cust.creditLimit,
          creditPeriodDays: cust.creditPeriodDays,
          rating: cust.rating
        });
        if (saved?.id && saved.id !== cust.id) {
          // That mobile number already belonged to a customer: use that one and drop the copy made on screen.
          setCustomers(prev => prev.filter(c => c.id !== cust.id));
          deleteFirestoreDoc('customers', cust.id);
          refreshCustomers();
        } else if (saved?.customerId) {
          setCustomers(prev => prev.map(c => (c.id === cust.id ? { ...c, customerId: saved.customerId } : c)));
        }
        return;
      } catch (err: any) {
        lastMessage = err?.message || '';
        // A request that was refused for being wrong will not get better by trying again.
        if (/required|valid|must/i.test(lastMessage)) break;
      }
    }
    showToast('Customer not saved to the server yet', lastMessage || 'It is kept on this device. Open Customers and check it later.', 'warning');
  };

  // Customers created or imported through the SQL API (CSV import, quick sale) are brought into the
  // list the screens read, and saved to Firestore so every device sees them.
  const customersRef = useRef<Customer[]>([]);
  customersRef.current = customers;

  // base: the list that was just applied (a Firestore snapshot); defaults to what is on screen.
  // One download at a time is shared by every caller, and a background refresh (a live-list update) is skipped when one
  // finished in the last 30 seconds. Without this the start-up fired the whole customer list 8 times at once.
  const customersInFlight = useRef<Promise<void> | null>(null);
  const customersFetchedAt = useRef(0);
  const refreshCustomers = (base?: Customer[], opts?: { background?: boolean }): Promise<void> => {
    if (opts?.background && Date.now() - customersFetchedAt.current < 30000) return Promise.resolve();
    if (customersInFlight.current) return customersInFlight.current;
    const run = loadCustomersFromSql(base).finally(() => {
      customersFetchedAt.current = Date.now();
      customersInFlight.current = null;
    });
    customersInFlight.current = run;
    return run;
  };
  const loadCustomersFromSql = async (base?: Customer[]): Promise<void> => {
    try {
      const rows: any[] = await getSqlCustomers();
      const known = new Set((base || customersRef.current).map(c => c.id));
      const fresh: Customer[] = rows
        .filter(c => !known.has(c.id))
        .map(c => ({
          id: c.id,
          customerId: c.customerId || undefined,
          name: c.name || c.companyName,
          companyName: c.companyName,
          phone: c.phone,
          alternatePhone: c.alternatePhone || undefined,
          email: c.email || '',
          address: c.address || '',
          locality: c.locality || undefined,
          city: c.city || '',
          state: c.state || 'Tamil Nadu',
          pincode: c.pincode || undefined,
          gstin: c.gstin || '',
          creditLimit: Number(c.creditLimit) || 0,
          creditPeriodDays: Number(c.creditPeriodDays) || 0,
          outstandingBalance: Number(c.outstandingBalance) || 0,
          totalSales: 0,
          lastTransactionDate: c.lastTransactionDate || '',
          rating: (c.rating as Customer['rating']) || 'A',
          status: 'Active',
          branchId: c.branchId || 'branch-1'
        }));
      if (!fresh.length) return;
      setCustomers(prev => {
        const ids = new Set(prev.map(c => c.id));
        const add = fresh.filter(c => !ids.has(c.id));
        return add.length ? [...add, ...prev] : prev;
      });
      fresh.forEach(c => saveFirestoreDoc('customers', c.id, c));
    } catch (err) {
      console.warn('Could not load customers from the database:', err);
    }
  };

  useEffect(() => {
    refreshCustomers();
  }, [effectiveBranchId]);

  // Saves to the database first (so a rejected edit is shown to the user), then to the screens and Firestore.
  const saveCustomerEdits = async (customer: Customer): Promise<void> => {
    await updateSqlCustomer(customer.id, {
      companyName: customer.companyName,
      name: customer.name,
      phone: customer.phone,
      alternatePhone: customer.alternatePhone || '',
      email: customer.email || '',
      address: customer.address || '',
      locality: customer.locality || '',
      city: customer.city || '',
      state: customer.state || '',
      pincode: customer.pincode || '',
      gstin: customer.gstin || '',
      creditLimit: customer.creditLimit,
      creditPeriodDays: customer.creditPeriodDays,
      rating: customer.rating,
      branchId: customer.branchId
    });
    updateCustomer(customer);
  };

  const deleteCustomer = async (id: string): Promise<void> => {
    const cust = customersRef.current.find(c => c.id === id);
    if (cust && cust.outstandingBalance > 0) {
      throw new Error(
        `${cust.companyName} still owes ${settings.currencySymbol || 'Rs '}${Math.round(cust.outstandingBalance).toLocaleString('en-IN')}. Record the payment before deleting.`
      );
    }
    await deleteSqlCustomer(id);
    setCustomers(prev => prev.filter(c => c.id !== id));
    deleteFirestoreDoc('customers', id);
    addAuditLog('Deleted Customer', 'Customers', `Deleted customer ${cust?.companyName || id}`, {
      severity: 'warning',
      entityType: 'Customer',
      entityId: id
    });
    showToast('Customer Deleted', `${cust?.companyName || 'Customer'} was removed from the database.`);
  };

  const updateCustomer = (customer: Customer) => {
    setCustomers(prev => prev.map(c => c.id === customer.id ? customer : c));
    saveFirestoreDoc('customers', customer.id, customer);
    addAuditLog('Updated Customer Profile', 'Customers', `Updated profile & credit limit for ${customer.companyName} (${customer.gstin})`, {
      severity: 'info',
      entityType: 'Customer',
      entityId: customer.id
    });
    showToast('Customer Updated', `Saved details for ${customer.companyName}.`);
  };

  const addSupplier = (supData: Omit<Supplier, 'id' | 'totalPurchases' | 'outstandingPayable'>): Supplier => {
    const newSup: Supplier = {
      ...supData,
      id: `sup-${Date.now()}`,
      totalPurchases: 0,
      outstandingPayable: 0
    };
    setSuppliers(prev => [newSup, ...prev]);
    saveFirestoreDoc('suppliers', newSup.id, newSup);
    addAuditLog('Added Supplier', 'Suppliers', `Created supplier profile for ${newSup.companyName} (${newSup.city})`, {
      severity: 'success',
      entityType: 'Supplier',
      entityId: newSup.id,
      newState: 'Active'
    });
    showToast('Supplier Created', `${newSup.companyName} added.`);
    return newSup;
  };

  const updateSupplier = (supplier: Supplier) => {
    setSuppliers(prev => prev.map(s => s.id === supplier.id ? supplier : s));
    saveFirestoreDoc('suppliers', supplier.id, supplier);
    addAuditLog('Updated Supplier Profile', 'Suppliers', `Updated master details for ${supplier.companyName} (${supplier.gstin})`, {
      severity: 'info',
      entityType: 'Supplier',
      entityId: supplier.id
    });
    showToast('Supplier Updated', `Saved details for ${supplier.companyName}.`);
  };

  const addProject = (prjData: Omit<ContractorProject, 'id' | 'projectNumber' | 'actualMaterialCost' | 'actualLabourCost' | 'actualExpenseCost' | 'billedAmount' | 'receivedAmount' | 'materialIssues' | 'expenses' | 'labourLogs'>): ContractorProject => {
    const prjNum = `${settings.projectPrefix}${(projects.length + 4).toString().padStart(3, '0')}`;
    const newPrj: ContractorProject = {
      ...prjData,
      id: `prj-${Date.now()}`,
      projectNumber: prjNum,
      actualMaterialCost: 0,
      actualLabourCost: 0,
      actualExpenseCost: 0,
      billedAmount: 0,
      receivedAmount: 0,
      materialIssues: [],
      expenses: [],
      labourLogs: []
    };
    setProjects(prev => [newPrj, ...prev]);
    addAuditLog('Created Project', 'Projects', `Created contract project ${newPrj.name}`);
    showToast('Project Created', `Project ${prjNum} registered.`);
    return newPrj;
  };

  const updateProject = (project: ContractorProject) => {
    setProjects(prev => prev.map(p => p.id === project.id ? project : p));
    showToast('Project Updated', `Saved changes for ${project.name}.`);
  };

  const addProjectTask = (projectId: string, taskData: Omit<ProjectTask, 'id' | 'projectId'>): ProjectTask => {
    const newTask: ProjectTask = {
      ...taskData,
      id: `tsk-${Date.now()}`,
      projectId
    };
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const currentTasks = p.tasks || [];
      const updatedTasks = [...currentTasks, newTask];
      // Recalculate progress if tasks exist
      const totalProgress = updatedTasks.reduce((sum, t) => sum + t.progress, 0);
      const avgProgress = Math.round(totalProgress / updatedTasks.length);
      return {
        ...p,
        tasks: updatedTasks,
        progressPercentage: avgProgress
      };
    }));
    addAuditLog('Created Project Task', 'Projects', `Added task "${newTask.title}" in phase "${newTask.phase}"`);
    showToast('Task Created', `Task "${newTask.title}" added to schedule.`);
    return newTask;
  };

  const updateProjectTask = (projectId: string, updatedTask: ProjectTask) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const currentTasks = p.tasks || [];
      const updatedTasks = currentTasks.map(t => t.id === updatedTask.id ? updatedTask : t);
      const totalProgress = updatedTasks.reduce((sum, t) => sum + t.progress, 0);
      const avgProgress = updatedTasks.length ? Math.round(totalProgress / updatedTasks.length) : p.progressPercentage;
      return {
        ...p,
        tasks: updatedTasks,
        progressPercentage: avgProgress
      };
    }));
    showToast('Task Updated', `Saved schedule changes for "${updatedTask.title}".`);
  };

  const deleteProjectTask = (projectId: string, taskId: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const currentTasks = (p.tasks || []).filter(t => t.id !== taskId);
      const totalProgress = currentTasks.reduce((sum, t) => sum + t.progress, 0);
      const avgProgress = currentTasks.length ? Math.round(totalProgress / currentTasks.length) : p.progressPercentage;
      return {
        ...p,
        tasks: currentTasks,
        progressPercentage: avgProgress
      };
    }));
    showToast('Task Removed', 'Task deleted from project schedule.');
  };

  const addProjectMilestone = (projectId: string, milestoneData: Omit<ProjectMilestone, 'id' | 'projectId'>): ProjectMilestone => {
    const newMs: ProjectMilestone = {
      ...milestoneData,
      id: `ms-${Date.now()}`,
      projectId
    };
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: [...(p.milestones || []), newMs]
      };
    }));
    addAuditLog('Created Project Milestone', 'Projects', `Added milestone "${newMs.title}"`);
    showToast('Milestone Added', `Milestone "${newMs.title}" registered.`);
    return newMs;
  };

  const updateProjectMilestone = (projectId: string, updatedMs: ProjectMilestone) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: (p.milestones || []).map(m => m.id === updatedMs.id ? updatedMs : m)
      };
    }));
    showToast('Milestone Updated', `Saved changes for milestone "${updatedMs.title}".`);
  };

  const deleteProjectMilestone = (projectId: string, milestoneId: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: (p.milestones || []).filter(m => m.id !== milestoneId)
      };
    }));
    showToast('Milestone Removed', 'Milestone deleted from project.');
  };

  const updateSettings = (newSettings: Partial<CompanySettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    addAuditLog('Updated Enterprise Settings', 'Settings', 'Modified company master profile, tax registration, banking details, or document numbering prefixes', {
      severity: 'warning',
      entityType: 'Settings'
    });
    showToast('Settings Saved', 'System preferences updated successfully.');
  };

  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    showToast('Notifications Cleared', 'All alerts marked as read.');
  };

  const addFollowUpReminder = (reminderData: Omit<InvoiceFollowUpReminder, 'id' | 'createdAt'>): InvoiceFollowUpReminder => {
    const newReminder: InvoiceFollowUpReminder = {
      ...reminderData,
      id: `rem-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setFollowUpReminders(prev => [newReminder, ...prev]);

    // Also add to ERP notifications for real-time awareness
    const newNotif: ERPNotification = {
      id: `notif-${Date.now()}`,
      type: 'overdue_payment',
      title: `Follow-up Scheduled: ${reminderData.invoiceNumber}`,
      message: `${reminderData.reminderType} reminder scheduled for ${reminderData.customerName} on ${reminderData.reminderDate}.`,
      timestamp: 'Just now',
      severity: reminderData.priority === 'High' ? 'critical' : 'warning',
      read: false,
      actionView: 'billing',
      actionId: reminderData.invoiceId
    };
    setNotifications(prev => [newNotif, ...prev]);

    addAuditLog('Scheduled Invoice Follow-up', 'Billing', `Follow-up (${reminderData.reminderType}) set for invoice ${reminderData.invoiceNumber} (${reminderData.customerName}) due on ${reminderData.reminderDate}.`, {
      entityId: reminderData.invoiceId,
      entityType: 'Invoice',
      severity: 'info'
    });

    showToast('Follow-up Scheduled', `Reminder for invoice ${reminderData.invoiceNumber} logged successfully.`, 'success');
    return newReminder;
  };

  const updateFollowUpReminder = (reminderId: string, updates: Partial<InvoiceFollowUpReminder>) => {
    setFollowUpReminders(prev => prev.map(r => r.id === reminderId ? { ...r, ...updates } : r));
    showToast('Reminder Updated', 'Follow-up status has been updated.', 'info');
  };

  const deleteFollowUpReminder = (reminderId: string) => {
    setFollowUpReminders(prev => prev.filter(r => r.id !== reminderId));
    showToast('Reminder Removed', 'Follow-up item removed.', 'info');
  };

  // 15.5 Warranty Management Handlers
  const addWarranty = (warrantyData: Omit<ProductWarranty, 'id' | 'createdAt'>): ProductWarranty => {
    const newWarranty: ProductWarranty = {
      ...warrantyData,
      id: `war-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setWarranties(prev => [newWarranty, ...prev]);
    saveFirestoreDoc('warranties', newWarranty.id, newWarranty);

    addAuditLog('Warranty Registered', 'Warranty', `Registered warranty ${newWarranty.warrantyCode} for S/N ${newWarranty.serialNumber} (${newWarranty.productName}) to customer ${newWarranty.customerName}.`, {
      entityId: newWarranty.id,
      entityType: 'Product',
      severity: 'info'
    });

    showToast('Warranty Registered', `Warranty ${newWarranty.warrantyCode} created for S/N ${newWarranty.serialNumber}.`, 'success');
    return newWarranty;
  };

  const syncMachineWarranty = (data: Omit<ProductWarranty, 'id' | 'createdAt'>): void => {
    const existing = warranties.find((w) => w.warrantyCode === data.warrantyCode);
    if (!existing) {
      const created: ProductWarranty = {
        ...data,
        id: `war-${data.warrantyCode.replace(/^WR-/, '')}`,
        createdAt: new Date().toISOString().split('T')[0]
      };
      setWarranties((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
      saveFirestoreDoc('warranties', created.id, created);
      return;
    }
    // A claim in review and similar manual statuses stay; a cancelled sale voids the warranty and a revived one is active again.
    const status: ProductWarranty['status'] =
      data.status === 'Void' ? 'Void' : existing.status === 'Void' ? 'Active' : existing.status;
    const keys = [
      'serialNumber',
      'chassisNumber',
      'engineNumber',
      'customerId',
      'customerName',
      'customerPhone',
      'branchId',
      'branchName',
      'productName',
      'productSku',
      'invoiceId',
      'invoiceNumber',
      'purchaseDate',
      'warrantyStartDate',
      'warrantyEndDate',
      'durationMonths'
    ] as const;
    const changed = keys.some((k) => (existing as any)[k] !== (data as any)[k]) || existing.status !== status;
    if (!changed) return;
    const updated: ProductWarranty = { ...existing, ...data, id: existing.id, status, serviceRecords: existing.serviceRecords, createdAt: existing.createdAt };
    setWarranties((prev) => prev.map((w) => (w.id === existing.id ? updated : w)));
    saveFirestoreDoc('warranties', existing.id, updated);
  };

  const updateWarranty = (id: string, updates: Partial<ProductWarranty>) => {
    setWarranties(prev => prev.map(w => {
      if (w.id === id) {
        const updated = { ...w, ...updates };
        saveFirestoreDoc('warranties', id, updated);
        return updated;
      }
      return w;
    }));
    showToast('Warranty Updated', 'Warranty information updated successfully.', 'info');
  };

  const deleteWarranty = (id: string) => {
    setWarranties(prev => prev.filter(w => w.id !== id));
    deleteFirestoreDoc('warranties', id);
    showToast('Warranty Deleted', 'Warranty record removed.', 'info');
  };

  const addWarrantyClaim = (warrantyId: string, claimData: Omit<WarrantyServiceRecord, 'id'>): WarrantyServiceRecord => {
    const newClaim: WarrantyServiceRecord = {
      ...claimData,
      id: `srv-${Date.now()}`
    };
    setWarranties(prev => prev.map(w => {
      if (w.id === warrantyId) {
        const updated = {
          ...w,
          status: 'Claim In Review' as WarrantyStatus,
          serviceRecords: [newClaim, ...(w.serviceRecords || [])]
        };
        saveFirestoreDoc('warranties', warrantyId, updated);
        return updated;
      }
      return w;
    }));

    addAuditLog('Service Claim Filed', 'Warranty', `Service claim logged for S/N under warranty: ${claimData.issueDescription}`, {
      entityId: warrantyId,
      severity: 'warning'
    });

    showToast('Claim Logged', 'Service claim submitted successfully.', 'success');
    return newClaim;
  };

  const updateWarrantyClaimStatus = (warrantyId: string, claimId: string, status: WarrantyServiceRecord['status'], resolutionNotes?: string) => {
    setWarranties(prev => prev.map(w => {
      if (w.id === warrantyId) {
        const updatedRecords = (w.serviceRecords || []).map(r => {
          if (r.id === claimId) {
            return {
              ...r,
              status,
              ...(resolutionNotes ? { resolutionNotes } : {}),
              ...(status === 'Resolved' ? { completedDate: new Date().toISOString().split('T')[0] } : {})
            };
          }
          return r;
        });
        const hasOpenClaims = updatedRecords.some(r => r.status === 'Submitted' || r.status === 'In Repair');
        const updated = {
          ...w,
          status: hasOpenClaims ? ('Claim In Review' as WarrantyStatus) : ('Active' as WarrantyStatus),
          serviceRecords: updatedRecords
        };
        saveFirestoreDoc('warranties', warrantyId, updated);
        return updated;
      }
      return w;
    }));

    showToast('Claim Updated', `Service claim status changed to ${status}.`, 'info');
  };

  const sendWarrantyAlert = (warrantyId: string, channel: 'WhatsApp' | 'Email' | 'SMS') => {
    const targetWarranty = warranties.find(w => w.id === warrantyId);
    if (!targetWarranty) return;

    const todayStr = new Date().toISOString().split('T')[0];
    setWarranties(prev => prev.map(w => {
      if (w.id === warrantyId) {
        const updated = { ...w, lastAlertSentDate: todayStr };
        saveFirestoreDoc('warranties', warrantyId, updated);
        return updated;
      }
      return w;
    }));

    addAuditLog('Warranty Expiration Alert Dispatched', 'Warranty', `Sent ${channel} expiration alert to ${targetWarranty.customerName} for S/N ${targetWarranty.serialNumber} (Exp: ${targetWarranty.warrantyEndDate}).`, {
      entityId: warrantyId,
      severity: 'info'
    });

    showToast('Alert Dispatched', `Warranty alert sent via ${channel} to ${targetWarranty.customerName}.`, 'success');
  };

  const dismissWarrantyAlert = (warrantyId: string) => {
    setWarranties(prev => prev.map(w => {
      if (w.id === warrantyId) {
        const updated = { ...w, expirationAlertDismissed: true };
        saveFirestoreDoc('warranties', warrantyId, updated);
        return updated;
      }
      return w;
    }));
    showToast('Alert Dismissed', 'Warranty expiration alert dismissed for this cycle.', 'info');
  };

  const getWarrantiesForCustomer = (customerId: string) => {
    return warranties.filter(w => w.customerId === customerId);
  };

  const getWarrantyBySerial = (serialNumber: string) => {
    const clean = serialNumber.trim().toLowerCase();
    return warranties.find(w =>
      w.serialNumber.toLowerCase() === clean ||
      w.chassisNumber?.toLowerCase() === clean ||
      w.engineNumber?.toLowerCase() === clean
    );
  };

  // 16. Bulk Action Handlers
  const bulkUpdateProductStatus = async (ids: string[], status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Archived') => {
    if (!ids.length) return;
    await bulkPatchSqlProducts(ids, { status, ...(status === 'Archived' ? { isArchived: true } : {}) }, apiScope.role, apiScope.branchId);
    addAuditLog('Bulk Updated Products', 'Inventory', `Updated status to "${status}" for ${ids.length} product(s).`);
    showToast('Status Updated', `Updated ${ids.length} product(s) to "${status}".`);
    await refreshProducts();
  };

  const bulkArchiveProducts = async (ids: string[], archive = true) => {
    if (!ids.length) return;
    await bulkPatchSqlProducts(ids, { isArchived: archive, status: archive ? 'Archived' : 'In Stock' }, apiScope.role, apiScope.branchId);
    addAuditLog(archive ? 'Bulk Archived Products' : 'Bulk Restored Products', 'Inventory', `${archive ? 'Archived' : 'Restored'} ${ids.length} product(s).`);
    showToast(archive ? 'Products Archived' : 'Products Restored', `${ids.length} product(s) ${archive ? 'moved to archive' : 'restored to active inventory'}.`);
    await refreshProducts();
  };

  const bulkDeleteProducts = async (ids: string[], dryRun = false) => {
    const result = await bulkDeleteSqlProducts(ids, dryRun, apiScope.role, apiScope.branchId);
    if (!dryRun) {
      addAuditLog(
        'Bulk Deleted Products',
        'Inventory',
        `Permanently removed ${result.deleted} item(s) from the product master${result.archived ? `; archived ${result.archived} that have transaction history` : ''}.`,
        { severity: 'warning', entityType: 'Inventory' }
      );
      showToast(
        'Items Removed',
        `${result.deleted} item(s) deleted${result.archived ? `, ${result.archived} archived because they have transaction history` : ''}.`
      );
      await refreshProducts();
    }
    return result;
  };

  const bulkUpdateProductCategory = async (ids: string[], category: ProductCategory) => {
    if (!ids.length) return;
    await bulkPatchSqlProducts(ids, { category }, apiScope.role, apiScope.branchId);
    addAuditLog('Bulk Categorized Products', 'Inventory', `Reassigned ${ids.length} products to category "${category}".`);
    showToast('Category Updated', `${ids.length} product(s) moved to "${category}".`);
    await refreshProducts();
  };

  const bulkUpdateSalesOrderStatus = (ids: string[], status: SalesOrderStatus) => {
    if (!ids.length) return;
    setSalesOrders(prev => prev.map(so => {
      if (ids.includes(so.id)) {
        return { ...so, status };
      }
      return so;
    }));
    addAuditLog('Bulk Updated Orders', 'Sales', `Updated status to "${status}" for ${ids.length} sales order(s).`);
    showToast('Orders Updated', `Updated ${ids.length} sales order(s) to "${status}".`);
  };

  const bulkArchiveSalesOrders = (ids: string[], archive = true) => {
    if (!ids.length) return;
    setSalesOrders(prev => prev.map(so => {
      if (ids.includes(so.id)) {
        return { ...so, isArchived: archive };
      }
      return so;
    }));
    addAuditLog(archive ? 'Bulk Archived Sales Orders' : 'Bulk Restored Sales Orders', 'Sales', `${archive ? 'Archived' : 'Restored'} ${ids.length} sales order(s).`);
    showToast(archive ? 'Orders Archived' : 'Orders Restored', `${ids.length} sales order(s) ${archive ? 'moved to archive' : 'restored'}.`);
  };

  const bulkConfirmSalesOrders = (ids: string[]) => {
    if (!ids.length) return;
    setSalesOrders(prev => prev.map(so => ids.includes(so.id) ? { ...so, status: 'Confirmed' as SalesOrderStatus } : so));
    addAuditLog('Bulk Confirmed Orders', 'Sales', `Confirmed ${ids.length} sales order(s).`);
    showToast('Orders Confirmed', `Confirmed ${ids.length} sales order(s).`);
  };

  const bulkUpdateInvoiceStatus = (ids: string[], status: 'Issued' | 'Paid' | 'Cancelled' | 'Refunded') => {
    if (!ids.length) return;
    setInvoices(prev => prev.map(inv => {
      if (ids.includes(inv.id)) {
        return { ...inv, status, paymentStatus: status === 'Paid' ? 'Paid' : inv.paymentStatus };
      }
      return inv;
    }));
    addAuditLog('Bulk Updated Invoices', 'Billing', `Updated status to "${status}" for ${ids.length} invoice(s).`);
    showToast('Invoices Updated', `Updated ${ids.length} invoice(s) to "${status}".`);
  };

  const bulkArchiveInvoices = (ids: string[], archive = true) => {
    if (!ids.length) return;
    setInvoices(prev => prev.map(inv => {
      if (ids.includes(inv.id)) {
        return { ...inv, isArchived: archive };
      }
      return inv;
    }));
    addAuditLog(archive ? 'Bulk Archived Invoices' : 'Bulk Restored Invoices', 'Billing', `${archive ? 'Archived' : 'Restored'} ${ids.length} invoice(s).`);
    showToast(archive ? 'Invoices Archived' : 'Invoices Restored', `${ids.length} invoice(s) ${archive ? 'moved to archive' : 'restored'}.`);
  };

  // FILTERED DATASETS BASED ON SELECTED BRANCH & WAREHOUSE
  const filteredBranches = branches;

  const filteredWarehouses = useMemo(() => {
    if (selectedBranchId === 'all') return warehouses;
    return warehouses.filter(w => w.branchId === selectedBranchId);
  }, [warehouses, selectedBranchId]);

  const filteredProducts = useMemo(() => {
    if (selectedWarehouseId === 'all' && selectedBranchId === 'all') return products;

    return products.map(p => {
      let filteredStocks = p.warehouseStocks;
      if (selectedWarehouseId !== 'all') {
        filteredStocks = p.warehouseStocks.filter(ws => ws.warehouseId === selectedWarehouseId);
      } else if (selectedBranchId !== 'all') {
        const branchWhIds = warehouses.filter(w => w.branchId === selectedBranchId).map(w => w.id);
        filteredStocks = p.warehouseStocks.filter(ws => branchWhIds.includes(ws.warehouseId));
      }
      return { ...p, warehouseStocks: filteredStocks };
    });
  }, [products, selectedBranchId, selectedWarehouseId, warehouses]);

  // Central directory: the branch selector does not hide customers; a customer's branch is where they were registered.
  const filteredCustomers = customers;

  const filteredSalesOrders = useMemo(() => {
    if (selectedBranchId === 'all') return salesOrders;
    return salesOrders.filter(so => so.branchId === selectedBranchId);
  }, [salesOrders, selectedBranchId]);

  const filteredSales = useMemo(() => {
    if (selectedBranchId === 'all') return sales;
    return sales.filter(s => s.branchId === selectedBranchId);
  }, [sales, selectedBranchId]);

  const filteredInvoices = useMemo(() => {
    if (selectedBranchId === 'all') return invoices;
    return invoices.filter(inv => inv.branchId === selectedBranchId);
  }, [invoices, selectedBranchId]);

  const filteredStockTransfers = useMemo(() => {
    if (selectedBranchId === 'all') return stockTransfers;
    return stockTransfers.filter(tr => tr.fromBranchId === selectedBranchId || tr.toBranchId === selectedBranchId);
  }, [stockTransfers, selectedBranchId]);

  const filteredProjects = useMemo(() => {
    if (selectedBranchId === 'all') return projects;
    return projects.filter(p => p.branchId === selectedBranchId);
  }, [projects, selectedBranchId]);

  const filteredPayments = useMemo(() => {
    if (selectedBranchId === 'all') return payments;
    return payments.filter(p => p.branchId === selectedBranchId);
  }, [payments, selectedBranchId]);

  const filteredExpenses = useMemo(() => {
    if (selectedBranchId === 'all') return expenses;
    return expenses.filter(e => e.branchId === selectedBranchId);
  }, [expenses, selectedBranchId]);

  const filteredWarranties = useMemo(() => {
    if (selectedBranchId === 'all') return warranties;
    return warranties.filter(w => w.branchId === selectedBranchId);
  }, [warranties, selectedBranchId]);

  const expiringWarrantiesCount = useMemo(() => {
    const today = new Date();
    const thirtyDaysAhead = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return filteredWarranties.filter(w => {
      if (w.status === 'Void') return false;
      const isExpiring = w.warrantyEndDate <= thirtyDaysAhead;
      return isExpiring && !w.expirationAlertDismissed;
    }).length;
  }, [filteredWarranties]);

  const filteredNotifications = notifications;

  const currentBranchName = useMemo(() => {
    if (selectedBranchId === 'all') return 'All Branches (Enterprise View)';
    return branches.find(b => b.id === selectedBranchId)?.name || 'Selected Branch';
  }, [selectedBranchId, branches]);

  const currentWarehouseName = useMemo(() => {
    if (selectedWarehouseId === 'all') return 'All Warehouses';
    return warehouses.find(w => w.id === selectedWarehouseId)?.name || 'Selected Warehouse';
  }, [selectedWarehouseId, warehouses]);

  // Aggregate Key Performance Metrics
  const activeMetrics = useMemo(() => {
    const todaySales = filteredSalesOrders.reduce((sum, o) => sum + o.grandTotal, 0);
    const todayIso = new Date().toISOString().split('T')[0];
    const todayPurchases = goodsReceivedNotes.reduce((sum, grn) => {
      if (grn.receivedDate !== todayIso) return sum;
      if (selectedWarehouseId !== 'all' && grn.warehouseId !== selectedWarehouseId) return sum;
      if (selectedBranchId !== 'all') {
        const wh = warehouses.find(w => w.id === grn.warehouseId);
        if (wh?.branchId !== selectedBranchId) return sum;
      }
      return sum + grn.items.reduce((acc, it) => acc + it.acceptedQuantity * it.rate, 0);
    }, 0);
    const totalReceivables = customers.reduce((sum, c) => sum + c.outstandingBalance, 0);
    const totalPayables = suppliers.reduce((sum, s) => sum + s.outstandingPayable, 0);
    
    // Inventory Value
    let inventoryValue = 0;
    products.forEach(p => {
      p.warehouseStocks.forEach(ws => {
        if (selectedWarehouseId !== 'all' && ws.warehouseId !== selectedWarehouseId) return;
        if (selectedBranchId !== 'all') {
          const wh = warehouses.find(w => w.id === ws.warehouseId);
          if (wh?.branchId !== selectedBranchId) return;
        }
        inventoryValue += (ws.available + ws.reserved) * p.purchasePrice;
      });
    });

    const grossProfit = Math.max(0, todaySales - (todaySales * 0.72));

    return {
      todaySales,
      todayPurchases,
      totalReceivables,
      totalPayables,
      inventoryValue,
      grossProfit
    };
  }, [filteredSalesOrders, goodsReceivedNotes, customers, suppliers, products, selectedBranchId, selectedWarehouseId, warehouses]);

  // Categories that were configured plus every category the products already use, so a category typed while adding
  // an item shows up in the lists and filters straight away.
  const mergedCategories = Array.from(
    new Set<string>([...categories, ...products.map((p) => (p.category || '').trim()).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  return (
    <ERPContext.Provider
      value={{
        currentView,
        setCurrentView,
        selectedBranchId,
        setSelectedBranchId,
        selectedWarehouseId,
        setSelectedWarehouseId,
        currentUser,
        setCurrentUser,
        currentRole,
        setCurrentRole,
        theme,
        setTheme,
        toggleTheme,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toggleSidebar,
        isGlobalSearchOpen,
        setIsGlobalSearchOpen,
        isQuickAddOpen,
        setIsQuickAddOpen,
        quickAddInitialTab,
        openQuickAdd,
        isNotificationsOpen,
        setIsNotificationsOpen,
        activeInvoiceForPrint,
        setActiveInvoiceForPrint,
        toasts,
        showToast,
        dismissToast,
        settings,
        updateSettings,
        branches,
        warehouses,
        products,
        activeProducts,
        productsLoading,
        productsError,
        refreshProducts,
        refreshStock,
        branchPersonStockEdit,
        canEditStock,
        setBranchPersonStockEdit,
        stockLoading,
        stockError,
        customers,
        suppliers,
        salesOrders,
        invoices,
        goodsReceivedNotes,
        stockTransfers,
        stockAdjustments,
        stockMovements,
        projects,
        payments,
        expenses,
        chartOfAccounts,
        ledgerEntries,
        employees,
        notifications,
        auditLogs,
        createSalesOrder,
        confirmSalesOrder,
        convertSalesOrderToInvoice,
        createInvoice,
        recordQuickSale,
        sales,
        filteredSales,
        recordInvoicePayment,
        createGoodsReceivedNote,
        createStockTransfer,
        approveStockTransfer,
        dispatchStockTransfer,
        receiveStockTransfer,
        cancelStockTransfer,
        createStockAdjustment,
        issueMaterialToProject,
        recordProjectConsumption,
        recordCustomerPayment,
        recordSupplierPayment,
        addExpense,
        addProduct,
        updateProduct,
        deleteProduct,
        addBranch,
        updateBranch,
        addWarehouse,
        updateWarehouse,
        categories: mergedCategories,
        machineSaleSeedProductId,
        startMachineSale: (productId: string) => {
          setMachineSaleSeedProductId(productId);
          setCurrentView('machine-sales');
        },
        clearMachineSaleSeed: () => setMachineSaleSeedProductId(null),
        addCategory,
        deleteCategory,
        stockStatuses,
        addStockStatus,
        deleteStockStatus,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        saveCustomerEdits,
        refreshCustomers,
        addSupplier,
        updateSupplier,
        addProject,
        updateProject,
        addProjectTask,
        updateProjectTask,
        deleteProjectTask,
        addProjectMilestone,
        updateProjectMilestone,
        deleteProjectMilestone,
        followUpReminders,
        addFollowUpReminder,
        updateFollowUpReminder,
        deleteFollowUpReminder,
        warranties,
        filteredWarranties,
        expiringWarrantiesCount,
        addWarranty,
        updateWarranty,
        deleteWarranty,
        syncMachineWarranty,
        addWarrantyClaim,
        updateWarrantyClaimStatus,
        sendWarrantyAlert,
        dismissWarrantyAlert,
        getWarrantiesForCustomer,
        getWarrantyBySerial,
        markNotificationRead,
        markAllNotificationsRead,
        bulkUpdateProductStatus,
        bulkArchiveProducts,
        bulkUpdateProductCategory,
        bulkDeleteProducts,
        bulkUpdateSalesOrderStatus,
        bulkArchiveSalesOrders,
        bulkConfirmSalesOrders,
        bulkUpdateInvoiceStatus,
        bulkArchiveInvoices,
        filteredBranches,
        filteredWarehouses,
        filteredProducts,
        filteredCustomers,
        filteredSalesOrders,
        filteredInvoices,
        filteredStockTransfers,
        filteredProjects,
        filteredPayments,
        filteredExpenses,
        filteredNotifications,
        currentBranchName,
        currentWarehouseName,
        activeMetrics,
        syncStatus,
        isFirestoreConnected,
        syncNowToFirestore,
        addAuditLog,
        clearAuditLogs
      }}
    >
      {children}
    </ERPContext.Provider>
  );
};

export const useERP = () => {
  const context = useContext(ERPContext);
  if (!context) {
    throw new Error('useERP must be used within an ERPProvider');
  }
  return context;
};
