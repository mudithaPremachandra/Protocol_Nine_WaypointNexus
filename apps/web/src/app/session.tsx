import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import type { Role } from '@wn/domain';
import { api, ApiError, post } from '../lib/api';
import { db, wipeLocal } from '../offline/db';

export interface Me {
  id: string;
  username: string;
  name: string;
  role: Role;
  outletId: string | null;
  outletName: string | null;
  outletBrand: string | null;
  vehicleId: string | null;
  depot: string | null;
}

interface Session {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
const ME_KEY = 'wn.me';

/** The signed-in user. Cached locally so a driver who opens the app with no signal still gets in. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const m = await api<Me>('/auth/me');
        localStorage.setItem(ME_KEY, JSON.stringify(m));
        return m;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          const cached = localStorage.getItem(ME_KEY);
          if (cached) return JSON.parse(cached) as Me;
        }
        if (e instanceof ApiError && e.status === 401) {
          localStorage.removeItem(ME_KEY);
          return null;
        }
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const login = async (username: string, password: string) => {
    const prev = localStorage.getItem(ME_KEY);
    await post('/auth/login', { username, password });
    const m = await api<Me>('/auth/me');
    // A different person on a shared device must not inherit someone else's queue or snapshots.
    if (prev && (JSON.parse(prev) as Me).id !== m.id) {
      const queued = await db.outbox.where('status').equals('queued').count();
      if (queued === 0) await wipeLocal();
    }
    localStorage.setItem(ME_KEY, JSON.stringify(m));
    // Drop everything cached for the previous user, but keep the session query itself so its
    // observers see the new user immediately.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], m);
    return m;
  };

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    localStorage.removeItem(ME_KEY);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], null);
  };

  return <Ctx.Provider value={{ me: me.data ?? null, loading: me.isLoading, login, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

export const HOME: Record<Role, string> = {
  dispatcher: '/dispatch',
  loader: '/loader',
  driver: '/driver',
  store_manager: '/store',
};
