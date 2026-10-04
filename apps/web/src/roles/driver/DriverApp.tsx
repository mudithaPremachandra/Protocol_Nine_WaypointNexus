import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DZ1PlanChanged } from './DZ1PlanChanged';
import { Dr1Today } from './Dr1Today';
import { Dr2NextStop } from './Dr2NextStop';
import { Dr3Record } from './Dr3Record';
import { Dr4Sync } from './Dr4Sync';
import { useTripLocation } from '../../offline/location';
import { useDriver } from './useDriver';
import { X1Report } from './X1Report';

/**
 * Driver routes. When a newer plan version changes this driver's stops, every screen except the
 * sync queue and problem report is gated behind DZ1/X4 until the driver accepts it.
 */
export function DriverApp() {
  const d = useDriver();
  const loc = useLocation();
  // Share the phone's position while a trip is under way (any driver screen).
  const location = useTripLocation(d.trips.some((t) => t.status === 'in_progress'), d.data?.vehicle?.id);
  const exempt = /\/driver\/(sync|report)/.test(loc.pathname);
  if (d.changed && !exempt) return <DZ1PlanChanged d={d} />;
  return (
    <Routes>
      <Route index element={<Dr1Today d={d} location={location} />} />
      <Route path="stop" element={<Dr2NextStop d={d} />} />
      <Route path="stop/:orderId/record" element={<Dr3Record d={d} />} />
      <Route path="sync" element={<Dr4Sync />} />
      <Route path="report" element={<X1Report d={d} />} />
      <Route path="*" element={<Navigate to="/driver" replace />} />
    </Routes>
  );
}

export type DriverCtx = ReturnType<typeof useDriver>;
export type DriverLocation = ReturnType<typeof useTripLocation>;
