import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RULE_LABELS, type Check } from '@wn/domain';
import { Banner, CheckRow, ErrorNote, Pill, Spinner } from '../../components/ui';
import { api, post } from '../../lib/api';
import { kg, m3 } from '../../lib/format';
import type { MoveResult, PlanView, TripCheck } from '../../lib/types';
import { vehicleType } from './common';

function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
        <div className="dh">
          <div className="row">
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button className="link" onClick={onClose}>
              Close
            </button>
          </div>
          {sub && <div className="small muted">{sub}</div>}
        </div>
        <div className="db">{children}</div>
      </aside>
    </>
  );
}

/** Real numbers for every rule, in the dispatcher's words. */
function ruleDetail(c: Check, breakdown?: TripCheck['breakdown'], interStops?: number): string {
  if (c.rule === 'TIME_BUDGET' && breakdown) {
    return `${breakdown.outbound} min outbound + ${interStops} × between stops (${breakdown.interStop} min) + ${breakdown.handling} min handling`;
  }
  return c.message;
}

function value(c: Check): string {
  if (c.limit != null && c.actual != null && c.rule !== 'DELIVERY_WINDOW') {
    const a = c.unit === 'm³' ? c.actual.toFixed(1) : Math.round(c.actual).toLocaleString('en-GB');
    return `${a} / ${c.limit.toLocaleString('en-GB')} ${c.unit ?? ''}`.trim();
  }
  return c.ok ? 'Pass' : 'Fail';
}

/** D3. Explainability: every constraint check with the real numbers, and how trip time is built. */
export function TripCheckDrawer({ tripId, onClose, onDeferred }: { tripId: string; onClose: () => void; onDeferred: (orderNo: string) => void }) {
  const q = useQuery({ queryKey: ['trip-check', tripId], queryFn: () => api<TripCheck>(`/dispatch/trips/${tripId}`) });
  const defer = useMutation({
    mutationFn: (o: { orderId: string; orderNo: string }) => post('/dispatch/defer', { orderId: o.orderId, note: 'Moved to the next run by dispatch' }).then(() => o.orderNo),
    onSuccess: (orderNo) => {
      onDeferred(orderNo);
      void q.refetch();
    },
  });
  const t = q.data;
  return (
    <Drawer
      title={t ? `Why ${t.trip.vehicleId}, trip ${t.trip.tripNo} works` : 'Trip check'}
      sub={t ? `${vehicleType(t.vehicle)}, ${t.trip.depot}. ${t.trip.brand}, ${t.trip.district}. ${t.stops.length} stops, departs ${t.timing.depart}, back ${t.timing.return}.` : ''}
      onClose={onClose}
    >
      {q.isLoading && <Spinner />}
      <ErrorNote error={q.error ?? defer.error} />
      {t && (
        <>
          {t.checks.some((c) => !c.ok) && <Banner tone="crit" title="This trip breaks a rule">Fix or move the stops marked below.</Banner>}
          {t.checks
            .filter((c) => c.rule !== 'SAME_BRAND_DISTRICT' || !c.ok)
            .map((c, i) => (
              <CheckRow key={i} ok={c.ok} label={RULE_LABELS[c.rule]} detail={ruleDetail(c, t.breakdown, Math.max(0, t.stops.length - 1))} value={value(c)} />
            ))}
          <CheckRow ok label={RULE_LABELS.SAME_BRAND_DISTRICT} detail={`All ${t.trip.brand}, all ${t.trip.district}`} value="Pass" />
          <div className="tbl">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">Stop</th>
                  <th scope="col">Outlet</th>
                  <th scope="col">Arrives</th>
                  <th scope="col">Window</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.stops.map((s) => (
                  <tr key={s.orderId} className={s.orderNo === 'WF-30921' ? 'hl' : ''}>
                    <td>{s.seq + 1}</td>
                    <td>
                      {s.outletName}
                      <div className="tiny muted">
                        {s.orderNo}, {s.temp}, {s.units} units, {m3(s.volumeM3)}
                      </div>
                    </td>
                    <td>
                      {s.arriveText}
                      {s.waitMin > 0 && <div className="tiny muted">waits {s.waitMin} min</div>}
                      {s.lateMin > 0 && <div className="tiny" style={{ color: 'var(--crit)' }}>{s.lateMin} min late</div>}
                    </td>
                    <td>{s.windowText}</td>
                    <td>
                      <button className="link" disabled={defer.isPending} onClick={() => defer.mutate({ orderId: s.orderId, orderNo: s.orderNo })}>
                        Defer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny muted">
            Arrival times are planned from free-flow travel (district_travel.csv) and the service allowances. An early vehicle waits for the window. Late-risk flags on the live board use typical traffic and the day’s road conditions.
          </div>
        </>
      )}
    </Drawer>
  );
}

/**
 * D3B. Placing an order validates the move with the same rule checker the planner uses. A blocked
 * move names the failing rule and number and offers vehicles that would pass.
 */
export function PlaceOrderDrawer({ orderId, plan, onClose, onApplied }: { orderId: string; plan: PlanView; onClose: () => void; onApplied: (msg: string) => void }) {
  const deferral = plan.deferrals.find((d) => d.orderId === orderId);
  const order = deferral?.order;
  const options = useMemo(() => {
    if (!order) return [];
    const vs = plan.vehicles.filter((v) => v.depot === order.depot && v.status === 'available');
    return vs.flatMap((v) => {
      const trips = plan.trips.filter((t) => t.vehicleId === v.id);
      const opts = trips.map((t) => ({ key: `${v.id}|${t.tripNo}`, vehicleId: v.id, tripNo: t.tripNo as number | undefined, label: `${v.id} trip ${t.tripNo}: ${t.brand}, ${t.district} (${vehicleType(v)})` }));
      if (trips.length < 2) opts.push({ key: `${v.id}|new`, vehicleId: v.id, tripNo: undefined, label: `${v.id} new trip ${trips.length + 1} (${vehicleType(v)})` });
      return opts;
    });
  }, [plan, order]);
  const [target, setTarget] = useState<string>('');
  const chosen = options.find((o) => o.key === target);

  const check = useMutation({
    mutationFn: (apply: boolean) => post<MoveResult>('/dispatch/move', { orderId, vehicleId: chosen!.vehicleId, tripNo: chosen!.tripNo, apply }),
    onSuccess: (r) => {
      if (r.applied) onApplied(`${order?.orderNo} placed on ${chosen?.vehicleId}`);
    },
  });
  useEffect(() => {
    if (chosen) check.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const swap = useMutation({
    mutationFn: () => post('/dispatch/swap', { orderId, victimOrderId: deferral!.swap!.victimOrderId }),
    onSuccess: () => onApplied(`Swap applied: ${order?.orderNo} is served, ${deferral?.swap?.victim?.orderNo} moves to the next run`),
  });

  if (!order || !deferral) return null;
  const r = check.data;
  return (
    <Drawer
      title={`Place ${order.orderNo}?`}
      sub={`${deferral.outlet.name}, ${order.temp}, ${m3(order.volumeM3)}, ${kg(order.weightKg)}. ${deferral.repeatSkip ? 'Skipped yesterday.' : deferral.reasonLabel + '.'}`}
      onClose={onClose}
    >
      {deferral.swap && (
        <Banner
          tone="mari"
          title="Suggested swap"
          action={
            <button className="btn sm" onClick={() => swap.mutate()} disabled={swap.isPending}>
              Apply swap
            </button>
          }
        >
          Serve {order.orderNo} instead of {deferral.swap.victim?.orderNo} ({deferral.swap.victimOutlet}), which has lower impact. Fits {deferral.swap.vehicleId}, trip {deferral.swap.tripNo}.
        </Banner>
      )}
      <label className="field">
        Vehicle and trip
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose where to put it</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <ErrorNote error={check.error ?? swap.error} />
      {check.isPending && <Spinner />}
      {r && !check.isPending && (
        <>
          {r.ok ? (
            <Banner tone="good" title="Every rule passes">
              {chosen?.label}
            </Banner>
          ) : (
            <Banner tone="crit" icon="✕" title={`Can’t add: ${r.failing.map((f) => RULE_LABELS[f.rule].toLowerCase()).join(', ')}`}>
              {r.failing[0]?.message}
            </Banner>
          )}
          {r.checks
            .filter((c) => c.rule !== 'SAME_BRAND_DISTRICT' || !c.ok)
            .map((c, i) => (
              <CheckRow key={i} ok={c.ok} label={RULE_LABELS[c.rule]} detail={c.message} value={value(c)} />
            ))}
          {!r.ok && (
            <>
              <h3 style={{ margin: '8px 0 0' }}>Vehicles that would pass</h3>
              {r.suggestions.length === 0 && <div className="small muted">None today: every vehicle that could carry it is full or out of time. It stays deferred with its reason recorded.</div>}
              {r.suggestions.map((s) => (
                <div className="row" key={`${s.vehicleId}${s.tripNo}`}>
                  <span>
                    {s.vehicleId}, {s.isNewTrip ? `new trip ${s.tripNo}` : `trip ${s.tripNo}`} <Pill tone="good">Fits</Pill>
                  </span>
                  <button className="btn sm sec" onClick={() => setTarget(`${s.vehicleId}|${s.isNewTrip ? 'new' : s.tripNo}`)}>
                    Use this
                  </button>
                </div>
              ))}
            </>
          )}
          {r.ok && (
            <button className="btn" onClick={() => check.mutate(true)}>
              Place {order.orderNo} on {chosen?.vehicleId}
            </button>
          )}
        </>
      )}
    </Drawer>
  );
}
