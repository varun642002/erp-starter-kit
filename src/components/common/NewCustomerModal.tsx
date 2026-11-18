import React, { useEffect, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { createSqlCustomer } from '../../services/api';
import type { Customer } from '../../types/erp';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // Called with the saved customer, so the screen that opened this can pick them straight away.
  onCreated: (customer: Customer) => void;
  initialPhone?: string;
  initialName?: string;
}

const INPUT =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

// Adds a customer to the central customer list from inside another form (machine sale, quotation), without leaving it.
// Name, a 10 digit mobile number and the town are required, the same as everywhere else. A mobile number that already
// belongs to a customer picks that customer instead of making a second one.
export const NewCustomerModal: React.FC<Props> = ({ isOpen, onClose, onCreated, initialPhone = '', initialName = '' }) => {
  const { addCustomer, selectedBranchId, showToast } = useERP();
  const { assignedBranchId } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [town, setTown] = useState('');
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setPhone(initialPhone.replace(/\D/g, '').slice(-10));
    setTown('');
    setGstin('');
    setError('');
    setBusy(false);
  }, [isOpen, initialPhone, initialName]);

  if (!isOpen) return null;

  const digits = phone.replace(/\D/g, '');
  const branchId = assignedBranchId || (selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : 'branch-1');

  const save = async () => {
    if (busy) return;
    if (!name.trim()) return setError("Enter the customer's name.");
    if (digits.length < 10) return setError('Enter the 10 digit mobile number.');
    if (!town.trim()) return setError('Enter the town or locality.');
    setBusy(true);
    setError('');
    try {
      const created = await createSqlCustomer({
        name: name.trim(),
        phone: digits.slice(-10),
        address: town.trim(),
        locality: town.trim(),
        city: town.trim(),
        state: 'Tamil Nadu',
        gstin: gstin.trim().toUpperCase() || undefined,
        creditLimit: 200000,
        creditPeriodDays: 30
      });
      const full: Customer = {
        id: created.id,
        customerId: created.customerId || '',
        name: created.name,
        companyName: created.companyName || created.name,
        phone: created.phone,
        email: created.email || '',
        address: created.address || town.trim(),
        locality: created.locality || town.trim(),
        city: created.city || town.trim(),
        state: created.state || 'Tamil Nadu',
        pincode: created.pincode || '',
        gstin: created.gstin || '',
        creditLimit: created.creditLimit ?? 200000,
        creditPeriodDays: created.creditPeriodDays ?? 30,
        outstandingBalance: 0,
        totalSales: 0,
        lastTransactionDate: new Date().toISOString().split('T')[0],
        rating: 'A',
        status: 'Active',
        branchId: created.branchId || branchId
      };
      addCustomer(full, { alreadySaved: true });
      showToast('Customer added', `${full.name} (${full.phone}) is saved in Customers.`, 'success');
      onCreated(full);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save the customer. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:p-4">
      <div className="flex w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:rounded-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
              <UserPlus className="h-4 w-4 text-blue-600" /> New customer
            </h2>
            <p className="text-xs text-slate-500">Saved in Customers and picked for this form.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Mobile number *
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="numeric"
              maxLength={14}
              placeholder="10 digit mobile"
              autoFocus
              className={`${INPUT} font-mono`}
            />
          </label>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Name *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer or firm name" className={INPUT} />
          </label>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Town / locality *
            <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Sampletown" className={INPUT} />
          </label>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            GST number <span className="font-normal text-slate-400">(only if they have one)</span>
            <input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="Optional" className={`${INPUT} font-mono uppercase`} />
          </label>
          {error && <p className="rounded-lg bg-rose-50 p-2 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save customer
          </button>
        </div>
      </div>
    </div>
  );
};
