import { index, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { products } from './schema.ts';

// Extra names a product is known by (local names, Tamil spellings, short names) for the voice assistant.
// Every alias belongs to a real product row; the assistant never creates products.
export const productAliases = pgTable(
  'product_aliases',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    alias: text('alias').notNull(),
    aliasKey: text('alias_key').notNull(), // lower-cased, single-spaced
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('uq_product_aliases_product_key').on(t.productId, t.aliasKey), index('idx_product_aliases_key').on(t.aliasKey)]
);
