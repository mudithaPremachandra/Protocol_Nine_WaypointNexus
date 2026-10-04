import { useState } from 'react';
import { PhoneShell } from '../../components/shells';
import { Banner } from '../../components/ui';
import { clock } from '../../lib/format';
import { useNetwork } from '../../offline/network';
import { record } from '../../offline/sync';
import type { DriverCtx } from './DriverApp';

const PROBLEMS = [
  { key: 'reefer_fault', label: 'Refrigeration not holding temperature' },
  { key: 'breakdown', label: 'Vehicle breakdown' },
  { key: 'road_closed', label: 'Road blocked or flooded' },
  { key: 'accident', label: 'Accident' },
] as const;

const DISPATCH_PHONE = '+94112345678';

/**
 * X1. Reporting is reachable from every stop, with the most time-critical problem first. With no
 * signal the report is queued and a call-dispatch button appears, because a cold-chain failure
 * cannot wait for coverage.
 */
export function X1Report({ d }: { d: DriverCtx }) {
  const { online } = useNetwork();
  const [problem, setProblem] = useState<(typeof PROBLEMS)[number]['key']>('reefer_fault');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<Date | null>(null);
  const trip = d.trips.find((t) => t.status === 'in_progress') ?? d.trips[0];
  const chilledLeft = trip?.stops.filter((s) => s.status === 'pending' && s.order.temp === 'chilled') ?? [];
  const next = trip?.stops.findIndex((s) => s.status === 'pending') ?? -1;

  return (
    <PhoneShell
      title="Report a problem"
      sub={trip ? `${trip.vehicleId} trip ${trip.tripNo}${next > 0 ? `, between stops ${next} and ${next + 1}` : ''}` : undefined}
      back="/driver/stop"
      backLabel="Trip"
      foot={
        <>
          {!sent && (
            <button
              className="btn warn"
              onClick={async () => {
                await record('incident.report', { incidentId: crypto.randomUUID(), type: problem, tripId: trip?.id ?? null, note: note || null }, { label: 'Problem report', detail: PROBLEMS.find((p) => p.key === problem)!.label, baseVersion: d.data?.planVersion });
                setSent(new Date());
              }}
            >
              Send to dispatch now
            </button>
          )}
          <a className="btn sec" href={`tel:${DISPATCH_PHONE}`} style={{ textAlign: 'center', textDecoration: 'none' }}>
            Call dispatch
          </a>
        </>
      }
    >
      {sent && (
        <Banner tone={online ? 'good' : 'warn'} title={online ? `Sent to dispatch at ${clock(sent)}` : `Saved at ${clock(sent)}, waiting for signal`}>
          {online ? 'Keep the doors closed. Dispatch is choosing a recovery; new instructions will appear here.' : 'This can’t wait for coverage: call dispatch now. The report sends itself when the signal returns.'}
        </Banner>
      )}
      <div className="card">
        <div className="list" role="radiogroup" aria-label="Problem type">
          {PROBLEMS.map((p) => {
            const on = problem === p.key;
            return (
              <div className="li" key={p.key}>
                <button className="opt-btn" role="radio" aria-checked={on} onClick={() => setProblem(p.key)} disabled={!!sent}>
                  <span className={`chk ${on ? 'on' : ''}`} style={{ borderRadius: '50%' }} aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className={`grow ${on ? 'nm' : ''}`}>{p.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <label className="field">
        {problem === 'reefer_fault' ? 'What does the display show?' : 'What happened?'}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={problem === 'reefer_fault' ? 'e.g. 9°C, set to 3°C' : ''} disabled={!!sent} />
      </label>
      {chilledLeft.length > 0 && (
        <div className="small muted">
          {chilledLeft.length} chilled stop{chilledLeft.length > 1 ? 's' : ''} still on board: {chilledLeft.map((s) => s.outlet.name.replace(/^Waypoint \w+ /, '')).join(', ')}.
        </div>
      )}
    </PhoneShell>
  );
}
