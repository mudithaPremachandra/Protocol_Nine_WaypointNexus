import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../app/session';
import { PhoneShell } from '../../components/shells';
import { Banner, ErrorNote, Pill, Spinner } from '../../components/ui';
import { clock, hhmm, plural } from '../../lib/format';
import { record } from '../../offline/sync';
import { recordFix, setShareLocation } from '../../offline/location';
import type { DriverCtx, DriverLocation } from './DriverApp';
import { setDemoVehicle } from './useDriver';

/**
 * Dr1. The driver's day starts at the depot, where connectivity is good. This screen confirms both
 * trips are saved on the phone and shows the plan version, so a driver heading into the hills knows
 * the route will not disappear with the signal.
 */
export function Dr1Today({ d, location }: { d: DriverCtx; location: DriverLocation }) {
  const { me } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, trips, loading, error, snapshot } = d;
  const active = trips.find((t) => t.status === 'in_progress');
  const nextTrip = trips.find((t) => t.status === 'released') ?? trips.find((t) => t.status === 'planned' || t.status === 'loading');
  const allDone = trips.length > 0 && trips.every((t) => t.status === 'completed');
  const firstName = me?.name.split(' ')[0];

  return (
    <PhoneShell
      title={`Good morning, ${firstName}`}
      sub={data?.vehicle ? `${data.vehicle.id}, ${data.vehicle.temp === 'reefer' ? 'reefer' : 'dry-box'} ${data.vehicle.type}. ${data.serviceDay}.` : 'No vehicle assigned'}
      depotNet
      foot={
        active ? (
          <button className="btn" onClick={() => navigate('/driver/stop')}>
            Continue trip {active.tripNo}
          </button>
        ) : nextTrip ? (
          nextTrip.status === 'released' ? (
            <button
              className="btn"
              onClick={async () => {
                await record('trip.start', { tripId: nextTrip.id }, { label: `Start trip ${nextTrip.tripNo}`, detail: `${nextTrip.vehicleId} left ${nextTrip.depot}`, baseVersion: data?.planVersion });
                recordFix(nextTrip.vehicleId);
                navigate('/driver/stop');
              }}
            >
              Start trip {nextTrip.tripNo}
            </button>
          ) : (
            <button className="btn" disabled>
              Waiting for the dock to release trip {nextTrip.tripNo}
            </button>
          )
        ) : undefined
      }
    >
      {loading && <Spinner />}
      <ErrorNote error={error} />
      {data && !data.published && <div className="card empty">Tonight’s plan isn’t published yet. Your trips appear here as soon as dispatch publishes it.</div>}
      {data?.published && trips.length > 0 && (
        <Banner tone="good" title={`${trips.length === 2 ? 'Both trips' : 'Your trip'} saved on this phone`}>
          Plan v{data.planVersion} at {clock(snapshot?.savedAt ? new Date(snapshot.savedAt) : null)}. Stops can be recorded without signal.
        </Banner>
      )}
      {data?.published && trips.length === 0 && <div className="card empty">No trips for {data.vehicle?.id} today.</div>}
      {allDone && <Banner tone="good" title="All trips completed">Thank you. Take the vehicle back to the depot.</Banner>}
      {trips.map((t) => {
        const chilled = t.stops.some((s) => s.order.temp === 'chilled');
        const flags = t.stops.flatMap((s) => s.flags.filter((f) => f.role === 'loader').map((f) => ({ ...f, outlet: s.outlet.name })));
        const mall = t.stops.some((s) => s.outlet.mallWindowOpen != null);
        const done = t.stops.filter((s) => s.status !== 'pending').length;
        return (
          <div className="card" key={t.id}>
            <div className="row">
              <h3>
                Trip {t.tripNo}: {t.brand}, {t.district}
              </h3>
              <span className="pills">
                {chilled && <Pill tone="cold">Chilled</Pill>}
                {mall && <Pill tone="mari">Mall window</Pill>}
                {t.status === 'completed' && <Pill tone="good">Done</Pill>}
              </span>
            </div>
            <div className="sub">
              {plural(t.stops.length, 'stop')}, {t.stops.reduce((s, x) => s + (x.loadedUnits ?? x.order.units), 0)} units. Departs {hhmm(t.plannedDepart)}, last stop {hhmm(t.stops.at(-1)?.plannedArrival)}.
              {done ? ` ${done} of ${t.stops.length} done.` : ''}
            </div>
            {flags.map((f) => (
              <div className="small" style={{ marginTop: 8 }} key={f.id}>
                {f.qty} {f.item} short for {f.outlet.replace(/^Waypoint \w+ /, '')}, flagged at the dock.
              </div>
            ))}
            {t.status !== 'released' && t.status !== 'in_progress' && t.status !== 'completed' && <div className="tiny muted" style={{ marginTop: 6 }}>Being loaded at {t.depot}.</div>}
          </div>
        );
      })}
      {data?.published && trips.length > 0 && (
        <div className="card row">
          <div className="grow">
            <div className="nm">Share my location during trips</div>
            <div className="mt">
              {!location.share
                ? 'Off. Dispatch sees your last recorded stop instead.'
                : location.state === 'on'
                  ? `On. Last fix ${location.lastFix ? clock(new Date(location.lastFix)) : 'just now'}; saved on the phone if there is no signal.`
                  : location.state === 'denied'
                    ? 'Location permission is blocked for this site. Allow it in the browser settings, or dispatch sees your last stop.'
                    : location.state === 'waiting'
                      ? 'Getting a fix…'
                      : location.state === 'unavailable'
                        ? 'No location fix right now. Dispatch sees your last recorded stop.'
                        : 'Starts when you start a trip. Only while the app is open.'}
            </div>
          </div>
          <button className={`chk ${location.share ? 'on' : ''}`} aria-pressed={location.share} aria-label="Share my location during trips" onClick={() => setShareLocation(!location.share)}>
            {location.share ? '✓' : ''}
          </button>
        </div>
      )}
      <Link to="/driver/sync" className="link" style={{ alignSelf: 'flex-start' }}>
        Sync status
      </Link>
      {data && (
        <label className="field tiny" style={{ marginTop: 12 }}>
          Demo only: drive another vehicle
          <select
            value={d.vehicle}
            onChange={(e) => {
              setDemoVehicle(e.target.value === me?.vehicleId ? null : e.target.value);
              void qc.invalidateQueries();
              window.location.reload();
            }}
          >
            {Array.from({ length: 60 }, (_, i) => `VEH${String(i + 1).padStart(3, '0')}`).map((v) => (
              <option key={v} value={v}>
                {v}
                {v === me?.vehicleId ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </PhoneShell>
  );
}
