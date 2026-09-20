import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSource } from '../src/domain/normalize.js';
import { buildJournal, journalsEquivalent } from '../src/domain/journal.js';
import { translate } from '../src/i18n/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function caFixture(name) {
  return JSON.parse(readFileSync(join(here, '..', 'fixtures', name), 'utf8'));
}

test('CA-QC-V2: illustrative restaurant day preserves all supplied CAD accounting totals', () => {
  const source = normalizeSource(caFixture('ca-qc-restaurant-day-v2.json'));
  const mapping = caFixture('ca-qc-mapping-v2.json');
  const journal = buildJournal(source, mapping);

  assert.equal(journal.currency, 'CAD');
  assert.equal(journal.txnDate, '2026-09-18');
  assert.equal(journal.mappingVersion, 2);
  assert.equal(journal.totals.debitCents, 172018);
  assert.equal(journal.totals.creditCents, 172018);

  const lines = Object.fromEntries(journal.lines.map((line) => [line.category, line]));
  assert.deepEqual(
    {
      gst: [lines.gst.amountCents, lines.gst.postingType],
      qst: [lines.qst.amountCents, lines.qst.postingType],
      tips: [lines.tips.amountCents, lines.tips.postingType],
      serviceCharges: [lines.service_charges.amountCents, lines.service_charges.postingType],
      giftSold: [lines.gift_cards_sold.amountCents, lines.gift_cards_sold.postingType],
      giftRedeemed: [lines.gift_cards_redeemed.amountCents, lines.gift_cards_redeemed.postingType],
      refunds: [lines.refunds.amountCents, lines.refunds.postingType],
      card: [lines.card.amountCents, lines.card.postingType],
      cash: [lines.cash.amountCents, lines.cash.postingType],
      delivery: [lines.delivery_platform_tender.amountCents, lines.delivery_platform_tender.postingType],
    },
    {
      gst: [6350, 'Credit'],
      qst: [12668, 'Credit'],
      tips: [15000, 'Credit'],
      serviceCharges: [8000, 'Credit'],
      giftSold: [5000, 'Credit'],
      giftRedeemed: [4000, 'Debit'],
      refunds: [1000, 'Debit'],
      card: [122018, 'Debit'],
      cash: [30000, 'Debit'],
      delivery: [10000, 'Debit'],
    },
  );

  assert.equal(lines.voids, undefined, 'zero voids are diagnostic and create no journal line');
  assert.equal(mapping.entries.voids, undefined, 'zero categories do not require a mapping');
});

test('CA-QC-V2: source GST/QST amounts are preserved rather than recalculated', () => {
  const input = caFixture('ca-qc-restaurant-day-v2.json');
  input.sourceVersion = 'csv-upload-ca-qc-v2-revision-tax-source';
  input.categories.gst += 1;
  input.categories.card += 1;
  const journal = buildJournal(normalizeSource(input), caFixture('ca-qc-mapping-v2.json'));

  assert.equal(journal.lines.find((line) => line.category === 'gst').amountCents, 6351);
  assert.equal(journal.totals.debitCents, journal.totals.creditCents);
});

test('CA-QC-V2: en-CA and fr-CA rendering cannot mutate the journal', () => {
  const source = normalizeSource(caFixture('ca-qc-restaurant-day-v2.json'));
  const mapping = caFixture('ca-qc-mapping-v2.json');
  const journal = buildJournal(source, mapping);
  const before = JSON.stringify(journal);

  translate('en-CA', 'summary.posted', { date: source.businessDate });
  translate('fr-CA', 'summary.posted', { date: source.businessDate });

  assert.equal(JSON.stringify(journal), before);
  assert(Object.isFrozen(journal));
});

test('CA-QC-V2: accounting equivalence is independent of QuickBooks line order', () => {
  const source = normalizeSource(caFixture('ca-qc-restaurant-day-v2.json'));
  const journal = buildJournal(source, caFixture('ca-qc-mapping-v2.json'));
  const reordered = structuredClone(journal);
  reordered.lines.reverse();

  assert.equal(journalsEquivalent(journal, reordered), true);
});
