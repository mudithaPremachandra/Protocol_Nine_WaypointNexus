import type { DistrictTravel, Outlet, PlanOrder, RuleContext, Vehicle } from '@wn/domain';

/** Deterministic PRNG (mulberry32) so failing property cases are reproducible from the seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DISTRICTS: Array<[string, 'Peliyagoda' | 'Kandy', number, number, number, number]> = [
  ['Colombo', 'Peliyagoda', 24, 8, 15, 4],
  ['Gampaha', 'Peliyagoda', 37, 9, 30, 6],
  ['Kalutara', 'Peliyagoda', 70, 12, 60, 7],
  ['Kurunegala', 'Peliyagoda', 110, 14, 95, 8],
  ['Kandy', 'Kandy', 20, 10, 12, 5],
  ['Matale', 'Kandy', 55, 13, 28, 7],
  ['Nuwara Eliya', 'Kandy', 140, 18, 78, 9],
];

export interface RandomNetworkOptions {
  outlets?: number;
  vehicles?: number;
  ordersPerOutlet?: number;
  sizeScale?: number;
}

export function randomNetwork(seed: number, opts: RandomNetworkOptions = {}): { ctx: RuleContext; orderIds: string[]; vehicleIds: string[] } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const nOutlets = opts.outlets ?? 40;
  const nVehicles = opts.vehicles ?? 12;
  const scale = opts.sizeScale ?? 1;

  const travel: DistrictTravel[] = DISTRICTS.map(([district, depot, outMin, interMin, outKm, interKm]) => ({
    district,
    depot,
    roadClass: 'urban',
    freeFlowKmh: 40,
    depotToDistrictMin: outMin,
    interStopMin: interMin,
    depotToDistrictKm: outKm,
    interStopKm: interKm,
  }));

  const outlets: Outlet[] = [];
  for (let i = 0; i < nOutlets; i++) {
    const [district, depot] = pick(DISTRICTS);
    const brand = pick(['Fresh', 'Fresh', 'Fresh', 'Style', 'Tech'] as const);
    const mall = brand === 'Style' && r() < 0.5;
    const open = brand === 'Fresh' ? 240 + Math.floor(r() * 4) * 15 : 420 + Math.floor(r() * 8) * 30;
    outlets.push({
      id: `OUT${String(i + 1).padStart(3, '0')}`,
      name: `Outlet ${i + 1}`,
      brand,
      district,
      depot,
      dockType: mall ? 'mall_bay' : pick(['rear_dock', 'street'] as const),
      parkingConstraint: mall ? 'mall_dock' : r() < 0.1 ? 'van_only' : 'normal',
      mallWindow: mall ? { open: 360, close: 600 } : null,
      window: brand === 'Fresh' ? { open, close: 480 } : { open, close: open + 240 },
    });
  }

  const vehicles: Vehicle[] = [];
  for (let i = 0; i < nVehicles; i++) {
    const type = r() < 0.15 ? 'van' : 'truck';
    vehicles.push({
      id: `VEH${String(i + 1).padStart(3, '0')}`,
      type,
      temp: r() < 0.3 ? 'reefer' : 'ambient',
      weightCapKg: type === 'van' ? 1200 : 4000 + Math.floor(r() * 4000),
      volumeCapM3: type === 'van' ? 8 : 18 + Math.floor(r() * 16),
      fuelType: 'diesel',
      kmPerL: type === 'van' ? 10 : 5 + r() * 3,
      weeklyFuelQuotaL: 150 + Math.floor(r() * 250),
      depot: i % 3 === 2 ? 'Kandy' : 'Peliyagoda',
    });
  }

  const orders: PlanOrder[] = [];
  let n = 0;
  for (const outlet of outlets) {
    const count = outlet.brand === 'Fresh' ? (r() < 0.5 ? 2 : 1) : r() < 0.6 ? 1 : 0;
    for (let k = 0; k < count * (opts.ordersPerOutlet ?? 1); k++) {
      const chilled = outlet.brand === 'Fresh' && k === 1;
      const vol = (outlet.brand === 'Style' ? 3 + r() * 6 : outlet.brand === 'Tech' ? 1 + r() * 3 : 1 + r() * 4) * scale;
      const kg = (outlet.brand === 'Tech' ? vol * 300 : outlet.brand === 'Style' ? vol * 60 : vol * 180) * scale;
      n++;
      orders.push({
        id: `O${n}`,
        orderNo: `WF-${10000 + n}`,
        outletId: outlet.id,
        brand: outlet.brand,
        district: outlet.district,
        depot: outlet.depot,
        temp: chilled ? 'chilled' : 'ambient',
        units: Math.ceil(vol * 10),
        weightKg: Math.round(kg),
        volumeM3: Math.round(vol * 10) / 10,
        deferredYesterday: r() < 0.08,
        daysSinceLastServed: 1 + Math.floor(r() * 4),
      });
    }
  }

  const allowance = new Map<string, number>();
  for (const b of ['Fresh', 'Style', 'Tech']) {
    allowance.set(`${b}|rear_dock`, b === 'Tech' ? 25 : 15);
    allowance.set(`${b}|street`, b === 'Tech' ? 30 : 16);
    allowance.set(`${b}|mall_bay`, b === 'Style' ? 25 : 20);
  }

  return {
    ctx: {
      outlets: new Map(outlets.map((o) => [o.id, o])),
      vehicles: new Map(vehicles.map((v) => [v.id, v])),
      orders: new Map(orders.map((o) => [o.id, o])),
      travel: new Map(travel.map((t) => [t.district, t])),
      serviceAllowance: allowance,
      fuelUsedThisWeekL: new Map(vehicles.map((v) => [v.id, Math.floor(r() * v.weeklyFuelQuotaL * 0.5)])),
    },
    orderIds: orders.map((o) => o.id),
    vehicleIds: vehicles.map((v) => v.id),
  };
}
