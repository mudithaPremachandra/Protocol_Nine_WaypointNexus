import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { Banner, Pill } from '../../components/ui';
import { clock } from '../../lib/format';
import { db } from '../../offline/db';
import { setSimulatedOffline, useNetwork } from '../../offline/network';
import { flush, syncStatus } from '../../offline/sync';

/**
 * Dr4. Offline only works if the driver trusts it. This screen shows exactly what is waiting to
 * upload and when the last sync happened, then confirms when everything has reached dispatch.
 * Photos queue separately, so a slow upload never blocks the next stop.
 */
export function Dr4Sync() {
  const { online, simulated } = useNetwork();
  const items = useLiveQuery(() => db.outbox.orderBy('createdAt').reverse().limit(30).toArray(), [], []);
  const pings = useLiveQuery(() => db.pings.count(), [], 0);
  const photos = useLiveQuery(() => db.photos.orderBy('createdAt').reverse().limit(20).toArray(), [], []);
  const queued = items.filter((i) => i.status === 'queued').length + photos.filter((p) => p.status === 'queued').length;
  const rejected = items.filter((i) => i.status === 'rejected');
  const warnings = items.filter((i) => i.warning);
  const { lastSuccess } = syncStatus();
  const lastSync = Math.max(lastSuccess, ...items.map((i) => i.syncedAt ?? 0));

  return (
    <PhoneShell
      title={queued ? 'Waiting to sync' : 'All synced'}
      sub={queued ? `Last sync ${lastSync ? clock(new Date(lastSync)) : 'not yet'}.` : 'Dispatch has every record.'}
      back="/driver"
      backLabel="Today"
      foot={
        queued ? (
          <button
            className="btn sec"
            onClick={() => {
              if (simulated) setSimulatedOffline(false);
              void flush();
            }}
          >
            {online ? 'Sync now' : simulated ? 'Signal back: sync now' : 'Waiting for signal'}
          </button>
        ) : (
          <Link className="btn" to="/driver/stop" style={{ textAlign: 'center', textDecoration: 'none' }}>
            Next stop
          </Link>
        )
      }
    >
      {queued ? (
        <Banner tone="warn" title={online ? 'Sending…' : 'No signal'}>
          Records are saved on this phone and upload automatically when the signal returns. You can carry on with the next stop.
        </Banner>
      ) : (
        <Banner tone="good" title={`Everything reached dispatch${lastSync ? ` by ${clock(new Date(lastSync))}` : ''}`}>
          All records made offline were kept.
        </Banner>
      )}
      {warnings.map((w) => (
        <Banner key={w.id} tone="mari" title={`${w.label}: dispatch notified`}>
          {w.warning}
        </Banner>
      ))}
      {rejected.map((r) => (
        <Banner key={r.id} tone="crit" title={`${r.label} was not accepted`}>
          {r.error}
        </Banner>
      ))}
      <div className="card">
        <div className="list">
          {items.length === 0 && photos.length === 0 && <div className="small muted">Nothing recorded on this phone yet.</div>}
          {items.map((i) => (
            <div className="li" key={i.id}>
              <span className={`chk sm ${i.status === 'synced' ? 'on' : i.status === 'rejected' ? 'bad' : ''}`} aria-hidden="true">
                {i.status === 'synced' ? '✓' : i.status === 'rejected' ? '✕' : ''}
              </span>
              <div className="grow">
                <div className="nm">{i.label}</div>
                <div className="mt">
                  {i.detail ? `${i.detail}, ` : ''}recorded {clock(i.at)}
                  {i.syncedAt && i.status === 'synced' ? `, synced ${clock(new Date(i.syncedAt))}` : ''}
                </div>
              </div>
              {i.status === 'synced' ? <Pill tone="good">Synced</Pill> : i.status === 'rejected' ? <Pill tone="crit">Rejected</Pill> : <Pill tone="warn">Queued</Pill>}
            </div>
          ))}
          {photos.map((p) => (
            <div className="li" key={p.id}>
              <span className={`chk sm ${p.status === 'synced' ? 'on' : ''}`} aria-hidden="true">
                {p.status === 'synced' ? '✓' : ''}
              </span>
              <div className="grow">
                <div className="nm">Photo, {p.label}</div>
                <div className="mt">{p.blob.size < 100_000 ? `${Math.round(p.blob.size / 1024)} KB` : `${(p.blob.size / 1024 / 1024).toFixed(1)} MB`}, taken {clock(new Date(p.createdAt))}</div>
              </div>
              {p.status === 'synced' ? <Pill tone="good">Synced</Pill> : <Pill tone="warn">Queued</Pill>}
            </div>
          ))}
        </div>
      </div>
      {pings > 0 && <div className="small muted">{pings} location point{pings === 1 ? '' : 's'} saved on the phone, sent with the next sync.</div>}
      <div className="tiny muted">Tip for the demo: tap the signal badge at the top to simulate losing coverage.</div>
    </PhoneShell>
  );
}
