import { Customer, Supplier } from '../types/erp';

/**
 * Escapes an individual field value for CSV according to RFC-4180.
 * Handles commas, double-quotes, newlines, and nullish values.
 */
export function escapeCSVValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '""';
  }
  const str = String(val);
  // If the value contains comma, quotes, or newline, escape quotes and wrap in quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Downloads a structured 2D array of data as a CSV file with UTF-8 BOM.
 */
export function downloadCSV(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
  const headerLine = headers.map(escapeCSVValue).join(',');
  const rowLines = rows.map(row => row.map(escapeCSVValue).join(','));
  const csvContent = '\uFEFF' + [headerLine, ...rowLines].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a comprehensive CSV export for customers.
 */
export function exportCustomersToCSV(customers: Customer[], filenamePrefix: string = 'ERP_Customers'): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${filenamePrefix}_${dateStr}.csv`;

  const headers = [
    'Customer ID',
    'Company / Firm Name',
    'Contact Person',
    'Phone',
    'Email',
    'City',
    'Address',
    'GSTIN',
    'Industry Segment',
    'Credit Limit (₹)',
    'Outstanding Balance (₹)',
    'Available Credit (₹)',
    'Credit Utilization %',
    'Credit Period (Days)',
    'Lifetime Sales (₹)',
    'Last Transaction Date',
    'Credit Rating',
    'Status',
    'Branch ID'
  ];

  const rows = customers.map(c => {
    const limit = c.creditLimit || 0;
    const balance = c.outstandingBalance || 0;
    const available = Math.max(0, limit - balance);
    const utilization = limit > 0 ? Math.round((balance / limit) * 100) : 0;

    return [
      c.id,
      c.companyName,
      c.name,
      c.phone,
      c.email,
      c.city,
      c.address,
      c.gstin,
      c.segment || 'General Contractor',
      limit,
      balance,
      available,
      `${utilization}%`,
      c.creditPeriodDays || 30,
      c.totalSales || 0,
      c.lastTransactionDate || 'N/A',
      c.rating,
      c.status,
      c.branchId || 'N/A'
    ];
  });

  downloadCSV(filename, headers, rows);
  return filename;
}

/**
 * Generates and downloads a comprehensive CSV export for suppliers and vendors.
 */
export function exportSuppliersToCSV(suppliers: Supplier[], filenamePrefix: string = 'ERP_Suppliers'): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${filenamePrefix}_${dateStr}.csv`;

  const headers = [
    'Supplier ID',
    'Supplier / Mill Name',
    'Primary Contact',
    'Phone',
    'Email',
    'City',
    'Address',
    'GSTIN',
    'Supplied Categories',
    'Payment Terms',
    'Credit Period (Days)',
    'Outstanding Payables (₹)',
    'Lifetime Purchases (₹)',
    'Last Purchase Date',
    'Bank Name',
    'Bank Account Number',
    'Bank IFSC Code',
    'Vendor Rating',
    'Status'
  ];

  const rows = suppliers.map(s => {
    const categories = s.categoriesSupplied && s.categoriesSupplied.length > 0 
      ? s.categoriesSupplied.join('; ') 
      : 'General Building Materials';
    const payables = s.outstandingPayables ?? s.outstandingPayable ?? 0;

    return [
      s.id,
      s.companyName,
      s.name,
      s.phone,
      s.email,
      s.city,
      s.address,
      s.gstin,
      categories,
      s.paymentTerms,
      s.creditPeriodDays || 30,
      payables,
      s.totalPurchases || 0,
      s.lastPurchaseDate || 'N/A',
      s.bankDetails?.bankName || 'N/A',
      s.bankDetails?.accountNumber || 'N/A',
      s.bankDetails?.ifscCode || 'N/A',
      typeof s.rating === 'number' ? `★ ${s.rating}` : s.rating,
      s.status
    ];
  });

  downloadCSV(filename, headers, rows);
  return filename;
}
