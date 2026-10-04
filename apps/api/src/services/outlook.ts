import { asc, gte } from 'drizzle-orm';
import { db } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';

/**
 * Capacity outlook (D6). The design keeps this to one screen: weekly demand per depot against
 * refrigerated and total fleet capacity, naming the weeks that break it.
 *
 * Forecasts come from a ForecastProvider. The default is a transparent seasonal baseline (same ISO
 * week last year x recent year-on-year trend, nudged for festival weeks); the Datathon Task 2A model
 * can replace it without touching the screen.
 */
export interface WeekForecast {
  depot: string;
  brand: string;
  isoYear: number;
  isoWeek: number;
  totalM3: number;
  chilledM3: number;
}

export interface ForecastProvider {
  name: string;
  forecast(weeks: { isoYear: number; isoWeek: number }[]): Promise<WeekForecast[]>;
}

type History = typeof s.demandHistory.$inferSelect;

export const seasonalBaseline: ForecastProvider = {
  name: 'Seasonal baseline (same week last year × trend)',
  async forecast(weeks) {
    const history = await db.select().from(s.demandHistory);
    const key = (h: Pick<History, 'depot' | 'brand' | 'isoYear' | 'isoWeek'>) => `${h.depot}|${h.brand}|${h.isoYear}|${h.isoWeek}`;
    const byKey = new Map(history.map((h) => [key(h), h]));
    const series = new Map<string, History[]>();
    for (const h of history) series.set(`${h.depot}|${h.brand}`, [...(series.get(`${h.depot}|${h.brand}`) ?? []), h]);

    const out: WeekForecast[] = [];
    for (const [k, rows] of series) {
      const [depot, brand] = k.split('|') as [string, string];
      rows.sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek);
      // Year-on-year trend over the last 8 weeks of history.
      const recent = rows.slice(-8);
      let now = 0;
      let then = 0;
      for (const r of recent) {
        const prior = byKey.get(key({ depot, brand, isoYear: r.isoYear - 1, isoWeek: r.isoWeek }));
        if (prior) {
          now += r.totalM3;
          then += prior.totalM3;
        }
      }
      const trend = then > 0 ? Math.min(1.3, Math.max(0.8, now / then)) : 1;
      const avg = rows.slice(-12).reduce((sum, r) => sum + r.totalM3, 0) / Math.max(1, rows.slice(-12).length);
      const avgChilled = rows.slice(-12).reduce((sum, r) => sum + r.chilledM3, 0) / Math.max(1, rows.slice(-12).length);
      for (const w of weeks) {
        const ly = byKey.get(key({ depot, brand, isoYear: w.isoYear - 1, isoWeek: w.isoWeek }));
        out.push({
          depot,
          brand,
          isoYear: w.isoYear,
          isoWeek: w.isoWeek,
          totalM3: round((ly?.totalM3 ?? avg) * trend),
          chilledM3: brand === 'Fresh' ? round((ly?.chilledM3 ?? avgChilled) * trend) : 0,
        });
      }
    }
    return out;
  },
};

const round = (n: number) => Math.round(n * 10) / 10;

export async function capacityOutlook(provider: ForecastProvider = seasonalBaseline) {
  const { serviceDate } = await getState(db);
  const days = await db.select().from(s.calendarDays).where(gte(s.calendarDays.date, serviceDate)).orderBy(asc(s.calendarDays.date));
  const weeks: { isoYear: number; isoWeek: number; start: string; festivals: string[]; paydays: number; ramp: number; operatingDays: number }[] = [];
  for (const d of days) {
    let w = weeks.find((x) => x.isoYear === d.isoYear && x.isoWeek === d.isoWeek);
    if (!w) {
      if (weeks.length === 10) break;
      w = { isoYear: d.isoYear, isoWeek: d.isoWeek, start: d.date, festivals: [], paydays: 0, ramp: 0, operatingDays: 0 };
      weeks.push(w);
    }
    if (d.festival) w.festivals.push(d.festival);
    if (d.isPayday) w.paydays++;
    if (d.isOperating) w.operatingDays++;
    w.ramp = Math.max(w.ramp, d.festivalRamp);
  }

  const forecasts = await provider.forecast(weeks);
  const vehicles = await db.select().from(s.vehicles);
  const history = await db.select().from(s.demandHistory);

  const depots = ['Peliyagoda', 'Kandy'];
  // Historical throughput per vehicle: the average week's volume over the whole fleet that carried it.
  const throughput = new Map<string, { reefer: number; all: number }>();
  for (const depot of depots) {
    const h = history.filter((r) => r.depot === depot);
    const weeksSeen = new Set(h.map((r) => `${r.isoYear}|${r.isoWeek}`)).size || 1;
    const chilled = h.reduce((sum, r) => sum + r.chilledM3, 0) / weeksSeen;
    const total = h.reduce((sum, r) => sum + r.totalM3, 0) / weeksSeen;
    const reefers = vehicles.filter((v) => v.depot === depot && v.temp === 'reefer').length || 1;
    const all = vehicles.filter((v) => v.depot === depot).length || 1;
    throughput.set(depot, { reefer: chilled / reefers, all: total / all });
  }

  const rows = weeks.map((w) => ({
    ...w,
    label: `W${w.isoWeek}`,
    depots: depots.map((depot) => {
      const f = forecasts.filter((x) => x.depot === depot && x.isoYear === w.isoYear && x.isoWeek === w.isoWeek);
      // Festival weeks lift demand beyond the same week last year when the festival has moved.
      const uplift = 1 + w.ramp * 0.12;
      const totalM3 = round(f.reduce((sum, x) => sum + x.totalM3, 0) * uplift);
      const chilledM3 = round(f.reduce((sum, x) => sum + x.chilledM3, 0) * uplift);
      const tp = throughput.get(depot)!;
      const reefersAvailable = vehicles.filter((v) => v.depot === depot && v.temp === 'reefer' && v.status === 'available').length;
      const reefersFleet = vehicles.filter((v) => v.depot === depot && v.temp === 'reefer').length;
      const vehiclesAvailable = vehicles.filter((v) => v.depot === depot && v.status === 'available').length;
      const reefersNeeded = Math.round((chilledM3 / tp.reefer) * 10) / 10;
      const vehiclesNeeded = Math.round((totalM3 / tp.all) * 10) / 10;
      return {
        depot,
        totalM3,
        chilledM3,
        reefersNeeded,
        reefersAvailable,
        reefersFleet,
        vehiclesNeeded,
        vehiclesAvailable,
        /** Short even with every reefer back from the workshop. */
        breaks: reefersNeeded > reefersFleet,
        /** Short only while workshop vehicles stay out. */
        atRisk: reefersNeeded > reefersAvailable,
      };
    }),
  }));

  return { provider: provider.name, illustrative: true, serviceDate, weeks: rows };
}

