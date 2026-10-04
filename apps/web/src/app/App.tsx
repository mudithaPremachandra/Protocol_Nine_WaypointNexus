import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@wn/domain';
import { Spinner } from '../components/ui';
import { D1Queue } from '../roles/dispatcher/D1Queue';
import { D2PlanBoard } from '../roles/dispatcher/D2PlanBoard';
import { D4Deferrals } from '../roles/dispatcher/D4Deferrals';
import { D5Live } from '../roles/dispatcher/D5Live';
import { D6Outlook } from '../roles/dispatcher/D6Outlook';
import { X2Incident } from '../roles/dispatcher/X2Incident';
import { DriverApp } from '../roles/driver/DriverApp';
import { L1DockQueue } from '../roles/loader/L1DockQueue';
import { L2LoadSheet } from '../roles/loader/L2LoadSheet';
import { L3Flag } from '../roles/loader/L3Flag';
import { L4Release } from '../roles/loader/L4Release';
import { SM1Order } from '../roles/store/SM1Order';
import { SM2Deliveries } from '../roles/store/SM2Deliveries';
import { SM3Receipt } from '../roles/store/SM3Receipt';
import { useLiveEvents } from './live';
import { Login } from './Login';
import { HOME, useSession } from './session';

function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  useLiveEvents(!!me);
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.role !== role) return <Navigate to={HOME[me.role]} replace />;
  return <>{children}</>;
}

export function App() {
  const { me, loading } = useSession();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={loading ? <Spinner /> : <Navigate to={me ? HOME[me.role] : '/login'} replace />} />

      <Route path="/store" element={<Guard role="store_manager"><SM2Deliveries /></Guard>} />
      <Route path="/store/order" element={<Guard role="store_manager"><SM1Order /></Guard>} />
      <Route path="/store/receipt/:orderId" element={<Guard role="store_manager"><SM3Receipt /></Guard>} />

      <Route path="/dispatch" element={<Guard role="dispatcher"><D1Queue /></Guard>} />
      <Route path="/dispatch/plan" element={<Guard role="dispatcher"><D2PlanBoard /></Guard>} />
      <Route path="/dispatch/deferrals" element={<Guard role="dispatcher"><D4Deferrals /></Guard>} />
      <Route path="/dispatch/live" element={<Guard role="dispatcher"><D5Live /></Guard>} />
      <Route path="/dispatch/outlook" element={<Guard role="dispatcher"><D6Outlook /></Guard>} />
      <Route path="/dispatch/incident/:id" element={<Guard role="dispatcher"><X2Incident /></Guard>} />

      <Route path="/loader" element={<Guard role="loader"><L1DockQueue /></Guard>} />
      <Route path="/loader/trip/:tripId" element={<Guard role="loader"><L2LoadSheet /></Guard>} />
      <Route path="/loader/trip/:tripId/flag/:orderId" element={<Guard role="loader"><L3Flag /></Guard>} />
      <Route path="/loader/trip/:tripId/release" element={<Guard role="loader"><L4Release /></Guard>} />

      <Route path="/driver/*" element={<Guard role="driver"><DriverApp /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
