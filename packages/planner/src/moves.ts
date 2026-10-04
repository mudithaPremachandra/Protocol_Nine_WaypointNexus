import { failing, type Check, type RuleContext, type TripDraft } from '@wn/domain';
import { PlanState } from './state';

export interface MoveTarget {
  vehicleId: string;
  /** Existing trip number, or omitted to open a new trip. */
  tripNo?: number;
}

export interface MoveSuggestion {
  vehicleId: string;
  tripNo: number;
  isNewTrip: boolean;
}

export interface MoveResult {
  ok: boolean;
  /** Every check for the target vehicle's day after the move, with real numbers (D3/D3B). */
  checks: Check[];
  failing: Check[];
  /** The target vehicle's trips if the move is applied. */
  trips: TripDraft[] | null;
  /** Vehicles where the order would pass every check, when the requested move is blocked. */
  suggestions: MoveSuggestion[];
}

/**
 * Validates a dispatcher's manual move of one order onto a vehicle/trip (D3B). Blocked moves name
 * the failing rule and come with alternatives that pass, so validation teaches rather than just blocks.
 */
export function checkMove(
  ctx: RuleContext,
  vehicleIds: readonly string[],
  currentTrips: readonly TripDraft[],
  orderId: string,
  target: MoveTarget,
): MoveResult {
  const order = ctx.orders.get(orderId);
  if (!order) throw new Error(`Unknown order ${orderId}`);
  const state = PlanState.from(ctx, vehicleIds, currentTrips);
  state.remove(orderId);

  const targetTrips = state.byVehicle.get(target.vehicleId) ?? [];
  const existing = target.tripNo ? targetTrips.find((t) => t.tripNo === target.tripNo) : undefined;

  // Build the requested trip set even if it breaks rules, so we can report exactly what fails.
  let trips: TripDraft[];
  if (existing) {
    trips = targetTrips.map((t) =>
      t === existing ? { ...t, orderIds: [...t.orderIds, orderId] } : t,
    );
  } else {
    trips = [
      ...targetTrips,
      {
        vehicleId: target.vehicleId,
        tripNo: (targetTrips.length + 1) as 1 | 2,
        brand: order.brand,
        district: order.district,
        depot: order.depot,
        orderIds: [orderId],
      },
    ];
  }

  // Prefer the planner's own sequencing/renumbering when the move is legal.
  const legal = state.findPlacements(order, { onlyVehicle: target.vehicleId, onlyTripNo: existing?.tripNo }).feasible;
  const chosen = legal.find((p) => (existing ? !p.isNewTrip : p.isNewTrip)) ?? null;
  const finalTrips = chosen ? chosen.trips : trips;
  const checks = state.checksFor(target.vehicleId, finalTrips);
  const fails = failing(checks);

  const suggestions =
    fails.length === 0
      ? []
      : state
          .findPlacements(order)
          .feasible.filter((p) => p.vehicleId !== target.vehicleId)
          .slice(0, 3)
          .map((p) => ({ vehicleId: p.vehicleId, tripNo: p.tripNo, isNewTrip: p.isNewTrip }));

  return { ok: fails.length === 0, checks, failing: fails, trips: fails.length === 0 ? finalTrips : null, suggestions };
}

export interface SwapSuggestion {
  /** The deferred order that gets served. */
  orderId: string;
  /** The served order that would move to the next run instead. */
  victimOrderId: string;
  vehicleId: string;
  tripNo: number;
  victimPriority: number;
}

/**
 * For a deferred order (typically a repeat-skip), finds a lower-priority served order whose place it
 * could take without breaking any rule: the "proposes a swap with a lower-impact order" on D4.
 */
export function suggestSwap(
  ctx: RuleContext,
  vehicleIds: readonly string[],
  currentTrips: readonly TripDraft[],
  orderId: string,
  score: (orderId: string) => number,
): SwapSuggestion | null {
  const order = ctx.orders.get(orderId);
  if (!order) throw new Error(`Unknown order ${orderId}`);
  const mine = score(orderId);
  const victims = currentTrips
    .filter((t) => t.brand === order.brand && t.district === order.district && t.depot === order.depot)
    .flatMap((t) => t.orderIds.map((id) => ({ id, trip: t })))
    .filter((v) => score(v.id) < mine)
    .sort((a, b) => score(a.id) - score(b.id));

  for (const v of victims) {
    const state = PlanState.from(ctx, vehicleIds, currentTrips);
    state.remove(orderId);
    state.remove(v.id);
    const spot = state.findPlacements(order, { onlyVehicle: v.trip.vehicleId }).best;
    if (spot) {
      return { orderId, victimOrderId: v.id, vehicleId: spot.vehicleId, tripNo: spot.tripNo, victimPriority: score(v.id) };
    }
  }
  return null;
}
