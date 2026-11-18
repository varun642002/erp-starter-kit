import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// Machine (tractor, rotavator, tiller...) sales with a booking -> delivery workflow.
// status: Booked | Ready for Delivery | Dispatched | Delivered | Cancelled
export const machineSales = pgTable(
  'machine_sales',
  {
    id: text('id').primaryKey(),
    saleNumber: text('sale_number').notNull().unique(), // MS-YYYY-####
    branchId: text('branch_id').notNull(),
    companyId: text('company_id').default('main').notNull(), // main | second
    status: text('status').default('Booked').notNull(),

    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerAddress: text('customer_address'),
    customerGstin: text('customer_gstin'),

    productId: text('product_id'),
    machineName: text('machine_name').notNull(),
    model: text('model'),
    sku: text('sku'),
    serialNumber: text('serial_number'),
    engineNumber: text('engine_number'),
    chassisNumber: text('chassis_number'),

    listPrice: doublePrecision('list_price').default(0).notNull(),
    discount: doublePrecision('discount').default(0).notNull(),
    salePrice: doublePrecision('sale_price').notNull(), // final agreed price incl. tax
    // gstRate 0 = sold without GST. With GST, salePrice already includes it and gstAmount is the tax inside it.
    gstRate: integer('gst_rate').default(0).notNull(),
    gstAmount: doublePrecision('gst_amount').default(0).notNull(),
    advancePaid: doublePrecision('advance_paid').default(0).notNull(), // mirrors the sum of payments
    paymentMode: text('payment_mode').default('Cash').notNull(), // Cash | UPI | Bank Transfer | Cheque | Finance
    financier: text('financier'),
    loanAmount: doublePrecision('loan_amount').default(0).notNull(),

    // saleType: normal | subsidy. A subsidy sale is partly paid by a government scheme: the customer
    // owes salePrice - subsidyAmount, and the subsidy is claimed from the department.
    saleType: text('sale_type').default('normal').notNull(),
    subsidyScheme: text('subsidy_scheme'),
    subsidyAmount: doublePrecision('subsidy_amount').default(0).notNull(),
    subsidyStatus: text('subsidy_status'), // Applied | Sanctioned | Received | Rejected
    subsidyApplicationNo: text('subsidy_application_no'),
    subsidyReceivedDate: text('subsidy_received_date'),

    bookingDate: text('booking_date').notNull(), // YYYY-MM-DD
    expectedDeliveryDate: text('expected_delivery_date'),
    deliveredDate: text('delivered_date'),
    deliveryAddress: text('delivery_address'),
    vehicleNo: text('vehicle_no'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),

    pdiDone: boolean('pdi_done').default(false).notNull(),
    pdiNotes: text('pdi_notes'),
    handoverNotes: text('handover_notes'),
    receivedByName: text('received_by_name'),
    warrantyMonths: integer('warranty_months').default(12).notNull(),
    warrantyStart: text('warranty_start'),
    documentNumber: text('document_number'), // invoice number: generated on delivery, or typed by the user
    invoiceId: text('invoice_id'), // the invoice generated from this sale

    warehouseId: text('warehouse_id'), // stock source, set at dispatch
    stockDeducted: boolean('stock_deducted').default(false).notNull(),
    cancelReason: text('cancel_reason'),

    // Sales from the old bill files, entered after the fact: treated as settled, never as money still to collect
    isHistorical: boolean('is_historical').default(false).notNull(),

    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_machine_sales_branch').on(t.branchId),
    index('idx_machine_sales_status').on(t.status),
    index('idx_machine_sales_delivery').on(t.expectedDeliveryDate),
    // A physical machine can only be on one live sale; cancelled sales release the number.
    uniqueIndex('uq_machine_sales_serial').on(t.serialNumber).where(sql`${t.status} <> 'Cancelled'`),
    uniqueIndex('uq_machine_sales_engine').on(t.engineNumber).where(sql`${t.status} <> 'Cancelled'`),
    uniqueIndex('uq_machine_sales_chassis').on(t.chassisNumber).where(sql`${t.status} <> 'Cancelled'`)
  ]
);

// Money received against a sale (booking advance is the first row).
export const machineSalePayments = pgTable(
  'machine_sale_payments',
  {
    id: serial('id').primaryKey(),
    saleId: text('sale_id')
      .references(() => machineSales.id, { onDelete: 'cascade' })
      .notNull(),
    amount: doublePrecision('amount').notNull(),
    method: text('method').default('Cash').notNull(),
    paidOn: text('paid_on').notNull(), // YYYY-MM-DD
    reference: text('reference'),
    receivedBy: text('received_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_machine_sale_payments_sale').on(t.saleId), index('idx_machine_sale_payments_date').on(t.paidOn)]
);

// Audit trail of every state change.
export const machineSaleEvents = pgTable(
  'machine_sale_events',
  {
    id: serial('id').primaryKey(),
    saleId: text('sale_id')
      .references(() => machineSales.id, { onDelete: 'cascade' })
      .notNull(),
    stage: text('stage').notNull(),
    date: timestamp('date').defaultNow().notNull(),
    user: text('user').notNull(),
    notes: text('notes')
  },
  (t) => [index('idx_machine_sale_events_sale').on(t.saleId)]
);
