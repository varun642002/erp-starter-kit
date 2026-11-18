import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { CustomerPhoneLookup } from '../common/CustomerPhoneLookup';
import { NewCustomerModal } from '../common/NewCustomerModal';
import { ProductSearchSelect } from '../common/ProductSearchSelect';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL, Modal, useApiScope } from '../documents/ui';
import { useCompanies } from '../../hooks/useCompanies';
import { normalizeIndianPhone } from '../../utils/whatsapp';
import type { Customer, Product } from '../../types/erp';
import type { CompanyId } from '../../services/companyApi';
import {
  ADVANCE_METHODS,
  MACHINE_PAYMENT_MODES,
  formatMoney,
  machineSaleApi,
  scopeForSale,
  todayIst,
  type MachinePaymentMode,
  type MachineSale,
  type MachineSaleDetail,
  type MachineSaleInput
} from '../../services/machineSaleApi';

export const ErrorBanner: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  ) : null;

const Field: React.FC<{ label: string; error?: string; hint?: string; className?: string; children: React.ReactNode }> = ({
  label,
  error,
  hint,
  className,
  children
}) => (
  <div className={className}>
    <label className={LABEL}>{label}</label>
    {children}
    {error ? (
      <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">{error}</p>
    ) : (
      hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    )}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="border-b border-slate-100 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
    {children}
  </h3>
);

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

interface Props {
  sale?: MachineSale | null;
  // catalogue machine to start the sale with
  initialProductId?: string;
  onClose: () => void;
  onSaved: (sale: MachineSaleDetail) => void;
}

export const MachineSaleForm: React.FC<Props> = ({ sale, initialProductId, onClose, onSaved }) => {
  const { customers, products, warehouses, branches, selectedBranchId, settings, showToast, addAuditLog, refreshCustomers } = useERP();
  const { scope, isOwner, assignedBranchId } = useApiScope();
  const { companies } = useCompanies();
  const currency = settings.currencySymbol || '₹';
  const editing = !!sale;

  const [companyId, setCompanyId] = useState<CompanyId>(sale?.companyId ?? 'main');
  const [branchId, setBranchId] = useState(selectedBranchId !== 'all' ? selectedBranchId : branches[0]?.id || 'branch-1');

  const [customer, setCustomer] = useState<Customer | null>(null);
  // Add a brand new customer without leaving this form.
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustPrefill, setNewCustPrefill] = useState<{ phone: string; name: string }>({ phone: '', name: '' });
  const [customerId, setCustomerId] = useState(sale?.customerId ?? '');
  const [customerName, setCustomerName] = useState(sale?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(sale?.customerPhone ?? '');
  const [customerAddress, setCustomerAddress] = useState(sale?.customerAddress ?? '');
  const [customerGstin, setCustomerGstin] = useState(sale?.customerGstin ?? '');

  const [picked, setPicked] = useState<Product | null>(null);
  // A machine is normally chosen from the catalogue (price, GST and stock follow it). Typing it by hand is the exception.
  const [manualEntry, setManualEntry] = useState(!!sale && !sale.productId);
  const [productId, setProductId] = useState(sale?.productId ?? '');
  const [machineName, setMachineName] = useState(sale?.machineName ?? '');
  const [model, setModel] = useState(sale?.model ?? '');
  const [sku, setSku] = useState(sale?.sku ?? '');
  const [serialNumber, setSerialNumber] = useState(sale?.serialNumber ?? '');
  const [engineNumber, setEngineNumber] = useState(sale?.engineNumber ?? '');
  const [chassisNumber, setChassisNumber] = useState(sale?.chassisNumber ?? '');

  const [listPrice, setListPrice] = useState(sale ? String(sale.listPrice) : '');
  const [discount, setDiscount] = useState(sale ? String(sale.discount) : '0');
  // GST is optional. With GST the final price is (list - discount) plus the tax.
  const [withGst, setWithGst] = useState(!!sale && sale.gstRate > 0);
  const [gstRate, setGstRate] = useState(sale && sale.gstRate > 0 ? String(sale.gstRate) : '5');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceMethod, setAdvanceMethod] = useState<MachinePaymentMode>('Cash');
  const [advanceRef, setAdvanceRef] = useState('');
  // Secondary payment: part of the advance paid another way (for example UPI first, the rest in cash).
  const [advance2Amount, setAdvance2Amount] = useState('');
  const [advance2Method, setAdvance2Method] = useState<MachinePaymentMode>('UPI');
  const [advance2Ref, setAdvance2Ref] = useState('');
  const [saleType, setSaleType] = useState<'normal' | 'subsidy'>(sale?.saleType ?? 'normal');
  const [subsidyScheme, setSubsidyScheme] = useState(sale?.subsidyScheme ?? '');
  const [subsidyAmount, setSubsidyAmount] = useState(sale && sale.subsidyAmount ? String(sale.subsidyAmount) : '');
  const [subsidyAppNo, setSubsidyAppNo] = useState(sale?.subsidyApplicationNo ?? '');
  const [paymentMode, setPaymentMode] = useState<MachinePaymentMode>(sale?.paymentMode ?? 'Cash');
  const [financier, setFinancier] = useState(sale?.financier ?? '');
  const [loanAmount, setLoanAmount] = useState(sale && sale.loanAmount ? String(sale.loanAmount) : '');

  const [bookingDate, setBookingDate] = useState(sale?.bookingDate?.slice(0, 10) || todayIst());
  const [expectedDate, setExpectedDate] = useState(sale?.expectedDeliveryDate?.slice(0, 10) ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(sale ? String(sale.warrantyMonths) : '12');

  // Until the user types a delivery address it simply follows the customer's address.
  const [deliveryTouched, setDeliveryTouched] = useState(
    !!sale && !!sale.deliveryAddress && sale.deliveryAddress !== sale.customerAddress
  );
  const [deliveryAddress, setDeliveryAddress] = useState(sale?.deliveryAddress ?? '');
  const effectiveDelivery = deliveryTouched ? deliveryAddress : customerAddress;

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  const handleSelectCustomer = useCallback((c: Customer) => {
    setCustomer(c);
    setCustomerId(c.id);
    setCustomerName(c.companyName || c.name);
    setCustomerPhone(c.phone);
    setCustomerAddress([c.address, c.locality, c.city, c.pincode].filter(Boolean).join(', '));
    setCustomerGstin(c.gstin || '');
  }, []);

  const handlePickProduct = (p: Product) => {
    setPicked(p);
    setProductId(p.id);
    setMachineName(p.name);
    setSku(p.sku);
    if (p.sellingPrice > 0) setListPrice(String(p.sellingPrice));
    if (p.gstRate > 0 && [0, 5, 12, 18, 28].includes(p.gstRate)) setGstRate(String(p.gstRate));
  };

  const unlinkProduct = () => {
    setPicked(null);
    setProductId('');
    setSku('');
  };

  // opened from "Sell" in the catalogue
  useEffect(() => {
    if (editing || !initialProductId || productId) return;
    const p = products.find((x) => x.id === initialProductId);
    if (p) handlePickProduct(p);
  }, [initialProductId, products.length]);

  // The branch has to be chosen here by owners, and by anyone whose own branch is not known (for example a Super Admin
  // working under another role): the sale needs one specific branch.
  const needsBranchChoice = isOwner || !assignedBranchId || assignedBranchId === 'all';
  const saleBranch = sale ? sale.branchId : needsBranchChoice ? branchId : assignedBranchId;
  const product = picked ?? products.find((p) => p.id === productId) ?? null;
  const branchStock = useMemo(() => {
    if (!product) return null;
    const ids = warehouses.filter((w) => w.branchId === saleBranch).map((w) => w.id);
    return (product.warehouseStocks || [])
      .filter((ws) => ids.includes(ws.warehouseId))
      .reduce((acc, ws) => acc + (ws.available || 0), 0);
  }, [product, warehouses, saleBranch]);

  const list = num(listPrice);
  const disc = num(discount);
  const taxable = Math.max(0, list - disc);
  const gstPct = withGst ? num(gstRate) || 0 : 0;
  const gstAmt = Math.round(taxable * gstPct) / 100;
  const finalPrice = taxable + gstAmt;
  const advance1 = num(advanceAmount);
  const advance2 = advance1 > 0 ? num(advance2Amount) : 0;
  // the second method must differ from the first
  const secondMethod = (advance2Method !== advanceMethod ? advance2Method : ADVANCE_METHODS.find((m) => m !== advanceMethod) || 'UPI') as MachinePaymentMode;
  const advance = sale ? sale.paidAmount : advance1 + advance2;
  const loan = paymentMode === 'Finance' ? num(loanAmount) : 0;
  const subsidy = saleType === 'subsidy' ? num(subsidyAmount) : 0;
  // The customer only pays the price less the government subsidy.
  const payable = Math.max(0, finalPrice - subsidy);
  const balance = Math.max(0, payable - advance);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = 'Customer name is required';
    if (!normalizeIndianPhone(customerPhone)) e.customerPhone = 'Enter a 10-digit mobile number';
    if (!manualEntry && !productId) e.productId = 'Pick the machine from the catalogue, or choose to enter it by hand';
    if (!machineName.trim()) e.machineName = 'Machine name is required';
    if (!Number.isFinite(list) || list <= 0) e.listPrice = 'Enter a list price greater than 0';
    if (!Number.isFinite(disc) || disc < 0) e.discount = 'Discount cannot be negative';
    else if (disc > list) e.discount = 'Discount cannot exceed the list price';
    if (saleType === 'subsidy') {
      if (!subsidyScheme.trim()) e.subsidyScheme = 'Enter the scheme name';
      if (!Number.isFinite(subsidy) || subsidy <= 0) e.subsidyAmount = 'Enter the subsidy amount';
      else if (subsidy >= finalPrice) e.subsidyAmount = 'Subsidy must be less than the final price';
    }
    if (!editing) {
      if (!Number.isFinite(advance) || advance < 0) e.advance = 'Enter a valid advance';
      else if (advance > payable) e.advance = "Advance cannot exceed the customer's share";
    } else if (payable < advance) {
      e.listPrice = `Customer's share is below the ${formatMoney(advance, currency)} already received`;
    }
    if (paymentMode === 'Finance') {
      if (!financier.trim()) e.financier = 'Enter the financier name';
      if (!Number.isFinite(loan) || loan <= 0) e.loanAmount = 'Enter the loan amount';
      else if (loan + advance > payable) e.loanAmount = "Advance plus loan exceeds the customer's share";
    }
    if (!bookingDate) e.bookingDate = 'Booking date is required';
    if (expectedDate && bookingDate && expectedDate < bookingDate) e.expectedDate = 'Cannot be before the booking date';
    const wm = num(warrantyMonths);
    if (!Number.isInteger(wm) || wm < 0 || wm > 120) e.warrantyMonths = 'Whole months, 0 to 120';
    return e;
  }, [
    customerName,
    customerPhone,
    machineName,
    manualEntry,
    productId,
    list,
    disc,
    editing,
    advance,
    finalPrice,
    currency,
    paymentMode,
    financier,
    loan,
    saleType,
    subsidyScheme,
    subsidy,
    payable,
    bookingDate,
    expectedDate,
    warrantyMonths
  ]);

  const err = (k: string) => (submitted ? errors[k] : undefined);

  // `direct` = the Direct sale button: the customer buys and takes the machine now, with no booking in between.
  const submit = async (ev: React.FormEvent | null, direct = false) => {
    ev?.preventDefault();
    setSubmitted(true);
    setServerError('');
    if (Object.keys(errors).length > 0) return;
    const phone = normalizeIndianPhone(customerPhone);
    if (!phone) return;

    const body: MachineSaleInput = {
      companyId,
      customerId: customerId || undefined,
      customerName: customerName.trim(),
      customerPhone: phone.slice(2),
      customerAddress: customerAddress.trim(),
      customerGstin: customerGstin.trim().toUpperCase(),
      productId: productId || undefined,
      machineName: machineName.trim(),
      model: model.trim(),
      sku: sku.trim(),
      serialNumber: serialNumber.trim(),
      engineNumber: engineNumber.trim(),
      chassisNumber: chassisNumber.trim(),
      listPrice: list,
      discount: disc,
      salePrice: finalPrice,
      gstRate: gstPct,
      paymentMode,
      financier: paymentMode === 'Finance' ? financier.trim() : '',
      loanAmount: loan,
      saleType,
      subsidyScheme: saleType === 'subsidy' ? subsidyScheme.trim() : '',
      subsidyAmount: saleType === 'subsidy' ? subsidy : 0,
      subsidyApplicationNo: saleType === 'subsidy' ? subsidyAppNo.trim() : '',
      bookingDate,
      expectedDeliveryDate: editing ? expectedDate : expectedDate || undefined,
      deliveryAddress: effectiveDelivery.trim(),
      warrantyMonths: num(warrantyMonths)
    };

    setSaving(true);
    try {
      let saved: MachineSaleDetail;
      if (sale) {
        saved = await machineSaleApi.update(scopeForSale(scope, sale, isOwner), sale.id, body);
        addAuditLog('Updated Machine Sale', 'Machine Sales', `${saved.saleNumber} for ${saved.customerName}`);
        showToast('Machine sale updated', `${saved.saleNumber} saved`, 'success');
      } else {
        if (advance > 0) {
          body.advance = { amount: advance1, method: advanceMethod, reference: advanceRef.trim() || undefined };
          if (advance2 > 0) body.advance2 = { amount: advance2, method: secondMethod, reference: advance2Ref.trim() || undefined };
        }
        if (direct) body.directSale = true;
        // The chosen branch travels with the sale: the server ignores a branch header for owners.
        if (needsBranchChoice) body.branchId = branchId;
        const createScope = needsBranchChoice ? { ...scope, branchId } : scope;
        saved = await machineSaleApi.create(createScope, body);
        addAuditLog(
          direct ? 'Direct Machine Sale' : 'Booked Machine Sale',
          'Machine Sales',
          `${saved.saleNumber}: ${saved.machineName} for ${saved.customerName} at ${formatMoney(saved.salePrice, currency)}`
        );
        showToast(
          direct ? 'Machine sold' : 'Machine booked',
          direct ? `${saved.saleNumber}: handed over to ${saved.customerName}` : `${saved.saleNumber} created for ${saved.customerName}`,
          'success'
        );
      }
      // a new mobile number was added to the customer list by the server: bring it into the Customers screen
      if (saved.customerCreated || (sale && saved.customerId !== sale.customerId)) {
        refreshCustomers();
        if (saved.customerCreated) showToast('New customer added', `${saved.customerName} was added to Customers.`, 'success');
      }
      onSaved(saved);
    } catch (e: any) {
      setServerError(e.message || 'Could not save the machine sale');
      showToast('Could not save machine sale', e.message || 'Request failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={sale ? `Edit ${sale.saleNumber}` : 'New machine sale'}
      subtitle={
        editing
          ? 'Details can be changed until the machine is dispatched'
          : 'Book a tractor or implement for a customer, or use Direct sale when the customer buys and takes it now'
      }
      onClose={onClose}
      size="xl"
    >
      <form onSubmit={submit} className="space-y-5 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>Sold by</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {companies.map((c) => {
                const active = companyId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCompanyId(c.id)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      active
                        ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {c.displayName}
                  </button>
                );
              })}
            </div>
          </div>
          {needsBranchChoice && !editing && (
            <Field label="Branch *">
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={INPUT}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <section className="space-y-3">
          <SectionTitle>Customer</SectionTitle>
          {!editing && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className={LABEL}>Find existing customer by phone or name</label>
                <button
                  type="button"
                  onClick={() => {
                    setNewCustPrefill({ phone: '', name: '' });
                    setNewCustOpen(true);
                  }}
                  className="cursor-pointer text-[11px] font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  New customer
                </button>
              </div>
              <CustomerPhoneLookup
                selectedCustomer={customer}
                onSelectCustomer={handleSelectCustomer}
                onQuickCreateCustomer={(p) => {
                  setNewCustPrefill({ phone: p.companyName ? '' : p.phone, name: p.companyName || '' });
                  setNewCustOpen(true);
                }}
                customers={customers}
              />
              <NewCustomerModal
                isOpen={newCustOpen}
                onClose={() => setNewCustOpen(false)}
                onCreated={handleSelectCustomer}
                initialPhone={newCustPrefill.phone}
                initialName={newCustPrefill.name}
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer name *" error={err('customerName')}>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} placeholder="Farmer / firm name" />
            </Field>
            <Field label="Mobile number *" error={err('customerPhone')}>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                inputMode="tel"
                className={INPUT}
                placeholder="10-digit mobile"
              />
            </Field>
            <Field label="Address">
              <textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} rows={2} className={INPUT} />
            </Field>
            <Field label="GSTIN" hint="Leave empty for an unregistered customer">
              <input value={customerGstin} onChange={(e) => setCustomerGstin(e.target.value)} className={`${INPUT} font-mono uppercase`} maxLength={15} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle>Machine</SectionTitle>
          <div>
            <label className={LABEL}>{manualEntry ? 'Link to a catalogue machine (optional)' : 'Machine from the catalogue *'}</label>
            <ProductSearchSelect
              value={productId}
              products={picked ? [picked, ...products] : products}
              onChange={handlePickProduct}
              filterMachineryOnly
              branchId={saleBranch}
              placeholder="Search machine by Item No or name..."
            />
            {productId ? (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {branchStock !== null && (
                  <span className={branchStock <= 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
                    {branchStock > 0 ? `${branchStock} in stock at this branch. ` : 'None in stock at this branch, so dispatch will be refused until stock is received. '}
                  </span>
                )}
                One unit is deducted from stock when the machine is dispatched.{' '}
                <button type="button" onClick={unlinkProduct} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                  Unlink
                </button>
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                {manualEntry
                  ? 'Not linked to the catalogue: type the machine details below. Stock is not deducted on dispatch.'
                  : 'Choosing the machine from the catalogue fills its name, price and GST, and deducts one unit of stock when it is dispatched.'}
              </p>
            )}
            {err('productId') && <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">{err('productId')}</p>}
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  if (manualEntry) setManualEntry(false);
                  else {
                    unlinkProduct();
                    setManualEntry(true);
                  }
                }}
                className="mt-1 cursor-pointer text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {manualEntry ? 'Pick it from the catalogue instead' : 'Machine not in the catalogue? Enter it by hand'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(manualEntry || !productId) ? (
              <Field label="Machine name *" error={err('machineName')}>
                <input value={machineName} onChange={(e) => setMachineName(e.target.value)} className={INPUT} placeholder="e.g. Mahindra 575 DI" disabled={!manualEntry} />
              </Field>
            ) : (
              <div>
                <label className={LABEL}>Machine</label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                  <p className="font-bold text-slate-900 dark:text-white">{machineName}</p>
                  <p className="font-mono text-[10px] text-slate-500">{sku}</p>
                </div>
              </div>
            )}
            <Field label="Model / variant">
              <input value={model} onChange={(e) => setModel(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Serial number">
              <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={`${INPUT} font-mono`} />
            </Field>
            <Field label="Engine number">
              <input value={engineNumber} onChange={(e) => setEngineNumber(e.target.value)} className={`${INPUT} font-mono`} />
            </Field>
            <Field label="Chassis number" className="sm:col-span-2">
              <input value={chassisNumber} onChange={(e) => setChassisNumber(e.target.value)} className={`${INPUT} font-mono`} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle>Price and payment</SectionTitle>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {(
              [
                ['normal', 'Normal sale'],
                ['subsidy', 'Government subsidy']
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSaleType(k)}
                className={`cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-semibold ${
                  saleType === k
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {saleType === 'subsidy' && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:grid-cols-3">
              <Field label="Scheme name *" error={err('subsidyScheme')}>
                <input value={subsidyScheme} onChange={(e) => setSubsidyScheme(e.target.value)} className={INPUT} placeholder="e.g. SMAM, state agri engineering scheme" />
              </Field>
              <Field label={`Subsidy amount (${currency}) *`} error={err('subsidyAmount')}>
                <input type="number" min="0" value={subsidyAmount} onChange={(e) => setSubsidyAmount(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Application no.">
                <input value={subsidyAppNo} onChange={(e) => setSubsidyAppNo(e.target.value)} className={INPUT} />
              </Field>
              <p className="text-[11px] text-emerald-800 dark:text-emerald-300 sm:col-span-3">
                The customer pays <strong>{formatMoney(payable, currency)}</strong>. The remaining{' '}
                <strong>{formatMoney(subsidy, currency)}</strong> is claimed from the scheme.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={`List price (${currency}) *`} error={err('listPrice')}>
              <input type="number" min="0" value={listPrice} onChange={(e) => setListPrice(e.target.value)} className={INPUT} />
            </Field>
            <Field label={`Discount (${currency})`} error={err('discount')}>
              <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className={INPUT} />
            </Field>
            <div className="sm:col-span-3">
              <label className={LABEL}>GST</label>
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="GST on this sale" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                  {(
                    [
                      [false, 'Without GST'],
                      [true, 'With GST']
                    ] as [boolean, string][]
                  ).map(([on, text]) => (
                    <button
                      key={text}
                      type="button"
                      role="radio"
                      aria-checked={withGst === on}
                      onClick={() => setWithGst(on)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        withGst === on ? 'bg-slate-800 text-white dark:bg-slate-700' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {withGst && (
                  <select value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" aria-label="GST rate">
                    {['5', '12', '18', '28'].map((g) => (
                      <option key={g} value={g}>
                        {g}% GST
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="sm:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                <span className="text-slate-600 dark:text-slate-400">
                  {withGst
                    ? `${formatMoney(taxable, currency)} + GST ${gstPct}% ${formatMoney(gstAmt, currency)}`
                    : 'No GST added'}
                </span>
                <span className="font-bold text-slate-900 dark:text-white">
                  Final price{withGst ? ' (incl. GST)' : ''}: {formatMoney(finalPrice, currency)}
                </span>
              </div>
            </div>
            {!editing && (
              <>
                <Field label={`Advance / paid now (${currency})`} error={err('advance')}>
                  <input type="number" min="0" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} className={INPUT} placeholder="0" />
                </Field>
                <Field label="Advance method">
                  <select
                    value={advanceMethod}
                    onChange={(e) => setAdvanceMethod(e.target.value as MachinePaymentMode)}
                    disabled={!(advance > 0)}
                    className={INPUT}
                  >
                    {ADVANCE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference (UPI / cheque no.)">
                  <input value={advanceRef} onChange={(e) => setAdvanceRef(e.target.value)} disabled={!(advance > 0)} className={INPUT} />
                </Field>
                {advance1 > 0 && (
                  <>
                    <Field label={`Secondary payment (${currency})`}>
                      <input
                        type="number"
                        min="0"
                        value={advance2Amount}
                        onChange={(e) => setAdvance2Amount(e.target.value)}
                        className={INPUT}
                        placeholder="Optional: rest of the advance paid another way"
                      />
                    </Field>
                    <Field label="Secondary method">
                      <select
                        value={secondMethod}
                        onChange={(e) => setAdvance2Method(e.target.value as MachinePaymentMode)}
                        disabled={!(advance2 > 0)}
                        className={INPUT}
                      >
                        {ADVANCE_METHODS.filter((m) => m !== advanceMethod).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Secondary reference">
                      <input value={advance2Ref} onChange={(e) => setAdvance2Ref(e.target.value)} disabled={!(advance2 > 0)} className={INPUT} />
                    </Field>
                  </>
                )}
              </>
            )}
            <Field label="Balance paid by">
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as MachinePaymentMode)} className={INPUT}>
                {MACHINE_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            {paymentMode === 'Finance' && (
              <>
                <Field label="Financier *" error={err('financier')}>
                  <input value={financier} onChange={(e) => setFinancier(e.target.value)} className={INPUT} placeholder="Bank / NBFC name" />
                </Field>
                <Field label={`Loan amount (${currency}) *`} error={err('loanAmount')}>
                  <input type="number" min="0" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className={INPUT} />
                </Field>
              </>
            )}
            <div>
              <label className={LABEL}>Balance to collect</label>
              <div
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                  balance > 0
                    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                {formatMoney(balance, currency)}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle>Dates and delivery</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Booking / sale date *" error={err('bookingDate')}>
              <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Expected delivery" error={err('expectedDate')}>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Warranty (months)" error={err('warrantyMonths')}>
              <input type="number" min="0" step="1" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Delivery address" hint="Defaults to the customer address" className="sm:col-span-3">
              <textarea
                value={effectiveDelivery}
                onChange={(e) => {
                  setDeliveryTouched(true);
                  setDeliveryAddress(e.target.value);
                }}
                rows={2}
                className={INPUT}
                placeholder="Farm / village address where the machine is to be delivered"
              />
            </Field>
          </div>
        </section>

        {submitted && Object.keys(errors).length > 0 && <ErrorBanner message="Please fix the highlighted fields." />}
        <ErrorBanner message={serverError} />

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={editing ? BTN_PRIMARY : BTN_GHOST}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? 'Save changes' : 'Book machine'}
          </button>
          {!editing && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(null, true)}
              title="The customer buys the machine now: it is handed over straight away, with no booking"
              className={BTN_PRIMARY}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Direct sale
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
};
