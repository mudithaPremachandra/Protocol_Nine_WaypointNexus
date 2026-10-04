import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DeskShell } from '../../components/shells';
import { Banner, Bar, ErrorNote, Pill, Spinner, useToast } from '../../components/ui';
import { api, post } from '../../lib/api';
import { hhmm, plural } from '../../lib/format';
import type { PlanTrip, PlanView } from '../../lib/types';
import { checkOf, DepotTabs, vehicleType } from './common';
import { PlaceOrderDrawer, TripCheckDrawer } from './drawers';

/**
 * D2, the hero screen. The system proposes trips per vehicle that already satisfy the operating
 * rules; the dispatcher reviews and adjusts. Each trip shows the four limits that matter together:
 * weight, volume, time budget and weekly fuel. A banner names the day's bottleneck. Deferred orders
 * sit beside the plan, so the trade-off is visible at the moment of deciding.
 */
export function D2PlanBoard() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanView>('/dispatch/plan') });
  const [depot, setDepot] = useState('Kandy');
  const [tripId, setTripId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);

  const build = useMutation({ mutationFn: () => post('/dispatch/plan'), onSuccess: () => qc.invalidateQueries() });
  const p = plan.data;

  if (plan.isLoading) return <DeskShell title="Plan board"><Spinner /></DeskShell>;
  if (!p?.plan) {
    return (
      <DeskShell title="Plan board">
        <ErrorNote error={build.error} />
        <div className="card empty">
          <p>No plan for {p?.serviceDate} yet.</p>
          {p?.cutoffClosed ? (
            <button className="btn sm" onClick={() => build.mutate()} disabled={build.isPending}>
              {build.isPending ? 'Planning…' : 'Build plan for both depots'}
            </button>
          ) : (
            <Link to="/dispatch">Close orders on the order queue first.</Link>
          )}
        </div>
      </DeskShell>
    );
  }

  const stats = p.plan.stats;
  const depotTrips = p.trips.filter((t) => t.depot === depot);
  const depotDeferrals = p.deferrals.filter((d) => d.order.depot === depot && d.order.status === 'deferred');
  const forced = p.deferrals.filter((d) => d.reason !== 'DISPATCHER_CHOICE').length;
  const broken = p.trips.reduce((s, t) => s + t.checks.filter((c) => !c.ok).length, 0);
  const vehicles = p.vehicles.filter((v) => v.depot === depot).sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available') || a.id.localeCompare(b.id));
  const heroTrip = p.trips.find((t) => t.stops.some((s) => s.order.orderNo === 'WF-30921'));
  const squeezed = p.plan.bottleneck.depot === depot;
  const published = p.plan.status === 'published';

  return (
    <DeskShell
      title="Plan board"
      counts={{ deferrals: p.deferrals.filter((d) => d.order.status === 'deferred').length }}
      right={
        <>
          <DepotTabs value={depot} onChange={setDepot} counts={{ Kandy: p.trips.filter((t) => t.depot === 'Kandy').length, Peliyagoda: p.trips.filter((t) => t.depot === 'Peliyagoda').length }} />
          <button className="btn sm" onClick={() => navigate('/dispatch/deferrals')}>
            {published ? 'Deferrals' : 'Review deferrals and publish'}
          </button>
        </>
      }
    >
      <div className="kpis">
        <div className="kpi">
          <div className="l">Planned</div>
          <div className="v">
            {stats.served} of {stats.orders}
          </div>
          <div className="l">Both depots, planned in {stats.ms} ms</div>
        </div>
        <div className="kpi">
          <div className="l">Deferred</div>
          <div className="v" style={{ color: stats.deferred ? 'var(--crit)' : undefined }}>
            {p.deferrals.filter((d) => d.order.status === 'deferred').length}
          </div>
          <div className="l">
            {forced} forced by capacity, {p.deferrals.length - forced} by choice
          </div>
        </div>
        <div className="kpi">
          <div className="l">Trips</div>
          <div className="v">{p.trips.length}</div>
          <div className="l">{plural(new Set(p.trips.filter((t) => t.tripNo === 2).map((t) => t.vehicleId)).size, 'vehicle')} on a second trip</div>
        </div>
        <div className="kpi">
          <div className="l">Rules broken</div>
          <div className="v" style={{ color: broken ? 'var(--crit)' : 'var(--good)' }}>
            {broken}
          </div>
          <div className="l">{broken ? 'Check the flagged trips' : 'Every trip passes all checks'}</div>
        </div>
      </div>

      {published && (
        <Banner tone="good" title={`Plan v${p.plan.version} published`}>
          Loaders at both docks and every driver have it. Changes you make now bump the version and reach the affected dock, drivers and stores.
        </Banner>
      )}
      {squeezed ? (
        <Banner tone="crit" title={p.plan.bottleneck.headline.split(':')[0]}>
          {p.plan.bottleneck.headline.split(':').slice(1).join(':').trim()} Priority went to outlets skipped yesterday, then to chilled Fresh.
        </Banner>
      ) : (
        <Banner tone={depotDeferrals.length ? 'warn' : 'good'} title={depotDeferrals.length ? `${depotDeferrals.length} orders deferred at ${depot}` : `Everything fits at ${depot}`}>
          {depotDeferrals.length ? 'See the list beside the plan.' : `All ${p.trips.filter((t) => t.depot === depot).reduce((s, t) => s + t.stops.length, 0)} orders are on a trip that passes every rule.`} Today’s network bottleneck: {p.plan.bottleneck.headline}
        </Banner>
      )}

      <div className="lanes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {vehicles.map((v) => {
            const trips = depotTrips.filter((t) => t.vehicleId === v.id).sort((a, b) => a.tripNo - b.tripNo);
            if (v.status !== 'available') {
              return (
                <div className="lane off" key={v.id}>
                  <div className="veh">
                    <b>{v.id}</b>
                    <span>{vehicleType(v)}</span>
                  </div>
                  <div className="trip empty">In the workshop</div>
                  <div className="trip empty">Not available</div>
                </div>
              );
            }
            if (!trips.length && depotTrips.length > 12) return null;
            return (
              <div className="lane" key={v.id}>
                <div className="veh">
                  <b>{v.id}</b>
                  <span>{vehicleType(v)}</span>
                  <span>
                    {v.volumeCapM3} m³, {v.weightCapKg.toLocaleString('en-GB')} kg
                  </span>
                  {heroTrip?.vehicleId === v.id && <Pill tone="mari">Carries WF-30921</Pill>}
                </div>
                {[1, 2].map((n) => {
                  const t = trips.find((x) => x.tripNo === n);
                  return t ? <TripBlock key={n} t={t} selected={tripId === t.id} onOpen={() => setTripId(t.id)} /> : <div key={n} className="trip empty">Trip {n} free</div>;
                })}
              </div>
            );
          })}
          {depotTrips.length > 12 && <div className="small muted">Idle vehicles are hidden. Every available vehicle is still offered when you place an order.</div>}
        </div>
        <aside className="card" style={{ alignSelf: 'start' }}>
          <div className="row">
            <h3>Deferred at {depot}</h3>
            <Pill tone={depotDeferrals.length ? 'crit' : 'good'}>{depotDeferrals.length}</Pill>
          </div>
          <div className="list">
            {depotDeferrals.length === 0 && <div className="small muted">Nothing deferred here.</div>}
            {depotDeferrals.slice(0, 12).map((d) => (
              <div className="li" key={d.id}>
                <div className="grow">
                  <div className="nm">{d.outlet.name}</div>
                  <div className="mt">
                    {d.order.orderNo}, {d.order.temp}. {d.reasonLabel}
                  </div>
                  <div style={{ marginTop: 5 }} className="pills">
                    {d.repeatSkip && <Pill tone="crit">Skipped yesterday too</Pill>}
                    <button className="link" onClick={() => setPlacing(d.orderId)}>
                      Try to place it
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 10, width: '100%' }} onClick={() => navigate('/dispatch/deferrals')}>
            Review all {p.deferrals.filter((d) => d.order.status === 'deferred').length} deferrals
          </button>
        </aside>
      </div>

      {tripId && (
        <TripCheckDrawer
          tripId={tripId}
          onClose={() => setTripId(null)}
          onDeferred={(orderNo) => {
            toast(`${orderNo} moved to the next run`);
            void qc.invalidateQueries();
          }}
        />
      )}
      {placing && (
        <PlaceOrderDrawer
          orderId={placing}
          plan={p}
          onClose={() => setPlacing(null)}
          onApplied={(msg) => {
            toast(msg);
            setPlacing(null);
            void qc.invalidateQueries();
          }}
        />
      )}
    </DeskShell>
  );
}

function TripBlock({ t, selected, onOpen }: { t: PlanTrip; selected: boolean; onOpen: () => void }) {
  const time = checkOf(t.checks, 'TIME_BUDGET');
  const fuel = checkOf(t.checks, 'FUEL_QUOTA');
  const chilled = t.stops.filter((s) => s.order.temp === 'chilled').length;
  const fails = t.checks.filter((c) => !c.ok).length;
  return (
    <button className={`trip ${selected ? 'sel' : ''}`} onClick={onOpen} aria-label={`${t.vehicleId} trip ${t.tripNo}: ${t.brand}, ${t.district}. Open trip check`}>
      <div className="tt">
        <span>
          Trip {t.tripNo}: {t.brand}, {t.district}
        </span>
        <span className="muted">
          {plural(t.stops.length, 'stop')}, dep {hhmm(t.plannedDepart)}
          {chilled ? `, ${chilled} chilled` : ''}
          {fails ? `, ${fails} rule${fails > 1 ? 's' : ''} broken` : ''}
        </span>
      </div>
      <div className="bars2">
        <Bar label="Volume" used={t.load.volumeM3} cap={t.vehicle.volumeCapM3} unit="m³" digits={1} />
        <Bar label="Weight" used={t.load.weightKg} cap={t.vehicle.weightCapKg} unit="kg" />
        {time && <Bar label={t.brand === 'Fresh' ? 'Fresh time' : 'Day time'} used={time.actual ?? 0} cap={time.limit ?? 1} unit="min" />}
        {fuel && <Bar label="Fuel this week" used={fuel.actual ?? 0} cap={fuel.limit ?? 1} unit="L" />}
      </div>
    </button>
  );
}
