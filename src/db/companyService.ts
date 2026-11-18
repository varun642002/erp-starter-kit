import { asc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { companyProfiles, type CompanyProfile } from './schema.companies.ts';
import { INDIAN_STATES } from '../components/documents/calc.ts';

export class CompanyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const COMPANY_IDS = ['main', 'second'] as const;
export type CompanyId = (typeof COMPANY_IDS)[number];

// Owner-supplied identifiers (GSTIN, PAN, bank) are left empty; they are never guessed.
const DEFAULTS: (typeof companyProfiles.$inferInsert)[] = [
  {
    id: 'main',
    displayName: 'Main Company',
    legalName: 'Main Company',
    tagline: '',
    addressLines: '1 Sample Road, Sampletown, Sample State - 000000',
    stateName: 'Tamil Nadu',
    stateCode: '33',
    phone: '',
    email: 'info@example.com',
    website: 'https://example.com',
    gstin: '',
    pan: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    bankBranch: '',
    upiId: '',
    signatoryLabel: 'Authorised Signatory',
    taxInvoicePrefix: 'MAIN',
    quotationPrefix: 'MAIN-Q',
    plainInvoicePrefix: 'MAIN-B',
    sortOrder: 1
  },
  {
    id: 'second',
    displayName: 'Second Company',
    legalName: '',
    tagline: '',
    addressLines: '',
    stateName: 'Tamil Nadu',
    stateCode: '33',
    phone: '',
    email: '',
    website: '',
    gstin: '',
    pan: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    bankBranch: '',
    upiId: '',
    signatoryLabel: '',
    taxInvoicePrefix: 'SEC',
    quotationPrefix: 'SEC-Q',
    plainInvoicePrefix: 'SEC-B',
    sortOrder: 2
  }
];

let seeding: Promise<void> | null = null;

// Idempotent and lazy: the first call that needs company data inserts the defaults.
export function ensureCompanyDefaults(): Promise<void> {
  if (!seeding) {
    seeding = db
      .insert(companyProfiles)
      .values(DEFAULTS)
      .onConflictDoNothing()
      .then(() => undefined)
      .catch((e) => {
        seeding = null;
        throw e;
      });
  }
  return seeding;
}

export async function listCompanies(): Promise<CompanyProfile[]> {
  await ensureCompanyDefaults();
  return db.select().from(companyProfiles).orderBy(asc(companyProfiles.sortOrder), asc(companyProfiles.id));
}

const TEXT_FIELDS = [
  'displayName',
  'legalName',
  'tagline',
  'addressLines',
  'stateName',
  'stateCode',
  'phone',
  'email',
  'website',
  'gstin',
  'pan',
  'bankName',
  'accountNumber',
  'ifscCode',
  'bankBranch',
  'upiId',
  'signatoryLabel'
] as const;
const PREFIX_FIELDS = ['taxInvoicePrefix', 'quotationPrefix', 'plainInvoicePrefix'] as const;
const MAX_LEN = 500;
const PREFIX_RE = /^[A-Z0-9-]{1,10}$/;
const GSTIN_RE = /^\d{2}[0-9A-Z]{13}$/;

const LABELS: Record<string, string> = {
  displayName: 'Display name',
  legalName: 'Legal name',
  tagline: 'Tagline',
  addressLines: 'Address',
  stateName: 'State',
  stateCode: 'State code',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  gstin: 'GSTIN',
  pan: 'PAN',
  bankName: 'Bank name',
  accountNumber: 'Account number',
  ifscCode: 'IFSC code',
  bankBranch: 'Bank branch',
  upiId: 'UPI ID',
  signatoryLabel: 'Signatory label',
  taxInvoicePrefix: 'Tax invoice prefix',
  quotationPrefix: 'Quotation prefix',
  plainInvoicePrefix: 'Invoice-only prefix'
};

function readText(input: Record<string, unknown>, key: string): string | undefined {
  const raw = input[key];
  if (raw === undefined) return undefined;
  if (raw === null) return '';
  if (typeof raw !== 'string') throw new CompanyError(`${LABELS[key] ?? key} must be text`);
  // Multi-line values (the address) keep their line breaks.
  const s = raw.replace(/\r\n?/g, '\n').trim();
  if (s.length > MAX_LEN) throw new CompanyError(`${LABELS[key] ?? key} is too long (maximum ${MAX_LEN} characters)`);
  return s;
}

export async function updateCompany(id: string, input: Record<string, unknown>): Promise<CompanyProfile> {
  if (input.id !== undefined && input.id !== id) throw new CompanyError('The company id cannot be changed');
  await ensureCompanyDefaults();

  const patch: Partial<Record<(typeof TEXT_FIELDS)[number] | (typeof PREFIX_FIELDS)[number], string>> = {};
  for (const key of TEXT_FIELDS) {
    const v = readText(input, key);
    if (v !== undefined) patch[key] = v;
  }
  for (const key of PREFIX_FIELDS) {
    const v = readText(input, key);
    if (v === undefined) continue;
    if (!PREFIX_RE.test(v)) {
      throw new CompanyError(`${LABELS[key]} must be 1 to 10 characters: capital letters, digits or hyphens`);
    }
    patch[key] = v;
  }

  if (patch.displayName !== undefined && !patch.displayName) throw new CompanyError('Display name is required');
  if (patch.gstin) {
    patch.gstin = patch.gstin.toUpperCase().replace(/\s+/g, '');
    if (!GSTIN_RE.test(patch.gstin)) throw new CompanyError('GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)');
  }
  if (patch.pan) patch.pan = patch.pan.toUpperCase().replace(/\s+/g, '');
  if (patch.ifscCode) patch.ifscCode = patch.ifscCode.toUpperCase().replace(/\s+/g, '');

  // State name and code travel together: a recognised name wins, otherwise the code picks the name.
  if (patch.stateName !== undefined || patch.stateCode !== undefined) {
    const byName = patch.stateName
      ? INDIAN_STATES.find((s) => s.name.toLowerCase() === patch.stateName!.toLowerCase())
      : undefined;
    if (patch.stateName && !byName) throw new CompanyError('State is not a recognised Indian state');
    const byCode = patch.stateCode ? INDIAN_STATES.find((s) => s.code === patch.stateCode) : undefined;
    if (!byName && patch.stateCode && !byCode) throw new CompanyError('State code is not a recognised Indian state code');
    const state = byName ?? byCode;
    if (!state) throw new CompanyError('State and state code cannot be empty');
    patch.stateName = state.name;
    patch.stateCode = state.code;
  }

  return db.transaction(async (tx) => {
    // Lock all profiles so two concurrent edits cannot both claim the same prefix.
    const all = await tx.select().from(companyProfiles).for('update');
    const current = all.find((c) => c.id === id);
    if (!current) throw new CompanyError('Company not found', 404);

    const seen = new Map<string, string>();
    for (const c of all) {
      const merged = c.id === id ? { ...c, ...patch } : c;
      for (const key of PREFIX_FIELDS) {
        const value = merged[key];
        const owner = seen.get(value);
        if (owner) {
          throw new CompanyError(`The prefix ${value} is already used (${owner}); every number series needs its own prefix`);
        }
        seen.set(value, `${merged.displayName} ${LABELS[key].toLowerCase()}`);
      }
    }

    const [updated] = await tx
      .update(companyProfiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(companyProfiles.id, id))
      .returning();
    return updated;
  });
}
