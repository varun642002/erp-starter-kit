// Notes how long each step of opening the app takes, so a slow start can be pinned on one step.
// Open the browser console (F12) after signing in: each step prints once, and window.__startup holds them all (milliseconds from the start).
const marks: Record<string, number> = {};

export function markStartup(step: string): void {
  if (typeof window === 'undefined' || marks[step] !== undefined) return;
  marks[step] = Math.round(performance.now());
  (window as unknown as { __startup?: Record<string, number> }).__startup = { ...marks };
  console.info(`[startup] ${step}: ${marks[step]} ms`);
}
