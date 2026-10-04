import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as s from '../db/schema';

export interface AppState {
  serviceDate: string;
  cutoffClosed: boolean;
}

export async function getState(db: DB): Promise<AppState> {
  const rows = await db.select().from(s.appState);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    serviceDate: String(map.get('serviceDate') ?? ''),
    cutoffClosed: Boolean(map.get('cutoffClosed')),
  };
}

export async function setState<K extends keyof AppState>(db: DB, key: K, value: AppState[K]) {
  await db
    .insert(s.appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.appState.key, set: { value } });
}

export async function currentPlan(db: DB, date: string) {
  const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, date));
  return plan ?? null;
}
