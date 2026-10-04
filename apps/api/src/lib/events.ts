import { EventEmitter } from 'node:events';
import type { Role } from '@wn/domain';
import type { DB } from '../db/client';
import * as s from '../db/schema';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  outletId: string | null;
  vehicleId: string | null;
  depot: string | null;
}

/** Who should hear about an event. Dispatchers hear everything. */
export interface EventScope {
  all?: boolean;
  depots?: string[];
  outletIds?: string[];
  vehicleIds?: string[];
  roles?: Role[];
}

export type EventRow = typeof s.events.$inferSelect;
type Tx = Pick<DB, 'insert'>;

export interface NewEvent {
  type: string;
  actor?: AuthUser | null;
  date?: string | null;
  planVersion?: number | null;
  scope: EventScope;
  payload: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Write the event inside the caller's transaction; call publish() after commit. */
export async function recordEvent(tx: Tx, e: NewEvent): Promise<EventRow> {
  const [row] = await tx
    .insert(s.events)
    .values({
      type: e.type,
      actorId: e.actor?.id ?? null,
      actorName: e.actor?.name ?? null,
      actorRole: e.actor?.role ?? null,
      date: e.date ?? null,
      planVersion: e.planVersion ?? null,
      scope: e.scope,
      payload: e.payload,
    })
    .returning();
  return row!;
}

export function publish(...rows: EventRow[]) {
  for (const row of rows) bus.emit('event', row);
}

export async function emit(db: Tx, e: NewEvent): Promise<EventRow> {
  const row = await recordEvent(db, e);
  publish(row);
  return row;
}

export function onEvent(listener: (row: EventRow) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}

export function visibleTo(user: AuthUser, scope: EventScope): boolean {
  if (user.role === 'dispatcher' || scope.all) return true;
  if (scope.roles?.includes(user.role)) return true;
  switch (user.role) {
    case 'loader':
      return !!user.depot && !!scope.depots?.includes(user.depot);
    case 'driver':
      return !!user.vehicleId && !!scope.vehicleIds?.includes(user.vehicleId);
    case 'store_manager':
      return !!user.outletId && !!scope.outletIds?.includes(user.outletId);
    default:
      return false;
  }
}
