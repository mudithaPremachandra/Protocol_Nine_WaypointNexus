import type { Minutes, TimeWindow } from './types';

/** "05:30" -> 330. Throws on malformed input so bad seed data fails loudly. */
export function parseHHMM(value: string): Minutes {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid HH:MM time: "${value}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 330 -> "05:30". Wraps past midnight. */
export function formatHHMM(minutes: Minutes): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "07:00-10:00" -> { open: 420, close: 600 }; blank -> null. */
export function parseWindow(value: string | null | undefined): TimeWindow | null {
  if (!value || !value.trim()) return null;
  const [open, close] = value.split('-');
  if (!open || !close) throw new Error(`Invalid window: "${value}"`);
  return { open: parseHHMM(open), close: parseHHMM(close) };
}

export function formatWindow(w: TimeWindow): string {
  return `${formatHHMM(w.open)}–${formatHHMM(w.close)}`;
}

/** Intersection of two windows, or null if they don't overlap. */
export function intersectWindows(a: TimeWindow, b: TimeWindow | null): TimeWindow | null {
  if (!b) return a;
  const open = Math.max(a.open, b.open);
  const close = Math.min(a.close, b.close);
  return open <= close ? { open, close } : null;
}
