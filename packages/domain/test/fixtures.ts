import type { DistrictTravel, Outlet, PlanOrder, RuleContext, Vehicle } from '../src';

/** Small hand-built network using the booklet's worked-example numbers (p.21). */
export function makeCtx(overrides: Partial<{ orders: PlanOrder[]; fuel: Record<string, number> }> = {}): RuleContext {
  const outlets: Outlet[] = [
    o('OUT001', 'Gampaha', 'rear_dock'),
    o('OUT002', 'Gampaha', 'rear_dock'),
    o('OUT003', 'Gampaha', 'street'),
    o('OUT004', 'Colombo', 'street'),
    o('OUT005', 'Colombo', 'street'),
    o('OUT006', 'Colombo', 'street'),
    o('OUT007', 'Colombo', 'street'),
    { ...o('OUT008', 'Colombo', 'street'), parkingConstraint: 'van_only' },
    {
      ...o('OUT009', 'Colombo', 'mall_bay', 'Style'),
      parkingConstraint: 'mall_dock',
      mallWindow: { open: 420, close: 540 },
      window: { open: 360, close: 720 },
    },
    { ...o('OUT010', 'Kandy', 'rear_dock'), depot: 'Kandy' },
  ];
  const vehicles: Vehicle[] = [
    v('VEH001', 'truck', 'reefer'),
    v('VEH002', 'truck', 'ambient'),
    v('VEH003', 'van', 'ambient', { weightCapKg: 800, volumeCapM3: 6 }),
    { ...v('VEH004', 'truck', 'reefer'), depot: 'Kandy' },
  ];
  const travel: DistrictTravel[] = [
    t('Gampaha', 37, 9, 30, 6),
    t('Colombo', 24, 8, 15, 4),
    { ...t('Kandy', 20, 10, 12, 5), depot: 'Kandy' },
  ];
  const orders = overrides.orders ?? [];
  return {
    outlets: new Map(outlets.map((x) => [x.id, x])),
    vehicles: new Map(vehicles.map((x) => [x.id, x])),
    orders: new Map(orders.map((x) => [x.id, x])),
    travel: new Map(travel.map((x) => [x.district, x])),
    serviceAllowance: new Map([
      ['Fresh|rear_dock', 15],
      ['Fresh|street', 16],
      ['Fresh|mall_bay', 20],
      ['Style|rear_dock', 18],
      ['Style|street', 22],
      ['Style|mall_bay', 25],
      ['Tech|rear_dock', 25],
      ['Tech|street', 30],
      ['Tech|mall_bay', 30],
    ]),
    fuelUsedThisWeekL: new Map(Object.entries(overrides.fuel ?? {})),
  };
}

function o(id: string, district: string, dockType: Outlet['dockType'], brand: Outlet['brand'] = 'Fresh'): Outlet {
  return {
    id,
    name: id,
    brand,
    district,
    depot: 'Peliyagoda',
    dockType,
    parkingConstraint: 'normal',
    mallWindow: null,
    window: { open: 240, close: 480 },
  };
}

function v(id: string, type: Vehicle['type'], temp: Vehicle['temp'], extra: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    type,
    temp,
    weightCapKg: 5000,
    volumeCapM3: 30,
    fuelType: 'diesel',
    kmPerL: 6,
    weeklyFuelQuotaL: 400,
    depot: 'Peliyagoda',
    ...extra,
  };
}

function t(district: string, outMin: number, interMin: number, outKm: number, interKm: number): DistrictTravel {
  return {
    district,
    depot: 'Peliyagoda',
    roadClass: 'urban',
    freeFlowKmh: 40,
    depotToDistrictKm: outKm,
    depotToDistrictMin: outMin,
    interStopKm: interKm,
    interStopMin: interMin,
  };
}

export function order(id: string, outletId: string, extra: Partial<PlanOrder> = {}): PlanOrder {
  const district =
    outletId === 'OUT010' ? 'Kandy' : ['OUT001', 'OUT002', 'OUT003'].includes(outletId) ? 'Gampaha' : 'Colombo';
  return {
    id,
    orderNo: id,
    outletId,
    brand: outletId === 'OUT009' ? 'Style' : 'Fresh',
    district,
    depot: outletId === 'OUT010' ? 'Kandy' : 'Peliyagoda',
    temp: 'ambient',
    units: 10,
    weightKg: 300,
    volumeM3: 2,
    deferredYesterday: false,
    daysSinceLastServed: 1,
    ...extra,
  };
}
