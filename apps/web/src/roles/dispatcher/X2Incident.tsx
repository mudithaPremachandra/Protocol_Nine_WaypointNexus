import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { DeskShell } from '../../components/shells';
import { Banner, ErrorNote, Pill, Spinner, useToast } from '../../components/ui';
import { api, post } from '../../lib/api';
import { clock } from '../../lib/format';

interface Option {
  key: string;
  kind: 'rescue' | 'reload' | 'defer';
  vehicleId: string | null;
  label: string;
  onTime: number;
  late: number;
  lateMinutes: number;
  deferred: number;
  verdict: 'recommended' | 'allowed' | 'ruled_out';
  reason: string | null;
  depart: string | null;
  stops: { orderId: string; orderNo: string; outletName: string; arrive: string; window: string; lateMin: number }[];
}

interface IncidentView {
  incident: { id: string; type: string; vehicleId: string; deviceTime: string; receivedAt: string; note: string | null; status: string; chosenOption: string | null; approvedAt: string | null };
  reporter: { name: string; phone: string | null } | null;
  options: Option[];
  now: string | null;
  affected: { orderId: string; orderNo: string; outletName: string; window: string }[];
}

const LETTERS = 'ABCDE';

/**
 * X2, the hero degradation screen. Affected chilled stops are separated from the rest; recovery
 * options are already checked against capacity, time budgets and windows, each with stops saved,
 * minutes late and stops deferred. An option that breaks a rule is shown as ruled out with the
 * reason. The dispatcher sees the consequences before approving; the system never re-routes alone.
 */
export function X2Incident() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => api<IncidentView>(`/dispatch/incidents/${id}`), refetchInterval: 15_000 });
  const [confirm, setConfirm] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (option: string) => post<{ option: Option }>(`/dispatch/incidents/${id}/approve`, { option }),
    onSuccess: (r) => {
      setConfirm(null);
      toast(`Approved: ${r.option.label}`);
      void qc.invalidateQueries();
    },
  });

  const v = q.data;
  if (!v) return <DeskShell title="Incident">{q.isLoading ? <Spinner /> : <ErrorNote error={q.error} />}</DeskShell>;
  const inc = v.incident;
  const done = inc.status !== 'open';
  const [h, m] = (v.now ?? '05:30').split(':').map(Number);
  const leftMin = 8 * 60 - (h! * 60 + m!);

  return (
    <DeskShell
      title={`Incident: ${inc.vehicleId} ${inc.type === 'reefer_fault' ? 'refrigeration fault' : inc.type.replace('_', ' ')}`}
      ctx={`Reported ${clock(inc.deviceTime)}. Position in plan: ${v.now ?? '—'}. Fresh window closes at 08:00${leftMin > 0 ? `: ${Math.floor(leftMin / 60)} h ${leftMin % 60} min left` : ''}.`}
    >
      <ErrorNote error={approve.error} />
      <Banner tone="crit" title={`Reported by ${v.reporter?.name ?? 'the driver'} at ${clock(inc.deviceTime)}${v.reporter?.phone ? ` (${v.reporter.phone})` : ''}`}>
        {inc.note ? `“${inc.note}”. ` : ''}
        {v.affected.length} chilled stop{v.affected.length === 1 ? '' : 's'} still on board. Chilled goods cannot move to an ambient vehicle.
      </Banner>
      {done && (
        <Banner tone="good" title={`Recovery approved at ${clock(inc.approvedAt)}`}>
          The dock, the drivers involved and {v.affected.length} store{v.affected.length === 1 ? '' : 's'} have been notified. Plan version updated.
        </Banner>
      )}
      <div className="card">
        <div className="row">
          <h3>Stops at risk</h3>
          <span className="small muted">Ambient stops stay on {inc.vehicleId}.</span>
        </div>
        <div className="grid3" style={{ marginTop: 6 }}>
          {v.affected.map((a) => (
            <div key={a.orderId} className="row" style={{ background: 'var(--cold-tint)', borderRadius: 10, padding: '8px 12px' }}>
              <div>
                <div className="nm">{a.outletName}</div>
                <div className="mt">{a.orderNo}, chilled</div>
              </div>
              <span className="small">
                window <b>{a.window}</b>
              </span>
            </div>
          ))}
          {v.affected.length === 0 && <div className="small muted">No chilled stops left on that vehicle.</div>}
        </div>
      </div>
      <div className="grid3">
        {v.options.map((o, i) => {
          const letter = LETTERS[i];
          const chosen = inc.chosenOption === o.key;
          return (
            <div key={o.key} className={`opt ${o.verdict === 'recommended' ? 'rec' : ''} ${o.verdict === 'ruled_out' ? 'no' : ''}`}>
              <div className="row">
                <h3 style={{ margin: 0 }}>
                  {letter}. {o.label}
                </h3>
                {o.verdict === 'recommended' && <Pill tone="tea">Recommended</Pill>}
                {o.verdict === 'ruled_out' && <Pill tone="crit">Breaks a rule</Pill>}
              </div>
              <div className="small muted">
                {o.kind === 'rescue' && `Leaves at ${o.depart} to meet ${inc.vehicleId}; 15 min transfer, then runs the stops.`}
                {o.kind === 'reload' && `${inc.vehicleId} returns to the depot; goods reload onto ${o.vehicleId}, which leaves at ${o.depart}.`}
                {o.kind === 'defer' && `${inc.vehicleId} returns to the depot. The chilled orders move to the next run; stores notified now.`}
              </div>
              <div className="m">
                <div>
                  <b>{o.onTime}</b>on time
                </div>
                <div>
                  <b style={{ color: o.late ? 'var(--warn)' : undefined }}>{o.late}</b>late{o.late ? `, ${o.lateMinutes} min` : ''}
                </div>
                <div>
                  <b style={{ color: o.deferred ? 'var(--crit)' : undefined }}>{o.deferred}</b>deferred
                </div>
              </div>
              {o.stops.length > 0 && (
                <div className="small">
                  {o.stops.map((s) => `${s.outletName.replace(/^Waypoint \w+ /, '')} ${s.arrive}${s.lateMin ? ` (closes ${s.window.split('–')[1]})` : ''}`).join(', ')}.
                </div>
              )}
              {o.verdict === 'ruled_out' && (
                <div className="small">
                  <b>Ruled out:</b> {o.reason}
                </div>
              )}
              {o.verdict !== 'ruled_out' &&
                !done &&
                (confirm === o.key ? (
                  <div className="banner mari" role="alertdialog" aria-label={`Confirm option ${letter}`} style={{ flexDirection: 'column' }}>
                    <div>
                      <b className="t">Approve option {letter}?</b>The dock, the drivers involved and the affected stores are notified immediately.
                    </div>
                    <div className="confirm">
                      <button className="btn sm" onClick={() => approve.mutate(o.key)} disabled={approve.isPending}>
                        Confirm
                      </button>
                      <button className="btn sm sec" onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className={`btn ${o.verdict === 'recommended' ? '' : 'sec'}`} onClick={() => setConfirm(o.key)}>
                    {o.verdict === 'recommended' ? `Approve option ${letter}` : `Choose option ${letter}`}
                  </button>
                ))}
              {chosen && <Pill tone="good">Approved</Pill>}
            </div>
          );
        })}
      </div>
      <div className="small muted">Every option is checked with the same rules as the plan: refrigeration, capacity, the 270-minute Fresh budget, trips per day and delivery windows.</div>
    </DeskShell>
  );
}
