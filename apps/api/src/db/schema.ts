import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Clock times are stored as integer minutes since midnight (Asia/Colombo), matching the
 * datasets' HH:MM convention; calendar dates as `date`. Instants (when something happened)
 * are timestamptz.
 */

/* ---------------------------- reference data ---------------------------- */

export const districts = pgTable('districts', {
  district: text('district').primaryKey(),
  depot: text('depot').notNull(),
  roadClass: text('road_class').notNull(),
  freeFlowKmh: doublePrecision('free_flow_kmh').notNull(),
  depotToDistrictKm: doublePrecision('depot_to_district_km').notNull(),
  depotToDistrictMin: integer('depot_to_district_min').notNull(),
  interStopKm: doublePrecision('inter_stop_km').notNull(),
  interStopMin: integer('inter_stop_min').notNull(),
});

export const outlets = pgTable('outlets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull(),
  district: text('district').notNull(),
  depot: text('depot').notNull(),
  dockType: text('dock_type').notNull(),
  parkingConstraint: text('parking_constraint').notNull(),
  mallWindowOpen: integer('mall_window_open'),
  mallWindowClose: integer('mall_window_close'),
  windowOpen: integer('window_open').notNull(),
  windowClose: integer('window_close').notNull(),
  accessNotes: text('access_notes'),
});

export const vehicles = pgTable('vehicles', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  temp: text('temp').notNull(),
  weightCapKg: doublePrecision('weight_cap_kg').notNull(),
  volumeCapM3: doublePrecision('volume_cap_m3').notNull(),
  fuelType: text('fuel_type').notNull(),
  kmPerL: doublePrecision('km_per_l').notNull(),
  weeklyFuelQuotaL: doublePrecision('weekly_fuel_quota_l').notNull(),
  depot: text('depot').notNull(),
  plate: text('plate').notNull(),
  /** available | in_workshop */
  status: text('status').notNull().default('available'),
});

export const calendarDays = pgTable('calendar_days', {
  date: date('date').primaryKey(),
  dow: integer('dow').notNull(),
  isoYear: integer('iso_year').notNull(),
  isoWeek: integer('iso_week').notNull(),
  isPayday: boolean('is_payday').notNull(),
  festival: text('festival'),
  festivalRamp: doublePrecision('festival_ramp').notNull(),
  isHoliday: boolean('is_holiday').notNull(),
  monsoon: boolean('monsoon').notNull(),
  isOperating: boolean('is_operating').notNull(),
});

export const serviceAllowances = pgTable(
  'service_allowances',
  {
    brand: text('brand').notNull(),
    dockType: text('dock_type').notNull(),
    minutes: integer('minutes').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brand, t.dockType] })],
);

export const trafficSpeed = pgTable(
  'traffic_speed',
  {
    district: text('district').notNull(),
    hour: integer('hour').notNull(),
    monsoon: boolean('monsoon').notNull(),
    speedIndex: doublePrecision('speed_index').notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.hour, t.monsoon] })],
);

export const roadConditions = pgTable(
  'road_conditions',
  {
    district: text('district').notNull(),
    date: date('date').notNull(),
    disruptionIndex: doublePrecision('disruption_index').notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.date] })],
);

/** Observed arrival delay (actual minus planned) per district and stop position, from route_legs_train.csv. */
export const delayStats = pgTable(
  'delay_stats',
  {
    district: text('district').notNull(),
    seq: integer('seq').notNull(),
    meanMin: doublePrecision('mean_min').notNull(),
    sdMin: doublePrecision('sd_min').notNull(),
    n: integer('n').notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.seq] })],
);

/** Weekly demand history per depot/brand, aggregated from deliveries_train.csv for the outlook (D6). */
export const demandHistory = pgTable(
  'demand_history',
  {
    depot: text('depot').notNull(),
    brand: text('brand').notNull(),
    isoYear: integer('iso_year').notNull(),
    isoWeek: integer('iso_week').notNull(),
    totalM3: doublePrecision('total_m3').notNull(),
    chilledM3: doublePrecision('chilled_m3').notNull(),
    orders: integer('orders').notNull(),
  },
  (t) => [primaryKey({ columns: [t.depot, t.brand, t.isoYear, t.isoWeek] })],
);

/** Litres each vehicle has already used in an ISO week before the plan being built. */
export const fuelLedger = pgTable(
  'fuel_ledger',
  {
    vehicleId: text('vehicle_id').notNull(),
    isoYear: integer('iso_year').notNull(),
    isoWeek: integer('iso_week').notNull(),
    litres: doublePrecision('litres').notNull(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.isoYear, t.isoWeek] })],
);

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  brand: text('brand').notNull(),
  name: text('name').notNull(),
  /** case | crate | carton | unit */
  unit: text('unit').notNull(),
  temp: text('temp').notNull(),
  weightKg: doublePrecision('weight_kg').notNull(),
  volumeM3: doublePrecision('volume_m3').notNull(),
});

/* -------------------------------- people -------------------------------- */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  outletId: text('outlet_id'),
  vehicleId: text('vehicle_id'),
  depot: text('depot'),
  phone: text('phone'),
});

/* ------------------------------- ordering ------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNo: text('order_no').notNull().unique(),
    outletId: text('outlet_id').notNull(),
    brand: text('brand').notNull(),
    district: text('district').notNull(),
    depot: text('depot').notNull(),
    temp: text('temp').notNull(),
    /** Delivery date the store asked for. */
    requestedDate: date('requested_date').notNull(),
    units: integer('units').notNull(),
    weightKg: doublePrecision('weight_kg').notNull(),
    volumeM3: doublePrecision('volume_m3').notNull(),
    /**
     * placed -> queued (cutoff closed) -> planned | deferred -> loaded -> in_transit
     * -> delivered | partial | failed -> received
     */
    status: text('status').notNull(),
    placedBy: uuid('placed_by'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    afterCutoff: boolean('after_cutoff').notNull().default(false),
    deferredYesterday: boolean('deferred_yesterday').notNull().default(false),
    daysSinceLastServed: integer('days_since_last_served').notNull().default(1),
    note: text('note'),
  },
  (t) => [index('orders_date_idx').on(t.requestedDate), index('orders_outlet_idx').on(t.outletId)],
);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  productId: text('product_id').notNull(),
  qty: integer('qty').notNull(),
});

/* ------------------------------- planning ------------------------------- */

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull().unique(),
  /** Bumped on every publish; field devices compare against it (DZ1). */
  version: integer('version').notNull().default(0),
  /** draft | published */
  status: text('status').notNull(),
  bottleneck: jsonb('bottleneck'),
  stats: jsonb('stats'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').notNull(),
    vehicleId: text('vehicle_id').notNull(),
    tripNo: integer('trip_no').notNull(),
    brand: text('brand').notNull(),
    district: text('district').notNull(),
    depot: text('depot').notNull(),
    /** planned | loading | released | in_progress | completed */
    status: text('status').notNull().default('planned'),
    plannedDepart: integer('planned_depart'),
    plannedReturn: integer('planned_return'),
    minutes: integer('minutes'),
    km: doublePrecision('km'),
    fuelL: doublePrecision('fuel_l'),
    checks: jsonb('checks'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: uuid('released_by'),
  },
  (t) => [uniqueIndex('trips_plan_vehicle_no').on(t.planId, t.vehicleId, t.tripNo)],
);

export const stops = pgTable(
  'stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').notNull(),
    orderId: uuid('order_id').notNull().unique(),
    seq: integer('seq').notNull(),
    plannedArrival: integer('planned_arrival'),
    lateRisk: doublePrecision('late_risk'),
    /** pending | delivered | partial | failed */
    status: text('status').notNull().default('pending'),
    loadedUnits: integer('loaded_units'),
    loadCheckedAt: timestamp('load_checked_at', { withTimezone: true }),
  },
  (t) => [index('stops_trip_idx').on(t.tripId)],
);

export const deferrals = pgTable(
  'deferrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    date: date('date').notNull(),
    reason: text('reason').notNull(),
    rule: text('rule'),
    detail: text('detail').notNull(),
    repeatSkip: boolean('repeat_skip').notNull().default(false),
    deferredTo: date('deferred_to').notNull(),
    /** proposed | approved */
    status: text('status').notNull().default('proposed'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    note: text('note'),
  },
  (t) => [uniqueIndex('deferrals_order_date').on(t.orderId, t.date)],
);

/* ------------------------------- execution ------------------------------ */

export const photos = pgTable('photos', {
  id: uuid('id').primaryKey(),
  path: text('path').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Raised by loaders (shortfall/damage), drivers (delivery problems, reefer faults) or stores. */
export const flags = pgTable('flags', {
  id: uuid('id').primaryKey(),
  /** shortfall | damage | reefer_fault | delivery_issue | receipt_issue | double_serve */
  type: text('type').notNull(),
  tripId: uuid('trip_id'),
  orderId: uuid('order_id'),
  raisedBy: uuid('raised_by'),
  role: text('role').notNull(),
  item: text('item'),
  qty: integer('qty'),
  note: text('note'),
  photoId: uuid('photo_id'),
  deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
});

/** Proof of delivery: an append-only fact recorded on the driver's phone. */
export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id').notNull(),
  stopId: uuid('stop_id'),
  driverId: uuid('driver_id'),
  vehicleId: text('vehicle_id'),
  /** delivered | partial | failed */
  outcome: text('outcome').notNull(),
  deliveredUnits: integer('delivered_units').notNull(),
  receiverName: text('receiver_name'),
  photoId: uuid('photo_id'),
  note: text('note'),
  deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  /** Plan version the phone had when it recorded this. */
  baseVersion: integer('base_version'),
});

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id').notNull(),
  userId: uuid('user_id'),
  /** confirmed | issue */
  status: text('status').notNull(),
  receivedUnits: integer('received_units'),
  note: text('note'),
  photoId: uuid('photo_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  tripId: uuid('trip_id'),
  vehicleId: text('vehicle_id').notNull(),
  reportedBy: uuid('reported_by'),
  deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note'),
  /** open | resolved */
  status: text('status').notNull().default('open'),
  options: jsonb('options'),
  chosenOption: text('chosen_option'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
});

/** Positions reported by the driver's phone (browser geolocation) during trips. Device UUID keys. */
export const vehiclePositions = pgTable(
  'vehicle_positions',
  {
    id: uuid('id').primaryKey(),
    vehicleId: text('vehicle_id').notNull(),
    driverId: uuid('driver_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: doublePrecision('accuracy_m'),
    deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('positions_vehicle_time_idx').on(t.vehicleId, t.deviceTime)],
);

/* --------------------------- events & delivery --------------------------- */

/** Append-only log of every state change: audit trail, SSE source and DZ1 diff text. */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    actorRole: text('actor_role'),
    type: text('type').notNull(),
    date: date('date'),
    planVersion: integer('plan_version'),
    /** Who should hear about it, for SSE fan-out: { depot?, outletIds?, vehicleIds?, roles? } */
    scope: jsonb('scope').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('events_date_idx').on(t.date)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: text('outlet_id').notNull(),
    orderId: uuid('order_id'),
    /** deferred | eta | changed | delivered | shortfall */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_outlet_idx').on(t.outletId)],
);

/** Idempotency for offline mutations: the client UUID is the key. */
export const syncMutations = pgTable('sync_mutations', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  result: jsonb('result').notNull(),
});

export const deviceSync = pgTable('device_sync', {
  userId: uuid('user_id').primaryKey(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }).notNull(),
  planVersionSeen: integer('plan_version_seen'),
  pending: integer('pending').notNull().default(0),
});

export const appState = pgTable('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
