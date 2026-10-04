import { and, eq, lt, inArray, sql as dsql } from 'drizzle-orm';
import type { Brand, DepotName, DistrictTravel, Outlet, PlanOrder, RuleContext, Vehicle } from '@wn/domain';
import type { DB } from '../db/client';
import * as s from '../db/schema';

export type OrderRow = typeof s.orders.$inferSelect;
export type OutletRow = typeof s.outlets.$inferSelect;
export type VehicleRow = typeof s.vehicles.$inferSelect;

export function toOutlet(r: OutletRow): Outlet {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand as Brand,
    district: r.district,
    depot: r.depot as DepotName,
    dockType: r.dockType as Outlet['dockType'],
    parkingConstraint: r.parkingConstraint as Outlet['parkingConstraint'],
    mallWindow: r.mallWindowOpen != null && r.mallWindowClose != null ? { open: r.mallWindowOpen, close: r.mallWindowClose } : null,
    window: { open: r.windowOpen, close: r.windowClose },
  };
}

export function toVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    type: r.type as Vehicle['type'],
    temp: r.temp as Vehicle['temp'],
    weightCapKg: r.weightCapKg,
    volumeCapM3: r.volumeCapM3,
    fuelType: r.fuelType,
    kmPerL: r.kmPerL,
    weeklyFuelQuotaL: r.weeklyFuelQuotaL,
    depot: r.depot as DepotName,
  };
}

export function toPlanOrder(r: OrderRow): PlanOrder {
  return {
    id: r.id,
    orderNo: r.orderNo,
    outletId: r.outletId,
    brand: r.brand as Brand,
    district: r.district,
    depot: r.depot as DepotName,
    temp: r.temp as PlanOrder['temp'],
    units: r.units,
    weightKg: r.weightKg,
    volumeM3: r.volumeM3,
    deferredYesterday: r.deferredYesterday,
    daysSinceLastServed: r.daysSinceLastServed,
  };
}

/**
 * Builds the pure planner input for a delivery date: reference data, the given orders, and fuel
 * already used this ISO week (seeded ledger plus trips on earlier plans in the same week).
 */
export async function loadRuleContext(db: DB, date: string, orderRows: OrderRow[]): Promise<RuleContext> {
  const [outletRows, vehicleRows, districtRows, allowanceRows, day] = await Promise.all([
    db.select().from(s.outlets),
    db.select().from(s.vehicles),
    db.select().from(s.districts),
    db.select().from(s.serviceAllowances),
    db.select().from(s.calendarDays).where(eq(s.calendarDays.date, date)),
  ]);

  const fuel = new Map<string, number>();
  const cal = day[0];
  if (cal) {
    const ledger = await db
      .select()
      .from(s.fuelLedger)
      .where(and(eq(s.fuelLedger.isoYear, cal.isoYear), eq(s.fuelLedger.isoWeek, cal.isoWeek)));
    for (const l of ledger) fuel.set(l.vehicleId, l.litres);

    // Earlier plans in the same week also consume quota.
    const weekDates = await db
      .select({ date: s.calendarDays.date })
      .from(s.calendarDays)
      .where(and(eq(s.calendarDays.isoYear, cal.isoYear), eq(s.calendarDays.isoWeek, cal.isoWeek), lt(s.calendarDays.date, date)));
    if (weekDates.length) {
      const earlier = await db
        .select({ vehicleId: s.trips.vehicleId, litres: dsql<number>`sum(${s.trips.fuelL})` })
        .from(s.trips)
        .innerJoin(s.plans, eq(s.plans.id, s.trips.planId))
        .where(inArray(s.plans.date, weekDates.map((d) => d.date)))
        .groupBy(s.trips.vehicleId);
      for (const e of earlier) fuel.set(e.vehicleId, (fuel.get(e.vehicleId) ?? 0) + Number(e.litres));
    }
  }

  const travel: DistrictTravel[] = districtRows.map((d) => ({
    district: d.district,
    depot: d.depot as DepotName,
    roadClass: d.roadClass,
    freeFlowKmh: d.freeFlowKmh,
    depotToDistrictKm: d.depotToDistrictKm,
    depotToDistrictMin: d.depotToDistrictMin,
    interStopKm: d.interStopKm,
    interStopMin: d.interStopMin,
  }));

  return {
    outlets: new Map(outletRows.map((r) => [r.id, toOutlet(r)])),
    vehicles: new Map(vehicleRows.map((r) => [r.id, toVehicle(r)])),
    orders: new Map(orderRows.map((r) => [r.id, toPlanOrder(r)])),
    travel: new Map(travel.map((t) => [t.district, t])),
    serviceAllowance: new Map(allowanceRows.map((a) => [`${a.brand}|${a.dockType}`, a.minutes])),
    fuelUsedThisWeekL: fuel,
  };
}

export async function availableVehicleIds(db: DB): Promise<string[]> {
  const rows = await db.select({ id: s.vehicles.id }).from(s.vehicles).where(eq(s.vehicles.status, 'available'));
  return rows.map((r) => r.id).sort();
}

/** Orders that belong in the planning queue for a date (closed and not yet delivered). */
export async function queuedOrders(db: DB, date: string): Promise<OrderRow[]> {
  return db
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.requestedDate, date), inArray(s.orders.status, ['queued', 'planned', 'deferred'])));
}

