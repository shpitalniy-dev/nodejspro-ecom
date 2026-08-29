import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';

import { envSchema } from '../src/config/env.schema.ts';

const schemaKeys = Object.keys(envSchema.shape).sort();
const fileKeys = Object.keys(
  parse(readFileSync(new URL('../.env.example', import.meta.url))),
).sort();

const missing = schemaKeys.filter(k => !fileKeys.includes(k));
const extra = fileKeys.filter(k => !schemaKeys.includes(k));

if (missing.length || extra.length) {
  if (missing.length)
    console.error(`✗ Missed in .env.example: ${missing.join(', ')}`);
  if (extra.length)
    console.error(
      `✗ Extra in .env.example (missing in schema): ${extra.join(', ')}`,
    );

  process.exit(1);
}

console.log(`✓ .env.example is synced with (${schemaKeys.length} env vars)`);
