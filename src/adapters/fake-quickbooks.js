import { randomUUID } from 'node:crypto';
import { deepClone } from '../domain/canonical.js';
import { journalsEquivalent } from '../domain/journal.js';
import { AppError, UnknownWriteOutcomeError } from '../domain/errors.js';

export const WriteBehavior = Object.freeze({
  SUCCESS: 'SUCCESS',
  TIMEOUT_AFTER_COMMIT: 'TIMEOUT_AFTER_COMMIT',
  TIMEOUT_BEFORE_COMMIT: 'TIMEOUT_BEFORE_COMMIT',
  REJECT: 'REJECT',
});

export class FakeQuickBooks {
  constructor() {
    this.journals = new Map();
    this.byDocNumber = new Map();
    this.byIdempotencyKey = new Map();
    this.writeCount = 0;
  }

  createJournal(journal, { idempotencyKey, behavior = WriteBehavior.SUCCESS } = {}) {
    const priorId = this.byIdempotencyKey.get(idempotencyKey);
    if (priorId) return deepClone(this.journals.get(priorId));
    if (behavior === WriteBehavior.REJECT) throw new AppError('QUICKBOOKS_REJECTED', 'QuickBooks rejected the journal.');
    if (behavior === WriteBehavior.TIMEOUT_BEFORE_COMMIT) throw new UnknownWriteOutcomeError('QuickBooks timed out before commit could be confirmed.');

    const id = `qb_${randomUUID()}`;
    const record = { id, syncToken: '0', createdAt: new Date().toISOString(), journal: deepClone(journal) };
    this.journals.set(id, record);
    this.byDocNumber.set(journal.docNumber, id);
    this.byIdempotencyKey.set(idempotencyKey, id);
    this.writeCount += 1;
    if (behavior === WriteBehavior.TIMEOUT_AFTER_COMMIT) throw new UnknownWriteOutcomeError('QuickBooks committed the journal but the response timed out.');
    return deepClone(record);
  }

  getJournal(id) {
    const value = this.journals.get(id);
    return value ? deepClone(value) : null;
  }

  findByDocNumber(docNumber) {
    const id = this.byDocNumber.get(docNumber);
    return id ? this.getJournal(id) : null;
  }

  findEquivalent(journal, { excludeDocNumber } = {}) {
    for (const record of this.journals.values()) {
      if (record.journal.docNumber !== excludeDocNumber && journalsEquivalent(record.journal, journal)) return deepClone(record);
    }
    return null;
  }

  mutateJournal(id, mutation) {
    const current = this.journals.get(id);
    if (!current) return null;
    const nextJournal = mutation(deepClone(current.journal));
    const next = { ...current, syncToken: String(Number(current.syncToken) + 1), journal: nextJournal };
    this.journals.set(id, next);
    return deepClone(next);
  }

  deleteJournal(id) {
    const current = this.journals.get(id);
    if (!current) return false;
    this.journals.delete(id);
    this.byDocNumber.delete(current.journal.docNumber);
    for (const [key, value] of this.byIdempotencyKey) if (value === id) this.byIdempotencyKey.delete(key);
    return true;
  }

  seedJournal(journal) {
    return this.createJournal(journal, { idempotencyKey: `seed_${randomUUID()}` });
  }
}
