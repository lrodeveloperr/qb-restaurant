import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CsvPostingService } from '../src/application/csv-posting-service.js';
import { fixture, setup } from './helpers.js';

function context() {
  return {
    workspaceId: 'ws-us', realmId: 'realm-us', restaurantId: 'restaurant-us', locationId: 'location-us',
    sourceLocationLabel: 'WorksBien Test Restaurant', timezone: 'America/New_York', country: 'US', currency: 'USD',
  };
}

test('T-CSV-WORKFLOW: import requires an exact reviewed snapshot before posting', async () => {
  const { engine, store, quickBooks } = setup();
  const service = new CsvPostingService({ engine, store });
  const review = service.importForReview(
    readFileSync(join(process.cwd(), 'fixtures', 'toast-summary-us.csv')),
    fixture('toast-summary-profile-us.json'),
    context(),
  );
  assert.equal(review.importedCount, 1);
  assert.equal(review.reviewableCount, 1);
  assert.equal(quickBooks.writeCount, 0);
  await assert.rejects(() => service.postReviewed([{ ...review.days[0], sourceFingerprint: 'stale' }]), { code: 'STALE_POST_CONFIRMATION' });
  const [posted] = await service.postReviewed(review.days);
  assert.equal(posted.status, 'POSTED');
  assert.equal(quickBooks.writeCount, 1);
  store.close();
});
