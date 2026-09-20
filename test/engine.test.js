import test from 'node:test';
import assert from 'node:assert/strict';
import { WriteBehavior } from '../src/adapters/fake-quickbooks.js';
import { buildJournal } from '../src/domain/journal.js';
import { normalizeSource } from '../src/domain/normalize.js';
import { DayStatus } from '../src/domain/state-machine.js';
import { fixture, setup } from './helpers.js';

test('T-IDEMPOTENCY: posting the same day twice creates one external journal', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  assert.equal(engine.post(day.id).status, DayStatus.POSTED);
  assert.equal(engine.post(day.id).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-PROPERTY-IDEMPOTENCY: repeated commands across generated dates remain one-write', () => {
  const { source, engine, quickBooks, store } = setup();
  for (let dayNumber = 1; dayNumber <= 28; dayNumber += 1) {
    const businessDate = `2026-08-${String(dayNumber).padStart(2, '0')}`;
    const day = engine.ingest({ ...source, businessDate, sourceVersion: `v-${dayNumber}` });
    for (let repeat = 0; repeat < 10; repeat += 1) engine.post(day.id);
  }
  assert.equal(quickBooks.writeCount, 28);
  store.close();
});

test('T-TIMEOUT-AFTER-COMMIT: timeout recovery finds committed journal before retry', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const result = engine.post(day.id, { behavior: WriteBehavior.TIMEOUT_AFTER_COMMIT });
  assert.equal(result.status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-TIMEOUT-BEFORE-COMMIT: missing stable reference returns to safe review', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  assert.equal(engine.post(day.id, { behavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT }).status, DayStatus.READY_FOR_REVIEW);
  assert.equal(quickBooks.writeCount, 0);
  assert.equal(engine.post(day.id).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-POSSIBLE-DUPLICATE: equivalent unreferenced journal blocks until dismissed', () => {
  const { source, mapping, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const equivalent = structuredClone(buildJournal(normalizeSource(source), mapping));
  equivalent.docNumber = 'UNREFERENCED-IMPORT';
  quickBooks.seedJournal(equivalent);
  assert.equal(engine.post(day.id).status, DayStatus.POSSIBLE_DUPLICATE);
  engine.dismissDuplicate(day.id);
  assert.equal(engine.post(day.id).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 2);
  store.close();
});

test('T-POSSIBLE-DUPLICATE: an unrelated journal cannot be adopted', () => {
  const { source, mapping, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const equivalent = structuredClone(buildJournal(normalizeSource(source), mapping));
  equivalent.docNumber = 'MANUAL-EQUIVALENT';
  const candidate = quickBooks.seedJournal(equivalent);
  engine.post(day.id);
  const unrelated = structuredClone(equivalent);
  unrelated.docNumber = 'MANUAL-UNRELATED';
  unrelated.lines[0].amountCents += 1;
  const wrong = quickBooks.seedJournal(unrelated);
  assert.throws(() => engine.adoptDuplicate(day.id, wrong.id), { code: 'DUPLICATE_MISMATCH' });
  assert.equal(engine.adoptDuplicate(day.id, candidate.id).status, DayStatus.ALREADY_POSTED);
  store.close();
});

test('T-PAUSE-CANCEL: a location pause blocks posting without deleting its preview', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  store.setLocationSyncPaused(source.locationId, true);
  assert.throws(() => engine.post(day.id), { code: 'SYNC_PAUSED' });
  assert.equal(store.getDay(day.id).status, DayStatus.READY_FOR_REVIEW);
  assert.equal(quickBooks.writeCount, 0);
  store.close();
});

test('T-CORRECTION: changed posted data produces one reversal and replacement', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  const changed = engine.ingest(fixture('us-day-changed.json'));
  assert.equal(changed.status, DayStatus.CORRECTION_REQUIRED);
  const corrected = engine.correct(day.id);
  assert.equal(corrected.status, DayStatus.CORRECTED);
  assert(corrected.reversalQbId);
  assert(corrected.replacementQbId);
  assert.equal(quickBooks.writeCount, 3);
  assert.equal(corrected.source.sourceVersion, 'toast-close-2');
  store.close();
});

test('T-CORRECTION-RESUME: replacement failure resumes without a second reversal', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  engine.ingest(fixture('us-day-changed.json'));
  const partial = engine.correct(day.id, { replacementBehavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT });
  assert.equal(partial.status, DayStatus.CORRECTION_PARTIAL);
  assert(partial.reversalQbId);
  assert.equal(quickBooks.writeCount, 2);
  const completed = engine.correct(day.id);
  assert.equal(completed.status, DayStatus.CORRECTED);
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-CORRECTION: later source revisions use new correction references', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  assert.equal(engine.correct(day.id).correctionVersion, 1);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  engine.ingest(revisionThree);
  const correctedAgain = engine.correct(day.id);
  assert.equal(correctedAgain.correctionVersion, 2);
  assert.equal(correctedAgain.journal.docNumber.endsWith('04'), true);
  assert.equal(correctedAgain.journal.kind, 'REPLACEMENT');
  assert.equal(quickBooks.writeCount, 5);
  store.close();
});

test('T-REVISION-QUEUE: a newer pending revision replaces the prior one without a state error', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  const pending = engine.ingest(revisionThree);
  assert.equal(pending.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(pending.pendingSource.sourceVersion, 'toast-close-3');
  const corrected = engine.correct(day.id);
  assert.equal(corrected.status, DayStatus.CORRECTED);
  assert.equal(corrected.source.sourceVersion, 'toast-close-3');
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-REVISION-QUEUE: an in-flight correction finishes its snapshot before the queued revision', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  const partial = engine.correct(day.id, { replacementBehavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT });
  assert.equal(partial.status, DayStatus.CORRECTION_PARTIAL);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  const queued = engine.ingest(revisionThree);
  assert.equal(queued.status, DayStatus.CORRECTION_PARTIAL);
  assert.equal(queued.pendingSource.sourceVersion, 'toast-close-2');
  assert.equal(queued.queuedSource.sourceVersion, 'toast-close-3');
  const next = engine.correct(day.id);
  assert.equal(next.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(next.source.sourceVersion, 'toast-close-2');
  assert.equal(next.pendingSource.sourceVersion, 'toast-close-3');
  const completed = engine.correct(day.id);
  assert.equal(completed.status, DayStatus.CORRECTED);
  assert.equal(completed.source.sourceVersion, 'toast-close-3');
  assert.equal(completed.journal.kind, 'REPLACEMENT');
  assert.equal(quickBooks.writeCount, 5);
  store.close();
});

test('T-ENTITLEMENT-PERSISTENCE: a denied write persists its state and resumes after payment', () => {
  const { source, engine, quickBooks, store } = setup({ paid: false });
  const day = engine.ingest(source);
  const blocked = engine.post(day.id);
  assert.equal(blocked.status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(blocked.blockedFromStatus, DayStatus.READY_FOR_REVIEW);
  assert.equal(blocked.errorCode, 'ENTITLEMENT_BLOCKED');
  assert.equal(store.getDay(day.id).status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(quickBooks.writeCount, 0);
  store.putEntitlement(source.workspaceId, { status: 'PAID', syncPaused: false });
  assert.equal(engine.post(day.id).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-ENTITLEMENT-PERSISTENCE: a revision cannot erase a blocked uncertain write', () => {
  const { source, engine, quickBooks, store } = setup({ paid: false });
  const day = engine.ingest(source);
  store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, { errorCode: 'OUTCOME_UNKNOWN' });
  const blocked = store.transition(day.id, DayStatus.ENTITLEMENT_BLOCKED, {
    blockedFromStatus: DayStatus.OUTCOME_UNKNOWN, errorCode: 'ENTITLEMENT_BLOCKED',
  });
  assert.equal(blocked.status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(blocked.blockedFromStatus, DayStatus.OUTCOME_UNKNOWN);
  const revised = engine.ingest(fixture('us-day-changed.json'));
  assert.equal(revised.status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(revised.queuedSource.sourceVersion, 'toast-close-2');
  assert.equal(revised.source.sourceVersion, 'toast-close-1');
  store.putEntitlement(source.workspaceId, { status: 'PAID', syncPaused: false });
  const posted = engine.post(day.id);
  assert.equal(posted.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(posted.pendingSource.sourceVersion, 'toast-close-2');
  assert.equal(engine.correct(day.id).status, DayStatus.CORRECTED);
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-EXTERNAL-EDIT: edited original blocks automatic correction', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const posted = engine.post(day.id);
  quickBooks.mutateJournal(posted.qbJournalId, (journal) => ({ ...journal, privateNote: 'edited outside app' }));
  engine.ingest(fixture('us-day-changed.json'));
  assert.equal(engine.correct(day.id).status, DayStatus.EXTERNAL_CHANGE);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-EXTERNAL-DELETE: deleted original blocks automatic correction', () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const posted = engine.post(day.id);
  quickBooks.deleteJournal(posted.qbJournalId);
  engine.ingest(fixture('us-day-changed.json'));
  const blocked = engine.correct(day.id);
  assert.equal(blocked.status, DayStatus.EXTERNAL_CHANGE);
  assert.equal(blocked.error.deleted, true);
  store.close();
});

test('T-MAPPING-VERSION: approved mapping revisions never rewrite the original preview', () => {
  const { source, mapping, engine, store } = setup();
  const day = engine.ingest(source);
  const original = day.journal;
  store.saveMapping(source.locationId, { ...mapping, version: 2, entries: { ...mapping.entries, cash: { ...mapping.entries.cash, accountName: 'Cash on Hand v2' } } });
  assert.deepEqual(store.getDay(day.id).journal, original);
  assert.equal(store.getDay(day.id).mappingVersion, 1);
  store.close();
});

test('T-QB-CONTRACT and T-TOAST-CONTRACT: production adapters remain explicitly external-gated', () => {
  const manifest = JSON.parse(String(requireFixture('../contracts/gate-manifest.json')));
  assert.equal(manifest.external_gates.find((gate) => gate.id === 'EXT-TOAST-ACCESS').status, 'BLOCKED_EXTERNAL');
  assert.equal(manifest.external_gates.find((gate) => gate.id === 'EXT-QB-US-SANDBOX').status, 'BLOCKED_EXTERNAL');
});

function requireFixture(relativePath) {
  return requireFixture.readFile(relativePath);
}

requireFixture.readFile = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return globalThis.process.getBuiltinModule('fs').readFileSync(url);
};
