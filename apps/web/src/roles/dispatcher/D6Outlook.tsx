import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DeskShell } from '../../components/shells';
import { Banner, Pill, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

interface Week {
  isoYear: number;
  isoWeek: number;
  start: string;
  label: string;
  festivals: string[];
  paydays: number;
  ramp: number;
  depots: { depot: string; totalM3: number; chilledM3: number; reefersNeeded: number; reefersAvailable: number; reefersFleet: number; vehiclesNeeded: number; vehiclesAvailable: number; breaks: boolean; atRisk: boolean }[];
}

interface Outlook {
  provider: string;
  illustrative: boolean;
  weeks: Week[];
}

const DAY = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * D6. Deliberately one screen, not an analytics suite: weekly chilled demand per depot against
 * refrigerated capacity, naming the weeks that break it so hiring or workshop decisions happen
 * weeks ahead. The forecast comes from a pluggable provider; the Datathon model slots in later.
 */
export function D6Outlook() {
  const [depot, setDepot] = useState('Peliyagoda');
  const q = useQuery({ queryKey: ['outlook'], queryFn: () => api<Outlook>('/dispatch/outlook') });
  const weeks = q.data?.weeks ?? [];
  const rows = weeks.map((w) => ({ w, d: w.depots.find((x) => x.depot === depot)! }));
  const breaking = rows.filter((r) => r.d.breaks);
  const atRisk = rows.filter((r) => !r.d.breaks && r.d.atRisk);
  const fleet = rows[0]?.d.reefersFleet ?? 0;
  const avail = rows[0]?.d.reefersAvailable ?? 0;

  return (
    <DeskShell
      title="Capacity outlook"
      ctx={`Next ten weeks, ${depot}. ${q.data?.provider ?? ''}: illustrative until the Datathon demand model is plugged in.`}
      right={
        <div className="tabs" role="group" aria-label="Depot">
          {['Peliyagoda', 'Kandy'].map((d) => (
            <button key={d} aria-pressed={depot === d} onClick={() => setDepot(d)}>
              {d}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading && <Spinner />}
      {rows.length > 0 && (
        <div className="grid2" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
          <div className="card">
            <div className="row">
              <h3>Refrigerated vehicles needed vs available</h3>
              <Pill tone="mari">Illustrative forecast</Pill>
            </div>
            <Chart rows={rows} />
            <div className="tiny muted">
              Bars: reefers needed for the forecast chilled volume at this depot’s historical throughput per reefer. Solid line: the depot’s reefer fleet. Dashed: reefers available today (workshop excluded).
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {breaking.slice(0, 2).map(({ w, d }) => (
              <Banner key={w.label} tone="crit" title={`${w.label}${w.festivals.length ? ` (${w.festivals.join(', ')})` : ''} breaks reefer capacity`}>
                {d.chilledM3} m³ of chilled demand needs about {d.reefersNeeded} reefers; the depot has {d.reefersFleet} even with every vehicle back. Hire about {Math.ceil(d.reefersNeeded - d.reefersFleet)} reefer{Math.ceil(d.reefersNeeded - d.reefersFleet) === 1 ? '' : 's'} for the week.
              </Banner>
            ))}
            {atRisk.length > 0 && avail < fleet && (
              <Banner tone="warn" title={`${atRisk.length} more week${atRisk.length === 1 ? '' : 's'} at risk while ${fleet - avail} reefer${fleet - avail === 1 ? ' is' : 's are'} in the workshop`}>
                {atRisk.map((r) => r.w.label).join(', ')} fit the full fleet of {fleet} reefers but not today’s {avail}. Get workshop vehicles back before {atRisk[0]!.w.label}.
              </Banner>
            )}
            {breaking.length === 0 && atRisk.length === 0 && (
              <Banner tone="good" title="No week breaks reefer capacity">
                The forecast fits the current fleet at {depot}.
              </Banner>
            )}
            <div className="card">
              <h3>Week by week</h3>
              <div className="list">
                {rows.map(({ w, d }) => (
                  <div className="li" key={w.label}>
                    <div className="grow">
                      <div className="nm">
                        {w.label}, {DAY(w.start)}
                      </div>
                      <div className="mt">
                        {d.totalM3} m³ total, {d.chilledM3} m³ chilled{w.festivals.length ? `. ${w.festivals.join(', ')}` : ''}
                        {w.paydays ? '. Payday' : ''}
                      </div>
                    </div>
                    {d.breaks ? <Pill tone="crit">Short</Pill> : d.atRisk ? <Pill tone="warn">At risk</Pill> : <Pill tone="good">Fits</Pill>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </DeskShell>
  );
}

function Chart({ rows }: { rows: { w: Week; d: Week['depots'][number] }[] }) {
  const W = 700, H = 240, x0 = 40, top = 30;
  const max = Math.max(...rows.map((r) => Math.max(r.d.reefersNeeded, r.d.reefersFleet)), 1) * 1.2;
  const y = (v: number) => top + H - (v / max) * H;
  const bw = (W - x0 - 20) / rows.length - 12;
  const cap = rows[0]!.d.reefersFleet;
  const avail = rows[0]!.d.reefersAvailable;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 70}`} role="img" aria-label="Reefers needed per week against reefers available">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x0 - 6} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#E8EDEA" />
          <text x={x0 - 10} y={y(t) + 4} fontSize="11" fill="#5F706B" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {rows.map(({ w, d }, i) => {
        const X = x0 + i * (bw + 12) + 6;
        const over = d.reefersNeeded > cap;
        return (
          <g key={w.label}>
            <rect x={X} y={y(Math.min(d.reefersNeeded, cap))} width={bw} height={y(0) - y(Math.min(d.reefersNeeded, cap))} rx="4" fill="#1F6F5C" />
            {over && <rect x={X} y={y(d.reefersNeeded)} width={bw} height={y(cap) - y(d.reefersNeeded)} rx="4" fill="#B0302A" />}
            <text x={X + bw / 2} y={y(d.reefersNeeded) - 6} fontSize="11.5" fontWeight="700" fill="#16302B" textAnchor="middle">
              {d.reefersNeeded}
            </text>
            <text x={X + bw / 2} y={y(0) + 16} fontSize="11" fill="#4E625C" textAnchor="middle">
              {w.label}
            </text>
            {w.festivals.length > 0 && (
              <text x={X + bw / 2} y={y(0) + 32} fontSize="10.5" fontWeight="700" fill="#B0302A" textAnchor="middle">
                {w.festivals[0]!.replace('_', ' ')}
              </text>
            )}
            {w.festivals.length === 0 && w.ramp >= 0.5 && (
              <text x={X + bw / 2} y={y(0) + 32} fontSize="10.5" fill="#A4500F" textAnchor="middle">
                festival week
              </text>
            )}
          </g>
        );
      })}
      <line x1={x0 - 6} x2={W - 10} y1={y(cap)} y2={y(cap)} stroke="#16302B" strokeWidth="2" />
      <text x={W - 12} y={y(cap) - 7} fontSize="11.5" fontWeight="700" fill="#16302B" textAnchor="end">
        Fleet: {cap} reefers
      </text>
      {avail < cap && (
        <>
          <line x1={x0 - 6} x2={W - 10} y1={y(avail)} y2={y(avail)} stroke="#A4500F" strokeWidth="2" strokeDasharray="6 5" />
          <text x={W - 12} y={y(avail) - 7} fontSize="11.5" fontWeight="700" fill="#A4500F" textAnchor="end">
            Available today: {avail}
          </text>
        </>
      )}
    </svg>
  );
}
