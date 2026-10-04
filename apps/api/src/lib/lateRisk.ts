import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as s from '../db/schema';

/**
 * Late-risk estimate for a planned stop (design D3/D5): the probability that the stop arrives after
 * its window closes. Waypoint's own history gives the delay distribution: route_legs_train.csv records
 * planned and actual arrival for every leg, summarised per district and stop position (delay_stats).
 * Risk = P(delay > slack) under a normal approximation, nudged by the day's road disruption
 * (road_conditions.csv). Deliberately simple and explainable; the Datathon Task 1 model can replace
 * it behind this same function.
 */
export interface LateRiskInputs {
  delay: (district: string, seq: number) => { mean: number; sd: number };
  disruption: (district: string) => number;
}

export async function loadLateRiskInputs(db: DB, date: string): Promise<LateRiskInputs> {
  const stats = await db.select().from(s.delayStats);
  const byKey = new Map(stats.map((r) => [`${r.district}|${r.seq}`, r]));
  const roads = await db.select().from(s.roadConditions).where(eq(s.roadConditions.date, date));
  // No row for the date means clear roads.
  const disruption = new Map(roads.map((r) => [r.district, r.disruptionIndex]));
  return {
    delay: (district, seq) => {
      const r = byKey.get(`${district}|${Math.min(5, seq)}`);
      return r ? { mean: r.meanMin, sd: r.sdMin } : { mean: 15, sd: 20 };
    },
    disruption: (district) => disruption.get(district) ?? 100,
  };
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function lateRisk(
  inputs: LateRiskInputs,
  district: string,
  outboundMin: number,
  plannedArrival: number,
  windowClose: number | null,
  seq = 0,
): number {
  if (windowClose == null) return 0.5;
  const { mean, sd } = inputs.delay(district, seq);
  // A disrupted day stretches the outbound leg on top of the usual delay.
  const extra = outboundMin * (100 / Math.max(20, inputs.disruption(district)) - 1);
  const slack = windowClose - plannedArrival;
  const p = 1 - phi((slack - mean - extra) / sd);
  return Math.round(Math.min(0.97, Math.max(0.02, p)) * 100) / 100;
}
