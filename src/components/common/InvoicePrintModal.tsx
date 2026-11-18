import React from 'react';
import { X, Printer, Download, Share2, Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Invoice } from '../../types/erp';

interface InvoicePrintModalProps {
  invoice?: Invoice | null;
  onClose?: () => void;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({ invoice: propInvoice, onClose: propOnClose }) => {
  const { settings, branches, activeInvoiceForPrint, setActiveInvoiceForPrint } = useERP();

  const invoice = propInvoice !== undefined ? propInvoice : activeInvoiceForPrint;
  const onClose = propOnClose || (() => setActiveInvoiceForPrint(null));

  if (!invoice) return null;

  const branch = branches.find(b => b.id === invoice.branchId) || branches[0];
  // A bill with no GST on it (counter sales) prints as a plain invoice without tax columns.
  const noTax = !invoice.taxAmount && invoice.items.every((it) => !it.taxRate);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        {/* Modal Action Bar (Hidden in Print) */}
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{invoice.invoiceNumber}</span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {invoice.type}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-900"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Invoice</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Invoice Printable Area */}
        <div className="print-container flex-1 overflow-y-auto p-8 bg-white text-slate-900">
          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white font-bold text-base">
                  A
                </div>
                <div>
                  <h1 className="text-lg font-extrabold tracking-tight text-slate-900">{settings.companyName}</h1>
                  <p className="text-xs text-slate-500">{settings.legalName}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600 max-w-sm">{branch?.address}, {branch?.city}, {branch?.state}</p>
              <p className="text-xs text-slate-600 font-mono mt-0.5">
                GSTIN: <span className="font-bold text-slate-900">{branch?.gstin || settings.gstin}</span> • PAN: {settings.panNumber}
              </p>
              <p className="text-xs text-slate-500">Phone: {branch?.phone} • Email: {branch?.email}</p>
            </div>

            <div className="text-right">
              <div className="inline-block rounded-md bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-800">
                {noTax ? 'INVOICE' : 'TAX INVOICE'}
              </div>
              <p className="mt-2 font-mono text-sm font-bold text-slate-900">Invoice #: {invoice.invoiceNumber}</p>
              <p className="text-xs text-slate-500">Invoice Date: <span className="font-semibold text-slate-700">{invoice.invoiceDate}</span></p>
              <p className="text-xs text-slate-500">Payment Due: <span className="font-semibold text-rose-600">{invoice.dueDate}</span></p>
              <p className="text-xs text-slate-500">Place of Supply: <span className="font-semibold text-slate-700">{branch?.city}</span></p>
            </div>
          </div>

          {/* Bill To / Ship To Grid */}
          <div className="mt-3 grid grid-cols-2 gap-8 border-b border-slate-200 pb-6 text-xs">
            <div>
              <p className="font-bold uppercase text-slate-400 tracking-wider">Billed To (Customer):</p>
              <p className="mt-1 font-bold text-sm text-slate-900">{invoice.customerName}</p>
              <p className="mt-0.5 text-slate-600">{invoice.billingAddress}</p>
              <p className="mt-1 font-mono font-semibold text-slate-800">GSTIN / UIN: {invoice.customerGstin}</p>
            </div>
            <div>
              <p className="font-bold uppercase text-slate-400 tracking-wider">Shipped To / Project Site:</p>
              <p className="mt-1 text-slate-700">{invoice.shippingAddress || invoice.billingAddress}</p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Payment Status: {invoice.paymentStatus.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="mt-3">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 bg-slate-50 font-bold text-slate-800">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Item Description & Brand</th>
                  <th className="py-2.5 px-3 font-mono">HSN/SAC</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Rate</th>
                  <th className="py-2.5 px-3 text-right">Disc %</th>
                  {!noTax && <th className="py-2.5 px-3 text-right">GST Rate</th>}
                  {!noTax && <th className="py-2.5 px-3 text-right">Taxable Amt</th>}
                  <th className="py-2.5 px-3 text-right">Total ({settings.currencySymbol})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {invoice.items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-bold text-slate-900">{it.productName}</p>
                      <p className="text-[10px] text-slate-500 font-mono">SKU: {it.sku}</p>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{it.hsnCode || '252329'}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {it.quantity} <span className="text-[10px] text-slate-500 font-normal">{it.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{settings.currencySymbol}{it.rate.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{it.discountPercent}%</td>
                    {!noTax && <td className="py-2.5 px-3 text-right font-mono">{it.taxRate}%</td>}
                    {!noTax && (
                      <td className="py-2.5 px-3 text-right font-mono">
                        {settings.currencySymbol}{(it.quantity * it.rate * (1 - it.discountPercent / 100)).toLocaleString()}
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {settings.currencySymbol}{it.totalAmount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tax Summary & Totals */}
          <div className="mt-3 flex flex-col md:flex-row justify-between items-start gap-3 border-t border-slate-200 pt-6 text-xs">
            <div className="flex-1 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <p className="font-bold text-slate-800">Bank Transfer / NEFT / RTGS Details:</p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                  <span>Bank Name: <b className="text-slate-900">{settings.bankDetails.bankName}</b></span>
                  <span>A/c No: <b className="text-slate-900 font-mono">{settings.bankDetails.accountNumber}</b></span>
                  <span>IFSC Code: <b className="text-slate-900 font-mono">{settings.bankDetails.ifscCode}</b></span>
                  <span>UPI ID: <b className="text-slate-900">{settings.bankDetails.upiId}</b></span>
                </div>
              </div>

              <div>
                <p className="font-bold text-slate-800">Terms & Conditions:</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{invoice.terms}</p>
              </div>
            </div>

            <div className="w-full md:w-80 space-y-1.5 rounded-xl bg-slate-50 p-4 border border-slate-200">
              <div className="flex justify-between text-slate-600">
                <span>{noTax ? 'Subtotal:' : 'Taxable Subtotal:'}</span>
                <span className="font-mono font-semibold text-slate-900">{settings.currencySymbol}{invoice.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Discount:</span>
                <span className="font-mono text-emerald-600">-{settings.currencySymbol}{invoice.totalDiscount.toLocaleString()}</span>
              </div>
              {!noTax && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST (Central Tax):</span>
                    <span className="font-mono text-slate-800">{settings.currencySymbol}{invoice.cgstAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST (State Tax):</span>
                    <span className="font-mono text-slate-800">{settings.currencySymbol}{invoice.sgstAmount.toLocaleString()}</span>
                  </div>
                </>
              )}
              <div className="border-t border-slate-300 pt-2 mt-2 flex justify-between text-sm font-extrabold text-slate-900">
                <span>Grand Total:</span>
                <span className="font-mono text-slate-800">{settings.currencySymbol}{invoice.grandTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[11px] text-emerald-700 font-semibold pt-1">
                <span>Paid Amount:</span>
                <span className="font-mono">{settings.currencySymbol}{invoice.paidAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-rose-700 font-bold">
                <span>Balance Due:</span>
                <span className="font-mono">{settings.currencySymbol}{invoice.balanceAmount.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Authorized Signatory */}
          <div className="mt-12 flex justify-between items-end pt-6 border-t border-slate-200 text-xs text-slate-500">
            <div className="flex items-center gap-1 text-[11px]">
              <ShieldCheck className="h-4 w-4 text-slate-800" />
              <span>Computer Generated {noTax ? 'Invoice' : 'Tax Invoice'} • Verified Digital Copy</span>
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-800">For {settings.companyName}</p>
              <div className="h-10 w-36 border-b border-dashed border-slate-300 mx-auto my-1" />
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Authorized Signatory</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
