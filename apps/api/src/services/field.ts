import { and, desc, eq, inArray, gte } from 'drizzle-orm';
import { DEFERRAL_REASONS, formatHHMM, type DeferralReason } from '@wn/domain';
import { db } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';
import { formatDay } from '../lib/dates';
import { notFound } from '../lib/errors';
import type { AuthUser } from '../lib/events';

type TripRow = typeof s.trips.$inferSelect;

async function publishedPlan(date: string) {
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, date));
  return plan && plan.status === 'published' ? plan : null;
}

/** Stops with everything a loader or driver needs, in one query batch. */
async function hydrateTrips(trips: TripRow[]) {
  if (!trips.length) return [];
  const stops = await db.select().from(s.stops).where(inArray(s.stops.tripId, trips.map((t) => t.id)));
  const orderIds = stops.map((st) => st.orderId);
  const [orders, lines, products, outlets, flags, deliveries, vehicles] = await Promise.all([
    orderIds.length ? db.select().from(s.orders).where(inArray(s.orders.id, orderIds)) : [],
    orderIds.length ? db.select().from(s.orderLines).where(inArray(s.orderLines.orderId, orderIds)) : [],
    db.select().from(s.products),
    db.select().from(s.outlets),
    orderIds.length ? db.select().from(s.flags).where(inArray(s.flags.orderId, orderIds)) : [],
    orderIds.length ? db.select().from(s.deliveries).where(inArray(s.deliveries.orderId, orderIds)) : [],
    db.select().from(s.vehicles).where(inArray(s.vehicles.id, trips.map((t) => t.vehicleId))),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  return trips
    .map((t) => ({
      id: t.id,
      vehicleId: t.vehicleId,
      vehicle: vehicles.find((v) => v.id === t.vehicleId)!,
      tripNo: t.tripNo,
      brand: t.brand,
      district: t.district,
      depot: t.depot,
      status: t.status,
      plannedDepart: t.plannedDepart,
      plannedReturn: t.plannedReturn,
      minutes: t.minutes,
      km: t.km,
      releasedAt: t.releasedAt,
      stops: stops
        .filter((st) => st.tripId === t.id)
        .sort((a, b) => a.seq - b.seq)
        .map((st) => {
          const o = orders.find((x) => x.id === st.orderId)!;
          const outlet = outletById.get(o.outletId)!;
          return {
            id: st.id,
            seq: st.seq,
            status: st.status,
            plannedArrival: st.plannedArrival,
            lateRisk: st.lateRisk,
            loadedUnits: st.loadedUnits,
            loadCheckedAt: st.loadCheckedAt,
            order: {
              id: o.id,
              orderNo: o.orderNo,
              temp: o.temp,
              units: o.units,
              weightKg: o.weightKg,
              volumeM3: o.volumeM3,
              status: o.status,
              lines: lines
                .filter((l) => l.orderId === o.id)
                .map((l) => ({ productId: l.productId, name: productById.get(l.productId)?.name ?? l.productId, unit: productById.get(l.productId)?.unit ?? 'unit', qty: l.qty })),
            },
            outlet: {
              id: outlet.id,
              name: outlet.name,
              district: outlet.district,
              dockType: outlet.dockType,
              parkingConstraint: outlet.parkingConstraint,
              windowOpen: outlet.windowOpen,
              windowClose: outlet.windowClose,
              mallWindowOpen: outlet.mallWindowOpen,
              mallWindowClose: outlet.mallWindowClose,
              accessNotes: outlet.accessNotes,
            },
            flags: flags.filter((f) => f.orderId === o.id).map((f) => ({ id: f.id, type: f.type, item: f.item, qty: f.qty, note: f.note, role: f.role, photoId: f.photoId })),
            delivery: deliveries.find((d) => d.orderId === o.id) ?? null,
          };
        }),
    }))
    .sort((a, b) => (a.plannedDepart ?? 0) - (b.plannedDepart ?? 0) || a.vehicleId.localeCompare(b.vehicleId));
}

/** Recent plan changes that touched these vehicles, for the "what changed, who, why" on DZ1/X4. */
async function changesFor(date: string, vehicleIds: string[]) {
  const rows = await db
    .select()
    .from(s.events)
    .where(and(eq(s.events.date, date), inArray(s.events.type, ['plan.published', 'plan.changed', 'incident.approved'])))
    .orderBy(desc(s.events.id))
    .limit(50);
  return rows
    .filter((e) => {
      const scope = e.scope as { all?: boolean; vehicleIds?: string[] };
      return scope.all || scope.vehicleIds?.some((v) => vehicleIds.includes(v));
    })
    .map((e) => ({ id: e.id, type: e.type, at: e.at, actorName: e.actorName, planVersion: e.planVersion, payload: e.payload }));
}

/**
 * Everything a driver's phone caches for offline work (Dr1): trips, stops, access notes, the plan
 * version and recent changes. A small full snapshot rather than deltas keeps reconciliation simple.
 */
export async function driverSnapshot(user: AuthUser, vehicleOverride?: string) {
  const { serviceDate } = await getState(db);
  const vehicleId = vehicleOverride ?? user.vehicleId;
  const plan = await publishedPlan(serviceDate);
  const trips = plan && vehicleId ? await db.select().from(s.trips).where(and(eq(s.trips.planId, plan.id), eq(s.trips.vehicleId, vehicleId))) : [];
  const [vehicle] = vehicleId ? await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicleId)) : [];
  const incidents = vehicleId
    ? await db.select().from(s.incidents).where(eq(s.incidents.vehicleId, vehicleId)).orderBy(desc(s.incidents.receivedAt)).limit(5)
    : [];
  return {
    serviceDate,
    serviceDay: formatDay(serviceDate),
    planVersion: plan?.version ?? 0,
    published: !!plan,
    vehicle: vehicle ?? null,
    trips: await hydrateTrips(trips),
    changes: vehicleId ? await changesFor(serviceDate, [vehicleId]) : [],
    incidents,
    serverTime: new Date().toISOString(),
  };
}

/** Dock queue (L1): this depot's trips in departure order with loading progress. */
export async function loaderQueue(user: AuthUser, depotOverride?: string) {
  const { serviceDate } = await getState(db);
  const depot = depotOverride ?? user.depot ?? 'Kandy';
  const plan = await publishedPlan(serviceDate);
  const trips = plan ? await db.select().from(s.trips).where(and(eq(s.trips.planId, plan.id), eq(s.trips.depot, depot))) : [];
  const hydrated = await hydrateTrips(trips);
  const changes = await changesFor(serviceDate, [...new Set(trips.map((t) => t.vehicleId))]);
  const urgent = await db
    .select()
    .from(s.incidents)
    .where(and(eq(s.incidents.status, 'resolved'), gte(s.incidents.approvedAt, new Date(Date.now() - 12 * 3600_000))));
  return {
    serviceDate,
    serviceDay: formatDay(serviceDate),
    depot,
    planVersion: plan?.version ?? 0,
    published: !!plan,
    trips: hydrated,
    changes,
    urgent: urgent.filter((i) => i.chosenOption && i.chosenOption !== 'defer'),
    serverTime: new Date().toISOString(),
  };
}

export async function tripForLoader(tripId: string) {
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  if (!trip) throw notFound('Trip');
  const [hydrated] = await hydrateTrips([trip]);
  return hydrated!;
}

/** Store manager's deliveries (SM2): status, arrival window, deferral notices, proof of delivery. */
export async function storeView(user: AuthUser) {
  const { serviceDate, cutoffClosed } = await getState(db);
  const outletId = user.outletId!;
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.id, outletId));
  const orders = await db.select().from(s.orders).where(eq(s.orders.outletId, outletId)).orderBy(desc(s.orders.placedAt)).limit(30);
  const ids = orders.map((o) => o.id);
  const [stops, deferrals, deliveries, receipts, flags, lines, products, notifications] = await Promise.all([
    ids.length ? db.select().from(s.stops).where(inArray(s.stops.orderId, ids)) : [],
    ids.length ? db.select().from(s.deferrals).where(inArray(s.deferrals.orderId, ids)) : [],
    ids.length ? db.select().from(s.deliveries).where(inArray(s.deliveries.orderId, ids)) : [],
    ids.length ? db.select().from(s.receipts).where(inArray(s.receipts.orderId, ids)) : [],
    ids.length ? db.select().from(s.flags).where(inArray(s.flags.orderId, ids)) : [],
    ids.length ? db.select().from(s.orderLines).where(inArray(s.orderLines.orderId, ids)) : [],
    db.select().from(s.products),
    db.select().from(s.notifications).where(eq(s.notifications.outletId, outletId)).orderBy(desc(s.notifications.createdAt)).limit(20),
  ]);
  const trips = stops.length ? await db.select().from(s.trips).where(inArray(s.trips.id, stops.map((st) => st.tripId))) : [];
  const plan = await publishedPlan(serviceDate);
  const productById = new Map(products.map((p) => [p.id, p]));

  return {
    serviceDate,
    serviceDay: formatDay(serviceDate),
    cutoffClosed,
    outlet,
    notifications,
    orders: orders.map((o) => {
      const stop = stops.find((st) => st.orderId === o.id);
      const trip = stop ? trips.find((t) => t.id === stop.tripId) : undefined;
      const deferral = deferrals.filter((d) => d.orderId === o.id && d.status === 'approved').sort((a, b) => b.date.localeCompare(a.date))[0];
      const eta = plan && stop?.plannedArrival != null ? { from: formatHHMM(stop.plannedArrival - 15), to: formatHHMM(stop.plannedArrival + 15) } : null;
      return {
        ...o,
        lines: lines.filter((l) => l.orderId === o.id).map((l) => ({ ...l, name: productById.get(l.productId)?.name, unit: productById.get(l.productId)?.unit })),
        eta,
        vehicleId: plan ? trip?.vehicleId ?? null : null,
        tripStatus: plan ? trip?.status ?? null : null,
        deferral: deferral
          ? {
              reason: deferral.reason,
              label: DEFERRAL_REASONS[deferral.reason as DeferralReason]?.label,
              storeText: DEFERRAL_REASONS[deferral.reason as DeferralReason]?.storeText,
              deferredTo: deferral.deferredTo,
              deferredToDay: formatDay(deferral.deferredTo),
              fromDay: formatDay(deferral.date),
              note: deferral.note,
            }
          : null,
        delivery: deliveries.find((d) => d.orderId === o.id) ?? null,
        receipt: receipts.find((r) => r.orderId === o.id) ?? null,
        flags: flags.filter((f) => f.orderId === o.id),
      };
    }),
  };
}
