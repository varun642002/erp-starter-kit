import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Keeps every open copy of the app (browser tab, installed app, Android app) on the newest release without anyone
// pressing refresh. It asks the server which release is current; when that differs from the release this page was
// built from, the page switches over:
//   - at once, if the app is in the background (nobody is looking at it);
//   - otherwise as soon as the person pauses for a few seconds, so a sale being typed is not cut off;
//   - and in any case after a few minutes, so nobody stays on an old release.

const CHECK_EVERY_MS = 60_000;
const IDLE_BEFORE_SWITCH_MS = 8_000;
const LONGEST_WAIT_MS = 3 * 60_000;

const RUNNING: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const IS_BUILT = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

async function currentVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export const AppUpdater: React.FC = () => {
  const [pending, setPending] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastActivity = useRef(Date.now());
  const pendingSince = useRef(0);
  const switching = useRef(false);

  // Look for a newer release now and then, and whenever the person comes back or the phone is back online.
  useEffect(() => {
    if (!IS_BUILT || RUNNING === 'dev') return;
    let stopped = false;
    const check = async () => {
      const latest = await currentVersion();
      if (stopped || !latest || latest === RUNNING) return;
      // Switched once already for this release but the old one is still being served: do not loop.
      try {
        if (sessionStorage.getItem('erp-switched-to') === latest) return;
      } catch {
        /* storage not available: fine */
      }
      setPending((cur) => {
        if (cur !== latest) pendingSince.current = Date.now();
        return latest;
      });
    };
    const first = window.setTimeout(check, 4_000);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, []);

  // Track activity, so the switch waits for a pause.
  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, touch));
  }, []);

  const switchNow = (version: string) => {
    if (switching.current) return;
    switching.current = true;
    try {
      sessionStorage.setItem('erp-switched-to', version);
    } catch {
      /* ignore */
    }
    // Ask the service worker to look for its own update too, then load the new release.
    const done = () => window.location.reload();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update())
        .catch(() => undefined)
        .finally(done);
    } else {
      done();
    }
  };

  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      const now = Date.now();
      const idle = now - lastActivity.current;
      const waited = now - pendingSince.current;
      if (document.visibilityState === 'hidden' || idle >= IDLE_BEFORE_SWITCH_MS || waited >= LONGEST_WAIT_MS) {
        switchNow(pending);
        return;
      }
      setSecondsLeft(Math.max(1, Math.ceil(Math.min(IDLE_BEFORE_SWITCH_MS - idle, LONGEST_WAIT_MS - waited) / 1000)));
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [pending]);

  if (!pending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-3.5 py-2.5 text-xs shadow-xl dark:border-blue-900 dark:bg-slate-900 sm:left-auto sm:right-4"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
        <span>
          <strong className="block text-slate-900 dark:text-white">A new version is ready</strong>
          Updating in {secondsLeft}s, or when you pause.
        </span>
      </span>
      <button
        type="button"
        onClick={() => switchNow(pending)}
        className="shrink-0 cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
      >
        Update now
      </button>
    </div>
  );
};
