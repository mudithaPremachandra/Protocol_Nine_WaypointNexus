import type { PlanOrder } from '@wn/domain';

/**
 * Who gets served first when the fleet can't serve everyone. Kept as one plain object so the
 * deferral review screen (D4) and docs/planner.md can explain exactly how orders were ranked.
 */
export interface PriorityPolicy {
  base: { freshChilled: number; freshAmbient: number; tech: number; style: number };
  /** A store skipped on the previous run must not be skipped twice in a row. */
  repeatSkipBoost: number;
  /** Per day since the outlet was last served, capped at maxDays. */
  perDaySinceServed: number;
  maxDays: number;
}

export const DEFAULT_POLICY: PriorityPolicy = {
  base: { freshChilled: 60, freshAmbient: 50, tech: 35, style: 30 },
  repeatSkipBoost: 100,
  perDaySinceServed: 3,
  maxDays: 7,
};

export function priorityScore(order: PlanOrder, policy: PriorityPolicy = DEFAULT_POLICY): number {
  const base =
    order.brand === 'Fresh'
      ? order.temp === 'chilled'
        ? policy.base.freshChilled
        : policy.base.freshAmbient
      : order.brand === 'Tech'
        ? policy.base.tech
        : policy.base.style;
  const repeat = order.deferredYesterday ? policy.repeatSkipBoost : 0;
  const waiting = Math.min(Math.max(order.daysSinceLastServed - 1, 0), policy.maxDays) * policy.perDaySinceServed;
  return base + repeat + waiting;
}

/** Highest priority first; ties broken largest-first, which packs bins better. */
export function rankOrders(orders: readonly PlanOrder[], policy: PriorityPolicy = DEFAULT_POLICY): PlanOrder[] {
  return [...orders].sort(
    (a, b) =>
      priorityScore(b, policy) - priorityScore(a, policy) ||
      b.volumeM3 - a.volumeM3 ||
      b.weightKg - a.weightKg ||
      a.id.localeCompare(b.id),
  );
}
