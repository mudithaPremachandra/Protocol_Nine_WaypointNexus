import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

export const sql = postgres(config.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };
