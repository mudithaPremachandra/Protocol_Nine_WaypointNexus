#!/usr/bin/env node
/**
 * API smoke test: runs the judge walkthrough across all four roles against a running stack,
 * then a cold-chain incident. Usage:
 *   node scripts/smoke.mjs                      # http://localhost:3000
 *   node scripts/smoke.mjs https://your.host    # deployed instance (resets the demo day first!)
 */
import { randomUUID } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = 'waypoint123';
let failures = 0;

function session() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.error ?? JSON.stringify(data)}`);
    return data;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    login: (username) => call('POST', '/auth/login', { username, password: PASSWORD }),
  };
}

function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const m = (type, payload, extra = {}) => ({ id: randomUUID(), type, at: new Date().toISOString(), payload, ...extra });

const nimal = session();
const fathima = session();
const kasun = session();
const suresh = session();

await nimal.login('nimal');
await nimal.post('/admin/reset');
await Promise.all([fathima.login('fathima'), kasun.login('kasun'), suresh.login('suresh')]);
check('4 seeded accounts sign in', true);

// 1. Store manager places an order before the cutoff.
const placed = await fathima.post('/store/orders', { lines: [{ productId: 'F-DRY-RICE', qty: 10 }, { productId: 'F-CHL-DAIRY', qty: 12 }] });
check('store order is split into dry and chilled orders', placed.orders.length === 2, placed.orders.map((o) => o.orderNo).join(', '));

// 2. Dispatcher closes orders, plans, publishes.
const closed = await nimal.post('/dispatch/close-orders');
check('cutoff closes the queue', closed.queued > 100, `${closed.queued} queued`);
const plan = await nimal.post('/dispatch/plan');
check('plan serves orders and defers some on an over-capacity day', plan.stats.served > 0 && plan.stats.deferred > 0, `${plan.stats.served} served, ${plan.stats.deferred} deferred in ${plan.stats.ms} ms`);
check('bottleneck is named', /bottleneck/.test(plan.bottleneck.headline), plan.bottleneck.headline);

const view = await nimal.get('/dispatch/plan');
const allChecksPass = view.trips.every((t) => t.checks.every((c) => c.ok));
check('every trip passes every rule', allChecksPass, `${view.trips.length} trips`);
check('every deferral has a reason', view.deferrals.every((d) => d.reason && d.detail));
const heroTrip = view.trips.find((t) => t.stops.some((s) => s.order.orderNo === 'WF-30921'));
const heroStop = heroTrip.stops.find((s) => s.order.orderNo === 'WF-30921');
check('reference order WF-30921 is planned', !!heroTrip, `${heroTrip.vehicleId} trip ${heroTrip.tripNo}`);

const ambient = view.trips.find((t) => t.vehicle.temp === 'ambient' && t.vehicle.depot === heroTrip.depot);
const blocked = await nimal.post('/dispatch/move', { orderId: heroStop.order.id, vehicleId: ambient.vehicleId });
check('moving chilled goods to an ambient truck is blocked with the rule named', !blocked.ok && blocked.failing.some((f) => f.rule === 'TEMPERATURE'), blocked.failing.map((f) => f.message).join('; '));
check('blocked move suggests vehicles that pass', blocked.suggestions.length > 0, blocked.suggestions.map((x) => x.vehicleId).join(', '));

const pub = await nimal.post('/dispatch/publish');
check('plan published', pub.version >= 1, `v${pub.version}`);

// 3. Loader checks the load sheet, flags a shortfall, releases the vehicle.
const queue = await kasun.get('/loader/queue');
check('loader sees the published plan for the Kandy dock', queue.published && queue.trips.length > 0, `${queue.trips.length} trips`);
const sheet = await kasun.get(`/loader/trips/${heroTrip.id}`);
const loadMutations = sheet.stops.map((s) => m('load.check', { tripId: sheet.id, orderId: s.order.id, loadedUnits: s.order.orderNo === 'WF-30921' ? s.order.units - 2 : s.order.units }));
loadMutations.push(m('flag.raise', { flagId: randomUUID(), type: 'shortfall', tripId: sheet.id, orderId: heroStop.order.id, item: 'Dairy and yoghurt crates', qty: 2 }));
loadMutations.push(m('trip.release', { tripId: sheet.id, reeferRunning: true }));
const loaded = await kasun.post('/sync/push', { mutations: loadMutations });
check('loader actions applied', loaded.results.every((r) => r.status === 'applied'));
const replay = await kasun.post('/sync/push', { mutations: loadMutations });
check('replaying the same offline batch is idempotent', replay.results.every((r) => r.status === 'duplicate'));

// 4. Driver delivers, recorded offline 20 minutes earlier and synced now.
const today = await suresh.get(`/driver/today?vehicle=${heroTrip.vehicleId}`);
const myTrip = today.trips.find((t) => t.id === heroTrip.id);
check('driver phone gets the released trip with the loader shortfall', myTrip?.status === 'released' && myTrip.stops.some((s) => s.flags.length > 0));
const offlineAt = new Date(Date.now() - 20 * 60_000).toISOString();
const delivered = await suresh.post('/sync/push', {
  mutations: [
    m('trip.start', { tripId: heroTrip.id }, { at: offlineAt, baseVersion: today.planVersion }),
    m('stop.record', { deliveryId: randomUUID(), orderId: heroStop.order.id, outcome: 'partial', deliveredUnits: heroStop.order.units - 2, receiverName: 'Fathima R.' }, { at: offlineAt, baseVersion: today.planVersion }),
  ],
});
check('offline delivery syncs', delivered.results.every((r) => r.status === 'applied'));
const fix = { id: randomUUID(), lat: 7.269, lng: 80.596, accuracy: 20, at: new Date().toISOString() };
const pos = await suresh.post('/driver/positions', { vehicleId: heroTrip.vehicleId, points: [fix, fix] });
check('phone GPS positions upload (duplicates ignored)', pos.accepted === 2);

// 5. Store sees proof of delivery and confirms receipt.
const storeView = await fathima.get('/store/view');
const heroOrder = storeView.orders.find((o) => o.orderNo === 'WF-30921');
check('store sees the delivery record and the pre-explained shortfall', !!heroOrder.delivery && heroOrder.flags.some((f) => f.type === 'shortfall'));
const receipt = await fathima.post('/sync/push', { mutations: [m('receipt.confirm', { receiptId: randomUUID(), orderId: heroOrder.id, status: 'confirmed', receivedUnits: heroOrder.delivery.deliveredUnits })] });
check('store confirms receipt', receipt.results[0].status === 'applied');

// 6. Cold chain break on another reefer with chilled stops still to go.
// Prefer the Kandy hub, which has spare reefers, so the rescue path is exercised.
const reeferTrip = (await nimal.get('/dispatch/plan')).trips
  .filter((t) => t.vehicle.temp === 'reefer' && t.vehicleId !== heroTrip.vehicleId && t.stops.some((s) => s.order.temp === 'chilled' && s.status === 'pending'))
  .sort((a, b) => Number(b.depot === 'Kandy') - Number(a.depot === 'Kandy'))[0];
if (reeferTrip) {
  const drv = session();
  await drv.login(`driver.${reeferTrip.vehicleId.toLowerCase()}`);
  const incidentId = randomUUID();
  await drv.post('/sync/push', { mutations: [m('incident.report', { incidentId, type: 'reefer_fault', tripId: reeferTrip.id, note: 'Display reads 9°C and rising' })] });
  const inc = await nimal.get(`/dispatch/incidents/${incidentId}`);
  check('recovery options are computed and checked', inc.options.length > 0, inc.options.map((o) => `${o.label} [${o.verdict}${o.reason ? `: ${o.reason}` : ''}]`).join(' | '));
  const pick = inc.options.find((o) => o.verdict === 'recommended');
  check('a rescue or reload option is offered at Kandy', inc.options.some((o) => o.kind !== 'defer' && o.verdict !== 'ruled_out'));
  const approved = await nimal.post(`/dispatch/incidents/${incidentId}/approve`, { option: pick.key });
  check('dispatcher approves a recovery option', approved.ok, pick.label);
  const state = await nimal.get('/state');
  check('approval bumps the plan version for field devices', state.planVersion > pub.version, `v${state.planVersion}`);
} else {
  check('found a reefer trip for the incident test', false);
}

const live = await nimal.get('/dispatch/live');
check('live board shows exceptions and driver sync', live.exceptions.length > 0 && live.trips.some((t) => t.driver?.lastSyncAt));
check('live board carries the phone GPS trail', live.trips.some((t) => t.vehicleId === heroTrip.vehicleId && t.trail?.length === 1));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
