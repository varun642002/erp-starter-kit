import { index, integer, doublePrecision, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Append-only stock ledger: every change to warehouse_stocks writes exactly one row here.
// type: receipt | transfer-out | transfer-in | adjustment | sale | service-part | document-sale
//       | transfer-damage | transfer-short | opening
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    branchId: text('branch_id'),
    type: text('type').notNull(),
    availableDelta: integer('available_delta').default(0).notNull(),
    reservedDelta: integer('reserved_delta').default(0).notNull(),
    inTransitDelta: integer('in_transit_delta').default(0).notNull(),
    balanceAfter: integer('balance_after').notNull(), // available after the change
    refType: text('ref_type'),
    refId: text('ref_id'),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_stock_movements_prod_wh_at').on(t.productId, t.warehouseId, t.createdAt),
    index('idx_stock_movements_branch_at').on(t.branchId, t.createdAt),
    index('idx_stock_movements_ref').on(t.refType, t.refId)
  ]
);

// Goods received at the Head Office (wh-1) from a supplier.
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: text('id').primaryKey(),
    grnNumber: text('grn_number').notNull().unique(),
    supplierId: text('supplier_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    supplierInvoiceNumber: text('supplier_invoice_number'),
    challanNumber: text('challan_number').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    receivedDate: text('received_date').notNull(), // YYYY-MM-DD
    receivedBy: text('received_by').notNull(),
    verifiedBy: text('verified_by').notNull(),
    qualityStatus: text('quality_status').notNull(), // Passed | Partial Discrepancy | Rejected
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_goods_receipts_date').on(t.receivedDate), index('idx_goods_receipts_supplier').on(t.supplierId)]
);

export const goodsReceiptItems = pgTable(
  'goods_receipt_items',
  {
    id: serial('id').primaryKey(),
    receiptId: text('receipt_id')
      .references(() => goodsReceipts.id, { onDelete: 'cascade' })
      .notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unit: text('unit').notNull(),
    receivedQuantity: integer('received_quantity').notNull(),
    damagedQuantity: integer('damaged_quantity').default(0).notNull(),
    acceptedQuantity: integer('accepted_quantity').notNull(),
    rate: doublePrecision('rate').default(0).notNull(),
    notes: text('notes')
  },
  (t) => [index('idx_goods_receipt_items_receipt').on(t.receiptId)]
);

// Manual stock corrections (count differences, damage, write-offs).
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: text('id').primaryKey(),
    adjustmentNumber: text('adjustment_number').notNull().unique(),
    warehouseId: text('warehouse_id').notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unit: text('unit').notNull(),
    adjustmentType: text('adjustment_type').notNull(), // Increase | Decrease | Recount
    oldStock: integer('old_stock').notNull(),
    adjustedQty: integer('adjusted_qty').notNull(), // signed
    newStock: integer('new_stock').notNull(),
    unitCost: doublePrecision('unit_cost').default(0).notNull(),
    totalCostImpact: doublePrecision('total_cost_impact').default(0).notNull(),
    reason: text('reason').notNull(),
    adjustedBy: text('adjusted_by').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_stock_adjustments_wh_prod').on(t.warehouseId, t.productId),
    index('idx_stock_adjustments_created').on(t.createdAt)
  ]
);

// Head Office -> branch transfers.
// status: Requested | Approved | In Transit | Received | Cancelled
export const stockTransferOrders = pgTable(
  'stock_transfer_orders',
  {
    id: text('id').primaryKey(),
    transferNumber: text('transfer_number').notNull().unique(),
    fromBranchId: text('from_branch_id').notNull(),
    fromWarehouseId: text('from_warehouse_id').notNull(),
    toBranchId: text('to_branch_id').notNull(),
    toWarehouseId: text('to_warehouse_id').notNull(),
    status: text('status').default('Requested').notNull(),
    requestedBy: text('requested_by').notNull(),
    approvedBy: text('approved_by'),
    dispatchedBy: text('dispatched_by'),
    receivedBy: text('received_by'),
    requestDate: text('request_date').notNull(),
    dispatchDate: text('dispatch_date'),
    receivedDate: text('received_date'),
    vehicleNumber: text('vehicle_number'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_stock_transfer_orders_from').on(t.fromBranchId),
    index('idx_stock_transfer_orders_to').on(t.toBranchId),
    index('idx_stock_transfer_orders_status').on(t.status)
  ]
);

export const stockTransferItems = pgTable(
  'stock_transfer_items',
  {
    id: serial('id').primaryKey(),
    transferId: text('transfer_id')
      .references(() => stockTransferOrders.id, { onDelete: 'cascade' })
      .notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unit: text('unit').notNull(),
    requestedQty: integer('requested_qty').notNull(),
    dispatchedQty: integer('dispatched_qty').default(0).notNull(),
    receivedQty: integer('received_qty').default(0).notNull(),
    damagedQty: integer('damaged_qty').default(0).notNull(),
    shortQty: integer('short_qty').default(0).notNull(),
    unitCost: doublePrecision('unit_cost').default(0).notNull()
  },
  (t) => [index('idx_stock_transfer_items_transfer').on(t.transferId)]
);

export const stockTransferEvents = pgTable(
  'stock_transfer_events',
  {
    id: serial('id').primaryKey(),
    transferId: text('transfer_id')
      .references(() => stockTransferOrders.id, { onDelete: 'cascade' })
      .notNull(),
    stage: text('stage').notNull(),
    date: timestamp('date').defaultNow().notNull(),
    user: text('user_name').notNull(), // "user" is a reserved word in Postgres
    notes: text('notes')
  },
  (t) => [index('idx_stock_transfer_events_transfer').on(t.transferId)]
);
