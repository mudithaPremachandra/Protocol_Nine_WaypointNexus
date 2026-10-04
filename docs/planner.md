# Planning and allocation engine

Code: [`packages/domain/src/rules.ts`](../packages/domain/src/rules.ts) (rules) and [`packages/planner/src`](../packages/planner/src) (allocation). Both are pure TypeScript with no I/O and are tested in isolation (`npm test`).

## Rules enforced (booklet pp. 5 and 20–21)

Every candidate placement is checked by `validateVehicleDay(ctx, vehicle, trips)`, which returns **every** check with its real numbers (`{rule, ok, actual, limit, message}`):

| Rule | Check |
|---|---|
| One brand and district per trip | All stops on a trip share `brand` and `district` |
| Home depot | Vehicle depot = outlet depot |
| Refrigeration | Chilled orders need `temp = reefer`; reefers may carry ambient goods |
| Van-only access | `parking_constraint = van_only` needs `type = van` |
| Weight and volume | Σ `order_weight_kg` ≤ `weight_cap_kg` and Σ `order_volume_m3` ≤ `volume_cap_m3`, per trip |
| Trips per day | At most 2 trips per vehicle |
| Time budget | trip minutes = outbound + inter-stop × (n−1) + Σ service allowance(brand, dock type). Fresh trips ≤ **270** min per vehicle; Style and Tech combined ≤ **480** min |
| Delivery windows | Arrival simulation: Fresh trips leave from 03:30, a vehicle leaves late enough to reach its first stop as the window opens, trip 2 leaves when trip 1 is back, an early vehicle waits for the window, and the mall window narrows the outlet window. Late = arrival after the window closes |
| Weekly fuel quota | (litres already used this ISO week + today's km ÷ km_per_l) ≤ `weekly_fuel_quota_l`, with km = 2 × depot-to-district + inter-stop × (n−1) |

The booklet's worked examples (Gampaha 101 min, Colombo 112 min, 213 of 270 Fresh minutes) are unit tests.

## Algorithm

1. **Rank** queued orders with one explicit policy (`priority.ts`):
   `score = base + repeat-skip boost + 3 × (days since served − 1, capped at 7)`
   with base: chilled Fresh 60, dry Fresh 50, Tech 35, Style 30, and **+100 if the outlet was skipped on the previous run** (no store should be skipped twice in a row). Ties go largest-first, which packs bins better.
2. **Greedy placement** (`state.ts`): for each order, list every legal placement:
   - **join** an existing trip with the same brand and district (stops re-sequenced earliest-deadline-first), or
   - **open** a trip on a vehicle with a free trip slot.
   Each candidate is validated by the rule checker. The cheapest wins. Joining is preferred to opening, and a **scarcity cost** keeps reefers and vans free for orders that need them (a dry order pays to use a reefer; a normal outlet pays to use a van). Fresh trips are always numbered before Style/Tech trips so they run in the 03:30–08:00 window.
3. **Improvement** (`buildPlan.ts`): for each still-deferred order, highest priority first, try an ejection chain of depth one. Remove a lower-priority order from a compatible trip, place the deferred order there, and re-home the removed order elsewhere. If it can't be re-homed, the swap is kept only when the deferred order clearly outranks it (by 20 or more points).
4. **Explain deferrals**: for each order left over, collect the rules that blocked every candidate. The dominant rule becomes the reason code (`NO_REEFER_CAPACITY`, `NO_VAN_CAPACITY`, `CAPACITY`, `TIME_BUDGET`, `DELIVERY_WINDOW`, `FUEL_QUOTA`, `FLEET_EXHAUSTED`) with a sentence for the dispatcher and a plain-language version for the store.
5. **Bottleneck** (`bottleneck.ts`): demand against capacity per resource (reefer m³, dry m³, van m³, fuel left), computed for the **depot where deferrals happened**, since capacity doesn't move between depots. The result is a one-sentence banner that distinguishes "not enough space" from "enough space but not enough trips and Fresh minutes".

Every plan the engine outputs passes `validateVehicleDay` for every vehicle. This is asserted by a property test over 12 random networks plus an over-capacity scenario.

## On the seeded peak day

151–153 orders, 48 of 60 vehicles available. About 128–130 orders are served in roughly 15 ms, and **23 are deferred, all chilled Fresh at Peliyagoda**. Only 4 Peliyagoda reefers remain, and chilled orders span 7 districts with one district per trip. Reefer *space* is sufficient (83 of 172 m³), but reefer *trips* and the Fresh 270-minute window are not. The 4 orders carried over from the previous run are all served.

## Dispatcher tools built on the same checker

- `checkMove` (D3B): validates a manual move onto a vehicle and trip, returns every check with numbers, and if the move is blocked suggests up to three vehicles where it would pass.
- `suggestSwap` (D4): for a repeat-skip that is still deferred, finds the lowest-priority served order whose place it can legally take.
- `recoveryOptions` (X2, `apps/api/src/services/incidents.ts`): for a reefer fault, scores rescue (idle reefer meets the truck, 15-minute transfer), reload (back to the depot, 20 minutes) and defer. Capacity and the Fresh budget are checked, and arrivals are simulated from the failed vehicle's position in its plan. Options that break a rule are shown as ruled out with the reason. The dispatcher always approves.

## Known limits

- Greedy plus local search is feasible but not provably optimal. That is the design's stated tradeoff (*explainable assistance over full automation*).
- Trips serve one district, as the booklet's Task 2B rules require, so a vehicle never combines nearby districts in one run.
- Travel times are free-flow, as in the booklet. Congestion and disruption feed the **late-risk** estimate rather than the feasibility check.
