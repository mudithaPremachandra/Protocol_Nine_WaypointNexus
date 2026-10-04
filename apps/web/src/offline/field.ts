import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import type { MutationPayload } from '@wn/domain';
import { api } from '../lib/api';
import type { FieldTrip } from '../lib/types';
import { db, type OutboxItem, type SnapshotItem } from './db';
import { useNetwork } from './network';
import { onSynced } from './sync';

/**
 * Loader and driver screens read from a snapshot cached in IndexedDB, refreshed from the server
 * whenever there is a connection. With no signal the last snapshot is used, so the route never
 * disappears with the coverage.
 */
export function useFieldSnapshot<T extends { planVersion: number }>(key: string, url: string) {
  const { online } = useNetwork();
  const remote = useQuery({
    queryKey: ['field', key],
    queryFn: () => api<T>(url),
    enabled: online,
    refetchInterval: online ? 20_000 : false,
  });

  useEffect(() => {
    if (!remote.data) return;
    void db.transaction('rw', db.snapshots, async () => {
      const prev = await db.snapshots.get(key);
      await db.snapshots.put({ ...prev, key, data: remote.data, version: remote.data!.planVersion, savedAt: Date.now() });
    });
  }, [remote.data, remote.dataUpdatedAt, key]);

  const { refetch } = remote;
  useEffect(() => {
    const off = onSynced(() => void refetch());
    return () => {
      off();
    };
  }, [refetch]);

  const snapshot = useLiveQuery(() => db.snapshots.get(key), [key]);
  const outbox = useLiveQuery(() => db.outbox.orderBy('createdAt').toArray(), [], [] as OutboxItem[]);
  return {
    snapshot: snapshot as (SnapshotItem & { data: T }) | undefined,
    outbox,
    loading: snapshot === undefined && remote.isLoading,
    error: snapshot ? null : remote.error,
    online,
    refetch: remote.refetch,
  };
}

/**
 * Applies actions recorded on this device on top of the server snapshot: queued ones, and synced
 * ones the snapshot predates. The screen reflects what the person just did, signal or not.
 */
export function overlay(trips: FieldTrip[], outbox: OutboxItem[], savedAt: number): FieldTrip[] {
  const pending = outbox.filter((m) => m.status === 'queued' || (m.status === 'synced' && (m.syncedAt ?? 0) > savedAt - 1000));
  if (!pending.length) return trips;
  const out: FieldTrip[] = structuredClone(trips);
  const stopOf = (orderId: string) => out.flatMap((t) => t.stops).find((s) => s.order.id === orderId);
  for (const m of pending) {
    switch (m.type) {
      case 'load.check': {
        const p = m.payload as MutationPayload<'load.check'>;
        const s = stopOf(p.orderId);
        if (s) {
          s.loadedUnits = p.loadedUnits;
          s.loadCheckedAt = m.at;
        }
        break;
      }
      case 'flag.raise': {
        const p = m.payload as MutationPayload<'flag.raise'>;
        const s = p.orderId ? stopOf(p.orderId) : undefined;
        if (s && !s.flags.some((f) => f.id === p.flagId)) s.flags.push({ id: p.flagId, type: p.type, item: p.item ?? null, qty: p.qty ?? null, note: p.note ?? null, role: 'loader', photoId: p.photoId ?? null });
        break;
      }
      case 'trip.release': {
        const t = out.find((x) => x.id === (m.payload as MutationPayload<'trip.release'>).tripId);
        if (t && (t.status === 'planned' || t.status === 'loading')) {
          t.status = 'released';
          t.releasedAt = m.at;
        }
        break;
      }
      case 'trip.start': {
        const t = out.find((x) => x.id === (m.payload as MutationPayload<'trip.start'>).tripId);
        if (t && t.status !== 'completed') t.status = 'in_progress';
        break;
      }
      case 'stop.record': {
        const p = m.payload as MutationPayload<'stop.record'>;
        const s = stopOf(p.orderId);
        if (s) {
          s.status = p.outcome;
          s.delivery = { id: p.deliveryId, outcome: p.outcome, deliveredUnits: p.deliveredUnits, receiverName: p.receiverName ?? null, deviceTime: m.at, photoId: p.photoId ?? null };
        }
        break;
      }
      default:
        break;
    }
  }
  for (const t of out) if (t.status === 'in_progress' && t.stops.every((s) => s.status !== 'pending')) t.status = 'completed';
  return out;
}

export function stopSignature(trips: FieldTrip[]) {
  return trips.flatMap((t) => t.stops.map((s) => ({ tripNo: t.tripNo, orderId: s.order.id, outletName: s.outlet.name, orderNo: s.order.orderNo })));
}
