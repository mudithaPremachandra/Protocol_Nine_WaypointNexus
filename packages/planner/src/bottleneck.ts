import { DEFERRAL_REASONS, type DeferralReason, type PlanOrder, type RuleContext } from '@wn/domain';

export type ResourceKey = 'reefer' | 'dry' | 'van' | 'fuel';

export interface ResourceLoad {
  key: ResourceKey;
  label: string;
  demand: number;
  capacity: number;
  unit: string;
  /** demand / capacity; above 1 means the resource cannot cover the day. */
  ratio: number;
}

export interface Bottleneck {
  resource: ResourceKey | null;
  /** Depot where most deferrals happened; the headline's numbers are for this depot. */
  depot: string | null;
  /** One sentence for the plan board banner (D2). */
  headline: string;
  resources: ResourceLoad[];
  deferredByReason: Partial<Record<DeferralReason, number>>;
}

const REASON_RESOURCE: Partial<Record<DeferralReason, ResourceKey>> = {
  NO_REEFER_CAPACITY: 'reefer',
  NO_VAN_CAPACITY: 'van',
  CAPACITY: 'dry',
  FLEET_EXHAUSTED: 'dry',
  FUEL_QUOTA: 'fuel',
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Demand against capacity for each limiting resource (D1 header), and which one actually limited
 * service today (D2 banner). Capacity counts two trips per vehicle, the most a vehicle can run, so a
 * ratio above 1 means the resource could not cover the day even with perfect packing.
 */
export function demandVsCapacity(ctx: RuleContext, orders: readonly PlanOrder[], vehicleIds: readonly string[]): ResourceLoad[] {
  const vehicles = vehicleIds.map((id) => ctx.vehicles.get(id)!).filter(Boolean);
  const vanOnly = (o: PlanOrder) => ctx.outlets.get(o.outletId)?.parkingConstraint === 'van_only';

  const chilledVol = orders.filter((o) => o.temp === 'chilled').reduce((s, o) => s + o.volumeM3, 0);
  const dryVol = orders.filter((o) => o.temp === 'ambient' && !vanOnly(o)).reduce((s, o) => s + o.volumeM3, 0);
  const vanVol = orders.filter(vanOnly).reduce((s, o) => s + o.volumeM3, 0);

  const reeferCap = vehicles.filter((v) => v.temp === 'reefer').reduce((s, v) => s + v.volumeCapM3 * 2, 0);
  const dryCap = vehicles.filter((v) => v.temp === 'ambient' && v.type === 'truck').reduce((s, v) => s + v.volumeCapM3 * 2, 0);
  const vanCap = vehicles.filter((v) => v.type === 'van').reduce((s, v) => s + v.volumeCapM3 * 2, 0);

  // Fuel: litres needed for one trip per (depot, brand, district) bucket vs litres left this week.
  const buckets = new Set(orders.map((o) => `${o.depot}|${o.district}|${o.brand}`));
  const avgKmPerL = vehicles.length ? vehicles.reduce((s, v) => s + v.kmPerL, 0) / vehicles.length : 1;
  let fuelNeed = 0;
  for (const b of buckets) {
    const district = b.split('|')[1]!;
    const t = ctx.travel.get(district);
    if (t) fuelNeed += (t.depotToDistrictKm * 2) / avgKmPerL; // lower bound: one trip per bucket
  }
  const fuelLeft = vehicles.reduce((s, v) => s + Math.max(0, v.weeklyFuelQuotaL - (ctx.fuelUsedThisWeekL.get(v.id) ?? 0)), 0);

  const mk = (key: ResourceKey, label: string, demand: number, capacity: number, unit: string): ResourceLoad => ({
    key,
    label,
    demand: round(demand),
    capacity: round(capacity),
    unit,
    ratio: capacity > 0 ? round(demand / capacity) : demand > 0 ? Infinity : 0,
  });

  return [
    mk('reefer', 'Refrigerated space', chilledVol, reeferCap, 'm³'),
    mk('dry', 'Dry-box space', dryVol, dryCap, 'm³'),
    mk('van', 'Van-only stops', vanVol, vanCap, 'm³'),
    mk('fuel', 'Weekly fuel left', fuelNeed, fuelLeft, 'L'),
  ];
}

export function analyseBottleneck(
  ctx: RuleContext,
  orders: readonly PlanOrder[],
  vehicleIds: readonly string[],
  deferred: readonly { reason: DeferralReason; orderId: string }[],
): Bottleneck {
  const resources = demandVsCapacity(ctx, orders, vehicleIds);
  const deferredByReason: Partial<Record<DeferralReason, number>> = {};
  for (const d of deferred) deferredByReason[d.reason] = (deferredByReason[d.reason] ?? 0) + 1;

  if (deferred.length === 0) {
    return { resource: null, depot: null, headline: `All ${orders.length} orders fit today's fleet. Nothing deferred.`, resources, deferredByReason };
  }

  // Capacity doesn't move between depots, so the story is told for the depot that is squeezed.
  const byDepot = new Map<string, number>();
  for (const d of deferred) {
    const depot = ctx.orders.get(d.orderId)?.depot ?? '';
    byDepot.set(depot, (byDepot.get(depot) ?? 0) + 1);
  }
  const depot = [...byDepot.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const depotDeferred = deferred.filter((d) => ctx.orders.get(d.orderId)?.depot === depot);
  const depotReasons: Partial<Record<DeferralReason, number>> = {};
  for (const d of depotDeferred) depotReasons[d.reason] = (depotReasons[d.reason] ?? 0) + 1;
  const depotResources = demandVsCapacity(
    ctx,
    orders.filter((o) => o.depot === depot),
    vehicleIds.filter((id) => ctx.vehicles.get(id)?.depot === depot),
  );

  const [topReason, topCount] = Object.entries(depotReasons).sort((a, b) => b[1] - a[1])[0] as [DeferralReason, number];
  const resource = REASON_RESOURCE[topReason] ?? null;
  const load = depotResources.find((r) => r.key === resource);
  const tight = load ? load.ratio >= 1 : false;
  const label = DEFERRAL_REASONS[topReason].label.toLowerCase();

  let headline: string;
  const at = `at ${depot}`;
  const n = depotDeferred.length;
  if (resource === 'reefer' && load) {
    headline = tight
      ? `Refrigerated space is today's bottleneck ${at}: ${load.demand} m³ of chilled demand against ${load.capacity} m³ across two reefer trips; ${topCount} of ${n} deferrals are chilled.`
      : `Refrigerated trips are today's bottleneck ${at}: reefers have the space (${load.demand} of ${load.capacity} m³) but not the trips and Fresh minutes; ${topCount} of ${n} deferrals are chilled.`;
  } else if (resource === 'van' && load) {
    headline = `Vans are today's bottleneck ${at}: van-only outlets need ${load.demand} m³ and the vans carry ${load.capacity} m³ over two trips; ${topCount} van-only orders wait.`;
  } else if (topReason === 'TIME_BUDGET') {
    headline = `Driving time is today's bottleneck ${at}: ${topCount} of ${n} deferred orders fit no vehicle's time budget.`;
  } else if (topReason === 'DELIVERY_WINDOW') {
    headline = `Delivery windows are today's bottleneck ${at}: ${topCount} of ${n} deferred orders can't be reached inside their windows.`;
  } else if (topReason === 'FUEL_QUOTA') {
    headline = `Weekly fuel is today's bottleneck ${at}: ${topCount} of ${n} deferred orders would push vehicles past their quota.`;
  } else if (load) {
    headline = `${load.label} is today's bottleneck ${at}: ${load.demand} ${load.unit} needed against ${load.capacity} ${load.unit}; ${topCount} orders deferred (${label}).`;
  } else {
    headline = `${n} orders deferred ${at}, mostly: ${label}.`;
  }
  return { resource, depot, headline, resources, deferredByReason };
}
