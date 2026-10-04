import {
  budgetFamily,
  failing,
  sequenceStops,
  validateVehicleDay,
  vehicleCanCarry,
  MAX_TRIPS_PER_VEHICLE,
  type Check,
  type PlanOrder,
  type RuleCode,
  type RuleContext,
  type TripDraft,
  type TripNo,
  type Vehicle,
} from '@wn/domain';

/** Where an order could go: an existing trip, or a new trip on a vehicle. */
export interface Placement {
  vehicleId: string;
  /** Trip number the order lands on after renumbering. */
  tripNo: TripNo;
  isNewTrip: boolean;
  trips: TripDraft[];
  cost: number;
}

export interface PlacementSearch {
  best: Placement | null;
  feasible: Placement[];
  /** Rules that blocked each candidate that was tried; used to explain a deferral. */
  blockers: RuleCode[];
  compatibleVehicles: number;
}

/**
 * Fresh trips must run first in the day (03:30–08:00 window), so trips are always ordered
 * Fresh before Style/Tech and renumbered 1..n. Pure: returns new trip objects.
 */
export function normalizeTrips(trips: readonly TripDraft[]): TripDraft[] {
  return [...trips]
    .filter((t) => t.orderIds.length > 0)
    .sort((a, b) => {
      const fa = budgetFamily(a.brand) === 'fresh' ? 0 : 1;
      const fb = budgetFamily(b.brand) === 'fresh' ? 0 : 1;
      return fa - fb || a.tripNo - b.tripNo;
    })
    .map((t, i) => ({ ...t, tripNo: (i + 1) as TripNo }));
}

/** Mutable working plan: vehicle -> its trips for the day. */
export class PlanState {
  readonly byVehicle = new Map<string, TripDraft[]>();
  readonly assignment = new Map<string, string>(); // orderId -> vehicleId

  constructor(
    readonly ctx: RuleContext,
    readonly vehicleIds: readonly string[],
  ) {
    for (const id of vehicleIds) this.byVehicle.set(id, []);
  }

  static from(ctx: RuleContext, vehicleIds: readonly string[], trips: readonly TripDraft[]): PlanState {
    const s = new PlanState(ctx, vehicleIds);
    for (const t of trips) {
      if (!s.byVehicle.has(t.vehicleId)) s.byVehicle.set(t.vehicleId, []);
      s.byVehicle.get(t.vehicleId)!.push({ ...t, orderIds: [...t.orderIds] });
      for (const o of t.orderIds) s.assignment.set(o, t.vehicleId);
    }
    for (const [v, ts] of s.byVehicle) s.byVehicle.set(v, normalizeTrips(ts));
    return s;
  }

  trips(): TripDraft[] {
    return [...this.byVehicle.values()].flat();
  }

  vehicle(id: string): Vehicle {
    const v = this.ctx.vehicles.get(id);
    if (!v) throw new Error(`Unknown vehicle ${id}`);
    return v;
  }

  apply(p: Placement, orderId: string) {
    this.byVehicle.set(p.vehicleId, p.trips);
    this.assignment.set(orderId, p.vehicleId);
  }

  remove(orderId: string): TripDraft[] | null {
    const vehicleId = this.assignment.get(orderId);
    if (!vehicleId) return null;
    const before = this.byVehicle.get(vehicleId)!;
    const after = normalizeTrips(
      before.map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== orderId) })),
    );
    this.byVehicle.set(vehicleId, after);
    this.assignment.delete(orderId);
    return before;
  }

  restore(vehicleId: string, trips: TripDraft[], orderId: string) {
    this.byVehicle.set(vehicleId, trips);
    this.assignment.set(orderId, vehicleId);
  }

  checksFor(vehicleId: string, trips = this.byVehicle.get(vehicleId) ?? []): Check[] {
    return validateVehicleDay(this.ctx, vehicleId, trips);
  }

  /**
   * Every way the order could be added without breaking a rule, cheapest first.
   * Joining an existing trip is always preferred to opening a new one.
   */
  findPlacements(order: PlanOrder, opts: { onlyVehicle?: string; onlyTripNo?: number } = {}): PlacementSearch {
    const feasible: Placement[] = [];
    const blockers: RuleCode[] = [];
    let compatibleVehicles = 0;

    for (const vehicleId of this.byVehicle.keys()) {
      if (opts.onlyVehicle && vehicleId !== opts.onlyVehicle) continue;
      const vehicle = this.vehicle(vehicleId);
      if (!vehicleCanCarry(this.ctx, vehicle, order)) continue;
      compatibleVehicles++;
      const current = this.byVehicle.get(vehicleId)!;

      // 1. Join an existing trip serving the same brand and district.
      for (const trip of current) {
        if (trip.brand !== order.brand || trip.district !== order.district) continue;
        if (opts.onlyTripNo && trip.tripNo !== opts.onlyTripNo) continue;
        const joined = { ...trip, orderIds: sequenceStops(this.ctx, [...trip.orderIds, order.id]) };
        const trips = normalizeTrips(current.map((t) => (t === trip ? joined : t)));
        const fails = failing(validateVehicleDay(this.ctx, vehicleId, trips));
        if (fails.length === 0) {
          feasible.push({
            vehicleId,
            tripNo: trips.find((t) => t.orderIds.includes(order.id))!.tripNo,
            isNewTrip: false,
            trips,
            cost: scarcityCost(this.ctx, vehicle, order) - slackAfter(this.ctx, vehicle, joined) * 0.01,
          });
        } else blockers.push(...fails.map((f) => f.rule));
      }

      // 2. Open a new trip.
      if (opts.onlyTripNo && opts.onlyTripNo <= current.length) continue;
      if (current.length >= MAX_TRIPS_PER_VEHICLE) {
        blockers.push('MAX_TRIPS');
        continue;
      }
      const fresh: TripDraft = {
        vehicleId,
        tripNo: (current.length + 1) as TripNo,
        brand: order.brand,
        district: order.district,
        depot: order.depot,
        orderIds: [order.id],
      };
      const trips = normalizeTrips([...current, fresh]);
      const fails = failing(validateVehicleDay(this.ctx, vehicleId, trips));
      if (fails.length === 0) {
        feasible.push({
          vehicleId,
          tripNo: trips.find((t) => t.orderIds.includes(order.id))!.tripNo,
          isNewTrip: true,
          trips,
          // Opening a trip costs more than joining; second trips cost a little more (later start).
          cost: 100 + scarcityCost(this.ctx, vehicle, order) * 10 + current.length * 5 - vehicle.volumeCapM3 * 0.05,
        });
      } else blockers.push(...fails.map((f) => f.rule));
    }

    feasible.sort((a, b) => a.cost - b.cost || a.vehicleId.localeCompare(b.vehicleId));
    return { best: feasible[0] ?? null, feasible, blockers, compatibleVehicles };
  }
}

/**
 * Using a scarce vehicle for an order that doesn't need it has a cost: reefers are 16 of 60,
 * vans are the only way into van-only outlets.
 */
export function scarcityCost(ctx: RuleContext, vehicle: Vehicle, order: PlanOrder): number {
  let cost = 0;
  if (vehicle.temp === 'reefer' && order.temp !== 'chilled') cost += 4;
  const vanOnly = ctx.outlets.get(order.outletId)?.parkingConstraint === 'van_only';
  if (vehicle.type === 'van' && !vanOnly) cost += 3;
  return cost;
}

function slackAfter(ctx: RuleContext, vehicle: Vehicle, trip: TripDraft): number {
  let vol = 0;
  for (const id of trip.orderIds) vol += ctx.orders.get(id)?.volumeM3 ?? 0;
  return vehicle.volumeCapM3 - vol;
}
