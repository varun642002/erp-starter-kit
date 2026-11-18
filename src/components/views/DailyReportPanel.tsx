import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Loader2, MessageCircle, Plus, Send, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { ApiScope } from '../../services/apiClient';
import { dailyReportApi, type DailyReportSettings } from '../../services/dailyReportApi';
import { buildWhatsAppLink } from '../../utils/whatsapp';

// The end-of-day report for the owner: what sold, which machines, money in and expenses, branch by branch.
// It is sent to every saved WhatsApp number (up to 5) every day at 8 pm; here it can be previewed, sent now, or opened by hand.

const cardCls = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const inputCls = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const rs = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const MAX_NUMBERS = 5;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const DailyReportPanel: React.FC<{ scope: ApiScope }> = ({ scope }) => {
  const { showToast } = useERP();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof dailyReportApi.get>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phones, setPhones] = useState<string[]>(['']);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await dailyReportApi.get(scope, date);
      setData(r);
      setPhones((p) => (p.some((x) => x.trim()) ? p : r.settings.phones.length ? r.settings.phones.map((x) => x.replace(/^91/, '')) : ['']));
      setEnabled(r.settings.enabled);
    } catch (e: any) {
      setError(e?.message || 'Could not load the report');
    } finally {
      setLoading(false);
    }
  }, [scope, date]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const s: DailyReportSettings = await dailyReportApi.save(scope, { phones: phones.map((x) => x.trim()).filter(Boolean), enabled });
      setData((d) => (d ? { ...d, settings: s } : d));
      setPhones(s.phones.length ? s.phones.map((x) => x.replace(/^91/, '')) : ['']);
      showToast('Saved', s.phones.length ? `The report will go to ${s.phones.length === 1 ? 'this number' : `these ${s.phones.length} numbers`} every day at 8 pm.` : 'No number saved.', 'success');
    } catch (e: any) {
      showToast('Could not save', e?.message || 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await dailyReportApi.send(scope, date, true);
      const sent = r.results.filter((x) => x.status === 'sent').length;
      const bad = r.results.find((x) => x.status !== 'sent');
      if (!bad) showToast('Report sent', r.results.length > 1 ? `Sent to ${sent} numbers.` : 'Sent', 'success');
      else showToast(sent ? `Sent to ${sent} of ${r.results.length}` : bad.status === 'queued' ? 'Not sent yet' : 'Not sent', `${bad.phone ? bad.phone.replace(/^91/, '') + ': ' : ''}${bad.detail || ''}`, sent ? 'warning' : 'error');
    } catch (e: any) {
      showToast('Could not send', e?.message || 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const link = data ? buildWhatsAppLink(phones.find((x) => x.trim()) || data.settings.phones[0] || '', data.text) : null;
  const r = data?.report;
  const t = r?.totals;
  const live = !!data && data.status.configured && data.status.triggerConfigured;

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4`}>
        <p className="text-sm font-bold text-slate-900 dark:text-white">Daily report on WhatsApp</p>
        <p className="mt-0.5 text-xs text-slate-500">Every day at 8 pm: sales, machines sold, money in and expenses, branch by branch, sent to the WhatsApp numbers below.</p>
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">WhatsApp numbers that get the report (up to {MAX_NUMBERS})</p>
          {phones.map((ph, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={`${inputCls} block w-44`}
                inputMode="numeric"
                placeholder="10 digit mobile"
                aria-label={`WhatsApp number ${i + 1}`}
                value={ph}
                onChange={(e) => setPhones((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
              />
              {phones.length > 1 && (
                <button type="button" aria-label={`Remove number ${i + 1}`} onClick={() => setPhones((list) => list.filter((_, k) => k !== i))} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {phones.length < MAX_NUMBERS && (
              <button type="button" onClick={() => setPhones((list) => [...list, ''])} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <Plus className="h-3.5 w-3.5" /> Add number
              </button>
            )}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send every day
            </label>
            <button type="button" onClick={save} disabled={busy} className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900">
              Save
            </button>
          </div>
        </div>
        {data && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs ${live ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
            {live ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>
              {live
                ? `Automatic sending is on (template "${data.status.templateName}").`
                : `Automatic sending is not switched on yet${data.status.missing.length ? ` (WhatsApp Business is not connected: ${data.status.missing.join(', ')})` : ''}${data.status.triggerConfigured ? '' : '; the 8 pm timer is not set up'}. Until then use Open in WhatsApp below.`}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button type="button" onClick={sendNow} disabled={busy || !data} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
        </button>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
            <MessageCircle className="h-3.5 w-3.5" /> Open in WhatsApp
          </a>
        )}
        {data && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(data.text).then(() => showToast('Copied', 'The report text is copied.', 'success'))}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        )}
      </div>

      {loading && !data ? (
        <div className="py-10 text-center text-xs text-slate-400">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Working out the day
        </div>
      ) : error ? (
        <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>
      ) : r && t ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ['Total sales', rs(t.totalSales), `counter ${rs(t.counterSales)} · invoices ${rs(t.invoices)}`],
              ['Machines sold', `${t.machinesSold}`, rs(t.machinesSoldValue)],
              ['Money in', rs(t.moneyIn), t.onCredit > 0 ? `${rs(t.onCredit)} on credit` : 'cash book + invoice payments'],
              ['Expenses', rs(t.expenses), `net ${rs(t.net)}`]
            ].map(([label, value, sub]) => (
              <div key={label} className={`${cardCls} p-3`}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white">{value}</p>
                <p className="text-[11px] text-slate-500">{sub}</p>
              </div>
            ))}
          </div>

          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-left text-xs" data-no-stack="true">
              <thead className="text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-bold">Branch</th>
                  <th className="px-3 py-2 text-right font-bold">Sales</th>
                  <th className="px-3 py-2 text-right font-bold">Machines</th>
                  <th className="px-3 py-2 text-right font-bold">Money in</th>
                  <th className="px-3 py-2 text-right font-bold">Expenses</th>
                  <th className="px-3 py-2 text-right font-bold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {r.branches.map((b) => (
                  <tr key={b.branchId}>
                    <td className="px-3 py-2 font-semibold">{b.branch}</td>
                    <td className="px-3 py-2 text-right font-bold">{rs(b.totalSales)}</td>
                    <td className="px-3 py-2 text-right">
                      {b.machinesSold} · {rs(b.machinesSoldValue)}
                    </td>
                    <td className="px-3 py-2 text-right">{rs(b.moneyIn)}</td>
                    <td className="px-3 py-2 text-right">{rs(b.expenses)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${b.net < 0 ? 'text-rose-600' : ''}`}>{rs(b.net)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-extrabold dark:bg-slate-800/50">
                  <td className="px-3 py-2">All branches</td>
                  <td className="px-3 py-2 text-right">{rs(t.totalSales)}</td>
                  <td className="px-3 py-2 text-right">
                    {t.machinesSold} · {rs(t.machinesSoldValue)}
                  </td>
                  <td className="px-3 py-2 text-right">{rs(t.moneyIn)}</td>
                  <td className="px-3 py-2 text-right">{rs(t.expenses)}</td>
                  <td className="px-3 py-2 text-right">{rs(t.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={`${cardCls} p-4`}>
            <p className="mb-2 text-xs font-bold text-slate-800 dark:text-slate-100">Machines sold</p>
            {r.machines.length ? (
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                {r.machines.map((m) => (
                  <li key={m.saleNumber} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <b>{m.machine || 'Machine'}</b> · {m.customer} · {m.branch}
                      {m.status === 'Delivered' ? ' · delivered' : ''}
                    </span>
                    <span className="font-bold">{rs(m.price)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">No machines sold on this day.</p>
            )}
            {r.expenseLines.length > 0 && <p className="mt-3 text-[11px] text-slate-500">Expenses: {r.expenseLines.map((e) => `${e.category} ${rs(e.amount)}`).join(', ')}</p>}
          </div>

          <details className={`${cardCls} p-4`}>
            <summary className="cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-200">The WhatsApp message</summary>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300">{data?.text}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
};
