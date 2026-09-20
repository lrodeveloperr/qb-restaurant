import { evaluateEntitlement } from '../billing/entitlements.js';
import { stableStringify } from './canonical.js';
import { AppError, UnknownWriteOutcomeError, invariant, toSafeError } from './errors.js';
import { buildJournal, journalsEquivalent } from './journal.js';
import { normalizeSource, sourceIdentity } from './normalize.js';
import { makeIdempotencyKey } from './reference.js';
import { DayStatus } from './state-machine.js';

const POSTED = new Set([DayStatus.POSTED, DayStatus.ALREADY_POSTED, DayStatus.CORRECTED]);

export class SyncEngine {
  constructor({ store, quickBooks, clock = () => new Date().toISOString() }) {
    this.store = store;
    this.quickBooks = quickBooks;
    this.clock = clock;
  }

  ingest(rawSource) {
    const source = normalizeSource(rawSource);
    this.#assertScope(source);
    const existing = this.store.getDayByIdentity(sourceIdentity(source));
    if (existing && existing.sourceFingerprint === source.sourceFingerprint) return existing;
    if (existing && POSTED.has(existing.status)) {
      return this.store.transition(existing.id, DayStatus.CORRECTION_REQUIRED, {
        pendingSource: source, reversalQbId: null, replacementQbId: null, errorCode: null, error: null,
      });
    }

    const mapping = this.store.getMapping(source.locationId);
    if (!mapping) {
      if (existing) return this.store.transition(existing.id, DayStatus.NEEDS_MAPPING, { source, journal: null, errorCode: 'UNMAPPED_CATEGORY' });
      return this.store.createDay(source, DayStatus.NEEDS_MAPPING);
    }

    try {
      const journal = buildJournal(source, mapping);
      if (existing) return this.store.transition(existing.id, DayStatus.READY_FOR_REVIEW, { source, journal, mappingVersion: mapping.version, errorCode: null, error: null });
      return this.store.createDay(source, DayStatus.READY_FOR_REVIEW, journal);
    } catch (error) {
      const safe = toSafeError(error);
      if (!['UNMAPPED_CATEGORY', 'UNBALANCED_JOURNAL', 'INACTIVE_ACCOUNT'].includes(safe.code)) throw error;
      const status = safe.code === 'UNMAPPED_CATEGORY' ? DayStatus.NEEDS_MAPPING : DayStatus.INVALID_SOURCE;
      if (existing) return this.store.transition(existing.id, status, { source, journal: null, mappingVersion: mapping.version, errorCode: safe.code, error: safe });
      const day = this.store.createDay(source, status);
      return this.store.transition(day.id, status, { mappingVersion: mapping.version, errorCode: safe.code, error: safe });
    }
  }

  preview(dayId) {
    const day = this.#day(dayId);
    const mapping = this.store.getMapping(day.locationId);
    invariant(mapping, 'MAPPING_REQUIRED', 'A mapping must be approved before preview.');
    const journal = buildJournal(day.source, mapping);
    if (day.status === DayStatus.NEEDS_MAPPING || day.status === DayStatus.INVALID_SOURCE || day.status === DayStatus.FAILED || day.status === DayStatus.PAUSED || day.status === DayStatus.ENTITLEMENT_BLOCKED) {
      return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { journal, mappingVersion: mapping.version, errorCode: null, error: null });
    }
    if (day.status === DayStatus.READY_FOR_REVIEW) return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { journal, mappingVersion: mapping.version, errorCode: null, error: null });
    return { ...day, journal };
  }

  post(dayId, { behavior } = {}) {
    let day = this.#day(dayId);
    if (POSTED.has(day.status)) return day;
    if (day.status === DayStatus.ENTITLEMENT_BLOCKED) day = this.preview(day.id);
    invariant(day.status === DayStatus.READY_FOR_REVIEW || day.status === DayStatus.OUTCOME_UNKNOWN || day.status === DayStatus.FAILED,
      'DAY_NOT_POSTABLE', 'Only a reviewed unposted day can be posted.', { status: day.status });
    this.#assertEntitlement(day.workspaceId, day.locationId);
    const journal = day.journal ?? this.preview(day.id).journal;
    const idempotencyKey = makeIdempotencyKey({ ...sourceIdentity(day.source), kind: 'ORIGINAL', sourceFingerprint: day.sourceFingerprint, mappingVersion: journal.mappingVersion });

    const exact = this.quickBooks.findByDocNumber(journal.docNumber);
    if (exact) {
      if (exact.journal.privateNote !== journal.privateNote || !journalsEquivalent(exact.journal, journal)) {
        return this.store.transition(day.id, DayStatus.POSSIBLE_DUPLICATE, {
          errorCode: 'REFERENCE_COLLISION', error: { code: 'REFERENCE_COLLISION', candidateId: exact.id },
        });
      }
      return this.store.transition(day.id, DayStatus.ALREADY_POSTED, {
        qbJournalId: exact.id, qbSnapshot: exact, errorCode: null, error: null,
      });
    }
    if (!day.dismissedDuplicate) {
      const equivalent = this.quickBooks.findEquivalent(journal, { excludeDocNumber: journal.docNumber });
      if (equivalent) {
        return this.store.transition(day.id, DayStatus.POSSIBLE_DUPLICATE, {
          errorCode: 'POSSIBLE_DUPLICATE', error: { code: 'POSSIBLE_DUPLICATE', candidateId: equivalent.id },
        });
      }
    }

    day = this.store.transition(day.id, DayStatus.POSTING, { errorCode: null, error: null });
    this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'STARTED' });
    try {
      const created = this.quickBooks.createJournal(journal, { idempotencyKey, behavior });
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'COMMITTED', qbId: created.id });
      return this.store.transition(day.id, DayStatus.POSTED, { qbJournalId: created.id, qbSnapshot: created });
    } catch (error) {
      if (!(error instanceof UnknownWriteOutcomeError)) {
        this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'FAILED' });
        return this.store.transition(day.id, DayStatus.FAILED, { errorCode: error.code ?? 'QUICKBOOKS_ERROR', error: toSafeError(error) });
      }
      day = this.store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, { errorCode: error.code, error: toSafeError(error) });
      return this.recover(day.id);
    }
  }

  recover(dayId) {
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.OUTCOME_UNKNOWN, 'RECOVERY_NOT_REQUIRED', 'This day has no uncertain write to recover.');
    const found = this.quickBooks.findByDocNumber(day.journal.docNumber);
    if (found && found.journal.privateNote === day.journal.privateNote && journalsEquivalent(found.journal, day.journal)) {
      return this.store.transition(day.id, DayStatus.POSTED, { qbJournalId: found.id, qbSnapshot: found, errorCode: null, error: null });
    }
    if (found) return this.store.transition(day.id, DayStatus.FAILED, { errorCode: 'REFERENCE_COLLISION', error: { code: 'REFERENCE_COLLISION', candidateId: found.id } });
    return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { errorCode: null, error: null });
  }

  dismissDuplicate(dayId) {
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.POSSIBLE_DUPLICATE, 'NO_POSSIBLE_DUPLICATE', 'No possible duplicate is awaiting review.');
    return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { dismissedDuplicate: true, errorCode: null, error: null });
  }

  adoptDuplicate(dayId, quickBooksId) {
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.POSSIBLE_DUPLICATE, 'NO_POSSIBLE_DUPLICATE', 'No possible duplicate is awaiting review.');
    const found = this.quickBooks.getJournal(quickBooksId);
    invariant(found, 'QUICKBOOKS_JOURNAL_NOT_FOUND', 'The selected QuickBooks journal no longer exists.');
    invariant(journalsEquivalent(found.journal, day.journal), 'DUPLICATE_MISMATCH', 'The selected QuickBooks journal is not accounting-equivalent to this location-day.');
    return this.store.transition(day.id, DayStatus.ALREADY_POSTED, { qbJournalId: found.id, qbSnapshot: found, errorCode: null, error: null });
  }

  correct(dayId, { reversalBehavior, replacementBehavior } = {}) {
    let day = this.#day(dayId);
    invariant([DayStatus.CORRECTION_REQUIRED, DayStatus.CORRECTION_PARTIAL].includes(day.status), 'CORRECTION_NOT_REQUIRED', 'This day does not need a correction.');
    invariant(day.pendingSource, 'CORRECTION_SOURCE_REQUIRED', 'The replacement source is missing.');
    this.#assertEntitlement(day.workspaceId, day.locationId);

    const liveOriginal = this.quickBooks.getJournal(day.qbJournalId);
    if (!liveOriginal || stableStringify(liveOriginal.journal) !== stableStringify(day.qbSnapshot?.journal)) {
      return this.store.transition(day.id, DayStatus.EXTERNAL_CHANGE, {
        errorCode: 'EXTERNAL_CHANGE', error: { code: 'EXTERNAL_CHANGE', deleted: !liveOriginal },
      });
    }

    const originalMapping = this.store.getMapping(day.locationId, day.mappingVersion);
    const currentMapping = this.store.getMapping(day.locationId);
    invariant(originalMapping && currentMapping, 'MAPPING_REQUIRED', 'Both original and current mapping versions are required for correction.');
    const correctionVersion = day.status === DayStatus.CORRECTION_PARTIAL ? day.correctionVersion : day.correctionVersion + 1;
    invariant(correctionVersion <= 49, 'CORRECTION_LIMIT', 'This location-day has reached the supported correction limit.');
    const reversal = buildJournal(day.source, originalMapping, { sequence: correctionVersion * 2 - 1, reverse: true });
    const replacement = buildJournal(day.pendingSource, currentMapping, { sequence: correctionVersion * 2 });
    if (day.status !== DayStatus.CORRECTING) day = this.store.transition(day.id, DayStatus.CORRECTING, { correctionVersion });

    let reversalRecord = day.reversalQbId ? this.quickBooks.getJournal(day.reversalQbId) : null;
    if (day.reversalQbId && (!reversalRecord || reversalRecord.journal.privateNote !== reversal.privateNote || !journalsEquivalent(reversalRecord.journal, reversal))) {
      return this.store.transition(day.id, DayStatus.EXTERNAL_CHANGE, {
        errorCode: 'EXTERNAL_CHANGE', error: { code: 'EXTERNAL_CHANGE', correctionEntry: 'REVERSAL', deleted: !reversalRecord },
      });
    }
    if (!reversalRecord) {
      reversalRecord = this.#writeCorrection(day, reversal, 'REVERSAL', reversalBehavior);
      if (!reversalRecord) return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: 'OUTCOME_UNKNOWN' });
      day = this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { reversalQbId: reversalRecord.id, errorCode: null, error: null });
    }

    if (day.status !== DayStatus.CORRECTING) day = this.store.transition(day.id, DayStatus.CORRECTING);
    let replacementRecord = day.replacementQbId ? this.quickBooks.getJournal(day.replacementQbId) : null;
    if (!replacementRecord) {
      replacementRecord = this.#writeCorrection(day, replacement, 'REPLACEMENT', replacementBehavior);
      if (!replacementRecord) return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: 'OUTCOME_UNKNOWN' });
    }
    return this.store.transition(day.id, DayStatus.CORRECTED, {
      source: day.pendingSource, pendingSource: null, journal: replacement, mappingVersion: currentMapping.version,
      qbJournalId: replacementRecord.id, qbSnapshot: replacementRecord, reversalQbId: reversalRecord.id,
      replacementQbId: replacementRecord.id, errorCode: null, error: null,
    });
  }

  auditPostedDay(dayId) {
    const day = this.#day(dayId);
    invariant(POSTED.has(day.status), 'DAY_NOT_POSTED', 'Only posted days can be audited.');
    const live = this.quickBooks.getJournal(day.qbJournalId);
    if (!live || stableStringify(live.journal) !== stableStringify(day.qbSnapshot?.journal)) {
      return this.store.transition(day.id, DayStatus.EXTERNAL_CHANGE, { errorCode: 'EXTERNAL_CHANGE', error: { code: 'EXTERNAL_CHANGE', deleted: !live } });
    }
    return day;
  }

  #writeCorrection(day, journal, kind, behavior) {
    const idempotencyKey = makeIdempotencyKey({ ...sourceIdentity(day.source), kind, docNumber: journal.docNumber });
    const exact = this.quickBooks.findByDocNumber(journal.docNumber);
    if (exact) {
      invariant(exact.journal.privateNote === journal.privateNote && journalsEquivalent(exact.journal, journal),
        'REFERENCE_COLLISION', 'A QuickBooks journal uses the correction reference with different accounting content.');
      return exact;
    }
    this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind, outcome: 'STARTED' });
    try {
      const record = this.quickBooks.createJournal(journal, { idempotencyKey, behavior });
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind, outcome: 'COMMITTED', qbId: record.id });
      return record;
    } catch (error) {
      if (!(error instanceof UnknownWriteOutcomeError)) throw error;
      const recovered = this.quickBooks.findByDocNumber(journal.docNumber);
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind, outcome: recovered ? 'RECOVERED' : 'UNKNOWN', qbId: recovered?.id });
      if (recovered) invariant(recovered.journal.privateNote === journal.privateNote && journalsEquivalent(recovered.journal, journal),
        'REFERENCE_COLLISION', 'Recovered QuickBooks journal differs from the expected correction.');
      return recovered;
    }
  }

  #assertScope(source) {
    const workspace = this.store.getWorkspace(source.workspaceId);
    const location = this.store.getLocation(source.locationId);
    invariant(workspace, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    invariant(location && location.workspaceId === workspace.id, 'LOCATION_SCOPE_MISMATCH', 'Location does not belong to this workspace.');
    invariant(workspace.realmId === source.realmId, 'REALM_SCOPE_MISMATCH', 'Source realm does not match the workspace QuickBooks realm.');
    invariant(workspace.country === source.country && workspace.currency === source.currency, 'UNSUPPORTED_COUNTRY_CURRENCY', 'Source country and currency do not match the workspace.');
    invariant(location.timezone === source.timezone, 'TIMEZONE_MISMATCH', 'Source time zone does not match the location.');
  }

  #assertEntitlement(workspaceId, locationId) {
    const location = this.store.getLocation(locationId);
    invariant(location?.active, 'LOCATION_INACTIVE', 'Posting is unavailable because the location is inactive.');
    invariant(!location.syncPaused, 'SYNC_PAUSED', 'Posting is unavailable because sync is paused for this location.');
    const entitlement = this.store.getEntitlement(workspaceId);
    invariant(entitlement, 'ENTITLEMENT_REQUIRED', 'Workspace entitlement is missing.');
    const result = evaluateEntitlement(entitlement, this.clock());
    if (!result.canPost) throw new AppError('ENTITLEMENT_BLOCKED', 'Posting is not permitted by the current entitlement.', { reason: result.reason, effectiveStatus: result.effectiveStatus });
  }

  #day(dayId) {
    const day = this.store.getDay(dayId);
    invariant(day, 'DAY_NOT_FOUND', 'Sync day not found.', { dayId });
    return day;
  }
}
