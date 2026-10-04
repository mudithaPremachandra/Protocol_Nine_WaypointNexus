import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { Banner, Pill, Spinner } from '../../components/ui';
import { clock, hhmm } from '../../lib/format';
import { record } from '../../offline/sync';
import { useLoader } from './useLoader';

/**
 * L4. Release is the hand-over between dock and road. It summarises checked stops and open flags,
 * confirms the reefer is running, and pushes the trip, as actually loaded, to the driver's phone
 * while it is still on depot wifi.
 */
export function L4Release() {
  const { tripId } = useParams();
  const { trips, data } = useLoader();
  const t = trips.find((x) => x.id === tripId);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  if (!t) return <PhoneShell title="Release" back="/loader" depotNet><Spinner /></PhoneShell>;

  const checked = t.stops.filter((s) => s.loadedUnits != null).length;
  const units = t.stops.reduce((s, x) => s + x.order.units, 0);
  const loaded = t.stops.reduce((s, x) => s + (x.loadedUnits ?? 0), 0);
  const flags = t.stops.flatMap((s) => s.flags.map((f) => ({ ...f, outlet: s.outlet.name })));
  const released = t.status === 'released' || t.status === 'in_progress' || t.status === 'completed';
  const checks = [...(t.vehicle.temp === 'reefer' ? ['Reefer running, 3°C'] : []), 'Doors sealed'];
  const ready = checked === t.stops.length && checks.every((c) => ticks[c]);

  return (
    <PhoneShell
      title={`Release ${t.vehicleId}`}
      sub={`Trip ${t.tripNo}, departs ${hhmm(t.plannedDepart)}.`}
      back={`/loader/trip/${t.id}`}
      backLabel="Load sheet"
      depotNet
      foot={
        released ? (
          <Link className="btn sec" to="/loader" style={{ textAlign: 'center', textDecoration: 'none' }}>
            Back to dock queue
          </Link>
        ) : (
          <button className="btn" disabled={!ready} onClick={() => record('trip.release', { tripId: t.id, reeferRunning: t.vehicle.temp === 'reefer' }, { label: `Release ${t.vehicleId}`, detail: `Trip ${t.tripNo}`, baseVersion: data?.planVersion })}>
            {checked < t.stops.length ? `Check all stops first (${checked} of ${t.stops.length})` : 'Release to driver'}
          </button>
        )
      }
    >
      <div className="card">
        <div className="list">
          <div className="li">
            <span className="grow">Stops checked</span>
            <b>
              {checked} of {t.stops.length}
            </b>
          </div>
          <div className="li">
            <span className="grow">Units loaded</span>
            <b>
              {loaded} of {units}
            </b>
          </div>
          <div className="li">
            <div className="grow">
              <div>Open flags</div>
              {flags.map((f) => (
                <div className="mt" key={f.id}>
                  {f.item} −{f.qty}, {f.outlet.replace(/^Waypoint \w+ /, '')}. Dispatch and store told.
                </div>
              ))}
            </div>
            <Pill tone={flags.length ? 'warn' : 'good'}>{flags.length}</Pill>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="list">
          {checks.map((c) => (
            <div className="li" key={c}>
              <button className={`chk ${ticks[c] || released ? 'on' : ''}`} aria-pressed={!!ticks[c]} aria-label={c} disabled={released} onClick={() => setTicks((x) => ({ ...x, [c]: !x[c] }))}>
                {ticks[c] || released ? '✓' : ''}
              </button>
              <span className="grow">{c}</span>
            </div>
          ))}
          <div className="li">
            <span className={`chk ${released ? 'on' : ''}`} aria-hidden="true">
              {released ? '✓' : ''}
            </span>
            <span className="grow">Driver has the trip on their phone</span>
          </div>
        </div>
      </div>
      {released && (
        <Banner tone="good" title={`Released at ${clock(t.releasedAt)}`}>
          Trip {t.tripNo} is saved on the driver’s phone for offline use.
        </Banner>
      )}
    </PhoneShell>
  );
}
