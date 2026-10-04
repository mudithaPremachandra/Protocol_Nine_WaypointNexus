import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../app/session';
import { api, post } from '../lib/api';
import { db } from '../offline/db';
import { setSimulatedOffline, useNetwork } from '../offline/network';
import { useToast } from './ui';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
}

/**
 * Connection state lives in the status bar on every loader and driver screen (style guide).
 * Tapping it toggles "Simulate no signal", so the dead-zone flow can be demonstrated anywhere.
 */
export function NetBadge({ depot }: { depot?: boolean }) {
  const { online, simulated } = useNetwork();
  const queued = useLiveQuery(async () => (await db.outbox.where('status').equals('queued').count()) + (await db.photos.where('status').equals('queued').count()), [], 0);
  const label = !online ? (simulated ? 'No signal (simulated)' : 'No signal') : depot ? 'Depot wifi' : '4G';
  return (
    <button
      type="button"
      className={`net ${online ? '' : 'off'}`}
      onClick={() => setSimulatedOffline(online)}
      aria-label={`${label}${queued ? `, ${queued} waiting to sync` : ''}. Tap to ${online ? 'simulate losing' : 'restore'} signal.`}
      title={online ? 'Tap to simulate no signal' : 'Tap to restore signal'}
    >
      {label}
      {queued ? ` · ${queued} queued` : ''}
    </button>
  );
}

export function PhoneShell({
  title,
  sub,
  back,
  backLabel,
  children,
  foot,
  depotNet,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: string;
  backLabel?: string;
  children: ReactNode;
  foot?: ReactNode;
  depotNet?: boolean;
}) {
  const time = useClock();
  const { me, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className="phone-shell">
      <div className="sbar">
        <span>{time}</span>
        <span className="who">{me?.name}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {me?.role !== 'store_manager' && <NetBadge depot={depotNet} />}
          <button
            type="button"
            className="link"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </span>
      </div>
      <header className="ahead">
        {back && (
          <Link className="back" to={back}>
            ‹ {backLabel ?? 'Back'}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </header>
      <main id="main" className="abody" tabIndex={-1}>
        {children}
      </main>
      {foot && <div className="afoot">{foot}</div>}
    </div>
  );
}

interface DispatchState {
  serviceDate: string;
  serviceDay: string;
  cutoffClosed: boolean;
  planVersion: number;
  planStatus: string | null;
  demoControls: boolean;
}

export function useDispatchState() {
  return useQuery({ queryKey: ['state'], queryFn: () => api<DispatchState>('/state') });
}

export function DeskShell({
  title,
  ctx,
  right,
  children,
  counts,
}: {
  title: ReactNode;
  ctx?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  counts?: { queue?: number; deferrals?: number; incidents?: number };
}) {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const state = useDispatchState();
  const s = state.data;
  const incidents = useQuery({
    queryKey: ['incidents'],
    queryFn: () => api<{ id: string; status: string; vehicleId: string }[]>('/dispatch/incidents'),
  });
  const open = incidents.data?.filter((i) => i.status === 'open') ?? [];
  const nav = (to: string, label: string, cnt?: number, crit?: boolean) => (
    <NavLink to={to} end>
      {label}
      {cnt ? <span className={`cnt ${crit ? 'crit' : ''}`}>{cnt}</span> : null}
    </NavLink>
  );

  return (
    <div className="desk">
      <nav className="dnav" aria-label="Dispatcher">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" /> Waypoint Nexus
        </div>
        <div className="who">
          <b>{me?.name}</b>
          <span>Dispatcher, Peliyagoda office</span>
        </div>
        {open.map((i) => (
          <NavLink key={i.id} to={`/dispatch/incident/${i.id}`}>
            Incident {i.vehicleId}
            <span className="cnt crit">1</span>
          </NavLink>
        ))}
        {nav('/dispatch', 'Order queue', counts?.queue)}
        {nav('/dispatch/plan', 'Plan board')}
        {nav('/dispatch/deferrals', 'Deferrals', counts?.deferrals, s?.planStatus !== 'published')}
        {nav('/dispatch/live', 'Live operations')}
        {nav('/dispatch/outlook', 'Capacity outlook')}
        <div className="foot">
          <span className="meta">
            {s ? `Plan v${s.planVersion} ${s.planStatus === 'published' ? 'published' : s.planStatus ? 'draft' : 'not built'}` : ''}
            <br />
            {s ? `${s.serviceDay} deliveries` : ''}
          </span>
          {s?.demoControls &&
            (confirmReset ? (
              <button
                type="button"
                style={{ borderColor: 'var(--mari)', color: '#fff' }}
                onClick={async () => {
                  setConfirmReset(false);
                  await post('/admin/reset');
                  toast('Demo day reset for every user');
                  navigate('/dispatch');
                }}
              >
                Confirm: reset for everyone
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} title="Returns all orders, plans and records to the starting state">
                Reset demo day
              </button>
            ))}
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <div className="dmain">
        <header className="dhead">
          <div>
            <h1>{title}</h1>
            <div className="ctx">{ctx ?? (s ? `Deliveries for ${s.serviceDay}. ${s.cutoffClosed ? 'Orders closed at 16:00 the day before.' : 'Orders open until the 16:00 cutoff.'}` : '')}</div>
          </div>
          <div className="sp">{right}</div>
        </header>
        <main id="main" className="dbody" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
