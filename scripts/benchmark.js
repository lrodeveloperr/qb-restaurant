#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../src/domain/normalize.js';
import { buildJournal } from '../src/domain/journal.js';

const base = JSON.parse(readFileSync(new URL('../fixtures/us-day.json', import.meta.url), 'utf8'));
const mapping = JSON.parse(readFileSync(new URL('../fixtures/us-mapping.json', import.meta.url), 'utf8'));
let previews = 0;
let checksum = 0;
const start = performance.now();
for (let location = 0; location < 25; location += 1) {
  for (let day = 0; day < 730; day += 1) {
    const date = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
    const source = normalizeSource({
      ...base,
      locationId: `location-${location}`,
      businessDate: date,
      sourceVersion: `v-${day}`,
    });
    const journal = buildJournal(source, mapping);
    previews += 1;
    checksum = (checksum + journal.totals.debitCents) % 1_000_000_007;
    if (previews % 1000 === 0) globalThis.gc?.();
  }
}
const durationMs = performance.now() - start;
const rssMiB = process.memoryUsage().rss / 1024 / 1024;
const result = {
  ok: durationMs < 10_000 && rssMiB < 256 && previews === 18_250,
  locations: 25,
  days: 730,
  previews,
  checksum,
  durationMs: Math.round(durationMs * 100) / 100,
  rssMiB: Math.round(rssMiB * 100) / 100,
  budgets: { durationMs: 10_000, rssMiB: 256 },
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
