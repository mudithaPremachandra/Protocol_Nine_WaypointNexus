import bcrypt from 'bcryptjs';
import { parseHHMM, parseWindow } from '@wn/domain';
import type { DB } from '../client';
import * as s from '../schema';
import { bool, num, readCsv, type Row } from './csv';
import { accessNote, BRAND_PREFIX, HERO_OUTLET_TOWN, personName, TOWNS } from './names';

export const DEMO_PASSWORD = 'waypoint123';

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** Loads the shared datasets (outlets, vehicles, calendar, travel, allowances) and fixed accounts. */
export async function seedReference(db: DB, log: (m: string) => void) {
  const districtRows = readCsv('district_travel.csv');
  await db.insert(s.districts).values(
    districtRows.map((r) => ({
      district: r.district!,
      depot: r.depot!,
      roadClass: r.road_class!,
      freeFlowKmh: num(r.free_flow_kmh),
      depotToDistrictKm: num(r.depot_to_district_km),
      depotToDistrictMin: num(r.depot_to_district_freeflow_min),
      interStopKm: num(r.inter_stop_km),
      interStopMin: num(r.inter_stop_freeflow_min),
    })),
  );

  // Outlets: give each a town name within its district; the first Kandy Fresh rear-dock outlet is
  // the design's hero store, Waypoint Fresh Peradeniya.
  const outletRows = readCsv('outlets.csv');
  const used = new Map<string, number>();
  const heroId = outletRows.find((r) => r.district === 'Kandy' && r.brand === 'Fresh' && r.parking_constraint === 'normal')?.outlet_id;
  const outlets = outletRows.map((r) => {
    const towns = (TOWNS[r.district!] ?? [r.district!]).filter((t) => t !== HERO_OUTLET_TOWN || r.outlet_id === heroId);
    let town: string;
    if (r.outlet_id === heroId) town = HERO_OUTLET_TOWN;
    else {
      const i = used.get(r.district!) ?? 0;
      used.set(r.district!, i + 1);
      town = towns[i % towns.length]! + (i >= towns.length ? ` ${Math.floor(i / towns.length) + 1}` : '');
    }
    const mall = parseWindow(r.mall_window);
    return {
      id: r.outlet_id!,
      name: `${BRAND_PREFIX[r.brand!]} ${town}`,
      brand: r.brand!,
      district: r.district!,
      depot: r.depot!,
      dockType: r.dock_type!,
      parkingConstraint: r.parking_constraint!,
      mallWindowOpen: mall?.open ?? null,
      mallWindowClose: mall?.close ?? null,
      windowOpen: parseHHMM(r.window_open_time!),
      windowClose: parseHHMM(r.window_close_time!),
      accessNotes: accessNote(r.dock_type!, r.parking_constraint!, r.mall_window || null),
    };
  });
  await db.insert(s.outlets).values(outlets);

  const vehicleRows = readCsv('vehicles.csv');
  await db.insert(s.vehicles).values(
    vehicleRows.map((r, i) => ({
      id: r.vehicle_id!,
      type: r.type!,
      temp: r.temp!,
      weightCapKg: num(r.weight_cap_kg),
      volumeCapM3: num(r.volume_cap_m3),
      fuelType: r.fuel_type!,
      kmPerL: num(r.km_per_l),
      weeklyFuelQuotaL: num(r.weekly_fuel_quota_l),
      depot: r.depot!,
      plate: `${r.depot === 'Kandy' ? 'CP' : 'WP'} ${r.type === 'van' ? 'PH' : 'LK'}-${String(4100 + i * 37).slice(-4)}`,
      status: 'available',
    })),
  );

  const calendarRows = readCsv('calendar.csv');
  await insertChunks(
    calendarRows.map((r) => ({
      date: r.date!,
      dow: num(r.dow),
      isoYear: num(r.iso_year),
      isoWeek: num(r.iso_week),
      isPayday: bool(r.is_payday),
      festival: r.festival || null,
      festivalRamp: num(r.festival_ramp),
      isHoliday: bool(r.is_holiday),
      monsoon: bool(r.monsoon),
      isOperating: bool(r.is_operating),
    })),
    (c) => db.insert(s.calendarDays).values(c),
  );

  await db.insert(s.serviceAllowances).values(
    readCsv('service_allowance.csv').map((r) => ({ brand: r.brand!, dockType: r.dock_type!, minutes: num(r.service_allowance_min) })),
  );

  await insertChunks(
    readCsv('traffic_speed.csv').map((r) => ({ district: r.district!, hour: num(r.hour), monsoon: bool(r.monsoon), speedIndex: num(r.speed_index) })),
    (c) => db.insert(s.trafficSpeed).values(c).onConflictDoNothing(),
  );

  await insertChunks(
    readCsv('road_conditions.csv').map((r) => ({ district: r.district!, date: r.date!, disruptionIndex: num(r.disruption_index) })),
    (c) => db.insert(s.roadConditions).values(c).onConflictDoNothing(),
    1000,
  );

  await seedDelayStats(db);
  await seedDemandHistory(db, calendarRows);
  await seedProducts(db);
  await seedUsers(db, outlets, vehicleRows, heroId!);
  log(`reference: ${outlets.length} outlets, ${vehicleRows.length} vehicles, ${calendarRows.length} calendar days`);
}

/** Arrival delay distribution per district and stop position (positions 5+ pooled). */
async function seedDelayStats(db: DB) {
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h! * 60 + m!;
  };
  const acc = new Map<string, number[]>();
  for (const r of readCsv('route_legs_train.csv')) {
    if (!r.arrival_time || !r.planned_arrival_time) continue;
    const key = `${r.district}|${Math.min(5, num(r.seq))}`;
    const list = acc.get(key) ?? [];
    list.push(mins(r.arrival_time) - mins(r.planned_arrival_time));
    acc.set(key, list);
  }
  const rows = [...acc.entries()].map(([key, xs]) => {
    const [district, seq] = key.split('|');
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    return { district: district!, seq: Number(seq), meanMin: Math.round(mean * 10) / 10, sdMin: Math.max(5, Math.round(sd * 10) / 10), n: xs.length };
  });
  await insertChunks(rows, (c) => db.insert(s.delayStats).values(c));
}

/** Weekly volume per depot and brand from deliveries_train.csv, for the capacity outlook (D6). */
async function seedDemandHistory(db: DB, calendarRows: Row[]) {
  const iso = new Map(calendarRows.map((r) => [r.date!, [num(r.iso_year), num(r.iso_week)] as const]));
  const agg = new Map<string, { depot: string; brand: string; isoYear: number; isoWeek: number; totalM3: number; chilledM3: number; orders: number }>();
  for (const r of readCsv('deliveries_train.csv')) {
    const w = iso.get(r.order_date!);
    if (!w) continue;
    const key = `${r.depot}|${r.brand}|${w[0]}|${w[1]}`;
    const a = agg.get(key) ?? { depot: r.depot!, brand: r.brand!, isoYear: w[0], isoWeek: w[1], totalM3: 0, chilledM3: 0, orders: 0 };
    const vol = num(r.order_volume_m3);
    a.totalM3 += vol;
    if (r.temp_requirement === 'chilled') a.chilledM3 += vol;
    a.orders++;
    agg.set(key, a);
  }
  await insertChunks([...agg.values()], (c) => db.insert(s.demandHistory).values(c));
}

/** A small catalogue so store managers order in cases and crates, not cubic metres (design SM1). */
export const PRODUCTS = [
  { id: 'F-DRY-RICE', brand: 'Fresh', name: 'Rice and grains', unit: 'case', temp: 'ambient', weightKg: 12, volumeM3: 0.03 },
  { id: 'F-DRY-TINS', brand: 'Fresh', name: 'Tinned goods', unit: 'case', temp: 'ambient', weightKg: 9, volumeM3: 0.025 },
  { id: 'F-DRY-HOME', brand: 'Fresh', name: 'Household and cleaning', unit: 'case', temp: 'ambient', weightKg: 7, volumeM3: 0.045 },
  { id: 'F-DRY-PROD', brand: 'Fresh', name: 'Fruit and vegetables', unit: 'crate', temp: 'ambient', weightKg: 10, volumeM3: 0.05 },
  { id: 'F-CHL-DAIRY', brand: 'Fresh', name: 'Dairy and yoghurt', unit: 'crate', temp: 'chilled', weightKg: 6, volumeM3: 0.03 },
  { id: 'F-CHL-MEAT', brand: 'Fresh', name: 'Meat and poultry', unit: 'case', temp: 'chilled', weightKg: 8, volumeM3: 0.03 },
  { id: 'F-CHL-FROZ', brand: 'Fresh', name: 'Frozen foods', unit: 'case', temp: 'chilled', weightKg: 7, volumeM3: 0.035 },
  { id: 'S-HANG', brand: 'Style', name: 'Hanging garments', unit: 'rail', temp: 'ambient', weightKg: 18, volumeM3: 0.6 },
  { id: 'S-CARTON', brand: 'Style', name: 'Folded garments', unit: 'carton', temp: 'ambient', weightKg: 9, volumeM3: 0.12 },
  { id: 'S-SHOES', brand: 'Style', name: 'Footwear', unit: 'carton', temp: 'ambient', weightKg: 7, volumeM3: 0.09 },
  { id: 'T-LARGE', brand: 'Tech', name: 'Large appliance', unit: 'unit', temp: 'ambient', weightKg: 65, volumeM3: 0.7 },
  { id: 'T-TV', brand: 'Tech', name: 'Television', unit: 'unit', temp: 'ambient', weightKg: 18, volumeM3: 0.25 },
  { id: 'T-SMALL', brand: 'Tech', name: 'Small electronics', unit: 'carton', temp: 'ambient', weightKg: 6, volumeM3: 0.04 },
] as const;

async function seedProducts(db: DB) {
  await db.insert(s.products).values(PRODUCTS.map((p) => ({ ...p })));
}

async function seedUsers(db: DB, outlets: { id: string; name: string; depot: string }[], vehicleRows: Row[], heroOutletId: string) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: (typeof s.users.$inferInsert)[] = [
    { username: 'nimal', name: 'Nimal Perera', role: 'dispatcher', depot: null, passwordHash: hash },
    { username: 'kasun', name: 'Kasun Bandara', role: 'loader', depot: 'Kandy', passwordHash: hash },
    { username: 'loader.peliyagoda', name: 'Chamara Silva', role: 'loader', depot: 'Peliyagoda', passwordHash: hash },
    { username: 'fathima', name: 'Fathima Rizwan', role: 'store_manager', outletId: heroOutletId, passwordHash: hash },
  ];
  // Suresh's vehicle is set when the demo day is seeded (he drives the reefer carrying WF-30921).
  users.push({ username: 'suresh', name: 'Suresh Kumar', role: 'driver', passwordHash: hash, phone: '+94 77 412 9921' });
  vehicleRows.forEach((v, i) =>
    users.push({
      username: `driver.${v.vehicle_id!.toLowerCase()}`,
      name: personName(i + 5),
      role: 'driver',
      vehicleId: v.vehicle_id!,
      depot: v.depot!,
      passwordHash: hash,
      phone: `+94 77 ${String(300000 + i * 1234).slice(0, 3)} ${String(1000 + i * 77).slice(0, 4)}`,
    }),
  );
  outlets
    .filter((o) => o.id !== heroOutletId)
    .forEach((o, i) =>
      users.push({ username: `store.${o.id.toLowerCase()}`, name: personName(i + 11), role: 'store_manager', outletId: o.id, passwordHash: hash }),
    );
  await db.insert(s.users).values(users);
}
