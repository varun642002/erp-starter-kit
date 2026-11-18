import React, { useState, useEffect } from 'react';
import { Search, Phone, UserCheck, AlertCircle, Plus, Check, Users } from 'lucide-react';
import { Customer } from '../../types/erp';
import { identifyCustomerByPhone, searchSqlCustomers } from '../../services/api';

interface CustomerPhoneLookupProps {
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  onQuickCreateCustomer?: (prefill: { phone: string; companyName?: string }) => void;
  customers?: Customer[]; // local fallback
  placeholder?: string;
}

export const CustomerPhoneLookup: React.FC<CustomerPhoneLookupProps> = ({
  selectedCustomer,
  onSelectCustomer,
  onQuickCreateCustomer,
  customers = [],
  placeholder = 'Enter customer phone number (e.g. 9876543210) or name...'
}) => {
  const [inputVal, setInputVal] = useState(
    selectedCustomer ? `${selectedCustomer.phone} — ${selectedCustomer.companyName}` : ''
  );
  const [matchingCustomers, setMatchingCustomers] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Sync if selectedCustomer changes from outside
  useEffect(() => {
    if (selectedCustomer) {
      setInputVal(`${selectedCustomer.phone} — ${selectedCustomer.companyName}`);
    }
  }, [selectedCustomer]);

  // Debounced auto-identification
  useEffect(() => {
    const rawDigits = inputVal.replace(/\D/g, '');
    const isTextSearch = !rawDigits || rawDigits.length < 5;

    if (!inputVal.trim()) {
      setMatchingCustomers([]);
      setSearched(false);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearched(true);
      try {
        let matches: Customer[] = [];

        if (!isTextSearch && rawDigits.length >= 5) {
          // Phone identification endpoint
          matches = await identifyCustomerByPhone(inputVal.trim()).catch(() => []);

          if (matches.length === 0) {
            // Local fallback
            matches = customers.filter((c) => {
              const cClean = c.phone.replace(/\D/g, '');
              const altClean = c.alternatePhone ? c.alternatePhone.replace(/\D/g, '') : '';
              return cClean.includes(rawDigits) || altClean.includes(rawDigits);
            });
          }
        } else {
          // Name search
          matches = await searchSqlCustomers(inputVal.trim(), 10).catch(() => []);
          if (matches.length === 0) {
            const q = inputVal.toLowerCase().trim();
            matches = customers.filter(
              (c) =>
                c.companyName.toLowerCase().includes(q) ||
                (c.name && c.name.toLowerCase().includes(q))
            );
          }
        }

        setMatchingCustomers(matches);
        setShowDropdown(true);

        // Auto-identify if exactly 1 match and entered full phone number
        if (matches.length === 1 && rawDigits.length >= 10) {
          onSelectCustomer(matches[0]);
        }
      } catch (err) {
        console.error('Customer lookup error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [inputVal, customers, onSelectCustomer]);

  const handleSelect = (cust: Customer) => {
    onSelectCustomer(cust);
    setInputVal(`${cust.phone} — ${cust.companyName}`);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setInputVal('');
    setMatchingCustomers([]);
    setSearched(false);
    setShowDropdown(false);
  };

  const isIdentified = selectedCustomer !== null;

  return (
    <div className="relative space-y-1.5">
      <div className="relative">
        <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (matchingCustomers.length > 0) setShowDropdown(true);
          }}
          placeholder={placeholder}
          className={`w-full rounded-lg border pl-9 pr-8 py-2 text-xs transition-colors focus:outline-none dark:bg-slate-800 dark:text-white ${
            isIdentified
              ? 'border-emerald-500 bg-emerald-50/20 text-emerald-950 font-medium dark:border-emerald-700 dark:text-emerald-200'
              : 'border-slate-300 bg-white text-slate-900 focus:border-indigo-500 dark:border-slate-700'
          }`}
        />
        {inputVal && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        )}
      </div>

      {/* Identified Banner */}
      {isIdentified && selectedCustomer && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <div>
              <span className="font-bold">{selectedCustomer.companyName}</span>
              {selectedCustomer.name && (
                <span className="text-[11px] opacity-80"> ({selectedCustomer.name})</span>
              )}
              <span className="block text-[11px] opacity-75">
                📞 {selectedCustomer.phone} • {selectedCustomer.city || 'Tamil Nadu'} • GSTIN: {selectedCustomer.gstin || 'Unregistered'}
              </span>
            </div>
          </div>
          <span className="rounded bg-emerald-200/70 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 shrink-0">
            AUTO-IDENTIFIED
          </span>
        </div>
      )}

      {/* Matching Results Dropdown */}
      {showDropdown && searched && !isSearching && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
          {matchingCustomers.length === 0 ? (
            <div className="p-4 text-center">
              <AlertCircle className="mx-auto h-5 w-5 text-amber-500 mb-1" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Customer not found
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                No record matches phone number or name: "{inputVal}"
              </p>
              {onQuickCreateCustomer && (
                <button
                  type="button"
                  onClick={() => {
                    const rawDigits = inputVal.replace(/\D/g, '');
                    onQuickCreateCustomer({
                      phone: rawDigits || inputVal,
                      companyName: !rawDigits ? inputVal : undefined
                    });
                    setShowDropdown(false);
                  }}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Create Customer with this Phone</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Matching Customers ({matchingCustomers.length}) — Click to Select
              </div>
              {matchingCustomers.map((c) => (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className="flex cursor-pointer items-center justify-between rounded-lg p-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 dark:text-white">{c.companyName}</span>
                      {c.name && <span className="text-slate-500">({c.name})</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      📞 {c.phone} {c.city && `• 📍 ${c.city}`} {c.gstin && `• GST: ${c.gstin}`}
                    </div>
                  </div>
                  {selectedCustomer?.id === c.id ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <span className="text-[10px] font-semibold text-indigo-600 hover:underline">
                      Select
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
