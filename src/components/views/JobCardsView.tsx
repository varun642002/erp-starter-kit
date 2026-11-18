import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { CustomerPhoneLookup } from '../common/CustomerPhoneLookup';
import { ProductSearchSelect } from '../common/ProductSearchSelect';
import type { Customer, Product } from '../../types/erp';
import type { ApiScope } from '../../services/apiClient';
import {
  JOB_STATUSES,
  JOB_STATUS_FLOW,
  PAYMENT_METHODS,
  jobCardApi,
  type JobCard,
  type JobCardDetail,
  type JobCardSummary,
  type JobStatus,
  type PaymentMethod,
  type SerialLookup
} from '../../services/jobCardApi';
import { serviceCatalogApi, type ServiceItem } from '../../services/serviceCatalogApi';

const STATUS_STYLES: Record<JobStatus, string> = {
  Received: 'text-slate-700 dark:text-slate-300',
  Diagnosing: 'text-sky-700 dark:text-sky-300',
  'Awaiting Parts': 'text-amber-700 dark:text-amber-300',
  'In Progress': 'text-indigo-700 dark:text-indigo-300',
  Ready: 'text-emerald-700 dark:text-emerald-300',
  Delivered: 'text-teal-700 dark:text-teal-300',
  Cancelled: 'text-rose-700 dark:text-rose-300'
};

const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const LABEL = 'mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400';
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600';
const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
const CARD = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';

const OPEN_EXCLUDED: JobStatus[] = ['Ready', 'Delivered', 'Cancelled'];

const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const isOverdue = (c: Pick<JobCard, 'promisedDate' | 'status'>) =>
  !!c.promisedDate && c.promisedDate < todayIst() && !OPEN_EXCLUDED.includes(c.status);

const StatusBadge: React.FC<{ status: JobStatus }> = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap text-[11px] font-bold ${STATUS_STYLES[status]}`}>
    {status}
  </span>
);

function useApiScope() {
  const { currentRole, selectedBranchId } = useERP();
  const { assignedBranchId } = useAuth();
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const scope: ApiScope = useMemo(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  return { scope, isOwner, branchParam: isOwner ? selectedBranchId : undefined };
}

const Modal: React.FC<{ title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({
  title,
  subtitle,
  onClose,
  children,
  wide
}) => (
  <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
    <div
      className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
        wide ? 'max-w-3xl' : 'max-w-xl'
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="overflow-y-auto p-4">{children}</div>
    </div>
  </div>
);

// ---------- New job card ----------

const NewJobCardModal: React.FC<{ onClose: () => void; onCreated: (card: JobCard) => void }> = ({ onClose, onCreated }) => {
  const { customers, branches, selectedBranchId, showToast, addAuditLog } = useERP();
  const { scope, isOwner } = useApiScope();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [machineModel, setMachineModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [complaint, setComplaint] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [technician, setTechnician] = useState('');
  const [isWarranty, setIsWarranty] = useState(false);
  const [branchId, setBranchId] = useState(selectedBranchId !== 'all' ? selectedBranchId : branches[0]?.id || 'branch-1');
  const [warrantyInfo, setWarrantyInfo] = useState<SerialLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelectCustomer = useCallback((c: Customer) => {
    setCustomer(c);
    setCustomerId(c.id);
    setCustomerName(c.companyName || c.name);
    setCustomerPhone(c.phone);
  }, []);

  const lookupSerial = async () => {
    const serial = serialNumber.trim();
    if (!serial) {
      setWarrantyInfo(null);
      return;
    }
    setLookingUp(true);
    try {
      const res = await jobCardApi.lookupSerial(scope, serial);
      setWarrantyInfo(res);
      if (res.found) {
        setMachineModel((m) => m || res.productName);
        setIsWarranty(res.inWarranty);
        setCustomerName((n) => n || res.customerName);
        setCustomerPhone((p) => p || res.customerPhone || '');
        setCustomerId((id) => id || res.customerId || '');
      }
    } catch (e: any) {
      showToast('Serial lookup failed', e.message || 'Could not check warranty records', 'error');
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!customerName.trim()) return setError('Customer name is required');
    if (!complaint.trim()) return setError('Describe the complaint');
    setSaving(true);
    try {
      const card = await jobCardApi.create(scope, {
        branchId: isOwner ? branchId : undefined,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerId: customerId || undefined,
        machineModel: machineModel.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        complaint: complaint.trim(),
        promisedDate: promisedDate || undefined,
        technician: technician.trim() || undefined,
        isWarranty
      });
      addAuditLog('Created Job Card', 'Service', `${card.jobNumber} for ${card.customerName}`);
      showToast('Job card created', `${card.jobNumber} logged for ${card.customerName}`, 'success');
      onCreated(card);
    } catch (err: any) {
      setError(err.message);
      showToast('Could not create job card', err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Job Card" subtitle="Log a tractor or implement brought in for service" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {isOwner && (
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
          <label className={LABEL}>Find customer by phone or name</label>
          <CustomerPhoneLookup selectedCustomer={customer} onSelectCustomer={handleSelectCustomer} customers={customers} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Customer name *</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={INPUT}
              placeholder="Farmer / owner name"
            />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={INPUT} placeholder="10-digit mobile" />
          </div>
          <div>
            <label className={LABEL}>Serial / chassis number</label>
            <div className="relative">
              <input
                value={serialNumber}
                onChange={(e) => {
                  setSerialNumber(e.target.value);
                  setWarrantyInfo(null);
                }}
                onBlur={lookupSerial}
                className={INPUT}
                placeholder="Auto-fills from warranty records"
              />
              {lookingUp && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
            </div>
          </div>
          <div>
            <label className={LABEL}>Machine model</label>
            <input value={machineModel} onChange={(e) => setMachineModel(e.target.value)} className={INPUT} placeholder="e.g. 5-tyne cultivator" />
          </div>
        </div>

        {warrantyInfo && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
              warrantyInfo.found
                ? warrantyInfo.inWarranty
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
            }`}
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            {warrantyInfo.found ? (
              <span>
                {warrantyInfo.productName} sold to {warrantyInfo.customerName}. Warranty{' '}
                {warrantyInfo.inWarranty ? 'valid until' : 'expired on'} {warrantyInfo.warrantyExpiryDate}.
              </span>
            ) : (
              <span>No warranty record for this serial number. Treated as a paid job.</span>
            )}
          </div>
        )}

        <div>
          <label className={LABEL}>Complaint *</label>
          <textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={3}
            className={INPUT}
            placeholder="What is wrong with the machine?"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Promised date</label>
            <input type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Technician</label>
            <input value={technician} onChange={(e) => setTechnician(e.target.value)} className={INPUT} placeholder="Assigned mechanic" />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={isWarranty} onChange={(e) => setIsWarranty(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" />
          Warranty job (customer is not billed; parts are still deducted from stock)
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create job card
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------- Printable sheet ----------

const PrintSheet: React.FC<{ job: JobCardDetail; currency: string }> = ({ job, currency }) => {
  const money = (n: number) => `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return createPortal(
    <div id="jobcard-print-root" className="hidden print-only bg-white p-8 text-xs text-black">
      <style>{`@media print { body > *:not(#jobcard-print-root) { display: none !important; } }`}</style>
      <div className="mb-4 flex items-start justify-between border-b border-black pb-3">
        <div>
          <h1 className="text-lg font-bold">Service Job Card</h1>
          <p>ERP Starter Kit</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold">{job.jobNumber}</p>
          <p>Received: {job.receivedOn}</p>
          <p>Promised: {job.promisedDate || '-'}</p>
        </div>
      </div>
      <table className="mb-4 w-full">
        <tbody>
          <tr>
            <td className="w-1/2 align-top pr-4">
              <p className="font-bold">Customer</p>
              <p>{job.customerName}</p>
              <p>{job.customerPhone || '-'}</p>
            </td>
            <td className="align-top">
              <p className="font-bold">Machine</p>
              <p>{job.machineModel || '-'}</p>
              <p>Serial: {job.serialNumber || '-'}</p>
              <p>Technician: {job.technician || '-'}</p>
              {job.isWarranty && <p className="font-bold">WARRANTY JOB</p>}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="font-bold">Complaint</p>
      <p className="mb-3 whitespace-pre-wrap">{job.complaint}</p>
      <p className="font-bold">Diagnosis</p>
      <p className="mb-4 whitespace-pre-wrap">{job.diagnosis || '-'}</p>
      <table className="mb-4 w-full border border-black">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="p-1.5">Part</th>
            <th className="p-1.5 text-right">Qty</th>
            <th className="p-1.5 text-right">Rate</th>
            <th className="p-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {job.parts.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-1.5">
                No parts used
              </td>
            </tr>
          ) : (
            job.parts.map((p) => (
              <tr key={p.id} className="border-b border-black/30">
                <td className="p-1.5">
                  {p.productName} {p.sku && `(${p.sku})`}
                </td>
                <td className="p-1.5 text-right">{p.quantity}</td>
                <td className="p-1.5 text-right">{money(p.rate)}</td>
                <td className="p-1.5 text-right">{money(p.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {job.services.length > 0 && (
        <table className="mb-4 w-full border border-black">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="p-1.5">Service</th>
              <th className="p-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {job.services.map((s) => (
              <tr key={s.id} className="border-b border-black/30">
                <td className="p-1.5">{s.name}</td>
                <td className="p-1.5 text-right">{money(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ml-auto w-64 space-y-1">
        <div className="flex justify-between">
          <span>Labour ({job.labourHours} h)</span>
          <span>{money(job.labourCharge)}</span>
        </div>
        <div className="flex justify-between">
          <span>Parts</span>
          <span>{money(job.partsTotal)}</span>
        </div>
        {job.servicesTotal > 0 && (
          <div className="flex justify-between">
            <span>Services</span>
            <span>{money(job.servicesTotal)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Discount</span>
          <span>-{money(job.discount)}</span>
        </div>
        <div className="flex justify-between border-t border-black pt-1 font-bold">
          <span>Total</span>
          <span>{money(job.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid</span>
          <span>{money(job.paidAmount)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Balance</span>
          <span>{money(job.balance)}</span>
        </div>
      </div>
      <div className="mt-16 flex justify-between">
        <span className="border-t border-black px-6 pt-1">Customer signature</span>
        <span className="border-t border-black px-6 pt-1">Authorised signatory</span>
      </div>
    </div>,
    document.body
  );
};

// ---------- Detail drawer ----------

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

const JobCardDrawer: React.FC<{ jobId: string; onClose: () => void; onChanged: () => void }> = ({ jobId, onClose, onChanged }) => {
  const { products, warehouses, settings, showToast, addAuditLog, refreshProducts } = useERP();
  const { scope, branchParam } = useApiScope();
  const currency = settings.currencySymbol || '₹';
  const money = (n: number) => `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const [job, setJob] = useState<JobCardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [diagnosis, setDiagnosis] = useState('');
  const [complaint, setComplaint] = useState('');
  const [technician, setTechnician] = useState('');
  const [labourHours, setLabourHours] = useState('0');
  const [labourRate, setLabourRate] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [promisedDate, setPromisedDate] = useState('');
  const [isWarranty, setIsWarranty] = useState(false);

  const [partProduct, setPartProduct] = useState<Product | null>(null);
  const [serviceList, setServiceList] = useState<ServiceItem[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [serviceCost, setServiceCost] = useState('');
  const [partQty, setPartQty] = useState('1');
  const [partWarehouse, setPartWarehouse] = useState('');

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');

  const applyJob = useCallback((j: JobCardDetail) => {
    setJob(j);
    setDiagnosis(j.diagnosis || '');
    setComplaint(j.complaint);
    setTechnician(j.technician || '');
    setLabourHours(String(j.labourHours));
    setLabourRate(String(j.labourRate));
    setDiscount(String(j.discount));
    setPromisedDate(j.promisedDate || '');
    setIsWarranty(j.isWarranty);
    setPayAmount(j.balance > 0 ? String(j.balance) : '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      applyJob(await jobCardApi.get(scope, jobId, branchParam));
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scope, jobId, branchParam, applyJob]);

  useEffect(() => {
    load();
  }, [load]);

  // The price list from Inventory > Services; if it cannot be loaded the rest of the job card still works.
  useEffect(() => {
    serviceCatalogApi
      .list(scope)
      .then((l) => setServiceList(l.filter((s) => s.active)))
      .catch(() => {});
  }, [scope]);

  const run = async (label: string, fn: () => Promise<JobCardDetail | void>, success: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res) applyJob(res);
      else applyJob(await jobCardApi.get(scope, jobId, branchParam));
      onChanged();
      // Parts and cancellations move stock on the server, so reload the catalogue quantities.
      refreshProducts();
      showToast(label, success, 'success');
      return true;
    } catch (e: any) {
      showToast(`${label} failed`, e.message, 'error');
      refreshProducts();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !job) {
    return (
      <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs">
        <div className="flex h-full w-full max-w-3xl items-center justify-center bg-white dark:bg-slate-900">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs">
        <div className="flex h-full w-full max-w-3xl flex-col items-center justify-center gap-3 bg-white p-4 dark:bg-slate-900">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm text-slate-700 dark:text-slate-300">{loadError || 'Job card not found'}</p>
          <div className="flex gap-2">
            <button onClick={load} className={BTN_PRIMARY}>
              Retry
            </button>
            <button onClick={onClose} className={BTN_GHOST}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFinal = job.status === 'Delivered' || job.status === 'Cancelled';
  const flowIdx = JOB_STATUS_FLOW.indexOf(job.status);
  const nextStatus = !isFinal ? JOB_STATUS_FLOW[flowIdx + 1] : undefined;
  const deliverBlocked = nextStatus === 'Delivered' && !job.isWarranty && job.balance > 0;
  const branchWarehouses = warehouses.filter((w) => w.branchId === job.branchId);
  const dirty =
    diagnosis !== (job.diagnosis || '') ||
    complaint !== job.complaint ||
    technician !== (job.technician || '') ||
    num(labourHours) !== job.labourHours ||
    num(labourRate) !== job.labourRate ||
    num(discount) !== job.discount ||
    promisedDate !== (job.promisedDate || '') ||
    isWarranty !== job.isWarranty;

  const saveDetails = () =>
    run(
      'Job card updated',
      async () => {
        await jobCardApi.update(
          scope,
          job.id,
          { diagnosis, complaint, technician, labourHours: num(labourHours), labourRate: num(labourRate), discount: num(discount), promisedDate, isWarranty },
          branchParam
        );
      },
      `${job.jobNumber} saved`
    );

  const moveTo = async (status: JobStatus) => {
    const ok = await run('Status updated', () => jobCardApi.setStatus(scope, job.id, status, branchParam), `${job.jobNumber} is now ${status}`);
    if (ok) addAuditLog('Job Card Status', 'Service', `${job.jobNumber}: ${job.status} -> ${status}`);
    setConfirmCancel(false);
  };

  const addService = async () => {
    const svc = serviceList.find((s) => s.id === serviceId);
    if (!svc) return;
    const ok = await run(
      'Service added',
      () => jobCardApi.addService(scope, job.id, { serviceId: svc.id, cost: Number(serviceCost) }, branchParam),
      `${svc.name} added to this job card`
    );
    if (ok) {
      setServiceId('');
      setServiceCost('');
    }
  };

  const addPart = async () => {
    if (!partProduct) return;
    const ok = await run(
      'Part added',
      () =>
        jobCardApi.addPart(
          scope,
          job.id,
          { productId: partProduct.id, quantity: Number(partQty), warehouseId: partWarehouse || undefined },
          branchParam
        ),
      `${partProduct.name} x ${partQty} deducted from stock`
    );
    if (ok) {
      setPartProduct(null);
      setPartQty('1');
    }
  };

  const addPayment = async () => {
    const amount = Number(payAmount);
    if (!(amount > 0)) return showToast('Invalid amount', 'Enter an amount greater than 0', 'error');
    const ok = await run('Payment recorded', () => jobCardApi.addPayment(scope, job.id, { amount, method: payMethod }, branchParam), `${money(amount)} received by ${payMethod}`);
    if (ok) addAuditLog('Job Card Payment', 'Service', `${job.jobNumber}: ${money(amount)} via ${payMethod}`);
  };

  return (
    <>
      <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-base font-bold text-slate-900 dark:text-white">{job.jobNumber}</h2>
              <StatusBadge status={job.status} />
              {job.isWarranty && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                  WARRANTY
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className={BTN_GHOST}>
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {/* Stepper */}
            <div className={`${CARD} p-4`}>
              {job.status === 'Cancelled' ? (
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">This job card was cancelled and its parts were returned to stock.</p>
              ) : (
                <ol className="flex flex-wrap items-center gap-y-2">
                  {JOB_STATUS_FLOW.map((s, i) => {
                    const done = i < flowIdx;
                    const current = i === flowIdx;
                    return (
                      <li key={s} className="flex items-center">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            done
                              ? 'bg-emerald-500 text-white'
                              : current
                                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                                : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {done ? <Check className="h-3 w-3" /> : i + 1}
                        </span>
                        <span className={`ml-1.5 text-[11px] ${current ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{s}</span>
                        {i < JOB_STATUS_FLOW.length - 1 && <span className="mx-2 h-px w-4 bg-slate-300 dark:bg-slate-700" />}
                      </li>
                    );
                  })}
                </ol>
              )}
              {!isFinal && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {nextStatus && (
                    <button disabled={busy || deliverBlocked} onClick={() => moveTo(nextStatus)} className={BTN_PRIMARY}>
                      Move to {nextStatus}
                    </button>
                  )}
                  {job.status === 'Diagnosing' && (
                    <button disabled={busy} onClick={() => moveTo('In Progress')} className={BTN_GHOST}>
                      Skip to In Progress
                    </button>
                  )}
                  {confirmCancel ? (
                    <>
                      <span className="text-xs text-rose-600 dark:text-rose-400">Cancel and return all parts to stock?</span>
                      <button disabled={busy} onClick={() => moveTo('Cancelled')} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
                        Yes, cancel job
                      </button>
                      <button onClick={() => setConfirmCancel(false)} className={BTN_GHOST}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => setConfirmCancel(true)}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      Cancel job
                    </button>
                  )}
                  {deliverBlocked && <span className="text-[11px] text-amber-600 dark:text-amber-400">Collect the balance of {money(job.balance)} before delivery.</span>}
                </div>
              )}
            </div>

            {/* Summary */}
            <div className={`${CARD} grid grid-cols-1 gap-3 p-4 text-xs sm:grid-cols-3`}>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Customer</p>
                <p className="font-semibold text-slate-900 dark:text-white">{job.customerName}</p>
                <p className="text-slate-500 dark:text-slate-400">{job.customerPhone || '-'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Machine</p>
                <p className="font-semibold text-slate-900 dark:text-white">{job.machineModel || '-'}</p>
                <p className="font-mono text-slate-500 dark:text-slate-400">{job.serialNumber || 'No serial'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Dates</p>
                <p className="text-slate-700 dark:text-slate-300">Received {job.receivedOn}</p>
                <p className={isOverdue(job) ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}>
                  Promised {job.promisedDate || '-'}
                </p>
                {job.deliveredOn && <p className="text-slate-700 dark:text-slate-300">Delivered {job.deliveredOn}</p>}
              </div>
            </div>

            {/* Edit */}
            <div className={`${CARD} space-y-3 p-4`}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Diagnosis and labour</h3>
              <div>
                <label className={LABEL}>Complaint</label>
                <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={2} disabled={isFinal} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Diagnosis</label>
                <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={3} disabled={isFinal} className={INPUT} placeholder="Findings and work to be done" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Technician</label>
                  <input value={technician} onChange={(e) => setTechnician(e.target.value)} disabled={isFinal} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Labour hours</label>
                  <input type="number" min="0" step="0.25" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} disabled={isFinal} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Rate / hour</label>
                  <input type="number" min="0" value={labourRate} onChange={(e) => setLabourRate(e.target.value)} disabled={isFinal} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Discount</label>
                  <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={isFinal} className={INPUT} />
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex items-end gap-3">
                  <div>
                    <label className={LABEL}>Promised date</label>
                    <input type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} disabled={isFinal} className={INPUT} />
                  </div>
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={isWarranty} onChange={(e) => setIsWarranty(e.target.checked)} disabled={isFinal} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" />
                    Warranty job
                  </label>
                </div>
                {!isFinal && (
                  <button disabled={busy || !dirty} onClick={saveDetails} className={BTN_PRIMARY}>
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
                  </button>
                )}
              </div>
            </div>

            {/* Services from the price list */}
            <div className={`${CARD} space-y-3 p-4`}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Services</h3>
              {!isFinal && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem_auto]">
                  <select
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      const svc = serviceList.find((s) => s.id === e.target.value);
                      setServiceCost(svc ? String(svc.cost) : '');
                    }}
                    className={INPUT}
                    aria-label="Service"
                  >
                    <option value="">{serviceList.length ? 'Choose a service' : 'No services in the list yet (Inventory > Services)'}</option>
                    {(() => {
                      const model = (job.machineModel || '').toLowerCase();
                      const fits = (s: ServiceItem) => !s.machineType || model.includes(s.machineType.toLowerCase());
                      const opt = (s: ServiceItem) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.machineType ? ` (${s.machineType})` : ''} - {money(s.cost)}
                        </option>
                      );
                      const mine = serviceList.filter(fits);
                      const others = serviceList.filter((s) => !fits(s));
                      return (
                        <>
                          {mine.length > 0 && <optgroup label="For this machine">{mine.map(opt)}</optgroup>}
                          {others.length > 0 && <optgroup label="Other machines">{others.map(opt)}</optgroup>}
                        </>
                      );
                    })()}
                  </select>
                  <input type="number" min="0" value={serviceCost} onChange={(e) => setServiceCost(e.target.value)} className={INPUT} placeholder="Cost" aria-label="Service cost for this job" />
                  <button disabled={busy || !serviceId || serviceCost === '' || !(Number(serviceCost) >= 0)} onClick={addService} className={BTN_PRIMARY}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
              )}
              {job.services.length === 0 ? (
                <p className="text-xs text-slate-400">No services charged yet</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                  {job.services.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-slate-700 dark:text-slate-300">
                      <span>
                        <span className="font-semibold text-slate-900 dark:text-white">{s.name}</span>
                        {s.machineType && <span className="ml-1.5 text-[10px] text-slate-400">{s.machineType}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{money(s.cost)}</span>
                        {!isFinal && (
                          <button
                            disabled={busy}
                            onClick={() => run('Service removed', () => jobCardApi.removeService(scope, job.id, s.id, branchParam), `${s.name} removed`)}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                            aria-label="Remove service"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Parts */}
            <div className={`${CARD} space-y-3 p-4`}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Spare parts used</h3>
              {!isFinal && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_9rem_auto]">
                  <ProductSearchSelect
                    value={partProduct?.id || ''}
                    products={partProduct ? [partProduct, ...products] : products}
                    onChange={setPartProduct}
                    filterSpareOnly={false}
                  />
                  <input type="number" min="1" step="1" value={partQty} onChange={(e) => setPartQty(e.target.value)} className={INPUT} aria-label="Quantity" />
                  <select value={partWarehouse} onChange={(e) => setPartWarehouse(e.target.value)} className={INPUT} aria-label="Warehouse">
                    <option value="">Auto (most stock)</option>
                    {branchWarehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy || !partProduct || !(Number(partQty) > 0)} onClick={addPart} className={BTN_PRIMARY}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      {!isFinal && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {job.parts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                          No parts used yet
                        </td>
                      </tr>
                    ) : (
                      job.parts.map((p) => (
                        <tr key={p.id} className="text-slate-700 dark:text-slate-300">
                          <td className="px-3 py-2">
                            <span className="font-semibold text-slate-900 dark:text-white">{p.productName}</span>
                            {p.sku && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{p.sku}</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{p.quantity}</td>
                          <td className="px-3 py-2 text-right">{money(p.rate)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(p.amount)}</td>
                          {!isFinal && (
                            <td className="px-3 py-2 text-right">
                              <button
                                disabled={busy}
                                onClick={() => run('Part removed', () => jobCardApi.removePart(scope, job.id, p.id, branchParam), `${p.productName} returned to stock`)}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                aria-label="Remove part"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals + payments */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className={`${CARD} space-y-1.5 p-4 text-xs`}>
                <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Totals</h3>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Labour ({job.labourHours} h x {money(job.labourRate)})</span>
                  <span>{money(job.labourCharge)}</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Parts</span>
                  <span>{money(job.partsTotal)}</span>
                </div>
                {job.servicesTotal > 0 && (
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Services</span>
                    <span>{money(job.servicesTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Discount</span>
                  <span>-{money(job.discount)}</span>
                </div>
                {job.isWarranty && <p className="text-emerald-600 dark:text-emerald-400">Warranty job: customer is not billed.</p>}
                <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-bold text-slate-900 dark:border-slate-800 dark:text-white">
                  <span>Total</span>
                  <span>{money(job.total)}</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Paid</span>
                  <span>{money(job.paidAmount)}</span>
                </div>
                <div className={`flex justify-between font-bold ${job.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  <span>Balance</span>
                  <span>{money(job.balance)}</span>
                </div>
              </div>

              <div className={`${CARD} space-y-3 p-4 text-xs`}>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Payments</h3>
                {job.status !== 'Cancelled' && job.balance > 0 && (
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={INPUT} placeholder="Amount" aria-label="Payment amount" />
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className={INPUT} aria-label="Payment method">
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button disabled={busy} onClick={addPayment} className={`${BTN_PRIMARY} col-span-2`}>
                      Record payment
                    </button>
                  </div>
                )}
                {job.payments.length === 0 ? (
                  <p className="text-slate-400">No payments received yet</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {job.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-1.5 text-slate-700 dark:text-slate-300">
                        <span>
                          {p.paidOn} <span className="text-slate-400">{p.method}</span>
                        </span>
                        <span className="font-semibold">{money(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <PrintSheet job={job} currency={currency} />
    </>
  );
};

// ---------- Main view ----------

export const JobCardsView: React.FC = () => {
  const { settings, selectedBranchId, branches } = useERP();
  const { scope, branchParam } = useApiScope();
  const currency = settings.currencySymbol || '₹';
  const money = (n: number) => `${currency}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const [cards, setCards] = useState<JobCard[]>([]);
  const [summary, setSummary] = useState<JobCardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | JobStatus>('All');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const req = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        jobCardApi.list(scope, { branchId: branchParam, status: statusFilter, q: debouncedSearch }),
        jobCardApi.summary(scope, branchParam)
      ]);
      if (req !== requestRef.current) return;
      setCards(list);
      setSummary(sum);
    } catch (e: any) {
      if (req !== requestRef.current) return;
      setError(e.message || 'Failed to load job cards');
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, [scope, branchParam, statusFilter, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || id;
  const tabs: ('All' | JobStatus)[] = ['All', ...JOB_STATUSES];
  const tabCount = (t: 'All' | JobStatus) => (summary ? (t === 'All' ? summary.total : summary.counts[t]) : undefined);

  return (
    <div className="space-y-6 pb-12">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Service Job Cards</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Repairs for tractors and implements
            {summary && (
              <>
                {' '}
                &middot; {summary.open} open
                {summary.overdue > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">, {summary.overdue} overdue</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className={BTN_GHOST} aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowNew(true)} className={BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" /> New job card
          </button>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const active = statusFilter === t;
            const count = tabCount(t);
            return (
              <button
                key={t}
                onClick={() => setStatusFilter(t)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {t}
                {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Job no, customer, phone, serial, model"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </div>

      <div className={`no-print overflow-hidden ${CARD}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Job no.</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Machine</th>
                <th className="px-4 py-3">Complaint</th>
                <th className="px-4 py-3">Technician</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Promised</th>
                <th className="px-4 py-3 text-right">Total / Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && cards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                    Loading job cards
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
                    <p className="font-semibold text-slate-700 dark:text-slate-300">{error}</p>
                    <button onClick={load} className={`${BTN_PRIMARY} mt-3`}>
                      Retry
                    </button>
                  </td>
                </tr>
              ) : cards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Wrench className="mx-auto mb-2 h-10 w-10 stroke-1 text-slate-300 dark:text-slate-600" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">No job cards found</p>
                    <p className="mt-0.5 text-xs">Change the filter or log a new repair.</p>
                  </td>
                </tr>
              ) : (
                cards.map((c) => {
                  const overdue = isOverdue(c);
                  return (
                    <tr key={c.id} onClick={() => setSelectedId(c.id)} className="cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-slate-900 dark:text-white">{c.jobNumber}</span>
                        {selectedBranchId === 'all' && <span className="block text-[10px] text-slate-400">{branchName(c.branchId)}</span>}
                        {c.isWarranty && <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400">WARRANTY</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 dark:text-white">{c.customerName}</span>
                        <span className="block text-[11px] text-slate-400">{c.customerPhone || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {c.machineModel || '-'}
                        <span className="block font-mono text-[11px] text-slate-400">{c.serialNumber || ''}</span>
                      </td>
                      <td className="max-w-[16rem] px-4 py-3">
                        <span className="line-clamp-2">{c.complaint}</span>
                      </td>
                      <td className="px-4 py-3">{c.technician || '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3">
                        {c.promisedDate ? (
                          <span className={overdue ? 'rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : ''}>
                            {c.promisedDate}
                            {overdue && ' (overdue)'}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-slate-900 dark:text-white">{money(c.total)}</span>
                        <span className={`block text-[11px] ${c.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {c.balance > 0 ? `Due ${money(c.balance)}` : 'Settled'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewJobCardModal
          onClose={() => setShowNew(false)}
          onCreated={(card) => {
            setShowNew(false);
            setSelectedId(card.id);
            load();
          }}
        />
      )}
      {selectedId && <JobCardDrawer jobId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  );
};
