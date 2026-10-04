import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  DEFERRAL_REASONS,
  formatHHMM,
  formatWindow,
  simulateVehicleDay,
  tripFuelL,
  tripKm,
  tripLoad,
  tripMinutes,
  validateVehicleDay,
  type DeferralReason,
  type RuleContext,
  type TripDraft,
  type TripNo,
} from '@wn/domain';
import { buildPlan, checkMove, demandVsCapacity, priorityScore, suggestSwap } from '@wn/planner';
import { db, type DB } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';
import { formatDay, nextOperatingDate } from '../lib/dates';
import { badRequest, conflict, notFound } from '../lib/errors';
import { publish, recordEvent, type AuthUser, type EventRow } from '../lib/events';
import { lateRisk, loadLateRiskInputs, type LateRiskInputs } from '../lib/lateRisk';
import { availableVehicleIds, loadRuleContext, queuedOrders, toPlanOrder, type OrderRow } from '../lib/ruleContext';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/* ------------------------------------------------------------------ */
/* Order intake                                                        */
/* ------------------------------------------------------------------ */

/** 16:00 cutoff: every confirmed order for the service date joins one queue (D1). */
export async function closeOrders(user: AuthUser) {
  const { serviceDate } = await getState(db);
  const events: EventRow[] = [];
  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(s.orders)
      .set({ status: 'queued' })
      .where(and(eq(s.orders.requestedDate, serviceDate), eq(s.orders.status, 'placed')))
      .returning({ id: s.orders.id });
    await tx.insert(s.appState).values({ key: 'cutoffClosed', value: true }).onConflictDoUpdate({ target: s.appState.key, set: { value: true } });
    events.push(
      await recordEvent(tx, {
        type: 'orders.closed',
        actor: user,
        date: serviceDate,
        scope: { all: true },
        payload: { count: rows.length, message: `Orders for ${formatDay(serviceDate)} closed: ${rows.length} in the queue` },
      }),
    );
    return rows.length;
  });
  publish(...events);
  return { queued: moved };
}

/* ------------------------------------------------------------------ */
/* Plan generation and persistence                                     */
/* ------------------------------------------------------------------ */

export async function generatePlan(user: AuthUser) {
  const { serviceDate, cutoffClosed } = await getState(db);
  if (!cutoffClosed) throw badRequest('Close orders before planning: the queue is still open to stores.');
  const [existing] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (existing?.status === 'published') {
    throw conflict('Today’s plan is already published. Adjust trips with moves instead of re-planning.');
  }

  const orders = await queuedOrders(db, serviceDate);
  const ctx = await loadRuleContext(db, serviceDate, orders);
  const vehicleIds = await availableVehicleIds(db);
  const t0 = performance.now();
  const plan = buildPlan({ ctx, orderIds: orders.map((o) => o.id), vehicleIds });
  const ms = Math.round(performance.now() - t0);
  const risk = await loadLateRiskInputs(db, serviceDate);
  const deferredTo = await nextOperatingDate(db, serviceDate);

  const events: EventRow[] = [];
  const planId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.plans)
      .values({ date: serviceDate, status: 'draft', createdBy: user.id, bottleneck: plan.bottleneck, stats: { ...plan.stats, ms } })
      .onConflictDoUpdate({
        target: s.plans.date,
        set: { status: 'draft', bottleneck: plan.bottleneck, stats: { ...plan.stats, ms }, createdBy: user.id, createdAt: new Date() },
      })
      .returning();
    const planRow = row!;

    const oldTrips = await tx.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.planId, planRow.id));
    if (oldTrips.length) await tx.delete(s.stops).where(inArray(s.stops.tripId, oldTrips.map((t) => t.id)));
    await tx.delete(s.trips).where(eq(s.trips.planId, planRow.id));
    await tx.delete(s.deferrals).where(and(eq(s.deferrals.date, serviceDate), eq(s.deferrals.status, 'proposed')));

    await writeVehicleTrips(tx, planRow.id, ctx, risk, groupByVehicle(plan.trips));

    if (plan.deferred.length) {
      await tx.insert(s.deferrals).values(
        plan.deferred.map((d) => ({
          orderId: d.orderId,
          date: serviceDate,
          reason: d.reason,
          rule: d.rule,
          detail: d.detail,
          repeatSkip: d.repeatSkip,
          deferredTo,
          status: 'proposed',
        })),
      );
    }
    const served = plan.trips.flatMap((t) => t.orderIds);
    if (served.length) await tx.update(s.orders).set({ status: 'planned' }).where(inArray(s.orders.id, served));
    const deferredIds = plan.deferred.map((d) => d.orderId);
    if (deferredIds.length) await tx.update(s.orders).set({ status: 'deferred' }).where(inArray(s.orders.id, deferredIds));

    events.push(
      await recordEvent(tx, {
        type: 'plan.generated',
        actor: user,
        date: serviceDate,
        scope: { roles: ['dispatcher'] },
        payload: { ...plan.stats, ms, headline: plan.bottleneck.headline, message: `Plan built in ${ms} ms: ${plan.stats.served} of ${plan.stats.orders} orders on ${plan.stats.trips} trips, ${plan.stats.deferred} deferred` },
      }),
    );
    return planRow.id;
  });
  publish(...events);
  return { planId, stats: { ...plan.stats, ms }, bottleneck: plan.bottleneck };
}

function groupByVehicle(trips: readonly TripDraft[]): Map<string, TripDraft[]> {
  const m = new Map<string, TripDraft[]>();
  for (const t of trips) m.set(t.vehicleId, [...(m.get(t.vehicleId) ?? []), t]);
  return m;
}

/**
 * (Re)writes the trips and stops for the given vehicles. Trip rows are matched on
 * (plan, vehicle, trip number) and stop rows on order id, so ids that phones and tablets already
 * hold stay stable, and loading progress survives a re-plan.
 */
async function writeVehicleTrips(
  tx: Tx,
  planId: string,
  ctx: RuleContext,
  risk: LateRiskInputs,
  byVehicle: Map<string, TripDraft[]>,
) {
  const vehicleIds = [...byVehicle.keys()];
  if (vehicleIds.length === 0) return;
  const existing = await tx
    .select()
    .from(s.trips)
    .where(and(eq(s.trips.planId, planId), inArray(s.trips.vehicleId, vehicleIds)));
  const existingStops = existing.length
    ? await tx.select().from(s.stops).where(inArray(s.stops.tripId, existing.map((t) => t.id)))
    : [];
  const stopByOrder = new Map(existingStops.map((st) => [st.orderId, st]));
  // Orders that may have been on another vehicle's trip before this write.
  const allOrderIds = [...byVehicle.values()].flat().flatMap((t) => t.orderIds);
  if (allOrderIds.length) {
    for (const st of await tx.select().from(s.stops).where(inArray(s.stops.orderId, allOrderIds))) stopByOrder.set(st.orderId, st);
    await tx.delete(s.stops).where(inArray(s.stops.orderId, allOrderIds));
  }
  if (existing.length) await tx.delete(s.stops).where(inArray(s.stops.tripId, existing.map((t) => t.id)));

  for (const [vehicleId, trips] of byVehicle) {
    const active = trips.filter((t) => t.orderIds.length > 0);
    const dayChecks = validateVehicleDay(ctx, vehicleId, active);
    const timings = simulateVehicleDay(ctx, active);
    const keep = new Set<string>();

    for (const trip of active) {
      const timing = timings.find((t) => t.tripNo === trip.tripNo)!;
      const travel = ctx.travel.get(trip.district)!;
      const values = {
        planId,
        vehicleId,
        tripNo: trip.tripNo,
        brand: trip.brand,
        district: trip.district,
        depot: trip.depot,
        plannedDepart: timing.depart,
        plannedReturn: timing.returnAt,
        minutes: tripMinutes(ctx, trip).total,
        km: Math.round(tripKm(travel, trip.orderIds.length) * 10) / 10,
        fuelL: Math.round(tripFuelL(ctx, trip) * 10) / 10,
        checks: dayChecks.filter((c) => c.tripNo === undefined || c.tripNo === trip.tripNo),
      };
      const prior = existing.find((e) => e.vehicleId === vehicleId && e.tripNo === trip.tripNo);
      let tripId: string;
      if (prior) {
        await tx.update(s.trips).set(values).where(eq(s.trips.id, prior.id));
        tripId = prior.id;
      } else {
        const [row] = await tx.insert(s.trips).values(values).returning({ id: s.trips.id });
        tripId = row!.id;
      }
      keep.add(tripId);

      await tx.insert(s.stops).values(
        timing.stops.map((st) => {
          const prev = stopByOrder.get(st.orderId);
          return {
            tripId,
            orderId: st.orderId,
            seq: st.seq,
            // When unloading can start: an early vehicle waits for the window, so this is what the store plans staff around.
            plannedArrival: st.serviceStart,
            lateRisk: lateRisk(risk, trip.district, travel.depotToDistrictMin, st.arrive, st.window?.close ?? null, st.seq),
            status: prev?.status ?? 'pending',
            loadedUnits: prev?.loadedUnits ?? null,
            loadCheckedAt: prev?.loadCheckedAt ?? null,
          };
        }),
      );
    }
    const drop = existing.filter((e) => e.vehicleId === vehicleId && !keep.has(e.id));
    if (drop.length) await tx.delete(s.trips).where(inArray(s.trips.id, drop.map((d) => d.id)));
  }
}

/* ------------------------------------------------------------------ */
/* Reading the plan                                                    */
/* ------------------------------------------------------------------ */

export async function currentTripsFor(planId: string): Promise<TripDraft[]> {
  const trips = await db.select().from(s.trips).where(eq(s.trips.planId, planId));
  if (!trips.length) return [];
  const stops = await db.select().from(s.stops).where(inArray(s.stops.tripId, trips.map((t) => t.id)));
  return trips.map((t) => ({
    vehicleId: t.vehicleId,
    tripNo: t.tripNo as TripNo,
    brand: t.brand as TripDraft['brand'],
    district: t.district,
    depot: t.depot as TripDraft['depot'],
    orderIds: stops.filter((st) => st.tripId === t.id).sort((a, b) => a.seq - b.seq).map((st) => st.orderId),
  }));
}

/** Everything the plan board (D2) and deferral review (D4) need, in one round trip. */
export async function planView() {
  const { serviceDate, cutoffClosed } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  const [vehicleRows, outletRows, orders] = await Promise.all([
    db.select().from(s.vehicles),
    db.select().from(s.outlets),
    db.select().from(s.orders).where(eq(s.orders.requestedDate, serviceDate)),
  ]);
  const outlets = new Map(outletRows.map((o) => [o.id, o]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const ctx = await loadRuleContext(db, serviceDate, orders.filter((o) => o.status !== 'placed'));
  const vehicleIds = vehicleRows.filter((v) => v.status === 'available').map((v) => v.id);
  const queue = orders.filter((o) => !['placed', 'cancelled'].includes(o.status));
  const resources = demandVsCapacity(ctx, queue.map(toPlanOrder), vehicleIds);

  if (!plan) return { serviceDate, cutoffClosed, plan: null, trips: [], deferrals: [], resources, vehicles: vehicleRows };

  const trips = await db.select().from(s.trips).where(eq(s.trips.planId, plan.id));
  const stops = trips.length ? await db.select().from(s.stops).where(inArray(s.stops.tripId, trips.map((t) => t.id))) : [];
  const deferrals = await db.select().from(s.deferrals).where(eq(s.deferrals.date, serviceDate));

  const tripViews = trips
    .map((t) => {
      const vehicle = vehicleRows.find((v) => v.id === t.vehicleId)!;
      const tStops = stops.filter((st) => st.tripId === t.id).sort((a, b) => a.seq - b.seq);
      const load = tripLoad(ctx, tStops.map((st) => st.orderId).filter((id) => ctx.orders.has(id)));
      return {
        ...t,
        vehicle,
        load,
        stops: tStops.map((st) => {
          const o = orderById.get(st.orderId)!;
          const outlet = outlets.get(o.outletId)!;
          return { ...st, order: o, outlet: { id: outlet.id, name: outlet.name, dockType: outlet.dockType, parkingConstraint: outlet.parkingConstraint, windowOpen: outlet.windowOpen, windowClose: outlet.windowClose, mallWindowOpen: outlet.mallWindowOpen, mallWindowClose: outlet.mallWindowClose } };
        }),
      };
    })
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);

  const currentTrips = await currentTripsFor(plan.id);
  const deferralViews = deferrals
    .filter((d) => orderById.has(d.orderId))
    .map((d) => {
      const o = orderById.get(d.orderId)!;
      const outlet = outlets.get(o.outletId)!;
      const stillDeferred = o.status === 'deferred';
      const swap =
        stillDeferred && d.repeatSkip && d.status === 'proposed' && ctx.orders.has(o.id)
          ? suggestSwap(ctx, vehicleIds, currentTrips, o.id, (id) => priorityScore(ctx.orders.get(id)!))
          : null;
      return {
        ...d,
        order: o,
        outlet: { id: outlet.id, name: outlet.name, district: outlet.district, brand: outlet.brand },
        reasonLabel: DEFERRAL_REASONS[d.reason as DeferralReason]?.label ?? d.reason,
        priority: ctx.orders.has(o.id) ? priorityScore(ctx.orders.get(o.id)!) : null,
        lastServedDaysAgo: o.daysSinceLastServed,
        swap: swap ? { ...swap, victim: orderById.get(swap.victimOrderId) ?? null, victimOutlet: outlets.get(orderById.get(swap.victimOrderId)?.outletId ?? '')?.name ?? null } : null,
      };
    })
    .filter((d) => d.date === serviceDate);

  return { serviceDate, cutoffClosed, plan, trips: tripViews, deferrals: deferralViews, resources, vehicles: vehicleRows };
}

/** Trip check (D3): every rule with real numbers, and how the trip time is built. */
export async function tripCheck(tripId: string) {
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  if (!trip) throw notFound('Trip');
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.id, trip.planId));
  const orders = await db.select().from(s.orders).where(eq(s.orders.requestedDate, plan!.date));
  const ctx = await loadRuleContext(db, plan!.date, orders);
  const all = await currentTripsFor(trip.planId);
  const vehicleTrips = all.filter((t) => t.vehicleId === trip.vehicleId);
  const draft = vehicleTrips.find((t) => t.tripNo === trip.tripNo)!;
  const checks = validateVehicleDay(ctx, trip.vehicleId, vehicleTrips).filter((c) => c.tripNo === undefined || c.tripNo === trip.tripNo);
  const timing = simulateVehicleDay(ctx, vehicleTrips).find((t) => t.tripNo === trip.tripNo)!;
  const breakdown = tripMinutes(ctx, draft);
  const outlets = new Map((await db.select().from(s.outlets)).map((o) => [o.id, o]));
  return {
    trip,
    vehicle: ctx.vehicles.get(trip.vehicleId),
    checks,
    breakdown,
    stops: timing.stops.map((st) => {
      const o = ctx.orders.get(st.orderId)!;
      return {
        ...st,
        orderNo: o.orderNo,
        outletName: outlets.get(o.outletId)?.name,
        temp: o.temp,
        units: o.units,
        weightKg: o.weightKg,
        volumeM3: o.volumeM3,
        arriveText: formatHHMM(st.arrive),
        windowText: st.window ? formatWindow(st.window) : 'no overlap',
      };
    }),
    timing: { depart: formatHHMM(timing.depart), return: formatHHMM(timing.returnAt) },
  };
}

/* ------------------------------------------------------------------ */
/* Dispatcher adjustments                                              */
/* ------------------------------------------------------------------ */

interface MoveInput {
  orderId: string;
  vehicleId: string;
  tripNo?: number;
  apply: boolean;
}

/** Validates (and optionally applies) a manual move, D3B. Blocked moves name the rule and suggest alternatives. */
export async function moveOrder(user: AuthUser, input: MoveInput) {
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) throw badRequest('Generate a plan first');
  const orders = await queuedOrdersWithStatus(serviceDate);
  const order = orders.find((o) => o.id === input.orderId);
  if (!order) throw notFound('Order');
  if (['delivered', 'partial', 'failed', 'received'].includes(order.status)) throw conflict('That order has already been delivered');
  const ctx = await loadRuleContext(db, serviceDate, orders);
  const vehicleIds = await availableVehicleIds(db);
  const trips = await currentTripsFor(plan.id);
  const result = checkMove(ctx, vehicleIds, trips, input.orderId, { vehicleId: input.vehicleId, tripNo: input.tripNo });

  if (!result.ok || !input.apply) return { ...result, applied: false };

  const sourceVehicle = trips.find((t) => t.orderIds.includes(input.orderId))?.vehicleId;
  const byVehicle = new Map<string, TripDraft[]>();
  byVehicle.set(input.vehicleId, result.trips!);
  if (sourceVehicle && sourceVehicle !== input.vehicleId) {
    byVehicle.set(
      sourceVehicle,
      trips.filter((t) => t.vehicleId === sourceVehicle).map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== input.orderId) })),
    );
  }
  await applyPlanChange(user, plan, ctx, byVehicle, {
    servedOrderIds: [input.orderId],
    deferOrders: [],
    message: `${order.orderNo} moved to ${input.vehicleId}`,
    affectedVehicles: [...byVehicle.keys()],
    affectedOutlets: [order.outletId],
  });
  return { ...result, applied: true };
}

/** Moves a served order to the next run with a recorded reason (dispatcher's choice). */
export async function deferOrder(user: AuthUser, orderId: string, note: string | null, reason: DeferralReason = 'DISPATCHER_CHOICE') {
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) throw badRequest('Generate a plan first');
  const orders = await queuedOrdersWithStatus(serviceDate);
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw notFound('Order');
  const ctx = await loadRuleContext(db, serviceDate, orders);
  const trips = await currentTripsFor(plan.id);
  const source = trips.find((t) => t.orderIds.includes(orderId));
  const byVehicle = new Map<string, TripDraft[]>();
  if (source) {
    byVehicle.set(
      source.vehicleId,
      trips.filter((t) => t.vehicleId === source.vehicleId).map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== orderId) })),
    );
  }
  await applyPlanChange(user, plan, ctx, byVehicle, {
    servedOrderIds: [],
    deferOrders: [{ order, reason, note }],
    message: `${order.orderNo} (${order.outletId}) moved to the next run${note ? `. ${note}` : `: ${DEFERRAL_REASONS[reason].label.toLowerCase()}`}`,
    affectedVehicles: source ? [source.vehicleId] : [],
    affectedOutlets: [order.outletId],
  });
  return { ok: true };
}

/** Applies the swap proposed on D4: the repeat-skip order is served, the lower-impact order waits. */
export async function applySwap(user: AuthUser, orderId: string, victimOrderId: string) {
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) throw badRequest('Generate a plan first');
  const orders = await queuedOrdersWithStatus(serviceDate);
  const ctx = await loadRuleContext(db, serviceDate, orders);
  const vehicleIds = await availableVehicleIds(db);
  const trips = await currentTripsFor(plan.id);
  const swap = suggestSwap(ctx, vehicleIds, trips, orderId, (id) => priorityScore(ctx.orders.get(id)!));
  if (!swap || swap.victimOrderId !== victimOrderId) throw conflict('That swap is no longer possible; the plan has changed.');

  const order = orders.find((o) => o.id === orderId)!;
  const victim = orders.find((o) => o.id === victimOrderId)!;
  const vehicleTrips = trips
    .filter((t) => t.vehicleId === swap.vehicleId)
    .map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== victimOrderId) }));
  const after = checkMove(ctx, vehicleIds, [...trips.filter((t) => t.vehicleId !== swap.vehicleId), ...vehicleTrips], orderId, {
    vehicleId: swap.vehicleId,
    tripNo: swap.tripNo,
  });
  if (!after.ok) throw conflict('That swap is no longer possible; the plan has changed.');

  await applyPlanChange(user, plan, ctx, new Map([[swap.vehicleId, after.trips!]]), {
    servedOrderIds: [orderId],
    deferOrders: [{ order: victim, reason: 'DISPATCHER_CHOICE', note: `Swapped for ${order.orderNo}, skipped on the previous run` }],
    message: `${order.orderNo} served instead of ${victim.orderNo} (repeat skip)`,
    affectedVehicles: [swap.vehicleId],
    affectedOutlets: [order.outletId, victim.outletId],
  });
  return { ok: true };
}

export async function queuedOrdersWithStatus(date: string): Promise<OrderRow[]> {
  return db
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.requestedDate, date), ne(s.orders.status, 'placed'), ne(s.orders.status, 'cancelled')));
}

export interface PlanChange {
  servedOrderIds: string[];
  deferOrders: { order: OrderRow; reason: DeferralReason; note: string | null }[];
  message: string;
  affectedVehicles: string[];
  affectedOutlets: string[];
}

/**
 * One path for every change to a plan. On a published plan it bumps the version, so phones that
 * were offline see "plan changed while you were offline" (DZ1), and it tells the affected
 * loader, drivers and stores.
 */
export async function applyPlanChange(
  user: AuthUser,
  plan: typeof s.plans.$inferSelect,
  ctx: RuleContext,
  byVehicle: Map<string, TripDraft[]>,
  change: PlanChange,
  hooks: { afterWrite?: (tx: Tx, version: number) => Promise<void>; eventType?: string; eventPayload?: Record<string, unknown> } = {},
) {
  const risk = await loadLateRiskInputs(db, plan.date);
  const deferredTo = await nextOperatingDate(db, plan.date);
  const published = plan.status === 'published';
  const events: EventRow[] = [];

  await db.transaction(async (tx) => {
    await writeVehicleTrips(tx, plan.id, ctx, risk, byVehicle);
    if (change.servedOrderIds.length) {
      await tx.update(s.orders).set({ status: 'planned' }).where(inArray(s.orders.id, change.servedOrderIds));
      await tx.delete(s.deferrals).where(and(inArray(s.deferrals.orderId, change.servedOrderIds), eq(s.deferrals.date, plan.date)));
    }
    for (const d of change.deferOrders) {
      await tx.update(s.orders).set({ status: 'deferred' }).where(eq(s.orders.id, d.order.id));
      await tx
        .insert(s.deferrals)
        .values({
          orderId: d.order.id,
          date: plan.date,
          reason: d.reason,
          detail: `${DEFERRAL_REASONS[d.reason].label}.${d.note ? ` ${d.note}.` : ''}`,
          note: d.note,
          repeatSkip: d.order.deferredYesterday,
          deferredTo,
          status: published ? 'approved' : 'proposed',
          approvedBy: published ? user.id : null,
          approvedAt: published ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [s.deferrals.orderId, s.deferrals.date],
          set: { reason: d.reason, note: d.note, detail: `${DEFERRAL_REASONS[d.reason].label}.${d.note ? ` ${d.note}.` : ''}` },
        });
      if (published) await notifyDeferral(tx, d.order, d.reason, deferredTo);
    }
    let version = plan.version;
    if (published) {
      version = plan.version + 1;
      await tx.update(s.plans).set({ version }).where(eq(s.plans.id, plan.id));
    }
    await hooks.afterWrite?.(tx, version);
    events.push(
      await recordEvent(tx, {
        type: hooks.eventType ?? 'plan.changed',
        actor: user,
        date: plan.date,
        planVersion: version,
        scope: {
          roles: ['dispatcher'],
          vehicleIds: published ? change.affectedVehicles : [],
          depots: published ? [...new Set(change.affectedVehicles.map((v) => ctx.vehicles.get(v)?.depot ?? ''))] : [],
          outletIds: published ? change.affectedOutlets : [],
        },
        payload: { message: change.message, published, vehicles: change.affectedVehicles, ...hooks.eventPayload },
      }),
    );
  });
  publish(...events);
}

export async function notifyDeferral(tx: Tx, order: OrderRow, reason: DeferralReason, deferredTo: string) {
  await tx.insert(s.notifications).values({
    outletId: order.outletId,
    orderId: order.id,
    type: 'deferred',
    title: `${order.orderNo} moved to ${formatDay(deferredTo)}`,
    body: `${DEFERRAL_REASONS[reason].storeText} It is first in line for ${formatDay(deferredTo)}'s run.`,
  });
}

/** Approve every proposed deferral and notify each affected store in one action (D4). */
export async function approveDeferrals(user: AuthUser) {
  const { serviceDate } = await getState(db);
  const events: EventRow[] = [];
  const count = await db.transaction(async (tx) => {
    const proposed = await tx
      .select()
      .from(s.deferrals)
      .where(and(eq(s.deferrals.date, serviceDate), eq(s.deferrals.status, 'proposed')));
    if (!proposed.length) return 0;
    const orders = await tx.select().from(s.orders).where(inArray(s.orders.id, proposed.map((d) => d.orderId)));
    await tx
      .update(s.deferrals)
      .set({ status: 'approved', approvedBy: user.id, approvedAt: new Date() })
      .where(inArray(s.deferrals.id, proposed.map((d) => d.id)));
    for (const d of proposed) {
      const o = orders.find((x) => x.id === d.orderId);
      if (o) await notifyDeferral(tx, o, d.reason as DeferralReason, d.deferredTo);
    }
    events.push(
      await recordEvent(tx, {
        type: 'deferrals.approved',
        actor: user,
        date: serviceDate,
        scope: { roles: ['dispatcher'], outletIds: orders.map((o) => o.outletId) },
        payload: { count: proposed.length, message: `${proposed.length} deferrals approved; stores notified` },
      }),
    );
    return proposed.length;
  });
  publish(...events);
  return { approved: count };
}

/** Publishing sends the plan to every dock tablet and driver phone, and arrival windows to stores. */
export async function publishPlan(user: AuthUser) {
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) throw badRequest('Generate a plan first');
  await approveDeferrals(user);

  const events: EventRow[] = [];
  const version = plan.version + 1;
  await db.transaction(async (tx) => {
    await tx.update(s.plans).set({ status: 'published', version, publishedAt: new Date() }).where(eq(s.plans.id, plan.id));
    const trips = await tx.select().from(s.trips).where(eq(s.trips.planId, plan.id));
    const stops = trips.length ? await tx.select().from(s.stops).where(inArray(s.stops.tripId, trips.map((t) => t.id))) : [];
    const orders = stops.length ? await tx.select().from(s.orders).where(inArray(s.orders.id, stops.map((st) => st.orderId))) : [];
    if (plan.version === 0 && stops.length) {
      await tx.insert(s.notifications).values(
        stops.map((st) => {
          const o = orders.find((x) => x.id === st.orderId)!;
          const trip = trips.find((t) => t.id === st.tripId)!;
          const eta = st.plannedArrival ?? 0;
          return {
            outletId: o.outletId,
            orderId: o.id,
            type: 'eta',
            title: `${o.orderNo} scheduled for ${formatDay(serviceDate)}`,
            body: `Expected ${formatHHMM(eta - 15)}–${formatHHMM(eta + 15)} on ${trip.vehicleId}. Have staff ready to receive.`,
          };
        }),
      );
    }
    events.push(
      await recordEvent(tx, {
        type: 'plan.published',
        actor: user,
        date: serviceDate,
        planVersion: version,
        scope: { all: true },
        payload: { version, trips: trips.length, message: `Plan v${version} for ${formatDay(serviceDate)} published: ${trips.length} trips` },
      }),
    );
  });
  publish(...events);
  return { version };
}

