import { Link, useNavigate, useParams } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { Bar, Pill, Spinner } from '../../components/ui';
import { hhmm } from '../../lib/format';
import { record } from '../../offline/sync';
import { useLoader } from './useLoader';

/**
 * L2. Loading that supports unloading: stops in reverse order, so the last stop loads first and
 * deepest, with chilled items marked per stop. Loaders tick each stop with large targets, and the
 * fill bar shows the space left so an overloaded trip is caught at the dock, not on the road.
 */
export function L2LoadSheet() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { trips, data, loading } = useLoader();
  const t = trips.find((x) => x.id === tripId);
  if (!t) return <PhoneShell title="Load sheet" back="/loader" backLabel="Dock" depotNet>{loading ? <Spinner /> : <div className="card empty">This trip is no longer in the plan.</div>}</PhoneShell>;

  const reversed = [...t.stops].reverse();
  const done = t.stops.filter((s) => s.loadedUnits != null).length;
  const volume = t.stops.reduce((s, x) => s + x.order.volumeM3, 0);
  const released = t.status === 'released' || t.status === 'in_progress' || t.status === 'completed';
  const chilled = t.stops.some((s) => s.order.temp === 'chilled');

  return (
    <PhoneShell
      title={`${t.vehicleId}, trip ${t.tripNo}`}
      sub={`${t.vehicle.temp === 'reefer' ? 'Reefer' : 'Dry-box'} ${t.vehicle.type}. Departs ${hhmm(t.plannedDepart)}. Load the last stop first.`}
      back="/loader"
      backLabel="Dock"
      depotNet
      foot={
        released ? (
          <div className="small">
            <Pill tone="good">Released</Pill> This trip has left the dock.
          </div>
        ) : (
          <button className="btn" onClick={() => navigate(`/loader/trip/${t.id}/release`)}>
            Ready to release ({done} of {t.stops.length} stops checked)
          </button>
        )
      }
    >
      <div className="card">
        <Bar label="Space used" used={volume} cap={t.vehicle.volumeCapM3} unit="m³" digits={1} />
        <div className="tiny muted" style={{ marginTop: 6 }}>
          {chilled ? 'Chilled zone at the front, 3°C. ' : ''}Stop 1 goes by the doors.
        </div>
      </div>
      {reversed.map((s, i) => {
        const checked = s.loadedUnits != null;
        const short = checked ? s.order.units - (s.loadedUnits ?? 0) : 0;
        return (
          <div className={`card ${s.order.orderNo === 'WF-30921' ? 'hero-ring' : ''}`} key={s.id}>
            <div className="row">
              <span className={`seqno ${s.order.orderNo === 'WF-30921' ? 'hero' : ''}`}>{s.seq + 1}</span>
              <div className="grow">
                <div className="nm">{s.outlet.name}</div>
                <div className="small muted">
                  {s.order.orderNo}, {s.order.units} units{s.order.temp === 'chilled' ? ', chilled' : ''}. {i === 0 ? 'Load first, deepest.' : i === reversed.length - 1 ? 'Load last, by the doors.' : ''}
                </div>
              </div>
              <button
                className={`chk ${checked ? (short > 0 ? 'bad' : 'on') : ''}`}
                disabled={released}
                aria-pressed={checked}
                aria-label={`Mark stop ${s.seq + 1} loaded`}
                onClick={() =>
                  record('load.check', { tripId: t.id, orderId: s.order.id, loadedUnits: s.order.units }, { label: `Load check, ${t.vehicleId}`, detail: s.outlet.name, baseVersion: data?.planVersion })
                }
              >
                {checked ? '✓' : ''}
              </button>
            </div>
            <div className="list" style={{ marginTop: 6 }}>
              {s.order.lines.map((l) => (
                <div className="li" key={l.productId}>
                  <span className="grow">
                    {l.name} <span className="muted small">({l.unit})</span>
                  </span>
                  <b>{l.qty}</b>
                  {s.order.temp === 'chilled' && <Pill tone="cold">Chilled</Pill>}
                </div>
              ))}
              {s.flags.map((f) => (
                <div className="li" key={f.id}>
                  <span className="grow">
                    {f.qty} {f.item} {f.type === 'damage' ? 'damaged' : 'short'}
                  </span>
                  <Pill tone="crit">Flagged</Pill>
                </div>
              ))}
            </div>
            {!released && (
              <Link className="btn sm sec" style={{ marginTop: 8, display: 'inline-flex', textDecoration: 'none' }} to={`/loader/trip/${t.id}/flag/${s.order.id}`}>
                Short or damaged
              </Link>
            )}
          </div>
        );
      })}
    </PhoneShell>
  );
}
