import { formatHHMM, formatWindow, intersectWindows } from './time';
import type {
  Brand,
  DistrictTravel,
  Minutes,
  PlanOrder,
  RuleContext,
  TimeWindow,
  TripDraft,
  Vehicle,
} from './types';

/* ------------------------------------------------------------------ */
/* Operating constants (booklet p.5 and p.21)                          */
/* ------------------------------------------------------------------ */

export const MAX_TRIPS_PER_VEHICLE = 2;

export type BudgetFamily = 'fresh' | 'styleTech';

export const BUDGETS: Record<BudgetFamily, { start: Minutes; minutes: number; label: string }> = {
  /** Fresh runs 03:30–08:00: 270 minutes of trip time per vehicle. */
  fresh: { start: 3 * 60 + 30, minutes: 270, label: 'Fresh' },
  /** Style and Tech share one 480-minute trading-day budget. */
  styleTech: { start: 6 * 60, minutes: 480, label: 'Style/Tech' },
};

export function budgetFamily(brand: Brand): BudgetFamily {
  return brand === 'Fresh' ? 'fresh' : 'styleTech';
}

/* ------------------------------------------------------------------ */
/* Check results                                                       */
/* ------------------------------------------------------------------ */

export type RuleCode =
  | 'SAME_BRAND_DISTRICT'
  | 'HOME_DEPOT'
  | 'TEMPERATURE'
  | 'VAN_ACCESS'
  | 'WEIGHT'
  | 'VOLUME'
  | 'TIME_BUDGET'
  | 'DELIVERY_WINDOW'
  | 'FUEL_QUOTA'
  | 'MAX_TRIPS';

export interface Check {
  rule: RuleCode;
  ok: boolean;
  message: string;
  actual?: number;
  limit?: number;
  unit?: string;
  /** Trip the check refers to, when it is trip-scoped. */
  tripNo?: number;
  orderId?: string;
}

export const RULE_LABELS: Record<RuleCode, string> = {
  SAME_BRAND_DISTRICT: 'One brand and district per trip',
  HOME_DEPOT: 'Home depot',
  TEMPERATURE: 'Refrigeration',
  VAN_ACCESS: 'Van-only access',
  WEIGHT: 'Weight',
  VOLUME: 'Volume',
  TIME_BUDGET: 'Time budget',
  DELIVERY_WINDOW: 'Delivery window',
  FUEL_QUOTA: 'Weekly fuel',
  MAX_TRIPS: 'Trips per day',
};

/* ------------------------------------------------------------------ */
/* Trip arithmetic                                                     */
/* ------------------------------------------------------------------ */

function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Unknown ${what}`);
  return value;
}

export function serviceMinutes(ctx: RuleContext, brand: Brand, outletId: string): number {
  const outlet = req(ctx.outlets.get(outletId), `outlet ${outletId}`);
  return req(ctx.serviceAllowance.get(`${brand}|${outlet.dockType}`), `service allowance ${brand}|${outlet.dockType}`);
}

export interface TripTimeBreakdown {
  outbound: number;
  interStop: number;
  handling: number;
  total: number;
}

/**
 * trip_minutes = outbound travel + inter-stop travel + total handling time.
 * Exactly the booklet's rule (p.20–21); the return leg is already allowed for in the budgets.
 */
export function tripMinutes(ctx: RuleContext, trip: Pick<TripDraft, 'brand' | 'district' | 'orderIds'>): TripTimeBreakdown {
  const travel = req(ctx.travel.get(trip.district), `district ${trip.district}`);
  const n = trip.orderIds.length;
  if (n === 0) return { outbound: 0, interStop: 0, handling: 0, total: 0 };
  const outbound = travel.depotToDistrictMin;
  const interStop = travel.interStopMin * (n - 1);
  let handling = 0;
  for (const id of trip.orderIds) {
    const order = req(ctx.orders.get(id), `order ${id}`);
    handling += serviceMinutes(ctx, trip.brand, order.outletId);
  }
  return { outbound, interStop, handling, total: outbound + interStop + handling };
}

/** Round-trip road distance: out, between stops, and back. */
export function tripKm(travel: DistrictTravel, stops: number): number {
  if (stops === 0) return 0;
  return travel.depotToDistrictKm * 2 + travel.interStopKm * (stops - 1);
}

export function tripFuelL(ctx: RuleContext, trip: Pick<TripDraft, 'district' | 'orderIds' | 'vehicleId'>): number {
  const travel = req(ctx.travel.get(trip.district), `district ${trip.district}`);
  const vehicle = req(ctx.vehicles.get(trip.vehicleId), `vehicle ${trip.vehicleId}`);
  return tripKm(travel, trip.orderIds.length) / vehicle.kmPerL;
}

export function tripLoad(ctx: RuleContext, orderIds: readonly string[]): { weightKg: number; volumeM3: number; units: number } {
  let weightKg = 0;
  let volumeM3 = 0;
  let units = 0;
  for (const id of orderIds) {
    const o = req(ctx.orders.get(id), `order ${id}`);
    weightKg += o.weightKg;
    volumeM3 += o.volumeM3;
    units += o.units;
  }
  return { weightKg, volumeM3, units };
}

/** The window an outlet will actually accept: its own window, narrowed by the mall's. */
export function effectiveWindow(ctx: RuleContext, outletId: string): TimeWindow | null {
  const outlet = req(ctx.outlets.get(outletId), `outlet ${outletId}`);
  return intersectWindows(outlet.window, outlet.mallWindow);
}

/** Earliest-deadline-first: the sequence that gives every window its best chance. */
export function sequenceStops(ctx: RuleContext, orderIds: readonly string[]): string[] {
  return [...orderIds].sort((a, b) => {
    const oa = req(ctx.orders.get(a), `order ${a}`);
    const ob = req(ctx.orders.get(b), `order ${b}`);
    const wa = effectiveWindow(ctx, oa.outletId);
    const wb = effectiveWindow(ctx, ob.outletId);
    const ca = wa?.close ?? -1;
    const cb = wb?.close ?? -1;
    if (ca !== cb) return ca - cb;
    if ((wa?.open ?? 0) !== (wb?.open ?? 0)) return (wa?.open ?? 0) - (wb?.open ?? 0);
    // Keep the same outlet's orders together (Fresh dry + chilled).
    return oa.outletId.localeCompare(ob.outletId) || a.localeCompare(b);
  });
}

/* ------------------------------------------------------------------ */
/* Arrival simulation                                                  */
/* ------------------------------------------------------------------ */

export interface StopTiming {
  orderId: string;
  outletId: string;
  seq: number;
  arrive: Minutes;
  serviceStart: Minutes;
  depart: Minutes;
  window: TimeWindow | null;
  waitMin: number;
  lateMin: number;
}

export interface TripTiming {
  vehicleId: string;
  tripNo: number;
  depart: Minutes;
  /** Back at depot, ready to reload. */
  returnAt: Minutes;
  stops: StopTiming[];
}

/**
 * Simulates one vehicle's day: trips run in trip-number order; trip 2 leaves once trip 1 is
 * back at the depot. A vehicle that arrives early waits for the window to open (booklet p.15).
 */
export function simulateVehicleDay(ctx: RuleContext, trips: readonly TripDraft[]): TripTiming[] {
  const ordered = [...trips].sort((a, b) => a.tripNo - b.tripNo);
  const timings: TripTiming[] = [];
  let availableAt = 0;
  for (const trip of ordered) {
    const travel = req(ctx.travel.get(trip.district), `district ${trip.district}`);
    const family = BUDGETS[budgetFamily(trip.brand)];
    const firstId = trip.orderIds[0];
    const firstWindow = firstId ? effectiveWindow(ctx, req(ctx.orders.get(firstId), `order ${firstId}`).outletId) : null;
    // Leave as late as possible so the first stop is reached as its window opens, never before the shift starts.
    const ideal = firstWindow ? firstWindow.open - travel.depotToDistrictMin : family.start;
    const depart = Math.max(family.start, availableAt, ideal);

    let t = depart + travel.depotToDistrictMin;
    let prevOutlet: string | null = null;
    const stops: StopTiming[] = trip.orderIds.map((orderId, seq) => {
      const order = req(ctx.orders.get(orderId), `order ${orderId}`);
      // A Fresh outlet's dry and chilled orders are one physical stop: no driving between them.
      // (Budgets still use the booklet's per-order formula, which is the conservative reading.)
      if (seq > 0 && order.outletId !== prevOutlet) t += travel.interStopMin;
      prevOutlet = order.outletId;
      const window = effectiveWindow(ctx, order.outletId);
      const arrive = t;
      const serviceStart = window ? Math.max(arrive, window.open) : arrive;
      const service = serviceMinutes(ctx, trip.brand, order.outletId);
      t = serviceStart + service;
      return {
        orderId,
        outletId: order.outletId,
        seq,
        arrive,
        serviceStart,
        depart: t,
        window,
        waitMin: serviceStart - arrive,
        lateMin: window ? Math.max(0, arrive - window.close) : 0,
      };
    });
    const returnAt = t + travel.depotToDistrictMin;
    timings.push({ vehicleId: trip.vehicleId, tripNo: trip.tripNo, depart, returnAt, stops });
    availableAt = returnAt;
  }
  return timings;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Checks that concern a single trip in isolation (load, access, temperature, grouping). */
export function validateTrip(ctx: RuleContext, trip: TripDraft): Check[] {
  const vehicle = req(ctx.vehicles.get(trip.vehicleId), `vehicle ${trip.vehicleId}`);
  const orders = trip.orderIds.map((id) => req(ctx.orders.get(id), `order ${id}`));
  const checks: Check[] = [];
  const t = trip.tripNo;

  const mixed = orders.filter((o) => o.brand !== trip.brand || o.district !== trip.district);
  checks.push({
    rule: 'SAME_BRAND_DISTRICT',
    ok: mixed.length === 0,
    tripNo: t,
    orderId: mixed[0]?.id,
    message:
      mixed.length === 0
        ? `All stops are ${trip.brand} in ${trip.district}`
        : `${mixed[0]!.orderNo} is ${mixed[0]!.brand} in ${mixed[0]!.district}; trip is ${trip.brand} in ${trip.district}`,
  });

  const away = orders.filter((o) => o.depot !== vehicle.depot);
  checks.push({
    rule: 'HOME_DEPOT',
    ok: away.length === 0,
    tripNo: t,
    orderId: away[0]?.id,
    message:
      away.length === 0
        ? `${vehicle.id} and all outlets belong to ${vehicle.depot}`
        : `${away[0]!.orderNo} belongs to ${away[0]!.depot}; ${vehicle.id} is based at ${vehicle.depot}`,
  });

  const chilled = orders.filter((o) => o.temp === 'chilled');
  const tempOk = chilled.length === 0 || vehicle.temp === 'reefer';
  checks.push({
    rule: 'TEMPERATURE',
    ok: tempOk,
    tripNo: t,
    orderId: tempOk ? undefined : chilled[0]?.id,
    message: chilled.length === 0
      ? 'No chilled goods'
      : tempOk
        ? `${chilled.length} chilled order${chilled.length > 1 ? 's' : ''} on a refrigerated vehicle`
        : `${chilled[0]!.orderNo} is chilled; ${vehicle.id} is not refrigerated`,
  });

  const vanOnly = orders.filter((o) => ctx.outlets.get(o.outletId)?.parkingConstraint === 'van_only');
  const vanOk = vanOnly.length === 0 || vehicle.type === 'van';
  checks.push({
    rule: 'VAN_ACCESS',
    ok: vanOk,
    tripNo: t,
    orderId: vanOk ? undefined : vanOnly[0]?.id,
    message: vanOnly.length === 0
      ? 'No van-only outlets'
      : vanOk
        ? `${vanOnly.length} van-only outlet${vanOnly.length > 1 ? 's' : ''} served by a van`
        : `${vanOnly[0]!.outletId} is van-only; ${vehicle.id} is a truck`,
  });

  const load = tripLoad(ctx, trip.orderIds);
  checks.push({
    rule: 'WEIGHT',
    ok: load.weightKg <= vehicle.weightCapKg + 1e-9,
    tripNo: t,
    actual: load.weightKg,
    limit: vehicle.weightCapKg,
    unit: 'kg',
    message: `${Math.round(load.weightKg)} / ${vehicle.weightCapKg} kg`,
  });
  checks.push({
    rule: 'VOLUME',
    ok: load.volumeM3 <= vehicle.volumeCapM3 + 1e-9,
    tripNo: t,
    actual: load.volumeM3,
    limit: vehicle.volumeCapM3,
    unit: 'm³',
    message: `${fmt1(load.volumeM3)} / ${vehicle.volumeCapM3} m³`,
  });
  return checks;
}

/**
 * Validates everything a vehicle does in a day: every trip's own checks, plus the rules that
 * span trips (trip count, the two time budgets, delivery windows, weekly fuel).
 */
export function validateVehicleDay(ctx: RuleContext, vehicleId: string, trips: readonly TripDraft[]): Check[] {
  const vehicle: Vehicle = req(ctx.vehicles.get(vehicleId), `vehicle ${vehicleId}`);
  const checks: Check[] = [];
  const active = trips.filter((t) => t.orderIds.length > 0);

  checks.push({
    rule: 'MAX_TRIPS',
    ok: active.length <= MAX_TRIPS_PER_VEHICLE,
    actual: active.length,
    limit: MAX_TRIPS_PER_VEHICLE,
    message: `${active.length} / ${MAX_TRIPS_PER_VEHICLE} trips`,
  });

  for (const trip of active) checks.push(...validateTrip(ctx, trip));

  for (const family of ['fresh', 'styleTech'] as const) {
    const familyTrips = active.filter((t) => budgetFamily(t.brand) === family);
    if (familyTrips.length === 0) continue;
    const used = familyTrips.reduce((sum, t) => sum + tripMinutes(ctx, t).total, 0);
    const budget = BUDGETS[family];
    checks.push({
      rule: 'TIME_BUDGET',
      ok: used <= budget.minutes,
      actual: used,
      limit: budget.minutes,
      unit: 'min',
      message: `${used} / ${budget.minutes} ${budget.label} min`,
    });
  }

  const timings = simulateVehicleDay(ctx, active);
  const late = timings.flatMap((tt) => tt.stops.map((s) => ({ ...s, tripNo: tt.tripNo }))).filter((s) => !s.window || s.lateMin > 0);
  if (active.length > 0) {
    const worst = late.sort((a, b) => b.lateMin - a.lateMin)[0];
    checks.push({
      rule: 'DELIVERY_WINDOW',
      ok: late.length === 0,
      tripNo: worst?.tripNo,
      orderId: worst?.orderId,
      message:
        late.length === 0
          ? 'Every stop arrives inside its window'
          : !worst!.window
            ? `${worst!.outletId}: outlet and mall windows never overlap`
            : `${worst!.outletId} arrives ${formatHHMM(worst!.arrive)}, window ${formatWindow(worst!.window)} (${worst!.lateMin} min late)`,
      actual: worst?.lateMin,
      limit: 0,
      unit: 'min late',
    });
  }

  const usedBefore = ctx.fuelUsedThisWeekL.get(vehicleId) ?? 0;
  const today = active.reduce((sum, t) => sum + tripFuelL(ctx, t), 0);
  checks.push({
    rule: 'FUEL_QUOTA',
    ok: usedBefore + today <= vehicle.weeklyFuelQuotaL + 1e-9,
    actual: usedBefore + today,
    limit: vehicle.weeklyFuelQuotaL,
    unit: 'L',
    message: `${Math.round(usedBefore + today)} / ${vehicle.weeklyFuelQuotaL} L this week (${Math.round(today)} L today)`,
  });

  return checks;
}

export const failing = (checks: readonly Check[]) => checks.filter((c) => !c.ok);
export const passes = (checks: readonly Check[]) => checks.every((c) => c.ok);

/* ------------------------------------------------------------------ */
/* Compatibility helpers                                               */
/* ------------------------------------------------------------------ */

/** Static (load-independent) fit between a vehicle and an order. */
export function vehicleCanCarry(ctx: RuleContext, vehicle: Vehicle, order: PlanOrder): boolean {
  if (vehicle.depot !== order.depot) return false;
  if (order.temp === 'chilled' && vehicle.temp !== 'reefer') return false;
  const outlet = ctx.outlets.get(order.outletId);
  if (outlet?.parkingConstraint === 'van_only' && vehicle.type !== 'van') return false;
  return true;
}
