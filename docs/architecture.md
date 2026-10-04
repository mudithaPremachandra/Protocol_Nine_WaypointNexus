# Architecture

Waypoint Nexus is a **modular monolith**: one deployable Fastify server that serves the API and the built single-page app, backed by PostgreSQL. Two pure TypeScript packages hold the business rules and the planner. They have no I/O, are unit-tested on their own, and are shared by the server and the browser.

## Components

```mermaid
flowchart TB
  subgraph Browser["Browser: one React SPA, installable PWA"]
    D["Dispatcher<br/>D1–D6, X2<br/>desktop"]
    S["Store manager<br/>SM1–SM3, X5<br/>phone or desktop"]
    L["Loader<br/>L1–L4, X3<br/>dock tablet"]
    R["Driver<br/>Dr1–Dr4, X1, X4, DZ1<br/>personal phone"]
    SW["Service worker<br/>(app shell precache)"]
    IDB[("IndexedDB<br/>snapshots · outbox · photos")]
    L --- IDB
    R --- IDB
    SW -.-> L
    SW -.-> R
  end

  subgraph Server["Fastify API (Node 22)"]
    AUTH["auth<br/>JWT cookie, role guards"]
    ORD["orders"]
    PLAN["planning<br/>generate · move · swap · defer · publish"]
    FIELD["field views<br/>loader queue · driver snapshot · store view"]
    SYNC["sync<br/>idempotent mutation handler"]
    INC["incidents<br/>recovery options"]
    LIVE["live board · outlook"]
    EV["event log + SSE fan-out"]
    PHOTO["photo upload"]
  end

  subgraph Pkg["Shared packages (pure, no I/O)"]
    PL["@wn/planner<br/>buildPlan · checkMove · suggestSwap · bottleneck"]
    DOM["@wn/domain<br/>rule checker · trip time · mutation schemas"]
  end

  DB[("PostgreSQL 16")]
  VOL[("uploads volume")]

  D -- "REST" --> PLAN & ORD & LIVE & INC
  S -- "REST" --> ORD & FIELD
  L -- "GET snapshot / POST /sync/push" --> FIELD & SYNC
  R -- "GET snapshot / POST /sync/push" --> FIELD & SYNC
  R & L -- "multipart" --> PHOTO
  EV -- "server-sent events" --> D & S & L & R
  PLAN --> PL --> DOM
  INC --> DOM
  SYNC --> EV
  PLAN --> EV
  INC --> EV
  PLAN & ORD & FIELD & SYNC & INC & LIVE & EV --> DB
  PHOTO --> VOL
```

| Decision | Why |
|---|---|
| **One rule checker** (`@wn/domain.validateVehicleDay`) used by the planner, the manual-move validator, the trip-check screen and incident recovery | A plan can never contain a violation the UI didn't explain; "explainable assistance" (the design's core tradeoff) holds by construction |
| **Pure planner package** | Deterministic, fast (about 15 ms for a day), property-tested on random networks; could move to a worker unchanged |
| **Modular monolith, not services** | Right size for the team and the timeline; module boundaries (`apps/api/src/services/*`) keep it explainable |
| **SPA served by the API, same origin** | Simple cookies and service-worker scope; one container to run |
| **Server-sent events** for live updates | One-way push is all any screen needs; plain HTTP through any proxy; clients just refetch |
| **Times as minutes since midnight** (Asia/Colombo) | Matches the datasets' HH:MM convention and removes a class of timezone bugs |
| **Installable PWA, not native apps** | The booklet requires a responsive web app; our design explicitly chose an installable web app |

## Offline and reconciliation (dead zone, DZ1)

Principle: **field records are append-only facts; plans are server-authoritative and versioned.**

```mermaid
sequenceDiagram
  autonumber
  participant P as Driver phone (IndexedDB)
  participant API as API /sync
  participant DB as PostgreSQL
  participant Disp as Dispatcher

  P->>API: GET /driver/today (at the depot, on wifi)
  API-->>P: snapshot: trips, stops, access notes, plan v1
  Note over P: Signal drops in the Kandy hills
  P->>P: Complete stop: mutation {uuid, type, at, baseVersion: 1} saved to outbox, photo to photo queue
  Disp->>API: Defer a stop on VEH041
  API->>DB: write trips, bump plan to v2, event "plan.changed"
  Note over P: Signal returns
  P->>API: POST /sync/push [mutations]
  API->>DB: apply each uuid once (sync_mutations), record the delivery
  API-->>P: results: applied / duplicate / rejected (+ warning)
  P->>API: POST /photos (separate queue)
  P->>API: GET /driver/today
  API-->>P: snapshot v2 + change events (who, when, why)
  P->>P: v2 changes my stops, so show DZ1 diff and the driver accepts
  P->>API: mutation plan.ack v2
```

- **Idempotency.** Every mutation carries a client-generated UUID. `sync_mutations` stores the result per UUID, so a retried batch after a dropped connection returns `duplicate` and is never applied twice. Each mutation runs in its own transaction, so one bad record never blocks the rest.
- **Conflicts.** A proof of delivery is always accepted, because the goods physically arrived. If the plan had moved that stop to another vehicle, the server keeps the delivery **and** raises a `double_serve` exception on the dispatcher's live board. Nothing is silently dropped.
- **Optimistic UI.** Screens show the server snapshot overlaid with this device's queued actions (`apps/web/src/offline/field.ts`), so the driver sees the stop done immediately.
- **No Background Sync dependency** (iOS has none). The outbox flushes on reconnect, every 15 s, when the app regains focus and after each action.
- **Trust.** The sync screen (Dr4) lists exactly what is queued and synced. The dispatcher's board shows each driver's last sync as a normal state.
- **Demo aid.** Tapping the signal badge toggles *Simulate no signal*. Nothing leaves the device while it is on.

## Publishing a plan and the cold-chain recovery

```mermaid
sequenceDiagram
  autonumber
  participant Dr as Driver (VEH041)
  participant API
  participant Disp as Dispatcher (X2)
  participant Dock as Loader (X3)
  participant Dr2 as Rescue driver (X4)
  participant St as Store (X5)

  Dr->>API: incident.report reefer_fault (queued if offline)
  API->>API: recoveryOptions(): each candidate reefer checked with the same rules<br/>(capacity, Fresh budget, trips per day) plus arrival simulation from the vehicle's position
  Disp->>API: GET incident: options with on-time / late / deferred, ruled-out reasons
  Disp->>API: approve option (human decision; never automatic)
  API->>API: move chilled stops to the rescue vehicle, bump plan version, events + notifications
  API-->>Dock: SSE: urgent release card
  API-->>Dr: SSE: plan changed, hand over the chilled stops
  API-->>Dr2: SSE: plan changed, new trip
  API-->>St: notification: new vehicle, new arrival time, check temperature on receipt
```

## Vehicle location from the driver's phone

There is no in-truck telematics; the driver's phone is the GPS. While a trip is in progress and the app is open, the browser's geolocation API reports fixes. They are throttled to one per 2 minutes or 300 m, plus a fix at trip start and at every completed stop, stored in IndexedDB (`pings`) and uploaded in batches to `POST /api/driver/positions` (UUID-keyed, so retries are harmless). Positions recorded in a dead zone arrive later as a trail. Browsers don't allow background tracking, which matches the design: the phone is used when stopped. The driver can switch sharing off on Dr1. The live map uses the newest fix if it is under 30 minutes old and inside Sri Lanka; otherwise it shows the vehicle at its last recorded stop, and the tooltip always says how old the position is.

## Events

Every state change writes one row to `events` (actor, type, plan version, scope, payload). That single log:
- feeds **SSE** fan-out, filtered per user by scope (depot, vehicle, outlet, role);
- provides the **who, when and why** text on DZ1 and X4;
- is the **audit trail** the brief asks for ("deferrals lack a clear record").

## Security

- JWT in an httpOnly, SameSite=Lax cookie (Secure over HTTPS); passwords hashed with bcrypt.
- Every route has a role guard. Mutations are role-checked again per type in the sync handler, and a store manager can only confirm receipt for their own outlet.
- All request bodies are validated with zod. Photo uploads are limited to JPEG/PNG/WebP, at most 8 MB, stored under device-generated UUIDs.

## Deployment

```mermaid
flowchart LR
  U["Phones and desktops"] -- HTTPS --> C["Caddy<br/>(auto TLS)"] --> A["app container<br/>Fastify + SPA"] --> P[("postgres container<br/>pgdata volume")]
  A --> V[("uploads volume")]
```

`docker compose up` runs `db` and `app`. On first start the app runs the migrations and seeds the datasets and the demo day. `--profile prod` adds Caddy for HTTPS.
