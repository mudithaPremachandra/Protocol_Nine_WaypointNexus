import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgres://waypoint:waypoint@localhost:5432/waypoint'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  /** Delivery date the seeded demo day runs on. */
  DEMO_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-04-29'),
  DATA_DIR: z.string().default('../../data'),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST: z.string().default('../web/dist'),
  /** Seed on start if the database is empty. */
  SEED_ON_START: z.coerce.boolean().default(true),
  /** Allow the dispatcher's "Reset demo day" action. */
  DEMO_CONTROLS: z.coerce.boolean().default(true),
});

export const config = Env.parse(process.env);
export type Config = typeof config;
