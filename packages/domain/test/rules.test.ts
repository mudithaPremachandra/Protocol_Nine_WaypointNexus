import { describe, expect, it } from 'vitest';
import {
  failing,
  simulateVehicleDay,
  tripMinutes,
  validateTrip,
  validateVehicleDay,
  type TripDraft,
} from '../src';
import { makeCtx, order } from './fixtures';

const gampahaOrders = [order('A', 'OUT001'), order('B', 'OUT002'), order('C', 'OUT003')];
const colomboOrders = [order('D', 'OUT004'), order('E', 'OUT005'), order('F', 'OUT006'), order('G', 'OUT007')];

const gampaha: TripDraft = {
  vehicleId: 'VEH001',
  tripNo: 1,
  brand: 'Fresh',
  district: 'Gampaha',
  depot: 'Peliyagoda',
  orderIds: ['A', 'B', 'C'],
};
const colombo: TripDraft = {
  vehicleId: 'VEH001',
  tripNo: 2,
  brand: 'Fresh',
  district: 'Colombo',
  depot: 'Peliyagoda',
  orderIds: ['D', 'E', 'F', 'G'],
};

describe('tripMinutes (booklet p.21 worked examples)', () => {
  const ctx = makeCtx({ orders: [...gampahaOrders, ...colomboOrders] });

  it('Gampaha trip with 2 rear docks + 1 street = 101 min', () => {
    expect(tripMinutes(ctx, gampaha)).toEqual({ outbound: 37, interStop: 18, handling: 46, total: 101 });
  });

  it('Colombo trip with 4 street stops = 112 min', () => {
    expect(tripMinutes(ctx, colombo).total).toBe(112);
  });

  it('both trips use 213 of 270 Fresh minutes', () => {
    const checks = validateVehicleDay(ctx, 'VEH001', [gampaha, colombo]);
    const budget = checks.find((c) => c.rule === 'TIME_BUDGET')!;
    expect(budget).toMatchObject({ ok: true, actual: 213, limit: 270 });
  });
});

describe('validateTrip', () => {
  it('rejects chilled goods on an ambient vehicle', () => {
    const ctx = makeCtx({ orders: [order('X', 'OUT004', { temp: 'chilled' })] });
    const checks = validateTrip(ctx, { ...colombo, vehicleId: 'VEH002', tripNo: 1, orderIds: ['X'] });
    expect(failing(checks).map((c) => c.rule)).toEqual(['TEMPERATURE']);
  });

  it('rejects a truck at a van-only outlet', () => {
    const ctx = makeCtx({ orders: [order('X', 'OUT008')] });
    const checks = validateTrip(ctx, { ...colombo, vehicleId: 'VEH002', tripNo: 1, orderIds: ['X'] });
    expect(failing(checks).map((c) => c.rule)).toEqual(['VAN_ACCESS']);
  });

  it('checks weight and volume independently', () => {
    const ctx = makeCtx({ orders: [order('X', 'OUT008', { weightKg: 500, volumeM3: 7 })] });
    const checks = validateTrip(ctx, { ...colombo, vehicleId: 'VEH003', tripNo: 1, orderIds: ['X'] });
    expect(failing(checks).map((c) => c.rule)).toEqual(['VOLUME']);
  });

  it('rejects outlets from another depot and mixed districts', () => {
    const ctx = makeCtx({ orders: [order('X', 'OUT010'), order('Y', 'OUT004')] });
    const checks = validateTrip(ctx, { ...colombo, tripNo: 1, orderIds: ['X', 'Y'] });
    expect(failing(checks).map((c) => c.rule).sort()).toEqual(['HOME_DEPOT', 'SAME_BRAND_DISTRICT']);
  });
});

describe('validateVehicleDay', () => {
  it('flags a third trip', () => {
    const ctx = makeCtx({ orders: [...gampahaOrders, ...colomboOrders] });
    const third: TripDraft = { ...colombo, tripNo: 2, orderIds: ['G'] };
    const checks = validateVehicleDay(ctx, 'VEH001', [gampaha, { ...colombo, orderIds: ['D', 'E', 'F'] }, third]);
    expect(failing(checks).some((c) => c.rule === 'MAX_TRIPS')).toBe(true);
  });

  it('enforces the weekly fuel quota including fuel already used', () => {
    const ctx = makeCtx({ orders: gampahaOrders, fuel: { VEH001: 395 } });
    const fuel = validateVehicleDay(ctx, 'VEH001', [gampaha]).find((c) => c.rule === 'FUEL_QUOTA')!;
    // (30*2 + 6*2) km / 6 km/L = 12 L on top of 395 L.
    expect(fuel.ok).toBe(false);
    expect(fuel.actual).toBeCloseTo(407);
  });

  it('waits for a mall window to open instead of arriving early', () => {
    const ctx = makeCtx({ orders: [order('M', 'OUT009', { brand: 'Style' })] });
    const trip: TripDraft = {
      vehicleId: 'VEH002',
      tripNo: 1,
      brand: 'Style',
      district: 'Colombo',
      depot: 'Peliyagoda',
      orderIds: ['M'],
    };
    const [timing] = simulateVehicleDay(ctx, [trip]);
    // Mall window 07:00-09:00 narrows the outlet window 06:00-12:00.
    expect(timing!.stops[0]!.arrive).toBe(420);
    expect(validateVehicleDay(ctx, 'VEH002', [trip]).every((c) => c.ok)).toBe(true);
  });

  it('starts trip 2 after trip 1 returns; the booklet pair still fits the 08:00 window', () => {
    const ctx = makeCtx({ orders: [...gampahaOrders, ...colomboOrders] });
    const timings = simulateVehicleDay(ctx, [gampaha, colombo]);
    expect(timings[1]!.depart).toBe(timings[0]!.returnAt);
    const windowCheck = validateVehicleDay(ctx, 'VEH001', [gampaha, colombo]).find(
      (c) => c.rule === 'DELIVERY_WINDOW',
    )!;
    expect(windowCheck.ok).toBe(true);
    // Last Colombo stop: back at 05:48, out 24 min, then 3 x (16 + 8) -> 07:24.
    expect(timings[1]!.stops.at(-1)!.arrive).toBe(444);
  });

  it('flags a stop that arrives after its window closes', () => {
    const ctx = makeCtx({ orders: [...gampahaOrders, ...colomboOrders] });
    const outlet = ctx.outlets.get('OUT007')!;
    (ctx.outlets as Map<string, typeof outlet>).set('OUT007', { ...outlet, window: { open: 240, close: 420 } });
    const windowCheck = validateVehicleDay(ctx, 'VEH001', [gampaha, colombo]).find(
      (c) => c.rule === 'DELIVERY_WINDOW',
    )!;
    expect(windowCheck).toMatchObject({ ok: false, orderId: 'G', actual: 24 });
  });

  it('treats consecutive orders for the same outlet as one physical stop', () => {
    const ctx = makeCtx({ orders: [order('A', 'OUT001'), order('A2', 'OUT001', { temp: 'chilled' }), order('B', 'OUT002')] });
    const trip: TripDraft = { ...gampaha, orderIds: ['A', 'A2', 'B'] };
    const [timing] = simulateVehicleDay(ctx, [trip]);
    // No driving between A and A2: A2 starts as soon as A is unloaded (15 min).
    expect(timing!.stops[1]!.arrive - timing!.stops[0]!.depart).toBe(0);
    expect(timing!.stops[2]!.arrive - timing!.stops[1]!.depart).toBe(9);
    // The booklet's budget formula still counts every order.
    expect(tripMinutes(ctx, trip).interStop).toBe(18);
  });
});
