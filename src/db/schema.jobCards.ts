import { boolean, doublePrecision, index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Service / repair job cards for tractors and implements.
// status: Received | Diagnosing | Awaiting Parts | In Progress | Ready | Delivered | Cancelled
export const jobCards = pgTable(
  'job_cards',
  {
    id: text('id').primaryKey(),
    jobNumber: text('job_number').notNull().unique(),
    branchId: text('branch_id').notNull(),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    machineModel: text('machine_model'),
    serialNumber: text('serial_number'),
    complaint: text('complaint').notNull(),
    diagnosis: text('diagnosis'),
    status: text('status').default('Received').notNull(),
    technician: text('technician'),
    isWarranty: boolean('is_warranty').default(false).notNull(),
    labourHours: doublePrecision('labour_hours').default(0).notNull(),
    labourRate: doublePrecision('labour_rate').default(0).notNull(),
    labourCharge: doublePrecision('labour_charge').default(0).notNull(),
    partsTotal: doublePrecision('parts_total').default(0).notNull(),
    discount: doublePrecision('discount').default(0).notNull(),
    total: doublePrecision('total').default(0).notNull(),
    paidAmount: doublePrecision('paid_amount').default(0).notNull(),
    receivedOn: text('received_on').notNull(), // YYYY-MM-DD
    promisedDate: text('promised_date'),
    deliveredOn: text('delivered_on'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_job_cards_branch').on(t.branchId),
    index('idx_job_cards_status').on(t.status),
    index('idx_job_cards_serial').on(t.serialNumber)
  ]
);

// Spare parts consumed by a job card. Adding a part deducts warehouse stock.
export const jobCardParts = pgTable(
  'job_card_parts',
  {
    id: serial('id').primaryKey(),
    jobCardId: text('job_card_id')
      .references(() => jobCards.id, { onDelete: 'cascade' })
      .notNull(),
    productId: text('product_id'),
    warehouseId: text('warehouse_id'),
    productName: text('product_name').notNull(),
    sku: text('sku'),
    quantity: integer('quantity').notNull(),
    rate: doublePrecision('rate').notNull(),
    amount: doublePrecision('amount').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_job_card_parts_job').on(t.jobCardId)]
);

// Services from the Inventory > Services price list charged on a job card. The name and cost are copied when the service
// is added, so changing the price list later does not change a job card that already has it.
export const jobCardServices = pgTable(
  'job_card_services',
  {
    id: serial('id').primaryKey(),
    jobCardId: text('job_card_id')
      .references(() => jobCards.id, { onDelete: 'cascade' })
      .notNull(),
    serviceId: text('service_id'),
    name: text('name').notNull(),
    machineType: text('machine_type'),
    cost: doublePrecision('cost').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_job_card_services_job').on(t.jobCardId)]
);

// Payments received against a job card (feeds the daily cash book).
// method: Cash | UPI | Bank Transfer | Card
export const jobCardPayments = pgTable(
  'job_card_payments',
  {
    id: serial('id').primaryKey(),
    jobCardId: text('job_card_id')
      .references(() => jobCards.id, { onDelete: 'cascade' })
      .notNull(),
    amount: doublePrecision('amount').notNull(),
    method: text('method').default('Cash').notNull(),
    paidOn: text('paid_on').notNull(), // YYYY-MM-DD
    receivedBy: text('received_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_job_card_payments_job').on(t.jobCardId), index('idx_job_card_payments_date').on(t.paidOn)]
);
