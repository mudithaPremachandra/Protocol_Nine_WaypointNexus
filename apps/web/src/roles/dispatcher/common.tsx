import type { Check } from '@wn/domain';
import { Pill } from '../../components/ui';
import { DOCK, hhmm, window as win } from '../../lib/format';
import type { Order, OutletLite } from '../../lib/types';

export function DepotTabs({ value, onChange, counts }: { value: string; onChange: (d: string) => void; counts?: Record<string, number> }) {
  return (
    <div className="tabs" role="group" aria-label="Depot">
      {['Kandy', 'Peliyagoda'].map((d) => (
        <button key={d} aria-pressed={value === d} onClick={() => onChange(d)}>
          {d}
          {counts?.[d] != null ? ` (${counts[d]})` : ''}
        </button>
      ))}
    </div>
  );
}

/** The constraint badges that used to live in the dispatcher's head (D1). */
export function OrderFlags({ order, outlet }: { order: Order; outlet: OutletLite }) {
  return (
    <span className="pills">
      {order.deferredYesterday && <Pill tone="crit">Deferred yesterday</Pill>}
      {order.daysSinceLastServed >= 2 && order.brand === 'Fresh' && <Pill tone="warn">{order.daysSinceLastServed} days since served</Pill>}
      {outlet.parkingConstraint === 'van_only' && <Pill tone="mari">Van only</Pill>}
      {outlet.mallWindowOpen != null && <Pill tone="mari">Mall window</Pill>}
      {order.brand === 'Tech' && <Pill tone="warn">Fragile</Pill>}
      {order.afterCutoff && <Pill>After cutoff</Pill>}
    </span>
  );
}

export function windowText(o: OutletLite) {
  return o.mallWindowOpen != null ? `Mall ${win(o.mallWindowOpen, o.mallWindowClose)}` : win(o.windowOpen, o.windowClose);
}

export const dockLabel = (d: string) => DOCK[d] ?? d;

export function checkOf(checks: Check[] | undefined, rule: Check['rule']) {
  return checks?.find((c) => c.rule === rule);
}

export const impact = (o: Order, repeat: boolean) =>
  repeat || (o.brand === 'Fresh' && o.temp === 'chilled') ? 'High' : o.brand === 'Fresh' || o.brand === 'Tech' ? 'Medium' : 'Low';

export function vehicleType(v: { type: string; temp: string }) {
  return `${v.temp === 'reefer' ? 'Reefer' : 'Dry-box'} ${v.type}`;
}

export { hhmm };
