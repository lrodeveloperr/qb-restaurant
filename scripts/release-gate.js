#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const checks = [
  ['contract-and-syntax', ['run', 'check']],
  ['tests', ['test']],
  ['mutation-sentinels', ['run', 'mutation']],
  ['csv-fuzz', ['run', 'fuzz']],
  ['performance', ['run', 'benchmark']],
  ['dependency-tree', ['ls', '--all', '--json']],
];
const results = [];
for (const [name, args] of checks) {
  const child = spawnSync('npm', args, { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  results.push({ name, passed: child.status === 0, exitCode: child.status, stdout: child.stdout.trim(), stderr: child.stderr.trim() });
}

const textFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['reports', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else textFiles.push(path);
  }
}
walk(root);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~-]{24,}/,
  /\b(?:client_secret|access_token)\s*[:=]\s*["'][^"']{12,}["']/i,
];
const secretFindings = [];
for (const path of textFiles) {
  const body = readFileSync(path, 'utf8');
  for (const pattern of secretPatterns) if (pattern.test(body)) secretFindings.push({ path: path.slice(root.length + 1), pattern: String(pattern) });
}
results.push({ name: 'secret-scan', passed: secretFindings.length === 0, findings: secretFindings });

const manifest = JSON.parse(readFileSync(join(root, 'contracts', 'gate-manifest.json'), 'utf8'));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidateStatus: 'PROVISIONAL',
  automatedChecksPassed: results.every((result) => result.passed),
  externalGatesPassed: manifest.external_gates.every((gate) => gate.status === 'PASSED'),
  results,
  externalGates: manifest.external_gates,
  verdict: results.every((result) => result.passed) && manifest.external_gates.every((gate) => gate.status === 'PASSED') ? 'READY' : 'PROVISIONAL',
};
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports', 'release-gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ automatedChecksPassed: report.automatedChecksPassed, externalGatesPassed: report.externalGatesPassed, verdict: report.verdict, report: 'reports/release-gate-report.json' }, null, 2));
if (!report.automatedChecksPassed) process.exitCode = 1;
