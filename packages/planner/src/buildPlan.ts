import {
  reasonForRule,
  RULE_LABELS,
  type DeferralReason,
  type PlanOrder,
  type RuleCode,
  type RuleContext,
  type TripDraft,
} from '@wn/domain';
import { analyseBottleneck, type Bottleneck } from './bottleneck';
import { DEFAULT_POLICY, priorityScore, rankOrders, type PriorityPolicy } from './priority';
import { PlanState } from './state';

export interface DeferredOrder {
  orderId: string;
  reason: DeferralReason;
  /** The rule that most often blocked placement, for the "why" line on D4. */
  rule: RuleCode | null;
  detail: string;
  repeatSkip: boolean;
  priority: number;
}

export interface PlanResult {
  trips: TripDraft[];
  deferred: DeferredOrder[];
  bottleneck: Bottleneck;
  stats: {
    orders: number;
    served: number;
    deferred: number;
    trips: number;
    vehiclesUsed: number;
    improvementMoves: number;
  };
}

export interface BuildPlanInput {
  ctx: RuleContext;
  orderIds: readonly string[];
  /** Vehicles available today (excludes in_workshop). */
  vehicleIds: readonly string[];
  policy?: PriorityPolicy;
  /** Cap on improvement iterations, to keep planning time predictable. */
  maxImprovementPasses?: number;
}

/**
 * Builds a feasible plan in three steps:
 *  1. Rank orders by the priority policy (repeat-skips first, then Fresh chilled, Fresh dry, Tech, Style).
 *  2. Greedy placement: join a matching trip if one fits, otherwise open a trip on the least-scarce
 *     vehicle that can legally carry the order. Every candidate is checked by validateVehicleDay,
 *     so the plan can never contain a rule violation.
 *  3. Improvement: for each deferred order, try to make room by moving a lower-priority order to
 *     another vehicle (an ejection chain of depth one), or swap it out if the deferred order
 *     clearly outranks it.
 */
export function buildPlan(input: BuildPlanInput): PlanResult {
  const { ctx } = input;
  const policy = input.policy ?? DEFAULT_POLICY;
  const orders = input.orderIds.map((id) => {
    const o = ctx.orders.get(id);
    if (!o) throw new Error(`Unknown order ${id}`);
    return o;
  });

  const state = new PlanState(ctx, input.vehicleIds);
  const unplaced: PlanOrder[] = [];

  for (const order of rankOrders(orders, policy)) {
    const { best } = state.findPlacements(order);
    if (best) state.apply(best, order.id);
    else unplaced.push(order);
  }

  const improvementMoves = improve(state, unplaced, policy, input.maxImprovementPasses ?? 3);

  const deferred = unplaced.map((order) => explainDeferral(state, order, policy));
  const trips = state.trips();
  const bottleneck = analyseBottleneck(ctx, orders, input.vehicleIds, deferred);

  return {
    trips,
    deferred,
    bottleneck,
    stats: {
      orders: orders.length,
      served: orders.length - deferred.length,
      deferred: deferred.length,
      trips: trips.length,
      vehiclesUsed: new Set(trips.map((t) => t.vehicleId)).size,
      improvementMoves,
    },
  };
}

/** Mutates state and `unplaced`; returns how many moves improved the plan. */
function improve(state: PlanState, unplaced: PlanOrder[], policy: PriorityPolicy, passes: number): number {
  let moves = 0;
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    // Highest-priority deferred orders get the first chance.
    unplaced.sort((a, b) => priorityScore(b, policy) - priorityScore(a, policy));

    for (const order of [...unplaced]) {
      const direct = state.findPlacements(order).best;
      if (direct) {
        state.apply(direct, order.id);
        unplaced.splice(unplaced.indexOf(order), 1);
        moves++;
        changed = true;
        continue;
      }
      if (tryEject(state, order, unplaced, policy)) {
        moves++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return moves;
}

/**
 * Try each trip that could carry `order`: remove one lower-priority order from it, place `order`,
 * then try to re-home the removed order elsewhere. Accept if the removed order found a new home
 * (net +1 served), or if `order` outranks it by a clear margin (a better use of the space).
 */
function tryEject(state: PlanState, order: PlanOrder, unplaced: PlanOrder[], policy: PriorityPolicy): boolean {
  const ctx = state.ctx;
  const mine = priorityScore(order, policy);
  const candidates = state
    .trips()
    .filter((t) => t.brand === order.brand && t.district === order.district && t.depot === order.depot)
    .flatMap((t) => t.orderIds.map((id) => ctx.orders.get(id)!))
    .filter((victim) => priorityScore(victim, policy) <= mine)
    .sort((a, b) => priorityScore(a, policy) - priorityScore(b, policy));

  for (const victim of candidates) {
    const vehicleId = state.assignment.get(victim.id)!;
    const before = state.remove(victim.id)!;
    const spot = state.findPlacements(order, { onlyVehicle: vehicleId }).best;
    if (!spot) {
      state.restore(vehicleId, before, victim.id);
      continue;
    }
    state.apply(spot, order.id);
    const rehome = state.findPlacements(victim).best;
    if (rehome) {
      state.apply(rehome, victim.id);
      unplaced.splice(unplaced.indexOf(order), 1);
      return true;
    }
    if (mine - priorityScore(victim, policy) >= 20) {
      unplaced.splice(unplaced.indexOf(order), 1, victim);
      return true;
    }
    // Undo: take order back out, put the victim back.
    state.remove(order.id);
    state.restore(vehicleId, before, victim.id);
  }
  return false;
}

function explainDeferral(state: PlanState, order: PlanOrder, policy: PriorityPolicy): DeferredOrder {
  const ctx = state.ctx;
  const search = state.findPlacements(order);
  const vanOnly = ctx.outlets.get(order.outletId)?.parkingConstraint === 'van_only';
  const chilled = order.temp === 'chilled';

  let reason: DeferralReason;
  let rule: RuleCode | null = null;
  let detail: string;

  if (search.compatibleVehicles === 0) {
    reason = chilled ? 'NO_REEFER_CAPACITY' : vanOnly ? 'NO_VAN_CAPACITY' : 'FLEET_EXHAUSTED';
    const need = [chilled && 'refrigerated', vanOnly && 'van'].filter(Boolean).join(' ') || 'suitable';
    detail = `No ${need} vehicle available at ${order.depot} today`;
  } else {
    rule = dominantRule(search.blockers);
    reason = reasonForRule(rule, chilled, vanOnly);
    detail = `${search.compatibleVehicles} vehicle${search.compatibleVehicles > 1 ? 's' : ''} could carry it; all blocked, mostly by ${RULE_LABELS[rule].toLowerCase()}`;
  }

  return {
    orderId: order.id,
    reason,
    rule,
    detail: `${detail}.`,
    repeatSkip: order.deferredYesterday,
    priority: priorityScore(order, policy),
  };
}

/** Capacity and trip-count failures are the usual story; prefer them over incidental ones on ties. */
const RULE_WEIGHT: Partial<Record<RuleCode, number>> = { MAX_TRIPS: 1.2, VOLUME: 1.1, WEIGHT: 1.1 };

function dominantRule(blockers: readonly RuleCode[]): RuleCode {
  const counts = new Map<RuleCode, number>();
  for (const r of blockers) counts.set(r, (counts.get(r) ?? 0) + (RULE_WEIGHT[r] ?? 1));
  let best: RuleCode = 'MAX_TRIPS';
  let bestCount = -1;
  for (const [r, c] of counts) if (c > bestCount) [best, bestCount] = [r, c];
  return best;
}
