import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { Banner, ErrorNote, Pill, Spinner, useToast } from '../../components/ui';
import { clock, hhmm, plural } from '../../lib/format';
import type { FieldTrip } from '../../lib/types';
import { record } from '../../offline/sync';
import { useLoader } from './useLoader';

export function tripStatus(t: FieldTrip, changed: boolean): [string, 'good' | 'mari' | 'crit' | ''] {
  if (t.status === 'released' || t.status === 'in_progress' || t.status === 'completed') return ['Released', 'good'];
  const checked = t.stops.filter((s) => s.loadedUnits != null).length;
  if (changed) return ['Changed since print', 'crit'];
  if (checked > 0) return [`Loading ${checked} of ${t.stops.length}`, 'mari'];
  return ['Not started', ''];
}

/**
 * L1. Printed loading lists go stale when the plan changes after printing. The dock tablet shows
 * this depot's vehicles in departure order with the live plan version and a clear "changed since
 * print" marker. Large rows and one status per vehicle suit a shared device used with gloves.
 * X3: an approved recovery puts an urgent card at the top of the queue.
 */
export function L1DockQueue() {
  const { data, trips, loading, error, depot, snapshot } = useLoader();
  const navigate = useNavigate();
  const toast = useToast();
  const [ticks, setTicks] = useState<Record<string, boolean>>({});

  const firstPublish = data?.changes.filter((c) => c.type === 'plan.published').at(-1);
  const changedVehicles = new Set(
    (data?.changes ?? []).filter((c) => c.type !== 'plan.published' && (!firstPublish || c.id > firstPublish.id)).flatMap((c) => c.payload.vehicles ?? []),
  );

  // X3: rescue vehicle of the latest approved recovery, if its trip hasn't left yet.
  const recovery = (data?.changes ?? []).find((c) => c.type === 'incident.approved' && c.payload.rescueVehicle);
  const rescueTrip = recovery ? trips.find((t) => t.vehicleId === recovery.payload.rescueVehicle && t.status !== 'released' && t.status !== 'in_progress' && t.status !== 'completed' && t.stops.some((s) => s.order.temp === 'chilled')) : undefined;
  const checklist = rescueTrip?.vehicle.temp === 'reefer' ? ['Reefer running and set to 3°C', 'Transfer trolley on board', 'Door curtain fitted'] : ['Transfer trolley on board', 'Door curtain fitted'];
  const allTicked = checklist.every((c) => ticks[c]);

  return (
    <PhoneShell title={`${depot} dock`} sub={data ? `${data.serviceDay}. ${data.published ? `Plan v${data.planVersion}, received ${clock(snapshot?.savedAt ? new Date(snapshot.savedAt) : null)}.` : 'No plan published yet.'}` : ''} depotNet>
      {loading && <Spinner />}
      <ErrorNote error={error} />
      {rescueTrip && recovery && (
        <div className="banner crit" style={{ flexDirection: 'column' }} role="alert">
          <div className="row" style={{ width: '100%' }}>
            <b>Urgent from dispatch, {clock(recovery.at)}</b>
            {recovery.payload.depart && <Pill tone="crit">Leave by {recovery.payload.depart}</Pill>}
          </div>
          <div>
            Release <strong>{rescueTrip.vehicleId}</strong> ({rescueTrip.vehicle.temp === 'reefer' ? 'reefer' : 'dry'} {rescueTrip.vehicle.type}) for{' '}
            {recovery.payload.kind === 'rescue' ? `a roadside transfer from ${recovery.payload.failedVehicle}` : `the chilled stops reloaded from ${recovery.payload.failedVehicle}`}. {rescueTrip.stops.length} chilled stops.
          </div>
          <div className="list" style={{ width: '100%', background: '#fff', borderRadius: 10, padding: '0 10px' }}>
            {checklist.map((c) => (
              <div className="li" key={c}>
                <button className={`chk ${ticks[c] ? 'on' : ''}`} aria-pressed={!!ticks[c]} aria-label={c} onClick={() => setTicks((t) => ({ ...t, [c]: !t[c] }))}>
                  {ticks[c] ? '✓' : ''}
                </button>
                <span className="grow">{c}</span>
              </div>
            ))}
          </div>
          <button
            className="btn warn"
            disabled={!allTicked}
            onClick={async () => {
              await record('trip.release', { tripId: rescueTrip.id, reeferRunning: rescueTrip.vehicle.temp === 'reefer' }, { label: `Release ${rescueTrip.vehicleId}`, detail: 'Priority release', baseVersion: data?.planVersion });
              toast(`${rescueTrip.vehicleId} released`);
            }}
          >
            Release {rescueTrip.vehicleId}
          </button>
        </div>
      )}
      {data?.published && changedVehicles.size > 0 && !rescueTrip && (
        <Banner tone="mari" title="Changed since the printout">
          {[...changedVehicles].join(', ')}: stops changed after the plan was first published. Load from this screen.
        </Banner>
      )}
      {data && !data.published && <div className="card empty">Dispatch hasn’t published tonight’s plan yet. It appears here the moment it does.</div>}
      {trips.map((t) => {
        const [label, tone] = tripStatus(t, changedVehicles.has(t.vehicleId) && t.status !== 'released' && t.status !== 'in_progress' && t.status !== 'completed');
        return (
          <button key={t.id} className="card row cardbtn" onClick={() => navigate(`/loader/trip/${t.id}`)}>
            <div>
              <div className="nm" style={{ fontSize: 17 }}>
                {t.vehicleId} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>trip {t.tripNo}</span>
              </div>
              <div className="small muted">
                {t.vehicle.temp === 'reefer' ? 'Reefer' : 'Dry-box'} {t.vehicle.type}, departs {hhmm(t.plannedDepart)}. {t.brand}, {t.district}, {plural(t.stops.length, 'stop')}.
              </div>
            </div>
            <Pill tone={tone}>{label}</Pill>
          </button>
        );
      })}
    </PhoneShell>
  );
}
