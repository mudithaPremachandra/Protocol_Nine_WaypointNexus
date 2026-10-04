import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useSession } from '../../app/session';
import { PhoneShell } from '../../components/shells';
import { Banner, Pill, Spinner } from '../../components/ui';
import { api, post } from '../../lib/api';
import { clock } from '../../lib/format';
import type { StoreOrder, StoreView } from '../../lib/types';

const STEPS = ['Received', 'Planned', 'Loaded', 'On the way', 'Delivered'];

function stepIndex(o: StoreOrder) {
  switch (o.status) {
    case 'placed':
    case 'queued':
      return 0;
    case 'planned':
      return o.eta ? 1 : 0;
    case 'loaded':
      return 2;
    case 'in_transit':
      return 3;
    case 'delivered':
    case 'partial':
    case 'failed':
    case 'received':
      return 4;
    default:
      return 0;
  }
}

/**
 * SM2. The manager's real question is when to have staff at the back door. Each order reads like
 * a parcel tracker: one status line, one arrival window, one suggested action. Deferral notices
 * carry the same red marker the dispatcher uses.
 */
export function SM2Deliveries() {
  const { me } = useSession();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['store-view'], queryFn: () => api<StoreView>('/store/view'), refetchInterval: 30_000 });
  const markRead = useMutation({
    mutationFn: () => post('/store/notifications/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-view'] }),
  });
  const v = view.data;
  const unread = v?.notifications.filter((n) => !n.readAt && ['changed', 'deferred', 'shortfall'].includes(n.type)) ?? [];
  const orders = (v?.orders ?? []).filter((o) => o.requestedDate >= (v?.serviceDate ?? '') || o.deferral || ['delivered', 'partial'].includes(o.status));

  return (
    <PhoneShell
      title="Deliveries"
      sub={`${me?.outletName ?? ''}, ${me?.outletId ?? ''}`}
      foot={
        <Link className="btn sec" to="/store/order" style={{ textAlign: 'center', textDecoration: 'none' }}>
          New order
        </Link>
      }
    >
      {view.isLoading && <Spinner />}
      {unread.map((n) => (
        <Banner key={n.id} tone={n.type === 'changed' ? 'warn' : n.type === 'deferred' ? 'crit' : 'mari'} title={n.title}>
          {n.body}
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => markRead.mutate()}>
              Got it
            </button>
          </div>
        </Banner>
      ))}
      {v && orders.length === 0 && <div className="card empty">No orders for {v.serviceDay} yet.</div>}
      {orders.map((o) => (
        <OrderCard key={o.id} o={o} serviceDay={v!.serviceDay} brand={v!.outlet.brand} />
      ))}
    </PhoneShell>
  );
}

function OrderCard({ o, serviceDay, brand }: { o: StoreOrder; serviceDay: string; brand: string }) {
  const goods = o.temp === 'chilled' ? <Pill tone="cold">Chilled</Pill> : <Pill tone="tea">{brand === 'Fresh' ? 'Dry groceries' : brand}</Pill>;

  if (o.status === 'deferred' && o.deferral) {
    return (
      <div className="card">
        <div className="row">
          <h3>{o.orderNo}</h3>
          <Pill tone="crit">Moved to {o.deferral.deferredToDay}</Pill>
        </div>
        <div className="sub" style={{ marginTop: 6 }}>
          {o.deferral.storeText}
          {o.deferral.note ? ` ${o.deferral.note}.` : ''}
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          <b>Arrives {o.deferral.deferredToDay}, first in line.</b> Nothing to re-order.
        </div>
      </div>
    );
  }

  const idx = stepIndex(o);
  const delivered = ['delivered', 'partial', 'failed', 'received'].includes(o.status);
  return (
    <div className="card">
      <div className="row">
        <h3>{o.orderNo}</h3>
        {goods}
      </div>
      {o.note && <div className="tiny muted">{o.note}</div>}
      {!o.eta && !delivered && <div className="sub">Waiting for tonight’s plan. Arrival time appears once dispatch publishes it.</div>}
      {o.eta && !delivered && (
        <>
          <div className="small muted" style={{ marginTop: 6 }}>
            Arrives {serviceDay} within
          </div>
          <div className="big">
            {o.eta.from}–{o.eta.to}
          </div>
        </>
      )}
      {delivered && o.delivery && (
        <div className="small" style={{ marginTop: 6 }}>
          <b>
            {o.delivery.outcome === 'failed' ? 'Not delivered' : o.delivery.outcome === 'partial' ? 'Part delivered' : 'Delivered'} at {clock(o.delivery.deviceTime)}
          </b>
          , {o.delivery.deliveredUnits} of {o.units} units{o.delivery.receiverName ? `, received by ${o.delivery.receiverName}` : ''}.
        </div>
      )}
      <div className="track-steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <div key={s} className={i < idx ? 'on' : i === idx ? (o.status === 'failed' ? 'bad' : delivered ? 'on' : 'cur') : ''} />
        ))}
      </div>
      <div className="tlabels">
        {STEPS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <span className="sr-only">Status: {STEPS[idx]}</span>
      {o.eta && !delivered && o.vehicleId && (
        <div className="small" style={{ marginTop: 10 }}>
          On {o.vehicleId}. Have someone ready to receive from {o.eta.from}.
        </div>
      )}
      {o.flags.some((f) => f.type === 'shortfall' || f.type === 'damage') && !delivered && (
        <div className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
          {o.flags
            .filter((f) => f.type === 'shortfall' || f.type === 'damage')
            .map((f) => `${f.qty ?? ''} ${f.item ?? ''} ${f.type === 'damage' ? 'damaged' : 'short'} at the dock`.trim())
            .join('; ')}
          . Already known to dispatch.
        </div>
      )}
      {delivered && !o.receipt && o.delivery && (
        <Link className="btn sec" to={`/store/receipt/${o.id}`} style={{ marginTop: 10, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Confirm what arrived
        </Link>
      )}
      {o.receipt && (
        <div className="small" style={{ marginTop: 10 }}>
          <Pill tone={o.receipt.status === 'confirmed' ? 'good' : 'mari'}>{o.receipt.status === 'confirmed' ? 'Receipt confirmed' : 'Issue reported'}</Pill> at {clock(o.receipt.createdAt)}
        </div>
      )}
    </div>
  );
}
