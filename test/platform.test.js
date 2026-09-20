import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EntitlementStatus, evaluateEntitlement, pauseSync, startTrial } from '../src/billing/entitlements.js';
import { quoteActiveLocations } from '../src/billing/subscription.js';
import { exportDaysCsv, exportDaysJson } from '../src/domain/export.js';
import { authorize, assertOwnerRemovalAllowed } from '../src/domain/roles.js';
import { validateCatalogs, translate } from '../src/i18n/index.js';
import { deleteWorkspace } from '../src/security/deletion.js';
import { SqliteStore } from '../src/persistence/sqlite-store.js';
import { FakeQuickBooks } from '../src/adapters/fake-quickbooks.js';
import { SyncEngine } from '../src/domain/engine.js';
import { makeIdempotencyKey } from '../src/domain/reference.js';
import { sourceIdentity } from '../src/domain/normalize.js';
import { DayStatus } from '../src/domain/state-machine.js';
import { buildJournal } from '../src/domain/journal.js';
import { fixture, setup } from './helpers.js';

test('T-TRIAL: no-card trial lasts exactly 14 days and does not auto-convert', () => {
  const trial = startTrial({ status: EntitlementStatus.NOT_STARTED, syncPaused: false }, '2026-09-01T00:00:00.000Z');
  assert.equal(evaluateEntitlement(trial, '2026-09-14T23:59:59.999Z').canPost, true);
  const ended = evaluateEntitlement(trial, '2026-09-15T00:00:00.000Z');
  assert.equal(ended.canPost, false);
  assert.equal(ended.effectiveStatus, EntitlementStatus.EXPIRED);
  assert.equal(trial.status, EntitlementStatus.TRIAL);
});

test('T-PAUSE-CANCEL: pause blocks sync while location pricing follows locked renewal rules', () => {
  const paid = { status: EntitlementStatus.PAID, syncPaused: false };
  assert.equal(evaluateEntitlement(pauseSync(paid), '2026-09-20T00:00:00.000Z').reason, 'SYNC_PAUSED');
  const quote = quoteActiveLocations({ currency: 'USD', activeLocations: 2, addedLocations: 1 });
  assert.equal(quote.unitPriceCents, 2900);
  assert.equal(quote.renewalTotalCents, 8700);
  assert.equal(quote.removedLocationsEffectiveAtRenewal, true);
});

test('T-PAYMENT-GRACE: failed payment allows seven days then blocks new writes', () => {
  const grace = { status: EntitlementStatus.PAYMENT_GRACE, paymentFailedAt: '2026-09-01T00:00:00.000Z', syncPaused: false };
  assert.equal(evaluateEntitlement(grace, '2026-09-07T23:59:59.999Z').canPost, true);
  assert.equal(evaluateEntitlement(grace, '2026-09-08T00:00:00.000Z').canPost, false);
});

test('T-LOCALE-COVERAGE: all four catalogs have key and placeholder parity', () => {
  assert.deepEqual(validateCatalogs(), []);
  assert.match(translate('fr-CA', 'summary.posted', { date: '2026-09-18' }), /2026-09-18/);
  assert.match(translate('es-US', 'error.UNMAPPED_CATEGORY', { category: 'tips' }), /tips/);
});

test('T-LOCALE-IMMUTABILITY: changing display locale cannot mutate accounting data', () => {
  const { source, engine, store } = setup();
  const day = engine.ingest(source);
  const before = JSON.stringify(day);
  translate('en-US', 'summary.posted', { date: source.businessDate });
  translate('fr-CA', 'summary.posted', { date: source.businessDate });
  translate('es-US', 'summary.posted', { date: source.businessDate });
  assert.equal(JSON.stringify(store.getDay(day.id)), before);
  store.close();
});

test('T-PERSISTENCE-RESTART: durable posting state prevents a duplicate after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rsq-test-'));
  const database = join(directory, 'state.sqlite');
  const source = fixture('us-day.json');
  const mapping = fixture('us-mapping.json');
  const quickBooks = new FakeQuickBooks();
  let store = new SqliteStore(database);
  store.createWorkspace({ id: source.workspaceId, realmId: source.realmId, country: source.country, currency: source.currency });
  store.createLocation({ id: source.locationId, workspaceId: source.workspaceId, toastLocationId: 'toast-restart', timezone: source.timezone });
  store.saveMapping(source.locationId, mapping);
  store.putEntitlement(source.workspaceId, { status: 'PAID', syncPaused: false });
  let engine = new SyncEngine({ store, quickBooks });
  const id = engine.ingest(source).id;
  engine.post(id);
  store.close();
  store = new SqliteStore(database);
  engine = new SyncEngine({ store, quickBooks });
  assert.equal(engine.post(id).status, 'POSTED');
  assert.equal(quickBooks.writeCount, 1);
  store.close();
  rmSync(directory, { recursive: true });
});

test('T-INTERRUPTED-WRITE: startup reconciles a committed POSTING row without another write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rsq-interrupted-'));
  const database = join(directory, 'state.sqlite');
  const source = fixture('us-day.json');
  const mapping = fixture('us-mapping.json');
  const quickBooks = new FakeQuickBooks();
  let store = new SqliteStore(database);
  store.createWorkspace({ id: source.workspaceId, realmId: source.realmId, country: source.country, currency: source.currency });
  store.createLocation({ id: source.locationId, workspaceId: source.workspaceId, toastLocationId: 'toast-interrupted', timezone: source.timezone });
  store.saveMapping(source.locationId, mapping);
  store.putEntitlement(source.workspaceId, { status: 'PAID', syncPaused: false });
  const engine = new SyncEngine({ store, quickBooks, recoverOnStart: false });
  const day = engine.ingest(source);
  const idempotencyKey = makeIdempotencyKey({
    ...sourceIdentity(day.source), kind: 'ORIGINAL', sourceFingerprint: day.sourceFingerprint, mappingVersion: day.journal.mappingVersion,
  });
  store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: day.journal.docNumber, kind: 'ORIGINAL' });
  store.transition(day.id, DayStatus.POSTING);
  quickBooks.createJournal(day.journal, { idempotencyKey });
  store.close();

  store = new SqliteStore(database);
  new SyncEngine({ store, quickBooks });
  const recovered = store.getDay(day.id);
  assert.equal(recovered.status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  assert.equal(store.listAttempts(day.id).at(-1).outcome, 'RECOVERED');
  store.close();
  rmSync(directory, { recursive: true });
});

test('T-INTERRUPTED-WRITE: startup safely releases a POSTING row when no journal exists', () => {
  const { source, store, quickBooks, engine } = setup();
  const day = engine.ingest(source);
  const idempotencyKey = makeIdempotencyKey({
    ...sourceIdentity(day.source), kind: 'ORIGINAL', sourceFingerprint: day.sourceFingerprint, mappingVersion: day.journal.mappingVersion,
  });
  store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: day.journal.docNumber, kind: 'ORIGINAL' });
  store.transition(day.id, DayStatus.POSTING);
  const restarted = new SyncEngine({ store, quickBooks });
  assert.equal(store.getDay(day.id).status, DayStatus.READY_FOR_REVIEW);
  assert.equal(store.listAttempts(day.id).at(-1).outcome, 'NOT_FOUND');
  assert.equal(restarted.post(day.id).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-INTERRUPTED-CORRECTION: startup preserves and resumes a correction write', () => {
  const { source, mapping, store, quickBooks, engine } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  engine.ingest(fixture('us-day-changed.json'));
  const correcting = store.transition(day.id, DayStatus.CORRECTING, { correctionVersion: 1 });
  const reversal = buildJournal(correcting.source, mapping, { sequence: 1, reverse: true, kind: 'REVERSAL' });
  const idempotencyKey = makeIdempotencyKey({ ...sourceIdentity(correcting.source), kind: 'REVERSAL', docNumber: reversal.docNumber });
  store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: reversal.docNumber, kind: 'REVERSAL' });
  quickBooks.createJournal(reversal, { idempotencyKey });

  const restarted = new SyncEngine({ store, quickBooks });
  assert.equal(store.getDay(day.id).status, DayStatus.CORRECTION_PARTIAL);
  const completed = restarted.correct(day.id);
  assert.equal(completed.status, DayStatus.CORRECTED);
  assert.equal(completed.journal.kind, 'REPLACEMENT');
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-DELETION: external credentials revoke before primary data purge', () => {
  const { source, store } = setup();
  const calls = [];
  const originalPurge = store.purgeWorkspace.bind(store);
  store.purgeWorkspace = (id) => { calls.push('purge'); return originalPurge(id); };
  const result = deleteWorkspace({ workspaceId: source.workspaceId, store, credentialVault: { revokeWorkspace() { calls.push('revoke'); } } });
  assert.deepEqual(calls, ['revoke', 'purge']);
  assert.equal(result.primaryDataPurged, true);
  assert.equal(store.getWorkspace(source.workspaceId), null);
  store.close();
});

test('T-EXPORT: register is locale-neutral and formula-safe', () => {
  const days = [{ workspaceId: '=cmd', realmId: 'realm', locationId: 'loc', businessDate: '2026-09-18', status: 'POSTED', source: { currency: 'USD' }, journal: { totals: { debitCents: 100, creditCents: 100 } }, qbJournalId: 'qb1', errorCode: null }];
  const csv = exportDaysCsv(days);
  assert.match(csv, /'=cmd/);
  assert.doesNotMatch(csv, /\$1\.00/);
  assert.equal(csv.trim().split('\n').length, 2);
  assert.match(exportDaysJson(days), /"schemaVersion":1/);
});

test('T-ROLES: member privileges are narrow and last owner cannot leave', () => {
  assert.doesNotThrow(() => authorize('MEMBER', 'post'));
  assert.doesNotThrow(() => authorize('MEMBER', 'manage_mapping'));
  assert.throws(() => authorize('MEMBER', 'manage_billing'), { code: 'FORBIDDEN' });
  assert.throws(() => assertOwnerRemovalAllowed({ ownerCount: 1, removingRole: 'OWNER' }), { code: 'LAST_OWNER' });
});
