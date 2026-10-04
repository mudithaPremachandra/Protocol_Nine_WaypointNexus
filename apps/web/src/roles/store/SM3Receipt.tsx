import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PhoneShell } from '../../components/shells';
import { PhotoCapture } from '../../components/PhotoCapture';
import { Banner, Pill, Seg, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { clock } from '../../lib/format';
import type { StoreView } from '../../lib/types';
import { flush, onSynced, record } from '../../offline/sync';

/**
 * SM3. Closing the loop turns the driver's record into something the store can act on: what was
 * ordered against what the driver recorded, the proof photo and receiver, and any shortfall the
 * loader already flagged, so the store doesn't raise a dispute for a known gap.
 */
export function SM3Receipt() {
  const { orderId } = useParams();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['store-view'], queryFn: () => api<StoreView>('/store/view') });
  const [mode, setMode] = useState<'review' | 'issue'>('review');
  const [problem, setProblem] = useState<'Damaged' | 'Missing' | 'Too warm'>('Damaged');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [sent, setSent] = useState<{ kind: 'confirmed' | 'issue'; at: Date } | null>(null);

  const o = view.data?.orders.find((x) => x.id === orderId);
  if (!o) return <PhoneShell title="Confirm receipt" back="/store" backLabel="Deliveries">{view.isLoading ? <Spinner /> : <div className="card empty">Order not found.</div>}</PhoneShell>;
  const d = o.delivery;
  const dockFlags = o.flags.filter((f) => f.role === 'loader');
  const short = o.units - (d?.deliveredUnits ?? 0);

  const submit = async (status: 'confirmed' | 'issue') => {
    await record(
      'receipt.confirm',
      {
        receiptId: crypto.randomUUID(),
        orderId: o.id,
        status,
        receivedUnits: d?.deliveredUnits ?? null,
        note: status === 'issue' ? `${problem}: ${qty} × ${item || 'item'}. ${note}`.trim() : null,
        photoId: status === 'issue' ? photoId : null,
      },
      { label: `${o.orderNo} receipt`, detail: status },
    );
    setSent({ kind: status, at: new Date() });
    const off = onSynced(() => {
      void qc.invalidateQueries({ queryKey: ['store-view'] });
      off();
    });
    void flush();
    setMode('review');
  };

  if (mode === 'issue') {
    return (
      <PhoneShell
        title="Report an issue"
        sub={`${o.orderNo}, delivered ${clock(d?.deviceTime)}`}
        foot={
          <>
            <button className="btn" onClick={() => void submit('issue')}>
              Send to dispatch
            </button>
            <button className="btn sec" onClick={() => setMode('review')}>
              Cancel
            </button>
          </>
        }
      >
        <label className="field">
          Item
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">Choose an item</option>
            {o.lines.map((l) => (
              <option key={l.id} value={`${l.name}, ${l.unit}`}>
                {l.name}, {l.unit}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          Problem
          <Seg label="Problem" options={['Damaged', 'Missing', 'Too warm'] as const} value={problem} onChange={setProblem} />
        </div>
        <label className="field">
          Quantity
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} />
        </label>
        <PhotoCapture label={`${o.orderNo} receipt issue`} photoId={photoId} onChange={setPhotoId} prompt="Add a photo" />
        <label className="field">
          Note
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you find?" />
        </label>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell
      title="Confirm receipt"
      sub={`${o.orderNo}, ${o.temp === 'chilled' ? 'chilled' : 'dry goods'}`}
      back="/store"
      backLabel="Deliveries"
      foot={
        o.receipt || sent ? undefined : (
          <>
            <button className="btn" onClick={() => void submit('confirmed')}>
              Confirm {d?.deliveredUnits ?? o.units} received
            </button>
            <button className="btn sec" onClick={() => setMode('issue')}>
              Report an issue
            </button>
          </>
        )
      }
    >
      {d && (
        <Banner tone={d.outcome === 'failed' ? 'crit' : 'good'} title={`${d.outcome === 'failed' ? 'Not delivered' : 'Delivered'} at ${clock(d.deviceTime)}`}>
          {d.vehicleId ? `On ${d.vehicleId}. ` : ''}
          {d.receiverName ? `Received by ${d.receiverName}.` : ''}
        </Banner>
      )}
      {d?.photoId && (
        <div className="photo done">
          <img src={`/api/photos/${d.photoId}`} alt="Driver's photo of the delivered goods" />
          <span className="stamp">Driver’s photo, {clock(d.deviceTime)}</span>
        </div>
      )}
      <div className="card">
        <div className="list">
          {o.lines.map((l) => (
            <div className="li" key={l.id}>
              <div className="grow">
                <div className="nm">{l.name}</div>
                <div className="mt">per {l.unit}</div>
              </div>
              <b>{l.qty} ordered</b>
            </div>
          ))}
          <div className="li">
            <div className="grow">
              <div className="nm">Total delivered</div>
              {dockFlags.map((f) => (
                <div className="mt" key={f.id}>
                  {f.qty} {f.item} flagged {f.type === 'damage' ? 'damaged' : 'missing'} at the dock at {clock(f.deviceTime)}
                </div>
              ))}
            </div>
            <b>
              {d?.deliveredUnits ?? 0} of {o.units}
            </b>
            {short > 0 ? <Pill tone="warn">Short {short}</Pill> : <Pill tone="good">OK</Pill>}
          </div>
        </div>
      </div>
      {short > 0 && dockFlags.length > 0 && (
        <div className="small muted">The shortfall was flagged at the dock before the truck left, so dispatch already has it. No claim needed.</div>
      )}
      {(o.receipt?.status === 'confirmed' || sent?.kind === 'confirmed') && (
        <Banner tone="good" title={`Receipt confirmed at ${clock(o.receipt?.createdAt ?? sent?.at)}`}>
          Dispatch has the record.
        </Banner>
      )}
      {(o.receipt?.status === 'issue' || sent?.kind === 'issue') && (
        <Banner tone="mari" title={`Issue sent at ${clock(o.receipt?.createdAt ?? sent?.at)}`}>
          Dispatch sees it on the live board.
        </Banner>
      )}
    </PhoneShell>
  );
}
