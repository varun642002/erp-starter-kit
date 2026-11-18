import { useEffect, useRef } from 'react';

// Runs `refresh` every few seconds while the screen is visible, and straight away when the person comes back to
// the tab or the app. Used for figures that other people keep changing (sales, payments, stock).
export function useLiveRefresh(refresh: () => void, intervalMs = 20_000) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);
}
