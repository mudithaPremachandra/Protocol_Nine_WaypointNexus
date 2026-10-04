import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner } from '../components/ui';
import { HOME, useSession } from './session';

const DEMO = [
  { username: 'nimal', name: 'Nimal Perera', role: 'Dispatcher', where: 'Planning office, Peliyagoda. Large screen.' },
  { username: 'fathima', name: 'Fathima Rizwan', role: 'Store manager', where: 'Waypoint Fresh Peradeniya. Counter desktop or phone.' },
  { username: 'kasun', name: 'Kasun Bandara', role: 'Loader', where: 'Kandy dock. Shared tablet.' },
  { username: 'suresh', name: 'Suresh Kumar', role: 'Driver', where: 'Reefer truck, Kandy corridor. His own phone.' },
];

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (u: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await login(u, p);
      navigate(HOME[me.role], { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="login">
      <section>
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <span className="brand-mark" aria-hidden="true" />
          <b>Waypoint Nexus</b>
        </div>
        <h1>One order record, from the store to the dock to the road and back.</h1>
        <p className="muted">
          Delivery planning for Waypoint Group: three brands, two depots, 120 outlets, 60 vehicles. Sign in as one of the four people
          the system was designed around.
        </p>
        <form
          className="card"
          style={{ display: 'grid', gap: 12, marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void go(username, password);
          }}
        >
          <label className="field">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </label>
          <label className="field">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <Banner tone="crit" title="Couldn’t sign in">{error}</Banner>}
          <button className="btn" disabled={busy}>
            Sign in
          </button>
        </form>
      </section>
      <section>
        <h2 style={{ fontSize: 16, margin: '8px 0 10px' }}>Demo accounts (password waypoint123)</h2>
        <div className="roles">
          {DEMO.map((d) => (
            <button key={d.username} type="button" className="role" disabled={busy} onClick={() => void go(d.username, 'waypoint123')}>
              <span className="avatar" aria-hidden="true">
                {d.name.split(' ').map((p) => p[0]).join('')}
              </span>
              <span className="grow">
                <span className="nm" style={{ display: 'block' }}>
                  {d.name}, {d.role}
                </span>
                <span className="mt">{d.where}</span>
              </span>
              <span className="pill tea">{d.username}</span>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          Every driver and store also has an account: <code>driver.veh047</code>, <code>store.out012</code> and so on.
        </p>
      </section>
    </main>
  );
}
