import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { PhotoCapture } from '../../components/PhotoCapture';
import { Pill, Seg, Spinner, Stepper, useToast } from '../../components/ui';
import { record } from '../../offline/sync';
import { useLoader } from './useLoader';

/**
 * L3. A missing crate used to be discovered at the outlet. The loader flags it at the dock: item,
 * quantity, missing or damaged, optional photo. The flag reaches dispatch, pre-warns the store and
 * lowers the driver's expected count, so three roles see the same numbers.
 */
export function L3Flag() {
  const { tripId, orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { trips, data } = useLoader();
  const t = trips.find((x) => x.id === tripId);
  const s = t?.stops.find((x) => x.order.id === orderId);
  const [line, setLine] = useState('');
  const [problem, setProblem] = useState<'Missing' | 'Damaged' | 'Wrong item'>('Missing');
  const [loaded, setLoaded] = useState(0);
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const item = s?.order.lines.find((l) => l.productId === line) ?? s?.order.lines[0];

  useEffect(() => {
    if (item) setLoaded(Math.max(0, item.qty - 1));
  }, [item?.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t || !s || !item) return <PhoneShell title="Flag a problem" back={`/loader/trip/${tripId}`} depotNet><Spinner /></PhoneShell>;
  const short = item.qty - loaded;

  const send = async () => {
    await record(
      'flag.raise',
      { flagId: crypto.randomUUID(), type: problem === 'Damaged' ? 'damage' : 'shortfall', tripId: t.id, orderId: s.order.id, item: `${item.name} ${item.unit}s`, qty: short, note: [problem === 'Wrong item' ? 'Wrong item picked' : '', note].filter(Boolean).join('. ') || null, photoId },
      { label: `Flag, ${t.vehicleId}`, detail: `${short} × ${item.name}, ${s.outlet.name}`, baseVersion: data?.planVersion },
    );
    await record('load.check', { tripId: t.id, orderId: s.order.id, loadedUnits: Math.max(0, s.order.units - short) }, { label: `Load check, ${t.vehicleId}`, detail: s.outlet.name, baseVersion: data?.planVersion });
    toast('Flag sent: dispatch, driver and store told');
    navigate(`/loader/trip/${t.id}`);
  };

  return (
    <PhoneShell
      title="Flag a problem"
      sub={`${t.vehicleId} trip ${t.tripNo}, stop ${s.seq + 1}: ${s.outlet.name.replace(/^Waypoint \w+ /, '')}, ${s.order.orderNo}`}
      back={`/loader/trip/${t.id}`}
      backLabel="Load sheet"
      depotNet
      foot={
        <button className="btn" disabled={short <= 0} onClick={() => void send()}>
          Send flag
        </button>
      }
    >
      <label className="field">
        Item
        <select value={item.productId} onChange={(e) => setLine(e.target.value)}>
          {s.order.lines.map((l) => (
            <option key={l.productId} value={l.productId}>
              {l.name}, {l.qty} {l.unit}s ordered
            </option>
          ))}
        </select>
      </label>
      <div className="card row">
        <div>
          <div className="nm">{item.name}</div>
          <div className="small muted">
            {item.unit[0]!.toUpperCase() + item.unit.slice(1)}s. Ordered {item.qty}.
          </div>
        </div>
        {s.order.temp === 'chilled' ? <Pill tone="cold">Chilled</Pill> : <Pill>Ambient</Pill>}
      </div>
      <div className="field">
        Problem
        <Seg label="Problem" options={['Missing', 'Damaged', 'Wrong item'] as const} value={problem} onChange={setProblem} />
      </div>
      <div className="field">
        {problem === 'Damaged' ? 'Good to load' : 'Loaded'}
        <div className="row">
          <Stepper label={`${item.unit}s loaded`} value={loaded} onChange={setLoaded} max={item.qty} />
          <span className="small muted">
            {short} {item.unit}
            {short === 1 ? '' : 's'} {problem === 'Damaged' ? 'damaged' : 'short'}
          </span>
        </div>
      </div>
      <PhotoCapture label={`Flag ${s.order.orderNo}`} photoId={photoId} onChange={setPhotoId} prompt="Add a photo (optional)" />
      <label className="field">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Only 9 crates in the cold room" />
      </label>
      <div className="small muted">Sending tells dispatch, lowers the driver’s expected count and lets the store know before delivery.</div>
    </PhoneShell>
  );
}
