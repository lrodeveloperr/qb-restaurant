import { invariant } from '../domain/errors.js';

export const EntitlementStatus = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  TRIAL: 'TRIAL',
  PAID: 'PAID',
  PAYMENT_GRACE: 'PAYMENT_GRACE',
  EXPIRED: 'EXPIRED',
});

const DAY_MS = 86_400_000;

function instant(value, field) {
  const date = new Date(value);
  invariant(Number.isFinite(date.getTime()), 'INVALID_INSTANT', `${field} must be an ISO timestamp.`, { field, value });
  return date;
}

export function startTrial(entitlement, activatedAt) {
  invariant(entitlement.status === EntitlementStatus.NOT_STARTED, 'TRIAL_ALREADY_USED', 'The workspace trial has already started or been used.');
  const started = instant(activatedAt, 'activatedAt');
  return {
    ...entitlement,
    status: EntitlementStatus.TRIAL,
    trialStartedAt: started.toISOString(),
    trialEndsAt: new Date(started.getTime() + 14 * DAY_MS).toISOString(),
  };
}

export function evaluateEntitlement(entitlement, nowValue = new Date().toISOString()) {
  const now = instant(nowValue, 'now');
  if (entitlement.syncPaused) return { canPost: false, reason: 'SYNC_PAUSED', effectiveStatus: entitlement.status };

  switch (entitlement.status) {
    case EntitlementStatus.PAID:
      return { canPost: true, reason: null, effectiveStatus: EntitlementStatus.PAID };
    case EntitlementStatus.TRIAL: {
      const ends = instant(entitlement.trialEndsAt, 'trialEndsAt');
      return now < ends
        ? { canPost: true, reason: null, effectiveStatus: EntitlementStatus.TRIAL }
        : { canPost: false, reason: 'TRIAL_EXPIRED', effectiveStatus: EntitlementStatus.EXPIRED };
    }
    case EntitlementStatus.PAYMENT_GRACE: {
      const failedAt = instant(entitlement.paymentFailedAt, 'paymentFailedAt');
      const graceEnds = new Date(failedAt.getTime() + 7 * DAY_MS);
      return now < graceEnds
        ? { canPost: true, reason: null, effectiveStatus: EntitlementStatus.PAYMENT_GRACE }
        : { canPost: false, reason: 'PAYMENT_GRACE_EXPIRED', effectiveStatus: EntitlementStatus.EXPIRED };
    }
    case EntitlementStatus.NOT_STARTED:
      return { canPost: false, reason: 'TRIAL_NOT_STARTED', effectiveStatus: EntitlementStatus.NOT_STARTED };
    default:
      return { canPost: false, reason: 'SUBSCRIPTION_EXPIRED', effectiveStatus: EntitlementStatus.EXPIRED };
  }
}

export function pauseSync(entitlement, paused = true) {
  return { ...entitlement, syncPaused: Boolean(paused) };
}
