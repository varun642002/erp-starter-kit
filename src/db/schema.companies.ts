import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Issuing companies that print their own letterhead, bank details and number series.
// id: main | second. Text columns default to '' so the client never has to handle null.
export const companyProfiles = pgTable('company_profiles', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  legalName: text('legal_name').default('').notNull(),
  tagline: text('tagline').default('').notNull(),
  addressLines: text('address_lines').default('').notNull(), // one printed line per newline
  stateName: text('state_name').default('Tamil Nadu').notNull(),
  stateCode: text('state_code').default('33').notNull(),
  phone: text('phone').default('').notNull(),
  email: text('email').default('').notNull(),
  website: text('website').default('').notNull(),
  gstin: text('gstin').default('').notNull(),
  pan: text('pan').default('').notNull(),
  bankName: text('bank_name').default('').notNull(),
  accountNumber: text('account_number').default('').notNull(),
  ifscCode: text('ifsc_code').default('').notNull(),
  bankBranch: text('bank_branch').default('').notNull(),
  upiId: text('upi_id').default('').notNull(),
  signatoryLabel: text('signatory_label').default('').notNull(),
  taxInvoicePrefix: text('tax_invoice_prefix').notNull(),
  quotationPrefix: text('quotation_prefix').notNull(),
  plainInvoicePrefix: text('plain_invoice_prefix').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export type CompanyProfile = typeof companyProfiles.$inferSelect;
