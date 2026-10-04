import type { MutationResult, MutationType } from '@wn/domain';
import { db, type OutboxItem } from './db';
import { isOnline, onNetworkChange } from './network';

/*
 * Outbox pattern (design Dr4/DZ1). Every field action is written to IndexedDB first, so the UI
 * never waits on the network, then pushed in order when there is a connection. Each mutation's
 * client UUID makes retries safe: the server applies an id at most once. Photos upload on their
 * own queue so a slow upload never blocks the next stop. No Background Sync dependency (iOS has
 * none): flushing runs on reconnect, on an interval, when the app regains focus and after each action.
 */

type Listener = (results: MutationResult[]) => void;
const listeners = new Set<Listener>();
let flushing: Promise<void> | null = null;
let lastAttempt = 0;
let lastSuccess = 0;

export function onSynced(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const syncStatus = () => ({ lastAttempt, lastSuccess });

export async function record(
  type: MutationType,
  payload: unknown,
  meta: { label: string; detail?: string; baseVersion?: number | null },
): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    type,
    payload,
    at: new Date().toISOString(),
    baseVersion: meta.baseVersion ?? null,
    label: meta.label,
    detail: meta.detail ?? '',
    status: 'queued',
    createdAt: Date.now(),
  };
  await db.outbox.add(item);
  void flush();
  return item;
}

export async function savePhoto(blob: Blob, label: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.photos.add({ id, blob, label, status: 'queued', createdAt: Date.now() });
  void flush();
  return id;
}

export async function pendingCount() {
  const [m, p] = await Promise.all([db.outbox.where('status').equals('queued').count(), db.photos.where('status').equals('queued').count()]);
  return m + p;
}

export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush() {
  if (!isOnline()) return;
  lastAttempt = Date.now();
  const all: MutationResult[] = [];
  try {
    for (;;) {
      const batch = await db.outbox.where('status').equals('queued').sortBy('createdAt');
      if (!batch.length) break;
      const chunk = batch.slice(0, 50);
      const pending = (await pendingCount()) - chunk.length;
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pending: Math.max(0, pending),
          mutations: chunk.map((m) => ({ id: m.id, type: m.type, at: m.at, baseVersion: m.baseVersion, payload: m.payload })),
        }),
      });
      if (res.status === 401) return; // signed out; keep everything queued
      if (!res.ok) throw new Error(`push ${res.status}`);
      const { results } = (await res.json()) as { results: MutationResult[] };
      await db.transaction('rw', db.outbox, async () => {
        for (const r of results) {
          await db.outbox.update(r.id, {
            status: r.status === 'rejected' ? 'rejected' : 'synced',
            error: r.error,
            warning: r.warning,
            syncedAt: Date.now(),
          });
        }
      });
      all.push(...results);
      if (chunk.length < 50) break;
    }

    for (const photo of await db.photos.where('status').equals('queued').sortBy('createdAt')) {
      if (!isOnline()) break;
      const form = new FormData();
      form.append('id', photo.id);
      form.append('file', photo.blob, `${photo.id}.jpg`);
      const res = await fetch('/api/photos', { method: 'POST', credentials: 'same-origin', body: form });
      if (!res.ok && res.status !== 409) throw new Error(`photo ${res.status}`);
      await db.photos.update(photo.id, { status: 'synced', syncedAt: Date.now() });
    }
    // Phone positions: small batches, deleted once the server has them (ids make retries harmless).
    for (;;) {
      if (!isOnline()) break;
      const pings = await db.pings.orderBy('createdAt').limit(200).toArray();
      if (!pings.length) break;
      const byVehicle = new Map<string, typeof pings>();
      for (const p of pings) byVehicle.set(p.vehicleId, [...(byVehicle.get(p.vehicleId) ?? []), p]);
      for (const [vehicleId, points] of byVehicle) {
        const res = await fetch('/api/driver/positions', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ vehicleId, points: points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: p.at })) }),
        });
        if (res.status === 401 || res.status === 403) {
          await db.pings.bulkDelete(points.map((p) => p.id)); // not a driver session: nothing to send them as
          continue;
        }
        if (!res.ok) throw new Error(`positions ${res.status}`);
        await db.pings.bulkDelete(points.map((p) => p.id));
      }
      if (pings.length < 200) break;
    }
    lastSuccess = Date.now();
  } catch {
    // Network dropped mid-flush: everything not acknowledged stays queued for the next attempt.
  } finally {
    if (all.length) listeners.forEach((l) => l(all));
  }
}

let started = false;
export function startSyncLoop() {
  if (started) return;
  started = true;
  onNetworkChange(() => {
    if (isOnline()) void flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  setInterval(() => void flush(), 15_000);
  void flush();
}

/** Clears records that are safely on the server, keeping the last few for the sync screen. */
export async function pruneSynced(keep = 30) {
  const synced = await db.outbox.where('status').equals('synced').sortBy('createdAt');
  const drop = synced.slice(0, Math.max(0, synced.length - keep)).map((s) => s.id);
  if (drop.length) await db.outbox.bulkDelete(drop);
}
