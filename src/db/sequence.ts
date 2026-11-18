import { sql } from 'drizzle-orm';

// Running numbers for counter sales, their invoices and sales orders: 00001, 00002, 00003 ... for each year.
// The counter moves inside the same transaction as the record, so a sale that fails does not use up a number,
// and two people saving at the same moment can never get the same one.

type Runner = { execute: (q: any) => Promise<{ rows: any[] }> };

export async function nextSequence(tx: Runner, key: string, period: string): Promise<number> {
  const res = await tx.execute(
    sql`insert into document_counters (doc_type, fy, last) values (${key}, ${period}, 1)
        on conflict (doc_type, fy) do update set last = document_counters.last + 1
        returning last`
  );
  return Number(res.rows[0].last);
}

export const formatNumber = (prefix: string, period: string, n: number) => `${prefix}-${period}-${String(n).padStart(5, '0')}`;

// After records are removed, the counter drops back to the highest number still in use, so the series never
// has an unused number at its end. It never moves the counter up.
export async function trimSequence(tx: Runner, key: string, period: string, table: 'sales' | 'invoices' | 'sales_orders', column: string, prefix: string) {
  const pattern = `^${prefix}-${period}-[0-9]{5}$`;
  const res = await tx.execute(
    sql`select coalesce(max(substring(${sql.raw(column)} from '[0-9]+$')::int), 0) as n
        from ${sql.raw(table)} where ${sql.raw(column)} ~ ${pattern}`
  );
  const max = Number(res.rows[0].n) || 0;
  await tx.execute(sql`update document_counters set last = ${max} where doc_type = ${key} and fy = ${period} and last > ${max}`);
}
