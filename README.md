# Waypoint Nexus

**Protocol_Nine, Tech-Triathlon 2026 Hackathon.** Delivery planning for Waypoint Group, built from our Day 5 Designathon submission ([prototype](https://mudithapremachandra.github.io/rootcode-designathon/), [design video](https://youtu.be/amMkHaqMly8)).

One order record moves from the store manager to the dispatcher, the dock, the driver and back to the store. The planner respects every operating rule, names the day's bottleneck and gives every deferral a reason. The loader and driver screens keep working with no signal and reconcile when coverage returns.

| | |
|---|---|
| Live demo | `https://<your-host>` *(fill in after deploying, see [Deployment](#deployment))* |
| Demo video | *(YouTube link)* |
| Stack | TypeScript end to end: React + Vite installable PWA, Fastify API, PostgreSQL 16 (Drizzle), Docker Compose |

---

## Quick start

```bash
cp .env.example .env        # optional: every value has a working default
docker compose up           # Postgres, then the app: migrates, seeds, serves on :3000
```

Open **http://localhost:3000**. The first start loads the shared datasets (120 outlets, 60 vehicles, calendar, travel tables) and a realistic delivery day in about 5 seconds.

> The booklet's datasets live in `data/` (the `General Data`, `Training Data` and `Test Data` folders, exactly as shipped). The competition terms forbid publishing them, so **this repository is private** and shared with the judges.

## Seeded accounts

All passwords are **`waypoint123`**. The login page also has one-click buttons for the four personas.

| Role | Username | Who | Device |
|---|---|---|---|
| Dispatcher | `nimal` | Nimal Perera, plans both depots | Desktop |
| Store manager | `fathima` | Fathima Rizwan, Waypoint Fresh Peradeniya (OUT084) | Phone or desktop |
| Loader | `kasun` | Kasun Bandara, Kandy dock | Phone or tablet |
| Driver | `suresh` | Suresh Kumar, reefer truck VEH041 (Kandy) | Phone |

Every other outlet and vehicle has an account too: `store.out001`…`store.out120` and `driver.veh001`…`driver.veh060`. The Peliyagoda dock is `loader.peliyagoda`.

---

## Judge walkthrough

The seeded day is **Wed 29 Apr 2026**, two days before Vesak (festival ramp, monsoon). Its orders are a real day from `deliveries_train.csv` (Thu 8 May 2025, four days before Vesak 2025) with a 12 % festival uplift. Twelve vehicles are in the workshop: the booklet's peak-day list for Peliyagoda plus two at Kandy. **Demand exceeds capacity**: chilled demand at Peliyagoda outruns its 4 remaining reefers.

The walkthrough follows the design's reference order, **WF-30921** (chilled, Waypoint Fresh Peradeniya). Use a desktop window for the dispatcher and a phone or a narrow window (about 400 px) for the others. If someone has already used the deployment, sign in as `nimal` and click **Reset demo day** at the bottom left first.

### 1. Store manager places an order (SM1 → SM1C → SM2)
1. Sign in as **fathima**. *Deliveries* shows WF-30921 and her dry order waiting for tonight's plan.
2. Tap **New order**, adjust a few cases and crates, then tap **Place both orders**. Chilled and dry goods become two orders (chilled travels on a reefer), and weight and volume are worked out from the catalogue.
3. The confirmation shows both order numbers and what happens next.

### 2. Dispatcher closes the queue and plans (D1 → D2 → D3 → D3B)
4. Sign in as **nimal**. *Order queue* lists every order with its constraint badges: chilled, van-only, mall window, fragile, deferred yesterday. The header compares demand with capacity per depot.
5. Click **Close orders (16:00 cutoff)**, then **Build plan for both depots**. The plan is built in about 15 ms.
6. *Plan board*: 128+ of ~153 orders are planned, **0 rules broken**, and a banner names the bottleneck: *refrigerated trips at Peliyagoda*. Switch between the **Kandy** and **Peliyagoda** tabs. Each trip shows volume, weight, Fresh/day time and weekly fuel.
7. Click **VEH041, trip 1** (it carries WF-30921) to open the trip check. Every rule is listed with real numbers, including how the trip time is built (outbound + between stops + handling).
8. Switch to **Peliyagoda** and click **Try to place it** on a deferred order. Choose an ambient truck and the move is **blocked**, naming the rule (*Refrigeration*) and the numbers. Vehicles that would pass are suggested.

### 3. Dispatcher reviews deferrals and publishes (D4)
9. Open **Deferrals**. Each deferral has a reason, last-served date, repeat-skip flag, impact and next run. The banner confirms that the 4 orders carried over from the previous run were all served (no store is skipped twice). If a repeat skip occurs, a one-click **swap** with a lower-impact order is proposed.
10. Click **Approve plan and notify N stores**, then **Confirm and notify**. Plan v1 is published to both docks and every phone. Deferred stores get their reason and new date; every other store gets an arrival window.

### 4. Loader loads for unloading and flags a shortfall (L1 → L2 → L3 → L4)
11. Sign in as **kasun** (Kandy dock). The dock queue lists vehicles in departure order with the live plan version.
12. Open **VEH041**. The load sheet runs in reverse stop order (last stop loads first) and chilled items are marked.
13. On WF-30921, tap **Short or damaged**, set one line short by 2 and tap **Send flag**. Dispatch, the driver's expected count and the store are all told.
14. Tick every stop, tap **Ready to release**, confirm the reefer and doors, then tap **Release to driver**.

### 5. Driver delivers with no signal (Dr1 → Dr2 → Dr3 → Dr4 → DZ1)
15. Sign in as **suresh**. *Good morning* shows the trip saved on the phone, including the dock shortfall. Tap **Start trip 1**.
16. **Tap the signal badge** at the top to simulate the Kandy-hills dead zone; it turns amber, *No signal*. (Real airplane mode works too. The app shell is cached by the service worker and trips by IndexedDB.)
17. *Next stop* shows the arrival time against the window, the dock type and access notes. Tap **Arrived at stop**, take a photo, enter the receiver's name and tap **Complete stop**. It is saved on the phone. Record WF-30921 the same way when you reach it: counts are prefilled, net of the dock shortfall.
18. *(Optional dead-zone reconciliation)* While the phone is offline, sign in elsewhere as nimal and, in *Plan board*, open VEH041's trip check and **Defer** one of its pending stops. That publishes plan v2.
19. On the phone, open **Sync status**: records are *Queued*. Tap **Signal back: sync now**. Everything uploads (no duplicates, even if retried), and the phone shows **Plan changed while offline**: what changed, who changed it and when. Tap **Accept updated plan**.

### 6. Store manager confirms receipt (SM2 → SM3)
20. Sign in as **fathima**. WF-30921 shows *Part delivered* with the time, receiver and units, and the dock shortfall already explained. Tap **Confirm what arrived** to see the photo and counts, then **Confirm received** (or **Report an issue**).

### 7. Live operations and the cold-chain failure (D5, X1 → X2 → X3/X4/X5)
21. As **nimal**, open **Live operations**: a map of the depot's routes (recorded stops filled, remaining route dashed, late-risk routes in red; vehicles placed by the driver's phone GPS), each trip's progress, late risk, the driver's last sync ("last synced 22 min ago" is normal in the hills), the exception feed (the dock shortfall) and an activity log.
22. As **suresh**, mid-trip with a chilled stop left, tap **Report a problem** → *Refrigeration not holding temperature* → **Send to dispatch now**.
23. As **nimal**, an **Incident** entry appears in the menu. The recovery screen lists the stops at risk and options **already checked against the rules** (rescue with an idle reefer, reload at the depot, defer), each with on-time, late and deferred counts. Options that break a rule are shown as ruled out with the reason. Approve one: the system never re-routes by itself.
24. The change reaches everyone: the Kandy dock gets an **urgent release card** (X3), the drivers' phones show **Plan changed** (X4), and the store gets a **changed-delivery notice** asking staff to check the temperature on receipt (X5).

### 8. Capacity outlook (D6)
25. *Capacity outlook* projects the next ten weeks of chilled demand per depot and names the weeks where reefers needed exceed reefers available (Vesak and Poson weeks). The forecast is a transparent seasonal baseline, labelled illustrative until the Datathon model plugs in.

**Fast-forward for demos:** `node scripts/fast-forward.mjs loaded` resets the day and runs it up to "VEH041 released". The other targets are `closed`, `planned` and `published`.

---

## How it works

```
Browser (one SPA, role-routed, installable PWA)
 Dispatcher ── Store manager ── Loader (offline-capable) ── Driver (offline-first)
     │  REST + server-sent events           │  outbox + snapshot in IndexedDB
     ▼                                      ▼
Fastify API (modular monolith): auth · orders · planning · loading · delivery · receipts
                                incidents · sync · events/SSE · outlook · demo admin
     │ uses @wn/planner ─► @wn/domain (one rule checker, shared with the web app)
     ▼
PostgreSQL 16 (+ photo volume)
```

- **One rule checker.** `packages/domain` holds `validateVehicleDay`: capacity (kg and m³), refrigeration, van-only access, home depot, one brand and district per trip, the 270-minute Fresh and 480-minute Style/Tech budgets, at most 2 trips, delivery and mall windows (arrival simulation; early vehicles wait), and the weekly fuel quota. The planner, the move validator, the trip-check screen and the incident recovery all use it, so a plan can't contain a violation the UI didn't explain.
- **Planner** (`packages/planner`): priority ranking (repeat skips first, then chilled Fresh, dry Fresh, Tech, Style), then greedy placement that saves scarce vehicles (reefers, vans), then an ejection-chain improvement pass. Every unplaced order gets a reason derived from the rules that blocked it, and a bottleneck analysis covers the squeezed depot. See [docs/planner.md](docs/planner.md).
- **Offline.** Field records are append-only facts; plans are server-authoritative and versioned. Every field action becomes a mutation with a client UUID, written to IndexedDB first and pushed when there is signal. The server applies each UUID at most once. A delivery recorded offline is always kept; if its stop was reassigned meanwhile, dispatch gets a *possible double-serve* exception. A newer plan that changes the driver's stops is shown as a diff to accept (DZ1). See [docs/architecture.md](docs/architecture.md).
- **Vehicle location** comes from the driver's own phone: browser geolocation while a trip is in progress and the app is open, throttled to one fix per 2 min or 300 m, queued offline like everything else, and switchable off by the driver. Fixes outside Sri Lanka (a demo laptop) are ignored and the map falls back to the last recorded stop.
- **Late risk** comes from Waypoint's own history: `route_legs_train.csv` gives the arrival-delay distribution per district and stop position, and the risk is P(delay > slack), nudged by the day's road disruption.

Docs: [architecture](docs/architecture.md) · [data model](docs/data-model.md) · [planner](docs/planner.md) · [AI tool disclosure](docs/ai-disclosure.md)

## Departures from the Day 5 design

| Design | Built | Why |
|---|---|---|
| Illustrative IDs: VEH047 reefer carries WF-30921 | WF-30921 rides **VEH041** (in `vehicles.csv`, VEH047 is a dry-box truck) | The build seeds from the real datasets, as the design's assumption 8 said it would |
| Cold-chain options fixed at A/B/C | Options are **computed live** for whichever vehicle fails: rescue (idle reefer), reload at the depot, or defer, plus the best ruled-out option with its reason | Works for any incident, not just the scripted one |
| D5 schematic map with a live vehicle dot | **Real OpenStreetMap map** with actual depot and district locations; vehicles placed by the **driver's phone GPS** (browser geolocation) with a trail, falling back to the last recorded stop. Outlets sit at approximate fixed positions near their district town | The datasets have no coordinates. Phones only share location while the app is open (browsers can't track in the background), and the driver can switch it off |
| D6 chart in m³ against a capacity line | Reefers **needed** against reefers **available**, per depot | Volume capacity alone isn't the binding limit (trips and Fresh minutes are); vehicle counts are what a hire decision needs |
| Signature pad on Dr3 | Photo + receiver's name | Equivalent proof, and quicker for a driver who is stopped |
| Sinhala/Tamil strings | English only | As in the prototype; strings are kept short for translation |
| — | **Added:** login screen with persona shortcuts, *Reset demo day*, *Simulate no signal* toggle, demo-only vehicle switcher for drivers | Judges share one deployment and test on laptops |
| — | Incident times use the vehicle's **position in its plan** rather than the wall clock | The demo is evaluated outside real 03:30–08:00 operating hours |
| Arrival times from free-flow travel | Same, plus **consecutive orders for one outlet are one physical stop** (no driving between a Fresh store's dry and chilled orders) | Budgets still use the booklet's per-order formula, the conservative reading |

---

## Development

```bash
npm install
docker compose up -d db          # Postgres only
npm run dev:api                  # API on :3000 (reads .env, migrates and seeds on start)
npm run dev:web                  # Vite on :5173, proxies /api to :3000
npm test                         # domain and planner unit and property tests (30)
node scripts/smoke.mjs           # end-to-end API walkthrough across all four roles (23 checks)
```

Repository layout:

```
packages/domain     shared types, rule checker, trip arithmetic, mutation schemas (zod)
packages/planner    buildPlan, checkMove, suggestSwap, bottleneck analysis (+ tests)
apps/api            Fastify server: routes, services, Drizzle schema, migrations, seed
apps/web            React PWA: roles/{dispatcher,loader,driver,store}; screens named after the design IDs
data/               the booklet's datasets (not public)
docs/               architecture, data model, planner, AI disclosure
scripts/            smoke test, fast-forward, icon generator
```

## Deployment

The production stack uses the same Compose file, with Caddy for automatic HTTPS (service workers and installable PWAs require HTTPS):

```bash
# On a VM with Docker (2 vCPU / 4 GB is plenty), ports 80 and 443 open:
git clone <repo> && cd <repo>
cp .env.example .env
#   set JWT_SECRET to a long random string
#   set SITE_ADDRESS to your domain, or <server-ip>.sslip.io if you have none
docker compose --profile prod up -d --build
```

Verify with `node scripts/smoke.mjs https://<your-host>`. Note that this resets the demo day.
