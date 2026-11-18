import { doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// Manual cash book entries (collections, expenses, bank deposits, etc.).
// type: in | out; method: Cash | UPI | Bank Transfer | Card | Cheque (only Cash moves the drawer)
export const cashEntries = pgTable(
  'cash_entries',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull(),
    entryDate: text('entry_date').notNull(), // YYYY-MM-DD (IST business date)
    type: text('type').notNull(),
    category: text('category').notNull(),
    amount: doublePrecision('amount').notNull(),
    method: text('method').default('Cash').notNull(),
    description: text('description'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_cash_entries_branch_date').on(t.branchId, t.entryDate)]
);

// Immutable snapshot of a branch's day-end closing (deleted only when an owner reopens the day).
export const cashClosings = pgTable(
  'cash_closings',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull(),
    businessDate: text('business_date').notNull(), // YYYY-MM-DD
    openingCash: doublePrecision('opening_cash').default(0).notNull(),
    cashSales: doublePrecision('cash_sales').default(0).notNull(),
    upiSales: doublePrecision('upi_sales').default(0).notNull(),
    bankCardSales: doublePrecision('bank_card_sales').default(0).notNull(),
    creditSales: doublePrecision('credit_sales').default(0).notNull(),
    serviceCollections: doublePrecision('service_collections').default(0).notNull(),
    manualCashIn: doublePrecision('manual_cash_in').default(0).notNull(),
    manualCashOut: doublePrecision('manual_cash_out').default(0).notNull(),
    expectedCash: doublePrecision('expected_cash').default(0).notNull(),
    countedCash: doublePrecision('counted_cash').default(0).notNull(),
    variance: doublePrecision('variance').default(0).notNull(),
    notes: text('notes'),
    closedBy: text('closed_by'),
    closedAt: timestamp('closed_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('uq_cash_closings_branch_date').on(t.branchId, t.businessDate),
    index('idx_cash_closings_branch').on(t.branchId)
  ]
);
