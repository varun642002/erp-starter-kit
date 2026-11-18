import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import { getAllBranchesSummary } from './cashBookService.ts';
import { autoSendStatus, toWhatsappNumber } from './billMessenger.ts';
import { businessDate } from '../routes/context.ts';

// The end-of-day report for the owner: sales, machines sold, money in and expenses, for each branch and for the whole company.
// It is sent to the owner's WhatsApp every evening at 8 pm (a scheduler calls /internal/daily-report) and can be sent or
// previewed from Messages > Daily report.
//
//   Sales          counter sales + shop invoices + machines delivered that day (the same definition the assistant uses)
//   Machines sold  machines booked that day (delivered ones are counted separately)
//   Money in       what the Cash Book received that day (cash, UPI, bank, service, manual entries) + invoice payments
//   Expenses       the Cash Book's "out" entries (cash and non-cash)

const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const rs = (n: number) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const KEY = 'daily_report';
const GRAPH = 'https://graph.facebook.com/v20.0';

export interface BranchDay {
  branchId: string;
  branch: string;
  counterSales: number;
  counterBills: number;
  invoices: number;
  invoiceCount: number;
  machinesDeliveredValue: number;
  machinesDelivered: number;
  totalSales: number;
  machinesSold: number;
  machinesSoldValue: number;
  moneyIn: number;
  expenses: number;
  net: number;
  onCredit: number;
}
export interface MachineLine { saleNumber: string; customer: string; machine: string; price: number; status: string; branch: string; deliveredDate: string | null }
export interface DailyReport {
  date: string;
  label: string;
  branches: BranchDay[];
  totals: Omit<BranchDay, 'branchId' | 'branch'>;
  machines: MachineLine[];
  expenseLines: { category: string; amount: number }[];
}

const prettyDate = (iso: string) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export async function buildDailyReport(date: string = businessDate()): Promise<DailyReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be in YYYY-MM-DD format.');
  const names = (await db.execute(sql`select id, name from branches order by id`)).rows as { id: string; name: string }[];

  const [counter, inv, delivered, booked, invPay, cash, machines, expenseLines] = await Promise.all([
    db.execute(sql`select branch_id as b, count(*)::int as n, coalesce(sum(grand_total), 0)::float as v from sales
      where (created_at + interval '5 hours 30 minutes')::date = ${date}::date group by branch_id`),
    db.execute(sql`select branch_id as b, count(*)::int as n, coalesce(sum(grand_total), 0)::float as v from documents
      where doc_type = 'invoice' and status not in ('Draft', 'Cancelled') and source_machine_sale_id is null and not is_historical and doc_date = ${date} group by branch_id`),
    db.execute(sql`select branch_id as b, count(*)::int as n, coalesce(sum(sale_price), 0)::float as v from machine_sales
      where status = 'Delivered' and delivered_date = ${date} and not is_historical group by branch_id`),
    db.execute(sql`select branch_id as b, count(*)::int as n, coalesce(sum(sale_price), 0)::float as v from machine_sales
      where status <> 'Cancelled' and booking_date = ${date} and not is_historical group by branch_id`),
    db.execute(sql`select d.branch_id as b, coalesce(sum(p.amount), 0)::float as v from document_payments p join documents d on d.id = p.document_id
      where p.paid_on = ${date} and d.doc_type = 'invoice' and d.source_machine_sale_id is null and not d.is_historical
        and p.method <> 'Return credit' and d.status <> 'Cancelled' group by d.branch_id`),
    getAllBranchesSummary(date),
    db.execute(sql`select sale_number, customer_name, machine_name, model, sale_price, status, branch_id, delivered_date from machine_sales
      where status <> 'Cancelled' and not is_historical and (booking_date = ${date} or delivered_date = ${date}) order by sale_price desc limit 30`),
    db.execute(sql`select category, coalesce(sum(amount), 0)::float as v from cash_entries where entry_date = ${date} and type = 'out' group by category order by v desc`)
  ]);
  const by = (r: { rows: any[] }) => new Map(r.rows.map((x) => [x.b as string, x]));
  const mCounter = by(counter);
  const mInv = by(inv);
  const mDel = by(delivered);
  const mBook = by(booked);
  const mPay = by(invPay);
  const cashBy = new Map(cash.rows.map((r) => [r.branchId, r]));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  const branches: BranchDay[] = names.map((b) => {
    const c = mCounter.get(b.id);
    const i = mInv.get(b.id);
    const d = mDel.get(b.id);
    const k = mBook.get(b.id);
    const cb: any = cashBy.get(b.id);
    const moneyIn = cb ? cb.cashSales + cb.upiSales + cb.bankCardSales + cb.serviceCollections + cb.manualCashIn + cb.manualOtherIn : 0;
    const expenses = cb ? cb.manualCashOut + cb.manualOtherOut : 0;
    const invoicesIn = Number(mPay.get(b.id)?.v || 0);
    const totalSales = Number(c?.v || 0) + Number(i?.v || 0) + Number(d?.v || 0);
    return {
      branchId: b.id,
      branch: b.name,
      counterSales: round(Number(c?.v || 0)),
      counterBills: Number(c?.n || 0),
      invoices: round(Number(i?.v || 0)),
      invoiceCount: Number(i?.n || 0),
      machinesDeliveredValue: round(Number(d?.v || 0)),
      machinesDelivered: Number(d?.n || 0),
      totalSales: round(totalSales),
      machinesSold: Number(k?.n || 0),
      machinesSoldValue: round(Number(k?.v || 0)),
      moneyIn: round(moneyIn + invoicesIn),
      expenses: round(expenses),
      net: round(moneyIn + invoicesIn - expenses),
      onCredit: round(cb?.creditSales || 0)
    };
  });
  const sum = (pick: (b: BranchDay) => number) => round(branches.reduce((s, b) => s + pick(b), 0));
  const totals = {
    counterSales: sum((b) => b.counterSales), counterBills: sum((b) => b.counterBills), invoices: sum((b) => b.invoices), invoiceCount: sum((b) => b.invoiceCount),
    machinesDeliveredValue: sum((b) => b.machinesDeliveredValue), machinesDelivered: sum((b) => b.machinesDelivered), totalSales: sum((b) => b.totalSales),
    machinesSold: sum((b) => b.machinesSold), machinesSoldValue: sum((b) => b.machinesSoldValue), moneyIn: sum((b) => b.moneyIn), expenses: sum((b) => b.expenses),
    net: sum((b) => b.net), onCredit: sum((b) => b.onCredit)
  };
  return {
    date,
    label: prettyDate(date),
    branches,
    totals,
    machines: (machines.rows as any[]).map((r) => ({ saleNumber: r.sale_number, customer: r.customer_name, machine: [r.machine_name, r.model].filter(Boolean).join(' '), price: round(r.sale_price), status: r.status, branch: nameOf.get(r.branch_id) || r.branch_id, deliveredDate: r.delivered_date || null })),
    expenseLines: (expenseLines.rows as any[]).map((r) => ({ category: r.category, amount: round(r.v) }))
  };
}

// A short machine name for a short line: the model if the name has one, else the first words (no bracketed series text).
const shortMachine = (name: string) => {
  const model = /(GES\s?\d{2}\s?MS[CG]|\d{2}\s?MS[CG]|GSP\s?\d+\s?S\s?\d+|AB[- ]?\d{3,4}|CT\s?\d+|\d{2,3}\s?DI\b)/i.exec(name || '');
  if (model) return model[1].replace(/\s+/g, '').toUpperCase();
  return (name || 'Machine').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Machine';
};
const branchShort = (name: string) => String(name || '').split(',')[0].trim();
const hadActivity = (b: BranchDay) => b.totalSales > 0 || b.machinesSold > 0 || b.moneyIn > 0 || b.expenses > 0;

// "Machines sold" is the machines handed over that day: the same machines whose value is inside the day's Sales, so the two agree.
// "2 (GES60MSC, GES40MSC)" or "none"
function machinesLine(r: DailyReport): string {
  const delivered = r.machines.filter((m) => m.status === 'Delivered' && m.deliveredDate === r.date);
  const count = r.totals.machinesDelivered;
  if (!count) return 'none';
  const names = delivered.slice(0, 8).map((m) => shortMachine(m.machine));
  return `${count}${names.length ? ` (${names.join(', ')})` : ''}`;
}

// One line per branch that did something: "Branch A: Rs 10,000 (2 machines)"
function branchLine(b: BranchDay): string {
  return `${branchShort(b.branch)}: ${rs(b.totalSales)}${b.machinesDelivered ? ` (${b.machinesDelivered} machine${b.machinesDelivered > 1 ? 's' : ''})` : ''}`;
}

// The message as plain WhatsApp text (for the preview and for sending by hand): total sales, machines sold with their models,
// and how each branch did. Money in and expenses are not shown.
export function reportText(r: DailyReport, company = 'Acme Tractor Spares'): string {
  const active = r.branches.filter(hadActivity);
  const lines = [
    `*${company}*`,
    `*Daily report: ${r.label}*`,
    '',
    `*Sales: ${rs(r.totals.totalSales)}*`,
    `Machines sold: ${machinesLine(r)}`,
    '',
    '*Branches*',
    ...(active.length ? active.map((b) => `• ${branchLine(b)}`) : ['No activity today'])
  ];
  return lines.join('\n');
}

// WhatsApp template variables may not contain new lines, so a variable is one short line and the line breaks live in the template.
//
// The simple template, four variables (any template name ending in "_v3" or "_v4"; on the live account it is "daily_report_v3"). Body:
//   Daily report: {{1}}
//
//   Sales: {{2}}
//   Machines sold: {{3}}
//
//   Branches: {{4}}
//
//   Acme Tractor Spares
//
// The first template, "daily_report" (five variables, the whole report run together), still works for any other name.
export function templateVars(r: DailyReport, templateName = 'daily_report'): string[] {
  return /_v[34]$/i.test(templateName) ? templateVarsV4(r) : templateVarsV1(r);
}

const oneLine = (v: string) => v.replace(/\s*\n\s*/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 300) || '-';

function templateVarsV4(r: DailyReport): string[] {
  const active = r.branches.filter(hadActivity);
  return [r.label, rs(r.totals.totalSales), machinesLine(r), active.length ? active.map(branchLine).join('; ') : 'no activity'].map(oneLine);
}

// The first template, "daily_report" (a Utility template, which WhatsApp delivers more reliably than a Marketing one). Its "Money" line is
// not part of the simple report, so it is sent as "-"; the rest is the simple report.
function templateVarsV1(r: DailyReport): string[] {
  const active = r.branches.filter(hadActivity);
  return [r.label, rs(r.totals.totalSales), '-', machinesLine(r), active.length ? active.map(branchLine).join('; ') : 'no activity'].map(oneLine);
}

// ---------------------------------------------------------------- who gets it

export interface DailyReportSettings { enabled: boolean; phones: string[]; updatedBy: string | null; updatedAt: string | null }

export async function getDailyReportSettings(): Promise<DailyReportSettings> {
  const row = (await db.execute(sql`select value, updated_by, updated_at from app_settings where key = ${KEY}`)).rows[0] as any;
  return {
    enabled: row?.value?.enabled !== false,
    phones: Array.isArray(row?.value?.phones) ? row.value.phones : [],
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function saveDailyReportSettings(input: { enabled?: boolean; phones?: string[] }, by: string): Promise<DailyReportSettings> {
  const current = await getDailyReportSettings();
  const phones = (input.phones ?? current.phones).map((p) => toWhatsappNumber(p)).filter((p): p is string => !!p);
  if (input.phones && phones.length !== input.phones.filter((p) => String(p).trim()).length) throw new Error('One of the numbers is not a valid 10 digit mobile number.');
  const value = { enabled: input.enabled ?? current.enabled, phones: [...new Set(phones)].slice(0, 5) };
  await db.execute(sql`
    insert into app_settings (key, value, updated_by, updated_at) values (${KEY}, ${JSON.stringify(value)}::jsonb, ${by}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
  return getDailyReportSettings();
}

// ---------------------------------------------------------------- sending

export interface SendOutcome { phone: string; status: 'sent' | 'failed' | 'queued' | 'skipped'; detail: string }

const templateConfig = () => ({ name: process.env.WHATSAPP_DAILY_TEMPLATE_NAME || 'daily_report', language: process.env.WHATSAPP_DAILY_TEMPLATE_LANG || 'en' });

export function dailyReportStatus() {
  const s = autoSendStatus();
  const t = templateConfig();
  return { configured: s.configured, missing: s.missing, templateName: t.name, templateLanguage: t.language, triggerConfigured: !!process.env.DAILY_REPORT_KEY };
}

// Sends one day's report to every saved number. Safe to call twice: a number that already got that day's report is skipped
// unless force is set. Never throws.
export async function sendDailyReport(date: string, opts: { force?: boolean; user?: string } = {}): Promise<{ date: string; results: SendOutcome[]; text: string }> {
  const settings = await getDailyReportSettings();
  const report = await buildDailyReport(date);
  const text = reportText(report);
  const results: SendOutcome[] = [];
  if (!settings.enabled) return { date, results: [{ phone: '', status: 'skipped', detail: 'The daily report is switched off' }], text };
  if (!settings.phones.length) return { date, results: [{ phone: '', status: 'skipped', detail: 'No WhatsApp number has been saved yet' }], text };

  const status = autoSendStatus();
  const tpl = templateConfig();
  for (const phone of settings.phones) {
    const log = (state: string, error: string | null, providerId: string | null) =>
      db.execute(sql`insert into message_log (id, branch_id, kind, ref_type, ref_id, customer_name, phone, channel, language, body, sent_by, status, error, provider_id, created_at)
        values (${`msg-${randomUUID()}`}, 'all', 'daily-report', 'daily-report', ${date}, 'Owner', ${phone}, 'whatsapp-api', 'en', ${text}, ${opts.user || 'Scheduler'}, ${state}, ${error}, ${providerId}, now())`);
    try {
      if (!opts.force) {
        const done = (await db.execute(sql`select 1 from message_log where ref_type = 'daily-report' and ref_id = ${date} and phone = ${phone} and status = 'sent' limit 1`)).rows.length;
        if (done) { results.push({ phone, status: 'skipped', detail: 'Already sent for this date' }); continue; }
      }
      if (!status.configured) {
        await log('queued', `WhatsApp is not set up yet (missing ${status.missing.join(', ')})`, null);
        results.push({ phone, status: 'queued', detail: 'WhatsApp sending is not set up yet' });
        continue;
      }
      const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: { name: tpl.name, language: { code: tpl.language }, components: [{ type: 'body', parameters: templateVars(report, tpl.name).map((v) => ({ type: 'text', text: v })) }] }
        })
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = json?.error || {};
        // Meta's own words plus its error code, sub-code and trace id, so a block or an expired token can be told apart and reported to Meta
        const tail = `[HTTP ${res.status}${e.code != null ? `, code ${e.code}` : ''}${e.error_subcode != null ? `/${e.error_subcode}` : ''}${e.type ? `, ${e.type}` : ''}${e.fbtrace_id ? `, trace ${e.fbtrace_id}` : ''}]`;
        // cut Meta's wording first so the code and trace id at the end are never lost
        const head = [e.message || `WhatsApp request failed (${res.status})`, e.error_data?.details].filter(Boolean).join(' - ').slice(0, 330);
        const msg = `${head} - ${tail}`.slice(0, 500);
        console.error('daily-report: WhatsApp refused the message:', msg);
        await log('failed', msg, null);
        results.push({ phone, status: 'failed', detail: msg });
      } else {
        // Meta has accepted the message: a failure to write the log must not turn this into a 'failed' (a retry would send it twice)
        try {
          await log('sent', null, json?.messages?.[0]?.id || null);
        } catch (logErr) {
          console.error('daily-report: sent, but the log row could not be written:', logErr);
        }
        results.push({ phone, status: 'sent', detail: 'Sent' });
      }
    } catch (e: any) {
      console.error('sendDailyReport error:', e);
      results.push({ phone, status: 'failed', detail: e?.message || 'Unexpected error' });
    }
  }
  return { date, results, text };
}
