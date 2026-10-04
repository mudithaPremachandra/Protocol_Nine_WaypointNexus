import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config';
import { db, sql } from '../client';
import * as s from '../schema';
import { seedDemoDay } from './demoDay';
import { seedReference } from './reference';

const here = dirname(fileURLToPath(import.meta.url));

/** Migrations ship next to the bundle in production (dist/../drizzle) and in the package in dev. */
function migrationsFolder(): string {
  for (const p of [resolve(here, '../drizzle'), resolve(here, '../../../drizzle'), resolve(process.cwd(), 'drizzle')]) {
    if (existsSync(resolve(p, 'meta/_journal.json'))) return p;
  }
  throw new Error('Drizzle migrations folder not found');
}

export async function migrateAndSeed(opts: { force?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? ((m: string) => console.log(`[seed] ${m}`));
  await migrate(db, { migrationsFolder: migrationsFolder() });
  const [existing] = await db.select({ id: s.outlets.id }).from(s.outlets).limit(1);
  if (existing && !opts.force) {
    log('database already seeded; skipping');
    return;
  }
  if (existing && opts.force) {
    log('force: wiping reference and demo data');
    await sql.unsafe(`TRUNCATE districts, outlets, vehicles, calendar_days, service_allowances, traffic_speed, road_conditions, delay_stats, demand_history, products, users RESTART IDENTITY`);
  }
  const t0 = Date.now();
  await seedReference(db, log);
  await seedDemoDay(db, config.DEMO_DATE, log);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Run directly: `npm run seed` (or `node dist/seed.js --force`).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  migrateAndSeed({ force: process.argv.includes('--force') })
    .then(() => sql.end())
    .catch(async (err) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
