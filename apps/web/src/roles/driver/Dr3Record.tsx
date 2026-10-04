import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { PhotoCapture } from '../../components/PhotoCapture';
import { Seg, Spinner, Stepper, useToast } from '../../components/ui';
import { useNetwork } from '../../offline/network';
import { recordFix } from '../../offline/location';
import { record } from '../../offline/sync';
import type { DriverCtx } from './DriverApp';

const OUTCOMES = ['Delivered', 'Part delivered', 'Not delivered'] as const;

/**
 * Dr3. Proof of delivery that doesn't depend on memory. Counts are prefilled from the load sheet,
 * including the loader's flagged shortfall, so the driver only corrects exceptions. A photo and the
 * receiver's name complete the record. With no signal, the stop is saved on the phone and queued.
 */
export function Dr3Record({ d }: { d: DriverCtx }) {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { online } = useNetwork();
  const trip = d.trips.find((t) => t.stops.some((s) => s.order.id === orderId));
  const s = trip?.stops.find((x) => x.order.id === orderId);
  const expected = s ? s.loadedUnits ?? s.order.units : 0;
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>(s && expected < s.order.units ? 'Part delivered' : 'Delivered');
  const [units, setUnits] = useState(expected);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [receiver, setReceiver] = useState('');
  const [note, setNote] = useState('');

  if (!trip || !s) return <PhoneShell title="Record the delivery" back="/driver/stop">{d.loading ? <Spinner /> : <div className="card empty">Stop not found.</div>}</PhoneShell>;

  const failed = outcome === 'Not delivered';
  const delivered = failed ? 0 : units;
  const canComplete = failed ? note.trim().length > 2 : !!photoId && receiver.trim().length > 1;
  const short = s.order.units - expected;

  const complete = async () => {
    await record(
      'stop.record',
      {
        deliveryId: crypto.randomUUID(),
        orderId: s.order.id,
        outcome: failed ? 'failed' : delivered < s.order.units ? 'partial' : 'delivered',
        deliveredUnits: delivered,
        receiverName: failed ? null : receiver.trim(),
        photoId: failed ? photoId : photoId,
        note: note.trim() || (short > 0 && !failed ? `${short} short (flagged at dock)` : null),
      },
      { label: `Stop ${s.seq + 1}, ${s.outlet.name.replace(/^Waypoint \w+ /, '')}`, detail: failed ? 'Not delivered' : `Delivered ${delivered} of ${s.order.units}`, baseVersion: d.data?.planVersion },
    );
    recordFix(trip.vehicleId);
    toast(online ? 'Stop recorded and sent' : 'Saved on this phone; it syncs when the signal returns');
    navigate('/driver/stop');
  };

  return (
    <PhoneShell
      title="Record the delivery"
      sub={`${s.outlet.name.replace(/^Waypoint \w+ /, '')}, ${s.order.orderNo}`}
      back="/driver/stop"
      backLabel={`Stop ${s.seq + 1}`}
      foot={
        <>
          <div className="small muted">
            {online ? 'Connected. The record is sent as soon as you complete the stop.' : 'No signal. This stop is saved on the phone and syncs later.'}
            {!failed && !photoId ? ' A photo of the goods is required.' : ''}
            {!failed && photoId && receiver.trim().length < 2 ? ' Add who received the goods.' : ''}
            {failed && note.trim().length < 3 ? ' Say why it could not be delivered.' : ''}
          </div>
          <button className="btn" disabled={!canComplete} onClick={() => void complete()}>
            Complete stop
          </button>
        </>
      }
    >
      <Seg label="Outcome" options={OUTCOMES} value={outcome} onChange={(o) => {
        setOutcome(o);
        if (o === 'Delivered') setUnits(expected);
      }} />
      {!failed && (
        <div className="card">
          <div className="list">
            {s.order.lines.map((l) => (
              <div className="li" key={l.productId}>
                <span className="grow">
                  {l.name} <span className="muted small">({l.unit})</span>
                </span>
                <b>{l.qty}</b>
              </div>
            ))}
            {short > 0 && (
              <div className="li">
                <span className="grow">
                  Short at the dock
                  <div className="mt">{s.flags.filter((f) => f.role === 'loader').map((f) => `${f.qty} ${f.item}`).join(', ')}</div>
                </span>
                <b style={{ color: 'var(--warn)' }}>−{short}</b>
              </div>
            )}
            <div className="li">
              <span className="grow nm">Units handed over</span>
              <Stepper label="units handed over" value={units} onChange={(v) => {
                setUnits(v);
                setOutcome(v < s.order.units ? 'Part delivered' : 'Delivered');
              }} max={s.order.units} />
            </div>
          </div>
        </div>
      )}
      <PhotoCapture label={`POD ${s.order.orderNo}`} photoId={photoId} onChange={setPhotoId} prompt={failed ? 'Photo of the closed outlet (optional)' : 'Take a photo of the goods'} />
      {!failed && (
        <label className="field">
          Received by
          <input value={receiver} onChange={(e) => setReceiver(e.target.value)} autoComplete="off" placeholder="Name of the person receiving" />
        </label>
      )}
      <label className="field">
        {failed ? 'Why could it not be delivered?' : 'Note (optional)'}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </PhoneShell>
  );
}
