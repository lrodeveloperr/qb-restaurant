import test from 'node:test';
import assert from 'node:assert/strict';
import { WriteBehavior } from '../src/adapters/fake-quickbooks.js';
import { buildJournal } from '../src/domain/journal.js';
import { normalizeSource } from '../src/domain/normalize.js';
import { DayStatus } from '../src/domain/state-machine.js';
import { fixture, setup } from './helpers.js';

test('T-IDEMPOTENCY: posting the same day twice creates one external journal', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  assert.equal((await engine.post(day.id)).status, DayStatus.POSTED);
  assert.equal((await engine.post(day.id)).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-PROPERTY-IDEMPOTENCY: repeated commands across generated dates remain one-write', async () => {
  const { source, engine, quickBooks, store } = setup();
  for (let dayNumber = 1; dayNumber <= 28; dayNumber += 1) {
    const businessDate = `2026-08-${String(dayNumber).padStart(2, '0')}`;
    const day = engine.ingest({ ...source, businessDate, sourceVersion: `v-${dayNumber}` });
    for (let repeat = 0; repeat < 10; repeat += 1) await engine.post(day.id);
  }
  assert.equal(quickBooks.writeCount, 28);
  store.close();
});

test('T-TIMEOUT-AFTER-COMMIT: timeout recovery finds committed journal before retry', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const result = await engine.post(day.id, { behavior: WriteBehavior.TIMEOUT_AFTER_COMMIT });
  assert.equal(result.status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-TIMEOUT-BEFORE-COMMIT: missing stable reference returns to safe review', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  assert.equal((await engine.post(day.id, { behavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT })).status, DayStatus.READY_FOR_REVIEW);
  assert.equal(quickBooks.writeCount, 0);
  assert.equal((await engine.post(day.id)).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-POSSIBLE-DUPLICATE: equivalent unreferenced journal blocks until dismissed', async () => {
  const { source, mapping, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const equivalent = structuredClone(buildJournal(normalizeSource(source), mapping));
  equivalent.docNumber = 'UNREFERENCED-IMPORT';
  quickBooks.seedJournal(equivalent);
  assert.equal((await engine.post(day.id)).status, DayStatus.POSSIBLE_DUPLICATE);
  engine.dismissDuplicate(day.id);
  assert.equal((await engine.post(day.id)).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 2);
  store.close();
});

test('T-POSSIBLE-DUPLICATE: an unrelated journal cannot be adopted', async () => {
  const { source, mapping, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const equivalent = structuredClone(buildJournal(normalizeSource(source), mapping));
  equivalent.docNumber = 'MANUAL-EQUIVALENT';
  const candidate = quickBooks.seedJournal(equivalent);
  await engine.post(day.id);
  const unrelated = structuredClone(equivalent);
  unrelated.docNumber = 'MANUAL-UNRELATED';
  unrelated.lines[0].amountCents += 1;
  const wrong = quickBooks.seedJournal(unrelated);
  await assert.rejects(() => engine.adoptDuplicate(day.id, wrong.id), { code: 'DUPLICATE_MISMATCH' });
  assert.equal((await engine.adoptDuplicate(day.id, candidate.id)).status, DayStatus.ALREADY_POSTED);
  store.close();
});

test('T-PAUSE-CANCEL: a location pause blocks posting without deleting its preview', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  store.setLocationPostingPaused(source.locationId, true);
  await assert.rejects(() => engine.post(day.id), { code: 'POSTING_PAUSED' });
  assert.equal(store.getDay(day.id).status, DayStatus.READY_FOR_REVIEW);
  assert.equal(quickBooks.writeCount, 0);
  store.close();
});

test('T-CORRECTION: changed posted data produces one reversal and replacement', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  await engine.post(day.id);
  const changed = engine.ingest(fixture('us-day-changed.json'));
  assert.equal(changed.status, DayStatus.CORRECTION_REQUIRED);
  const corrected = await engine.correct(day.id);
  assert.equal(corrected.status, DayStatus.CORRECTED);
  assert(corrected.reversalQbId);
  assert(corrected.replacementQbId);
  assert.equal(quickBooks.writeCount, 3);
  assert.equal(corrected.source.sourceVersion, 'toast-close-2');
  store.close();
});

test('T-CORRECTION-RESUME: replacement failure resumes without a second reversal', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  await engine.post(day.id);
  engine.ingest(fixture('us-day-changed.json'));
  const partial = await engine.correct(day.id, { replacementBehavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT });
  assert.equal(partial.status, DayStatus.CORRECTION_PARTIAL);
  assert(partial.reversalQbId);
  assert.equal(quickBooks.writeCount, 2);
  const completed = await engine.correct(day.id);
  assert.equal(completed.status, DayStatus.CORRECTED);
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-CORRECTION: later source revisions use new correction references', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  await engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  assert.equal((await engine.correct(day.id)).correctionVersion, 1);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  engine.ingest(revisionThree);
  const correctedAgain = await engine.correct(day.id);
  assert.equal(correctedAgain.correctionVersion, 2);
  assert.equal(correctedAgain.journal.docNumber.endsWith('04'), true);
  assert.equal(correctedAgain.journal.kind, 'REPLACEMENT');
  assert.equal(quickBooks.writeCount, 5);
  store.close();
});

test('T-REVISION-QUEUE: a newer pending revision replaces the prior one without a state error', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  await engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  const pending = engine.ingest(revisionThree);
  assert.equal(pending.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(pending.pendingSource.sourceVersion, 'toast-close-3');
  const corrected = await engine.correct(day.id);
  assert.equal(corrected.status, DayStatus.CORRECTED);
  assert.equal(corrected.source.sourceVersion, 'toast-close-3');
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-REVISION-QUEUE: an in-flight correction finishes its snapshot before the queued revision', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  await engine.post(day.id);
  const revisionTwo = fixture('us-day-changed.json');
  engine.ingest(revisionTwo);
  const partial = await engine.correct(day.id, { replacementBehavior: WriteBehavior.TIMEOUT_BEFORE_COMMIT });
  assert.equal(partial.status, DayStatus.CORRECTION_PARTIAL);
  const revisionThree = structuredClone(revisionTwo);
  revisionThree.sourceVersion = 'toast-close-3';
  revisionThree.categories.food_sales += 500;
  revisionThree.categories.card += 500;
  const queued = engine.ingest(revisionThree);
  assert.equal(queued.status, DayStatus.CORRECTION_PARTIAL);
  assert.equal(queued.pendingSource.sourceVersion, 'toast-close-2');
  assert.equal(queued.queuedSource.sourceVersion, 'toast-close-3');
  const next = await engine.correct(day.id);
  assert.equal(next.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(next.source.sourceVersion, 'toast-close-2');
  assert.equal(next.pendingSource.sourceVersion, 'toast-close-3');
  const completed = await engine.correct(day.id);
  assert.equal(completed.status, DayStatus.CORRECTED);
  assert.equal(completed.source.sourceVersion, 'toast-close-3');
  assert.equal(completed.journal.kind, 'REPLACEMENT');
  assert.equal(quickBooks.writeCount, 5);
  store.close();
});

test('T-ENTITLEMENT-PERSISTENCE: a denied write persists its state and resumes after payment', async () => {
  const { source, engine, quickBooks, store } = setup({ paid: false });
  const day = engine.ingest(source);
  const blocked = await engine.post(day.id);
  assert.equal(blocked.status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(blocked.blockedFromStatus, DayStatus.READY_FOR_REVIEW);
  assert.equal(blocked.errorCode, 'ENTITLEMENT_BLOCKED');
  assert.equal(store.getDay(day.id).status, DayStatus.ENTITLEMENT_BLOCKED);
  assert.equal(quickBooks.writeCount, 0);
  store.putEntitlement(source.workspaceId, { status: 'PAID', postingPaused: false });
  assert.equal((await engine.post(day.id)).status, DayStatus.POSTED);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-ENTITLEMENT-PERSISTENCE: a revision cannot erase a blocked uncertain write', async () => {
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
  store.putEntitlement(source.workspaceId, { status: 'PAID', postingPaused: false });
  const posted = await engine.post(day.id);
  assert.equal(posted.status, DayStatus.CORRECTION_REQUIRED);
  assert.equal(posted.pendingSource.sourceVersion, 'toast-close-2');
  assert.equal((await engine.correct(day.id)).status, DayStatus.CORRECTED);
  assert.equal(quickBooks.writeCount, 3);
  store.close();
});

test('T-EXTERNAL-EDIT: edited original blocks automatic correction', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const posted = await engine.post(day.id);
  quickBooks.mutateJournal(posted.qbJournalId, (journal) => ({ ...journal, privateNote: 'edited outside app' }));
  engine.ingest(fixture('us-day-changed.json'));
  assert.equal((await engine.correct(day.id)).status, DayStatus.EXTERNAL_CHANGE);
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});

test('T-EXTERNAL-DELETE: deleted original blocks automatic correction', async () => {
  const { source, engine, quickBooks, store } = setup();
  const day = engine.ingest(source);
  const posted = await engine.post(day.id);
  quickBooks.deleteJournal(posted.qbJournalId);
  engine.ingest(fixture('us-day-changed.json'));
  const blocked = await engine.correct(day.id);
  assert.equal(blocked.status, DayStatus.EXTERNAL_CHANGE);
  assert.equal(blocked.error.deleted, true);
  store.close();
});

test('T-MAPPING-VERSION: approved mapping revisions never rewrite the original preview', async () => {
  const { source, mapping, engine, store } = setup();
  const day = engine.ingest(source);
  const original = day.journal;
  store.saveMapping(source.locationId, { ...mapping, version: 2, entries: { ...mapping.entries, cash: { ...mapping.entries.cash, accountName: 'Cash on Hand v2' } } });
  assert.deepEqual(store.getDay(day.id).journal, original);
  assert.equal(store.getDay(day.id).mappingVersion, 1);
  store.close();
});

test('T-QB-DIMENSION: the journal uses the selected QuickBooks department rather than the internal location ID', async () => {
  const { source, engine, store } = setup({ departmentRef: 'qb-department-42' });
  const day = engine.ingest(source);
  assert.equal(day.journal.departmentRef, 'qb-department-42');
  assert.notEqual(day.journal.departmentRef, source.locationId);
  store.close();
});

test('T-QB-CONTRACT and T-CSV-RESTAURANT: external production evidence remains explicitly gated', async () => {
  const manifest = JSON.parse(String(requireFixture('../contracts/gate-manifest.json')));
  assert.deepEqual(manifest.support_matrix.methods, ['TOAST_CSV_UPLOAD']);
  assert.equal(manifest.external_gates.some((gate) => gate.id === 'EXT-TOAST-ACCESS'), false);
  assert.equal(manifest.external_gates.find((gate) => gate.id === 'EXT-US-FIXTURE').status, 'BLOCKED_EXTERNAL');
  assert.equal(manifest.external_gates.find((gate) => gate.id === 'EXT-CA-FIXTURE').status, 'BLOCKED_EXTERNAL');
  assert.equal(manifest.external_gates.find((gate) => gate.id === 'EXT-QB-US-SANDBOX').status, 'BLOCKED_EXTERNAL');
});

function requireFixture(relativePath) {
  return requireFixture.readFile(relativePath);
}

requireFixture.readFile = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return globalThis.process.getBuiltinModule('fs').readFileSync(url);
};
