import { eq, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { branches } from './schema.ts';
import { cashEntries } from './schema.cashBook.ts';
import { CashBookError, assertOpen } from './cashBookService.ts';
import { businessDate, newId } from '../routes/context.ts';
import { cashAfterHandover, cashInHandNow, daysSince, handoverProblem, round2 } from './cashMath.ts';

// Cash handovers: a person comes to a branch and takes the cash in hand to another branch (usually the Head Office).
// Each handover is one record plus two cash book entries, so both cash books follow it and the expected cash
// (and the cash in hand shown on the Business Desk) goes down at the giving branch and up at the receiving branch:
//   - Cash out at the branch that hands the cash over
//   - Cash in at the branch that receives it
// The giving branch's cash goes down at once. The receiving branch's cash goes up only when someone there confirms
// that the cash arrived ("Pending" until then), so cash on its way is never counted twice or lost.
// A handover is always dated today, and the cash book of the branch that books the entry must still be open.

export const HANDOVER_CATEGORY = 'Cash handover';

export async function ensureHandoverTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists cash_handovers (
      id text primary key,
      handover_no text not null,
      from_branch_id text not null,
      to_branch_id text not null,
      amount double precision not null,
      handover_date text not null,
      received_by text,
      note text,
      created_by text,
      created_at timestamptz not null default now()
    )`);
  // Handovers made before confirmation existed were already counted at both ends, so they start as Received.
  await db.execute(sql`alter table cash_handovers add column if not exists status text not null default 'Received'`);
  await db.execute(sql`alter table cash_handovers add column if not exists received_on text`);
  await db.execute(sql`alter table cash_handovers add column if not exists confirmed_by text`);
  await db.execute(sql`create index if not exists idx_cash_handovers_date on cash_handovers (handover_date)`);
  await db.execute(sql`create index if not exists idx_cash_handovers_from on cash_handovers (from_branch_id)`);
  await db.execute(sql`create index if not exists idx_cash_handovers_to on cash_handovers (to_branch_id)`);
}

export interface CashHandover {
  id: string;
  handoverNo: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  amount: number;
  handoverDate: string;
  receivedBy: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  status: 'Pending' | 'Received';
  receivedOn: string | null;
  confirmedBy: string | null;
}

export interface BranchCashInHand {
  branchId: string;
  branchName: string;
  isHeadOffice: boolean;
  lastClosedDate: string | null; // the last day the cash was counted and closed
  lastCounted: number; // the cash counted on that day
  movementSince: number; // cash sales, collections and manual entries since then (handovers included)
  cashInHand: number; // lastCounted + movementSince
  handedOverThisMonth: number;
  receivedThisMonth: number;
  onTheWayIn: number; // handed over to this branch but not yet confirmed as received
  onTheWayOut: number; // handed over by this branch and still on its way
  openDaysSinceClose: number; // days since the last close with no closing: the figure is only as good as the books
}

const presentRows = (rows: any[]): CashHandover[] =>
  rows.map((r) => ({
    id: r.id,
    handoverNo: r.handover_no,
    fromBranchId: r.from_branch_id,
    fromBranchName: r.from_name || r.from_branch_id,
    toBranchId: r.to_branch_id,
    toBranchName: r.to_name || r.to_branch_id,
    amount: Number(r.amount),
    handoverDate: r.handover_date,
    receivedBy: r.received_by || null,
    note: r.note || null,
    createdBy: r.created_by || null,
    createdAt: new Date(r.created_at).toISOString(),
    status: r.status === 'Pending' ? 'Pending' : 'Received',
    receivedOn: r.received_on || null,
    confirmedBy: r.confirmed_by || null
  }));

async function getHandover(id: string): Promise<CashHandover | null> {
  const res = await db.execute(sql`
    select h.*, f.name as from_name, t.name as to_name
    from cash_handovers h
    left join branches f on f.id = h.from_branch_id
    left join branches t on t.id = h.to_branch_id
    where h.id = ${id}`);
  return presentRows(res.rows as any[])[0] || null;
}

export async function listHandovers(scope: string, limit = 60): Promise<CashHandover[]> {
  const cap = Math.min(Math.max(Math.floor(limit) || 60, 1), 300);
  const branchCond = scope && scope !== 'all' ? sql`where h.from_branch_id = ${scope} or h.to_branch_id = ${scope}` : sql``;
  const res = await db.execute(sql`
    select h.*, f.name as from_name, t.name as to_name
    from cash_handovers h
    left join branches f on f.id = h.from_branch_id
    left join branches t on t.id = h.to_branch_id
    ${branchCond}
    order by h.created_at desc limit ${cap}`);
  return presentRows(res.rows as any[]);
}

// Cash in hand at each branch: the last counted cash plus every cash movement after that day.
export async function getCashInHand(scope: string): Promise<BranchCashInHand[]> {
  const list = await db.select({ id: branches.id, name: branches.name, isHeadOffice: branches.isHeadOffice }).from(branches).orderBy(branches.id);
  const mine = scope && scope !== 'all' ? list.filter((b) => b.id === scope) : list;
  const today = businessDate();
  const monthStart = `${today.slice(0, 8)}01`;

  return Promise.all(
    mine.map(async (b) => {
      const last = (
        await db.execute(sql`select business_date, counted_cash from cash_closings where branch_id = ${b.id} order by business_date desc limit 1`)
      ).rows[0] as any;
      const from = last?.business_date || '1900-01-01';
      const num = (v: unknown) => Number(v) || 0;

      const move = (
        await db.execute(sql`
          select
            coalesce((select sum(case when lower(trim(s.payment_method)) = 'cash' then s.grand_total - coalesce(s.payment_amount_2, 0) else 0 end
                                     + case when lower(trim(coalesce(s.payment_method_2, ''))) = 'cash' then coalesce(s.payment_amount_2, 0) else 0 end)
                      from sales s where s.branch_id = ${b.id} and lower(s.payment_status) = 'paid'
                        and ((s.created_at at time zone 'UTC') at time zone 'Asia/Kolkata')::date > ${from}::date), 0)::float8 as quick,
            coalesce((select sum(p.amount) from machine_sale_payments p join machine_sales m on m.id = p.sale_id
                      where m.branch_id = ${b.id} and m.status <> 'Cancelled' and lower(trim(p.method)) = 'cash' and p.paid_on > ${from}), 0)::float8 as machine,
            coalesce((select sum(p.amount) from document_payments p join documents d on d.id = p.document_id
                      where d.branch_id = ${b.id} and d.doc_type = 'invoice' and d.source_machine_sale_id is null and not d.is_historical
                        and lower(trim(p.method)) = 'cash' and p.paid_on > ${from}), 0)::float8 as invoices,
            coalesce((select sum(jp.amount) from job_card_payments jp join job_cards j on j.id = jp.job_card_id
                      where j.branch_id = ${b.id} and lower(trim(jp.method)) = 'cash' and jp.paid_on > ${from}), 0)::float8 as service,
            coalesce((select sum(case when e.type = 'in' then e.amount else -e.amount end) from cash_entries e
                      where e.branch_id = ${b.id} and lower(trim(e.method)) = 'cash' and e.entry_date > ${from}), 0)::float8 as manual`)
      ).rows[0] as any;

      const ho = (
        await db.execute(sql`
          select
            coalesce(sum(amount) filter (where from_branch_id = ${b.id}), 0)::float8 as out_amt,
            coalesce(sum(amount) filter (where to_branch_id = ${b.id} and status = 'Received'), 0)::float8 as in_amt
          from cash_handovers where handover_date >= ${monthStart}`)
      ).rows[0] as any;
      const way = (
        await db.execute(sql`
          select
            coalesce(sum(amount) filter (where to_branch_id = ${b.id}), 0)::float8 as way_in,
            coalesce(sum(amount) filter (where from_branch_id = ${b.id}), 0)::float8 as way_out
          from cash_handovers where status = 'Pending'`)
      ).rows[0] as any;

      const counted = num(last?.counted_cash);
      const { movementSince: movement, cashInHand } = cashInHandNow(counted, { quick: num(move?.quick), machine: num(move?.machine), invoices: num(move?.invoices), service: num(move?.service), manual: num(move?.manual) });
      const days = daysSince(last?.business_date, today);
      return {
        branchId: b.id,
        branchName: b.name,
        isHeadOffice: !!b.isHeadOffice,
        lastClosedDate: last?.business_date || null,
        lastCounted: round2(counted),
        movementSince: movement,
        cashInHand,
        handedOverThisMonth: round2(num(ho?.out_amt)),
        receivedThisMonth: round2(num(ho?.in_amt)),
        onTheWayIn: round2(num(way?.way_in)),
        onTheWayOut: round2(num(way?.way_out)),
        openDaysSinceClose: days
      };
    })
  );
}

export interface NewHandover {
  fromBranchId: string;
  toBranchId: string;
  amount: number;
  receivedBy?: string;
  note?: string;
}
export interface HandoverActor {
  name: string;
  isOwner: boolean;
  branchId: string;
}

export async function createHandover(input: NewHandover, actor: HandoverActor): Promise<{ handover: CashHandover; fromCashAfter: number; short: boolean }> {
  const amount = round2(Number(input.amount));
  const from = String(input.fromBranchId || '').trim();
  const to = String(input.toBranchId || '').trim();
  const problem = handoverProblem({ amount, from, to, isOwner: actor.isOwner, actorBranchId: actor.branchId });
  if (problem) throw new CashBookError(problem.message, problem.status);

  const found = await db.select({ id: branches.id, name: branches.name }).from(branches).where(or(eq(branches.id, from), eq(branches.id, to)));
  const fromRow = found.find((b) => b.id === from);
  const toRow = found.find((b) => b.id === to);
  if (!fromRow || !toRow) throw new CashBookError('One of the branches was not found.', 404);

  const date = businessDate();
  await assertOpen(from, date);

  const before = (await getCashInHand(from))[0];
  const receivedBy = (input.receivedBy || '').trim().slice(0, 80) || null;
  const note = (input.note || '').trim().slice(0, 300) || null;
  const id = newId('ho');
  const createdBy = actor.name.slice(0, 100) || null;

  await db.transaction(async (tx) => {
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from cash_handovers where handover_date = ${date}`)).rows as any[];
    const handoverNo = `CH-${date.replace(/-/g, '')}-${String(Number(n) + 1).padStart(2, '0')}`;
    await tx.execute(sql`
      insert into cash_handovers (id, handover_no, from_branch_id, to_branch_id, amount, handover_date, received_by, note, created_by, status)
      values (${id}, ${handoverNo}, ${from}, ${to}, ${amount}, ${date}, ${receivedBy}, ${note}, ${createdBy}, 'Pending')`);
    const who = receivedBy ? ` Taken by ${receivedBy}.` : '';
    const extra = note ? ` ${note}` : '';
    await tx.insert(cashEntries).values({ id: `ce-${id}-out`, branchId: from, entryDate: date, type: 'out', category: HANDOVER_CATEGORY, amount, method: 'Cash', description: `${handoverNo}: handed over to ${toRow.name}.${who}${extra}`.slice(0, 300), createdBy });
  });

  const handover = (await getHandover(id))!;
  const { after, short } = cashAfterHandover(before?.cashInHand ?? 0, amount);
  return { handover, fromCashAfter: after, short };
}

// The receiving branch (or an owner) confirms the cash arrived: it is added to that branch's cash book today.
export async function confirmHandover(id: string, actor: HandoverActor): Promise<CashHandover> {
  const h = await getHandover(id);
  if (!h) throw new CashBookError('Handover not found.', 404);
  if (h.status === 'Received') throw new CashBookError('This handover was already confirmed.', 409);
  if (!actor.isOwner && h.toBranchId !== actor.branchId) throw new CashBookError('Only the branch receiving the cash can confirm it.', 403);
  const date = businessDate();
  await assertOpen(h.toBranchId, date);
  const confirmedBy = actor.name.slice(0, 100) || null;
  await db.transaction(async (tx) => {
    const flipped = await tx.execute(sql`update cash_handovers set status = 'Received', received_on = ${date}, confirmed_by = ${confirmedBy} where id = ${id} and status = 'Pending'`);
    if (!flipped.rowCount) throw new CashBookError('This handover was already confirmed.', 409);
    const who = h.receivedBy ? ` Taken by ${h.receivedBy}.` : '';
    await tx.insert(cashEntries).values({ id: `ce-${id}-in`, branchId: h.toBranchId, entryDate: date, type: 'in', category: HANDOVER_CATEGORY, amount: h.amount, method: 'Cash', description: `${h.handoverNo}: received from ${h.fromBranchName}.${who}`.slice(0, 300), createdBy: confirmedBy });
  });
  return (await getHandover(id))!;
}

// Cancels a handover (owners only): its cash book entries go, and the cash in hand goes back as it was.
export async function deleteHandover(id: string): Promise<CashHandover> {
  const existing = await getHandover(id);
  if (!existing) throw new CashBookError('Handover not found.', 404);
  const outE = (await db.select().from(cashEntries).where(eq(cashEntries.id, `ce-${id}-out`)).limit(1))[0];
  const inE = (await db.select().from(cashEntries).where(eq(cashEntries.id, `ce-${id}-in`)).limit(1))[0];
  if (outE) await assertOpen(outE.branchId, outE.entryDate);
  if (inE) await assertOpen(inE.branchId, inE.entryDate);
  await db.transaction(async (tx) => {
    await tx.delete(cashEntries).where(or(eq(cashEntries.id, `ce-${id}-out`), eq(cashEntries.id, `ce-${id}-in`)));
    await tx.execute(sql`delete from cash_handovers where id = ${id}`);
  });
  return existing;
}
