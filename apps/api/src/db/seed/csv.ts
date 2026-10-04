import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { config } from '../../config';

export type Row = Record<string, string>;

const SUBDIRS = ['General Data', 'Training Data', 'Test Data', ''];

/** Reads a booklet CSV from DATA_DIR, looking in the folder layout the organisers ship. */
export function readCsv(file: string): Row[] {
  const root = resolve(config.DATA_DIR);
  for (const sub of SUBDIRS) {
    const p = join(root, sub, file);
    if (existsSync(p)) return parse(readFileSync(p), { columns: true, skip_empty_lines: true, trim: true }) as Row[];
  }
  throw new Error(`Dataset ${file} not found under ${root}. Put the booklet's data folders there (see README).`);
}

export const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v));
export const bool = (v: string | undefined) => v === '1' || v === 'true';
