import { eq, ilike, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { customers, invoices, sales, salesOrders, warranties } from './schema.ts';

export interface CustomerInput {
  id?: string;
  customerId?: string;
  companyName: string;
  name?: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  branchId?: string;
  creditLimit?: number;
  creditPeriodDays?: number;
  outstandingBalance?: number;
  rating?: string;
}

export async function getAllCustomers(branchId?: string) {
  try {
    if (branchId && branchId !== 'all') {
      return await db
        .select()
        .from(customers)
        .where(eq(customers.branchId, branchId))
        .orderBy(customers.companyName);
    }
    return await db.select().from(customers).orderBy(customers.companyName);
  } catch (error) {
    console.error('Failed to get customers:', error);
    throw new Error('Database query failed while fetching customers.', { cause: error });
  }
}

export async function searchCustomers(query: string, limit: number = 25, branchId?: string) {
  try {
    const q = query && query.trim() ? `%${query.trim()}%` : '%';
    const cleanDigits = query ? query.replace(/\D/g, '') : '';
    const phoneQ = cleanDigits ? `%${cleanDigits}%` : q;

    const searchCondition = or(
      ilike(customers.companyName, q),
      ilike(customers.name, q),
      ilike(customers.phone, phoneQ),
      ilike(customers.customerId, q),
      ilike(customers.city, q),
      ilike(customers.locality, q),
      ilike(customers.gstin, q)
    );

    if (branchId && branchId !== 'all') {
      return await db
        .select()
        .from(customers)
        .where(sql`${customers.branchId} = ${branchId} AND (${searchCondition})`)
        .limit(limit)
        .orderBy(customers.companyName);
    }

    return await db
      .select()
      .from(customers)
      .where(searchCondition)
      .limit(limit)
      .orderBy(customers.companyName);
  } catch (error) {
    console.error('Failed to search customers:', error);
    throw new Error('Database query failed during customer search.', { cause: error });
  }
}

// Auto-identify customer by phone number (exact or stripped digit matching)
export async function findCustomersByPhone(phoneQuery: string, branchId?: string) {
  try {
    const rawClean = phoneQuery.replace(/\D/g, '');
    if (!rawClean || rawClean.length < 5) {
      return [];
    }

    // Match last 10 digits for Indian mobile numbers
    const last10 = rawClean.length >= 10 ? rawClean.slice(-10) : rawClean;

    let all = await db.select().from(customers);
    if (branchId && branchId !== 'all') {
      all = all.filter((c) => !c.branchId || c.branchId === branchId);
    }

    return all.filter((c) => {
      const cClean = c.phone.replace(/\D/g, '');
      const altClean = c.alternatePhone ? c.alternatePhone.replace(/\D/g, '') : '';
      return (
        cClean.includes(last10) ||
        altClean.includes(last10) ||
        (last10.length >= 7 && (cClean.endsWith(last10) || altClean.endsWith(last10)))
      );
    });
  } catch (error) {
    console.error('Failed to find customer by phone:', error);
    throw new Error('Database query failed while searching customer phone.', { cause: error });
  }
}

// Next free display code. 'attempt' skips ahead after a clash with someone saving at the same moment.
async function nextCustomerCode(attempt = 0): Promise<string> {
  const res = await db.execute(
    sql`select coalesce(max(substring(customer_id from '[0-9]+$')::int), 0) as n from customers where customer_id like 'CUST-%'`
  );
  const n = Number((res.rows[0] as { n: number | string }).n) || 0;
  return `CUST-${String(n + 1 + attempt).padStart(3, '0')}`;
}

export async function createCustomer(input: CustomerInput) {
  try {
    const displayName = (input.companyName || input.name || '').trim();
    if (!displayName) throw new CustomerDeleteError('Customer name is required.', 400);
    const phone = (input.phone || '').trim();
    if (!phone) throw new CustomerDeleteError('Customer mobile number is required.', 400);
    const gstin = input.gstin?.trim().toUpperCase();

    // One mobile number is one customer company-wide, so a second branch never adds a copy.
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      const [existing] = await db
        .select()
        .from(customers)
        .where(sql`right(regexp_replace(${customers.phone}, '\\D', '', 'g'), 10) = ${last10}`)
        .limit(1);
      if (existing) return existing;
    }

    const id = input.id || `cust-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // The same request sent twice (a double tap, a retry after a slow connection) gives back the customer that
    // was already saved instead of an error or a copy.
    const [sameId] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (sameId) return sameId;

    // The next display code (CUST-001, CUST-002 ...). Two people saving at the same moment can pick the same
    // code, so a clash just picks the next one and tries again.
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const customerId = input.customerId || (await nextCustomerCode(attempt));
        const [newCustomer] = await db
          .insert(customers)
          .values({
            id,
            customerId,
            companyName: displayName,
            name: input.name?.trim() || displayName,
            phone,
            alternatePhone: input.alternatePhone?.trim() || null,
            email: input.email?.trim() || null,
            address: input.address?.trim() || null,
            locality: input.locality?.trim() || null,
            city: input.city?.trim() || 'Sampletown',
            state: input.state?.trim() || 'Tamil Nadu',
            pincode: input.pincode?.trim() || null,
            gstin: gstin && gstin !== 'UNREGISTERED' ? gstin : null,
            branchId: input.branchId || 'branch-1',
            creditLimit: input.creditLimit ?? 500000,
            creditPeriodDays: input.creditPeriodDays ?? 30,
            outstandingBalance: input.outstandingBalance ?? 0,
            rating: input.rating || 'A',
            lastTransactionDate: new Date().toISOString().split('T')[0]
          })
          .returning();
        return newCustomer;
      } catch (e: any) {
        lastError = e;
        const code = e?.code || e?.cause?.code;
        const constraint = String(e?.constraint || e?.cause?.constraint || '');
        if (code !== '23505') throw e;
        if (constraint.includes('pkey')) {
          const [again] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
          if (again) return again;
        }
        if (input.customerId) throw e; // a code chosen by the caller that is taken is the caller's problem
      }
    }
    throw lastError;
  } catch (error) {
    if (error instanceof CustomerDeleteError) throw error;
    console.error('Failed to create customer:', error);
    throw new Error('Database insertion failed for customer.', { cause: error });
  }
}

export async function importCustomersTransactional(
  items: CustomerInput[],
  duplicateStrategy: 'skip' | 'update' = 'skip'
) {
  try {
    return await db.transaction(async (tx) => {
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const item of items) {
        const cleanPhone = item.phone.replace(/\D/g, '');
        const last10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

        // Check if customer exists by customerId or matching phone
        const existing = await tx
          .select()
          .from(customers)
          .where(
            or(
              item.customerId ? eq(customers.customerId, item.customerId.trim()) : sql`FALSE`,
              // Same mobile number however it was typed (spaces, +91, dashes), so an import never adds a copy.
              last10.length >= 10
                ? sql`right(regexp_replace(${customers.phone}, '\\D', '', 'g'), 10) = ${last10}`
                : eq(customers.phone, item.phone.trim())
            )
          )
          .limit(1);

        if (existing.length > 0) {
          if (duplicateStrategy === 'update') {
            await tx
              .update(customers)
              .set({
                companyName: item.companyName.trim(),
                name: item.name?.trim() || existing[0].name,
                phone: item.phone.trim(),
                alternatePhone: item.alternatePhone?.trim() || existing[0].alternatePhone,
                email: item.email?.trim() || existing[0].email,
                address: item.address?.trim() || existing[0].address,
                city: item.city?.trim() || existing[0].city,
                state: item.state?.trim() || existing[0].state,
                pincode: item.pincode?.trim() || existing[0].pincode,
                gstin: item.gstin?.trim() || existing[0].gstin,
                creditLimit: item.creditLimit ?? existing[0].creditLimit,
                updatedAt: new Date()
              })
              .where(eq(customers.id, existing[0].id));
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          const id = item.id || `cust-csv-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          const custCode = item.customerId || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

          await tx.insert(customers).values({
            id,
            customerId: custCode,
            companyName: item.companyName.trim(),
            name: item.name?.trim() || item.companyName.trim(),
            phone: item.phone.trim(),
            alternatePhone: item.alternatePhone?.trim() || null,
            email: item.email?.trim() || null,
            address: item.address?.trim() || null,
            locality: item.locality?.trim() || null,
            city: item.city?.trim() || 'Sampletown',
            state: item.state?.trim() || 'Tamil Nadu',
            pincode: item.pincode?.trim() || null,
            gstin: item.gstin?.trim() || null,
            branchId: item.branchId || 'branch-1',
            creditLimit: item.creditLimit ?? 500000,
            creditPeriodDays: item.creditPeriodDays ?? 30,
            outstandingBalance: 0,
            rating: 'A',
            lastTransactionDate: new Date().toISOString().split('T')[0]
          });
          insertedCount++;
        }
      }

      return {
        success: true,
        insertedCount,
        updatedCount,
        skippedCount,
        totalProcessed: items.length
      };
    });
  } catch (error) {
    console.error('Failed to import customers transactionally:', error);
    throw new Error('Database transaction failed during customer CSV import.', { cause: error });
  }
}

export class CustomerDeleteError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

// Past orders and invoices keep the customer name they were issued to; only the link is cleared.
export async function deleteCustomer(id: string) {
  return db.transaction(async (tx) => {
    const [cust] = await tx.select().from(customers).where(eq(customers.id, id)).for('update');
    if (!cust) throw new CustomerDeleteError('Customer not found', 404);
    if ((cust.outstandingBalance ?? 0) > 0) {
      throw new CustomerDeleteError(
        `${cust.companyName} still owes Rs ${Math.round(cust.outstandingBalance).toLocaleString('en-IN')}. Record the payment or write it off before deleting.`
      );
    }
    await tx.update(salesOrders).set({ customerId: null }).where(eq(salesOrders.customerId, id));
    await tx.update(invoices).set({ customerId: null }).where(eq(invoices.customerId, id));
    await tx.update(sales).set({ customerId: null }).where(eq(sales.customerId, id));
    await tx.update(warranties).set({ customerId: null }).where(eq(warranties.customerId, id));
    await tx.delete(customers).where(eq(customers.id, id));
    return { id, companyName: cust.companyName };
  });
}

const EDITABLE_TEXT = ['alternatePhone', 'email', 'address', 'locality', 'city', 'state', 'pincode'] as const;
const RATINGS = ['A+', 'A', 'B', 'C'];

// Contact details can be edited by anyone who may sell; credit terms and branch only by finance roles.
export async function updateCustomer(
  id: string,
  patch: Record<string, any>,
  actor: { isOwner: boolean; role: string; branchId: string }
) {
  const [cust] = await db.select().from(customers).where(eq(customers.id, id));
  if (!cust) throw new CustomerDeleteError('Customer not found', 404);
  // Central directory: any branch can keep a customer's details up to date. Credit terms stay with finance roles.
  const financeRole = actor.isOwner || ['Accountant', 'Branch Manager'].includes(actor.role);

  const set: Record<string, any> = { updatedAt: new Date() };
  if (patch.companyName !== undefined) {
    const v = String(patch.companyName).trim();
    if (!v) throw new CustomerDeleteError('Customer name is required.', 400);
    set.companyName = v.slice(0, 200);
  }
  if (patch.name !== undefined) set.name = String(patch.name).trim().slice(0, 200) || null;
  if (patch.phone !== undefined) {
    const v = String(patch.phone).trim();
    if (v.replace(/\D/g, '').length < 10) throw new CustomerDeleteError('Enter a 10 digit mobile number.', 400);
    set.phone = v.slice(0, 30);
  }
  for (const k of EDITABLE_TEXT) {
    if (patch[k] !== undefined) set[k] = String(patch[k]).trim().slice(0, 300) || null;
  }
  if (patch.gstin !== undefined) {
    const g = String(patch.gstin).trim().toUpperCase();
    if (g && g !== 'UNREGISTERED' && g.length !== 15) throw new CustomerDeleteError('GSTIN must be 15 characters.', 400);
    set.gstin = g && g !== 'UNREGISTERED' ? g : null;
  }
  if (financeRole) {
    if (patch.creditLimit !== undefined) {
      const n = Number(patch.creditLimit);
      if (!(n >= 0)) throw new CustomerDeleteError('Credit limit cannot be negative.', 400);
      set.creditLimit = n;
    }
    if (patch.creditPeriodDays !== undefined) {
      const n = Math.round(Number(patch.creditPeriodDays));
      if (!(n >= 0)) throw new CustomerDeleteError('Credit days cannot be negative.', 400);
      set.creditPeriodDays = n;
    }
    if (patch.rating !== undefined && RATINGS.includes(String(patch.rating))) set.rating = String(patch.rating);
  }
  if (actor.isOwner && patch.branchId !== undefined && String(patch.branchId).trim()) {
    set.branchId = String(patch.branchId).trim();
  }

  const [row] = await db.update(customers).set(set).where(eq(customers.id, id)).returning();
  return row;
}
