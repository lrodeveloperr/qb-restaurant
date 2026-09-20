import { deepFreeze, sha256, stableStringify } from './canonical.js';
import { invariant } from './errors.js';
import { makeDocNumber, makePrivateNote } from './reference.js';

const POSTING_TYPES = new Set(['Debit', 'Credit']);

export function validateMapping(mapping) {
  invariant(mapping && typeof mapping === 'object' && !Array.isArray(mapping), 'INVALID_MAPPING', 'Mapping is required.');
  invariant(Number.isSafeInteger(mapping.version) && mapping.version > 0, 'INVALID_MAPPING', 'Mapping version must be a positive integer.');
  invariant(mapping.entries && typeof mapping.entries === 'object' && !Array.isArray(mapping.entries), 'INVALID_MAPPING', 'Mapping entries are required.');
  for (const [category, entry] of Object.entries(mapping.entries)) {
    invariant(entry && typeof entry === 'object', 'INVALID_MAPPING', 'Every mapping entry must be an object.', { category });
    invariant(typeof entry.accountId === 'string' && entry.accountId, 'INVALID_MAPPING', 'Every mapping entry needs an account ID.', { category });
    invariant(typeof entry.accountName === 'string' && entry.accountName, 'INVALID_MAPPING', 'Every mapping entry needs an account name.', { category });
    invariant(POSTING_TYPES.has(entry.postingType), 'INVALID_MAPPING', 'postingType must be Debit or Credit.', { category });
    invariant(entry.active !== false, 'INACTIVE_ACCOUNT', 'An inactive QuickBooks account cannot be used.', { category, accountId: entry.accountId });
  }
  return mapping;
}

export function buildJournal(source, mapping, { sequence = 0, reverse = false } = {}) {
  validateMapping(mapping);
  const lines = [];
  const unmapped = [];

  for (const category of Object.keys(source.categories).sort()) {
    const amountCents = source.categories[category];
    if (amountCents === 0) continue;
    const entry = mapping.entries[category];
    if (!entry) {
      unmapped.push(category);
      continue;
    }
    invariant(entry.active !== false, 'INACTIVE_ACCOUNT', 'An inactive QuickBooks account cannot be used.', { category, accountId: entry.accountId });
    const postingType = reverse
      ? (entry.postingType === 'Debit' ? 'Credit' : 'Debit')
      : entry.postingType;
    lines.push({
      category,
      description: `${reverse ? 'Reversal: ' : ''}${entry.accountName} — ${category}`,
      amountCents,
      postingType,
      accountRef: entry.accountId,
      ...(entry.classRef ? { classRef: entry.classRef } : {}),
    });
  }

  invariant(unmapped.length === 0, 'UNMAPPED_CATEGORY', 'Every non-zero source category must be mapped.', { categories: unmapped });
  const debitCents = lines.filter((line) => line.postingType === 'Debit').reduce((sum, line) => sum + line.amountCents, 0);
  const creditCents = lines.filter((line) => line.postingType === 'Credit').reduce((sum, line) => sum + line.amountCents, 0);
  invariant(debitCents === creditCents, 'UNBALANCED_JOURNAL', 'Debits and credits must balance exactly in cents.', { debitCents, creditCents });
  invariant(debitCents > 0, 'EMPTY_JOURNAL', 'A journal must contain a non-zero debit and credit.');

  const journal = {
    schemaVersion: 1,
    kind: reverse ? 'REVERSAL' : sequence === 2 ? 'REPLACEMENT' : 'ORIGINAL',
    docNumber: makeDocNumber({ ...source, sequence }),
    privateNote: makePrivateNote({ ...source, sequence }),
    txnDate: source.businessDate,
    currency: source.currency,
    departmentRef: source.locationId,
    sourceFingerprint: source.sourceFingerprint,
    mappingVersion: mapping.version,
    lines,
    totals: { debitCents, creditCents },
  };
  return deepFreeze({ ...journal, accountingFingerprint: accountingFingerprint(journal) });
}

export function accountingProjection(journal) {
  return {
    txnDate: journal.txnDate,
    currency: journal.currency,
    departmentRef: journal.departmentRef,
    lines: journal.lines.map(({ amountCents, postingType, accountRef, classRef = null }) => ({ amountCents, postingType, accountRef, classRef })),
    totals: journal.totals,
  };
}

export function accountingFingerprint(journal) {
  return sha256(stableStringify(accountingProjection(journal)));
}

export function journalsEquivalent(left, right) {
  return accountingFingerprint(left) === accountingFingerprint(right);
}
