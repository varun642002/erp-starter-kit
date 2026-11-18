import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Log of click-to-chat messages staff opened in WhatsApp. This records "opened", not delivery.
// kind: payment-reminder | warranty-expiry | job-ready | invoice | custom
export const messageLog = pgTable(
  'message_log',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull(),
    kind: text('kind').notNull(),
    refType: text('ref_type'), // invoice | warranty | job-card
    refId: text('ref_id'),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    channel: text('channel').default('whatsapp').notNull(),
    language: text('language').default('en').notNull(), // en | ta
    body: text('body').notNull(),
    sentBy: text('sent_by'),
    // opened = staff opened click-to-chat; sent / failed / queued = automatic sending result
    status: text('status').default('opened').notNull(),
    error: text('error'),
    providerId: text('provider_id'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_message_log_branch').on(t.branchId),
    index('idx_message_log_ref').on(t.refType, t.refId),
    index('idx_message_log_phone').on(t.phone)
  ]
);
