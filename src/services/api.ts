import { Product, Customer, Branch, Warehouse, SalesOrder, Invoice, Supplier, ProductWarranty } from '../types/erp';
import { authFetch } from './authFetch';

const API_BASE = '/api';

export interface CsvProductRow {
  sku: string;
  name: string;
  category: string;
  subcategory?: string;
  brand?: string;
  hsnCode?: string;
  unit?: string;
  gstRate?: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number;
  minStock?: number;
  initialStock?: number;
  oemPartNumber?: string;
  compatibleModels?: string;
  shelfBinLocation?: string;
  description?: string;
  isSparePart?: boolean;
  alternateNames?: string[];
}

export interface CsvCustomerRow {
  customerId?: string;
  companyName: string;
  name?: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  creditLimit?: number;
}

export interface ImportResult {
  success: boolean;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  totalProcessed: number;
  // rows left alone because the item already exists in the other section (spare vs machinery)
  sectionConflicts?: { sku: string; existsAs: 'spare' | 'machinery' }[];
}

// -----------------------------------------------------------------
// PRODUCTS API
// -----------------------------------------------------------------
export async function getSqlProducts(): Promise<Product[]> {
  const res = await authFetch(`${API_BASE}/products`);
  if (!res.ok) throw new Error('Failed to fetch products from SQL database');
  return res.json();
}

export async function searchSqlProducts(query: string, limit: number = 20): Promise<Product[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await authFetch(`${API_BASE}/products/search?${params}`);
  if (!res.ok) throw new Error('Failed to search products');
  return res.json();
}

export async function getSqlProductBySku(sku: string): Promise<Product | null> {
  const res = await authFetch(`${API_BASE}/products/sku/${encodeURIComponent(sku)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to lookup product by SKU');
  return res.json();
}

export async function updateMasterProductPriceApi(productId: string, sellingPrice: number): Promise<Product> {
  const res = await authFetch(`${API_BASE}/products/${encodeURIComponent(productId)}/master-price`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'Business Owner'
    },
    body: JSON.stringify({ sellingPrice })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update centralized master price in SQL database');
  }
  return res.json();
}

export async function getBranchDashboardApi(branchId: string): Promise<{
  branchId: string;
  monthlySales: number;
  pendingReceivables: number;
  pendingFollowUps: number;
}> {
  const res = await authFetch(`${API_BASE}/branch-dashboard?branch_id=${encodeURIComponent(branchId)}`, {
    headers: {
      'x-user-role': 'Branch Person',
      'x-branch-id': branchId
    }
  });
  if (!res.ok) throw new Error('Failed to fetch branch dashboard metrics');
  return res.json();
}

export async function createSqlProduct(productData: any): Promise<Product> {
  const res = await authFetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(productData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create product in SQL database');
  }
  return res.json();
}

export async function patchSqlProduct(productId: string, patch: Partial<Product> | Record<string, unknown>, role: string = 'Branch Person', branchId: string = 'branch-1'): Promise<Product> {
  const res = await authFetch(`${API_BASE}/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-role': role, 'x-branch-id': branchId },
    body: JSON.stringify(patch)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update product');
  }
  return res.json();
}

export async function bulkPatchSqlProducts(
  ids: string[],
  patch: { status?: string; isArchived?: boolean; category?: string },
  role: string = 'Branch Person',
  branchId: string = 'branch-1'
): Promise<{ updated: number }> {
  const res = await authFetch(`${API_BASE}/products/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-role': role, 'x-branch-id': branchId },
    body: JSON.stringify({ ids, patch })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Bulk product update failed');
  }
  return res.json();
}

export interface BulkDeleteProductsResult {
  dryRun: boolean;
  requested: number;
  deleted: number;
  archived: number;
  units: number;
  blocked: { id: string; sku: string; name: string; reason: string }[];
}

// dryRun only reports what would be erased and what would be archived instead.
export async function bulkDeleteSqlProducts(
  ids: string[],
  dryRun: boolean,
  role: string = 'Branch Person',
  branchId: string = 'branch-1'
): Promise<BulkDeleteProductsResult> {
  const res = await authFetch(`${API_BASE}/products/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-role': role, 'x-branch-id': branchId },
    body: JSON.stringify({ ids, dryRun })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not delete the selected items');
  }
  return res.json();
}

// Alternate names (other names a product is known by).
export async function getProductAliases(productId: string): Promise<string[]> {
  const res = await authFetch(`${API_BASE}/products/${encodeURIComponent(productId)}/aliases`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load alternate names');
  }
  return (await res.json()).aliases || [];
}

export async function saveProductAliases(productId: string, aliases: string[]): Promise<string[]> {
  const res = await authFetch(`${API_BASE}/products/${encodeURIComponent(productId)}/aliases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aliases })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not save alternate names');
  }
  return (await res.json()).aliases || [];
}

export async function importProductsCsvApi(
  items: CsvProductRow[],
  duplicateStrategy: 'skip' | 'update' = 'skip'
): Promise<ImportResult> {
  const res = await authFetch(`${API_BASE}/products/import-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, duplicateStrategy })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'CSV Product Import failed');
  }
  return res.json();
}

// -----------------------------------------------------------------
// CUSTOMERS API
// -----------------------------------------------------------------
export async function getSqlCustomers(): Promise<Customer[]> {
  const res = await authFetch(`${API_BASE}/customers`);
  if (!res.ok) throw new Error('Failed to fetch customers from SQL database');
  return res.json();
}

export async function searchSqlCustomers(query: string, limit: number = 25): Promise<Customer[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await authFetch(`${API_BASE}/customers/search?${params}`);
  if (!res.ok) throw new Error('Failed to search customers');
  return res.json();
}

export async function identifyCustomerByPhone(phone: string): Promise<Customer[]> {
  const params = new URLSearchParams({ phone });
  const res = await authFetch(`${API_BASE}/customers/by-phone?${params}`);
  if (!res.ok) throw new Error('Failed to search customer by phone');
  return res.json();
}

export async function deleteSqlCustomer(id: string): Promise<{ missing: boolean }> {
  const res = await authFetch(`${API_BASE}/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete customer');
  }
  return { missing: false };
}

export async function updateSqlCustomer(id: string, patch: Record<string, unknown>): Promise<{ missing: boolean }> {
  const res = await authFetch(`${API_BASE}/customers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update customer');
  }
  return { missing: false };
}

export async function getSqlBranches(): Promise<any[]> {
  const res = await authFetch(`${API_BASE}/branches`);
  if (!res.ok) throw new Error('Failed to fetch branches');
  return res.json();
}

export async function updateSqlBranch(id: string, patch: Record<string, unknown>): Promise<{ missing: boolean }> {
  const res = await authFetch(`${API_BASE}/branches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update branch');
  }
  return { missing: false };
}

export async function createSqlCustomer(customerData: any): Promise<Customer> {
  const res = await authFetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customerData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create customer in SQL database');
  }
  return res.json();
}

export async function importCustomersCsvApi(
  items: CsvCustomerRow[],
  duplicateStrategy: 'skip' | 'update' = 'skip'
): Promise<ImportResult> {
  const res = await authFetch(`${API_BASE}/customers/import-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, duplicateStrategy })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'CSV Customer Import failed');
  }
  return res.json();
}

export interface CsvSpareDeliveryRow {
  name: string;
  sku?: string;
  category?: string;
  compatibleModels?: string;
  oemPartNumber?: string;
  brand?: string;
  unit?: string;
  hsnCode?: string;
  purchasePrice?: number;
  sellingPrice: number;
  mrp?: number;
  gstRate?: number;
  deliveredQty: number;
  challanNumber?: string;
  deliveryDate?: string;
  receivingBranch: string;
  supplierName?: string;
  transporterOrVehicle?: string;
  shelfBinLocation?: string;
  alternateNames?: string[];
  subcategory?: string;
}

export interface SpareDeliveryImportResult extends ImportResult {
  grnNumber?: string;
  totalInwardQty?: number;
}

export async function importSparesDeliveryCsvApi(
  items: CsvSpareDeliveryRow[],
  duplicateStrategy: 'skip' | 'update' = 'update'
): Promise<SpareDeliveryImportResult> {
  const res = await authFetch(`${API_BASE}/spares/import-delivery-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, duplicateStrategy })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Bulk Spare & Delivery Import failed');
  }
  return res.json();
}

// -----------------------------------------------------------------
// SQL BACKUP & DUMP EXPORT (.sql)
// -----------------------------------------------------------------
export async function downloadSqlDatabaseBackup(role: string = 'Business Owner'): Promise<void> {
  const res = await authFetch(`${API_BASE}/backup/sql`, {
    headers: { 'x-user-role': role }
  });
  if (!res.ok) throw new Error('Failed to generate SQL backup from server');

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().split('T')[0];
  a.download = `erp_backup_${dateStr}.sql`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------
// SALES & QUICK SALES API (Multi-item Relational)
// -----------------------------------------------------------------
export async function recordMultiItemSaleApi(saleData: any, role: string = 'Branch Person', branchId: string = 'branch-1'): Promise<{
  success: boolean;
  sale: any;
  items: any[];
  invoice: any;
}> {
  const res = await authFetch(`${API_BASE}/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
      'x-branch-id': branchId
    },
    body: JSON.stringify(saleData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to record multi-item sale');
  }
  return res.json();
}

export async function getSqlSales(role: string = 'Branch Person', branchId: string = 'branch-1'): Promise<any[]> {
  const res = await authFetch(`${API_BASE}/sales`, {
    headers: {
      'x-user-role': role,
      'x-branch-id': branchId
    }
  });
  if (!res.ok) throw new Error('Failed to fetch sales');
  return res.json();
}

export async function getSqlSalesOrders(role: string = 'Business Owner', branchId?: string): Promise<SalesOrder[]> {
  const headers: Record<string, string> = {
    'x-user-role': role
  };
  if (branchId) headers['x-branch-id'] = branchId;

  const res = await authFetch(`${API_BASE}/sales-orders`, { headers });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Access Denied: Sales Orders restricted to Business Owner.');
  }
  if (!res.ok) throw new Error('Failed to fetch sales orders');
  return res.json();
}

// -----------------------------------------------------------------
// INITIAL DB SEED
// -----------------------------------------------------------------
export async function initSqlDatabase(): Promise<any> {
  const res = await authFetch(`${API_BASE}/db/init`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to initialize database');
  return res.json();
}
