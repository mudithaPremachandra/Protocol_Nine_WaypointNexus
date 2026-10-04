import { PhoneShell } from '../../components/shells';
import { Banner } from '../../components/ui';
import { clock } from '../../lib/format';
import { lastOfflinePeriod } from '../../offline/network';
import { record } from '../../offline/sync';
import type { DriverCtx } from './DriverApp';

/**
 * DZ1 (and X4). In the dead zone the driver keeps recording while dispatch changes the plan. On
 * reconnect the phone shows what changed, who changed it and when, and asks the driver to accept
 * the new stop list, so two versions of the truth never quietly coexist. When the change arrives
 * while online (e.g. a cold-chain recovery) the same screen reads "Plan changed".
 */
export function DZ1PlanChanged({ d }: { d: DriverCtx }) {
  const data = d.data!;
  const latest = data.changes.find((c) => (c.planVersion ?? 0) > d.acceptedVersion && c.type !== 'plan.published') ?? data.changes[0];
  const period = lastOfflinePeriod();
  const at = latest ? new Date(latest.at).getTime() : 0;
  const whileOffline = !!period.from && at >= period.from && (!period.to || at <= period.to + 60_000);

  const now = new Set(d.serverStops.map((s) => s.orderId));
  const before = new Set(d.accepted.map((s) => s.orderId));
  const removed = d.accepted.filter((s) => !now.has(s.orderId));
  const added = d.serverStops.filter((s) => !before.has(s.orderId));
  const recordedOffline = d.outbox?.filter((m) => m.type === 'stop.record').length ?? 0;
  const rescue = latest?.payload.rescueVehicle;
  const failed = latest?.payload.failedVehicle;
  const handOver = rescue && failed === d.vehicle;

  return (
    <PhoneShell
      title={whileOffline ? 'Plan changed while offline' : 'Plan changed'}
      sub={latest ? `By ${latest.actorName ?? 'dispatch'} at ${clock(latest.at)}${whileOffline && period.to ? `. Back online at ${clock(new Date(period.to))}` : ''}` : undefined}
      foot={
        <button
          className="btn"
          onClick={async () => {
            await d.accept();
            await record('plan.ack', { version: data.planVersion }, { label: `Accepted plan v${data.planVersion}`, baseVersion: data.planVersion });
          }}
        >
          {handOver ? 'Accept and go to the meeting point' : 'Accept updated plan'}
        </button>
      }
    >
      <Banner tone={handOver ? 'crit' : 'warn'} title={handOver ? `Hand over the chilled stops to ${rescue}` : removed.length && !added.length ? `${removed.length} stop${removed.length > 1 ? 's' : ''} moved off your route` : added.length && !removed.length ? `${added.length} stop${added.length > 1 ? 's' : ''} added to your route` : 'Your stops have changed'}>
        {latest?.payload.message ?? 'Dispatch updated the plan.'}
      </Banner>
      {handOver && latest?.payload.kind === 'rescue' && (
        <div className="card">
          <h3>What to do now</h3>
          <div className="list">
            {[
              ['Pull over somewhere safe and keep the doors shut', 'now'],
              [`Meet ${rescue}`, latest.payload.depart ? `it leaves at ${latest.payload.depart}` : ''],
              [`Hand over ${removed.length} chilled stops`, '15 min'],
              ['Continue with any remaining dry stops, then return to the depot', ''],
            ].map(([a, b], i) => (
              <div className="li" key={a}>
                <span className="seqno">{i + 1}</span>
                <span className="grow">{a}</span>
                <span className="small muted">{b}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="grid2" style={{ gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="small muted">Stored on phone (v{d.acceptedVersion})</div>
            <div className="list small">
              {d.accepted.map((s) => (
                <div className="li" key={s.orderId} style={{ display: 'block' }}>
                  {s.outletName.replace(/^Waypoint \w+ /, '')}
                  <div className="tiny muted">{s.orderNo}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="small muted">Now (v{data.planVersion})</div>
            <div className="list small">
              {d.accepted.map((s) => (
                <div className={`li ${now.has(s.orderId) ? '' : 'strike'}`} key={s.orderId} style={{ display: 'block' }}>
                  {s.outletName.replace(/^Waypoint \w+ /, '')}
                  <div className="tiny muted">{now.has(s.orderId) ? s.orderNo : 'moved off'}</div>
                </div>
              ))}
              {added.map((s) => (
                <div className="li" key={s.orderId} style={{ fontWeight: 700 }}>
                  + {s.outletName.replace(/^Waypoint \w+ /, '')}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {recordedOffline > 0 && <div className="small muted">Your {recordedOffline} stop record{recordedOffline > 1 ? 's' : ''} made on this phone {recordedOffline > 1 ? 'were' : 'was'} kept and sent to dispatch.</div>}
    </PhoneShell>
  );
}
