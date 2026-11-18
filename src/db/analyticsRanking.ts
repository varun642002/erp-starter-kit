import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { addDays, businessDate } from '../routes/context.ts';

// Who the best customers are, who has gone quiet and who is new, from everything a customer has bought:
// counter (quick) sales, tax invoices from the documents module, and machine sales (including the old bills).
// Invoices raised for a machine sale are left out so one machine is never counted twice.

const branchFilter = (col: string, scope: string) => (scope && scope !== 'all' ? sql`and ${sql.raw(col)} = ${scope}` : sql``);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
const NO_DATE = '1900-01-01';

export interface RankedCustomer {
  customerId: string;
  name: string;
  phone: string | null;
  city: string | null;
  orders: number;
  total: number;
  totalLast12: number;
  machines: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  daysSinceLast: number | null;
}
export interface QuietCustomer extends RankedCustomer {
  message: string;
}
export interface CustomerRanking {
  generatedAt: string;
  quietAfterDays: number;
  summary: {
    buyers: number;
    activeLast90: number;
    newLast30: number;
    top10SharePercent: number | null; // share of all money that came from the 10 biggest customers
    totalMoney: number;
  };
  top: RankedCustomer[];
  quiet: QuietCustomer[];
  fresh: RankedCustomer[];
  basis: string;
}

export async function getCustomerRanking(scope: string, quietAfterDays = 180): Promise<CustomerRanking> {
  quietAfterDays = Math.min(730, Math.max(30, Math.round(quietAfterDays)));
  const today = businessDate();
  const since12 = addDays(today, -365);
  const res = await db.execute(sql`
    with ev as (
      select s.customer_id as cid, to_char(s.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d, s.grand_total::float8 as amt, 'quick'::text as k
      from sales s where s.customer_id is not null ${branchFilter('s.branch_id', scope)}
      union all
      select d.customer_id, d.doc_date::text, d.grand_total::float8, 'invoice'
      from documents d
      where d.doc_type = 'invoice' and d.status not in ('Draft', 'Cancelled') and d.source_machine_sale_id is null and d.customer_id is not null ${branchFilter('d.branch_id', scope)}
      union all
      select m.customer_id, m.booking_date::text, m.sale_price::float8, 'machine'
      from machine_sales m where m.status <> 'Cancelled' and m.customer_id is not null ${branchFilter('m.branch_id', scope)}
    )
    select ev.cid, c.company_name, c.name as contact, nullif(c.phone, '') as phone, c.city,
      count(*)::int as orders, sum(ev.amt)::float8 as total,
      coalesce(sum(ev.amt) filter (where ev.d >= ${since12}), 0)::float8 as total12,
      (count(*) filter (where ev.k = 'machine'))::int as machines,
      min(ev.d) filter (where ev.d > ${NO_DATE}) as first_d, max(ev.d) filter (where ev.d > ${NO_DATE}) as last_d
    from ev join customers c on c.id = ev.cid
    group by ev.cid, c.company_name, c.name, c.phone, c.city
    limit 20000`);

  const all: RankedCustomer[] = (res.rows as any[]).map((r) => ({
    customerId: r.cid,
    name: r.company_name || r.contact || 'Customer',
    phone: r.phone || null,
    city: r.city || null,
    orders: Number(r.orders),
    total: Math.round(Number(r.total) || 0),
    totalLast12: Math.round(Number(r.total12) || 0),
    machines: Number(r.machines),
    firstPurchase: r.first_d || null,
    lastPurchase: r.last_d || null,
    daysSinceLast: r.last_d ? Math.max(0, dayDiff(today, r.last_d)) : null
  }));

  const money = all.reduce((s, c) => s + c.total, 0);
  const top = [...all].sort((a, b) => b.total - a.total).slice(0, 20);
  const top10 = [...all].sort((a, b) => b.total - a.total).slice(0, 10).reduce((s, c) => s + c.total, 0);

  // Gone quiet: bought before, nothing for a long while. The ones who spent the most come first.
  const quiet: QuietCustomer[] = all
    .filter((c) => c.daysSinceLast !== null && c.daysSinceLast >= quietAfterDays && (c.orders >= 2 || c.total >= 5000))
    .sort((a, b) => b.total - a.total)
    .slice(0, 40)
    .map((c) => ({
      ...c,
      message: `Hello ${c.name}, this is Acme Agro Equipment. It has been a while since your last visit. We have genuine spares and rotavator parts ready for the season. Please visit us or call us. Thank you.`
    }));

  const fresh = all
    .filter((c) => c.firstPurchase && dayDiff(today, c.firstPurchase) <= 30)
    .sort((a, b) => (b.firstPurchase || '').localeCompare(a.firstPurchase || ''))
    .slice(0, 30);

  return {
    generatedAt: new Date().toISOString(),
    quietAfterDays,
    summary: {
      buyers: all.length,
      activeLast90: all.filter((c) => c.daysSinceLast !== null && c.daysSinceLast <= 90).length,
      newLast30: all.filter((c) => c.firstPurchase && dayDiff(today, c.firstPurchase) <= 30).length,
      top10SharePercent: money > 0 ? Math.round((top10 / money) * 100) : null,
      totalMoney: money
    },
    top,
    quiet,
    fresh,
    basis: 'Counter sales, tax invoices and machine sales (with the old bills) saved against a customer. Sales with no customer attached are not counted.'
  };
}
