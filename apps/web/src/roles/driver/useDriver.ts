import { useEffect, useMemo } from 'react';
import { useSession } from '../../app/session';
import type { DriverSnapshot } from '../../lib/types';
import { db } from '../../offline/db';
import { overlay, stopSignature, useFieldSnapshot } from '../../offline/field';

const VEHICLE_KEY = 'wn.driverVehicle';

export function demoVehicle(): string | null {
  try {
    return localStorage.getItem(VEHICLE_KEY);
  } catch {
    return null;
  }
}
export function setDemoVehicle(v: string | null) {
  try {
    if (v) localStorage.setItem(VEHICLE_KEY, v);
    else localStorage.removeItem(VEHICLE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The driver's day as cached on the phone. Also tracks which plan version the driver has accepted:
 * if a newer version changes their stops, the app shows what changed, who changed it and why, and
 * asks them to accept it (DZ1), so two versions of the truth never quietly coexist.
 */
export function useDriver() {
  const { me } = useSession();
  const vehicle = demoVehicle() ?? me?.vehicleId ?? '';
  const key = `driver:${vehicle}`;
  const f = useFieldSnapshot<DriverSnapshot>(key, `/driver/today?vehicle=${encodeURIComponent(vehicle)}`);
  const data = f.snapshot?.data;
  const trips = useMemo(() => (data ? overlay(data.trips, f.outbox ?? [], f.snapshot!.savedAt) : []), [data, f.outbox, f.snapshot]);

  const serverStops = useMemo(() => (data ? stopSignature(data.trips) : []), [data]);
  const accepted = f.snapshot?.acceptedStops;
  const acceptedVersion = f.snapshot?.acceptedVersion ?? 0;
  const changed =
    !!data?.published &&
    data.planVersion > acceptedVersion &&
    !!accepted &&
    JSON.stringify(accepted.map((s) => `${s.tripNo}:${s.orderId}`)) !== JSON.stringify(serverStops.map((s) => `${s.tripNo}:${s.orderId}`));

  // First sight of a plan, or a new version that doesn't touch this driver's stops: accept silently.
  useEffect(() => {
    if (!data?.published || !f.snapshot) return;
    if (!accepted || (data.planVersion > acceptedVersion && !changed)) {
      void db.snapshots.update(key, { acceptedVersion: data.planVersion, acceptedStops: serverStops });
    }
  }, [data?.published, data?.planVersion, accepted, acceptedVersion, changed, key, serverStops, f.snapshot]);

  const accept = async () => {
    if (data) await db.snapshots.update(key, { acceptedVersion: data.planVersion, acceptedStops: serverStops });
  };

  return { ...f, data, trips, vehicle, changed, accepted: accepted ?? [], serverStops, accept, acceptedVersion };
}
