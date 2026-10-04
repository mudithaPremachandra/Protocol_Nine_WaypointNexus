import { useEffect, useState, useSyncExternalStore } from 'react';
import { db } from './db';
import { flush } from './sync';

/*
 * Vehicle location from the driver's own phone (browser geolocation), only while a trip is in
 * progress and the app is open; browsers do not allow background tracking, and the design has the
 * driver using the phone when stopped. Fixes are throttled (2 min or 300 m), queued in IndexedDB so
 * they survive dead zones, and uploaded by the sync loop. The driver can switch sharing off.
 */
const KEY = 'wn.shareLocation';
const MIN_INTERVAL_MS = 120_000;
const MIN_DISTANCE_M = 300;

const listeners = new Set<() => void>();
const read = () => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};
export function setShareLocation(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export function useShareLocation() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => true);
}

let last: { lat: number; lng: number; t: number } | null = null;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function save(vehicleId: string, pos: GeolocationPosition, force: boolean) {
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: pos.timestamp || Date.now() };
  if (!force && last && p.t - last.t < MIN_INTERVAL_MS && metres(last, p) < MIN_DISTANCE_M) return;
  last = p;
  await db.pings.add({
    id: crypto.randomUUID(),
    vehicleId,
    lat: p.lat,
    lng: p.lng,
    accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
    at: new Date(p.t).toISOString(),
    createdAt: Date.now(),
  });
  void flush();
}

/** One immediate fix at a meaningful moment (trip start, stop completed). */
export function recordFix(vehicleId: string | undefined) {
  if (!vehicleId || !read() || !('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition((pos) => void save(vehicleId, pos, true), () => undefined, { maximumAge: 60_000, timeout: 15_000 });
}

export type LocationState = 'off' | 'waiting' | 'on' | 'denied' | 'unavailable';

/** Watches position while `active` (a trip in progress). Returns the state for the status line. */
export function useTripLocation(active: boolean, vehicleId: string | undefined) {
  const share = useShareLocation();
  const [state, setState] = useState<LocationState>('off');
  const [lastFix, setLastFix] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !share || !vehicleId) {
      setState('off');
      return;
    }
    if (!('geolocation' in navigator)) {
      setState('unavailable');
      return;
    }
    setState('waiting');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState('on');
        setLastFix(Date.now());
        void save(vehicleId, pos, false);
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, share, vehicleId]);

  return { share, state, lastFix };
}
