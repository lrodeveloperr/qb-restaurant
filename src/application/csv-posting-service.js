import { importRestaurantCsv } from '../adapters/restaurant-csv.js';
import { invariant } from '../domain/errors.js';
import { DayStatus } from '../domain/state-machine.js';

function reviewRecord(day) {
  return Object.freeze({
    dayId: day.id,
    locationId: day.locationId,
    businessDate: day.businessDate,
    status: day.status,
    sourceFingerprint: day.sourceFingerprint,
    accountingFingerprint: day.journal?.accountingFingerprint ?? null,
    debitCents: day.journal?.totals?.debitCents ?? null,
    creditCents: day.journal?.totals?.creditCents ?? null,
    errorCode: day.errorCode ?? null,
  });
}

export class CsvPostingService {
  constructor({ engine, store }) {
    invariant(engine && store, 'APPLICATION_CONFIG_REQUIRED', 'The posting engine and store are required.');
    this.engine = engine;
    this.store = store;
  }

  importForReview(input, profile, context) {
    const sources = importRestaurantCsv(input, profile, context);
    const records = sources.map((source) => reviewRecord(this.engine.ingest(source)));
    return Object.freeze({
      locationId: context.locationId,
      importedCount: records.length,
      reviewableCount: records.filter((record) => record.status === DayStatus.READY_FOR_REVIEW).length,
      blockedCount: records.filter((record) => record.status !== DayStatus.READY_FOR_REVIEW).length,
      days: Object.freeze(records),
    });
  }

  async postReviewed(confirmations) {
    invariant(Array.isArray(confirmations) && confirmations.length > 0,
      'POST_CONFIRMATION_REQUIRED', 'At least one reviewed day confirmation is required.');
    const verified = confirmations.map((confirmation) => {
      const day = this.store.getDay(confirmation.dayId);
      invariant(day, 'DAY_NOT_FOUND', 'Reviewed day not found.', { dayId: confirmation.dayId });
      invariant(day.status === DayStatus.READY_FOR_REVIEW || day.status === DayStatus.FAILED,
        'DAY_NOT_POSTABLE', 'Only a reviewed unposted day can be confirmed.', { dayId: day.id, status: day.status });
      invariant(confirmation.sourceFingerprint === day.sourceFingerprint
        && confirmation.accountingFingerprint === day.journal?.accountingFingerprint,
      'STALE_POST_CONFIRMATION', 'The source or journal changed after review.', { dayId: day.id });
      return day;
    }).sort((left, right) => left.businessDate.localeCompare(right.businessDate) || left.id.localeCompare(right.id));

    const results = [];
    for (const day of verified) results.push(reviewRecord(await this.engine.post(day.id)));
    return Object.freeze(results);
  }
}
