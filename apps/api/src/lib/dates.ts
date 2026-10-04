import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as s from '../db/schema';

/** Pure calendar arithmetic on YYYY-MM-DD strings (UTC-safe, no local-time drift). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Next date deliveries run, per calendar.csv (Waypoint operates Monday to Saturday, minus holidays). */
export async function nextOperatingDate(db: DB, date: string): Promise<string> {
  const [row] = await db
    .select({ date: s.calendarDays.date })
    .from(s.calendarDays)
    .where(and(gt(s.calendarDays.date, date), eq(s.calendarDays.isOperating, true)))
    .orderBy(asc(s.calendarDays.date))
    .limit(1);
  return row?.date ?? addDays(date, 1);
}

export async function previousOperatingDate(db: DB, date: string): Promise<string> {
  const [row] = await db
    .select({ date: s.calendarDays.date })
    .from(s.calendarDays)
    .where(and(lt(s.calendarDays.date, date), eq(s.calendarDays.isOperating, true)))
    .orderBy(desc(s.calendarDays.date))
    .limit(1);
  return row?.date ?? addDays(date, -1);
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 29 Apr", the design's date convention. */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}
