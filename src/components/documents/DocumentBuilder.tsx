import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useCompanies } from '../../hooks/useCompanies';
import { CustomerPhoneLookup } from '../common/CustomerPhoneLookup';
import { NewCustomerModal } from '../common/NewCustomerModal';
import { ProductSearchSelect } from '../common/ProductSearchSelect';
import type { Customer, Product } from '../../types/erp';
import {
  EXTRA_TEXT_KEYS,
  GST_RATES,
  documentApi,
  type DocType,
  type DocumentDetail,
  type DocumentExtrasPayload,
  type DocumentPayload,
  type ExtraTextKey,
  type InvoiceKind
} from '../../services/documentApi';
import type { CompanyId } from '../../services/companyApi';
import {
  DEFAULT_CREDIT_DAYS,
  DEFAULT_TERMS,
  INDIAN_STATES,
  SELLER_STATE,
  addDaysIso,
  calcDocument,
  inr,
  isInterStateSupply,
  stateFromGstin,
  todayIst
} from './calc';
import { BTN_GHOST, BTN_PRIMARY, CARD, INPUT, LABEL, Modal, useApiScope } from './ui';
import { amountInWords } from '../../utils/amountInWords';

interface LineState {
  key: string;
  product?: Product;
  productId: string;
  description: string;
  batchNote: string;
  sku: string;
  hsnCode: string;
  unit: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  gstRate: number;
}

let lineSeq = 0;
const newLine = (): LineState => ({
  key: `l${++lineSeq}`,
  productId: '',
  description: '',
  batchNote: '',
  sku: '',
  hsnCode: '',
  unit: 'Nos',
  quantity: '1',
  rate: '',
  discountPercent: '0',
  gstRate: 18
});

const n = (s: string) => (s.trim() === '' ? 0 : Number(s));

const EWB_DEFAULTS: Partial<Record<ExtraTextKey, string>> = {
  ewbMode: '1 - Road',
  ewbSupplyType: 'Outward-Supply',
  ewbTransactionType: 'Regular'
};

const PORTAL_FIELDS: ExtraTextKey[] = ['irn', 'ackNo', 'ackDate', 'einvoiceQr', 'ewayBillNo'];

const Collapsible: React.FC<{ title: string; hint?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, hint, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-bold text-slate-900 dark:text-white">{title}</span>
          {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3 border-t border-slate-100 p-4 dark:border-slate-800">{children}</div>}
    </div>
  );
};

type SaveAction = 'draft' | 'finalize';

const COMPANY_KEY = 'erp.documents.companyId';
const readStoredCompany = (): CompanyId => {
  try {
    const v = localStorage.getItem(COMPANY_KEY);
    if (v === 'main' || v === 'second') return v;
  } catch {
    // storage unavailable: fall back to the default
  }
  return 'main';
};
const storeCompany = (id: CompanyId) => {
  try {
    localStorage.setItem(COMPANY_KEY, id);
  } catch {
    // ignore
  }
};

interface Props {
  docType: DocType;
  // Only used for a new invoice: opens the builder on "Invoice only (no GST)".
  initialKind?: InvoiceKind;
  existing?: DocumentDetail;
  onClose: () => void;
  onSaved: (doc: DocumentDetail, finalized: boolean) => void;
}

export const DocumentBuilder: React.FC<Props> = ({ docType, initialKind, existing, onClose, onSaved }) => {
  const { customers, products, branches, warehouses, selectedBranchId, showToast, addAuditLog, refreshProducts } = useERP();
  const { scope, isOwner, assignedBranchId } = useApiScope();
  const { companies } = useCompanies();
  const isInvoice = docType === 'invoice';
  const label = isInvoice ? 'invoice' : 'quotation';
  const [companyId, setCompanyId] = useState<CompanyId>(() => existing?.companyId ?? readStoredCompany());
  // 'plain' = no GST. Invoices choose Tax Invoice / Invoice only; quotations choose with / without GST.
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind>(() => existing?.invoiceKind ?? initialKind ?? 'tax');
  // Company and kind are fixed once a document leaves Draft (the number was already issued).
  const canChooseIssuer = !existing || existing.storedStatus === 'Draft';
  const isPlain = invoiceKind === 'plain';
  // The invoice type is fixed once issued (it picks the number series); a quotation's GST choice stays editable.
  const canChooseKind = isInvoice ? canChooseIssuer : true;

  const [branchId, setBranchId] = useState(
    existing?.branchId || (isOwner ? (selectedBranchId !== 'all' ? selectedBranchId : branches[0]?.id || 'branch-1') : assignedBranchId)
  );
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Add a brand new customer without leaving this document.
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustPrefill, setNewCustPrefill] = useState<{ phone: string; name: string }>({ phone: '', name: '' });
  const [customerId, setCustomerId] = useState(existing?.customerId || '');
  const [customerName, setCustomerName] = useState(existing?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(existing?.customerPhone || '');
  const [gstin, setGstin] = useState(existing?.customerGstin || '');
  const [billing, setBilling] = useState(existing?.billingAddress || '');
  const [placeOfSupply, setPlaceOfSupply] = useState(existing?.placeOfSupply || SELLER_STATE);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(existing?.pricesIncludeTax ?? false);
  const [sameConsignee, setSameConsignee] = useState(!(existing?.consigneeName || existing?.consigneeAddress || existing?.consigneeGstin));
  const [distanceKm, setDistanceKm] = useState(existing?.ewbDistanceKm != null ? String(existing.ewbDistanceKm) : '');
  const [x, setX] = useState<Record<ExtraTextKey, string>>(() => {
    const init = {} as Record<ExtraTextKey, string>;
    for (const k of EXTRA_TEXT_KEYS) init[k] = existing?.[k] ?? EWB_DEFAULTS[k] ?? '';
    if (!init.buyerStateName) init.buyerStateName = existing?.placeOfSupply || SELLER_STATE;
    return init;
  });
  const setField = (k: ExtraTextKey, v: string) => setX((cur) => ({ ...cur, [k]: v }));
  const field = (k: ExtraTextKey, labelText: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className={LABEL}>{labelText}</label>
      <input value={x[k]} onChange={(e) => setField(k, e.target.value)} className={INPUT} {...props} />
    </div>
  );
  const today = todayIst();
  const [docDate, setDocDate] = useState(existing?.docDate || today);
  const [endDate, setEndDate] = useState(
    (isInvoice ? existing?.dueDate : existing?.validUntil) || addDaysIso(existing?.docDate || today, DEFAULT_CREDIT_DAYS)
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    existing && existing.items.length
      ? existing.items.map((it) => ({
          key: `l${++lineSeq}`,
          product: products.find((p) => p.id === it.productId),
          productId: it.productId || '',
          description: it.description,
          batchNote: it.batchNote || '',
          sku: it.sku || '',
          hsnCode: it.hsnCode || '',
          unit: it.unit || 'Nos',
          quantity: String(it.quantity),
          rate: String(it.rate),
          discountPercent: String(it.discountPercent),
          gstRate: it.gstRate
        }))
      : [newLine()]
  );
  const [otherCharges, setOtherCharges] = useState(existing ? String(existing.otherCharges) : '0');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [terms, setTerms] = useState(existing?.terms ?? DEFAULT_TERMS[docType]);
  const [deductStock, setDeductStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');
  const [saving, setSaving] = useState<SaveAction | null>(null);
  const [error, setError] = useState('');

  const branchWarehouses = useMemo(() => warehouses.filter((w) => w.branchId === branchId), [warehouses, branchId]);
  const interState = !isPlain && isInterStateSupply(gstin, placeOfSupply);
  // The server forces rate 0 and no tax on "Invoice only", so the preview must do the same.
  const calc = useMemo(
    () =>
      calcDocument(
        lines.map((l) => ({ quantity: n(l.quantity), rate: n(l.rate), discountPercent: n(l.discountPercent), gstRate: isPlain ? 0 : l.gstRate })),
        interState,
        n(otherCharges),
        isPlain ? false : pricesIncludeTax
      ),
    [lines, interState, otherCharges, pricesIncludeTax, isPlain]
  );

  const chooseCompany = (id: CompanyId) => {
    if (!canChooseIssuer) return;
    setCompanyId(id);
    storeCompany(id);
  };

  const handleSelectCustomer = useCallback((c: Customer) => {
    setCustomer(c);
    setCustomerId(c.id);
    setCustomerName(c.companyName || c.name);
    setCustomerPhone(c.phone);
    setGstin(c.gstin || '');
    const address = [c.address, c.locality, c.city, c.state, c.pincode].filter(Boolean).join(', ');
    setBilling(address);
    const fromGstin = stateFromGstin(c.gstin);
    const own = INDIAN_STATES.find((s) => s.name.toLowerCase() === (c.state || '').toLowerCase())?.name;
    const state = fromGstin || own || SELLER_STATE;
    setPlaceOfSupply(state);
    setX((cur) => ({ ...cur, buyerStateName: state }));
  }, []);

  const changeGstin = (value: string) => {
    const g = value.toUpperCase().replace(/\s+/g, '');
    setGstin(g);
    const st = stateFromGstin(g);
    if (st && g.length >= 2) {
      setPlaceOfSupply(st);
      setField('buyerStateName', st);
    }
  };

  const patchLine = (key: string, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const applyProduct = (key: string, p: Product) =>
    patchLine(key, {
      product: p,
      productId: p.id,
      description: p.name,
      sku: p.sku,
      hsnCode: p.hsnCode || '',
      unit: p.unit || 'Nos',
      rate: String(p.sellingPrice ?? 0),
      gstRate: (GST_RATES as readonly number[]).includes(p.gstRate) ? p.gstRate : 18
    });

  const buildPayload = (action: SaveAction): DocumentPayload => {
    if (!customerName.trim()) throw new Error('Customer name is required');
    if (!isInvoice && !endDate) throw new Error('Enter the validity date');
    if (endDate && endDate < docDate) throw new Error(isInvoice ? 'Due date cannot be before the invoice date' : 'Valid until cannot be before the quotation date');
    const items = lines.map((l, i) => {
      const row = i + 1;
      if (!l.description.trim()) throw new Error(`Line ${row}: enter a description or pick a product`);
      if (!(n(l.quantity) > 0)) throw new Error(`Line ${row}: quantity must be greater than 0`);
      if (!Number.isFinite(n(l.rate)) || n(l.rate) < 0) throw new Error(`Line ${row}: rate must be 0 or more`);
      const d = n(l.discountPercent);
      if (!Number.isFinite(d) || d < 0 || d > 100) throw new Error(`Line ${row}: discount must be between 0 and 100`);
      return {
        productId: l.productId || undefined,
        description: l.description.trim(),
        batchNote: l.batchNote.trim() || undefined,
        sku: l.sku.trim() || undefined,
        hsnCode: l.hsnCode.trim() || undefined,
        unit: l.unit.trim() || undefined,
        quantity: n(l.quantity),
        rate: n(l.rate),
        discountPercent: d,
        gstRate: isPlain ? 0 : l.gstRate
      };
    });
    if (items.length === 0) throw new Error('Add at least one line item');
    if (n(otherCharges) < 0) throw new Error('Other charges must be 0 or more');

    const irn = x.irn.trim();
    if (isInvoice && !isPlain && irn && !/^[0-9a-fA-F]{64}$/.test(irn)) throw new Error('IRN must be 64 hexadecimal characters');
    if (isInvoice && !isPlain && x.ewayBillNo.trim() && !/^\d{12}$/.test(x.ewayBillNo.trim())) throw new Error('e-Way Bill number must be 12 digits');
    if (!sameConsignee && x.consigneeGstin.trim() && x.consigneeGstin.trim().length !== 15) throw new Error('Consignee GSTIN must be 15 characters');
    if (distanceKm.trim() && !(Number.isInteger(Number(distanceKm)) && Number(distanceKm) >= 0)) throw new Error('Approx distance must be a whole number of km');

    const extras: DocumentExtrasPayload = {};
    for (const k of EXTRA_TEXT_KEYS) {
      const v = x[k].trim();
      if (v) extras[k] = v;
    }
    if (sameConsignee) {
      for (const k of ['consigneeName', 'consigneeAddress', 'consigneeGstin', 'consigneeStateName', 'consigneeStateCode'] as ExtraTextKey[]) delete extras[k];
    }
    if (!isInvoice || isPlain) {
      for (const k of EXTRA_TEXT_KEYS) {
        if (PORTAL_FIELDS.includes(k) || k.startsWith('ewb') || k.startsWith('transporter')) delete extras[k];
      }
    }
    if (isPlain) {
      for (const k of ['buyerStateName', 'buyerStateCode', 'consigneeStateName', 'consigneeStateCode'] as ExtraTextKey[]) delete extras[k];
    }
    if (extras.vehicleNo) extras.vehicleNo = extras.vehicleNo.toUpperCase();

    const payload: DocumentPayload = {
      customerId: customerId || undefined,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerGstin: gstin.trim() || undefined,
      billingAddress: billing.trim() || undefined,
      ...extras,
      shippingAddress: sameConsignee ? undefined : x.consigneeAddress.trim() || undefined,
      pricesIncludeTax: isPlain ? false : pricesIncludeTax,
      ewbDistanceKm: isInvoice && !isPlain && distanceKm.trim() ? Number(distanceKm) : undefined,
      placeOfSupply: isPlain ? SELLER_STATE : placeOfSupply,
      docDate,
      otherCharges: n(otherCharges),
      notes: notes.trim() || undefined,
      terms: terms.trim() || undefined,
      items
    };
    if (isInvoice) payload.dueDate = endDate;
    else payload.validUntil = endDate;
    if (canChooseIssuer) {
      payload.companyId = companyId;
    }
    if (canChooseKind) payload.invoiceKind = invoiceKind;

    if (action === 'finalize') {
      payload.status = isInvoice ? 'Issued' : 'Sent';
      if (isInvoice) {
        payload.deductStock = deductStock;
        payload.warehouseId = deductStock && warehouseId ? warehouseId : undefined;
      }
    } else if (!existing) {
      payload.status = 'Draft';
    }
    return payload;
  };

  const save = async (action: SaveAction) => {
    setError('');
    let payload: DocumentPayload;
    try {
      payload = buildPayload(action);
    } catch (e: any) {
      setError(e.message);
      return;
    }
    setSaving(action);
    try {
      const saved = existing
        ? await documentApi.update(scope, existing.id, payload, isOwner ? selectedBranchId : undefined, forceEdit)
        : await documentApi.create(scope, { ...payload, docType, branchId: isOwner ? branchId : undefined });
      addAuditLog(
        existing ? `Updated ${label}` : `Created ${label}`,
        'Billing',
        `${saved.docNumber} for ${saved.customerName} (${inr(saved.grandTotal)})`
      );
      showToast(
        action === 'finalize' ? (isInvoice ? 'Invoice issued' : 'Quotation marked as sent') : 'Draft saved',
        `${saved.docNumber} for ${saved.customerName}`,
        'success'
      );
      // Finalising an invoice with stock deduction changes server stock.
      if ((action === 'finalize' && isInvoice && deductStock) || forceEdit) refreshProducts();
      onSaved(saved, action === 'finalize');
    } catch (e: any) {
      setError(e.message);
      showToast(`Could not save ${label}`, e.message, 'error');
    } finally {
      setSaving(null);
    }
  };

  const busy = saving !== null;
  const alreadySent = !isInvoice && existing?.storedStatus === 'Sent';
  // The Super Admin editing an invoice that was already issued or paid: stock and payments are kept in line by the server.
  const forceEdit = !!existing && isInvoice && ['Issued', 'Partially Paid', 'Paid'].includes(existing.storedStatus);

  return (
    <Modal
      title={existing ? `Edit ${label} ${existing.docNumber}` : `New ${label}${isPlain ? ' (no GST)' : ''}`}
      subtitle={isInvoice ? (isPlain ? 'Invoice without GST' : 'GST tax invoice') : isPlain ? 'Price quotation without GST, convertible to an invoice' : 'Price quotation with GST, convertible to an invoice'}
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-5 p-5">
        <div className="space-y-3">
          <div>
            <p className={LABEL}>Issuing company</p>
            <div role="radiogroup" aria-label="Issuing company" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {companies.map((c) => {
                const active = c.id === companyId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canChooseIssuer}
                    onClick={() => chooseCompany(c.id)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                      active
                        ? 'border-slate-800 bg-slate-50 ring-1 ring-slate-800 dark:border-slate-300 dark:bg-slate-800 dark:ring-slate-300'
                        : 'border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="block text-sm font-bold text-slate-900 dark:text-white">{c.displayName}</span>
                    {c.gstin && <span className="mt-0.5 block font-mono text-[11px] text-slate-500 dark:text-slate-400">GSTIN {c.gstin}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {(
            <div>
              <p className={LABEL}>{isInvoice ? 'Invoice type' : 'GST'}</p>
              <div role="radiogroup" aria-label={isInvoice ? 'Invoice type' : 'GST on quotation'} className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {(
                  (isInvoice
                    ? [
                        ['tax', 'Tax Invoice (GST)'],
                        ['plain', 'Invoice only (no GST)']
                      ]
                    : [
                        ['tax', 'With GST'],
                        ['plain', 'Without GST']
                      ]) as [InvoiceKind, string][]
                ).map(([k, text]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={invoiceKind === k}
                    disabled={!canChooseKind}
                    onClick={() => setInvoiceKind(k)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                      invoiceKind === k
                        ? 'bg-slate-800 text-white dark:bg-slate-700'
                        : 'text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!canChooseIssuer && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              The company{isInvoice ? ' and invoice type are' : ' is'} fixed once the {label} has been issued or sent. Duplicate it to issue from another company.
            </p>
          )}
        </div>

        <div className={`grid grid-cols-1 gap-3 ${isPlain ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
          {isOwner && !existing && (
            <div>
              <label className={LABEL}>Branch</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={INPUT}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={LABEL}>{isInvoice ? 'Invoice date' : 'Quotation date'}</label>
            <input
              type="date"
              value={docDate}
              onChange={(e) => {
                const v = e.target.value;
                setDocDate(v);
                if (v && (!endDate || endDate < v)) setEndDate(addDaysIso(v, DEFAULT_CREDIT_DAYS));
              }}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>{isInvoice ? 'Due date' : 'Valid until'}</label>
            <input type="date" value={endDate} min={docDate} onChange={(e) => setEndDate(e.target.value)} className={INPUT} />
          </div>
          {!isPlain && (
            <div>
              <label className={LABEL}>Place of supply</label>
              <select value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} className={INPUT}>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!isPlain && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={pricesIncludeTax}
              onChange={(e) => setPricesIncludeTax(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            />
            Entered rates include GST (the base rate and taxable value are worked back from the rate)
          </label>
        )}

        <div className={`${CARD} space-y-3 p-4`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Customer</h3>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className={LABEL}>Find customer by phone or name</label>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={LABEL}>Customer name *</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} placeholder="Name or firm" />
            </div>
            <div>
              <label className={LABEL}>Phone</label>
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={INPUT} placeholder="10-digit mobile" />
            </div>
            <div>
              <label className={LABEL}>GSTIN</label>
              <input value={gstin} onChange={(e) => changeGstin(e.target.value)} maxLength={15} className={`${INPUT} font-mono`} placeholder="Leave empty if unregistered" />
            </div>
          </div>
          <div className={`grid grid-cols-1 gap-3 ${isPlain ? '' : 'sm:grid-cols-[1fr_16rem]'}`}>
            <div>
              <label className={LABEL}>Billing address</label>
              <textarea value={billing} onChange={(e) => setBilling(e.target.value)} rows={3} className={INPUT} />
            </div>
            {!isPlain && (
              <div>
                <label className={LABEL}>Buyer state name and code</label>
                <select
                  value={x.buyerStateName}
                  onChange={(e) => {
                    setField('buyerStateName', e.target.value);
                    setPlaceOfSupply(e.target.value);
                  }}
                  className={INPUT}
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <Collapsible title="Consignee (ship to)" hint={sameConsignee ? 'Same as buyer' : x.consigneeName || 'Different ship-to party'} defaultOpen={!sameConsignee}>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={sameConsignee}
              onChange={(e) => setSameConsignee(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            />
            Same as buyer
          </label>
          {!sameConsignee && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field('consigneeName', 'Consignee name')}
              {field('consigneeGstin', 'Consignee GSTIN', { maxLength: 15, className: `${INPUT} font-mono` })}
              <div className="sm:col-span-2">
                <label className={LABEL}>Consignee address</label>
                <textarea value={x.consigneeAddress} onChange={(e) => setField('consigneeAddress', e.target.value)} rows={3} className={INPUT} />
              </div>
              {!isPlain && (
                <div>
                  <label className={LABEL}>State name and code</label>
                  <select value={x.consigneeStateName} onChange={(e) => setField('consigneeStateName', e.target.value)} className={INPUT}>
                    <option value="">Select state</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.name}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </Collapsible>

        <div className={`${CARD} space-y-3 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Items</h3>
            {!isPlain && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  interState
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300'
                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {interState ? 'Interstate supply: IGST applies' : 'Intra-state supply: CGST + SGST'}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.key} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
                <div className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 text-[11px] font-bold text-slate-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <ProductSearchSelect
                      value={l.productId}
                      products={l.product ? [l.product, ...products] : products}
                      branchId={branchId}
                      onChange={(p) => applyProduct(l.key, p)}
                      placeholder="Search a product to fill details, or type a free-text line below"
                    />
                  </div>
                  <div className="shrink-0 pt-2 text-right text-xs font-bold text-slate-900 dark:text-white">{inr(calc.lines[i]?.lineTotal ?? 0)}</div>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}
                    aria-label="Remove line"
                    className="mt-0.5 rounded p-2.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:mt-1 sm:p-1.5 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                  <div className={`col-span-2 sm:col-span-6 ${isPlain ? 'lg:col-span-7' : 'lg:col-span-4'}`}>
                    <label className={LABEL}>Description</label>
                    <input value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} className={INPUT} />
                  </div>
                  {!isPlain && (
                    <div className="sm:col-span-2 lg:col-span-2">
                      <label className={LABEL}>HSN</label>
                      <input value={l.hsnCode} onChange={(e) => patchLine(l.key, { hsnCode: e.target.value })} className={`${INPUT} font-mono`} />
                    </div>
                  )}
                  <div className="lg:col-span-1">
                    <label className={LABEL}>Unit</label>
                    <input value={l.unit} onChange={(e) => patchLine(l.key, { unit: e.target.value })} className={INPUT} />
                  </div>
                  <div className="lg:col-span-1">
                    <label className={LABEL}>Qty</label>
                    <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} className={INPUT} />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={LABEL}>{pricesIncludeTax && !isPlain ? 'Rate (incl. GST)' : 'Rate'}</label>
                    <input type="number" min="0" step="any" value={l.rate} onChange={(e) => patchLine(l.key, { rate: e.target.value })} className={INPUT} />
                  </div>
                  <div className="lg:col-span-1">
                    <label className={LABEL}>Disc %</label>
                    <input type="number" min="0" max="100" step="any" value={l.discountPercent} onChange={(e) => patchLine(l.key, { discountPercent: e.target.value })} className={INPUT} />
                  </div>
                  {!isPlain && (
                    <div className="lg:col-span-1">
                      <label className={LABEL}>GST %</label>
                      <select value={l.gstRate} onChange={(e) => patchLine(l.key, { gstRate: Number(e.target.value) })} className={INPUT}>
                        {GST_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className={LABEL}>Batch / serial / engine no. (printed under the item)</label>
                  <input value={l.batchNote} onChange={(e) => patchLine(l.key, { batchNote: e.target.value })} maxLength={200} className={INPUT} placeholder="e.g. Engine no. 4SP123456, Chassis no. MA3..." />
                </div>
                {l.productId && (
                  <button
                    type="button"
                    onClick={() => patchLine(l.key, { productId: '', product: undefined })}
                    className="text-[11px] font-semibold text-slate-500 underline hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                  >
                    Unlink product (no stock deduction for this line)
                  </button>
                )}
              </div>
            ))}
          </div>

          <button type="button" onClick={() => setLines((ls) => [...ls, newLine()])} className={BTN_GHOST}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>

        <Collapsible
          title={isInvoice ? 'Dispatch and transport details' : 'Payment and reference details'}
          hint="Printed in the reference grid at the top right of the document"
          defaultOpen={!!(x.deliveryNote || x.vehicleNo || x.dispatchedThrough || x.paymentTerms || x.referenceNo)}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {field('paymentTerms', 'Mode/Terms of Payment')}
            {field('referenceNo', 'Reference No.')}
            <div>
              <label className={LABEL}>Reference date</label>
              <input type="date" value={x.referenceDate} onChange={(e) => setField('referenceDate', e.target.value)} className={INPUT} />
            </div>
            {field('otherReferences', 'Other references')}
            {isInvoice && (
              <>
                {field('deliveryNote', 'Delivery note')}
                <div>
                  <label className={LABEL}>Delivery note date</label>
                  <input type="date" value={x.deliveryNoteDate} onChange={(e) => setField('deliveryNoteDate', e.target.value)} className={INPUT} />
                </div>
                {field('buyerOrderNo', "Buyer's order no.")}
                <div>
                  <label className={LABEL}>Buyer's order date</label>
                  <input type="date" value={x.buyerOrderDate} onChange={(e) => setField('buyerOrderDate', e.target.value)} className={INPUT} />
                </div>
                {field('dispatchDocNo', 'Dispatch doc no.')}
                {field('dispatchedThrough', 'Dispatched through')}
                {field('destination', 'Destination')}
                {field('ladingNo', 'Bill of lading / LR-RR no.')}
                <div>
                  <label className={LABEL}>LR-RR date</label>
                  <input type="date" value={x.ladingDate} onChange={(e) => setField('ladingDate', e.target.value)} className={INPUT} />
                </div>
                {field('vehicleNo', 'Motor vehicle no.', { className: `${INPUT} uppercase`, placeholder: 'TN88W0023' })}
              </>
            )}
          </div>
          <div>
            <label className={LABEL}>Terms of delivery</label>
            <textarea value={x.termsOfDelivery} onChange={(e) => setField('termsOfDelivery', e.target.value)} rows={2} maxLength={300} className={INPUT} />
          </div>
        </Collapsible>

        {isInvoice && !isPlain && (
          <Collapsible
            title="e-Invoice and e-Way Bill details"
            hint="Optional - printed on the invoice and as the e-Way Bill page"
            defaultOpen={!!(x.irn || x.ewayBillNo)}
          >
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              This app cannot reach the GST e-invoice portal. Generate the IRN, Ack No., signed QR and e-Way Bill on the portal, in Tally or through your GSP, then paste the values here. The IRN block and QR print only when an IRN is entered, and the e-Way Bill page prints only when an e-Way Bill number is entered.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label className={LABEL}>IRN (64 characters)</label>
                <input value={x.irn} onChange={(e) => setField('irn', e.target.value.trim())} maxLength={64} className={`${INPUT} font-mono`} />
              </div>
              {field('ackNo', 'Ack No.')}
              <div>
                <label className={LABEL}>Ack date</label>
                <input type="date" value={x.ackDate} onChange={(e) => setField('ackDate', e.target.value)} className={INPUT} />
              </div>
              <div className="sm:col-span-3">
                <label className={LABEL}>Signed QR text</label>
                <textarea value={x.einvoiceQr} onChange={(e) => setField('einvoiceQr', e.target.value.trim())} rows={3} maxLength={6000} className={`${INPUT} font-mono`} placeholder="Paste the signed QR code text (starts with eyJ...)" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 dark:border-slate-800">
              {field('ewayBillNo', 'e-Way Bill no. (12 digits)', { maxLength: 12, inputMode: 'numeric' })}
              <div>
                <label className={LABEL}>Generated on</label>
                <input type="datetime-local" value={x.ewbGeneratedAt} onChange={(e) => setField('ewbGeneratedAt', e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Valid upto</label>
                <input type="datetime-local" value={x.ewbValidUpto} onChange={(e) => setField('ewbValidUpto', e.target.value)} className={INPUT} />
              </div>
              {field('ewbMode', 'Mode')}
              <div>
                <label className={LABEL}>Approx distance (km)</label>
                <input type="number" min="0" step="1" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} className={INPUT} />
              </div>
              {field('ewbSupplyType', 'Supply type')}
              {field('ewbTransactionType', 'Transaction type')}
              {field('ewbFromPlace', 'Dispatch from (place)')}
              {field('transporterId', 'Transporter ID')}
              {field('transporterName', 'Transporter name')}
              {field('transporterDocNo', 'Transporter doc no.')}
              <div>
                <label className={LABEL}>Transporter doc date</label>
                <input type="date" value={x.transporterDocDate} onChange={(e) => setField('transporterDocDate', e.target.value)} className={INPUT} />
              </div>
            </div>
          </Collapsible>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-3">
            <div>
              <label className={LABEL}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} placeholder="Shown on the printed document" />
            </div>
            <div>
              <label className={LABEL}>Terms and conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} className={INPUT} />
            </div>
            {forceEdit && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                This invoice was already issued{existing && existing.paidAmount > 0 ? ` and ${inr(existing.paidAmount)} has been received on it` : ''}. Your changes are saved on the same invoice number. If stock was taken off for it, the stock is corrected to match. The new total cannot be lower than what was received.
                {existing?.sourceMachineSaleId ? ' This invoice belongs to a machine sale: once you save it by hand, it no longer changes when the machine sale is edited, but its payments still follow the machine sale.' : ''}
              </div>
            )}
            {isInvoice && !forceEdit && (
              <div className={`${CARD} space-y-2 p-3`}>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={deductStock}
                    onChange={(e) => setDeductStock(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                  />
                  Deduct stock when the invoice is issued
                </label>
                {deductStock && (
                  <div>
                    <label className={LABEL}>Warehouse</label>
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={INPUT}>
                      <option value="">Auto (warehouse with most stock)</option>
                      {branchWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Applies only on Save and issue, to lines linked to a product. Quantities must be whole numbers.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`${CARD} space-y-1.5 p-4 text-xs`}>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Subtotal</span>
              <span>{inr(calc.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Discount</span>
              <span>-{inr(calc.totalDiscount)}</span>
            </div>
            {!isPlain && (
              <>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Taxable amount</span>
                  <span>{inr(calc.taxableAmount)}</span>
                </div>
                {interState ? (
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>IGST</span>
                    <span>{inr(calc.igst)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>CGST</span>
                      <span>{inr(calc.cgst)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>SGST</span>
                      <span>{inr(calc.sgst)}</span>
                    </div>
                  </>
                )}
              </>
            )}
            <div className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-400">
              <span>Other charges</span>
              <input
                type="number"
                min="0"
                step="any"
                value={otherCharges}
                onChange={(e) => setOtherCharges(e.target.value)}
                aria-label="Other charges"
                className={`${INPUT} w-28 text-right`}
              />
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Round off</span>
              <span>{inr(calc.roundOff)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-900 dark:border-slate-800 dark:text-white">
              <span>Grand total</span>
              <span>{inr(calc.grandTotal)}</span>
            </div>
            <p className="pt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{amountInWords(calc.grandTotal)}</p>
          </div>
        </div>

        {/* Stays at the bottom of the screen while the form scrolls, so Save is always one tap away */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-5 space-y-2 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] sm:px-5 dark:border-slate-800 dark:bg-slate-900">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Grand total</p>
              <p className="text-base font-bold text-slate-900 dark:text-white">{inr(calc.grandTotal)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>
                Cancel
              </button>
              <button type="button" onClick={() => save('draft')} disabled={busy} className={alreadySent || forceEdit ? BTN_PRIMARY : BTN_GHOST}>
                {saving === 'draft' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {forceEdit ? 'Save changes' : isInvoice ? 'Save draft' : 'Save'}
              </button>
              {!alreadySent && !forceEdit && (
                <button type="button" onClick={() => save('finalize')} disabled={busy} className={BTN_PRIMARY}>
                  {saving === 'finalize' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isInvoice ? 'Save and issue' : 'Mark as sent'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
