import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { setCompaniesCache, useCompanies } from '../../hooks/useCompanies';
import { updateCompanyApi, type CompanyPatch, type CompanyProfile } from '../../services/companyApi';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL, Modal, useApiScope } from './ui';

type EditableKey = keyof CompanyPatch;
type Draft = Record<EditableKey, string>;

interface FieldDef {
  key: EditableKey;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  maxLength?: number;
  span?: boolean;
}

const SECTIONS: { title: string; hint?: string; fields: FieldDef[] }[] = [
  {
    title: 'Identity',
    fields: [
      { key: 'displayName', label: 'Display name', placeholder: 'Shown in pickers and lists' },
      { key: 'legalName', label: 'Legal name', placeholder: 'Printed on documents' },
      { key: 'tagline', label: 'Tagline', span: true }
    ]
  },
  {
    title: 'Address and contact',
    fields: [
      { key: 'addressLines', label: 'Address (one line per row)', multiline: true, span: true },
      { key: 'stateName', label: 'State name', placeholder: 'Tamil Nadu' },
      { key: 'stateCode', label: 'State code', placeholder: '33', maxLength: 2 },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'E-mail' },
      { key: 'website', label: 'Website' }
    ]
  },
  {
    title: 'Tax and bank',
    fields: [
      { key: 'gstin', label: 'GSTIN (15 characters)', mono: true, maxLength: 15 },
      { key: 'pan', label: 'PAN (10 characters)', mono: true, maxLength: 10 },
      { key: 'bankName', label: 'Bank name' },
      { key: 'accountNumber', label: 'Account number', mono: true },
      { key: 'ifscCode', label: 'IFSC code', mono: true },
      { key: 'bankBranch', label: 'Bank branch' },
      { key: 'upiId', label: 'UPI ID' }
    ]
  },
  {
    title: 'Documents',
    hint: 'Prefixes only affect documents created from now on; existing numbers are not changed.',
    fields: [
      { key: 'signatoryLabel', label: 'Signatory label', placeholder: 'Authorised Signatory' },
      { key: 'taxInvoicePrefix', label: 'Tax invoice prefix', mono: true, maxLength: 12 },
      { key: 'quotationPrefix', label: 'Quotation prefix', mono: true, maxLength: 12 },
      { key: 'plainInvoicePrefix', label: 'Invoice only prefix', mono: true, maxLength: 12 }
    ]
  }
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const UPPER_KEYS: EditableKey[] = ['gstin', 'pan', 'ifscCode', 'taxInvoicePrefix', 'quotationPrefix', 'plainInvoicePrefix'];

const toDraft = (c: CompanyProfile): Draft => {
  const d = {} as Draft;
  for (const f of ALL_FIELDS) d[f.key] = String(c[f.key] ?? '');
  return d;
};

const CompanyForm: React.FC<{ company: CompanyProfile; onSaved: (c: CompanyProfile) => void }> = ({ company, onSaved }) => {
  const { scope } = useApiScope();
  const { showToast, addAuditLog } = useERP();
  const [draft, setDraft] = useState<Draft>(() => toDraft(company));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const original = toDraft(company);
  const dirty = ALL_FIELDS.some((f) => draft[f.key].trim() !== original[f.key].trim());

  const set = (key: EditableKey, value: string) =>
    setDraft((d) => ({ ...d, [key]: UPPER_KEYS.includes(key) ? value.toUpperCase().replace(/\s+/g, '') : value }));

  const save = async () => {
    setError('');
    const gstin = draft.gstin.trim();
    const pan = draft.pan.trim();
    if (!draft.displayName.trim()) return setError('Display name is required');
    if (gstin && gstin.length !== 15) return setError('GSTIN must be 15 characters');
    if (pan && pan.length !== 10) return setError('PAN must be 10 characters');
    const patch: CompanyPatch = {};
    for (const f of ALL_FIELDS) {
      const next = draft[f.key].trim();
      if (next !== original[f.key].trim()) patch[f.key] = next;
    }
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const updated = await updateCompanyApi(scope, company.id, patch);
      addAuditLog('Updated company details', 'Billing', updated.displayName);
      showToast('Company details saved', updated.displayName, 'success');
      onSaved(updated);
    } catch (e: any) {
      setError(e.message);
      showToast('Could not save company details', e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{section.title}</h3>
            {section.hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{section.hint}</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.fields.map((f) => (
              <div key={f.key} className={f.span ? 'sm:col-span-2' : undefined}>
                <label className={LABEL}>{f.label}</label>
                {f.multiline ? (
                  <textarea value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={3} className={INPUT} />
                ) : (
                  <input
                    value={draft[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    maxLength={f.maxLength}
                    placeholder={f.placeholder}
                    className={`${INPUT} ${f.mono ? 'font-mono' : ''}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" onClick={() => setDraft(toDraft(company))} disabled={!dirty || saving} className={BTN_GHOST}>
          Reset
        </button>
        <button type="button" onClick={save} disabled={!dirty || saving} className={BTN_PRIMARY}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save {company.displayName}
        </button>
      </div>
    </div>
  );
};

export const CompanyDetailsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { companies, reload } = useCompanies();
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    let alive = true;
    reload().finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // fetch fresh profiles once when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = companies.find((c) => c.id === activeId) ?? companies[0];

  return (
    <Modal title="Company details" subtitle="Printed on quotations and invoices issued by each company" onClose={onClose} size="xl">
      <div className="space-y-5 p-5">
        {!ready || !active ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={`rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors ${
                    c.id === active.id
                      ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {c.displayName}
                </button>
              ))}
            </div>
            <CompanyForm key={`${active.id}-${JSON.stringify(active)}`} company={active} onSaved={setCompaniesCache} />
          </>
        )}
      </div>
    </Modal>
  );
};
