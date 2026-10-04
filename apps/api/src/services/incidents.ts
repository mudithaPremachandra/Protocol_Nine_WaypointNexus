import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  BUDGETS,
  budgetFamily,
  effectiveWindow,
  failing,
  formatHHMM,
  formatWindow,
  RULE_LABELS,
  serviceMinutes,
  tripMinutes,
  validateTrip,
  type RuleContext,
  type TripDraft,
  type TripNo,
} from '@wn/domain';
import { db } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';
import { badRequest, conflict, notFound } from '../lib/errors';
import { emit, type AuthUser } from '../lib/events';
import { availableVehicleIds, loadRuleContext } from '../lib/ruleContext';
import { applyPlanChange, currentTripsFor, queuedOrdersWithStatus } from './planning';

/** Minutes to move cases between two refrigerated vehicles at a meeting point. */
const TRANSFER_MIN = 15;
/** Minutes to reload a vehicle at the depot. */
const RELOAD_MIN = 20;

export interface RecoveryStop {
  orderId: string;
  orderNo: string;
  outletName: string;
  arrive: string;
  window: string;
  lateMin: number;
}

export interface RecoveryOption {
  key: string;
  kind: 'rescue' | 'reload' | 'defer';
  vehicleId: string | null;
  label: string;
  onTime: number;
  late: number;
  lateMinutes: number;
  deferred: number;
  verdict: 'recommended' | 'allowed' | 'ruled_out';
  reason: string | null;
  depart: string | null;
  stops: RecoveryStop[];
}

interface Situation {
  incident: typeof s.incidents.$inferSelect;
  ctx: RuleContext;
  trips: TripDraft[];
  failedTrip: TripDraft;
  affected: string[];
  /** Where the failed vehicle is in its plan, in minutes since midnight. */
  now: number;
  depot: string;
}

/**
 * The demo runs outside real operating hours, so "now" is taken from the failed vehicle's position
 * in its plan: the planned arrival at its next pending stop, less the travel to get there.
 */
async function situation(incidentId: string): Promise<Situation | null> {
  const [incident] = await db.select().from(s.incidents).where(eq(s.incidents.id, incidentId));
  if (!incident) throw notFound('Incident');
  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  if (!plan) return null;
  const orders = await queuedOrdersWithStatus(serviceDate);
  const ctx = await loadRuleContext(db, serviceDate, orders);
  const trips = await currentTripsFor(plan.id);
  const tripRows = await db.select().from(s.trips).where(and(eq(s.trips.planId, plan.id), eq(s.trips.vehicleId, incident.vehicleId)));
  const stops = tripRows.length ? await db.select().from(s.stops).where(inArray(s.stops.tripId, tripRows.map((t) => t.id))) : [];
  const pendingChilled = stops
    .filter((st) => st.status === 'pending' && ctx.orders.get(st.orderId)?.temp === 'chilled')
    .sort((a, b) => (a.plannedArrival ?? 0) - (b.plannedArrival ?? 0));
  if (!pendingChilled.length) return null;
  const tripRow = tripRows.find((t) => t.id === pendingChilled[0]!.tripId)!;
  const failedTrip = trips.find((t) => t.vehicleId === incident.vehicleId && t.tripNo === tripRow.tripNo)!;
  const affected = pendingChilled.filter((st) => st.tripId === tripRow.id).map((st) => st.orderId);
  const travel = ctx.travel.get(failedTrip.district)!;
  const firstPending = pendingChilled[0]!;
  const now = (firstPending.plannedArrival ?? tripRow.plannedDepart ?? 330) - (firstPending.seq > 0 ? travel.interStopMin : travel.depotToDistrictMin / 2);
  return { incident, ctx, trips, failedTrip, affected, now: Math.round(now), depot: tripRow.depot };
}

function simulate(ctx: RuleContext, brand: TripDraft['brand'], district: string, orderIds: string[], firstArrival: number): RecoveryStop[] {
  const travel = ctx.travel.get(district)!;
  let t = firstArrival;
  let prevOutlet: string | null = null;
  return orderIds.map((id, i) => {
    const o = ctx.orders.get(id)!;
    if (i > 0 && o.outletId !== prevOutlet) t += travel.interStopMin;
    prevOutlet = o.outletId;
    const w = effectiveWindow(ctx, o.outletId);
    const arrive = t;
    t = (w ? Math.max(arrive, w.open) : arrive) + serviceMinutes(ctx, brand, o.outletId);
    return {
      orderId: id,
      orderNo: o.orderNo,
      outletName: ctx.outlets.get(o.outletId)?.name ?? o.outletId,
      arrive: formatHHMM(arrive),
      window: w ? formatWindow(w) : '—',
      lateMin: w ? Math.max(0, arrive - w.close) : 0,
    };
  });
}

/** Recovery options for a reefer fault, each checked against capacity, budgets and windows (X2). */
export async function recoveryOptions(incidentId: string): Promise<{ options: RecoveryOption[]; now: string; affected: RecoveryStop[] } | null> {
  const sit = await situation(incidentId);
  if (!sit) return null;
  const { ctx, trips, failedTrip, affected, now, depot, incident } = sit;
  const travel = ctx.travel.get(failedTrip.district)!;
  const available = new Set(await availableVehicleIds(db));
  const options: RecoveryOption[] = [];

  const candidates = [...ctx.vehicles.values()].filter(
    (v) => v.depot === depot && v.temp === 'reefer' && v.id !== incident.vehicleId && available.has(v.id),
  );

  for (const v of candidates) {
    const own = trips.filter((t) => t.vehicleId === v.id);
    const draft: TripDraft = { vehicleId: v.id, tripNo: (own.length + 1) as TripNo, brand: failedTrip.brand, district: failedTrip.district, depot: failedTrip.depot, orderIds: affected };
    const base: Omit<RecoveryOption, 'onTime' | 'late' | 'lateMinutes' | 'verdict' | 'reason' | 'stops' | 'depart' | 'kind' | 'label'> = { key: v.id, vehicleId: v.id, deferred: 0 };

    // When is this vehicle free? After its own planned trips return, or now if it has none left.
    const lastReturn = own.length ? Math.max(...own.map((t) => plannedReturn(ctx, trips, t))) : now;
    const idle = lastReturn <= now;
    const kind: 'rescue' | 'reload' = idle ? 'rescue' : 'reload';
    const depart = idle ? now + 10 : Math.max(lastReturn, now + travel.depotToDistrictMin) + RELOAD_MIN;
    const firstArrival = depart + travel.depotToDistrictMin + (kind === 'rescue' ? TRANSFER_MIN : 0);
    const stops = simulate(ctx, draft.brand, draft.district, affected, firstArrival);
    const late = stops.filter((st) => st.lateMin > 0);
    const label = kind === 'rescue' ? `Rescue with ${v.type === 'van' ? 'reefer van' : 'reefer'} ${v.id}` : `Reload onto ${v.id} at ${depot}`;

    const family = budgetFamily(draft.brand);
    const used = own.filter((t) => budgetFamily(t.brand) === family).reduce((sum, t) => sum + tripMinutes(ctx, t).total, 0);
    const extra = tripMinutes(ctx, draft).total + (kind === 'rescue' ? TRANSFER_MIN : 0);
    const loadFails = failing(validateTrip(ctx, draft));

    let reason: string | null = null;
    if (own.length >= 2) reason = `${v.id} is already on two trips`;
    else if (loadFails.length) reason = `${RULE_LABELS[loadFails[0]!.rule]}: ${loadFails[0]!.message}`;
    else if (used + extra > BUDGETS[family].minutes) reason = `${used + extra} / ${BUDGETS[family].minutes} ${BUDGETS[family].label} min`;

    options.push({
      ...base,
      kind,
      label,
      onTime: stops.length - late.length,
      late: late.length,
      lateMinutes: late.reduce((sum, st) => sum + st.lateMin, 0),
      verdict: reason ? 'ruled_out' : 'allowed',
      reason,
      depart: formatHHMM(depart),
      stops,
    });
  }

  const valid = options.filter((o) => o.verdict !== 'ruled_out').sort((a, b) => a.late - b.late || a.lateMinutes - b.lateMinutes || (a.depart ?? '').localeCompare(b.depart ?? ''));
  const ruledOut = options.filter((o) => o.verdict === 'ruled_out').sort((a, b) => b.onTime - a.onTime);
  if (valid[0]) valid[0].verdict = 'recommended';

  const deferOption: RecoveryOption = {
    key: 'defer',
    kind: 'defer',
    vehicleId: null,
    label: 'Defer chilled stops to the next run',
    onTime: 0,
    late: 0,
    lateMinutes: 0,
    deferred: affected.length,
    verdict: valid.length ? 'allowed' : 'recommended',
    reason: null,
    depart: null,
    stops: [],
  };

  // The stops at risk, with their windows, for the left side of X2.
  const affectedStops = simulate(ctx, failedTrip.brand, failedTrip.district, affected, now);
  return { options: [...valid.slice(0, 2), deferOption, ...ruledOut.slice(0, 1)], now: formatHHMM(now), affected: affectedStops };
}

function plannedReturn(ctx: RuleContext, all: TripDraft[], trip: TripDraft): number {
  // Planned return is stored on the trip row; recomputing keeps this pure for the options view.
  const travel = ctx.travel.get(trip.district)!;
  const sameVehicle = all.filter((t) => t.vehicleId === trip.vehicleId && t.tripNo <= trip.tripNo);
  let t = BUDGETS[budgetFamily(trip.brand)].start;
  for (const tr of sameVehicle) t += tripMinutes(ctx, tr).total + travel.depotToDistrictMin;
  return t;
}

export async function onIncidentReported(incidentId: string) {
  const result = await recoveryOptions(incidentId);
  await db.update(s.incidents).set({ options: result }).where(eq(s.incidents.id, incidentId));
}

export async function listIncidents() {
  return db.select().from(s.incidents).orderBy(desc(s.incidents.receivedAt)).limit(20);
}

export async function incidentView(incidentId: string) {
  const [incident] = await db.select().from(s.incidents).where(eq(s.incidents.id, incidentId));
  if (!incident) throw notFound('Incident');
  const live = incident.status === 'open' ? await recoveryOptions(incidentId) : (incident.options as Awaited<ReturnType<typeof recoveryOptions>>);
  const [reporter] = incident.reportedBy ? await db.select({ name: s.users.name, phone: s.users.phone }).from(s.users).where(eq(s.users.id, incident.reportedBy)) : [];
  return { incident, reporter: reporter ?? null, ...(live ?? { options: [], now: null, affected: [] }) };
}

/** The dispatcher approves one option; the system never re-routes on its own. */
export async function approveRecovery(user: AuthUser, incidentId: string, key: string) {
  const [incident] = await db.select().from(s.incidents).where(eq(s.incidents.id, incidentId));
  if (!incident) throw notFound('Incident');
  if (incident.status !== 'open') throw conflict('This incident has already been resolved');
  const result = await recoveryOptions(incidentId);
  const sit = await situation(incidentId);
  if (!result || !sit) throw badRequest('No chilled stops left to recover on that vehicle');
  const option = result.options.find((o) => o.key === key);
  if (!option || option.verdict === 'ruled_out') throw badRequest('That option is not allowed');

  const { serviceDate } = await getState(db);
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, serviceDate));
  const orders = await queuedOrdersWithStatus(serviceDate);
  const affectedOrders = orders.filter((o) => sit.affected.includes(o.id));
  const outletIds = [...new Set(affectedOrders.map((o) => o.outletId))];
  const failedTrips = sit.trips
    .filter((t) => t.vehicleId === incident.vehicleId)
    .map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => !sit.affected.includes(id)) }));

  if (option.kind === 'defer') {
    await applyPlanChange(
      user,
      plan!,
      sit.ctx,
      new Map([[incident.vehicleId, failedTrips]]),
      {
        servedOrderIds: [],
        deferOrders: affectedOrders.map((order) => ({ order, reason: 'VEHICLE_FAULT' as const, note: `Refrigeration fault on ${incident.vehicleId}` })),
        message: `Refrigeration fault on ${incident.vehicleId}: ${affectedOrders.length} chilled stop${affectedOrders.length === 1 ? '' : 's'} deferred`,
        affectedVehicles: [incident.vehicleId],
        affectedOutlets: outletIds,
      },
      { eventType: 'incident.approved', eventPayload: { incidentId, option: option.key } },
    );
  } else {
    const rescueId = option.vehicleId!;
    const own = sit.trips.filter((t) => t.vehicleId === rescueId);
    const newTrip: TripDraft = {
      vehicleId: rescueId,
      tripNo: (own.length + 1) as TripNo,
      brand: sit.failedTrip.brand,
      district: sit.failedTrip.district,
      depot: sit.failedTrip.depot,
      orderIds: sit.affected,
    };
    const arrivals = new Map(option.stops.map((st) => [st.orderId, st]));
    await applyPlanChange(
      user,
      plan!,
      sit.ctx,
      new Map([
        [incident.vehicleId, failedTrips],
        [rescueId, [...own, newTrip]],
      ]),
      {
        servedOrderIds: sit.affected,
        deferOrders: [],
        message: `${option.label}: ${sit.affected.length} chilled stop${sit.affected.length === 1 ? '' : 's'} move${sit.affected.length === 1 ? 's' : ''} from ${incident.vehicleId} to ${rescueId}`,
        affectedVehicles: [incident.vehicleId, rescueId],
        affectedOutlets: outletIds,
      },
      {
        eventType: 'incident.approved',
        eventPayload: { incidentId, option: option.key, rescueVehicle: rescueId, failedVehicle: incident.vehicleId, depart: option.depart, kind: option.kind },
        afterWrite: async (tx) => {
          // Recovery timings start from the incident, not from the shift start the simulator assumes.
          for (const st of option.stops) {
            const [h, m] = st.arrive.split(':').map(Number);
            await tx.update(s.stops).set({ plannedArrival: h! * 60 + m! }).where(eq(s.stops.orderId, st.orderId));
          }
          for (const o of affectedOrders) {
            const st = arrivals.get(o.id);
            await tx.insert(s.notifications).values({
              outletId: o.outletId,
              orderId: o.id,
              type: 'changed',
              title: `${o.orderNo} now arriving on ${rescueId}`,
              body: `${incident.vehicleId}'s refrigeration failed. Your chilled order is now on ${rescueId}, expected ${st?.arrive ?? 'soon'} (window ${st?.window ?? ''})${st && st.lateMin > 0 ? `, about ${st.lateMin} min late` : ''}. Please check the temperature on receipt.`,
            });
          }
        },
      },
    );
  }

  await db
    .update(s.incidents)
    .set({ status: 'resolved', chosenOption: option.key, options: result, approvedBy: user.id, approvedAt: new Date() })
    .where(eq(s.incidents.id, incidentId));
  await emit(db, {
    type: 'incident.resolved',
    actor: user,
    date: serviceDate,
    scope: { roles: ['dispatcher'], depots: [sit.depot], vehicleIds: [incident.vehicleId, option.vehicleId ?? ''].filter(Boolean), outletIds },
    payload: { incidentId, option: option.key, label: option.label, message: `Recovery approved: ${option.label}` },
  });
  return { ok: true, option };
}
