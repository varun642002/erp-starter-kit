import { sql } from 'drizzle-orm';
import { db } from './index.ts';

// Small switches the Super Admin controls. Stored in one tiny table that is created on first start.
// 'branch_person_stock_edit': may branch persons update stock, add spare parts and correct item details?
// On until the Super Admin switches it off.

const KEY_BRANCH_STOCK = 'branch_person_stock_edit';

export async function ensureAppSettingsTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists app_settings (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_by text,
      updated_at timestamptz not null default now()
    )`);
}

let cached: { at: number; value: boolean } | null = null;

export async function branchPersonCanEditStock(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  let value = true;
  try {
    const res = await db.execute(sql`select value from app_settings where key = ${KEY_BRANCH_STOCK}`);
    const row = res.rows[0] as { value?: { enabled?: boolean } } | undefined;
    if (row?.value && row.value.enabled === false) value = false;
  } catch {
    value = true; // never lock people out because of a settings hiccup
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function getAppSettings() {
  const enabled = await branchPersonCanEditStock();
  let updatedBy: string | null = null;
  let updatedAt: string | null = null;
  try {
    const res = await db.execute(sql`select updated_by, updated_at from app_settings where key = ${KEY_BRANCH_STOCK}`);
    const row = res.rows[0] as { updated_by?: string; updated_at?: string | Date } | undefined;
    if (row) {
      updatedBy = row.updated_by ?? null;
      updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;
    }
  } catch {
    /* no row yet */
  }
  return { branchPersonStockEdit: enabled, updatedBy, updatedAt };
}

export async function setBranchPersonStockEdit(enabled: boolean, by: string) {
  await db.execute(sql`
    insert into app_settings (key, value, updated_by, updated_at)
    values (${KEY_BRANCH_STOCK}, ${JSON.stringify({ enabled })}::jsonb, ${by}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
  cached = null;
  return getAppSettings();
}

export const STOCK_EDIT_OFF_MESSAGE = 'Stock editing is switched off for branch persons. Ask the Super Admin to switch it on.';

// Returns a message when this role may not change stock right now, otherwise null.
// Only the Branch Person role is switched; owners and managers are never affected.
export async function stockEditBlocked(role: string): Promise<string | null> {
  if (role !== 'Branch Person') return null;
  return (await branchPersonCanEditStock()) ? null : STOCK_EDIT_OFF_MESSAGE;
}

// Item details a branch person may correct. Prices, status, category and archiving stay with the owner and Warehouse Manager; other fields in a request are ignored.
export const BRANCH_PERSON_PRODUCT_FIELDS = [
  'name', 'subcategory', 'brand', 'unit', 'alternateUnit', 'conversionFactor', 'description', 'barcode', 'oemPartNumber', 'compatibleModels', 'shelfBinLocation',
  'minStock', 'maxStock', 'reorderLevel'
] as const;

// Quick sale lines remember the unit they were sold in. Safe to run on every start.
export async function ensureSaleItemUnitColumns(): Promise<void> {
  await db.execute(sql`alter table sale_items add column if not exists unit text`);
  await db.execute(sql`alter table sale_items add column if not exists unit_factor double precision not null default 1`);
  // a bill can be paid two ways (secondary payment)
  await db.execute(sql`alter table sales add column if not exists payment_method_2 text`);
  await db.execute(sql`alter table sales add column if not exists payment_amount_2 double precision not null default 0`);
  // an invoice made from a machine sale can be edited by hand
  await db.execute(sql`alter table documents add column if not exists manual_edit boolean not null default false`);
  // sales entered from the old bill files (see machine_sales.is_historical)
  await db.execute(sql`alter table machine_sales add column if not exists is_historical boolean not null default false`);
  await db.execute(sql`alter table documents add column if not exists is_historical boolean not null default false`);
}
