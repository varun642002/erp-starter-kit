// Fictional sample data. Every name, number, address and tax id below is invented.
// It is used only to fill an EMPTY database when SEED_SAMPLE_DATA=1 and as a first-render fallback.
// Replace it with your own starting data (or delete the entries) when you adapt this project.
import {
  Product,
  Branch,
  Warehouse,
  Customer,
  Supplier,
  SalesOrder,
  Invoice,
  GoodsReceivedNote,
  StockTransfer,
  ContractorProject,
  PaymentReceipt,
  Expense,
  ChartOfAccount,
  AccountLedgerEntry,
  EmployeeUser,
  ERPNotification,
  ActivityAuditLog,
  CompanySettings,
  SpareBook,
  SpareBookIndexItem
} from '../types/erp';

export const initialCompanySettings: CompanySettings = {
  companyName: 'Acme Agro Equipment',
  tagline: 'Your tagline here',
  legalName: 'Acme Agro Equipment Pvt Ltd',
  gstin: '00AAAAA0000A1Z0',
  panNumber: 'AAAAA0000A',
  email: 'info@example.com',
  phone: '+00 00000 00000',
  website: 'https://example.com',
  headOfficeAddress: '1 Sample Road, Sampletown, Sample State - 000000',
  currencySymbol: '₹',
  currencyCode: 'INR',
  dateFormat: 'DD/MM/YYYY',
  invoicePrefix: 'INV-2026-',
  poPrefix: 'PO-2026-',
  soPrefix: 'SO-2026-',
  transferPrefix: 'TR-2026-',
  grnPrefix: 'GRN-2026-',
  projectPrefix: 'MO-2026-',
  defaultTaxRate: 12,
  bankDetails: {
    bankName: 'Sample Bank',
    accountNumber: '000000000000',
    ifscCode: 'SAMP0000000',
    branchName: 'Sample Branch',
    upiId: 'sample@upi'
  }
};

export const initialBranches: Branch[] = [
  {
    id: 'branch-1',
    name: 'Head Office, Sampletown',
    code: 'BR-HO-01',
    address: '1 Sample Road, Sampletown - 000000',
    city: 'Sampletown',
    state: 'Sample State',
    phone: '+00 00000 00001',
    email: '',
    manager: 'A. Owner (Managing Director)',
    gstin: '00AAAAA0000A1Z0',
    warehouseIds: ['wh-1'],
    totalSales: 0,
    totalPurchases: 0,
    totalExpenses: 0,
    employeeCount: 3,
    status: 'Active'
  },
  {
    id: 'branch-2',
    name: 'Second Branch, Exampleville',
    code: 'BR-EX-02',
    address: '2 Example Street, Exampleville',
    city: 'Exampleville',
    state: 'Sample State',
    phone: '',
    email: '',
    manager: 'B. Manager',
    gstin: '00AAAAA0000A2Z9',
    warehouseIds: ['wh-2'],
    totalSales: 0,
    totalPurchases: 0,
    totalExpenses: 0,
    employeeCount: 1,
    status: 'Active'
  }
];

export const initialWarehouses: Warehouse[] = [
  {
    id: 'wh-1',
    branchId: 'branch-1',
    name: 'Head Office Store',
    code: 'BR-HO-01',
    location: '1 Sample Road',
    supervisor: 'C. Supervisor',
    phone: '',
    capacitySqFt: 10000,
    utilizationPercentage: 0,
    totalProductsCount: 5,
    totalStockValue: 0,
    lowStockCount: 0,
    status: 'Active'
  },
  {
    id: 'wh-2',
    branchId: 'branch-2',
    name: 'Second Branch Store',
    code: 'BR-EX-02',
    location: '2 Example Street',
    supervisor: 'D. Supervisor',
    phone: '',
    capacitySqFt: 5000,
    utilizationPercentage: 0,
    totalProductsCount: 5,
    totalStockValue: 0,
    lowStockCount: 0,
    status: 'Active'
  }
];

const sampleProduct = (
  n: number,
  sku: string,
  name: string,
  category: Product['category'],
  purchasePrice: number,
  sellingPrice: number,
  mrp: number,
  stock1: number,
  stock2: number
): Product => ({
  id: `prod-${n}`,
  sku,
  name,
  category,
  subcategory: 'General',
  brand: 'Acme',
  barcode: `000000000000${n}`.slice(-12),
  hsnCode: '8432',
  gstRate: 12,
  unit: 'Nos',
  purchasePrice,
  sellingPrice,
  mrp,
  minStock: 5,
  maxStock: 50,
  reorderLevel: 10,
  description: 'Sample product. Replace with your own catalogue.',
  status: 'In Stock',
  createdAt: '2026-01-01',
  warehouseStocks: [
    { warehouseId: 'wh-1', rack: 'A', row: '01', shelf: 'GND', bin: `A-${n}01`, available: stock1, reserved: 0, inTransit: 0 },
    { warehouseId: 'wh-2', rack: 'A', row: '01', shelf: 'GND', bin: `A-${n}02`, available: stock2, reserved: 0, inTransit: 0 }
  ]
});

export const initialProducts: Product[] = [
  sampleProduct(1, 'SAMPLE-001', 'Sample Rotavator 7-Feet', 'Rotavators & Soil Prep', 80000, 100000, 105000, 12, 6),
  sampleProduct(2, 'SAMPLE-002', 'Sample Cultivator 9-Tyne', 'Tractor Implements', 40000, 52000, 55000, 9, 4),
  sampleProduct(3, 'SAMPLE-003', 'Sample Hydraulic Pump', 'Hydraulics & Lift Cylinders', 3000, 4200, 4500, 40, 15),
  sampleProduct(4, 'SAMPLE-004', 'Sample Oil Seal 85x110x12', 'Bearings, Belts & Oil Seals', 90, 150, 170, 120, 60),
  sampleProduct(5, 'SAMPLE-005', 'Sample Blade Bolt M12x35', 'Rotavator Blades & Fasteners', 12, 22, 25, 400, 200)
];

export const initialCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'Sample Customer One',
    companyName: 'Sample Farm Supplies',
    phone: '+00 00000 11111',
    email: 'customer1@example.com',
    address: '10 Sample Lane',
    city: 'Sampletown',
    gstin: '00AAAAA1111A1Z1',
    creditLimit: 100000,
    creditPeriodDays: 30,
    outstandingBalance: 0,
    totalSales: 0,
    lastTransactionDate: '2026-01-01',
    rating: 'A',
    status: 'Active',
    branchId: 'branch-1',
    segment: 'Agro Equipment Dealers & Retailers'
  },
  {
    id: 'cust-2',
    name: 'Sample Customer Two',
    companyName: 'Example Growers Co-op',
    phone: '+00 00000 22222',
    email: 'customer2@example.com',
    address: '20 Example Road',
    city: 'Exampleville',
    gstin: '00AAAAA2222A1Z2',
    creditLimit: 50000,
    creditPeriodDays: 15,
    outstandingBalance: 0,
    totalSales: 0,
    lastTransactionDate: '2026-01-01',
    rating: 'B',
    status: 'Active',
    branchId: 'branch-2',
    segment: 'Farmers & Cultivators'
  }
];

export const initialSuppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Sample Forgings Ltd',
    companyName: 'Sample Forgings Ltd',
    phone: '+00 00000 33333',
    email: 'orders@example.com',
    address: '30 Industrial Estate',
    city: 'Sample City',
    gstin: '00AAAAA3333A1Z3',
    creditPeriodDays: 30,
    outstandingPayable: 0,
    outstandingPayables: 0,
    totalPurchases: 0,
    lastPurchaseDate: '2026-01-01',
    paymentTerms: 'Net 30 days',
    rating: 'A',
    status: 'Active',
    categoriesSupplied: ['Rotavator Blades & Fasteners'],
    bankDetails: {
      bankName: 'Sample Bank',
      accountNumber: '000000000000',
      ifscCode: 'SAMP0000000',
      branchName: 'Sample Branch'
    }
  }
];

export const initialSalesOrders: SalesOrder[] = [];
export const initialInvoices: Invoice[] = [];
export const initialGoodsReceived: GoodsReceivedNote[] = [];
export const initialStockTransfers: StockTransfer[] = [];
export const initialProjects: ContractorProject[] = [];
export const initialPayments: PaymentReceipt[] = [];
export const initialExpenses: Expense[] = [];

export const initialChartOfAccounts: ChartOfAccount[] = [
  { id: 'acc-1', code: '1000', name: 'Cash on Hand', type: 'Asset', category: 'Current Assets', balance: 0, isDebitNormal: true },
  { id: 'acc-2', code: '1010', name: 'Bank Current A/c', type: 'Asset', category: 'Current Assets', balance: 0, isDebitNormal: true },
  { id: 'acc-3', code: '1100', name: 'Accounts Receivable (Trade Debtors)', type: 'Asset', category: 'Current Assets', balance: 0, isDebitNormal: true },
  { id: 'acc-4', code: '1200', name: 'Inventory Asset (Stock on Hand)', type: 'Asset', category: 'Current Assets', balance: 0, isDebitNormal: true },
  { id: 'acc-5', code: '2000', name: 'Accounts Payable (Trade Creditors)', type: 'Liability', category: 'Current Liabilities', balance: 0, isDebitNormal: false },
  { id: 'acc-6', code: '2100', name: 'GST Output Payable (CGST/SGST/IGST)', type: 'Liability', category: 'Current Liabilities', balance: 0, isDebitNormal: false },
  { id: 'acc-7', code: '3000', name: "Owner's Capital & Reserves", type: 'Equity', category: 'Equity', balance: 0, isDebitNormal: false },
  { id: 'acc-8', code: '4000', name: 'Sales Revenue', type: 'Revenue', category: 'Operating Income', balance: 0, isDebitNormal: false },
  { id: 'acc-9', code: '5000', name: 'Cost of Goods Sold', type: 'Direct Cost', category: 'Cost of Sales', balance: 0, isDebitNormal: true },
  { id: 'acc-10', code: '6000', name: 'Operating Expenses (Rent/Power/Salaries)', type: 'Operating Expense', category: 'Overheads', balance: 0, isDebitNormal: true }
];

export const initialLedgerEntries: AccountLedgerEntry[] = [];

export const initialEmployees: EmployeeUser[] = [
  {
    id: 'emp-1',
    name: 'A. Owner (Managing Director)',
    email: 'owner@example.com',
    phone: '+00 00000 44441',
    role: 'Business Owner',
    branchId: 'branch-1',
    department: 'Executive Management',
    designation: 'Managing Director',
    joinedDate: '2020-01-01',
    status: 'Active',
    avatarColor: 'bg-emerald-700',
    lastLogin: ''
  },
  {
    id: 'emp-2',
    name: 'B. Manager (Second Branch)',
    email: 'branch2@example.com',
    phone: '+00 00000 44442',
    role: 'Branch Person',
    branchId: 'branch-2',
    department: 'Branch Operations',
    designation: 'Branch Sales & Billing In-Charge',
    joinedDate: '2021-01-01',
    status: 'Active',
    avatarColor: 'bg-blue-600',
    lastLogin: ''
  },
  {
    id: 'emp-3',
    name: 'E. Accountant',
    email: 'accounts@example.com',
    phone: '+00 00000 44443',
    role: 'Accountant',
    branchId: 'branch-1',
    department: 'Finance',
    designation: 'Accountant',
    joinedDate: '2021-06-01',
    status: 'Active',
    avatarColor: 'bg-violet-600',
    lastLogin: ''
  }
];

export const initialNotifications: ERPNotification[] = [];
export const initialAuditLogs: ActivityAuditLog[] = [];
export const initialWarranties: import('../types/erp').ProductWarranty[] = [];
export const initialSpareBooks: SpareBook[] = [];
export const initialSpareBookIndex: SpareBookIndexItem[] = [];
