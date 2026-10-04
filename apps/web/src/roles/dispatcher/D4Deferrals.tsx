import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DeskShell } from '../../components/shells';
import { Banner, ErrorNote, Pill, Spinner, useToast } from '../../components/ui';
import { api, post } from '../../lib/api';
import { clock, day } from '../../lib/format';
import type { PlanView } from '../../lib/types';
import { impact } from './common';
import { PlaceOrderDrawer } from './drawers';

/**
 * D4. Deferral is a decision with consequences, so it gets a record: a reason code, when the outlet
 * was last served and whether it was skipped yesterday. Repeat skips are flagged with a proposed
 * swap. Approving sends notices to every affected store in one action instead of a round of calls.
 */
export function D4Deferrals() {
  const qc = useQueryClient();
  const toast = useToast();
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanView>('/dispatch/plan') });
  const [depot, setDepot] = useState<'all' | string>('all');
  const [confirm, setConfirm] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => post<{ version: number }>('/dispatch/publish'),
    onSuccess: (r) => {
      setConfirm(false);
      toast(`Plan v${r.version} published; stores notified`);
      void qc.invalidateQueries();
    },
  });
  const swap = useMutation({
    mutationFn: (v: { orderId: string; victimOrderId: string }) => post('/dispatch/swap', v),
    onSuccess: () => {
      toast('Swap applied');
      void qc.invalidateQueries();
    },
  });

  const p = plan.data;
  if (plan.isLoading) return <DeskShell title="Deferral review"><Spinner /></DeskShell>;
  if (!p?.plan) return <DeskShell title="Deferral review"><div className="card empty">Build a plan first.</div></DeskShell>;

  const all = p.deferrals.filter((d) => d.order.status === 'deferred');
  const rows = all.filter((d) => depot === 'all' || d.order.depot === depot);
  const repeats = all.filter((d) => d.repeatSkip);
  const carried = p.trips.flatMap((t) => t.stops).filter((s) => s.order.deferredYesterday);
  const reasons = Object.entries(all.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.reasonLabel]: (acc[d.reasonLabel] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const forced = all.filter((d) => d.reason !== 'DISPATCHER_CHOICE').length;
  const published = p.plan.status === 'published';
  const stores = new Set(all.map((d) => d.order.outletId)).size;

  return (
    <DeskShell
      title="Deferral review"
      counts={{ deferrals: all.length }}
      right={
        <div className="tabs" role="group" aria-label="Depot">
          {['all', 'Kandy', 'Peliyagoda'].map((d) => (
            <button key={d} aria-pressed={depot === d} onClick={() => setDepot(d)}>
              {d === 'all' ? `Both (${all.length})` : `${d} (${all.filter((x) => x.order.depot === d).length})`}
            </button>
          ))}
        </div>
      }
    >
      <ErrorNote error={publish.error ?? swap.error} />
      {repeats.map((d) =>
        d.swap ? (
          <Banner
            key={d.id}
            tone="crit"
            title={`${d.outlet.name} would be skipped two runs in a row`}
            action={
              <button className="btn sm" disabled={swap.isPending} onClick={() => swap.mutate({ orderId: d.orderId, victimOrderId: d.swap!.victimOrderId })}>
                Apply swap
              </button>
            }
          >
            Suggested swap: serve {d.order.orderNo} instead of {d.swap.victim?.orderNo} ({d.swap.victimOutlet}), which has lower impact. Both fit {d.swap.vehicleId}, trip {d.swap.tripNo}.
          </Banner>
        ) : (
          <Banner key={d.id} tone="crit" title={`${d.outlet.name} is skipped two runs in a row`} action={<button className="btn sm" onClick={() => setPlacing(d.orderId)}>Try to place it</button>}>
            {d.detail} No lower-impact order on a compatible trip could make room. It goes first on {day(d.deferredTo)}.
          </Banner>
        ),
      )}
      {repeats.length === 0 && (
        <Banner tone="good" title="No outlet is skipped twice in a row">
          {carried.length ? `The ${carried.length} orders carried over from the previous run were all placed first.` : 'Nothing was carried over from the previous run.'}
        </Banner>
      )}
      <div className="row wrap">
        <div className="pills">
          {reasons.map(([r, c]) => (
            <Pill key={r} tone={/refrigerated|full|van/i.test(r) ? 'crit' : ''}>
              {r} {c}
            </Pill>
          ))}
        </div>
        <span className="small muted">
          {all.length} deferrals: {forced} forced by capacity, {all.length - forced} chosen
        </span>
      </div>
      <div className="tbl">
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Outlet</th>
              <th scope="col">Reason</th>
              <th scope="col">Last served</th>
              <th scope="col">Skipped yesterday</th>
              <th scope="col">Impact</th>
              <th scope="col">Next run</th>
              <th scope="col">Store notice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const imp = impact(d.order, d.repeatSkip);
              return (
                <tr key={d.id} className={d.repeatSkip ? 'hl' : ''}>
                  <td>
                    <b>{d.order.orderNo}</b>
                    <div className="tiny muted">{d.order.temp}</div>
                  </td>
                  <td>
                    {d.outlet.name}
                    <div className="tiny muted">
                      {d.outlet.id}, {d.order.depot}
                    </div>
                  </td>
                  <td>
                    {d.reasonLabel}
                    <div className="tiny muted" style={{ maxWidth: 320 }}>
                      {d.detail}
                    </div>
                  </td>
                  <td>{d.lastServedDaysAgo <= 1 ? 'Previous run' : `${d.lastServedDaysAgo} days ago`}</td>
                  <td>{d.repeatSkip ? <Pill tone="crit">Yes</Pill> : 'No'}</td>
                  <td>
                    <Pill tone={imp === 'High' ? 'crit' : imp === 'Medium' ? 'warn' : ''}>{imp}</Pill>
                  </td>
                  <td>{day(d.deferredTo)}</td>
                  <td>{d.status === 'approved' ? <Pill tone="good">Sent</Pill> : 'Ready'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        {published ? (
          <Banner tone="good" title={`Plan v${p.plan.version} published at ${clock(p.plan.publishedAt)}`}>
            {stores} stores notified of deferrals; every other store has its arrival window. Both docks have the loading lists and drivers receive trips at release.
          </Banner>
        ) : confirm ? (
          <div className="banner mari confirm" style={{ flex: 1 }} role="alertdialog" aria-label="Confirm approval">
            <div className="grow">
              <b className="t">Send {stores} store notices and publish the plan?</b>
              Each deferred store receives its reason and new date; every other store gets its arrival window; both docks receive the plan. Notices cannot be recalled.
            </div>
            <button className="btn sm" onClick={() => publish.mutate()} disabled={publish.isPending}>
              Confirm and notify
            </button>
            <button className="btn sm sec" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="small muted">Approving sends each store its reason and new date, and updates both docks.</span>
            <button className="btn sm" onClick={() => setConfirm(true)}>
              Approve plan and notify {stores} stores
            </button>
          </>
        )}
      </div>
      {placing && (
        <PlaceOrderDrawer
          orderId={placing}
          plan={p}
          onClose={() => setPlacing(null)}
          onApplied={(m) => {
            toast(m);
            setPlacing(null);
            void qc.invalidateQueries();
          }}
        />
      )}
    </DeskShell>
  );
}
