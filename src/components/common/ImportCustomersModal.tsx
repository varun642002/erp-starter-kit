import React, { useState } from 'react';
import {
  X,
  Upload,
  Users,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Download,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { Customer } from '../../types/erp';
import { importCustomersCsvApi, CsvCustomerRow } from '../../services/api';

interface ImportCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingCustomers: Customer[];
  onImportComplete: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

interface ValidatedCustomerRow {
  rowNumber: number;
  data: CsvCustomerRow;
  isValid: boolean;
  errors: string[];
  isDuplicateInCsv: boolean;
  isDuplicateInDb: boolean;
}

export const ImportCustomersModal: React.FC<ImportCustomersModalProps> = ({
  isOpen,
  onClose,
  existingCustomers,
  onImportComplete,
  showToast
}) => {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [validatedRows, setValidatedRows] = useState<ValidatedCustomerRow[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update'>('skip');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Sample CSV template generator
  const handleDownloadSample = () => {
    const headers =
      'Customer ID,Customer Name,Contact Person,Phone Number,Alternate Phone,Email,Address,City,State,PIN Code,GSTIN,Credit Limit\n';
    const sampleRows = [
      'CUST-001,Sample Tractors & Implements,Sample Person One,9000000001,9000000002,one@example.com,12 Sample Road,Sampletown,Sample State,000001,00AAAAA0001A1Z0,1000000',
      'CUST-002,Sample Agro Spares,Sample Person Two,9000000003,,two@example.com,78 Market Road,Exampleville,Sample State,000002,00AAAAA0002A1Z0,800000',
      'CUST-003,Sample Farm Implements,Sample Person Three,9000000004,9000000005,three@example.com,Industrial Estate Road,Sample City,Sample State,000003,00AAAAA0003A1Z0,1500000'
    ].join('\n');

    const blob = new Blob([headers + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Acme_Customers_Sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV Parsing
  const parseCsvText = (text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.map((line) => {
      const row: string[] = [];
      let insideQuote = false;
      let currentEntry = '';

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuote && line[i + 1] === '"') {
            currentEntry += '"';
            i++;
          } else {
            insideQuote = !insideQuote;
          }
        } else if (char === ',' && !insideQuote) {
          row.push(currentEntry.trim());
          currentEntry = '';
        } else {
          currentEntry += char;
        }
      }
      row.push(currentEntry.trim());
      return row;
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const parsedRows = parseCsvText(content);
      if (parsedRows.length <= 1) {
        showToast('The uploaded CSV file is empty or missing data rows.', 'error');
        return;
      }

      const headers = parsedRows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const dataRows = parsedRows.slice(1);

      // Find column indices
      const idxId = headers.findIndex((h) => h.includes('customerid') || h === 'id' || h.includes('custid') || h.includes('customercode'));
      const idxCompany = headers.findIndex((h) => h.includes('customername') || h.includes('companyname') || h.includes('dealername') || h.includes('name'));
      const idxContact = headers.findIndex((h) => h.includes('contactperson') || h.includes('contact') || h.includes('person'));
      const idxPhone = headers.findIndex((h) => h.includes('phonenumber') || h.includes('phone') || h.includes('mobile'));
      const idxAltPhone = headers.findIndex((h) => h.includes('alternate') || h.includes('altphone') || h.includes('secondphone'));
      const idxEmail = headers.findIndex((h) => h.includes('email') || h.includes('mail'));
      const idxAddress = headers.findIndex((h) => h.includes('address') || h.includes('street'));
      const idxCity = headers.findIndex((h) => h.includes('city') || h.includes('district'));
      const idxState = headers.findIndex((h) => h.includes('state'));
      const idxPincode = headers.findIndex((h) => h.includes('pincode') || h.includes('pin') || h.includes('postal'));
      const idxGstin = headers.findIndex((h) => h.includes('gstin') || h.includes('gst'));
      const idxCredit = headers.findIndex((h) => h.includes('credit') || h.includes('limit'));

      const seenPhones = new Set<string>();
      const existingPhones = new Set(existingCustomers.map((c) => c.phone.replace(/\D/g, '')));
      const existingIds = new Set(existingCustomers.map((c) => (c as any).customerId?.toUpperCase()));

      const validated: ValidatedCustomerRow[] = dataRows.map((row, index) => {
        const rowNum = index + 2;
        const customerId = (idxId !== -1 ? row[idxId] : '')?.trim();
        const companyName = (idxCompany !== -1 ? row[idxCompany] : row[1])?.trim() || '';
        const name = (idxContact !== -1 ? row[idxContact] : row[2])?.trim() || companyName;
        const phone = (idxPhone !== -1 ? row[idxPhone] : row[3])?.trim() || '';
        const altPhone = (idxAltPhone !== -1 ? row[idxAltPhone] : '')?.trim();
        const email = (idxEmail !== -1 ? row[idxEmail] : '')?.trim();
        const address = (idxAddress !== -1 ? row[idxAddress] : '')?.trim();
        const city = (idxCity !== -1 ? row[idxCity] : 'Sampletown')?.trim() || 'Sampletown';
        const state = (idxState !== -1 ? row[idxState] : 'Tamil Nadu')?.trim() || 'Tamil Nadu';
        const pincode = (idxPincode !== -1 ? row[idxPincode] : '')?.trim();
        const gstin = (idxGstin !== -1 ? row[idxGstin] : '')?.trim().toUpperCase();
        const creditRaw = (idxCredit !== -1 ? row[idxCredit] : '')?.replace(/[^0-9.]/g, '');
        const creditLimit = parseFloat(creditRaw) || 500000;

        const errors: string[] = [];

        // Required Checks
        if (!companyName) errors.push('Missing Customer / Company Name');
        if (!phone) errors.push('Missing Phone Number');

        // Phone Validation (Indian numbers: at least 10 digits)
        const digits = phone.replace(/\D/g, '');
        if (digits.length < 10) {
          errors.push(`Invalid phone format "${phone}" (minimum 10 digits required)`);
        }

        // GSTIN Validation (if provided, must be 15 chars)
        if (gstin && gstin.length !== 15) {
          errors.push(`Invalid GSTIN "${gstin}" (must be exactly 15 characters)`);
        }

        // Duplicate checks
        const cleanPhone = digits.slice(-10);
        const isDuplicateInCsv = seenPhones.has(cleanPhone);
        if (cleanPhone) seenPhones.add(cleanPhone);
        if (isDuplicateInCsv) errors.push(`Duplicate phone number "${phone}" within CSV`);

        const isDuplicateInDb =
          existingPhones.has(cleanPhone) || (Boolean(customerId) && existingIds.has(customerId.toUpperCase()));

        return {
          rowNumber: rowNum,
          data: {
            customerId: customerId || undefined,
            companyName,
            name,
            phone,
            alternatePhone: altPhone || undefined,
            email: email || undefined,
            address: address || undefined,
            city,
            state,
            pincode: pincode || undefined,
            gstin: gstin || undefined,
            creditLimit
          },
          isValid: errors.length === 0,
          errors,
          isDuplicateInCsv,
          isDuplicateInDb
        };
      });

      setValidatedRows(validated);
      setStep('preview');
    };
    reader.readAsText(selected);
  };

  const validCount = validatedRows.filter((r) => r.isValid).length;
  const invalidCount = validatedRows.filter((r) => !r.isValid).length;
  const dbDuplicateCount = validatedRows.filter((r) => r.isValid && r.isDuplicateInDb).length;

  const handleConfirmImport = async () => {
    const validData = validatedRows.filter((r) => r.isValid).map((r) => r.data);
    if (validData.length === 0) {
      showToast('No valid customer rows available to import.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await importCustomersCsvApi(validData, duplicateStrategy);
      showToast(
        `Customer Import Complete: ${res.insertedCount} inserted, ${res.updatedCount} updated, ${res.skippedCount} skipped.`,
        'success'
      );
      onImportComplete();
      onClose();
    } catch (err: any) {
      showToast(`Import failed: ${err.message || 'Database transaction error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Import Customers to SQL Master (CSV)
              </h2>
              <p className="text-xs text-slate-500">
                Bulk upload tractor owners, dealers, and FPO clients with duplicate phone verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workflow Breadcrumb Indicator */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <span className={step === 'upload' ? 'text-emerald-600 font-bold dark:text-emerald-400' : 'text-slate-400'}>
              1. Upload Customer CSV
            </span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span className={step === 'preview' ? 'text-emerald-600 font-bold dark:text-emerald-400' : 'text-slate-400'}>
              2. Validate ({validatedRows.length} rows)
            </span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span className={step === 'importing' ? 'text-emerald-600 font-bold dark:text-emerald-400' : 'text-slate-400'}>
              3. SQL Save
            </span>
          </div>

          <button
            type="button"
            onClick={handleDownloadSample}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Sample Customer CSV</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' && (
            <div className="space-y-3">
              <div className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-emerald-500 transition-colors dark:border-slate-700">
                <Upload className="mx-auto h-10 w-10 text-slate-400 mb-2" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Select CSV File with Customer Data
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                  Upload file containing: Customer ID, Company Name, Contact Person, Phone Number, City, State, GSTIN, and Credit Limit.
                </p>

                <label className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 cursor-pointer">
                  <span>Browse CSV File</span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {/* Supported Columns Guide */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2">
                  Recognized Customer CSV Columns
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Customer Name *</span>
                    <span className="block text-[10px] text-slate-400">Ravi Tractors & Implements</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Phone Number *</span>
                    <span className="block text-[10px] text-slate-400">9876543210 (10 digits)</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Customer ID</span>
                    <span className="block text-[10px] text-slate-400">e.g. CUST-001</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">GSTIN</span>
                    <span className="block text-[10px] text-slate-400">15 digit GST Number</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">City & State</span>
                    <span className="block text-[10px] text-slate-400">e.g. Sampletown, Tamil Nadu</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Credit Limit</span>
                    <span className="block text-[10px] text-slate-400">e.g. 500000</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              {/* Validation Summary Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Total Rows</span>
                  <div className="mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white font-mono">
                    {validatedRows.length}
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                  <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                    Valid Customers
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-emerald-700 dark:text-emerald-300 font-mono">
                    {validCount}
                  </div>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
                  <span className="text-[10px] font-bold uppercase text-rose-700 dark:text-rose-400">
                    Errors / Invalid
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-rose-700 dark:text-rose-300 font-mono">
                    {invalidCount}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                    Existing in Database
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-amber-700 dark:text-amber-300 font-mono">
                    {dbDuplicateCount}
                  </div>
                </div>
              </div>

              {/* Duplicate Strategy Toggle */}
              {dbDuplicateCount > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-900/70 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-bold text-amber-900 dark:text-amber-200">
                        {dbDuplicateCount} customer records share phone numbers or IDs with existing records.
                      </span>
                      <span className="block text-[11px] text-amber-800/80 dark:text-amber-300/80">
                        Choose how to handle duplicates:
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDuplicateStrategy('skip')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        duplicateStrategy === 'skip'
                          ? 'bg-amber-700 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Skip Duplicates
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateStrategy('update')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        duplicateStrategy === 'update'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Update / Merge Existing
                    </button>
                  </div>
                </div>
              )}

              {/* Preview Table */}
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Customer Name</th>
                      <th className="py-2.5 px-3">Phone Number</th>
                      <th className="py-2.5 px-3">City / State</th>
                      <th className="py-2.5 px-3">GSTIN</th>
                      <th className="py-2.5 px-3">Validation Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {validatedRows.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={
                          !r.isValid
                            ? 'bg-rose-50/40 dark:bg-rose-950/20'
                            : r.isDuplicateInDb
                            ? 'bg-amber-50/40 dark:bg-amber-950/20'
                            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                        }
                      >
                        <td className="py-2 px-3 font-mono text-slate-400">#{r.rowNumber}</td>
                        <td className="py-2 px-3">
                          {r.isValid ? (
                            r.isDuplicateInDb ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                                In DB
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Valid
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300 text-[10px]">
                              <AlertCircle className="h-2.5 w-2.5" /> Error
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                          {r.data.companyName}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {r.data.phone}
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          {r.data.city}, {r.data.state}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {r.data.gstin || '—'}
                        </td>
                        <td className="py-2 px-3 text-rose-600 dark:text-rose-400 font-medium">
                          {r.errors.length > 0 ? r.errors.join('; ') : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            {step === 'preview' && (
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                ← Choose Another File
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>

            {step === 'preview' && (
              <button
                type="button"
                disabled={validCount === 0 || isSubmitting}
                onClick={handleConfirmImport}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Importing into SQL...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Confirm & Import ({validCount} Customers)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
