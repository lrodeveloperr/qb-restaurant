#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateCatalogs } from '../src/i18n/index.js';

const root = new URL('..', import.meta.url).pathname;
const requirements = JSON.parse(readFileSync(join(root, 'contracts', 'requirements.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'contracts', 'gate-manifest.json'), 'utf8'));
const findings = [];

function unique(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) findings.push(`${label} duplicate id: ${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

const requirementIds = unique(requirements.requirements, 'requirement');
const testIds = unique(manifest.tests, 'test');
const externalIds = unique(manifest.external_gates, 'external gate');
for (const requirement of requirements.requirements) {
  for (const field of ['id', 'scope', 'status', 'owner', 'normative_text', 'evidence', 'risk', 'acceptance_test_ids', 'dependencies']) {
    if (!(field in requirement)) findings.push(`${requirement.id ?? 'unknown'} missing ${field}`);
  }
  if (!requirement.acceptance_test_ids?.length) findings.push(`${requirement.id} has no acceptance test`);
  for (const testId of requirement.acceptance_test_ids ?? []) if (!testIds.has(testId)) findings.push(`${requirement.id} references missing test ${testId}`);
  for (const dependency of requirement.dependencies ?? []) {
    if (!requirementIds.has(dependency) && !externalIds.has(dependency)) findings.push(`${requirement.id} references missing dependency ${dependency}`);
  }
}
for (const record of manifest.tests) {
  for (const requirementId of record.requirement_ids ?? []) if (!requirementIds.has(requirementId)) findings.push(`${record.id} references missing requirement ${requirementId}`);
}
for (const localeFinding of validateCatalogs()) findings.push(`locale: ${JSON.stringify(localeFinding)}`);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
for (const file of files(root).filter((path) => path.endsWith('.js'))) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) findings.push(`syntax ${relative(root, file)}: ${checked.stderr.trim()}`);
}

const output = {
  ok: findings.length === 0,
  requirementCount: requirements.requirements.length,
  testRecordCount: manifest.tests.length,
  externalGateCount: manifest.external_gates.length,
  localeCoveragePercent: validateCatalogs().length === 0 ? 100 : 0,
  findings,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
