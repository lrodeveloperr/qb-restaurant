import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource } from '../src/domain/normalize.js';
import { buildJournal } from '../src/domain/journal.js';
import { fixture } from './helpers.js';

const expectedLines = Object.freeze({
  card_tender: ['Debit', 110000, 'qb-us-card-clearing'],
  cash_tender: ['Debit', 15000, 'qb-us-undeposited-cash'],
  delivery_tender: ['Debit', 13000, 'qb-us-delivery-clearing'],
  discounts_and_comps: ['Debit', 4000, 'qb-us-discounts'],
  food_sales: ['Credit', 100000, 'qb-us-food-sales'],
  gift_cards_redeemed: ['Debit', 6000, 'qb-us-gift-card-liability'],
  gift_cards_sold: ['Credit', 5000, 'qb-us-gift-card-liability'],
  nonalcoholic_beverage_sales: ['Credit', 20000, 'qb-us-beverage-sales'],
  refunds: ['Debit', 3000, 'qb-us-sales-returns'],
  sales_tax: ['Credit', 9000, 'qb-us-sales-tax-payable'],
  service_charges: ['Credit', 5000, 'qb-us-service-charge-revenue'],
  tips_payable: ['Credit', 12000, 'qb-us-tips-payable'],
});

test('T-US-ACCOUNTING-V2: simulated US restaurant fixture is exact, balanced, and visibly unapproved', () => {
  const sourceFixture = fixture('us-restaurant-day-v2.json');
  const mapping = fixture('us-mapping-v2.json');
  assert.equal(sourceFixture.fixtureStatus, 'SIMULATED_NOT_ACCOUNTANT_APPROVED');
  assert.equal(sourceFixture.sourceStatus, 'NOT_A_REAL_TOAST_EXPORT');
  assert.equal(mapping.approvalStatus, 'LATEEF_APPROVAL_REQUIRED');

  const source = normalizeSource(sourceFixture);
  const journal = buildJournal(source, mapping);
  assert.equal(journal.currency, 'USD');
  assert.equal(journal.txnDate, '2026-09-18');
  assert.deepEqual(journal.totals, { debitCents: 151000, creditCents: 151000 });
  assert.equal(journal.lines.length, Object.keys(expectedLines).length);

  for (const line of journal.lines) {
    const [postingType, amountCents, accountRef] = expectedLines[line.category];
    assert.equal(line.postingType, postingType, line.category);
    assert.equal(line.amountCents, amountCents, line.category);
    assert.equal(line.accountRef, accountRef, line.category);
  }

  assert.equal(journal.lines.find((line) => line.category === 'sales_tax').amountCents, source.categories.sales_tax);
  assert.equal(journal.lines.find((line) => line.category === 'gift_cards_sold').accountRef,
    journal.lines.find((line) => line.category === 'gift_cards_redeemed').accountRef);
  assert(!journal.lines.some((line) => /plug|suspense|balanc/i.test(`${line.category} ${line.description}`)));
});

test('T-US-ACCOUNTING-V2: a correction reversal flips every approved direction without changing cents', () => {
  const source = normalizeSource(fixture('us-restaurant-day-v2.json'));
  const mapping = fixture('us-mapping-v2.json');
  const original = buildJournal(source, mapping);
  const reversal = buildJournal(source, mapping, { sequence: 1, reverse: true, kind: 'REVERSAL' });

  assert.equal(reversal.kind, 'REVERSAL');
  assert.deepEqual(reversal.totals, original.totals);
  for (const originalLine of original.lines) {
    const reversalLine = reversal.lines.find((line) => line.category === originalLine.category);
    assert.equal(reversalLine.amountCents, originalLine.amountCents);
    assert.equal(reversalLine.accountRef, originalLine.accountRef);
    assert.equal(reversalLine.postingType, originalLine.postingType === 'Debit' ? 'Credit' : 'Debit');
  }
});
