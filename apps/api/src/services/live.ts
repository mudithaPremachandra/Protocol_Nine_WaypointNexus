import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';
import { formatDay } from '../lib/dates';

/**
 * Live operations (D5): each trip's progress and late risk, a stream of exceptions from the dock
 * and the road, and each driver's last sync. "Last synced 22 min ago" is a normal state in the
 * hills, so the board always says when its data was last true.
 */
export async function liveBoard() {
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) return { serviceDate, serviceDay: formatDay(serviceDate), plan: null, trips: [], exceptions: [], feed: [] };

  const trips = await db.select().from(s.trips).where(eq(s.trips.planId, plan.id));
  const stops = trips.length ? await db.select().from(s.stops).where(inArray(s.stops.tripId, trips.map((t) => t.id))) : [];
  const orders = stops.length ? await db.select().from(s.orders).where(inArray(s.orders.id, stops.map((st) => st.orderId))) : [];
  const outlets = new Map((await db.select().from(s.outlets)).map((o) => [o.id, o]));
  const drivers = await db.select().from(s.users).where(and(eq(s.users.role, 'driver'), isNotNull(s.users.vehicleId)));
  const syncs = await db.select().from(s.deviceSync);
  const syncByUser = new Map(syncs.map((x) => [x.userId, x]));

  // Latest phone positions per vehicle in the last 12 hours, newest first (for the map and its trail).
  const positions = trips.length
    ? await db
        .select()
        .from(s.vehiclePositions)
        .where(and(inArray(s.vehiclePositions.vehicleId, [...new Set(trips.map((t) => t.vehicleId))]), gt(s.vehiclePositions.deviceTime, new Date(Date.now() - 12 * 3600_000))))
        .orderBy(desc(s.vehiclePositions.deviceTime))
        .limit(2000)
    : [];
  const trailOf = (vehicleId: string) =>
    positions
      .filter((p) => p.vehicleId === vehicleId)
      .slice(0, 30)
      .map((p) => ({ lat: p.lat, lng: p.lng, at: p.deviceTime, accuracy: p.accuracyM }));

  const tripViews = trips
    .map((t) => {
      const ts = stops.filter((st) => st.tripId === t.id).sort((a, b) => a.seq - b.seq);
      // Named persona accounts (e.g. suresh) before the generic per-vehicle driver.vehNNN account.
      const vehicleDrivers = drivers
        .filter((d) => d.vehicleId === t.vehicleId)
        .sort((a, b) => Number(a.username.startsWith('driver.')) - Number(b.username.startsWith('driver.')));
      // The most recent sync among the vehicle's drivers.
      const sync = vehicleDrivers
        .map((d) => ({ d, sync: syncByUser.get(d.id) }))
        .filter((x) => x.sync)
        .sort((a, b) => b.sync!.lastSyncAt.getTime() - a.sync!.lastSyncAt.getTime())[0];
      const done = ts.filter((st) => st.status !== 'pending');
      const next = ts.find((st) => st.status === 'pending');
      const maxRisk = Math.max(0, ...ts.filter((st) => st.status === 'pending').map((st) => st.lateRisk ?? 0));
      return {
        id: t.id,
        vehicleId: t.vehicleId,
        tripNo: t.tripNo,
        brand: t.brand,
        district: t.district,
        depot: t.depot,
        status: t.status,
        plannedDepart: t.plannedDepart,
        plannedReturn: t.plannedReturn,
        total: ts.length,
        done: done.length,
        failed: ts.filter((st) => st.status === 'failed').length,
        next: next
          ? { orderNo: orders.find((o) => o.id === next.orderId)?.orderNo, outletName: outlets.get(orders.find((o) => o.id === next.orderId)?.outletId ?? '')?.name, plannedArrival: next.plannedArrival, lateRisk: next.lateRisk }
          : null,
        maxLateRisk: Math.round(maxRisk * 100) / 100,
        // Phone GPS trail, newest first (empty if the driver hasn't shared location).
        trail: t.status === 'in_progress' ? trailOf(t.vehicleId) : [],
        // Stop sequence for the map: outlet, status and plan time per stop.
        stops: ts.map((st) => {
          const o = orders.find((x) => x.id === st.orderId);
          return { seq: st.seq, outletId: o?.outletId ?? '', outletName: outlets.get(o?.outletId ?? '')?.name ?? '', orderNo: o?.orderNo ?? '', status: st.status, plannedArrival: st.plannedArrival, lateRisk: st.lateRisk };
        }),
        driver: sync ? { name: sync.d.name, lastSyncAt: sync.sync!.lastSyncAt, pending: sync.sync!.pending } : vehicleDrivers[0] ? { name: vehicleDrivers[0].name, lastSyncAt: null, pending: 0 } : null,
      };
    })
    .sort((a, b) => (a.plannedDepart ?? 0) - (b.plannedDepart ?? 0));

  const [flags, incidents, feed] = await Promise.all([
    db.select().from(s.flags).where(gt(s.flags.receivedAt, new Date(Date.now() - 36 * 3600_000))).orderBy(desc(s.flags.receivedAt)).limit(50),
    db.select().from(s.incidents).orderBy(desc(s.incidents.receivedAt)).limit(10),
    db.select().from(s.events).where(eq(s.events.date, serviceDate)).orderBy(desc(s.events.id)).limit(40),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const flagOrders = flags.filter((f) => f.orderId && !orderById.has(f.orderId)).map((f) => f.orderId!);
  if (flagOrders.length) for (const o of await db.select().from(s.orders).where(inArray(s.orders.id, flagOrders))) orderById.set(o.id, o);

  const exceptions = [
    ...incidents.map((i) => ({
      kind: 'incident' as const,
      id: i.id,
      at: i.receivedAt,
      deviceTime: i.deviceTime,
      severity: 'critical' as const,
      title: i.type === 'reefer_fault' ? `${i.vehicleId}: refrigeration not holding temperature` : `${i.vehicleId}: ${i.type.replace('_', ' ')}`,
      detail: i.note,
      status: i.status,
      chosenOption: i.chosenOption,
    })),
    ...flags.map((f) => {
      const o = f.orderId ? orderById.get(f.orderId) : undefined;
      return {
        kind: 'flag' as const,
        id: f.id,
        at: f.receivedAt,
        deviceTime: f.deviceTime,
        severity: f.type === 'double_serve' || f.type === 'reefer_fault' ? ('critical' as const) : ('warning' as const),
        title: `${labelFlag(f.type)}${o ? `: ${o.orderNo} ${outlets.get(o.outletId)?.name ?? ''}` : ''}`,
        detail: [f.qty != null ? `${f.qty}` : '', f.item ?? '', f.note ?? ''].filter(Boolean).join(' · '),
        status: f.resolvedAt ? 'resolved' : 'open',
        chosenOption: null,
        role: f.role,
        photoId: f.photoId,
      };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { serviceDate, serviceDay: formatDay(serviceDate), plan, trips: tripViews, exceptions, feed, serverTime: new Date().toISOString() };
}

function labelFlag(type: string) {
  return (
    {
      shortfall: 'Loading shortfall',
      damage: 'Damaged at dock',
      reefer_fault: 'Reefer fault',
      delivery_issue: 'Delivery problem',
      receipt_issue: 'Store reported an issue',
      double_serve: 'Possible double-serve',
    }[type] ?? type
  );
}

export async function resolveFlag(flagId: string, userId: string) {
  await db.update(s.flags).set({ resolvedAt: new Date(), resolvedBy: userId }).where(eq(s.flags.id, flagId));
}
