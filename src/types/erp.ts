export type Role = 
  | 'Super Admin'
  | 'Business Owner'
  | 'Branch Person'
  | 'Branch Manager'
  | 'Accountant'
  | 'Sales Manager'
  | 'Salesperson'
  | 'Purchase Manager'
  | 'Warehouse Manager'
  | 'Warehouse Staff'
  | 'Cashier';

export type ViewType = 
  | 'dashboard'
  | 'sales'
  | 'billing'
  | 'machine-sales'
  | 'stock-ledger'
  | 'inventory'
  | 'warehouses'
  | 'stock-transfers'
  | 'branches'
  | 'customers'
  | 'warranties'
  | 'finance'
  | 'reports'
  | 'employees'
  | 'activity-logs'
  | 'settings'
  | 'spare-books'
  | 'quick-sale'
  | 'follow-ups'
  | 'cash-book'
  | 'history'
  | 'job-cards'
  | 'messages'
  | 'attendance'
  | 'payroll'
  | 'documents'
  | 'access-requests'
  | 'returns'
  | 'predictions'
  | 'desk';

export type ProductUnit = 'Bag' | 'MT' | 'Nos' | 'Kg' | 'Sq.Ft' | 'Cubic Mt' | 'Meter' | 'Bundle' | 'Box' | 'Liter' | 'Piece';

export type ProductCategory = 
  | 'Finished Agricultural Machinery'
  | 'Rotavators & Soil Prep'
  | 'Tractor Implements'
  | 'Power Tillers & Harvesters'
  | 'Rotavator Blades & Fasteners'
  | 'Gearboxes, PTO & Transmissions'
  | 'Hydraulics & Lift Cylinders'
  | 'Diesel Engine & Spares'
  | 'Bearings, Belts & Oil Seals'
  | 'Raw Steel & Castings'
  | 'Cement & Aggregates'
  | 'Steel & Metals'
  | 'Bricks & Blocks'
  | 'Plumbing & Pipes'
  | 'Electrical & Lighting'
  | 'Hardware & Fasteners'
  | 'Tools & Equipment'
  | 'Safety & Protection'
  | 'Paints & Chemicals';

export interface WarehouseStockLocation {
  warehouseId: string;
  rack: string;
  row: string;
  shelf: string;
  bin: string;
  available: number;
  reserved: number;
  inTransit: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  subcategory: string;
  brand: string;
  barcode: string;
  hsnCode: string;
  gstRate: number; // e.g. 18 for 18%
  unit: ProductUnit;
  alternateUnit?: ProductUnit;
  conversionFactor?: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number;
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  description: string;
  warehouseStocks: WarehouseStockLocation[];
  imageUrl?: string;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Archived';
  isArchived?: boolean;
  isSparePart?: boolean;
  compatibleModels?: string[];
  // other names the item is known by; searched everywhere and understood by the voice assistant
  alternateNames?: string[];
  oemPartNumber?: string;
  shelfBinLocation?: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  manager: string;
  gstin: string;
  warehouseIds: string[];
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  employeeCount: number;
  status: 'Active' | 'Inactive';
}

export interface Warehouse {
  id: string;
  branchId: string;
  name: string;
  code: string;
  location: string;
  supervisor: string;
  phone: string;
  capacitySqFt: number;
  utilizationPercentage: number;
  totalProductsCount: number;
  totalStockValue: number;
  lowStockCount: number;
  status: 'Active' | 'Inactive';
}

export type CustomerSegment = 
  | 'Farmers & Cultivators'
  | 'Agro Equipment Dealers & Retailers'
  | 'Agricultural Cooperatives & FPOs'
  | 'Farmer Producer Organizations (FPOs)'
  | 'Agro Spares & Hardware Stores'
  | 'Custom Hiring Centers (CHCs)'
  | 'Sugarcane & Harvesting Contractors'
  | 'Government Krishi & Dept of Agriculture'
  | 'Walk-in Spares Retail'
  | 'Infrastructure & EPC'
  | 'Commercial Real Estate'
  | 'Residential Developers'
  | 'Civil & MEP Contractors'
  | 'Government & Public Works'
  | 'Retail / Walk-in';

export interface Customer {
  id: string;
  customerId?: string;
  name: string;
  companyName: string;
  phone: string;
  alternatePhone?: string;
  email: string;
  address: string;
  locality?: string;
  city: string;
  state?: string;
  pincode?: string;
  gstin: string;
  creditLimit: number;
  creditPeriodDays: number;
  outstandingBalance: number;
  totalSales: number;
  lastTransactionDate: string;
  rating: 'A+' | 'A' | 'B' | 'C';
  status: 'Active' | 'Blocked';
  branchId: string;
  segment?: CustomerSegment;
}

export interface Supplier {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  gstin: string;
  creditPeriodDays: number;
  outstandingPayable: number;
  totalPurchases: number;
  lastPurchaseDate: string;
  paymentTerms: string;
  rating: 'A+' | 'A' | 'B' | number | string;
  status: 'Active' | 'Inactive';
  categoriesSupplied?: string[];
  outstandingPayables?: number;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branchName?: string;
  };
}

export interface OrderItem {
  productId: string;
  productName: string;
  sku: string;
  unit: ProductUnit;
  quantity: number;
  rate: number;
  discountPercent: number;
  taxRate: number; // GST %
  taxAmount: number;
  totalAmount: number;
  hsnCode?: string;
}

export type SalesOrderStatus = 'Draft' | 'Confirmed' | 'Processing' | 'Dispatched' | 'Delivered' | 'Cancelled';
export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid' | 'Overdue';

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  branchId: string;
  warehouseId: string;
  salesperson: string;
  orderDate: string;
  expectedDeliveryDate: string;
  items: OrderItem[];
  subtotal: number;
  totalDiscount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus;
  status: SalesOrderStatus;
  invoiceId?: string;
  notes?: string;
  shippingAddress: string;
  isArchived?: boolean;
  createdAt: string;
}

export interface SaleItem {
  id?: string;
  saleId?: string;
  productId: string;
  productName: string;
  sku: string;
  serialNumber?: string;
  unit: ProductUnit;
  quantity: number;
  unitPrice: number;
  discount: number;
  gst: number;
  lineTotal: number;
  hsnCode?: string;
}

export interface Sale {
  id: string;
  saleNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  branchId: string;
  createdBy: string;
  createdAt: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod: 'Cash' | 'UPI' | 'Bank Transfer';
  // Secondary payment: part of the bill paid another way. The first payment is the total minus this.
  secondaryPaymentMethod?: 'Cash' | 'UPI' | 'Bank Transfer' | null;
  secondaryPaymentAmount?: number;
  paymentStatus: PaymentStatus;
  invoiceId?: string;
  invoiceNumber?: string;
}

export type InvoiceType = 'Tax Invoice' | 'Proforma' | 'Estimate' | 'Credit Note' | 'Debit Note';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  salesOrderId?: string;
  customerId: string;
  customerName: string;
  customerGstin: string;
  billingAddress: string;
  shippingAddress: string;
  branchId: string;
  warehouseId: string;
  invoiceDate: string;
  dueDate: string;
  type: InvoiceType;
  items: OrderItem[];
  subtotal: number;
  totalDiscount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: 'Cash' | 'Bank Transfer' | 'UPI' | 'Cheque' | 'Credit Card';
  status: 'Issued' | 'Paid' | 'Cancelled' | 'Refunded';
  notes?: string;
  terms: string;
  isArchived?: boolean;
}

export interface GoodsReceivedNote {
  id: string;
  grnNumber: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber?: string;
  warehouseId: string;
  receivedDate: string;
  receivedBy: string;
  challanNumber: string;
  items: {
    productId: string;
    productName: string;
    sku: string;
    unit: ProductUnit;
    receivedQuantity: number;
    damagedQuantity: number;
    acceptedQuantity: number;
    rate: number;
    notes?: string;
  }[];
  verifiedBy: string;
  qualityStatus: 'Passed' | 'Partial Discrepancy' | 'Rejected';
  notes?: string;
  isStockUpdated: boolean;
}

export type StockTransferStatus = 
  | 'Draft'
  | 'Requested'
  | 'Approved'
  | 'Dispatched'
  | 'In Transit'
  | 'Partially Received'
  | 'Received'
  | 'Cancelled';

export interface StockTransferItem {
  productId: string;
  productName: string;
  sku: string;
  unit: ProductUnit;
  requestedQty: number;
  dispatchedQty: number;
  receivedQty: number;
  damagedQty: number;
  shortQty: number;
  unitCost: number;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  fromWarehouseId: string;
  toBranchId: string;
  toWarehouseId: string;
  requestedBy: string;
  approvedBy?: string;
  dispatchedBy?: string;
  receivedBy?: string;
  requestDate: string;
  dispatchDate?: string;
  receivedDate?: string;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  items: StockTransferItem[];
  status: StockTransferStatus;
  notes?: string;
  timeline: {
    stage: string;
    date: string;
    user: string;
    notes?: string;
  }[];
}

export interface StockAdjustment {
  id: string;
  adjustmentNumber: string;
  warehouseId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: ProductUnit;
  adjustmentType: 'Increase' | 'Decrease' | 'Recount' | 'Physical Recount' | 'Damaged / Scrap' | 'Expired' | 'Theft / Loss' | 'Internal Use';
  oldStock: number;
  adjustedQty: number; // positive or negative
  newStock: number;
  unitCost: number;
  totalCostImpact: number;
  reason: string;
  adjustedBy: string;
  date: string;
}

export interface StockMovement {
  id: string;
  date: string;
  productId: string;
  productName: string;
  sku: string;
  warehouseId: string;
  movementType: 'Sales Dispatch' | 'Purchase Inward' | 'Transfer Out' | 'Transfer In' | 'Project Issue' | 'Project Return' | 'Adjustment';
  referenceId: string;
  referenceNumber: string;
  quantity: number; // positive for inward, negative for outward
  balanceAfter: number;
  unitCost: number;
  user: string;
}

export type ProjectTaskStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Delayed' | 'Blocked';
export type ProjectTaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface ProjectTask {
  id: string;
  projectId: string;
  phase: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  progress: number; // 0 to 100
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  assignedTo: string;
  assignedRole?: string;
  dependencies: string[]; // IDs of predecessor tasks
  isMilestone: boolean;
  milestoneDeliverable?: string;
  costEstimate?: number;
  actualCost?: number;
  isCriticalPath?: boolean;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  targetDate: string;
  completionDate?: string;
  status: 'Pending' | 'Achieved' | 'Delayed' | 'Critical';
  deliverables: string[];
  associatedTaskId?: string;
  signOffBy?: string;
  billingAmountTrigger?: number;
}

export interface ContractorProject {
  id: string;
  projectNumber: string;
  name: string;
  clientId: string;
  clientName: string;
  location: string;
  branchId: string;
  projectManager: string;
  startDate: string;
  expectedCompletionDate: string;
  actualCompletionDate?: string;
  contractValue: number;
  budgetCost: number;
  actualMaterialCost: number;
  actualLabourCost: number;
  actualExpenseCost: number;
  billedAmount: number;
  receivedAmount: number;
  status: 'Planning' | 'In Progress' | 'On Hold' | 'Completed';
  progressPercentage: number;
  materialIssues: ProjectMaterialIssue[];
  expenses: ProjectExpense[];
  labourLogs: ProjectLabourLog[];
  tasks?: ProjectTask[];
  milestones?: ProjectMilestone[];
  description: string;
}

export interface ProjectMaterialIssue {
  id: string;
  issueNumber: string;
  projectId: string;
  warehouseId: string;
  date: string;
  issuedBy: string;
  receivedBy: string;
  items: {
    productId: string;
    productName: string;
    sku: string;
    unit: ProductUnit;
    issuedQty: number;
    consumedQty: number;
    returnedQty: number;
    wastageQty: number;
    unitCost: number;
    totalCost: number;
  }[];
  totalIssueCost: number;
  status: 'Issued' | 'Fully Consumed' | 'Partially Returned';
}

export interface ProjectExpense {
  id: string;
  projectId: string;
  category: 'Machinery Hire' | 'Fuel & Transport' | 'Subcontractor' | 'Site Utilities' | 'Permits & Fees' | 'Consumables' | 'Other';
  description: string;
  amount: number;
  date: string;
  paidTo: string;
  paymentMode: string;
  receiptUrl?: string;
}

export interface ProjectLabourLog {
  id: string;
  projectId: string;
  date: string;
  contractorName: string;
  workerCount: number;
  skilledCount: number;
  unskilledCount: number;
  dailyCost: number;
  notes: string;
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  type: 'Customer Receipt' | 'Supplier Payment';
  partyId: string;
  partyName: string;
  branchId: string;
  amount: number;
  paymentMethod: 'Cash' | 'Bank Transfer' | 'UPI' | 'Cheque' | 'Card';
  referenceNumber: string;
  date: string;
  invoiceOrPoNumber?: string;
  allocatedInvoices?: { invoiceId: string; invoiceNumber: string; amount: number }[];
  bankAccount: string;
  notes?: string;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  branchId: string;
  category: 'Rent' | 'Electricity & Water' | 'Transport & Freight' | 'Fuel' | 'Salaries' | 'Maintenance & Repair' | 'Office Expenses' | 'Warehouse Operations' | 'Marketing' | 'Misc';
  vendor: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  date: string;
  paidFrom: string;
  paymentMethod: 'Cash' | 'Bank Transfer' | 'UPI' | 'Company Card' | 'Cheque';
  description: string;
  hasAttachment: boolean;
  attachmentName?: string;
  recordedBy: string;
}

export interface AccountLedgerEntry {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  partyType?: 'Customer' | 'Supplier' | 'Bank' | 'Expense' | 'Sales' | 'Purchase';
  partyId?: string;
  partyName?: string;
  voucherType: 'Invoice' | 'Receipt' | 'Payment' | 'Journal' | 'Purchase Bill' | 'Expense';
  voucherNumber: string;
  debit: number;
  credit: number;
  balance: number;
  description: string;
  branchId: string;
}

export interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Direct Cost' | 'Operating Expense';
  category: string;
  balance: number;
  isDebitNormal: boolean;
}

export interface EmployeeUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  branchId: string;
  department: string;
  designation: string;
  joinedDate: string;
  status: 'Active' | 'On Leave' | 'Inactive';
  avatarColor: string;
  lastLogin: string;
}

export interface ERPNotification {
  id: string;
  type: 'low_stock' | 'overdue_payment' | 'po_approval' | 'transfer_dispatch' | 'grn_received' | 'project_alert' | 'invoice_created';
  title: string;
  message: string;
  timestamp: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  read: boolean;
  actionView?: ViewType;
  actionId?: string;
}

export interface ActivityAuditLog {
  id: string;
  timestamp: string;
  user: string;
  role: Role;
  action: string;
  module: string;
  branchName: string;
  details: string;
  ipAddress: string;
  severity?: 'info' | 'warning' | 'critical' | 'success';
  entityId?: string;
  entityType?: 'Invoice' | 'SalesOrder' | 'Inventory' | 'StockTransfer' | 'GRN' | 'Project' | 'Expense' | 'Payment' | 'Customer' | 'Supplier' | 'Settings' | 'Auth' | 'Warranty' | 'Product';
  previousState?: string;
  newState?: string;
}

export type UserRole = Role;
export type Employee = EmployeeUser;
export type Project = ContractorProject;
export type ExpenseCategory = 
  | 'Rent' 
  | 'Electricity & Water' 
  | 'Transport & Freight' 
  | 'Fuel' 
  | 'Salaries' 
  | 'Maintenance & Repair' 
  | 'Office Expenses' 
  | 'Branch Operations' 
  | 'Marketing' 
  | 'Transportation & Freight'
  | 'Branch Rent & Utilities'
  | 'Equipment & Fuel'
  | 'Labor & Loading Wages'
  | 'Administrative'
  | 'Misc';

export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'UPI' | 'Company Card' | 'Cheque' | 'Credit Card' | 'RTGS';

export interface CompanySettings {
  companyName: string;
  tagline: string;
  legalName: string;
  gstin: string;
  panNumber: string;
  email: string;
  phone: string;
  website: string;
  headOfficeAddress: string;
  currencySymbol: string;
  currencyCode: string;
  dateFormat: string;
  invoicePrefix: string;
  poPrefix: string;
  soPrefix: string;
  transferPrefix: string;
  grnPrefix: string;
  projectPrefix: string;
  defaultTaxRate: number;
  bankDetails: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branchName: string;
    upiId: string;
  };
}

export interface InvoiceFollowUpReminder {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amountDue: number;
  reminderDate: string;
  reminderType: 'Call' | 'Email' | 'WhatsApp' | 'In-Person Visit' | 'Formal Notice';
  priority: 'High' | 'Medium' | 'Low';
  notes: string;
  status: 'Pending' | 'Completed' | 'Dismissed';
  createdAt: string;
  assignedTo?: string;
}

export type WarrantyStatus = 'Active' | 'Expiring Soon' | 'Expired' | 'Void' | 'Claim In Review';

export interface WarrantyServiceRecord {
  id: string;
  claimDate: string;
  issueDescription: string;
  technicianName: string;
  resolutionNotes?: string;
  replacedParts?: string[];
  claimCost: number;
  status: 'Submitted' | 'Approved' | 'In Repair' | 'Resolved' | 'Rejected';
  completedDate?: string;
}

export interface ProductWarranty {
  id: string;
  warrantyCode: string;
  serialNumber: string; // Engine / Chassis / Gearbox / Frame Serial
  chassisNumber?: string;
  engineNumber?: string;
  productId: string;
  productName: string;
  productSku: string;
  productCategory: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  branchId: string;
  branchName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  purchaseDate: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
  durationMonths: number;
  coverageType: 'Full Comprehensive' | 'Powertrain & Gearbox' | 'Manufacturing Defects' | 'Spares & Labor' | 'Extended Warranty';
  status: WarrantyStatus;
  notes?: string;
  serviceRecords: WarrantyServiceRecord[];
  expirationAlertDismissed?: boolean;
  lastAlertSentDate?: string;
  createdAt: string;
}

export interface SpareBookIndexItem {
  id: string | number;
  bookId: string;
  pageNumber: number;
  productName: string;
  itemNumber: string; // SKU or internal part no
  oemNumber?: string;
  hsnCode: string;
  matchedProductId?: string;
  productId?: string;
  partDiagramRef?: string;
  spareBookTitle?: string;
  description?: string;
  sellingPrice?: number;
  availableStock?: number;
}

export interface SpareBookPage {
  pageNumber: number;
  title: string;
  section: string;
  diagramTitle?: string;
  diagramUrl?: string;
  rawOcrText: string;
  items: SpareBookIndexItem[];
}

export interface SpareBook {
  id: string;
  title: string;
  equipmentType?: 'Rotavator' | 'Baler' | 'Power Tiller' | 'Hydraulics' | 'Tractor Implement' | 'Other Equipment';
  equipmentCategory?: string;
  modelNumber?: string;
  modelSeries?: string;
  description?: string;
  totalPages: number;
  fileUrl?: string;
  pdfUrl?: string;
  fileName?: string;
  fileSizeKb?: number;
  fileSizeMb?: number;
  isOcrProcessed?: boolean;
  isScanned?: boolean;
  ocrIndexed?: boolean;
  indexedItemsCount?: number;
  uploadDate?: string;
  createdAt?: string;
  version?: string;
  pages?: SpareBookPage[];
}

