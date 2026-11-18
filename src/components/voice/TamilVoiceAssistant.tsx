import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Languages, Loader2, Mic, MicOff, RotateCcw, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { WORDS, parseNumberToken, tokenize } from '../../voice/lexicon';
import { rupeesInTamil, say } from '../../voice/tamilPhrases';
import {
  interpretVoice,
  type VoiceCommand,
  type VoiceCustomerCandidate,
  type VoiceProductCandidate
} from '../../services/voiceApi';

// What the assistant needs from the Quick Sale screen. Everything money-related is computed by the screen itself
// (the same code the manual flow uses); the assistant only asks for changes and reads results back.
export interface VoiceSaleLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  stock: number;
}

export interface VoiceSaleApi {
  warehouseId?: string;
  customerBranchId?: string;
  getLines(): VoiceSaleLine[];
  getTotals(): { subtotal: number; discount: number; grandTotal: number };
  getCustomerLabel(): string | null;
  addProduct(productId: string, qty: number): { ok: boolean; line?: VoiceSaleLine; previous?: number; error?: string };
  setLineQuantity(productId: string, qty: number): { ok: boolean; line?: VoiceSaleLine; error?: string };
  reduceLine(productId: string, by: number | null): { ok: boolean; name?: string; removed?: boolean; now?: number; error?: string };
  clear(): void;
  setOverallDiscount(amount: number): void;
  selectCustomer(record: Record<string, any>): void;
  save(): Promise<{ ok: boolean; message?: string; invoiceNumber?: string; total?: number }>;
}

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

type Choice =
  | { kind: 'product'; mode: 'add' | 'info'; qty: number; options: VoiceProductCandidate[] }
  | { kind: 'cart'; mode: 'change' | 'remove'; qty: number | null; options: { productId: string; name: string }[] }
  | { kind: 'customer'; options: VoiceCustomerCandidate[] };

type Confirm = { kind: 'save'; total: number } | { kind: 'clear' };

const SpeechRecognitionCtor: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

const ORDINALS: Record<string, number> = {
  முதல்: 1, முதலாவது: 1, முதலாம்: 1, first: 1, இரண்டாவது: 2, second: 2, மூன்றாவது: 3, third: 3, நான்காவது: 4, fourth: 4, ஐந்தாவது: 5, fifth: 5
};

const fmt = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;

export const TamilVoiceAssistant: React.FC<{ api: VoiceSaleApi }> = ({ api }) => {
  const apiRef = useRef(api);
  apiRef.current = api;

  const [phase, setPhase] = useState<Phase>('idle');
  const [lang, setLang] = useState<'ta-IN' | 'en-IN'>('ta-IN');
  const [heard, setHeard] = useState('');
  const [interim, setInterim] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [muted, setMuted] = useState(false);
  const [interpreter, setInterpreter] = useState<'ai' | 'rules' | null>(null);
  const [choice, setChoiceState] = useState<Choice | null>(null);
  const [confirm, setConfirmState] = useState<Confirm | null>(null);
  const [tamilVoice, setTamilVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [voicesChecked, setVoicesChecked] = useState(false);

  const choiceRef = useRef<Choice | null>(null);
  const confirmRef = useRef<Confirm | null>(null);
  const recognitionRef = useRef<any>(null);
  const busyRef = useRef(false);
  const savingRef = useRef(false);
  const lastReplyRef = useRef('');
  const lastProductRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const setChoice = (c: Choice | null) => {
    choiceRef.current = c;
    setChoiceState(c);
  };
  const setConfirm = (c: Confirm | null) => {
    confirmRef.current = c;
    setConfirmState(c);
  };

  // ---------- speech output ----------

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoicesChecked(true);
      return;
    }
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang.toLowerCase().replace('_', '-').startsWith('ta')) || null;
      setTamilVoice(v);
      if (voices.length > 0) setVoicesChecked(true);
    };
    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    const t = setTimeout(() => setVoicesChecked(true), 1500);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pick);
      clearTimeout(t);
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    (text: string) => {
      lastReplyRef.current = text;
      setReply(text);
      if (mutedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window) || !tamilVoice) {
        setPhase('idle');
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = tamilVoice;
        u.lang = tamilVoice.lang || 'ta-IN';
        u.rate = 0.95;
        u.onstart = () => setPhase('speaking');
        u.onend = () => setPhase('idle');
        u.onerror = () => setPhase('idle');
        window.speechSynthesis.speak(u);
      } catch {
        setPhase('idle');
      }
    },
    [tamilVoice]
  );

  // ---------- command execution ----------

  const lineOf = (id: string) => apiRef.current.getLines().find((l) => l.productId === id);

  const finishAdd = (c: VoiceProductCandidate, qty: number): string[] => {
    const out: string[] = [];
    const res = apiRef.current.addProduct(c.id, qty);
    if (!res.ok || !res.line) {
      out.push(say.failed());
      return out;
    }
    lastProductRef.current = c.id;
    out.push(res.previous && res.previous > 0 ? say.addedMore(res.line.name, qty, res.line.quantity) : say.added(res.line.name, qty));
    if (res.line.stock <= 0) out.push(say.noStock(res.line.name));
    else if (res.line.quantity > res.line.stock) out.push(say.lowStock(res.line.name, res.line.stock));
    if (!(res.line.unitPrice > 0)) out.push(say.noPrice(res.line.name));
    return out;
  };

  const finishChange = (productId: string, qty: number | null, mode: 'change' | 'remove'): string[] => {
    if (mode === 'change') {
      if (qty === null) return [say.needQuantity()];
      if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return [say.badQuantity()];
      const r = apiRef.current.setLineQuantity(productId, qty);
      if (!r.ok || !r.line) return [say.failed()];
      const out = [say.quantitySet(r.line.name, qty)];
      if (qty > r.line.stock) out.push(r.line.stock <= 0 ? say.noStock(r.line.name) : say.lowStock(r.line.name, r.line.stock));
      return out;
    }
    const r = apiRef.current.reduceLine(productId, qty);
    if (!r.ok) return [say.failed()];
    return [r.removed ? say.removed(r.name || '') : say.reduced(r.name || '', qty || 0, r.now || 0)];
  };

  const runCommand = async (cmd: VoiceCommand): Promise<{ lines: string[]; stop?: boolean; askMore?: boolean }> => {
    const a = apiRef.current;
    switch (cmd.intent) {
      case 'add_product': {
        const qty = cmd.quantity ?? 1;
        if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return { lines: [say.badQuantity()] };
        const p = cmd.product;
        if (!cmd.product_query || !p) return { lines: [say.unknown()] };
        if (p.status === 'none' || p.candidates.length === 0) return { lines: [say.noProduct(cmd.product_query)] };
        if (p.status === 'matched') return { lines: finishAdd(p.candidates[0], qty), askMore: true };
        setChoice({ kind: 'product', mode: 'add', qty, options: p.candidates });
        return {
          lines: [p.candidates.length === 1 ? say.confirmProduct(p.candidates[0].name) : say.whichProduct(p.candidates.map((c) => c.name))],
          stop: true
        };
      }
      case 'change_quantity':
      case 'remove_product': {
        const mode = cmd.intent === 'change_quantity' ? 'change' : 'remove';
        const m = cmd.cartMatch;
        if (!m || m.status === 'none' || m.productIds.length === 0) return { lines: [say.notInSale(cmd.product_query)] };
        if (m.status === 'matched') return { lines: finishChange(m.productIds[0], cmd.quantity, mode) };
        const options = m.productIds.map((id) => ({ productId: id, name: lineOf(id)?.name || id }));
        setChoice({ kind: 'cart', mode, qty: cmd.quantity, options });
        return { lines: [options.length === 1 ? say.confirmProduct(options[0].name) : say.whichInSale(options.map((o) => o.name))], stop: true };
      }
      case 'search_product': {
        if (!cmd.product_query) {
          const last = lastProductRef.current ? lineOf(lastProductRef.current) : a.getLines()[a.getLines().length - 1];
          return { lines: [last ? say.price(last.name, last.unitPrice, last.stock) : say.unknown()] };
        }
        const p = cmd.product;
        if (!p || p.status === 'none' || p.candidates.length === 0) return { lines: [say.noProduct(cmd.product_query)] };
        if (p.status === 'matched') {
          const c = p.candidates[0];
          return { lines: [say.price(c.name, c.sellingPrice, c.stock)] };
        }
        setChoice({ kind: 'product', mode: 'info', qty: 1, options: p.candidates });
        return {
          lines: [p.candidates.length === 1 ? say.confirmProduct(p.candidates[0].name) : say.whichProduct(p.candidates.map((c) => c.name))],
          stop: true
        };
      }
      case 'show_cart': {
        const lines = a.getLines();
        if (!lines.length) return { lines: [say.emptySale()] };
        return { lines: [say.cart(lines.map((l) => ({ name: l.name, quantity: l.quantity })), a.getTotals().grandTotal)] };
      }
      case 'get_total': {
        const lines = a.getLines();
        if (!lines.length) return { lines: [say.emptySale()] };
        return { lines: [say.total(a.getTotals().grandTotal)] };
      }
      case 'select_customer': {
        const c = cmd.customer;
        if (!c || c.status === 'none' || c.candidates.length === 0) return { lines: [say.customerNone(cmd.customer_query || '')] };
        if (c.status === 'matched') {
          a.selectCustomer(c.candidates[0].record);
          return { lines: [say.customerSet(c.candidates[0].name)] };
        }
        setChoice({ kind: 'customer', options: c.candidates });
        return {
          lines: [c.candidates.length === 1 ? say.confirmCustomer(c.candidates[0].name) : say.whichCustomer(c.candidates.map((x) => `${x.name} ${x.city}`.trim()))],
          stop: true
        };
      }
      case 'apply_discount': {
        const d = cmd.discount;
        const t = a.getTotals();
        if (!d || !(d.value > 0) || t.subtotal <= 0) return { lines: [say.discountBad()] };
        if (d.type === 'percent') {
          if (d.value > 100) return { lines: [say.discountBad()] };
          const amount = Math.round(t.subtotal * d.value) / 100;
          a.setOverallDiscount(amount);
          return { lines: [say.discountPercent(d.value, amount, Math.max(0, t.subtotal - amount))] };
        }
        const amount = Math.min(d.value, t.subtotal);
        a.setOverallDiscount(amount);
        return { lines: [say.discountAmount(amount, Math.max(0, t.subtotal - amount))] };
      }
      case 'clear_draft': {
        if (!a.getLines().length) return { lines: [say.emptySale()] };
        setConfirm({ kind: 'clear' });
        return { lines: [say.confirmClear()], stop: true };
      }
      case 'request_save': {
        if (!a.getLines().length) return { lines: [say.nothingToSave()] };
        const total = a.getTotals().grandTotal;
        setConfirm({ kind: 'save', total });
        return { lines: [say.confirmSave(total, a.getCustomerLabel())], stop: true };
      }
      case 'confirm_save':
        return { lines: await doConfirm() };
      case 'cancel_save':
        return { lines: [doCancel()] };
      case 'help':
        return { lines: [say.help()] };
      default:
        return { lines: [say.unknown()] };
    }
  };

  const doCancel = (): string => {
    const had = confirmRef.current || choiceRef.current;
    setConfirm(null);
    setChoice(null);
    return had ? say.saveCancelled() : say.unknown();
  };

  const doConfirm = async (): Promise<string[]> => {
    const pending = confirmRef.current;
    if (!pending) return [say.noPending()];
    const a = apiRef.current;
    if (pending.kind === 'clear') {
      setConfirm(null);
      a.clear();
      return [say.cleared()];
    }
    // The total is read again at confirmation: if the sale changed meanwhile, the user hears the new amount first.
    const nowTotal = a.getTotals().grandTotal;
    if (!a.getLines().length) {
      setConfirm(null);
      return [say.nothingToSave()];
    }
    if (Math.abs(nowTotal - pending.total) > 0.005) {
      setConfirm({ kind: 'save', total: nowTotal });
      return [say.confirmSave(nowTotal, a.getCustomerLabel())];
    }
    if (savingRef.current) return [];
    savingRef.current = true;
    setConfirm(null);
    try {
      const r = await a.save();
      if (r.ok) return [say.saved(r.invoiceNumber || null, r.total ?? nowTotal)];
      return [say.saveFailed(r.message || '')];
    } finally {
      savingRef.current = false;
    }
  };

  // Picking one of the offered options by number ("இரண்டு"), ordinal, or "ஆம்" when there is a single option.
  const pickFromChoice = (text: string, c: Choice): number | 'no' | null => {
    const tokens = tokenize(text).filter((t) => t !== '|');
    if (!tokens.length) return null;
    const isNo = tokens.some((t) => WORDS.no.includes(t) || WORDS.cancel.includes(t));
    if (isNo && tokens.length <= 4) return 'no';
    for (const t of tokens) {
      const n = ORDINALS[t] ?? parseNumberToken(t);
      if (n && n >= 1 && n <= c.options.length && tokens.length <= 4) return n - 1;
    }
    if (c.options.length === 1 && tokens.length <= 3 && tokens.some((t) => WORDS.yes.includes(t))) return 0;
    return null;
  };

  const handleText = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setError('');
    setHeard(text);
    setInterim('');
    setPhase('thinking');
    const lines: string[] = [];
    let askMore = false;
    try {
      // a plain yes / no to an open confirmation needs no interpretation
      if (confirmRef.current && !choiceRef.current) {
        const t = tokenize(text).filter((x) => x !== '|');
        const isYes = t.length > 0 && t.length <= 3 && t.some((x) => WORDS.yes.includes(x)) && !t.some((x) => WORDS.save.includes(x));
        const isNo = t.length > 0 && t.length <= 3 && t.some((x) => WORDS.no.includes(x) || WORDS.cancel.includes(x));
        if (isYes || isNo) {
          const out = isYes ? await doConfirm() : [doCancel()];
          speak(out.join(' ') || say.unknown());
          return;
        }
      }
      // 1) answer to a question the assistant asked
      const c = choiceRef.current;
      if (c) {
        const picked = pickFromChoice(text, c);
        if (picked === 'no') {
          setChoice(null);
          speak(say.saveCancelled());
          return;
        }
        if (picked !== null) {
          setChoice(null);
          if (c.kind === 'product') {
            const cand = c.options[picked];
            if (c.mode === 'add') {
              lines.push(...finishAdd(cand, c.qty));
              askMore = true;
            } else lines.push(say.price(cand.name, cand.sellingPrice, cand.stock));
          } else if (c.kind === 'cart') {
            lines.push(...finishChange(c.options[picked].productId, c.qty, c.mode));
          } else {
            const cand = c.options[picked];
            apiRef.current.selectCustomer(cand.record);
            lines.push(say.customerSet(cand.name));
          }
          speak(lines.join(' '));
          return;
        }
        setChoice(null); // a new command replaces the open question
      }

      // 2) interpret the sentence (server: AI when configured, built-in rules otherwise) and look products up in the database
      const a = apiRef.current;
      const seen = new Set<string>();
      const cart = a
        .getLines()
        .filter((l) => (seen.has(l.productId) ? false : (seen.add(l.productId), true)))
        .map((l) => ({ productId: l.productId, name: l.name, sku: l.sku }));
      const res = await interpretVoice({
        text,
        awaiting: confirmRef.current ? confirmRef.current.kind : null,
        cart,
        warehouseId: a.warehouseId,
        branchId: a.customerBranchId
      });
      setInterpreter(res.interpreter);

      const hadConfirm = !!confirmRef.current;
      for (const cmd of res.commands) {
        // anything other than yes / no / save while a confirmation is open withdraws that confirmation
        if (hadConfirm && !['confirm_save', 'cancel_save', 'request_save'].includes(cmd.intent)) setConfirm(null);
        const r = await runCommand(cmd);
        lines.push(...r.lines);
        if (r.askMore) askMore = true;
        if (r.stop) break;
      }
      if (askMore && !choiceRef.current && !confirmRef.current) lines.push(say.askMore());
      speak(lines.join(' ') || say.unknown());
    } catch (e: any) {
      setError(e?.message || 'The voice request failed.');
      speak(say.failed());
    } finally {
      busyRef.current = false;
    }
  };

  // ---------- microphone ----------

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startListening = () => {
    if (!SpeechRecognitionCtor) {
      setError('This browser cannot listen to speech. Use Chrome or Edge, or type the command below.');
      return;
    }
    if (busyRef.current || phase === 'listening') return;
    stopSpeaking();
    setError('');
    setInterim('');
    let finalText = '';
    let got = false;
    const rec = new SpeechRecognitionCtor();
    recognitionRef.current = rec;
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setPhase('listening');
    rec.onresult = (ev: any) => {
      let interimText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          finalText += r[0].transcript + ' ';
          got = true;
        } else interimText += r[0].transcript;
      }
      setInterim(interimText || finalText);
    };
    rec.onerror = (ev: any) => {
      const code = ev?.error;
      const msg =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone permission was denied. Allow the microphone for this site, or type the command below.'
          : code === 'no-speech'
            ? 'No speech was heard. Tap Start Listening and try again.'
            : code === 'audio-capture'
              ? 'No microphone was found.'
              : code === 'network'
                ? 'Speech recognition needs an internet connection. Type the command below instead.'
                : code === 'language-not-supported'
                  ? 'This browser does not support that language for speech recognition.'
                  : code === 'aborted'
                    ? ''
                    : `Speech recognition error: ${code || 'unknown'}`;
      if (msg) setError(msg);
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setPhase((p) => (p === 'listening' ? 'idle' : p));
      if (got && finalText.trim()) handleText(finalText.trim());
      else setInterim('');
    };
    try {
      rec.start();
    } catch (e: any) {
      setError(e?.message || 'Could not start the microphone.');
    }
  };

  const cancelAll = () => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    stopSpeaking();
    setChoice(null);
    setConfirm(null);
    setInterim('');
    setPhase('idle');
  };

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    []
  );

  const noTamilVoice = voicesChecked && !tamilVoice;
  const statusText =
    phase === 'listening' ? 'Listening...' : phase === 'thinking' ? 'Working on it...' : phase === 'speaking' ? 'Speaking...' : 'Ready';
  const total = api.getTotals().grandTotal;
  const interpreterLabel = useMemo(
    () => (interpreter === 'ai' ? 'AI interpreter' : interpreter === 'rules' ? 'Built-in Tamil rules' : null),
    [interpreter]
  );

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${phase === 'listening' ? 'animate-pulse bg-rose-600' : 'bg-indigo-600'}`}>
            {phase === 'listening' ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Tamil Voice Assistant <span className="font-semibold text-indigo-700 dark:text-indigo-300">· குரல் உதவியாளர்</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {statusText}
              {interpreterLabel ? ` · ${interpreterLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <Languages className="h-3.5 w-3.5" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as 'ta-IN' | 'en-IN')}
              disabled={phase === 'listening'}
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              aria-label="Speech language"
            >
              <option value="ta-IN">தமிழ் (ta-IN)</option>
              <option value="en-IN">English / Tanglish (en-IN)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (!muted) stopSpeaking();
              setMuted(!muted);
            }}
            title={muted ? 'Unmute spoken replies' : 'Mute spoken replies'}
            className="cursor-pointer rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={startListening}
          disabled={phase === 'listening' || phase === 'thinking' || !SpeechRecognitionCtor}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Mic className="h-3.5 w-3.5" /> Start Listening
        </button>
        <button
          type="button"
          onClick={stopListening}
          disabled={phase !== 'listening'}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <Square className="h-3.5 w-3.5" /> Stop Listening
        </button>
        <button
          type="button"
          onClick={() => lastReplyRef.current && speak(lastReplyRef.current)}
          disabled={!reply}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Repeat Response
        </button>
        <button
          type="button"
          onClick={cancelAll}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>

      {!SpeechRecognitionCtor && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This browser cannot listen to speech (use Chrome or Edge). You can still type Tamil or Tanglish commands below.
        </p>
      )}
      {noTamilVoice && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No Tamil voice is installed on this device, so replies are shown as text only and are not spoken in another language. Install a Tamil voice in the device's language settings to hear them.
        </p>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Heard</p>
          <p className="mt-0.5 min-h-[1.25rem] text-slate-800 dark:text-slate-100">{interim || heard || <span className="text-slate-400">Nothing yet</span>}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assistant</p>
          <p className="mt-0.5 min-h-[1.25rem] text-slate-800 dark:text-slate-100">{reply || <span className="text-slate-400">Tap Start Listening and speak</span>}</p>
        </div>
      </div>

      {choice && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
            {choice.kind === 'customer' ? 'Which customer?' : choice.kind === 'cart' ? 'Which item in this sale?' : 'Which product?'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {choice.kind === 'product' &&
              choice.options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleText(String(i + 1))}
                  className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <span className="font-bold text-slate-900 dark:text-white">
                    {i + 1}. {o.name}
                  </span>
                  <span className="block font-mono text-[10px] text-slate-500">
                    {o.sku} · {fmt(o.sellingPrice)} · stock {o.stock}
                  </span>
                </button>
              ))}
            {choice.kind === 'cart' &&
              choice.options.map((o, i) => (
                <button
                  key={o.productId}
                  type="button"
                  onClick={() => handleText(String(i + 1))}
                  className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-white"
                >
                  {i + 1}. {o.name}
                </button>
              ))}
            {choice.kind === 'customer' &&
              choice.options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleText(String(i + 1))}
                  className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <span className="font-bold text-slate-900 dark:text-white">
                    {i + 1}. {o.name}
                  </span>
                  <span className="block font-mono text-[10px] text-slate-500">
                    {o.phone}
                    {o.city ? ` · ${o.city}` : ''}
                  </span>
                </button>
              ))}
            <button
              type="button"
              onClick={() => handleText('இல்லை')}
              className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              None of these
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
            {confirm.kind === 'save'
              ? `Save this sale for ${fmt(total)}? ${rupeesInTamil(total)}`
              : 'Remove all items and cancel this sale?'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleText('ஆம்')}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
            >
              <Check className="h-3.5 w-3.5" /> {confirm.kind === 'save' ? 'Yes, save' : 'Yes, cancel sale'}
            </button>
            <button
              type="button"
              onClick={() => handleText('வேண்டாம்')}
              className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              No
            </button>
          </div>
        </div>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = typed;
          setTyped('');
          handleText(t);
        }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder='Or type a command, e.g. "மூன்று பிளேடு சேர்க்கவும்" or "rendu pump venum"'
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          aria-label="Type a voice command"
        />
        <button
          type="submit"
          disabled={!typed.trim() || phase === 'thinking'}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {phase === 'thinking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
        </button>
      </form>
    </div>
  );
};
