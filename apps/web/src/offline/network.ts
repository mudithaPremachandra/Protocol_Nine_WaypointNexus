import { useSyncExternalStore } from 'react';

/*
 * Connectivity as the app sees it. "Simulate no signal" lets a judge on a laptop reproduce the
 * Kandy-hills dead zone without airplane mode: while it is on, nothing leaves the device.
 */
const KEY = 'wn.simulateOffline';
let simulated = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
}

export function isOnline() {
  return !simulated && (typeof navigator === 'undefined' || navigator.onLine);
}
export function isSimulatedOffline() {
  return simulated;
}
export function setSimulatedOffline(on: boolean) {
  simulated = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: keep in memory */
  }
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNetwork() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true);
  const sim = useSyncExternalStore(subscribe, isSimulatedOffline, () => false);
  return { online, simulated: sim };
}

export function onNetworkChange(l: () => void) {
  return subscribe(l);
}

/*
 * Remember the last offline period, so a plan change that landed while the phone had no signal can
 * be shown as "Plan changed while offline" (DZ1) rather than a live change (X4).
 */
const PERIOD = 'wn.offlinePeriod';
let wasOnline = isOnline();
subscribe(() => {
  const now = isOnline();
  if (now === wasOnline) return;
  wasOnline = now;
  try {
    const p = JSON.parse(localStorage.getItem(PERIOD) ?? '{}') as { from?: number; to?: number };
    localStorage.setItem(PERIOD, JSON.stringify(now ? { from: p.from, to: Date.now() } : { from: Date.now() }));
  } catch {
    /* ignore */
  }
});

export function lastOfflinePeriod(): { from?: number; to?: number } {
  try {
    return JSON.parse(localStorage.getItem(PERIOD) ?? '{}');
  } catch {
    return {};
  }
}
