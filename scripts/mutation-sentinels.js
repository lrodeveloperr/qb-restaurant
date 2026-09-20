#!/usr/bin/env node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const mutations = [
  { name: 'balance-comparison', file: 'src/domain/journal.js', from: 'debitCents === creditCents', to: 'debitCents !== creditCents' },
  { name: 'unmapped-guard', file: 'src/domain/journal.js', from: 'unmapped.length === 0', to: 'unmapped.length < 0' },
  { name: 'negative-money', file: 'src/domain/normalize.js', from: 'amount >= 0', to: 'amount > 0' },
  { name: 'country-currency', file: 'src/domain/normalize.js', from: "['US/USD', 'CA/CAD']", to: "['US/CAD', 'CA/USD']" },
  { name: 'transition-guard', file: 'src/domain/state-machine.js', from: '!isDayStatus(to) || !transitions.get(from)?.has(to)', to: 'false' },
  { name: 'timeout-recovery', file: 'src/domain/engine.js', from: 'if (found && found.journal.privateNote === day.journal.privateNote', to: 'if (false && found && found.journal.privateNote === day.journal.privateNote' },
  { name: 'external-change', file: 'src/domain/engine.js', from: 'stableStringify(liveOriginal.journal) !== stableStringify(day.qbSnapshot?.journal)', to: 'stableStringify(liveOriginal.journal) === stableStringify(day.qbSnapshot?.journal)' },
  { name: 'trial-boundary', file: 'src/billing/entitlements.js', from: 'now < ends', to: 'now <= ends' },
  { name: 'grace-boundary', file: 'src/billing/entitlements.js', from: 'now < graceEnds', to: 'now <= graceEnds' },
  { name: 'formula-escape', file: 'src/domain/export.js', from: '/^[=+\\-@\\t\\r]/', to: '/^[~]/' },
];

const outcomes = [];
for (const mutation of mutations) {
  const directory = mkdtempSync(join(tmpdir(), 'rsq-mutant-'));
  cpSync(root, directory, { recursive: true, filter: (source) => !source.includes(`${join(root, 'reports')}`) });
  const path = join(directory, mutation.file);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(mutation.from)) {
    outcomes.push({ name: mutation.name, detected: false, reason: 'sentinel target missing' });
    rmSync(directory, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, source.replace(mutation.from, mutation.to));
  const test = spawnSync(process.execPath, ['--test', '--test-concurrency=1'], { cwd: directory, encoding: 'utf8' });
  outcomes.push({ name: mutation.name, detected: test.status !== 0 });
  rmSync(directory, { recursive: true, force: true });
}

const detected = outcomes.filter((outcome) => outcome.detected).length;
const detectionPercent = Math.round((detected / outcomes.length) * 100);
const result = { ok: detectionPercent >= 80, total: outcomes.length, detected, detectionPercent, thresholdPercent: 80, outcomes };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
