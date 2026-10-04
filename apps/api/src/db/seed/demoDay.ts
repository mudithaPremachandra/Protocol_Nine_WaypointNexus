import { eq, sql as dsql } from 'drizzle-orm';
import { buildPlan } from '@wn/planner';
import type { DB } from '../client';
import * as s from '../schema';
import { availableVehicleIds, loadRuleContext } from '../../lib/ruleContext';
import { daysBetween, formatDay, previousOperatingDate } from '../../lib/dates';
import { num, readCsv } from './csv';
import { HERO_ORDER_NO } from './names';
import { PRODUCTS } from './reference';

/**
 * The demo day re-runs a real historical day from deliveries_train.csv on DEMO_DATE:
 * Thu 8 May 2025, four days before Vesak (festival ramp 0.6), with all three brands at both depots.
 * DEMO_DATE (Wed 29 Apr 2026) sits on the Vesak 2026 ramp in calendar.csv.
 */
export const ANALOG_DATE = '2025-05-08';
/** Monday and Tuesday of the analog week: their route legs give this week's fuel already used. */
const ANALOG_WEEK_BEFORE = ['2025-05-05', '2025-05-06'];
/** Festival-ramp uplift on top of the analog day, so demand exceeds the reduced fleet. */
const UPLIFT = 1.12;

/** Vehicles in the workshop: the booklet's peak-day list for Peliyagoda (task2b fleet) plus two at Kandy. */
const KANDY_WORKSHOP = ['VEH055', 'VEH056'];

/** Tables that hold a day's operational state. Reference data is untouched by a reset. */
const DYNAMIC_TABLES = [
  'order_lines', 'orders', 'plans', 'trips', 'stops', 'deferrals', 'flags', 'deliveries', 'receipts',
  'incidents', 'vehicle_positions', 'events', 'notifications', 'sync_mutations', 'device_sync', 'photos', 'fuel_ledger', 'app_state',
];

export async function clearDynamic(db: DB) {
  await db.execute(dsql.raw(`TRUNCATE ${DYNAMIC_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`));
}

export async function seedDemoDay(db: DB, serviceDate: string, log: (m: string) => void) {
  await clearDynamic(db);

  // Fleet availability.
  const workshop = new Set([
    ...readCsv('task2b_peak_day_fleet.csv').filter((r) => r.status === 'in_workshop').map((r) => r.vehicle_id!),
    ...KANDY_WORKSHOP,
  ]);
  await db.update(s.vehicles).set({ status: 'available' });
  for (const id of workshop) await db.update(s.vehicles).set({ status: 'in_workshop' }).where(eq(s.vehicles.id, id));

  // History: days since each outlet was last served, from real dispatches before the analog day.
  const history = readCsv('deliveries_train.csv');
  const lastServed = new Map<string, string>();
  for (const r of history) {
    if (r.dispatch_status !== 'attempted' || !r.dispatch_date || r.dispatch_date >= ANALOG_DATE) continue;
    if ((lastServed.get(r.outlet_id!) ?? '') < r.dispatch_date) lastServed.set(r.outlet_id!, r.dispatch_date);
  }

  const outletRows = await db.select().from(s.outlets);
  const outletById = new Map(outletRows.map((o) => [o.id, o]));
  const hero = outletRows.find((o) => o.name.endsWith('Peradeniya'))!;

  const analog = history.filter((r) => r.order_date === ANALOG_DATE);
  if (!analog.some((r) => r.outlet_id === hero.id && r.temp_requirement === 'chilled')) {
    analog.push({ ...analog.find((r) => r.outlet_id === hero.id)!, temp_requirement: 'chilled', order_units: '80', order_weight_kg: '520', order_volume_m3: '2.6' });
  }

  // Five outlets were skipped on the previous run; their orders carry over and must not be skipped twice.
  const prevDate = await previousOperatingDate(db, serviceDate);
  const carriedOutlets = pickCarriedOver(analog, outletById, hero.id);

  const prefix: Record<string, string> = { Fresh: 'WF', Style: 'WS', Tech: 'WT' };
  let seq = 30880;
  const sorted = [...analog].sort((a, b) =>
    Number(carriedOutlets.has(b.outlet_id!)) - Number(carriedOutlets.has(a.outlet_id!)) || a.outlet_id!.localeCompare(b.outlet_id!) || a.temp_requirement!.localeCompare(b.temp_requirement!),
  );
  const placedAt = new Date(`${prevDate}T08:30:00+05:30`);
  const orderRows: (typeof s.orders.$inferInsert)[] = sorted.map((r, i) => {
    const isHero = r.outlet_id === hero.id && r.temp_requirement === 'chilled';
    let orderNo: string;
    if (isHero) orderNo = HERO_ORDER_NO;
    else {
      if (`WF-${seq}` === HERO_ORDER_NO) seq++;
      orderNo = `${prefix[r.brand!]}-${seq++}`;
    }
    const carried = carriedOutlets.has(r.outlet_id!) && r.temp_requirement === carriedOutlets.get(r.outlet_id!);
    const last = lastServed.get(r.outlet_id!);
    return {
      orderNo,
      outletId: r.outlet_id!,
      brand: r.brand!,
      district: r.district!,
      depot: r.depot!,
      temp: r.temp_requirement!,
      requestedDate: serviceDate,
      units: Math.round(num(r.order_units) * UPLIFT),
      weightKg: Math.round(num(r.order_weight_kg) * UPLIFT * 10) / 10,
      volumeM3: Math.round(num(r.order_volume_m3) * UPLIFT * 1000) / 1000,
      status: 'placed',
      placedAt: new Date(placedAt.getTime() + i * 97_000),
      deferredYesterday: carried,
      daysSinceLastServed: carried ? 2 : last ? Math.max(1, daysBetween(last, ANALOG_DATE)) : 7,
      note: carried ? `Carried over from ${formatDay(prevDate)}` : null,
    };
  });
  const inserted = await db.insert(s.orders).values(orderRows).returning();

  // Order lines in cases and crates, consistent with each order's units.
  const lines: (typeof s.orderLines.$inferInsert)[] = [];
  for (const o of inserted) {
    const options = PRODUCTS.filter((p) => p.brand === o.brand && p.temp === o.temp);
    const a = options[o.orderNo.charCodeAt(o.orderNo.length - 1) % options.length]!;
    const b = options[(o.orderNo.charCodeAt(o.orderNo.length - 2) + 1) % options.length]!;
    if (a.id === b.id || o.units < 2) lines.push({ orderId: o.id, productId: a.id, qty: o.units });
    else {
      const first = Math.ceil(o.units * 0.6);
      lines.push({ orderId: o.id, productId: a.id, qty: first }, { orderId: o.id, productId: b.id, qty: o.units - first });
    }
  }
  await db.insert(s.orderLines).values(lines);

  // Yesterday's deferral records for the carried-over orders.
  const carriedOrders = inserted.filter((o) => o.deferredYesterday);
  if (carriedOrders.length) {
    await db.insert(s.deferrals).values(
      carriedOrders.map((o) => ({
        orderId: o.id,
        date: prevDate,
        reason: o.temp === 'chilled' ? 'NO_REEFER_CAPACITY' : 'FLEET_EXHAUSTED',
        rule: o.temp === 'chilled' ? 'VOLUME' : 'MAX_TRIPS',
        detail: o.temp === 'chilled' ? 'No refrigerated capacity on the previous run.' : 'Fleet fully booked on the previous run.',
        repeatSkip: false,
        deferredTo: serviceDate,
        status: 'approved',
        approvedAt: new Date(`${prevDate}T16:40:00+05:30`),
      })),
    );
  }

  await seedFuelLedger(db, serviceDate);

  await db.insert(s.appState).values([
    { key: 'serviceDate', value: serviceDate },
    { key: 'cutoffClosed', value: false },
  ]);

  // Suresh drives whichever Kandy reefer the planner would give WF-30921, so the judge
  // walkthrough follows the reference order end to end.
  const asQueued = inserted.map((o) => ({ ...o, status: 'queued' }));
  const ctx = await loadRuleContext(db, serviceDate, asQueued);
  const plan = buildPlan({ ctx, orderIds: asQueued.map((o) => o.id), vehicleIds: await availableVehicleIds(db) });
  const heroOrder = inserted.find((o) => o.orderNo === HERO_ORDER_NO)!;
  const heroTrip = plan.trips.find((t) => t.orderIds.includes(heroOrder.id));
  const fallback = [...ctx.vehicles.values()].find((v) => v.depot === 'Kandy' && v.temp === 'reefer' && !workshop.has(v.id))!;
  const sureshVehicle = heroTrip?.vehicleId ?? fallback.id;
  await db.update(s.users).set({ vehicleId: sureshVehicle, depot: 'Kandy' }).where(eq(s.users.username, 'suresh'));

  log(
    `demo day ${serviceDate}: ${inserted.length} orders (${carriedOrders.length} carried over), ${workshop.size} vehicles in workshop; ` +
      `dry run serves ${plan.stats.served}, defers ${plan.stats.deferred}; Suresh drives ${sureshVehicle}`,
  );
}

function pickCarriedOver(
  analog: Record<string, string>[],
  outletById: Map<string, typeof s.outlets.$inferSelect>,
  heroId: string,
): Map<string, string> {
  const picks = new Map<string, string>();
  const want: Array<[string, string, string]> = [
    ['Peliyagoda', 'Fresh', 'chilled'],
    ['Peliyagoda', 'Fresh', 'chilled'],
    ['Kandy', 'Fresh', 'ambient'],
    ['Peliyagoda', 'Style', 'ambient'],
    ['Peliyagoda', 'Tech', 'ambient'],
  ];
  for (const [depot, brand, temp] of want) {
    const r = analog.find(
      (x) => x.depot === depot && x.brand === brand && x.temp_requirement === temp && !picks.has(x.outlet_id!) && x.outlet_id !== heroId && outletById.has(x.outlet_id!),
    );
    if (r) picks.set(r.outlet_id!, temp);
  }
  return picks;
}

/** Litres used on Monday and Tuesday of this week, from the analog week's real route legs. */
async function seedFuelLedger(db: DB, serviceDate: string) {
  const [cal] = await db.select().from(s.calendarDays).where(eq(s.calendarDays.date, serviceDate));
  if (!cal) return;
  const vehicles = new Map((await db.select().from(s.vehicles)).map((v) => [v.id, v]));
  const districts = new Map((await db.select().from(s.districts)).map((d) => [d.district, d]));
  const km = new Map<string, number>();
  const routes = new Map<string, { vehicle: string; district: string }>();
  for (const r of readCsv('route_legs_train.csv')) {
    if (!ANALOG_WEEK_BEFORE.includes(r.date!)) continue;
    km.set(r.vehicle_id!, (km.get(r.vehicle_id!) ?? 0) + num(r.distance_km));
    routes.set(r.route_id!, { vehicle: r.vehicle_id!, district: r.district! });
  }
  // Route legs stop at the last outlet; add each route's return leg to the depot.
  for (const { vehicle, district } of routes.values()) km.set(vehicle, (km.get(vehicle) ?? 0) + (districts.get(district)?.depotToDistrictKm ?? 0));
  const rows = [...km.entries()]
    .filter(([id]) => vehicles.has(id))
    .map(([vehicleId, k]) => ({ vehicleId, isoYear: cal.isoYear, isoWeek: cal.isoWeek, litres: Math.round((k / vehicles.get(vehicleId)!.kmPerL) * 10) / 10 }));
  if (rows.length) await db.insert(s.fuelLedger).values(rows);
}

