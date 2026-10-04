import type { Check } from '@wn/domain';

/* Shapes returned by the API (see apps/api/src/services). */

export interface Order {
  id: string;
  orderNo: string;
  outletId: string;
  brand: string;
  district: string;
  depot: string;
  temp: 'chilled' | 'ambient';
  requestedDate: string;
  units: number;
  weightKg: number;
  volumeM3: number;
  status: string;
  placedAt: string;
  afterCutoff: boolean;
  deferredYesterday: boolean;
  daysSinceLastServed: number;
  note: string | null;
}

export interface OutletLite {
  id: string;
  name: string;
  district?: string;
  brand?: string;
  dockType: string;
  parkingConstraint: string;
  windowOpen: number;
  windowClose: number;
  mallWindowOpen: number | null;
  mallWindowClose: number | null;
  accessNotes?: string | null;
}

export interface Vehicle {
  id: string;
  type: 'truck' | 'van';
  temp: 'reefer' | 'ambient';
  weightCapKg: number;
  volumeCapM3: number;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  depot: string;
  plate: string;
  status: string;
}

export interface ResourceLoad {
  key: 'reefer' | 'dry' | 'van' | 'fuel';
  label: string;
  demand: number;
  capacity: number;
  unit: string;
  ratio: number;
}

export interface PlanTrip {
  id: string;
  vehicleId: string;
  tripNo: number;
  brand: string;
  district: string;
  depot: string;
  status: string;
  plannedDepart: number | null;
  plannedReturn: number | null;
  minutes: number | null;
  km: number | null;
  fuelL: number | null;
  checks: Check[];
  vehicle: Vehicle;
  load: { weightKg: number; volumeM3: number; units: number };
  stops: { id: string; seq: number; plannedArrival: number | null; lateRisk: number | null; status: string; order: Order; outlet: OutletLite }[];
}

export interface Deferral {
  id: string;
  orderId: string;
  date: string;
  reason: string;
  reasonLabel: string;
  rule: string | null;
  detail: string;
  repeatSkip: boolean;
  deferredTo: string;
  status: 'proposed' | 'approved';
  note: string | null;
  order: Order;
  outlet: { id: string; name: string; district: string; brand: string };
  priority: number | null;
  lastServedDaysAgo: number;
  swap: { orderId: string; victimOrderId: string; vehicleId: string; tripNo: number; victim: Order | null; victimOutlet: string | null } | null;
}

export interface Bottleneck {
  resource: string | null;
  depot: string | null;
  headline: string;
  resources: ResourceLoad[];
  deferredByReason: Record<string, number>;
}

export interface PlanView {
  serviceDate: string;
  cutoffClosed: boolean;
  plan: { id: string; date: string; version: number; status: 'draft' | 'published'; bottleneck: Bottleneck; stats: { orders: number; served: number; deferred: number; trips: number; vehiclesUsed: number; ms: number }; publishedAt: string | null } | null;
  trips: PlanTrip[];
  deferrals: Deferral[];
  resources: ResourceLoad[];
  vehicles: Vehicle[];
}

export interface QueueView {
  serviceDate: string;
  serviceDay: string;
  cutoffClosed: boolean;
  orders: (Order & { outlet: OutletLite & { district: string }; fragile: boolean })[];
}

export interface TripCheck {
  trip: PlanTrip;
  vehicle: Vehicle;
  checks: Check[];
  breakdown: { outbound: number; interStop: number; handling: number; total: number };
  stops: { orderId: string; orderNo: string; outletId: string; outletName: string; seq: number; arrive: number; serviceStart: number; waitMin: number; lateMin: number; temp: string; units: number; weightKg: number; volumeM3: number; arriveText: string; windowText: string }[];
  timing: { depart: string; return: string };
}

export interface MoveResult {
  ok: boolean;
  applied: boolean;
  checks: Check[];
  failing: Check[];
  suggestions: { vehicleId: string; tripNo: number; isNewTrip: boolean }[];
}

/* ---------- field (loader / driver) ---------- */

export interface FieldStop {
  id: string;
  seq: number;
  status: string;
  plannedArrival: number | null;
  lateRisk: number | null;
  loadedUnits: number | null;
  loadCheckedAt: string | null;
  order: { id: string; orderNo: string; temp: string; units: number; weightKg: number; volumeM3: number; status: string; lines: { productId: string; name: string; unit: string; qty: number }[] };
  outlet: OutletLite & { district: string; accessNotes: string | null };
  flags: { id: string; type: string; item: string | null; qty: number | null; note: string | null; role: string; photoId: string | null }[];
  delivery: { id: string; outcome: string; deliveredUnits: number; receiverName: string | null; deviceTime: string; photoId: string | null } | null;
}

export interface FieldTrip {
  id: string;
  vehicleId: string;
  vehicle: Vehicle;
  tripNo: number;
  brand: string;
  district: string;
  depot: string;
  status: string;
  plannedDepart: number | null;
  plannedReturn: number | null;
  minutes: number | null;
  km: number | null;
  releasedAt: string | null;
  stops: FieldStop[];
}

export interface PlanChange {
  id: number;
  type: string;
  at: string;
  actorName: string | null;
  planVersion: number | null;
  payload: { message?: string; vehicles?: string[]; rescueVehicle?: string; failedVehicle?: string; depart?: string; kind?: string };
}

export interface DriverSnapshot {
  serviceDate: string;
  serviceDay: string;
  planVersion: number;
  published: boolean;
  vehicle: Vehicle | null;
  trips: FieldTrip[];
  changes: PlanChange[];
  incidents: { id: string; type: string; status: string; chosenOption: string | null; deviceTime: string; note: string | null }[];
  serverTime: string;
}

export interface LoaderQueue {
  serviceDate: string;
  serviceDay: string;
  depot: string;
  planVersion: number;
  published: boolean;
  trips: FieldTrip[];
  changes: PlanChange[];
  urgent: { id: string; vehicleId: string; chosenOption: string | null; approvedAt: string; options: { options: { key: string; label: string; depart: string | null; kind: string; vehicleId: string | null }[] } | null }[];
  serverTime: string;
}

/* ---------- store ---------- */

export interface StoreOrder extends Order {
  lines: { id: string; productId: string; qty: number; name?: string; unit?: string }[];
  eta: { from: string; to: string } | null;
  vehicleId: string | null;
  tripStatus: string | null;
  deferral: { reason: string; label: string; storeText: string; deferredTo: string; deferredToDay: string; fromDay: string; note: string | null } | null;
  delivery: { id: string; outcome: string; deliveredUnits: number; receiverName: string | null; deviceTime: string; photoId: string | null; note: string | null; vehicleId: string | null } | null;
  receipt: { id: string; status: string; receivedUnits: number | null; createdAt: string; note: string | null } | null;
  flags: { id: string; type: string; item: string | null; qty: number | null; note: string | null; role: string; deviceTime: string }[];
}

export interface StoreView {
  serviceDate: string;
  serviceDay: string;
  cutoffClosed: boolean;
  outlet: OutletLite & { brand: string; district: string; depot: string };
  notifications: { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null; orderId: string | null }[];
  orders: StoreOrder[];
}

export interface Product {
  id: string;
  brand: string;
  name: string;
  unit: string;
  temp: 'chilled' | 'ambient';
  weightKg: number;
  volumeM3: number;
}
