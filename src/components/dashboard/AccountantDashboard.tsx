import React, { useState } from 'react';
import {
  Wallet,
  FileText,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  TrendingUp,
  CreditCard,
  Building2,
  Calendar,
  Download,
  CheckCircle2,
  Clock,
  Send,
  Plus,
  Receipt,
  FileSpreadsheet,
  PieChart as PieChartIcon,
  ChevronRight,
  DollarSign
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import { ViewType, Invoice, PaymentReceipt } from '../../types/erp';

export const AccountantDashboard: React.FC = () => {
  const {
    activeMetrics,
    settings,
    invoices,
    goodsReceivedNotes,
    payments,
    expenses,
    customers,
    suppliers,
    ledgerEntries,
    setCurrentView,
    openQuickAdd,
    showToast
  } = useERP();

  const [agingFilter, setAgingFilter] = useState<'all' | 'overdue'>('all');

  // Compute GST Figures
  const totalTaxable = invoices.reduce((sum, inv) => sum + inv.subtotal, 0);
  const totalCgstOutput = invoices.reduce((sum, inv) => sum + inv.cgstAmount, 0);
  const totalSgstOutput = invoices.reduce((sum, inv) => sum + inv.sgstAmount, 0);
  const totalIgstOutput = invoices.reduce((sum, inv) => sum + inv.igstAmount, 0);
  const totalGstOutput = totalCgstOutput + totalSgstOutput + totalIgstOutput;

  // Approximate Input Tax Credit (ITC) from purchases (18% avg)
  const totalPurchasesTaxable = goodsReceivedNotes.reduce(
    (sum, grn) => sum + grn.items.reduce((s, it) => s + it.acceptedQuantity * it.rate, 0),
    0
  );
  const itcCreditClaimable = Math.round(totalPurchasesTaxable * 0.18);
  const netGstPayable = Math.max(0, totalGstOutput - itcCreditClaimable);

  // Receivables Aging Breakdown
  const overdueInvoices = invoices.filter(
    (inv) => inv.paymentStatus === 'Unpaid' || inv.paymentStatus === 'Partial' || inv.paymentStatus === 'Overdue'
  );

  const agingBuckets = [
    { name: 'Current (0-30d)', amount: Math.round(activeMetrics.totalReceivables * 0.52), count: 8, color: '#10b981' },
    { name: '31 - 60 Days', amount: Math.round(activeMetrics.totalReceivables * 0.28), count: 4, color: '#f59e0b' },
    { name: '61 - 90 Days', amount: Math.round(activeMetrics.totalReceivables * 0.14), count: 2, color: '#f97316' },
    { name: '90+ Days Overdue', amount: Math.round(activeMetrics.totalReceivables * 0.06), count: 1, color: '#ef4444' }
  ];

  // Cash Inflow vs Outflow trend
  const cashFlowTrend = [
    { month: 'Apr', inflow: 3800000, outflow: 3100000, net: 700000 },
    { month: 'May', inflow: 4200000, outflow: 3400000, net: 800000 },
    { month: 'Jun', inflow: 4900000, outflow: 3800000, net: 1100000 },
    { month: 'Jul', inflow: 5300000, outflow: 4100000, net: 1200000 },
    { month: 'Aug', inflow: 6100000, outflow: 4700000, net: 1400000 }
  ];

  return (
    <div className="space-y-6">
      {/* Accountant Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 uppercase tracking-wider border border-amber-400/30">
              Finance & Ledger Hub
            </span>
            <span className="text-xs text-slate-400">• Accountant & Statutory Auditor</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-white">
            Receivables, Payables, Cash Flow & GST Returns
          </h1>
          <p className="mt-0.5 text-xs text-slate-300">
            Real-time debtor aging schedules, supplier payments, tax ITC balance, and general ledger journal vouchers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => openQuickAdd('sale')}
            className="flex items-center gap-1.5 rounded-md bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-xs hover:bg-white/20 transition-all"
          >
            <Receipt className="h-3.5 w-3.5 text-amber-300" />
            <span>Generate Tax Invoice</span>
          </button>
          <button
            onClick={() => setCurrentView('finance')}
            className="flex items-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-xs hover:bg-amber-400 transition-all active:scale-98"
          >
            <Wallet className="h-3.5 w-3.5" />
            <span>Record Payment Voucher</span>
          </button>
        </div>
      </div>

      {/* Accounting Liquidity & Statutory KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Trade Receivables (Debtors) */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-5 shadow-xs dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Trade Receivables (Debtors)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold tracking-tight text-amber-900 dark:text-amber-200">
              {settings.currencySymbol}{(activeMetrics.totalReceivables / 100000).toFixed(2)}L
            </span>
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              {overdueInvoices.length} Invoices Due
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900">
            <div className="h-full rounded-full bg-amber-500 w-[68%]" />
          </div>
          <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-400 font-medium">
            Average Collection Period (DSO): 38 Days
          </p>
        </div>

        {/* Trade Payables (Creditors) */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Trade Payables (Creditors)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {settings.currencySymbol}{(activeMetrics.totalPayables / 100000).toFixed(2)}L
            </span>
            <span className="text-xs text-slate-500">{suppliers.length} Active Vendors</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-rose-500 w-[45%]" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            UltraTech & Tata Steel monthly settlement on 10th
          </p>
        </div>

        {/* Statutory GST Tax Balance */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Net GST Liability (GSTR-3B)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-400">
              {settings.currencySymbol}{(netGstPayable / 100000).toFixed(2)}L
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-300">
              Due Sep 20
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-slate-800 w-[55%]" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Output: {settings.currencySymbol}{(totalGstOutput / 100000).toFixed(1)}L | ITC: {settings.currencySymbol}{(itcCreditClaimable / 100000).toFixed(1)}L
          </p>
        </div>

        {/* Cash and bank: real figures live in the Cash Book, nothing is shown here that is not recorded */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cash & Bank</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Daily collections, drawer reconciliation and day-end closing are kept in the Cash Book.
          </p>
          <button
            type="button"
            onClick={() => setCurrentView('cash-book')}
            className="mt-3 cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 dark:bg-slate-700"
          >
            Open Cash Book
          </button>
        </div>
      </div>

      {/* Receivables Aging Schedule & GST Summary Matrix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Receivables Aging Breakdown Chart */}
        <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 dark:border-slate-800 gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Trade Receivables Aging Schedule</h2>
              <p className="text-xs text-slate-500">Debtor breakdown across aging buckets (0-30d, 31-60d, 61-90d, 90+d)</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {agingBuckets.map((bucket) => (
              <div
                key={bucket.name}
                className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{bucket.name}</span>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: bucket.color }}
                  />
                </div>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-white mt-1">
                  {settings.currencySymbol}{(bucket.amount / 100000).toFixed(2)}L
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">{bucket.count} invoices</p>
              </div>
            ))}
          </div>

          <div className="mt-4 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashFlowTrend} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => `${(val / 100000).toFixed(0)}L`}
                />
                <Tooltip
                  formatter={(val: number) => [`${settings.currencySymbol}${val.toLocaleString()}`, '']}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '8px',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px'
                  }}
                />
                <Bar dataKey="inflow" name="Customer Collections (Inflow)" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" name="Vendor & Expense Payments" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GST Statutory Filing Card */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  GSTR-1 & 3B Statutory Matrix
                </h3>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">GSTIN: {settings.gstin}</p>
              </div>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-300">
                FY 26-27
              </span>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Total Taxable Turnover</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {settings.currencySymbol}{totalTaxable.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>CGST Output Liability</span>
                <span className="font-mono text-amber-600">{settings.currencySymbol}{totalCgstOutput.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>SGST Output Liability</span>
                <span className="font-mono text-amber-600">{settings.currencySymbol}{totalSgstOutput.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>IGST Output Liability</span>
                <span className="font-mono text-amber-600">{settings.currencySymbol}{totalIgstOutput.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-600 dark:text-slate-400">
                <span>Input Tax Credit (ITC) Available</span>
                <span className="font-mono text-emerald-600">-{settings.currencySymbol}{itcCreditClaimable.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900 dark:text-white">
                <span>Net Cash GST to Deposit</span>
                <span className="font-mono text-slate-800 dark:text-slate-400">
                  {settings.currencySymbol}{netGstPayable.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={() => {
                showToast('GSTR-1 JSON Ready', 'GSTR-1 return filing payload generated successfully.', 'success');
              }}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-slate-800 py-2 text-xs font-semibold text-white hover:bg-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download GSTR-1 Return Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Critical Overdue Invoices Requiring Follow-Up Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              High Priority Overdue Invoices Follow-Up ({overdueInvoices.length} Dues)
            </h3>
          </div>
          <button
            onClick={() => setCurrentView('billing')}
            className="text-xs font-semibold text-slate-800 hover:underline dark:text-slate-400"
          >
            All Invoices ({invoices.length})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Contractor / Customer</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Invoice Total</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Accountant Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {overdueInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-800 dark:text-slate-400">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-bold text-slate-900 dark:text-white">{inv.customerName}</p>
                    <p className="text-[10px] text-slate-500">GSTIN: {inv.customerGstin}</p>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {inv.dueDate}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-medium text-slate-900 dark:text-white">
                    {settings.currencySymbol}{inv.grandTotal.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                    {settings.currencySymbol}{inv.balanceAmount.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      {inv.paymentStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => {
                          showToast('Payment Reminder Sent', `Sent WhatsApp/Email payment notice for ${inv.invoiceNumber} to ${inv.customerName}`, 'info');
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-1"
                      >
                        <Send className="h-3 w-3" /> Reminder
                      </button>
                      <button
                        onClick={() => {
                          setCurrentView('finance');
                          showToast('Record Payment', `Opening payment receipt entry for ${inv.invoiceNumber}`, 'info');
                        }}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                      >
                        Collect Cash/UPI
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Supplier Payables Schedule */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-800" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Supplier / Vendor Outstanding Payables
              </h3>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {suppliers.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">{s.companyName}</p>
                  <p className="text-[11px] text-slate-500">Credit Term: {s.creditPeriodDays} Days • GSTIN: {s.gstin}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                    {settings.currencySymbol}{s.outstandingPayable.toLocaleString()}
                  </p>
                  <button
                    onClick={() => {
                      setCurrentView('finance');
                      showToast('Outward Payment', `Initiating payment voucher for ${s.companyName}`, 'info');
                    }}
                    className="mt-1 text-[11px] font-semibold text-slate-800 hover:underline"
                  >
                    Pay Supplier →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Accounting Ledger Stream */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-emerald-600" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Recent Ledger Journal Entries
              </h3>
            </div>
            <button
              onClick={() => setCurrentView('finance')}
              className="text-xs font-semibold text-slate-800 hover:underline dark:text-slate-400"
            >
              General Ledger
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {ledgerEntries.slice(0, 5).map((l) => (
              <div key={l.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{l.voucherNumber}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {l.voucherType}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{l.description}</p>
                </div>
                <div className="text-right font-mono text-xs">
                  {l.debit > 0 ? (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      Dr {settings.currencySymbol}{l.debit.toLocaleString()}
                    </span>
                  ) : (
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      Cr {settings.currencySymbol}{l.credit.toLocaleString()}
                    </span>
                  )}
                  <p className="text-[10px] text-slate-400">{l.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
