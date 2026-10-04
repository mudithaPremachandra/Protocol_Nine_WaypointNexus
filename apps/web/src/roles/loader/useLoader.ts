import { useMemo } from 'react';
import { useSession } from '../../app/session';
import type { LoaderQueue } from '../../lib/types';
import { overlay, useFieldSnapshot } from '../../offline/field';

/** The dock tablet's view of the plan, cached for when the depot wifi drops, with local actions applied. */
export function useLoader() {
  const { me } = useSession();
  const depot = me?.depot ?? 'Kandy';
  const f = useFieldSnapshot<LoaderQueue>(`loader:${depot}`, `/loader/queue?depot=${depot}`);
  const data = f.snapshot?.data;
  const trips = useMemo(() => (data ? overlay(data.trips, f.outbox ?? [], f.snapshot!.savedAt) : []), [data, f.outbox, f.snapshot]);
  return { ...f, data, trips, depot };
}
