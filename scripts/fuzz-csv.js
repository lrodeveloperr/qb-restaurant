#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseCsvSource } from '../src/adapters/csv.js';

const valid = readFileSync(new URL('../fixtures/us-day.csv', import.meta.url), 'utf8');
const total = 100_000;
let acceptedExpected = 0;
let rejectedExpected = 0;
let failures = 0;
let seed = 20260920;

function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}

for (let index = 0; index < total; index += 1) {
  const mode = random() % 10;
  let candidate = valid;
  let shouldAccept = false;
  if (mode === 0) {
    shouldAccept = true;
    acceptedExpected += 1;
  } else {
    rejectedExpected += 1;
    if (mode === 1) candidate = candidate.replace('schema_version', 'schema');
    else if (mode === 2) candidate = candidate.replace(',20000\n', ',-1\n');
    else if (mode === 3) candidate = candidate.replace('America/New_York', 'Not/AZone');
    else if (mode === 4) candidate = candidate.replace(',USD,', ',CAD,');
    else if (mode === 5) candidate = candidate.replace('beverage_sales,20000', 'bad category,20000');
    else if (mode === 6) candidate = `${candidate}1,ws-us,realm-us,restaurant-us,location-us,2026-09-18,America/New_York,US,USD,toast-close-1,cash,1\n`;
    else if (mode === 7) candidate = candidate.replace('toast-close-1,card', 'toast-close-2,card');
    else if (mode === 8) candidate = candidate.replace('beverage_sales,20000', '"beverage_sales,20000');
    else candidate = candidate.replace(',20000\n', ',90071992547409999\n');
  }
  try {
    parseCsvSource(candidate);
    if (!shouldAccept) failures += 1;
  } catch {
    if (shouldAccept) failures += 1;
  }
}

const result = { ok: failures === 0, seed: 20260920, total, acceptedExpected, rejectedExpected, oracleFailures: failures };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
