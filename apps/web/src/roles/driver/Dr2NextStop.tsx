import { Link, useNavigate } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { Banner, Pill } from '../../components/ui';
import { DOCK, hhmm, window as win } from '../../lib/format';
import { recordFix } from '../../offline/location';
import { record } from '../../offline/sync';
import type { DriverCtx } from './DriverApp';

/**
 * Dr2. Designed for a driver who is safely stopped: one stop, the arrival time against the window,
 * the dock type and access notes that used to be local knowledge, and one primary action.
 * Navigation hands off to Maps rather than being rebuilt.
 */
export function Dr2NextStop({ d }: { d: DriverCtx }) {
  const navigate = useNavigate();
  const trip = d.trips.find((t) => t.status === 'in_progress') ?? d.trips.find((t) => t.status === 'completed' && t.stops.some((s) => s.status === 'pending'));
  const finished = d.trips.filter((t) => t.status === 'completed');
  const nextTrip = d.trips.find((t) => t.status === 'released');

  if (!trip) {
    const last = finished.at(-1);
    return (
      <PhoneShell
        title={last ? `Trip ${last.tripNo} complete` : 'No trip in progress'}
        sub={last ? `${last.stops.filter((s) => s.status !== 'failed').length} of ${last.stops.length} stops delivered` : undefined}
        back="/driver"
        backLabel="Today"
        foot={
          nextTrip ? (
            <button
              className="btn"
              onClick={async () => {
                await record('trip.start', { tripId: nextTrip.id }, { label: `Start trip ${nextTrip.tripNo}`, baseVersion: d.data?.planVersion });
                recordFix(nextTrip.vehicleId);
              }}
            >
              Start trip {nextTrip.tripNo}
            </button>
          ) : (
            <Link className="btn sec" to="/driver/sync" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Check sync status
            </Link>
          )
        }
      >
        <Banner tone="good" title="Head back to the depot">
          {nextTrip ? `Trip ${nextTrip.tripNo} has been released and is ready for you.` : 'All stops are recorded on this phone.'}
        </Banner>
      </PhoneShell>
    );
  }

  const idx = trip.stops.findIndex((s) => s.status === 'pending');
  const s = trip.stops[idx]!;
  const close = s.outlet.mallWindowOpen != null ? Math.min(s.outlet.windowClose, s.outlet.mallWindowClose ?? 9999) : s.outlet.windowClose;
  const open = s.outlet.mallWindowOpen != null ? Math.max(s.outlet.windowOpen, s.outlet.mallWindowOpen) : s.outlet.windowOpen;
  const spare = s.plannedArrival != null ? close - s.plannedArrival : null;
  const expected = s.loadedUnits ?? s.order.units;
  const flagged = s.flags.filter((f) => f.role === 'loader');
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.outlet.name.replace('Waypoint ', 'Waypoint ')}, ${s.outlet.district}, Sri Lanka`)}`;

  return (
    <PhoneShell
      title={`Stop ${idx + 1} of ${trip.stops.length}`}
      sub={`Trip ${trip.tripNo}, ${trip.brand}, ${trip.district}`}
      back="/driver"
      backLabel="Today"
      foot={
        <>
          <button className="btn" onClick={() => navigate(`/driver/stop/${s.order.id}/record`)}>
            Arrived at stop
          </button>
          <div className="row">
            <a className="btn sec" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }} href={maps} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
            <Link className="btn sec danger" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }} to="/driver/report">
              Report a problem
            </Link>
          </div>
        </>
      }
    >
      <div className="card">
        <div className="small muted">
          {s.outlet.id}, {s.order.orderNo}
        </div>
        <h2 style={{ fontSize: 20, margin: '2px 0 0' }}>{s.outlet.name}</h2>
        <div className="row" style={{ marginTop: 8 }}>
          <div>
            <div className="small muted">Arrive</div>
            <div className="big">{hhmm(s.plannedArrival)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">{s.outlet.mallWindowOpen != null ? 'Mall bay window' : 'Window'}</div>
            <b>{win(open, close)}</b>
            <div>{spare != null && (spare >= 0 ? <Pill tone={spare < 20 ? 'warn' : 'good'}>{spare} min spare</Pill> : <Pill tone="crit">{-spare} min late</Pill>)}</div>
          </div>
        </div>
        <div className="list" style={{ marginTop: 6 }}>
          <div className="li">
            <span className="grow">Unloading</span>
            <b>{DOCK[s.outlet.dockType] ?? s.outlet.dockType}</b>
          </div>
          <div className="li">
            <span className="grow">Access</span>
            <b style={{ textAlign: 'right', maxWidth: '65%' }}>{s.outlet.accessNotes}</b>
          </div>
          <div className="li">
            <div className="grow">
              Goods
              {flagged.map((f) => (
                <div className="mt" key={f.id}>
                  {f.item} {f.qty} short, flagged at dock
                </div>
              ))}
            </div>
            <b>
              {expected} units{s.order.temp === 'chilled' ? ', chilled' : ''}
            </b>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="list">
          {trip.stops.map((x, i) => (
            <div className="li" key={x.id}>
              <span className={`seqno ${i === idx ? 'hero' : x.status !== 'pending' ? 'done' : 'later'}`}>{x.status !== 'pending' ? (x.status === 'failed' ? '✕' : '✓') : i + 1}</span>
              <div className="grow">
                <div className="nm">{x.outlet.name.replace(/^Waypoint \w+ /, '')}</div>
                <div className="mt">{x.status !== 'pending' ? (x.status === 'failed' ? 'Not delivered' : 'Delivered') : `ETA ${hhmm(x.plannedArrival)}, window ${win(x.outlet.windowOpen, x.outlet.windowClose)}`}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneShell>
  );
}
