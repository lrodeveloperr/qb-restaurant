import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSource } from '../src/domain/normalize.js';
import { buildJournal } from '../src/domain/journal.js';
import { makeDocNumber } from '../src/domain/reference.js';
import { assertTransition, DayStatus } from '../src/domain/state-machine.js';
import { parseCsvSource, toCsvSource, MAX_CSV_BYTES } from '../src/adapters/csv.js';
import { fixture, setup } from './helpers.js';

test('T-NORMALIZE: canonical input is sorted, frozen, and fingerprinted', () => {
  const input = fixture('us-day.json');
  input.categories.zero_value_supported = 0;
  const normalized = normalizeSource(input);
  assert.equal(normalized.sourceFingerprint.length, 64);
  assert.deepEqual(Object.keys(normalized.categories), Object.keys(normalized.categories).sort());
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.categories));
  assert.equal(normalized.categories.zero_value_supported, 0);
});

test('T-MALFORMED: malformed money and dates fail closed', () => {
  const input = fixture('us-day.json');
  input.categories.cash = 10.25;
  assert.throws(() => normalizeSource(input), { code: 'INVALID_MONEY' });
  input.categories.cash = 10;
  input.businessDate = '2026-02-30';
  assert.throws(() => normalizeSource(input), { code: 'INVALID_BUSINESS_DATE' });
});

test('T-CURRENCY: unsupported or crossed market pairs are rejected', () => {
  const input = fixture('ca-day.json');
  input.currency = 'USD';
  assert.throws(() => normalizeSource(input), { code: 'UNSUPPORTED_COUNTRY_CURRENCY' });
});

test('T-JOURNAL-US: US source produces an exact balanced deterministic journal', () => {
  const source = normalizeSource(fixture('us-day.json'));
  const mapping = fixture('us-mapping.json');
  const first = buildJournal(source, mapping);
  const second = buildJournal(source, mapping);
  assert.deepEqual(first, second);
  assert.equal(first.totals.debitCents, 123000);
  assert.equal(first.totals.creditCents, 123000);
  assert(first.lines.some((line) => line.category === 'sales_tax' && line.amountCents === 8000));
});

test('T-JOURNAL-CA: Quebec source preserves supplied GST and QST totals', () => {
  const source = normalizeSource(fixture('ca-day.json'));
  const journal = buildJournal(source, fixture('ca-mapping.json'));
  assert.equal(journal.currency, 'CAD');
  assert.equal(journal.totals.debitCents, 161719);
  assert.equal(journal.totals.creditCents, 161719);
  assert.equal(journal.lines.find((line) => line.category === 'gst').amountCents, 6250);
  assert.equal(journal.lines.find((line) => line.category === 'qst').amountCents, 12469);
});

test('T-UNMAPPED: every non-zero category needs an explicit mapping', () => {
  const mapping = fixture('us-mapping.json');
  delete mapping.entries.tips;
  assert.throws(() => buildJournal(normalizeSource(fixture('us-day.json')), mapping), { code: 'UNMAPPED_CATEGORY' });
});

test('T-UNBALANCED: the engine never inserts a plug line', () => {
  const source = fixture('us-day.json');
  source.categories.card -= 1;
  assert.throws(() => buildJournal(normalizeSource(source), fixture('us-mapping.json')), { code: 'UNBALANCED_JOURNAL' });
});

test('T-REFERENCE: stable QuickBooks references remain within 21 characters', () => {
  const ref = makeDocNumber({ realmId: 'long-realm-id', locationId: 'long-location-id', businessDate: '2026-09-18', sequence: 2 });
  assert.equal(ref.length, 21);
  assert.match(ref, /^RSQ[A-F0-9]{8}2026091802$/);
});

test('T-CSV: fixed CSV schema round-trips the pilot fixture', () => {
  const input = readFileSync(join(process.cwd(), 'fixtures', 'us-day.csv'));
  const parsed = parseCsvSource(input);
  const reparsed = parseCsvSource(toCsvSource(parsed));
  assert.deepEqual(reparsed.categories, parsed.categories);
  assert.equal(reparsed.sourceFingerprint, parsed.sourceFingerprint);
});

test('T-CSV-LIMITS: changed headers and oversized files reject', () => {
  const valid = readFileSync(join(process.cwd(), 'fixtures', 'us-day.csv'), 'utf8');
  assert.throws(() => parseCsvSource(valid.replace('schema_version', 'version')), { code: 'INVALID_CSV_HEADER' });
  assert.throws(() => parseCsvSource(Buffer.alloc(MAX_CSV_BYTES + 1, 65)), { code: 'CSV_TOO_LARGE' });
});

test('T-STATE-MACHINE: illegal state transitions fail closed', () => {
  assert.equal(assertTransition(DayStatus.READY_FOR_REVIEW, DayStatus.POSTING), DayStatus.POSTING);
  assert.throws(() => assertTransition(DayStatus.POSTED, DayStatus.READY_FOR_REVIEW), { code: 'ILLEGAL_STATE_TRANSITION' });
});

test('T-PROPERTY-BALANCE: 10000 generated balanced journals retain cent equality', () => {
  const base = fixture('us-day.json');
  const mapping = fixture('us-mapping.json');
  for (let index = 1; index <= 10_000; index += 1) {
    const amount = (index * 7919) % 1_000_000 + 1;
    const source = { ...base, sourceVersion: `generated-${index}`, categories: { food_sales: amount, cash: amount } };
    const journal = buildJournal(normalizeSource(source), mapping);
    assert.equal(journal.totals.debitCents, journal.totals.creditCents);
    assert.equal(journal.lines.length, 2);
  }
});

test('T-PROPERTY-STATES: invalid random transitions are never accepted', () => {
  const values = Object.values(DayStatus);
  for (let index = 0; index < 10_000; index += 1) {
    const from = values[(index * 17) % values.length];
    const to = values[(index * 31 + 7) % values.length];
    try {
      assertTransition(from, to);
    } catch (error) {
      assert.equal(error.code, 'ILLEGAL_STATE_TRANSITION');
    }
  }
});

test('T-REALM-ISOLATION and T-LOCATION-UNIQUENESS: persistence constraints isolate scopes', () => {
  const { store, source } = setup();
  assert.throws(() => store.createWorkspace({ id: 'other', realmId: source.realmId, country: 'US', currency: 'USD' }), { code: 'WORKSPACE_CONFLICT' });
  store.createWorkspace({ id: 'other', realmId: 'other-realm', country: 'US', currency: 'USD' });
  assert.throws(() => store.createLocation({ id: 'other-location', workspaceId: 'other', toastLocationId: `toast-${source.locationId}`, timezone: source.timezone }), { code: 'LOCATION_CONFLICT' });
  store.setLocationActive(source.locationId, false);
  assert.equal(store.createLocation({ id: 'other-location', workspaceId: 'other', toastLocationId: `toast-${source.locationId}`, timezone: source.timezone }).workspaceId, 'other');
  store.close();
});
