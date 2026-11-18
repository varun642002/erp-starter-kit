import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique
} from 'drizzle-orm/pg-core';

// Users table linked to Firebase Auth UID
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').default('Business Owner').notNull(),
  branchId: text('branch_id'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Categories table
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isSpareCategory: boolean('is_spare_category').default(false).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Products Master Table (Equipment, Implements & Spares)
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    sku: text('sku').notNull().unique(), // Item Number / Code
    name: text('name').notNull(),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    brand: text('brand').default('Acme Genuine Spares'),
    barcode: text('barcode'),
    hsnCode: text('hsn_code').default('8432'),
    gstRate: integer('gst_rate').default(18).notNull(),
    unit: text('unit').default('Nos').notNull(),
    alternateUnit: text('alternate_unit'),
    conversionFactor: doublePrecision('conversion_factor'),
    purchasePrice: doublePrecision('purchase_price').default(0).notNull(),
    sellingPrice: doublePrecision('selling_price').default(0).notNull(),
    mrp: doublePrecision('mrp').default(0).notNull(),
    minStock: integer('min_stock').default(10).notNull(),
    maxStock: integer('max_stock').default(100).notNull(),
    reorderLevel: integer('reorder_level').default(15).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    status: text('status').default('In Stock').notNull(), // In Stock, Low Stock, Out of Stock, Archived
    isArchived: boolean('is_archived').default(false).notNull(),
    isSparePart: boolean('is_spare_part').default(false).notNull(),
    compatibleModels: text('compatible_models'), // comma-separated or text list
    oemPartNumber: text('oem_part_number'),
    shelfBinLocation: text('shelf_bin_location'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_products_sku').on(table.sku),
    index('idx_products_name').on(table.name),
    index('idx_products_category').on(table.category),
    index('idx_products_hsn').on(table.hsnCode),
    index('idx_products_oem').on(table.oemPartNumber),
    index('idx_products_is_spare').on(table.isSparePart)
  ]
);

// Customers Master Table
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').unique(), // Display Customer ID e.g. CUST-001
    companyName: text('company_name').notNull(),
    name: text('name'), // Contact person
    phone: text('phone').notNull(),
    alternatePhone: text('alternate_phone'),
    email: text('email'),
    address: text('address'),
    locality: text('locality'),
    city: text('city'),
    state: text('state').default('Tamil Nadu'),
    pincode: text('pincode'),
    gstin: text('gstin'),
    branchId: text('branch_id'),
    creditLimit: doublePrecision('credit_limit').default(500000).notNull(),
    creditPeriodDays: integer('credit_period_days').default(30).notNull(),
    outstandingBalance: doublePrecision('outstanding_balance').default(0).notNull(),
    rating: text('rating').default('A'),
    lastTransactionDate: text('last_transaction_date'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_customers_phone').on(table.phone),
    index('idx_customers_company_name').on(table.companyName),
    index('idx_customers_customer_id').on(table.customerId),
    index('idx_customers_gstin').on(table.gstin),
    index('idx_customers_branch').on(table.branchId)
  ]
);

// Branches Table
export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  address: text('address'),
  phone: text('phone'),
  gstin: text('gstin'),
  manager: text('manager'),
  email: text('email'),
  status: text('status').default('Active').notNull(), // Active | Inactive
  isHeadOffice: boolean('is_head_office').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Warehouses Table
export const warehouses = pgTable('warehouses', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  branchId: text('branch_id').references(() => branches.id),
  type: text('type').default('Warehouse'),
  capacity: text('capacity'),
  address: text('address'),
  manager: text('manager'),
  phone: text('phone'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Warehouse Stock Locations & Inventories
export const warehouseStocks = pgTable(
  'warehouse_stocks',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    warehouseId: text('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    rack: text('rack'),
    row: text('row'),
    shelf: text('shelf'),
    bin: text('bin'),
    available: integer('available').default(0).notNull(),
    reserved: integer('reserved').default(0).notNull(),
    inTransit: integer('in_transit').default(0).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_warehouse_stocks_prod').on(table.productId),
    index('idx_warehouse_stocks_wh').on(table.warehouseId),
    unique('uq_warehouse_stocks_prod_wh').on(table.productId, table.warehouseId)
  ]
);

// Sales Orders Table
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: text('id').primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    branchId: text('branch_id'),
    warehouseId: text('warehouse_id'),
    salesperson: text('salesperson'),
    orderDate: text('order_date').notNull(),
    expectedDeliveryDate: text('expected_delivery_date'),
    subtotal: doublePrecision('subtotal').default(0).notNull(),
    totalDiscount: doublePrecision('total_discount').default(0).notNull(),
    taxAmount: doublePrecision('tax_amount').default(0).notNull(),
    grandTotal: doublePrecision('grand_total').default(0).notNull(),
    paidAmount: doublePrecision('paid_amount').default(0).notNull(),
    balanceAmount: doublePrecision('balance_amount').default(0).notNull(),
    paymentStatus: text('payment_status').default('Unpaid').notNull(),
    status: text('status').default('Confirmed').notNull(),
    shippingAddress: text('shipping_address'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_sales_orders_num').on(table.orderNumber),
    index('idx_sales_orders_cust').on(table.customerId),
    index('idx_sales_orders_date').on(table.orderDate)
  ]
);

// Sales Order Items Table
export const salesOrderItems = pgTable('sales_order_items', {
  id: serial('id').primaryKey(),
  salesOrderId: text('sales_order_id')
    .references(() => salesOrders.id, { onDelete: 'cascade' })
    .notNull(),
  productId: text('product_id').references(() => products.id),
  productName: text('product_name').notNull(),
  sku: text('sku').notNull(),
  unit: text('unit').default('Nos').notNull(),
  quantity: integer('quantity').notNull(),
  rate: doublePrecision('rate').notNull(),
  discountPercent: doublePrecision('discount_percent').default(0).notNull(),
  taxRate: doublePrecision('tax_rate').default(18).notNull(),
  taxAmount: doublePrecision('tax_amount').default(0).notNull(),
  totalAmount: doublePrecision('total_amount').notNull(),
  hsnCode: text('hsn_code')
});

// Invoices Table
export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    salesOrderId: text('sales_order_id'),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    branchId: text('branch_id'),
    invoiceDate: text('invoice_date').notNull(),
    dueDate: text('due_date'),
    subtotal: doublePrecision('subtotal').default(0).notNull(),
    totalDiscount: doublePrecision('total_discount').default(0).notNull(),
    cgst: doublePrecision('cgst').default(0).notNull(),
    sgst: doublePrecision('sgst').default(0).notNull(),
    igst: doublePrecision('igst').default(0).notNull(),
    grandTotal: doublePrecision('grand_total').default(0).notNull(),
    paidAmount: doublePrecision('paid_amount').default(0).notNull(),
    balanceAmount: doublePrecision('balance_amount').default(0).notNull(),
    paymentStatus: text('payment_status').default('Unpaid').notNull(),
    status: text('status').default('Issued').notNull(),
    irn: text('irn'),
    eWayBillNumber: text('e_way_bill_number'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_invoices_num').on(table.invoiceNumber),
    index('idx_invoices_cust').on(table.customerId),
    index('idx_invoices_date').on(table.invoiceDate)
  ]
);

// Sales Table (Fast Quick Sales - Multi-Item Relational Structure)
export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    saleNumber: text('sale_number').notNull().unique(),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    branchId: text('branch_id'),
    createdBy: text('created_by'),
    subtotal: doublePrecision('subtotal').default(0).notNull(),
    discount: doublePrecision('discount').default(0).notNull(),
    gst: doublePrecision('gst').default(0).notNull(),
    grandTotal: doublePrecision('grand_total').default(0).notNull(),
    paymentMethod: text('payment_method').default('Cash').notNull(), // the first payment's method
    // Secondary payment: part of the bill paid another way (for example UPI first, the rest in cash).
    paymentMethod2: text('payment_method_2'),
    paymentAmount2: doublePrecision('payment_amount_2').default(0).notNull(), // the first payment is grand total minus this
    paymentStatus: text('payment_status').default('Paid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_sales_num').on(table.saleNumber),
    index('idx_sales_cust').on(table.customerId),
    index('idx_sales_branch').on(table.branchId)
  ]
);

// Sale Items Table (Relational One Sale - Many Items)
export const saleItems = pgTable('sale_items', {
  id: serial('id').primaryKey(),
  saleId: text('sale_id')
    .references(() => sales.id, { onDelete: 'cascade' })
    .notNull(),
  productId: text('product_id').references(() => products.id),
  productName: text('product_name').notNull(),
  sku: text('sku'),
  serialNumber: text('serial_number'),
  quantity: integer('quantity').notNull(), // counted in `unit` (for example 2 boxes)
  // The unit this line was sold in, and how many of the product's own unit it holds (a Box of 18 blades = 18).
  unit: text('unit'),
  unitFactor: doublePrecision('unit_factor').default(1).notNull(),
  unitPrice: doublePrecision('unit_price').notNull(),
  discount: doublePrecision('discount').default(0).notNull(),
  gst: doublePrecision('gst').default(0).notNull(),
  lineTotal: doublePrecision('line_total').notNull(),
  hsnCode: text('hsn_code')
});

// Suppliers Master Table
export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  companyName: text('company_name').notNull(),
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  gstin: text('gstin'),
  materialsSupplied: text('materials_supplied'),
  rating: text('rating').default('A'),
  outstandingPayable: doublePrecision('outstanding_payable').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Warranties & Serials Master Table
export const warranties = pgTable(
  'warranties',
  {
    id: text('id').primaryKey(),
    serialNumber: text('serial_number').notNull().unique(),
    productId: text('product_id').references(() => products.id),
    productName: text('product_name').notNull(),
    engineNumber: text('engine_number'),
    chassisNumber: text('chassis_number'),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    purchaseDate: text('purchase_date').notNull(),
    warrantyExpiryDate: text('warranty_expiry_date').notNull(),
    status: text('status').default('Active').notNull(),
    serviceRecords: text('service_records'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_warranties_serial').on(table.serialNumber),
    index('idx_warranties_prod').on(table.productId),
    index('idx_warranties_cust').on(table.customerId)
  ]
);

// Stock Transfers Table
export const stockTransfers = pgTable('stock_transfers', {
  id: text('id').primaryKey(),
  transferNumber: text('transfer_number').notNull().unique(),
  fromWarehouseId: text('from_warehouse_id').references(() => warehouses.id),
  toWarehouseId: text('to_warehouse_id').references(() => warehouses.id),
  requestedBy: text('requested_by'),
  requestDate: text('request_date').notNull(),
  status: text('status').default('Requested').notNull(),
  notes: text('notes'),
  itemsJson: text('items_json'), // Serialized transfer items
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Follow-ups Table
export const followUps = pgTable(
  'follow_ups',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id'),
    invoiceNumber: text('invoice_number'),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    branchId: text('branch_id').notNull(),
    amountDue: doublePrecision('amount_due').default(0).notNull(),
    reminderDate: text('reminder_date').notNull(),
    reminderType: text('reminder_type').default('Call').notNull(),
    priority: text('priority').default('Medium').notNull(),
    notes: text('notes'),
    status: text('status').default('Pending').notNull(),
    assignedTo: text('assigned_to'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('idx_follow_ups_branch').on(table.branchId),
    index('idx_follow_ups_status').on(table.status),
    index('idx_follow_ups_cust').on(table.customerId)
  ]
);

// Relations Definition
export const usersRelations = relations(users, ({}) => ({}));

export const productsRelations = relations(products, ({ many }) => ({
  warehouseStocks: many(warehouseStocks),
  orderItems: many(salesOrderItems),
  warranties: many(warranties)
}));

export const customersRelations = relations(customers, ({ many }) => ({
  salesOrders: many(salesOrders),
  invoices: many(invoices),
  warranties: many(warranties)
}));

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  branch: one(branches, {
    fields: [warehouses.branchId],
    references: [branches.id]
  }),
  stocks: many(warehouseStocks)
}));

export const warehouseStocksRelations = relations(warehouseStocks, ({ one }) => ({
  product: one(products, {
    fields: [warehouseStocks.productId],
    references: [products.id]
  }),
  warehouse: one(warehouses, {
    fields: [warehouseStocks.warehouseId],
    references: [warehouses.id]
  })
}));

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [salesOrders.customerId],
    references: [customers.id]
  }),
  items: many(salesOrderItems)
}));

export const salesOrderItemsRelations = relations(salesOrderItems, ({ one }) => ({
  order: one(salesOrders, {
    fields: [salesOrderItems.salesOrderId],
    references: [salesOrders.id]
  }),
  product: one(products, {
    fields: [salesOrderItems.productId],
    references: [products.id]
  })
}));
