import { AppError } from './errors.js';

export const DayStatus = Object.freeze({
  WAITING: 'WAITING',
  SOURCE_MISSING: 'SOURCE_MISSING',
  NEEDS_MAPPING: 'NEEDS_MAPPING',
  INVALID_SOURCE: 'INVALID_SOURCE',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  POSTING: 'POSTING',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  POSTED: 'POSTED',
  ALREADY_POSTED: 'ALREADY_POSTED',
  FAILED: 'FAILED',
  CORRECTION_REQUIRED: 'CORRECTION_REQUIRED',
  CORRECTING: 'CORRECTING',
  CORRECTION_PARTIAL: 'CORRECTION_PARTIAL',
  CORRECTED: 'CORRECTED',
  EXTERNAL_CHANGE: 'EXTERNAL_CHANGE',
  PAUSED: 'PAUSED',
  ENTITLEMENT_BLOCKED: 'ENTITLEMENT_BLOCKED',
});

const all = Object.values(DayStatus);
const transitions = new Map([
  [null, new Set([DayStatus.WAITING, DayStatus.INVALID_SOURCE, DayStatus.NEEDS_MAPPING, DayStatus.READY_FOR_REVIEW, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.WAITING, new Set([DayStatus.SOURCE_MISSING, DayStatus.INVALID_SOURCE, DayStatus.NEEDS_MAPPING, DayStatus.READY_FOR_REVIEW, DayStatus.PAUSED])],
  [DayStatus.SOURCE_MISSING, new Set([DayStatus.SOURCE_MISSING, DayStatus.INVALID_SOURCE, DayStatus.NEEDS_MAPPING, DayStatus.READY_FOR_REVIEW, DayStatus.PAUSED])],
  [DayStatus.INVALID_SOURCE, new Set([DayStatus.INVALID_SOURCE, DayStatus.NEEDS_MAPPING, DayStatus.READY_FOR_REVIEW])],
  [DayStatus.NEEDS_MAPPING, new Set([DayStatus.NEEDS_MAPPING, DayStatus.READY_FOR_REVIEW, DayStatus.INVALID_SOURCE])],
  [DayStatus.READY_FOR_REVIEW, new Set([DayStatus.READY_FOR_REVIEW, DayStatus.POSTING, DayStatus.OUTCOME_UNKNOWN, DayStatus.NEEDS_MAPPING, DayStatus.INVALID_SOURCE, DayStatus.POSSIBLE_DUPLICATE, DayStatus.PAUSED, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.POSSIBLE_DUPLICATE, new Set([DayStatus.ALREADY_POSTED, DayStatus.READY_FOR_REVIEW, DayStatus.NEEDS_MAPPING, DayStatus.INVALID_SOURCE])],
  [DayStatus.POSTING, new Set([DayStatus.POSTING, DayStatus.POSTED, DayStatus.ALREADY_POSTED, DayStatus.OUTCOME_UNKNOWN, DayStatus.FAILED])],
  [DayStatus.OUTCOME_UNKNOWN, new Set([DayStatus.OUTCOME_UNKNOWN, DayStatus.POSTED, DayStatus.READY_FOR_REVIEW, DayStatus.FAILED, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.FAILED, new Set([DayStatus.READY_FOR_REVIEW, DayStatus.POSTING, DayStatus.OUTCOME_UNKNOWN, DayStatus.NEEDS_MAPPING, DayStatus.INVALID_SOURCE, DayStatus.PAUSED, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.POSTED, new Set([DayStatus.POSTED, DayStatus.CORRECTION_REQUIRED, DayStatus.EXTERNAL_CHANGE])],
  [DayStatus.ALREADY_POSTED, new Set([DayStatus.ALREADY_POSTED, DayStatus.CORRECTION_REQUIRED, DayStatus.EXTERNAL_CHANGE])],
  [DayStatus.CORRECTION_REQUIRED, new Set([DayStatus.CORRECTION_REQUIRED, DayStatus.CORRECTING, DayStatus.EXTERNAL_CHANGE, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.CORRECTING, new Set([DayStatus.CORRECTING, DayStatus.CORRECTED, DayStatus.CORRECTION_PARTIAL, DayStatus.OUTCOME_UNKNOWN, DayStatus.EXTERNAL_CHANGE])],
  [DayStatus.CORRECTION_PARTIAL, new Set([DayStatus.CORRECTION_PARTIAL, DayStatus.CORRECTING, DayStatus.CORRECTED, DayStatus.EXTERNAL_CHANGE, DayStatus.ENTITLEMENT_BLOCKED])],
  [DayStatus.CORRECTED, new Set([DayStatus.CORRECTED, DayStatus.CORRECTION_REQUIRED, DayStatus.EXTERNAL_CHANGE])],
  [DayStatus.EXTERNAL_CHANGE, new Set([DayStatus.EXTERNAL_CHANGE])],
  [DayStatus.PAUSED, new Set([DayStatus.READY_FOR_REVIEW, DayStatus.NEEDS_MAPPING, DayStatus.INVALID_SOURCE, DayStatus.WAITING, DayStatus.PAUSED])],
  [DayStatus.ENTITLEMENT_BLOCKED, new Set([DayStatus.READY_FOR_REVIEW, DayStatus.FAILED, DayStatus.CORRECTION_REQUIRED, DayStatus.CORRECTION_PARTIAL, DayStatus.POSTING, DayStatus.OUTCOME_UNKNOWN, DayStatus.ENTITLEMENT_BLOCKED])],
]);

export function isDayStatus(value) {
  return all.includes(value);
}

export function assertTransition(from, to) {
  if (!isDayStatus(to) || !transitions.get(from)?.has(to)) {
    throw new AppError('ILLEGAL_STATE_TRANSITION', `Cannot transition from ${from ?? 'NEW'} to ${to}.`, { from, to });
  }
  return to;
}

export function allowedTransitions(from) {
  return [...(transitions.get(from) ?? [])];
}
