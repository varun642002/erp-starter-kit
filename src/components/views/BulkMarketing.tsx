import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Send, Users } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { ApiScope } from '../../services/apiClient';
import {
  fetchMarketingProgress,
  fetchMarketingStatus,
  postMessageLog,
  sendMarketingGroup,
  type MarketingSendResult,
  type MarketingStatus
} from '../../services/messageApi';
import {
  MARKETING_OFFERS,
  MARKETING_OPT_OUT,
  MARKETING_TEMPLATES,
  buildWhatsAppLink,
  pickValidPhone,
  type MessageLanguage
} from '../../utils/whatsapp';

// Bulk marketing through WhatsApp. WhatsApp does not allow a web page to send to many people at once, so the
// audience is cut into groups (200 by default) and each message is opened one person at a time with the name filled
// in; staff press Send in WhatsApp. Every opened message is saved against the campaign, so progress survives a
// refresh and the same people are not messaged twice.

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500';
const cardCls = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
const labelCls = 'text-xs font-semibold text-slate-700 dark:text-slate-300';

const CAMPAIGN_KEY = 'erp-bulk-campaign';
const defaultCampaign = () => `Campaign ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
const slugOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80);

interface Recipient {
  customerId: string;
  name: string;
  phone: string; // normalized 91XXXXXXXXXX
  city: string;
  branchId: string;
}

interface Props {
  scope: ApiScope;
  language: MessageLanguage;
  sentBy?: string;
}

export const BulkMarketing: React.FC<Props> = ({ scope, language, sentBy }) => {
  const { customers, branches, settings, showToast, addAuditLog } = useERP();
  const company = settings.companyName || 'our shop';

  const [campaign, setCampaign] = useState(() => {
    try {
      return localStorage.getItem(CAMPAIGN_KEY) || defaultCampaign();
    } catch {
      return defaultCampaign();
    }
  });
  const campaignSlug = slugOf(campaign);

  const [groupSize, setGroupSize] = useState(200);
  const [branchFilter, setBranchFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [skipRecent, setSkipRecent] = useState(true);
  const [skipDays] = useState(7);
  const [groupIndex, setGroupIndex] = useState(0);

  const [templateId, setTemplateId] = useState(MARKETING_TEMPLATES[0].id);
  const [body, setBody] = useState('');
  const [bodyEdited, setBodyEdited] = useState(false);
  const [optOut, setOptOut] = useState(true);

  const [done, setDone] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [progressError, setProgressError] = useState<string | null>(null);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);

  // One-tap sending of a whole group through the WhatsApp Business API (needs the account to be set up).
  const [api, setApi] = useState<MarketingStatus | null>(null);
  const [offerText, setOfferText] = useState('');
  // Poster mode: the picture sent at the top of every message (made smaller here so it uploads fast)
  const [poster, setPoster] = useState<{ mime: string; data: string; url: string } | null>(null);
  const choosePoster = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      showToast('Poster', 'Choose a JPG or PNG picture.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.88);
        setPoster({ mime: 'image/jpeg', data: url.split(',')[1] || '', url });
      };
      img.onerror = () => showToast('Poster', 'That picture could not be read.', 'error');
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const [offerEdited, setOfferEdited] = useState(false);
  const [sendingGroup, setSendingGroup] = useState(false);
  const [lastResult, setLastResult] = useState<MarketingSendResult | null>(null);
  const [progressTick, setProgressTick] = useState(0);

  useEffect(() => {
    fetchMarketingStatus(scope)
      .then(setApi)
      .catch(() => setApi(null));
  }, [scope]);

  useEffect(() => {
    if (offerEdited) return;
    const make = MARKETING_OFFERS[templateId]?.[language];
    if (make) setOfferText(make(company));
  }, [templateId, language, company, offerEdited]);

  useEffect(() => {
    try {
      localStorage.setItem(CAMPAIGN_KEY, campaign);
    } catch {
      /* storage not available: the name just is not remembered */
    }
  }, [campaign]);

  // Template text follows the language until the person edits it by hand.
  useEffect(() => {
    if (bodyEdited) return;
    const tpl = MARKETING_TEMPLATES.find((t) => t.id === templateId) || MARKETING_TEMPLATES[0];
    setBody(tpl.body({ language, company }));
  }, [templateId, language, company, bodyEdited]);

  // Who has already been messaged in this campaign (and, optionally, in another one this week).
  useEffect(() => {
    if (!campaignSlug) return;
    let stopped = false;
    const t = window.setTimeout(async () => {
      try {
        const p = await fetchMarketingProgress(scope, campaignSlug, skipRecent ? skipDays : 0);
        if (stopped) return;
        setDone(new Set(p.done));
        setRecent(new Set(p.recent));
        setProgressError(null);
      } catch (e: any) {
        if (!stopped) setProgressError(e?.message || 'Could not load the campaign progress.');
      }
    }, 400);
    return () => {
      stopped = true;
      window.clearTimeout(t);
    };
  }, [scope, campaignSlug, skipRecent, skipDays, progressTick]);

  const cities = useMemo(
    () => (Array.from(new Set(customers.map((c) => (c.city || '').trim()).filter(Boolean))) as string[]).sort((a, b) => a.localeCompare(b)),
    [customers]
  );

  // The audience: one entry per mobile number, blocked customers and unusable numbers left out.
  const audience = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    const out: Recipient[] = [];
    let noPhone = 0;
    let skippedRecent = 0;
    for (const c of customers) {
      if (c.status === 'Blocked') continue;
      if (branchFilter !== 'all' && c.branchId !== branchFilter) continue;
      if (cityFilter !== 'all' && (c.city || '').trim() !== cityFilter) continue;
      const name = (c.name || c.companyName || '').trim();
      if (q && !name.toLowerCase().includes(q) && !(c.phone || '').includes(q)) continue;
      const phone = pickValidPhone(c.phone, c.alternatePhone);
      if (!phone) {
        noPhone += 1;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      if (skipRecent && recent.has(phone) && !done.has(phone)) {
        skippedRecent += 1;
        continue;
      }
      out.push({ customerId: c.id, name: name || 'Customer', phone, city: (c.city || '').trim(), branchId: c.branchId });
    }
    out.sort((a, b) => a.name.localeCompare(b.name) || a.phone.localeCompare(b.phone));
    return { list: out, noPhone, skippedRecent };
  }, [customers, branchFilter, cityFilter, search, skipRecent, recent, done]);

  const size = Math.min(Math.max(Math.floor(groupSize) || 200, 1), 1000);
  const groups = useMemo(() => {
    const g: Recipient[][] = [];
    for (let i = 0; i < audience.list.length; i += size) g.push(audience.list.slice(i, i + size));
    return g;
  }, [audience.list, size]);

  useEffect(() => {
    if (groupIndex >= groups.length) setGroupIndex(0);
  }, [groups.length, groupIndex]);

  const current = groups[groupIndex] || [];
  const doneInGroup = current.filter((r) => done.has(r.phone)).length;
  const nextPending = current.find((r) => !done.has(r.phone));

  const textFor = (r: Recipient) => {
    const personal = body.replace(/\{name\}/g, r.name);
    return optOut ? `${personal.trimEnd()}\n\n${MARKETING_OPT_OUT[language]}` : personal;
  };

  const canSend = body.trim().length > 0 && campaignSlug.length > 0;

  const openFor = async (r: Recipient) => {
    if (!canSend) return;
    const text = textFor(r);
    const url = buildWhatsAppLink(r.phone, text);
    if (!url) return;
    window.open(url, '_blank', 'noopener');
    setBusyPhone(r.phone);
    try {
      await postMessageLog(scope, {
        kind: 'marketing',
        refType: 'campaign',
        refId: campaignSlug,
        customerId: r.customerId,
        customerName: r.name,
        phone: r.phone,
        language,
        body: text,
        branchId: r.branchId,
        sentBy
      });
      setDone((prev) => new Set(prev).add(r.phone));
    } catch (e: any) {
      showToast('Log not saved', e?.message || 'WhatsApp opened, but this message could not be recorded.', 'error');
    } finally {
      setBusyPhone(null);
    }
  };

  const openNext = async () => {
    if (!nextPending) return;
    await openFor(nextPending);
    if (current.filter((r) => !done.has(r.phone)).length <= 1) {
      addAuditLog('Bulk WhatsApp group finished', 'Messages', `Campaign "${campaign}": group ${groupIndex + 1} of ${groups.length} opened for all ${current.length} people.`);
    }
  };

  const pendingInGroup = current.filter((r) => !done.has(r.phone));

  const sendWholeGroup = async () => {
    if (!api?.configured || pendingInGroup.length === 0 || (api.posterMode ? !poster : !offerText.trim()) || !campaignSlug) return;
    const ok = window.confirm(
      `Send this message to ${pendingInGroup.length} people on WhatsApp now?\n\nWhatsApp charges for each marketing message and a sent message cannot be taken back.`
    );
    if (!ok) return;
    setSendingGroup(true);
    setLastResult(null);
    try {
      const result = await sendMarketingGroup(scope, {
        campaign: campaignSlug,
        offerText: offerText.trim(),
        poster: api.posterMode && poster ? { mime: poster.mime, data: poster.data } : undefined,
        sentBy,
        recipients: pendingInGroup.map((r) => ({ customerId: r.customerId, name: r.name, phone: r.phone, branchId: r.branchId }))
      });
      setLastResult(result);
      setProgressTick((n) => n + 1);
      addAuditLog(
        'Bulk WhatsApp group sent',
        'Messages',
        `Campaign "${campaign}": group ${groupIndex + 1}, ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`
      );
      showToast(
        result.failed || result.stoppedEarly ? 'Group sent with problems' : 'Group sent',
        `${result.sent} sent, ${result.failed} failed.`,
        result.failed || result.stoppedEarly ? 'warning' : 'success'
      );
    } catch (e: any) {
      showToast('Could not send the group', e?.message || 'Nothing was sent.', 'error');
    } finally {
      setSendingGroup(false);
    }
  };

  const totalDone = audience.list.filter((r) => done.has(r.phone)).length;
  const preview = current[0] || audience.list[0];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        {api?.configured ? (
          <>Message only customers who are happy to hear from you; too many complaints can get your WhatsApp number restricted.</>
        ) : (
          <>
            Without the WhatsApp Business setup, WhatsApp opens one chat at a time and you press <strong>Send</strong> for each. Work through
            one group, take a break, then start the next. Message only customers who are happy to hear from you.
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={`${cardCls} space-y-4 p-4`}>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">1. Who to message</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelCls}>Branch</label>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={inputCls}>
                <option value="all">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Town</label>
              <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className={inputCls}>
                <option value="all">All towns</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Name or number contains</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>People in each group</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={groupSize}
                onChange={(e) => setGroupSize(parseInt(e.target.value, 10) || 0)}
                className={inputCls}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={skipRecent} onChange={(e) => setSkipRecent(e.target.checked)} className="h-3.5 w-3.5 rounded" />
            Skip anyone already sent a marketing message in the last {skipDays} days
          </label>
          <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <Users className="h-3.5 w-3.5" />
            <strong className="text-slate-800 dark:text-slate-100">{audience.list.length}</strong> people in {groups.length} group
            {groups.length === 1 ? '' : 's'}
            {audience.noPhone > 0 && <span> · {audience.noPhone} without a valid mobile number left out</span>}
            {audience.skippedRecent > 0 && <span> · {audience.skippedRecent} skipped (messaged recently)</span>}
          </p>
        </div>

        <div className={`${cardCls} space-y-4 p-4`}>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">2. The message</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelCls}>Campaign name</label>
              <input value={campaign} onChange={(e) => setCampaign(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Template</label>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setBodyEdited(false);
                }}
                className={inputCls}
              >
                {MARKETING_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label[language]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>
              Message <span className="font-normal text-slate-400">({'{name}'} becomes the customer's name)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setBodyEdited(true);
              }}
              rows={7}
              className={inputCls}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} className="h-3.5 w-3.5 rounded" />
            Add a line telling people they can reply STOP
          </label>
          {preview && (
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/30">
              <p className="mb-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Preview for {preview.name}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-slate-800 dark:text-slate-100">{textFor(preview)}</p>
            </div>
          )}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="space-y-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">3. Send, group by group</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Campaign total: {totalDone} of {audience.list.length} opened
            </span>
          </div>
          {progressError && <p className="text-xs text-red-600 dark:text-red-400">{progressError}</p>}
          {groups.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No customers match. Change the filters above.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((g, i) => {
                const d = g.filter((r) => done.has(r.phone)).length;
                const finished = d === g.length;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setGroupIndex(i)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-left text-xs ${
                      i === groupIndex
                        ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      Group {i + 1}
                      {finished && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    </span>
                    <span className="block text-[10px] opacity-80">
                      {d} of {g.length} opened
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {current.length > 0 && api?.configured && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div>
                <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">Send the whole group at once</p>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                  {api.posterMode
                    ? `Goes out through your approved WhatsApp template "${api.templateName}": the poster below at the top, and the customer's name in the greeting.`
                    : `Goes out through your approved WhatsApp template "${api.templateName}". The customer's name fills the first gap and the line below fills the second. One line only.`}
                </p>
              </div>
              {api.posterMode ? (
                <div className="space-y-2">
                  <label className={labelCls}>Poster (JPG or PNG)</label>
                  <input type="file" accept="image/jpeg,image/png" onChange={(e) => choosePoster(e.target.files?.[0])} className="block w-full text-xs" />
                  {poster && (
                    <div className="flex items-start gap-3">
                      <img src={poster.url} alt="Poster preview" className="max-h-48 rounded-lg border border-slate-200 dark:border-slate-700" />
                      <button type="button" onClick={() => setPoster(null)} className="cursor-pointer text-xs font-semibold text-red-600 hover:underline">
                        Remove
                      </button>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Each person gets this poster with a short greeting from the template. It is sent as you see it here.</p>
                </div>
              ) : (
                <textarea
                value={offerText}
                onChange={(e) => {
                  setOfferText(e.target.value.replace(/[\r\n]+/g, ' '));
                  setOfferEdited(true);
                }}
                rows={2}
                maxLength={600}
                className={inputCls}
              />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={sendWholeGroup}
                  disabled={sendingGroup || pendingInGroup.length === 0 || (api.posterMode ? !poster : !offerText.trim()) || !campaignSlug}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sendingGroup
                    ? 'Sending...'
                    : pendingInGroup.length === 0
                    ? 'Everyone in this group is done'
                    : `Send to ${pendingInGroup.length} people now`}
                </button>
                {sendingGroup && <span className="text-xs text-slate-500">This takes up to a minute. Keep this page open.</span>}
              </div>
              {lastResult && (
                <div className="rounded-lg bg-white p-3 text-xs dark:bg-slate-900">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {lastResult.sent} sent · {lastResult.failed} failed · {lastResult.skipped} skipped
                  </p>
                  {lastResult.stoppedEarly && <p className="mt-1 text-red-600 dark:text-red-400">{lastResult.stoppedEarly}</p>}
                  {lastResult.failures.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-slate-500 dark:text-slate-400">
                      {lastResult.failures.map((f) => (
                        <li key={f.phone}>
                          {f.name} ({f.phone}): {f.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {current.length > 0 && api && !api.configured && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Sending a whole group with one tap is not set up yet</p>
              <p className="mt-1">
                It needs a WhatsApp Business account with an approved marketing template. Missing on the server: {api.missing.join(', ')}.
                Until then, use <strong>Open next</strong> below to send person by person.
              </p>
            </div>
          )}
          {current.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openNext}
                disabled={!nextPending || !canSend || busyPhone !== null}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyPhone ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                {nextPending ? `Open next: ${nextPending.name}` : 'This group is finished'}
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Group {groupIndex + 1}: {doneInGroup} of {current.length} opened. Press Send in WhatsApp, come back, then open the next.
              </span>
            </div>
          )}
        </div>

        {current.length > 0 && (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">#</th>
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">Mobile</th>
                  <th className="px-4 py-2 font-semibold">Town</th>
                  <th className="px-4 py-2 text-right font-semibold">WhatsApp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {current.map((r, i) => {
                  const sent = done.has(r.phone);
                  return (
                    <tr key={r.phone} className="text-slate-700 dark:text-slate-300">
                      <td className="px-4 py-2 text-slate-400">{groupIndex * size + i + 1}</td>
                      <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{r.name}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{r.phone.slice(2)}</td>
                      <td className="px-4 py-2">{r.city || '-'}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openFor(r)}
                          disabled={!canSend || busyPhone !== null}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                            sent
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900'
                          }`}
                        >
                          {sent ? <CheckCircle2 className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                          {sent ? 'Opened, send again' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
