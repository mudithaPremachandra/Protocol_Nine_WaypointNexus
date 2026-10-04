import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { n } from '../lib/format';

export type Tone = 'cold' | 'crit' | 'warn' | 'good' | 'tea' | 'mari' | '';

/** A status is never colour alone: every pill carries its word (design standards, WCAG 1.4.1). */
export function Pill({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/** Capacity bar: tea under 93 %, amber from 93 %, red when over (style guide). */
export function Bar({ label, used, cap, unit, digits = 0 }: { label: string; used: number; cap: number; unit: string; digits?: number }) {
  const pct = cap > 0 ? (used / cap) * 100 : 0;
  const tone = pct > 100 ? 'crit' : pct >= 93 ? 'warn' : '';
  return (
    <div className="bar">
      <div className="bt">
        <span>{label}</span>
        <b>
          {n(used, digits)} / {n(cap, digits)} {unit}
        </b>
      </div>
      <div className="track" role="meter" aria-label={label} aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={Math.round(cap)}>
        <div className={`fill ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

const ICON: Record<string, string> = { crit: '!', warn: '!', mari: '!', good: '✓', cold: '❄' };

export function Banner({ tone, title, children, icon, action }: { tone: 'crit' | 'warn' | 'mari' | 'good' | 'cold'; title?: ReactNode; children?: ReactNode; icon?: string; action?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'crit' ? 'alert' : undefined}>
      <span aria-hidden="true" className={`ico ${tone}`}>
        {icon ?? ICON[tone]}
      </span>
      <div className="grow">
        {title && <b className="t">{title}</b>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function CheckRow({ ok, label, detail, value }: { ok: boolean; label: ReactNode; detail?: ReactNode; value?: ReactNode }) {
  return (
    <div className="check">
      <span className={ok ? 'ok' : 'no'} aria-label={ok ? 'Pass' : 'Fail'}>
        {ok ? '✓' : '✕'}
      </span>
      <div>
        <b>{label}</b>
        {detail && <div className="small muted">{detail}</div>}
      </div>
      <span className="v" style={{ color: ok ? 'var(--ink)' : 'var(--crit)' }}>
        {value}
      </span>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 9999, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={`${label} quantity`}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`One fewer ${label}`}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`One more ${label}`}>
        +
      </button>
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner tone="crit" title="Something went wrong">{error instanceof Error ? error.message : String(error)}</Banner>;
}

/* ---------- toast (role=status so changes are announced without moving focus) ---------- */

const ToastCtx = createContext<(msg: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {msg && <div className="toast">{msg}</div>}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
