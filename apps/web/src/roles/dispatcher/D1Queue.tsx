import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeskShell } from '../../components/shells';
import { Banner, Bar, ErrorNote, Pill, Spinner } from '../../components/ui';
import { api, post } from '../../lib/api';
import { kg, m3 } from '../../lib/format';
import type { PlanView, QueueView } from '../../lib/types';
import { OrderFlags, windowText } from './common';

type Filter = 'all' | 'chilled' | 'van' | 'mall' | 'skip';

/**
 * D1. At 16:00 every confirmed order from all three brands lands in one queue instead of a
 * re-keyed spreadsheet. The header puts demand against capacity for each limiting resource,
 * so the dispatcher sees the size of the squeeze before planning.
 */
export function D1Queue() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueView>('/dispatch/queue') });
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanView>('/dispatch/plan') });
  const [filter, setFilter] = useState<Filter>('all');
  const [depot, setDepot] = useState<'all' | string>('all');

  const close = useMutation({ mutationFn: () => post('/dispatch/close-orders'), onSuccess: () => qc.invalidateQueries() });
  const build = useMutation({
    mutationFn: () => post('/dispatch/plan'),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/dispatch/plan');
    },
  });

  const q = queue.data;
  const vehicles = plan.data?.vehicles ?? [];
  const orders = useMemo(() => (q?.orders ?? []).filter((o) => o.status !== 'cancelled'), [q]);

  const isVan = (o: (typeof orders)[number]) => o.outlet.parkingConstraint === 'van_only';
  const rows = orders.filter(
    (o) =>
      (depot === 'all' || o.depot === depot) &&
      (filter === 'all' ||
        (filter === 'chilled' && o.temp === 'chilled') ||
        (filter === 'van' && isVan(o)) ||
        (filter === 'mall' && o.outlet.mallWindowOpen != null) ||
        (filter === 'skip' && o.deferredYesterday)),
  );

  // Demand vs capacity per depot, counting both trips per vehicle (D1 header).
  const squeeze = ['Peliyagoda', 'Kandy'].map((d) => {
    const os = orders.filter((o) => o.depot === d);
    const vs = vehicles.filter((v) => v.depot === d && v.status === 'available');
    const chilled = os.filter((o) => o.temp === 'chilled').reduce((s, o) => s + o.volumeM3, 0);
    const reefer = vs.filter((v) => v.temp === 'reefer').reduce((s, v) => s + v.volumeCapM3 * 2, 0);
    const vanStops = os.filter(isVan).length;
    const vanVolume = os.filter(isVan).reduce((sum, o) => sum + o.volumeM3, 0);
    const vanCap = vs.filter((v) => v.type === 'van').reduce((sum, v) => sum + v.volumeCapM3 * 2, 0);
    const vanTrips = vs.filter((v) => v.type === 'van').length * 2;
    const reefers = vs.filter((v) => v.temp === 'reefer').length;
    const chilledDistricts = new Set(os.filter((o) => o.temp === 'chilled').map((o) => o.district)).size;
    return { d, chilled, reefer, vanStops, vanVolume, vanCap, vanTrips, reefers, chilledDistricts, workshop: vehicles.filter((v) => v.depot === d && v.status !== 'available').length };
  });

  const count = (f: Filter) =>
    f === 'all' ? orders.length : f === 'chilled' ? orders.filter((o) => o.temp === 'chilled').length : f === 'van' ? orders.filter(isVan).length : f === 'mall' ? orders.filter((o) => o.outlet.mallWindowOpen != null).length : orders.filter((o) => o.deferredYesterday).length;
  const available = vehicles.filter((v) => v.status === 'available').length;
  const brands = ['Fresh', 'Style', 'Tech'].map((b) => `${b} ${orders.filter((o) => o.brand === b).length}`).join(', ');

  const action = !q ? null : !q.cutoffClosed ? (
    <button className="btn sm" onClick={() => close.mutate()} disabled={close.isPending}>
      Close orders (16:00 cutoff)
    </button>
  ) : plan.data?.plan ? (
    <button className="btn sm" onClick={() => navigate('/dispatch/plan')}>
      Open plan board
    </button>
  ) : (
    <button className="btn sm" onClick={() => build.mutate()} disabled={build.isPending}>
      {build.isPending ? 'Planning…' : 'Build plan for both depots'}
    </button>
  );

  return (
    <DeskShell title="Order queue" right={action} counts={{ queue: orders.length }}>
      <ErrorNote error={close.error ?? build.error} />
      {queue.isLoading && <Spinner />}
      {q && !q.cutoffClosed && (
        <Banner tone="mari" title={`Orders for ${q.serviceDay} are still open`}>
          Stores can still add orders. Close the queue at the 16:00 cutoff to plan against confirmed orders; anything placed later joins the next run.
        </Banner>
      )}
      <div className="kpis">
        <div className="kpi">
          <div className="l">{q?.cutoffClosed ? 'Confirmed orders' : 'Orders so far'}</div>
          <div className="v">{orders.length}</div>
          <div className="l">{brands}</div>
        </div>
        <div className="kpi">
          <div className="l">Vehicles available</div>
          <div className="v">
            {available} of {vehicles.length}
          </div>
          <div className="l">{vehicles.length - available} in the workshop</div>
        </div>
        <div className="kpi">
          <div className="l">Arrived after 16:00</div>
          <div className="v">{orders.filter((o) => o.afterCutoff).length}</div>
          <div className="l">Held for the next run</div>
        </div>
        <div className="kpi">
          <div className="l">Skipped on last run</div>
          <div className="v">{count('skip')}</div>
          <div className="l">Protected in planning</div>
        </div>
      </div>
      <div className="card">
        <div className="row wrap">
          <h3>Where demand meets capacity</h3>
          <span className="small muted">Before planning; both trips per vehicle counted</span>
        </div>
        <div className="grid2" style={{ marginTop: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {squeeze.map((s) => (
            <div key={s.d} style={{ display: 'grid', gap: 8 }}>
              <Bar label={`Reefer space, ${s.d}`} used={s.chilled} cap={s.reefer} unit="m³" digits={1} />
              <div className="tiny" style={{ color: s.chilledDistricts > s.reefers * 2 ? 'var(--crit)' : 'var(--ink2)' }}>
                {s.reefers} reefers for chilled orders in {s.chilledDistricts} districts; one district per trip
                {s.workshop ? `, ${s.workshop} vehicles in workshop` : ''}
              </div>
              <Bar label={`Van space for van-only outlets, ${s.d}`} used={s.vanVolume} cap={Math.max(s.vanCap, 0.1)} unit="m³" digits={1} />
              <div className="tiny muted">
                {s.vanStops} van-only stops; {s.vanTrips} van trips available
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="row wrap">
        <div className="tabs" role="group" aria-label="Filter orders">
          {(
            [
              ['all', 'All'],
              ['chilled', 'Chilled'],
              ['van', 'Van only'],
              ['mall', 'Mall window'],
              ['skip', 'Skipped last run'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l} {count(k)}
            </button>
          ))}
        </div>
        <div className="row">
          <div className="tabs" role="group" aria-label="Depot filter">
            {['all', 'Kandy', 'Peliyagoda'].map((d) => (
              <button key={d} aria-pressed={depot === d} onClick={() => setDepot(d)}>
                {d === 'all' ? 'Both depots' : d}
              </button>
            ))}
          </div>
          <span className="small muted">
            Showing {rows.length} of {orders.length}
          </span>
        </div>
      </div>
      <div className="tbl">
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Outlet</th>
              <th scope="col">Depot, district</th>
              <th scope="col">Goods</th>
              <th scope="col">Size</th>
              <th scope="col">Window</th>
              <th scope="col">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.orderNo === 'WF-30921' ? 'hl' : ''}>
                <td>
                  <b>{o.orderNo}</b>
                </td>
                <td>
                  {o.outlet.name}
                  <div className="tiny muted">
                    {o.outletId}, {o.brand}
                  </div>
                </td>
                <td>
                  {o.depot}, {o.district}
                </td>
                <td>{o.temp === 'chilled' ? <Pill tone="cold">Chilled</Pill> : <Pill>Ambient</Pill>}</td>
                <td>
                  {m3(o.volumeM3)}, {kg(o.weightKg)}
                </td>
                <td>{windowText(o.outlet)}</td>
                <td>
                  <OrderFlags order={o} outlet={o.outlet} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DeskShell>
  );
}
