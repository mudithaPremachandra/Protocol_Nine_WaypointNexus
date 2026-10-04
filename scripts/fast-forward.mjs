#!/usr/bin/env node
/**
 * Demo helper: resets the demo day and runs it forward to a chosen point, so a walkthrough or video
 * can start mid-day. Steps: closed -> planned -> published -> loaded (VEH041 checked, flagged, released).
 *   node scripts/fast-forward.mjs [closed|planned|published|loaded] [base-url]
 */
import { randomUUID } from 'node:crypto';

const STEPS = ['closed', 'planned', 'published', 'loaded'];
const target = process.argv[2] ?? 'loaded';
const BASE = (process.argv[3] ?? 'http://localhost:3000').replace(/\/$/, '');
if (!STEPS.includes(target)) throw new Error(`Step must be one of ${STEPS.join(', ')}`);
const upTo = (s) => STEPS.indexOf(s) <= STEPS.indexOf(target);

async function session(username) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'waypoint123' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => {
    const r = await fetch(`${BASE}/api${path}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(`${path}: ${data.error}`);
    return data;
  };
}

const nimal = await session('nimal');
await nimal('POST', '/admin/reset');
console.log('reset');
if (upTo('closed')) console.log('closed', await nimal('POST', '/dispatch/close-orders'));
if (upTo('planned')) console.log('planned', (await nimal('POST', '/dispatch/plan')).stats);
if (upTo('published')) console.log('published', await nimal('POST', '/dispatch/publish'));
if (upTo('loaded')) {
  const kasun = await session('kasun');
  const view = await nimal('GET', '/dispatch/plan');
  const trip = view.trips.find((t) => t.stops.some((s) => s.order.orderNo === 'WF-30921'));
  const at = new Date().toISOString();
  const m = (type, payload) => ({ id: randomUUID(), type, at, payload });
  const hero = trip.stops.find((s) => s.order.orderNo === 'WF-30921');
  const muts = trip.stops.map((s) => m('load.check', { tripId: trip.id, orderId: s.order.id, loadedUnits: s.order.units - (s === hero ? 2 : 0) }));
  muts.push(m('flag.raise', { flagId: randomUUID(), type: 'shortfall', tripId: trip.id, orderId: hero.order.id, item: 'Dairy and yoghurt crates', qty: 2, note: 'Cold room short' }));
  muts.push(m('trip.release', { tripId: trip.id, reeferRunning: true }));
  await kasun('POST', '/sync/push', { mutations: muts });
  console.log(`loaded and released ${trip.vehicleId} trip ${trip.tripNo}`);
}
