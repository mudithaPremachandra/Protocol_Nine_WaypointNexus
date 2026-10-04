import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeskShell } from '../../components/shells';
import { Pill, Spinner } from '../../components/ui';
import { api, post } from '../../lib/api';
import { ago, clock, hhmm, plural } from '../../lib/format';
import { DepotTabs } from './common';
import { LiveMap, MapLegend, type MapLayer } from './LiveMap';

interface LiveTrip {
  id: string;
  vehicleId: string;
  tripNo: number;
  brand: string;
  district: string;
  depot: string;
  status: string;
  plannedDepart: number | null;
  total: number;
  done: number;
  failed: number;
  next: { orderNo: string; outletName: string; plannedArrival: number | null; lateRisk: number | null } | null;
  maxLateRisk: number;
  trail: { lat: number; lng: number; at: string; accuracy: number | null }[];
  stops: { seq: number; outletId: string; outletName: string; orderNo: string; status: string; plannedArrival: number | null; lateRisk: number | null }[];
  driver: { name: string; lastSyncAt: string | null; pending: number } | null;
}

interface Exception {
  kind: 'incident' | 'flag';
  id: string;
  at: string;
  deviceTime: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string | null;
  status: string;
  chosenOption: string | null;
  role?: string;
  photoId?: string | null;
}

interface LiveView {
  serviceDay: string;
  plan: { version: number; status: string } | null;
  trips: LiveTrip[];
  exceptions: Exception[];
  feed: { id: number; type: string; at: string; actorName: string | null; payload: { message?: string } }[];
  serverTime: string;
}

const STATUS: Record<string, [string, 'good' | 'mari' | 'tea' | 'warn' | 'crit' | '']> = {
  planned: ['At dock', ''],
  loading: ['Loading', 'mari'],
  released: ['Released', 'tea'],
  in_progress: ['On the road', 'good'],
  completed: ['Completed', 'good'],
};

/**
 * D5. After departure the dispatcher used to learn about problems by phone. This board shows each
 * trip's progress, late-risk flags and a stream of exceptions from the dock and the road. Each
 * driver's last sync is a normal state: in hill country "last synced 22 min ago" is expected.
 */
export function D5Live() {
  const qc = useQueryClient();
  const [depot, setDepot] = useState('Kandy');
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<MapLayer>>(new Set());
  const toggleLayer = (l: MapLayer) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  // A selection belongs to one depot's board.
  useEffect(() => setSelected(null), [depot]);
  const live = useQuery({ queryKey: ['live'], queryFn: () => api<LiveView>('/dispatch/live'), refetchInterval: 20_000 });
  const resolve = useMutation({ mutationFn: (id: string) => post(`/dispatch/flags/${id}/resolve`), onSuccess: () => qc.invalidateQueries({ queryKey: ['live'] }) });
  const v = live.data;
  const trips = (v?.trips ?? []).filter((t) => t.depot === depot);
  const out = trips.filter((t) => t.status === 'in_progress').length;

  return (
    <DeskShell
      title="Live operations"
      ctx={v ? `${depot}, ${v.serviceDay}. ${plural(out, 'trip')} on the road. Data as of ${clock(v.serverTime)}.` : ''}
      right={<DepotTabs value={depot} onChange={setDepot} />}
    >
      {live.isLoading && <Spinner />}
      {v && !v.plan && <div className="card empty">No plan yet. Publish a plan to follow trips here.</div>}
      {v?.plan && (
        <>
        <div className="grid2" style={{ gridTemplateColumns: '1.15fr 1fr', alignItems: 'start' }}>
          <div className="card">
            <LiveMap depot={depot} trips={trips} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} hidden={hidden} />
            <MapLegend hidden={hidden} onToggle={toggleLayer} onShowAll={() => setHidden(new Set())} />
          </div>
          <div className="card">
            <div className="row">
              <h3>Trips</h3>
              <span className="small muted">Plan v{v.plan.version}</span>
            </div>
            <div className="list">
              {trips.map((t) => {
                const [label, tone] = STATUS[t.status] ?? [t.status, ''];
                const risky = t.maxLateRisk >= 0.5 && t.status !== 'completed';
                const sync = t.driver?.lastSyncAt;
                const stale = sync ? Date.now() - new Date(sync).getTime() > 15 * 60_000 : false;
                return (
                  <div
                    className="li"
                    key={t.id}
                    onClick={() => setSelected(selected === t.id ? null : t.id)}
                    style={{ cursor: 'pointer', background: selected === t.id ? 'var(--mari-tint)' : undefined, borderRadius: 8, paddingLeft: 6 }}
                  >
                    <div className="grow">
                      <div className="nm">
                        {t.vehicleId} <span className="muted" style={{ fontWeight: 400 }}>{t.driver?.name ?? ''}</span>
                      </div>
                      <div className="mt">
                        Trip {t.tripNo}, {t.brand} {t.district}. {t.done} of {t.total} stops done
                        {t.failed ? `, ${t.failed} failed` : ''}.
                        {t.next ? ` Next: ${t.next.outletName} ${hhmm(t.next.plannedArrival)}.` : ''}
                      </div>
                      <div className="tiny muted">
                        {sync ? `${stale ? 'Last synced' : 'Synced'} ${ago(sync)}` : 'Not synced yet today'}
                        {t.driver?.pending ? `, ${t.driver.pending} records waiting on the phone` : ''}
                      </div>
                    </div>
                    <span className="pills" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                      <Pill tone={tone}>{label}</Pill>
                      {risky && <Pill tone="warn">Late risk {Math.round(t.maxLateRisk * 100)}%</Pill>}
                    </span>
                  </div>
                );
              })}
              {!trips.length && <div className="small muted">No trips from this depot.</div>}
            </div>
          </div>
        </div>
          <div className="grid2" style={{ alignItems: 'start' }}>
            <div className="card feed">
              <h3>Exceptions</h3>
              <div className="list">
                {v.exceptions.length === 0 && <div className="small muted">No exceptions reported.</div>}
                {v.exceptions.map((e) => (
                  <div className="li" key={e.id}>
                    <b style={{ width: 48 }}>{clock(e.deviceTime)}</b>
                    <span className="dot" style={{ background: `var(--${e.severity === 'critical' ? 'crit' : 'warn'})`, marginTop: 6 }} aria-hidden="true" />
                    <div className="grow">
                      <div className="nm">{e.title}</div>
                      {e.detail && <div className="mt">{e.detail}</div>}
                      {e.kind === 'incident' && e.status === 'open' && (
                        <Link to={`/dispatch/incident/${e.id}`} className="link">
                          Open recovery
                        </Link>
                      )}
                      {e.kind === 'incident' && e.status !== 'open' && <div className="tiny muted">Recovery approved ({e.chosenOption})</div>}
                      {e.photoId && (
                        <a className="link" href={`/api/photos/${e.photoId}`} target="_blank" rel="noreferrer">
                          View photo
                        </a>
                      )}
                      {e.deviceTime !== e.at && Math.abs(new Date(e.at).getTime() - new Date(e.deviceTime).getTime()) > 120_000 && (
                        <div className="tiny muted">
                          Recorded {clock(e.deviceTime)} offline; synced {clock(e.at)}
                        </div>
                      )}
                    </div>
                    {e.kind === 'flag' && e.status === 'open' && (
                      <button className="btn sm sec" onClick={() => resolve.mutate(e.id)}>
                        Resolve
                      </button>
                    )}
                    {e.kind === 'flag' && e.status !== 'open' && <Pill tone="good">Resolved</Pill>}
                  </div>
                ))}
              </div>
            </div>
            <div className="card feed">
              <h3>Activity</h3>
              <div className="list">
                {v.feed.slice(0, 15).map((f) => (
                  <div className="li" key={f.id}>
                    <b style={{ width: 48 }}>{clock(f.at)}</b>
                    <div className="grow">
                      <div className="mt" style={{ color: 'var(--ink)' }}>
                        {f.payload.message ?? f.type}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </DeskShell>
  );
}
