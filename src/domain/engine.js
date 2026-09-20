import { evaluateEntitlement } from '../billing/entitlements.js';
import { stableStringify } from './canonical.js';
import { UnknownWriteOutcomeError, invariant, toSafeError } from './errors.js';
import { buildJournal, journalsEquivalent } from './journal.js';
import { normalizeSource, sourceIdentity } from './normalize.js';
import { makeIdempotencyKey } from './reference.js';
import { DayStatus } from './state-machine.js';

const POSTED = new Set([DayStatus.POSTED, DayStatus.ALREADY_POSTED, DayStatus.CORRECTED]);
const CORRECTION_IN_FLIGHT = new Set([DayStatus.CORRECTING, DayStatus.CORRECTION_PARTIAL]);
const ORIGINAL_WRITE_IN_FLIGHT = new Set([DayStatus.POSTING, DayStatus.OUTCOME_UNKNOWN]);

export class SyncEngine {
  constructor({ store, quickBooks, clock = () => new Date().toISOString(), recoverOnStart = true }) {
    this.store = store;
    this.quickBooks = quickBooks;
    this.clock = clock;
    this.startupRecovery = recoverOnStart ? this.recoverInterruptedWrites() : Promise.resolve([]);
  }

  whenReady() {
    return this.startupRecovery;
  }

  ingest(rawSource) {
    const source = normalizeSource(rawSource);
    this.#assertScope(source);
    const existing = this.store.getDayByIdentity(sourceIdentity(source));
    if (existing && [existing.source, existing.pendingSource, existing.queuedSource]
      .some((candidate) => candidate?.sourceFingerprint === source.sourceFingerprint)) return existing;
    if (existing && POSTED.has(existing.status)) {
      return this.store.transition(existing.id, DayStatus.CORRECTION_REQUIRED, {
        pendingSource: source, queuedSource: null, reversalQbId: null, replacementQbId: null, errorCode: null, error: null,
      });
    }
    if (existing?.status === DayStatus.CORRECTION_REQUIRED) {
      return this.store.transition(existing.id, DayStatus.CORRECTION_REQUIRED, {
        pendingSource: source, queuedSource: null, reversalQbId: null, replacementQbId: null, errorCode: null, error: null,
      });
    }
    if (existing && (CORRECTION_IN_FLIGHT.has(existing.status) || ORIGINAL_WRITE_IN_FLIGHT.has(existing.status))) {
      return this.store.transition(existing.id, existing.status, { queuedSource: source });
    }
    if (existing?.status === DayStatus.EXTERNAL_CHANGE) {
      return this.store.transition(existing.id, DayStatus.EXTERNAL_CHANGE, { pendingSource: source });
    }
    if (existing?.status === DayStatus.ENTITLEMENT_BLOCKED
      && [DayStatus.CORRECTION_REQUIRED, DayStatus.CORRECTION_PARTIAL].includes(existing.blockedFromStatus)) {
      return this.store.transition(existing.id, DayStatus.ENTITLEMENT_BLOCKED, {
        pendingSource: existing.blockedFromStatus === DayStatus.CORRECTION_REQUIRED ? source : existing.pendingSource,
        queuedSource: existing.blockedFromStatus === DayStatus.CORRECTION_PARTIAL ? source : null,
      });
    }
    if (existing?.status === DayStatus.ENTITLEMENT_BLOCKED && ORIGINAL_WRITE_IN_FLIGHT.has(existing.blockedFromStatus)) {
      return this.store.transition(existing.id, DayStatus.ENTITLEMENT_BLOCKED, { queuedSource: source });
    }

    const mapping = this.store.getMapping(source.locationId);
    if (!mapping) {
      if (existing) return this.store.transition(existing.id, DayStatus.NEEDS_MAPPING, {
        source, pendingSource: null, queuedSource: null, journal: null, errorCode: 'UNMAPPED_CATEGORY',
      });
      return this.store.createDay(source, DayStatus.NEEDS_MAPPING);
    }

    try {
      const journal = this.#buildJournal(source, mapping);
      if (existing) return this.store.transition(existing.id, DayStatus.READY_FOR_REVIEW, {
        source, pendingSource: null, queuedSource: null, journal, mappingVersion: mapping.version, errorCode: null, error: null,
      });
      return this.store.createDay(source, DayStatus.READY_FOR_REVIEW, journal);
    } catch (error) {
      const safe = toSafeError(error);
      if (!['UNMAPPED_CATEGORY', 'UNBALANCED_JOURNAL', 'INACTIVE_ACCOUNT'].includes(safe.code)) throw error;
      const status = safe.code === 'UNMAPPED_CATEGORY' ? DayStatus.NEEDS_MAPPING : DayStatus.INVALID_SOURCE;
      if (existing) return this.store.transition(existing.id, status, {
        source, pendingSource: null, queuedSource: null, journal: null, mappingVersion: mapping.version, errorCode: safe.code, error: safe,
      });
      const day = this.store.createDay(source, status);
      return this.store.transition(day.id, status, { mappingVersion: mapping.version, errorCode: safe.code, error: safe });
    }
  }

  preview(dayId) {
    const day = this.#day(dayId);
    const mapping = this.store.getMapping(day.locationId);
    invariant(mapping, 'MAPPING_REQUIRED', 'A mapping must be approved before preview.');
    const journal = this.#buildJournal(day.source, mapping);
    if (day.status === DayStatus.NEEDS_MAPPING || day.status === DayStatus.INVALID_SOURCE || day.status === DayStatus.FAILED || day.status === DayStatus.PAUSED) {
      return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { journal, mappingVersion: mapping.version, errorCode: null, error: null });
    }
    if (day.status === DayStatus.READY_FOR_REVIEW) return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { journal, mappingVersion: mapping.version, errorCode: null, error: null });
    return { ...day, journal };
  }

  async post(dayId, { behavior } = {}) {
    await this.startupRecovery;
    let day = this.#day(dayId);
    if (POSTED.has(day.status)) return day;
    if (day.status === DayStatus.ENTITLEMENT_BLOCKED) {
      const restored = this.#restoreEntitlementBlocked(day);
      if (restored.status === DayStatus.ENTITLEMENT_BLOCKED) return restored;
      day = restored;
    }
    if (day.status === DayStatus.OUTCOME_UNKNOWN) {
      const recovered = await this.#recover(day.id);
      return recovered.status === DayStatus.READY_FOR_REVIEW ? this.post(recovered.id, { behavior }) : recovered;
    }
    invariant(day.status === DayStatus.READY_FOR_REVIEW || day.status === DayStatus.FAILED,
      'DAY_NOT_POSTABLE', 'Only a reviewed unposted day can be posted.', { status: day.status });
    const blocked = this.#persistEntitlementBlock(day);
    if (blocked) return blocked;
    const journal = day.journal ?? this.preview(day.id).journal;
    const idempotencyKey = makeIdempotencyKey({ ...sourceIdentity(day.source), kind: 'ORIGINAL', sourceFingerprint: day.sourceFingerprint, mappingVersion: journal.mappingVersion });

    const exact = await this.quickBooks.findByDocNumber(journal.docNumber);
    if (exact) {
      if (exact.journal.privateNote !== journal.privateNote || !journalsEquivalent(exact.journal, journal)) {
        return this.store.transition(day.id, DayStatus.POSSIBLE_DUPLICATE, {
          errorCode: 'REFERENCE_COLLISION', error: { code: 'REFERENCE_COLLISION', candidateId: exact.id },
        });
      }
      return this.#completeOriginalPost(day, DayStatus.ALREADY_POSTED, exact);
    }
    if (!day.dismissedDuplicate) {
      const equivalent = await this.quickBooks.findEquivalent(journal, { excludeDocNumber: journal.docNumber });
      if (equivalent) {
        return this.store.transition(day.id, DayStatus.POSSIBLE_DUPLICATE, {
          errorCode: 'POSSIBLE_DUPLICATE', error: { code: 'POSSIBLE_DUPLICATE', candidateId: equivalent.id },
        });
      }
    }

    const claim = this.store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL' });
    if (!claim.claimed) {
      if (['COMMITTED', 'RECOVERED'].includes(claim.attempt.outcome)) {
        const recorded = claim.attempt.qbId ? await this.quickBooks.getJournal(claim.attempt.qbId) : await this.quickBooks.findByDocNumber(journal.docNumber);
        if (recorded && recorded.journal.privateNote === journal.privateNote && journalsEquivalent(recorded.journal, journal)) {
          if (day.status !== DayStatus.OUTCOME_UNKNOWN) day = this.store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, {
            errorCode: 'OUTCOME_UNKNOWN', error: { code: 'OUTCOME_UNKNOWN', message: 'A durable write attempt is being reconciled.' },
          });
          return this.#completeOriginalPost(day, DayStatus.POSTED, recorded);
        }
      }
      if (day.status !== DayStatus.OUTCOME_UNKNOWN) day = this.store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, {
        errorCode: 'OUTCOME_UNKNOWN', error: { code: 'OUTCOME_UNKNOWN', message: 'A durable write attempt must be reconciled before retry.' },
      });
      return this.#recover(day.id);
    }

    day = this.store.transition(day.id, DayStatus.POSTING, { errorCode: null, error: null });
    try {
      const created = await this.quickBooks.createJournal(journal, { idempotencyKey, behavior });
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'COMMITTED', qbId: created.id });
      return this.#completeOriginalPost(day, DayStatus.POSTED, created);
    } catch (error) {
      if (!(error instanceof UnknownWriteOutcomeError)) {
        this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'FAILED' });
        return this.store.transition(day.id, DayStatus.FAILED, { errorCode: error.code ?? 'QUICKBOOKS_ERROR', error: toSafeError(error) });
      }
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind: 'ORIGINAL', outcome: 'UNKNOWN' });
      day = this.store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, { errorCode: error.code, error: toSafeError(error) });
      return this.#recover(day.id);
    }
  }

  async recover(dayId) {
    await this.startupRecovery;
    return this.#recover(dayId);
  }

  async #recover(dayId) {
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.OUTCOME_UNKNOWN, 'RECOVERY_NOT_REQUIRED', 'This day has no uncertain write to recover.');
    const found = await this.quickBooks.findByDocNumber(day.journal.docNumber);
    const attempt = this.store.getLatestAttempt(day.id, 'ORIGINAL', day.journal.docNumber);
    if (found && found.journal.privateNote === day.journal.privateNote && journalsEquivalent(found.journal, day.journal)) {
      if (attempt) this.store.recordAttempt({ ...attempt, outcome: 'RECOVERED', qbId: found.id });
      return this.#completeOriginalPost(day, DayStatus.POSTED, found);
    }
    if (found) {
      if (attempt) this.store.recordAttempt({ ...attempt, outcome: 'FAILED' });
      return this.store.transition(day.id, DayStatus.FAILED, { errorCode: 'REFERENCE_COLLISION', error: { code: 'REFERENCE_COLLISION', candidateId: found.id } });
    }
    if (attempt) this.store.recordAttempt({ ...attempt, outcome: 'NOT_FOUND' });
    return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { errorCode: null, error: null });
  }

  async recoverInterruptedWrites() {
    const recovered = [];
    for (let day of this.store.listDaysByStatuses([DayStatus.POSTING, DayStatus.OUTCOME_UNKNOWN, DayStatus.CORRECTING])) {
      if (day.status === DayStatus.CORRECTING) {
        recovered.push(this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, {
          errorCode: 'INTERRUPTED_CORRECTION', error: { code: 'INTERRUPTED_CORRECTION', message: 'The process stopped while a QuickBooks correction was in progress.' },
        }));
        continue;
      }
      if (day.status === DayStatus.POSTING) {
        day = this.store.transition(day.id, DayStatus.OUTCOME_UNKNOWN, {
          errorCode: 'INTERRUPTED_WRITE', error: { code: 'INTERRUPTED_WRITE', message: 'The process stopped while a QuickBooks write was in progress.' },
        });
      }
      recovered.push(await this.#recover(day.id));
    }
    return recovered;
  }

  dismissDuplicate(dayId) {
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.POSSIBLE_DUPLICATE, 'NO_POSSIBLE_DUPLICATE', 'No possible duplicate is awaiting review.');
    return this.store.transition(day.id, DayStatus.READY_FOR_REVIEW, { dismissedDuplicate: true, errorCode: null, error: null });
  }

  async adoptDuplicate(dayId, quickBooksId) {
    await this.startupRecovery;
    const day = this.#day(dayId);
    invariant(day.status === DayStatus.POSSIBLE_DUPLICATE, 'NO_POSSIBLE_DUPLICATE', 'No possible duplicate is awaiting review.');
    const found = await this.quickBooks.getJournal(quickBooksId);
    invariant(found, 'QUICKBOOKS_JOURNAL_NOT_FOUND', 'The selected QuickBooks journal no longer exists.');
    invariant(journalsEquivalent(found.journal, day.journal), 'DUPLICATE_MISMATCH', 'The selected QuickBooks journal is not accounting-equivalent to this location-day.');
    return this.store.transition(day.id, DayStatus.ALREADY_POSTED, { qbJournalId: found.id, qbSnapshot: found, errorCode: null, error: null });
  }

  async correct(dayId, { reversalBehavior, replacementBehavior } = {}) {
    await this.startupRecovery;
    let day = this.#day(dayId);
    if (day.status === DayStatus.ENTITLEMENT_BLOCKED) {
      const restored = this.#restoreEntitlementBlocked(day);
      if (restored.status === DayStatus.ENTITLEMENT_BLOCKED) return restored;
      day = restored;
    }
    invariant([DayStatus.CORRECTION_REQUIRED, DayStatus.CORRECTION_PARTIAL].includes(day.status), 'CORRECTION_NOT_REQUIRED', 'This day does not need a correction.');
    invariant(day.pendingSource, 'CORRECTION_SOURCE_REQUIRED', 'The replacement source is missing.');
    const blocked = this.#persistEntitlementBlock(day);
    if (blocked) return blocked;

    const liveOriginal = await this.quickBooks.getJournal(day.qbJournalId);
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
    const reversal = this.#buildJournal(day.source, originalMapping, { sequence: correctionVersion * 2 - 1, reverse: true, kind: 'REVERSAL' });
    const replacement = this.#buildJournal(day.pendingSource, currentMapping, { sequence: correctionVersion * 2, kind: 'REPLACEMENT' });
    if (day.status !== DayStatus.CORRECTING) day = this.store.transition(day.id, DayStatus.CORRECTING, { correctionVersion });

    let reversalRecord = day.reversalQbId ? await this.quickBooks.getJournal(day.reversalQbId) : null;
    if (day.reversalQbId && (!reversalRecord || reversalRecord.journal.privateNote !== reversal.privateNote || !journalsEquivalent(reversalRecord.journal, reversal))) {
      return this.store.transition(day.id, DayStatus.EXTERNAL_CHANGE, {
        errorCode: 'EXTERNAL_CHANGE', error: { code: 'EXTERNAL_CHANGE', correctionEntry: 'REVERSAL', deleted: !reversalRecord },
      });
    }
    if (!reversalRecord) {
      try {
        reversalRecord = await this.#writeCorrection(day, reversal, 'REVERSAL', reversalBehavior);
      } catch (error) {
        return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: error.code ?? 'QUICKBOOKS_ERROR', error: toSafeError(error) });
      }
      if (!reversalRecord) return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: 'OUTCOME_UNKNOWN' });
      day = this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { reversalQbId: reversalRecord.id, errorCode: null, error: null });
    }

    if (day.status !== DayStatus.CORRECTING) day = this.store.transition(day.id, DayStatus.CORRECTING);
    let replacementRecord = day.replacementQbId ? await this.quickBooks.getJournal(day.replacementQbId) : null;
    if (!replacementRecord) {
      try {
        replacementRecord = await this.#writeCorrection(day, replacement, 'REPLACEMENT', replacementBehavior);
      } catch (error) {
        return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: error.code ?? 'QUICKBOOKS_ERROR', error: toSafeError(error) });
      }
      if (!replacementRecord) return this.store.transition(day.id, DayStatus.CORRECTION_PARTIAL, { errorCode: 'OUTCOME_UNKNOWN' });
    }
    day = this.#day(day.id);
    const queuedSource = day.queuedSource;
    let completed = this.store.transition(day.id, DayStatus.CORRECTED, {
      source: day.pendingSource, pendingSource: null, queuedSource: null, journal: replacement, mappingVersion: currentMapping.version,
      qbJournalId: replacementRecord.id, qbSnapshot: replacementRecord, reversalQbId: reversalRecord.id,
      replacementQbId: replacementRecord.id, errorCode: null, error: null,
    });
    if (queuedSource && queuedSource.sourceFingerprint !== completed.sourceFingerprint) {
      completed = this.store.transition(day.id, DayStatus.CORRECTION_REQUIRED, {
        pendingSource: queuedSource, reversalQbId: null, replacementQbId: null,
      });
    }
    return completed;
  }

  async auditPostedDay(dayId) {
    await this.startupRecovery;
    const day = this.#day(dayId);
    invariant(POSTED.has(day.status), 'DAY_NOT_POSTED', 'Only posted days can be audited.');
    const live = await this.quickBooks.getJournal(day.qbJournalId);
    if (!live || stableStringify(live.journal) !== stableStringify(day.qbSnapshot?.journal)) {
      return this.store.transition(day.id, DayStatus.EXTERNAL_CHANGE, { errorCode: 'EXTERNAL_CHANGE', error: { code: 'EXTERNAL_CHANGE', deleted: !live } });
    }
    return day;
  }

  async #writeCorrection(day, journal, kind, behavior) {
    const idempotencyKey = makeIdempotencyKey({ ...sourceIdentity(day.source), kind, docNumber: journal.docNumber });
    const exact = await this.quickBooks.findByDocNumber(journal.docNumber);
    if (exact) {
      invariant(exact.journal.privateNote === journal.privateNote && journalsEquivalent(exact.journal, journal),
        'REFERENCE_COLLISION', 'A QuickBooks journal uses the correction reference with different accounting content.');
      return exact;
    }
    const claim = this.store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind });
    if (!claim.claimed) {
      if (['COMMITTED', 'RECOVERED'].includes(claim.attempt.outcome) && claim.attempt.qbId) {
        const recorded = await this.quickBooks.getJournal(claim.attempt.qbId);
        if (recorded) {
          invariant(recorded.journal.privateNote === journal.privateNote && journalsEquivalent(recorded.journal, journal),
            'REFERENCE_COLLISION', 'Recorded QuickBooks correction differs from the expected journal.');
          return recorded;
        }
      }
      this.store.recordAttempt({ ...claim.attempt, outcome: 'NOT_FOUND' });
      const retry = this.store.claimAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind });
      invariant(retry.claimed, 'ATTEMPT_CLAIM_FAILED', 'A reconciled correction attempt could not be reclaimed.');
    }
    try {
      const record = await this.quickBooks.createJournal(journal, { idempotencyKey, behavior });
      this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind, outcome: 'COMMITTED', qbId: record.id });
      return record;
    } catch (error) {
      if (!(error instanceof UnknownWriteOutcomeError)) {
        this.store.recordAttempt({ dayId: day.id, idempotencyKey, docNumber: journal.docNumber, kind, outcome: 'FAILED' });
        throw error;
      }
      const recovered = await this.quickBooks.findByDocNumber(journal.docNumber);
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

  #entitlementResult(workspaceId, locationId) {
    const location = this.store.getLocation(locationId);
    invariant(location?.active, 'LOCATION_INACTIVE', 'Posting is unavailable because the location is inactive.');
    invariant(!location.postingPaused, 'POSTING_PAUSED', 'Posting is unavailable because this location is paused.');
    const entitlement = this.store.getEntitlement(workspaceId);
    invariant(entitlement, 'ENTITLEMENT_REQUIRED', 'Workspace entitlement is missing.');
    return evaluateEntitlement(entitlement, this.clock());
  }

  #persistEntitlementBlock(day) {
    const result = this.#entitlementResult(day.workspaceId, day.locationId);
    if (result.canPost) return null;
    return this.store.transition(day.id, DayStatus.ENTITLEMENT_BLOCKED, {
      blockedFromStatus: day.status,
      errorCode: 'ENTITLEMENT_BLOCKED',
      error: { code: 'ENTITLEMENT_BLOCKED', message: 'Posting is not permitted by the current entitlement.', details: { reason: result.reason, effectiveStatus: result.effectiveStatus } },
    });
  }

  #restoreEntitlementBlocked(day) {
    const result = this.#entitlementResult(day.workspaceId, day.locationId);
    if (!result.canPost) return day;
    const target = day.blockedFromStatus ?? DayStatus.READY_FOR_REVIEW;
    return this.store.transition(day.id, target, { blockedFromStatus: null, errorCode: null, error: null });
  }

  #completeOriginalPost(day, status, record) {
    let completed = this.store.transition(day.id, status, {
      qbJournalId: record.id, qbSnapshot: record, errorCode: null, error: null,
    });
    if (completed.queuedSource && completed.queuedSource.sourceFingerprint !== completed.sourceFingerprint) {
      completed = this.store.transition(completed.id, DayStatus.CORRECTION_REQUIRED, {
        pendingSource: completed.queuedSource, queuedSource: null, reversalQbId: null, replacementQbId: null,
      });
    } else if (completed.queuedSource) {
      completed = this.store.transition(completed.id, completed.status, { queuedSource: null });
    }
    return completed;
  }

  #buildJournal(source, mapping, options = {}) {
    const location = this.store.getLocation(source.locationId);
    return buildJournal(source, mapping, { ...options, departmentRef: location?.departmentRef || null });
  }

  #day(dayId) {
    const day = this.store.getDay(dayId);
    invariant(day, 'DAY_NOT_FOUND', 'Sync day not found.', { dayId });
    return day;
  }
}
