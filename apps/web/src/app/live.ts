import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { wipeLocal } from '../offline/db';
import { useNetwork } from '../offline/network';

export interface LiveEvent {
  id: number;
  type: string;
  at: string;
  actorName: string | null;
  planVersion: number | null;
  payload: { message?: string } & Record<string, unknown>;
}

/**
 * Server-sent events: the server pushes a small "something changed" note scoped to this user;
 * screens refetch what they show. Simple, cache-friendly, and works through any HTTP proxy.
 */
export function useLiveEvents(enabled: boolean, onEvent?: (e: LiveEvent) => void) {
  const qc = useQueryClient();
  const { online } = useNetwork();
  const [last, setLast] = useState<LiveEvent | null>(null);

  useEffect(() => {
    if (!enabled || !online) return;
    const es = new EventSource('/api/events/stream', { withCredentials: true });
    es.addEventListener('change', (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as LiveEvent;
      if (e.type === 'demo.reset') void wipeLocal();
      setLast(e);
      onEvent?.(e);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, online, qc]);

  return last;
}
