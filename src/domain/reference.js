import { sha256 } from './canonical.js';
import { invariant } from './errors.js';

export function makeScopeHash(realmId, locationId) {
  invariant(realmId && locationId, 'REFERENCE_SCOPE_REQUIRED', 'Realm and location are required.');
  return sha256(`${realmId}|${locationId}`).slice(0, 8).toUpperCase();
}

export function makeDocNumber({ realmId, locationId, businessDate, sequence = 0 }) {
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(businessDate), 'INVALID_BUSINESS_DATE', 'Business date must use YYYY-MM-DD.');
  invariant(Number.isInteger(sequence) && sequence >= 0 && sequence <= 99, 'INVALID_SEQUENCE', 'Sequence must be an integer from 0 to 99.');
  const compactDate = businessDate.replaceAll('-', '');
  const docNumber = `RSQ${makeScopeHash(realmId, locationId)}${compactDate}${String(sequence).padStart(2, '0')}`;
  invariant(docNumber.length <= 21, 'REFERENCE_TOO_LONG', 'QuickBooks reference exceeds 21 characters.', { docNumber });
  return docNumber;
}

export function makePrivateNote({ workspaceId, realmId, locationId, businessDate, sequence = 0 }) {
  return `RSQ|${workspaceId}|${realmId}|${locationId}|${businessDate}|${sequence}`;
}

export function makeIdempotencyKey(identity) {
  return `rsq_${sha256(JSON.stringify(identity)).slice(0, 40)}`;
}
