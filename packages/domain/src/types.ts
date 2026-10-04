/** Core domain vocabulary, mirroring the column names in the booklet's shared datasets. */

export type Brand = 'Fresh' | 'Style' | 'Tech';
export type DepotName = 'Peliyagoda' | 'Kandy';
export type DockType = 'rear_dock' | 'street' | 'mall_bay';
export type ParkingConstraint = 'normal' | 'van_only' | 'mall_dock';
export type VehicleType = 'truck' | 'van';
export type VehicleTemp = 'reefer' | 'ambient';
export type TempRequirement = 'chilled' | 'ambient';
export type Role = 'dispatcher' | 'loader' | 'driver' | 'store_manager';

/** Clock time as minutes since midnight, Asia/Colombo. 05:30 -> 330. */
export type Minutes = number;

export interface TimeWindow {
  open: Minutes;
  close: Minutes;
}

export interface Outlet {
  id: string;
  name: string;
  brand: Brand;
  district: string;
  depot: DepotName;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  /** Fixed mall access window; null for outlets outside malls. */
  mallWindow: TimeWindow | null;
  window: TimeWindow;
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  temp: VehicleTemp;
  weightCapKg: number;
  volumeCapM3: number;
  fuelType: string;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  depot: DepotName;
}

export interface DistrictTravel {
  district: string;
  depot: DepotName;
  roadClass: string;
  freeFlowKmh: number;
  depotToDistrictKm: number;
  depotToDistrictMin: number;
  interStopKm: number;
  interStopMin: number;
}

/** An order as the planner sees it: one order is one stop (booklet Task 2B convention). */
export interface PlanOrder {
  id: string;
  orderNo: string;
  outletId: string;
  brand: Brand;
  district: string;
  depot: DepotName;
  temp: TempRequirement;
  units: number;
  weightKg: number;
  volumeM3: number;
  /** 1 if the outlet was skipped on the previous run. */
  deferredYesterday: boolean;
  daysSinceLastServed: number;
}

export type TripNo = 1 | 2;

export interface TripDraft {
  vehicleId: string;
  tripNo: TripNo;
  brand: Brand;
  district: string;
  depot: DepotName;
  /** Order ids in stop sequence. */
  orderIds: string[];
}

/** Everything the rule checker needs to evaluate trips. Pure data, no I/O. */
export interface RuleContext {
  outlets: ReadonlyMap<string, Outlet>;
  vehicles: ReadonlyMap<string, Vehicle>;
  orders: ReadonlyMap<string, PlanOrder>;
  travel: ReadonlyMap<string, DistrictTravel>;
  /** service_allowance.csv keyed by `${brand}|${dockType}`. */
  serviceAllowance: ReadonlyMap<string, number>;
  /** Litres already consumed this ISO week, per vehicle, before today's plan. */
  fuelUsedThisWeekL: ReadonlyMap<string, number>;
}
