import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Send, Users, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { ApiScope } from '../../services/apiClient';
import { cancelBroadcastJob, fetchBroadcast, fetchBroadcastStatus, startBroadcast, tickBroadcast, type BroadcastFailure, type BroadcastJob, type BroadcastStatus } from '../../services/messageApi';
import { pickValidPhone } from '../../utils/whatsapp';

// One picture and one short message to every customer with a mobile number. Press Send once: the server queues everyone
// and sends in batches, and this page shows the progress. Leave the page open until it finishes (it carries on if you come back).

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const cardCls = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900';
const ACTIVE = new Set(['draft', 'queued', 'running', 'paused']);
const SAMPLE_EN = 'Wishing you and your family a very happy and prosperous Diwali. Thank you for being part of the Acme Agro Equipment family.';
const SAMPLE_TA = 'உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் இனிய தீபாவளி நல்வாழ்த்துகள். பொன்னர் சங்கர் டிராக்டர்ஸ் குடும்பத்தின் அங்கமாக இருப்பதற்கு நன்றி.';

// Big phone pictures are shrunk to a sensible size so they upload fast and stay under WhatsApp's 4 MB limit.
async function preparePicture(file: File): Promise<{ mime: string; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot read the picture.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.88);
  return { mime: 'image/jpeg', data: url.split(',')[1] || '', preview: url };
}

export const GroupGreeting: React.FC<{ scope: ApiScope; sentBy?: string }> = ({ scope, sentBy }) => {
  const { customers, showToast, addAuditLog } = useERP();
  const [status, setStatus] = useState<(BroadcastStatus & { recent: BroadcastJob[]; optedOut?: number }) | null>(null);
  const [title, setTitle] = useState('Diwali 2026');
  const [message, setMessage] = useState(SAMPLE_EN);
  const [picture, setPicture] = useState<{ mime: string; data: string; preview: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<BroadcastJob | null>(null);
  const [failures, setFailures] = useState<BroadcastFailure[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // everyone with a usable mobile number, once per number, blocked customers left out
  const audience = useMemo(() => {
    const seen = new Set<string>();
    const list: { customerId: string; name: string; phone: string; branchId: string }[] = [];
    let blocked = 0;
    let noPhone = 0;
    for (const c of customers) {
      if (c.status === 'Blocked') {
        blocked += 1;
        continue;
      }
      const phone = pickValidPhone(c.phone, c.alternatePhone);
      if (!phone) {
        noPhone += 1;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      list.push({ customerId: c.id, name: (c.name || c.companyName || '').trim() || 'Customer', phone, branchId: c.branchId });
    }
    return { list, blocked, noPhone };
  }, [customers]);

  useEffect(() => {
    let alive = true;
    fetchBroadcastStatus(scope)
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        const running = s.recent.find((j) => ACTIVE.has(j.status));
        if (running) setJob(running); // a greeting is still going out: pick it up again
      })
      .catch((e: any) => alive && setError(e?.message || 'Could not check the group sending set-up.'));
    return () => {
      alive = false;
    };
  }, [scope]);

  // While a greeting is going out, ask the server for the next batch again and again until it is finished.
  const jobId = job && ACTIVE.has(job.status) ? job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    (async () => {
      let errors = 0;
      while (alive) {
        try {
          const r = await tickBroadcast(scope, jobId);
          if (!alive) return;
          errors = 0;
          setJob(r.job);
          setFailures(r.failures);
          if (!ACTIVE.has(r.job.status)) return;
          // a short rest between batches; longer when WhatsApp asked us to slow down
          await new Promise((ok) => setTimeout(ok, r.job.status === 'paused' ? 5000 : 1500));
        } catch (e: any) {
          if (!alive) return;
          errors += 1;
          if (errors >= 6) {
            setError(`Lost touch with the server: ${e?.message || 'unknown error'}. Reload this page to carry on.`);
            return;
          }
          await new Promise((ok) => setTimeout(ok, 5000)); // a dropped connection: try again shortly
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId, scope]);

  const finished = job && !ACTIVE.has(job.status) ? job : null;
  useEffect(() => {
    if (!finished) return;
    addAuditLog('Group greeting finished', 'Messages', `"${finished.title}": ${finished.sent} sent, ${finished.failed} failed, ${finished.skipped} skipped.`, { severity: 'info' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished?.id, finished?.status]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      setPicture(await preparePicture(file));
    } catch (e: any) {
      setError(e?.message || 'Could not read that picture. Choose a JPG or PNG.');
    }
  };

  const send = async () => {
    if (!picture || busy) return;
    setBusy(true);
    setError('');
    try {
      const j = await startBroadcast(scope, { title, message, poster: { mime: picture.mime, data: picture.data }, sentBy, recipients: audience.list });
      addAuditLog('Group greeting started', 'Messages', `"${j.title}" to ${j.total - j.skipped} customers.`, { severity: 'info' });
      setJob(j);
      setFailures([]);
      setConfirm(false);
    } catch (e: any) {
      setError(e?.message || 'Could not start the greeting.');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try {
      const r = await cancelBroadcastJob(scope, job.id);
      setJob(r.job);
      showToast('Stopped', 'The people not yet sent to will not get it.', 'info');
    } catch (e: any) {
      showToast('Could not stop', e?.message || 'Try again.', 'error');
    }
  };

  const ready = !!status?.configured && !!picture && message.trim().length > 0 && title.trim().length > 0 && audience.list.length > 0;
  const done = job ? job.sent + job.failed : 0;
  const share = job && job.total - job.skipped > 0 ? Math.min(100, Math.round((done / (job.total - job.skipped)) * 100)) : 0;
  const sampleName = audience.list[0]?.name || 'Ravi';

  return (
    <div className={`${cardCls} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white">
            <Send className="h-4 w-4 text-emerald-600" /> Greeting to all customers
          </h3>
          <p className="text-xs text-slate-500">Choose a picture, type a short message and press send once. It goes to everyone with a mobile number, in groups, by itself.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Users className="h-3.5 w-3.5" /> {audience.list.length.toLocaleString('en-IN')} customers
        </span>
      </div>

      {status && !status.configured && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="flex items-start gap-1.5 font-bold">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> One set-up step is left before this can send.
          </p>
          <p>
            In WhatsApp Manager, create a message template: category <b>Marketing</b>, name <b>diwali_greeting</b>, language English. Header: <b>Image</b>. Body: <b>Hello {'{{1}}'}, {'{{2}}'}</b> (add a sample for each). Footer: <b>Reply STOP to stop messages</b>. When Meta approves it, tell Claude and it will be switched on.
          </p>
          <p className="text-[11px] opacity-80">Missing: {status.missing.join(', ')}</p>
        </div>
      )}

      {job ? (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900 dark:text-white">{job.title}</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                job.status === 'done' ? 'bg-emerald-100 text-emerald-800' : job.status === 'stopped' || job.status === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {job.status === 'done' ? 'Finished' : job.status === 'cancelled' ? 'Stopped' : job.status === 'stopped' ? 'Stopped, check the set-up' : job.status === 'paused' ? 'Waiting a moment' : 'Sending'}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all" style={{ width: `${share}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Sent', job.sent],
              ['Not delivered', job.failed],
              ['Still to send', job.pending]
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                <p className="text-lg font-black tabular-nums text-slate-900 dark:text-white">{Number(v).toLocaleString('en-IN')}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              </div>
            ))}
          </div>
          {job.skipped > 0 && <p className="text-[11px] text-slate-500">{job.skipped} were left out (no usable number, or already sent this greeting before).</p>}
          {error && <p className="rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
          {job.note && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{job.note}</p>}
          {ACTIVE.has(job.status) && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending. Keep this page open until it is finished.
              </p>
              <button type="button" onClick={cancel} className="cursor-pointer rounded-full border border-slate-300 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                Stop
              </button>
            </div>
          )}
          {failures.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-bold text-rose-700">{failures.length} not delivered (see why)</summary>
              <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
                {failures.map((f) => (
                  <li key={f.phone}>
                    {f.name} · {f.phone}: {f.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!ACTIVE.has(job.status) && (
            <button type="button" onClick={() => { setJob(null); setPicture(null); }} className="cursor-pointer rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
              Start another greeting
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Name of this greeting (so nobody gets it twice)
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${inputCls} mt-1`} />
            </label>

            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Picture</p>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300">
                <ImagePlus className="h-4 w-4" /> {picture ? 'Choose a different picture' : 'Upload the picture (JPG or PNG)'}
              </button>
            </div>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Message (one short paragraph)
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={500} className={`${inputCls} mt-1`} />
              <span className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-normal text-slate-400">
                <span>{message.length}/500. Line breaks are joined into one paragraph.</span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setMessage(SAMPLE_EN)} className="cursor-pointer font-bold text-emerald-700 underline">English wording</button>
                  <button type="button" onClick={() => setMessage(SAMPLE_TA)} className="cursor-pointer font-bold text-emerald-700 underline">Tamil wording</button>
                </span>
              </span>
            </label>

            {error && (
              <p className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              {audience.noPhone > 0 && `${audience.noPhone} customers have no usable number. `}
              {audience.blocked > 0 && `${audience.blocked} blocked customers are left out. `}
              {(status?.optedOut ?? 0) > 0 && `${status?.optedOut} customers replied STOP and are never sent marketing. `}
              Message only customers who are happy to hear from you; too many complaints can get your WhatsApp number restricted.
            </p>
            <button type="button" disabled={!ready} onClick={() => setConfirm(true)} className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
              <Send className="h-4 w-4" /> Send to {audience.list.length.toLocaleString('en-IN')} customers
            </button>
          </div>

          <div className="rounded-2xl bg-[#e7ded3] p-3 dark:bg-slate-800">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">How it looks on WhatsApp</p>
            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-slate-900">
              {picture ? <img src={picture.preview} alt="Greeting picture" className="max-h-56 w-full object-cover" /> : <div className="flex h-32 items-center justify-center bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">Your picture</div>}
              <div className="space-y-1 p-2.5 text-xs text-slate-800 dark:text-slate-100">
                <p className="break-words">
                  Hello {sampleName}, {message.replace(/\s+/g, ' ').trim() || 'your message'}
                </p>
                <p className="text-[10px] text-slate-400">Reply STOP to stop messages</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="Confirm the greeting">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Send "{title}" to {audience.list.length.toLocaleString('en-IN')} customers?</h2>
              <button type="button" onClick={() => setConfirm(false)} aria-label="Close" className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">It is sent in groups, by itself, and cannot be recalled once it is on its way. Anyone who already received a greeting with this same name is skipped.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(false)} disabled={busy} className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                Not yet
              </button>
              <button type="button" onClick={send} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Yes, send it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
