import { formatHHMM } from '@wn/domain';

export const hhmm = (m: number | null | undefined) => (m == null ? '—' : formatHHMM(m));
export const window = (open: number | null | undefined, close: number | null | undefined) =>
  open == null || close == null ? '—' : `${formatHHMM(open)}–${formatHHMM(close)}`;
export const n = (v: number, digits = 0) =>
  v.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const m3 = (v: number) => `${n(v, 1)} m³`;
export const kg = (v: number) => `${n(v)} kg`;

/** Clock time in Sri Lanka for an instant. */
export function clock(at: string | Date | null | undefined): string {
  if (!at) return '—';
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
}

export function ago(at: string | Date | null | undefined, now = Date.now()): string {
  if (!at) return 'never';
  const mins = Math.round((now - new Date(at).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min ago`;
}

export const DOCK: Record<string, string> = { rear_dock: 'Rear dock', street: 'Street', mall_bay: 'Mall bay' };
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** "Thu 30 Apr", the design's date convention. */
export function day(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}
