import { and, eq, inArray } from 'drizzle-orm';
import {
  MUTATION_PAYLOADS,
  type MutationEnvelope,
  type MutationPayload,
  type MutationResult,
  type MutationType,
  type Role,
} from '@wn/domain';
import { db, type DB } from '../db/client';
import * as s from '../db/schema';
import { formatDay } from '../lib/dates';
import { HttpError } from '../lib/errors';
import { publish, recordEvent, type AuthUser, type EventRow } from '../lib/events';
import { onIncidentReported } from './incidents';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

const ALLOWED: Record<MutationType, Role[]> = {
  'load.check': ['loader'],
  'flag.raise': ['loader', 'driver', 'store_manager'],
  'trip.release': ['loader'],
  'trip.start': ['driver'],
  'stop.record': ['driver'],
  'incident.report': ['driver'],
  'plan.ack': ['driver', 'loader'],
  'receipt.confirm': ['store_manager'],
};

interface Ctx {
  tx: Tx;
  user: AuthUser;
  m: MutationEnvelope;
  at: Date;
  events: EventRow[];
  after: (() => Promise<void>)[];
  warning?: string;
}

/**
 * Applies a batch of offline mutations. Each runs in its own transaction and is recorded in
 * sync_mutations under its client UUID, so a phone that retries after a dropped connection gets the
 * same answer without the action being applied twice. One bad mutation never blocks the rest.
 */
export async function applyMutations(user: AuthUser, mutations: MutationEnvelope[], pending = 0): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  for (const m of mutations) results.push(await applyOne(user, m));
  await db
    .insert(s.deviceSync)
    .values({ userId: user.id, lastSyncAt: new Date(), pending })
    .onConflictDoUpdate({ target: s.deviceSync.userId, set: { lastSyncAt: new Date(), pending } });
  return results;
}

async function applyOne(user: AuthUser, m: MutationEnvelope): Promise<MutationResult> {
  const [seen] = await db.select().from(s.syncMutations).where(eq(s.syncMutations.id, m.id));
  if (seen) return { ...(seen.result as MutationResult), status: 'duplicate' };

  if (!ALLOWED[m.type].includes(user.role)) return remember(user, m, { id: m.id, status: 'rejected', error: 'Not allowed for your role' });
  const parsed = MUTATION_PAYLOADS[m.type].safeParse(m.payload);
  if (!parsed.success) return remember(user, m, { id: m.id, status: 'rejected', error: parsed.error.issues[0]?.message ?? 'Invalid' });

  const events: EventRow[] = [];
  const after: (() => Promise<void>)[] = [];
  try {
    const warning = await db.transaction(async (tx) => {
      const c: Ctx = { tx, user, m, at: new Date(m.at), events, after };
      await HANDLERS[m.type](c, parsed.data as never);
      const result: MutationResult = { id: m.id, status: 'applied', ...(c.warning ? { warning: c.warning } : {}) };
      await tx.insert(s.syncMutations).values({ id: m.id, userId: user.id, type: m.type, result });
      return c.warning;
    });
    publish(...events);
    for (const fn of after) await fn();
    return { id: m.id, status: 'applied', ...(warning ? { warning } : {}) };
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Could not apply';
    if (!(err instanceof HttpError)) console.error('sync mutation failed', m.type, err);
    return remember(user, m, { id: m.id, status: 'rejected', error: message });
  }
}

async function remember(user: AuthUser, m: MutationEnvelope, result: MutationResult): Promise<MutationResult> {
  await db.insert(s.syncMutations).values({ id: m.id, userId: user.id, type: m.type, result }).onConflictDoNothing();
  return result;
}

/* ------------------------------------------------------------------ */

async function loadStop(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) throw new HttpError(404, 'Order no longer exists (the demo day may have been reset)');
  const [stop] = await tx.select().from(s.stops).where(eq(s.stops.orderId, orderId));
  const [trip] = stop ? await tx.select().from(s.trips).where(eq(s.trips.id, stop.tripId)) : [];
  return { order, stop: stop ?? null, trip: trip ?? null };
}

async function loadTrip(tx: Tx, tripId: string) {
  const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId));
  if (!trip) throw new HttpError(404, 'Trip no longer exists in the current plan');
  return trip;
}

const HANDLERS: { [K in MutationType]: (c: Ctx, p: MutationPayload<K>) => Promise<void> } = {
  async 'load.check'(c, p) {
    const trip = await loadTrip(c.tx, p.tripId);
    await c.tx
      .update(s.stops)
      .set({ loadedUnits: p.loadedUnits, loadCheckedAt: c.at })
      .where(and(eq(s.stops.orderId, p.orderId), eq(s.stops.tripId, trip.id)));
    if (trip.status === 'planned') await c.tx.update(s.trips).set({ status: 'loading' }).where(eq(s.trips.id, trip.id));
  },

  async 'flag.raise'(c, p) {
    const inserted = await c.tx
      .insert(s.flags)
      .values({
        id: p.flagId,
        type: p.type,
        tripId: p.tripId ?? null,
        orderId: p.orderId ?? null,
        raisedBy: c.user.id,
        role: c.user.role,
        item: p.item ?? null,
        qty: p.qty ?? null,
        note: p.note ?? null,
        photoId: p.photoId ?? null,
        deviceTime: c.at,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    const order = p.orderId ? (await c.tx.select().from(s.orders).where(eq(s.orders.id, p.orderId)))[0] : undefined;
    const trip = p.tripId ? (await c.tx.select().from(s.trips).where(eq(s.trips.id, p.tripId)))[0] : undefined;
    const what = `${p.qty ?? ''} ${p.item ?? ''}`.trim() || p.type;

    // A loader's shortfall pre-warns the store and adjusts what the driver expects (L3).
    if (order && (p.type === 'shortfall' || p.type === 'damage') && c.user.role === 'loader') {
      await c.tx.insert(s.notifications).values({
        outletId: order.outletId,
        orderId: order.id,
        type: 'shortfall',
        title: `${order.orderNo}: ${p.type === 'damage' ? 'damaged' : 'short'} at the dock`,
        body: `${what} ${p.type === 'damage' ? 'was damaged' : 'could not be loaded'} at the depot. Dispatch knows; no need to raise a dispute for it.`,
      });
    }
    c.events.push(
      await recordEvent(c.tx, {
        type: 'flag.raised',
        actor: c.user,
        date: order?.requestedDate ?? null,
        scope: {
          roles: ['dispatcher'],
          vehicleIds: trip ? [trip.vehicleId] : [],
          depots: trip ? [trip.depot] : [],
          outletIds: order ? [order.outletId] : [],
        },
        payload: { flagId: p.flagId, flagType: p.type, orderNo: order?.orderNo, vehicleId: trip?.vehicleId, item: p.item, qty: p.qty, note: p.note, message: `${c.user.name}: ${p.type.replace('_', ' ')} on ${order?.orderNo ?? trip?.vehicleId ?? ''}${what ? ` (${what})` : ''}` },
      }),
    );
  },

  async 'trip.release'(c, p) {
    const trip = await loadTrip(c.tx, p.tripId);
    if (trip.status === 'released' || trip.status === 'in_progress' || trip.status === 'completed') return;
    await c.tx.update(s.trips).set({ status: 'released', releasedAt: c.at, releasedBy: c.user.id }).where(eq(s.trips.id, trip.id));
    const stops = await c.tx.select().from(s.stops).where(eq(s.stops.tripId, trip.id));
    if (stops.length) await c.tx.update(s.orders).set({ status: 'loaded' }).where(inArray(s.orders.id, stops.map((st) => st.orderId)));
    c.events.push(
      await recordEvent(c.tx, {
        type: 'trip.released',
        actor: c.user,
        scope: { roles: ['dispatcher'], vehicleIds: [trip.vehicleId], depots: [trip.depot] },
        payload: { tripId: trip.id, vehicleId: trip.vehicleId, tripNo: trip.tripNo, reeferRunning: p.reeferRunning ?? null, message: `${trip.vehicleId} trip ${trip.tripNo} released from ${trip.depot} dock` },
      }),
    );
  },

  async 'trip.start'(c, p) {
    const trip = await loadTrip(c.tx, p.tripId);
    if (trip.status === 'in_progress' || trip.status === 'completed') return;
    await c.tx.update(s.trips).set({ status: 'in_progress' }).where(eq(s.trips.id, trip.id));
    const stops = await c.tx.select().from(s.stops).where(eq(s.stops.tripId, trip.id));
    const pending = stops.filter((st) => st.status === 'pending').map((st) => st.orderId);
    if (pending.length) await c.tx.update(s.orders).set({ status: 'in_transit' }).where(inArray(s.orders.id, pending));
    c.events.push(
      await recordEvent(c.tx, {
        type: 'trip.started',
        actor: c.user,
        scope: { roles: ['dispatcher'], vehicleIds: [trip.vehicleId], outletIds: [] },
        payload: { tripId: trip.id, vehicleId: trip.vehicleId, message: `${trip.vehicleId} left ${trip.depot} on trip ${trip.tripNo}` },
      }),
    );
  },

  /**
   * Proof of delivery is a fact: the goods physically arrived, so it is always recorded. If the plan
   * moved this stop to another vehicle while the phone was offline, dispatch gets a double-serve
   * warning to sort out rather than the record being lost.
   */
  async 'stop.record'(c, p) {
    const { order, stop, trip } = await loadStop(c.tx, p.orderId);
    const inserted = await c.tx
      .insert(s.deliveries)
      .values({
        id: p.deliveryId,
        orderId: order.id,
        stopId: stop?.id ?? null,
        driverId: c.user.id,
        vehicleId: c.user.vehicleId,
        outcome: p.outcome,
        deliveredUnits: p.deliveredUnits,
        receiverName: p.receiverName ?? null,
        photoId: p.photoId ?? null,
        note: p.note ?? null,
        deviceTime: c.at,
        baseVersion: c.m.baseVersion ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;

    const reassigned = trip && c.user.vehicleId && trip.vehicleId !== c.user.vehicleId;
    if (stop) await c.tx.update(s.stops).set({ status: p.outcome }).where(eq(s.stops.id, stop.id));
    await c.tx.update(s.orders).set({ status: p.outcome }).where(eq(s.orders.id, order.id));

    if (reassigned) {
      c.warning = `This stop had been moved to ${trip!.vehicleId}. Your delivery is recorded and dispatch has been told.`;
      await c.tx.insert(s.flags).values({
        id: crypto.randomUUID(),
        type: 'double_serve',
        tripId: trip!.id,
        orderId: order.id,
        raisedBy: c.user.id,
        role: 'system',
        note: `${c.user.vehicleId} delivered ${order.orderNo} offline after it was reassigned to ${trip!.vehicleId}. Stop ${trip!.vehicleId} from serving it again.`,
        deviceTime: c.at,
      });
    }

    // Close the trip when its last stop is recorded.
    if (trip) {
      const remaining = await c.tx.select().from(s.stops).where(and(eq(s.stops.tripId, trip.id), eq(s.stops.status, 'pending')));
      if (!remaining.length) await c.tx.update(s.trips).set({ status: 'completed' }).where(eq(s.trips.id, trip.id));
    }

    const time = c.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
    const shortBy = order.units - p.deliveredUnits;
    await c.tx.insert(s.notifications).values({
      outletId: order.outletId,
      orderId: order.id,
      type: 'delivered',
      title:
        p.outcome === 'failed'
          ? `${order.orderNo} could not be delivered`
          : `${order.orderNo} ${p.outcome === 'partial' ? 'partly delivered' : 'delivered'} at ${time}`,
      body:
        p.outcome === 'failed'
          ? `Driver note: ${p.note ?? 'no note'}. Dispatch will rebook it.`
          : `${p.deliveredUnits} of ${order.units} units${p.receiverName ? `, received by ${p.receiverName}` : ''}.${shortBy > 0 ? ` ${shortBy} short.` : ''} Please confirm receipt.`,
    });

    c.events.push(
      await recordEvent(c.tx, {
        type: 'stop.recorded',
        actor: c.user,
        date: order.requestedDate,
        scope: { roles: ['dispatcher'], outletIds: [order.outletId], vehicleIds: [trip?.vehicleId ?? '', c.user.vehicleId ?? ''].filter(Boolean) },
        payload: {
          orderId: order.id,
          orderNo: order.orderNo,
          outcome: p.outcome,
          deliveredUnits: p.deliveredUnits,
          units: order.units,
          deviceTime: c.m.at,
          offlineMinutes: Math.max(0, Math.round((Date.now() - c.at.getTime()) / 60000)),
          reassigned: !!reassigned,
          message: `${order.orderNo} ${p.outcome} by ${c.user.vehicleId ?? c.user.name}${reassigned ? ' (possible double-serve)' : ''}`,
        },
      }),
    );
  },

  async 'incident.report'(c, p) {
    const inserted = await c.tx
      .insert(s.incidents)
      .values({
        id: p.incidentId,
        type: p.type,
        tripId: p.tripId ?? null,
        vehicleId: c.user.vehicleId ?? 'unknown',
        reportedBy: c.user.id,
        deviceTime: c.at,
        note: p.note ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    c.events.push(
      await recordEvent(c.tx, {
        type: 'incident.reported',
        actor: c.user,
        scope: { roles: ['dispatcher'], vehicleIds: [c.user.vehicleId ?? ''] },
        payload: { incidentId: p.incidentId, incidentType: p.type, vehicleId: c.user.vehicleId, note: p.note, message: `${c.user.vehicleId}: ${p.type === 'reefer_fault' ? 'refrigeration not holding temperature' : p.type.replace('_', ' ')}` },
      }),
    );
    c.after.push(() => onIncidentReported(p.incidentId));
  },

  async 'plan.ack'(c, p) {
    await c.tx
      .insert(s.deviceSync)
      .values({ userId: c.user.id, lastSyncAt: new Date(), planVersionSeen: p.version })
      .onConflictDoUpdate({ target: s.deviceSync.userId, set: { planVersionSeen: p.version, lastSyncAt: new Date() } });
    c.events.push(
      await recordEvent(c.tx, {
        type: 'plan.acknowledged',
        actor: c.user,
        planVersion: p.version,
        scope: { roles: ['dispatcher'] },
        payload: { version: p.version, vehicleId: c.user.vehicleId, message: `${c.user.name} accepted plan v${p.version}` },
      }),
    );
  },

  async 'receipt.confirm'(c, p) {
    const [order] = await c.tx.select().from(s.orders).where(eq(s.orders.id, p.orderId));
    if (!order || order.outletId !== c.user.outletId) throw new HttpError(404, 'Order not found for your store');
    const inserted = await c.tx
      .insert(s.receipts)
      .values({ id: p.receiptId, orderId: order.id, userId: c.user.id, status: p.status, receivedUnits: p.receivedUnits ?? null, note: p.note ?? null, photoId: p.photoId ?? null })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    if (p.status === 'confirmed') await c.tx.update(s.orders).set({ status: 'received' }).where(eq(s.orders.id, order.id));
    else {
      await c.tx.insert(s.flags).values({
        id: crypto.randomUUID(),
        type: 'receipt_issue',
        orderId: order.id,
        raisedBy: c.user.id,
        role: 'store_manager',
        qty: p.receivedUnits ?? null,
        note: p.note ?? null,
        photoId: p.photoId ?? null,
        deviceTime: c.at,
      });
    }
    c.events.push(
      await recordEvent(c.tx, {
        type: p.status === 'confirmed' ? 'receipt.confirmed' : 'receipt.issue',
        actor: c.user,
        date: order.requestedDate,
        scope: { roles: ['dispatcher'], outletIds: [order.outletId] },
        payload: { orderId: order.id, orderNo: order.orderNo, status: p.status, note: p.note, message: `${order.orderNo} ${p.status === 'confirmed' ? 'receipt confirmed' : 'receipt issue reported'} by ${c.user.name} (${formatDay(order.requestedDate)})` },
      }),
    );
  },
};
