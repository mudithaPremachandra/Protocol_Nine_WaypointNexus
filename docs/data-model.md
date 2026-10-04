# Data model

PostgreSQL 16, schema in [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle), migrations in `apps/api/drizzle/`.

Conventions: clock times are **integer minutes since midnight, Asia/Colombo** (e.g. 05:30 → 330), matching the datasets' `HH:MM`. Calendar days are `date`. Instants (when something happened on a device or the server) are `timestamptz`. Rows created on a device (deliveries, flags, receipts, incidents, photos) use **device-generated UUIDs** as primary keys, which is part of what makes offline sync idempotent.

```mermaid
erDiagram
  districts ||--o{ outlets : "district"
  outlets ||--o{ orders : "places"
  orders ||--o{ order_lines : "contains"
  products ||--o{ order_lines : ""
  plans ||--o{ trips : "has"
  vehicles ||--o{ trips : "runs (max 2/day)"
  trips ||--o{ stops : "sequence"
  orders ||--o| stops : "planned as"
  orders ||--o{ deferrals : "deferred with reason"
  orders ||--o{ deliveries : "proof of delivery"
  orders ||--o{ receipts : "confirmed by store"
  orders ||--o{ flags : "shortfall / issue"
  trips ||--o{ flags : ""
  vehicles ||--o{ incidents : "fault"
  outlets ||--o{ notifications : "store notices"
  users ||--o{ sync_mutations : "offline actions"
  users ||--o| device_sync : "last sync"
  vehicles ||--o{ fuel_ledger : "weekly litres"

  outlets {
    text id PK "OUT001..OUT120"
    text brand
    text district
    text depot
    text dock_type
    text parking_constraint
    int window_open
    int window_close
    int mall_window_open
    int mall_window_close
  }
  vehicles {
    text id PK "VEH001..VEH060"
    text type "truck | van"
    text temp "reefer | ambient"
    float weight_cap_kg
    float volume_cap_m3
    float km_per_l
    float weekly_fuel_quota_l
    text depot
    text status "available | in_workshop"
  }
  orders {
    uuid id PK
    text order_no UK "WF-30921"
    text outlet_id FK
    text temp "chilled | ambient"
    date requested_date
    int units
    float weight_kg
    float volume_m3
    text status "placed→queued→planned|deferred→loaded→in_transit→delivered|partial|failed→received"
    bool deferred_yesterday
    int days_since_last_served
  }
  plans {
    uuid id PK
    date date UK
    int version "bumped on every publish/change"
    text status "draft | published"
    jsonb bottleneck
  }
  trips {
    uuid id PK
    uuid plan_id FK
    text vehicle_id FK
    int trip_no "1 | 2"
    text brand
    text district
    int planned_depart
    int minutes
    float fuel_l
    jsonb checks "rule results snapshot"
    text status "planned→loading→released→in_progress→completed"
  }
  stops {
    uuid id PK
    uuid trip_id FK
    uuid order_id FK, UK
    int seq
    int planned_arrival
    float late_risk
    int loaded_units
    text status
  }
  deferrals {
    uuid id PK
    uuid order_id FK
    date date
    text reason "NO_REEFER_CAPACITY, TIME_BUDGET, ..."
    text detail
    bool repeat_skip
    date deferred_to
    text status "proposed | approved"
  }
  deliveries {
    uuid id PK "device UUID"
    uuid order_id FK
    text outcome
    int delivered_units
    text receiver_name
    uuid photo_id
    timestamptz device_time
    int base_version
  }
  events {
    bigserial id PK
    text type
    int plan_version
    jsonb scope "who hears it"
    jsonb payload
  }
  sync_mutations {
    uuid id PK "client mutation UUID"
    uuid user_id
    jsonb result
  }
```

## Tables by purpose

| Group | Tables | Notes |
|---|---|---|
| Reference (seeded from the booklet CSVs) | `outlets`, `vehicles`, `districts` (district_travel), `calendar_days`, `service_allowances`, `traffic_speed`, `road_conditions` | Loaded verbatim. Outlets also get a display name from their district's towns, and access notes |
| Derived from history | `demand_history` (weekly m³ per depot and brand, from `deliveries_train.csv`), `delay_stats` (arrival delay mean and sd per district and stop position, from `route_legs_train.csv`), `fuel_ledger` (litres used earlier in the week) | Feed the capacity outlook, late risk and the fuel-quota rule |
| People | `users` | Role plus a link to an outlet, a vehicle or a depot |
| Ordering | `orders`, `order_lines`, `products` | Stores order in cases and crates; weight and volume come from the catalogue |
| Planning | `plans`, `trips`, `stops`, `deferrals` | One plan per delivery date; `version` drives reconciliation on devices |
| Execution | `flags`, `deliveries`, `receipts`, `incidents`, `photos`, `vehicle_positions` (phone GPS fixes) | Append-only facts from the field, keyed by device UUIDs |
| Infrastructure | `events`, `notifications`, `sync_mutations`, `device_sync`, `app_state` | Audit log and SSE source, store notices, idempotency, last-sync tracking, demo clock |

## Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> placed: store manager (before cutoff)
  placed --> queued: dispatcher closes orders (16:00)
  [*] --> queued: placed after cutoff (next run)
  queued --> planned: planner places it
  queued --> deferred: no feasible trip (reason recorded)
  planned --> deferred: dispatcher defers / swap / vehicle fault
  deferred --> planned: dispatcher places it (validated)
  planned --> loaded: loader releases the trip
  loaded --> in_transit: driver starts the trip
  in_transit --> delivered
  in_transit --> partial
  in_transit --> failed
  delivered --> received: store confirms
  partial --> received
```
