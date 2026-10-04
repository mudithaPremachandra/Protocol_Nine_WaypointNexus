import { describe, expect, it } from 'vitest';
import { failing, validateVehicleDay } from '@wn/domain';
import { buildPlan, checkMove, priorityScore } from '../src';
import { randomNetwork } from './random';

function assertFeasible(seed: number, opts?: Parameters<typeof randomNetwork>[1]) {
  const { ctx, orderIds, vehicleIds } = randomNetwork(seed, opts);
  const plan = buildPlan({ ctx, orderIds, vehicleIds });

  // Every vehicle day passes every rule.
  const byVehicle = new Map<string, typeof plan.trips>();
  for (const t of plan.trips) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
  for (const [vehicleId, trips] of byVehicle) {
    const fails = failing(validateVehicleDay(ctx, vehicleId, trips));
    expect(fails, `seed ${seed} ${vehicleId}: ${fails.map((f) => f.message).join('; ')}`).toEqual([]);
  }

  // Every order is served exactly once or deferred exactly once.
  const served = plan.trips.flatMap((t) => t.orderIds);
  const deferred = plan.deferred.map((d) => d.orderId);
  expect(new Set(served).size).toBe(served.length);
  expect([...served, ...deferred].sort()).toEqual([...orderIds].sort());

  // Only available vehicles are used.
  for (const t of plan.trips) expect(vehicleIds).toContain(t.vehicleId);
  return { plan, ctx, orderIds, vehicleIds };
}

describe('buildPlan: invariants on random networks', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 42, 1234]) {
    it(`seed ${seed}: plan passes every rule and accounts for every order`, () => {
      assertFeasible(seed);
    });
  }

  it('over-capacity day: defers orders, each with a reason, and names a bottleneck', () => {
    const { plan } = assertFeasible(99, { outlets: 80, vehicles: 6, sizeScale: 1.5 });
    expect(plan.deferred.length).toBeGreaterThan(0);
    for (const d of plan.deferred) {
      expect(d.reason).toBeTruthy();
      expect(d.detail.length).toBeGreaterThan(10);
    }
    expect(plan.bottleneck.headline).toMatch(/bottleneck|deferred/);
  });
});

describe('buildPlan: priority', () => {
  it('on a squeezed day, outlets skipped yesterday are served before others', () => {
    const { ctx, orderIds, vehicleIds } = randomNetwork(7, { outlets: 80, vehicles: 6 });
    const plan = buildPlan({ ctx, orderIds, vehicleIds });
    const served = new Set(plan.trips.flatMap((t) => t.orderIds));
    const repeatOrders = orderIds.map((id) => ctx.orders.get(id)!).filter((o) => o.deferredYesterday);
    const repeatServedRate = repeatOrders.filter((o) => served.has(o.id)).length / Math.max(repeatOrders.length, 1);
    const overallRate = served.size / orderIds.length;
    expect(repeatServedRate).toBeGreaterThanOrEqual(overallRate);
  });

  it('scores repeat-skips above any first-time order', () => {
    const { ctx, orderIds } = randomNetwork(3);
    const orders = orderIds.map((id) => ctx.orders.get(id)!);
    const repeat = orders.find((o) => o.deferredYesterday && o.brand === 'Style');
    const fresh = orders.find((o) => !o.deferredYesterday && o.temp === 'chilled');
    if (repeat && fresh) expect(priorityScore(repeat)).toBeGreaterThan(priorityScore(fresh));
  });
});

describe('checkMove', () => {
  it('blocks chilled goods on an ambient truck, naming the rule, and suggests vehicles that pass', () => {
    const { plan, ctx, vehicleIds } = assertFeasible(5);
    const chilledTrip = plan.trips.find((t) => t.orderIds.some((id) => ctx.orders.get(id)!.temp === 'chilled'));
    expect(chilledTrip).toBeDefined();
    const orderId = chilledTrip!.orderIds.find((id) => ctx.orders.get(id)!.temp === 'chilled')!;
    const order = ctx.orders.get(orderId)!;
    const ambient = vehicleIds.find((id) => {
      const v = ctx.vehicles.get(id)!;
      return v.temp === 'ambient' && v.type === 'truck' && v.depot === order.depot;
    });
    if (!ambient) return;
    const result = checkMove(ctx, vehicleIds, plan.trips, orderId, { vehicleId: ambient });
    expect(result.ok).toBe(false);
    expect(result.failing.map((f) => f.rule)).toContain('TEMPERATURE');
    // Its original reefer is always a legal home, so at least one suggestion exists.
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('accepts a legal move and returns the re-sequenced trips', () => {
    const { plan, ctx, vehicleIds } = assertFeasible(8);
    const trip = plan.trips.find((t) => t.orderIds.length > 1)!;
    const result = checkMove(ctx, vehicleIds, plan.trips, trip.orderIds[0]!, {
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo,
    });
    expect(result.ok).toBe(true);
    expect(result.trips?.some((t) => t.orderIds.includes(trip.orderIds[0]!))).toBe(true);
  });
});
