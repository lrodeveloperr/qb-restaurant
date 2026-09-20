import { deepFreeze, sha256, stableStringify } from './canonical.js';
import { invariant } from './errors.js';

const PAIRS = new Set(['US/USD', 'CA/CAD']);
const CATEGORY = /^[a-z][a-z0-9_]{0,63}$/;

function plainObject(value, field) {
  invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype,
    'INVALID_SOURCE', `${field} must be a plain object.`, { field });
}

function requiredString(value, field) {
  invariant(typeof value === 'string' && value.trim() && value.length <= 200,
    'INVALID_SOURCE', `${field} must be a non-empty string no longer than 200 characters.`, { field });
  return value.trim();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeSource(input) {
  plainObject(input, 'source');
  invariant(input.schemaVersion === 1, 'UNSUPPORTED_SCHEMA_VERSION', 'Only canonical source schema version 1 is supported.');

  const source = {
    schemaVersion: 1,
    workspaceId: requiredString(input.workspaceId, 'workspaceId'),
    realmId: requiredString(input.realmId, 'realmId'),
    restaurantId: requiredString(input.restaurantId, 'restaurantId'),
    locationId: requiredString(input.locationId, 'locationId'),
    businessDate: requiredString(input.businessDate, 'businessDate'),
    timezone: requiredString(input.timezone, 'timezone'),
    country: requiredString(input.country, 'country').toUpperCase(),
    currency: requiredString(input.currency, 'currency').toUpperCase(),
    sourceVersion: requiredString(input.sourceVersion, 'sourceVersion'),
    categories: {},
  };

  invariant(validDate(source.businessDate), 'INVALID_BUSINESS_DATE', 'businessDate must be a real YYYY-MM-DD date.');
  invariant(validTimeZone(source.timezone), 'INVALID_TIMEZONE', 'timezone must be an IANA time zone.', { timezone: source.timezone });
  invariant(PAIRS.has(`${source.country}/${source.currency}`), 'UNSUPPORTED_COUNTRY_CURRENCY',
    'Only US/USD and CA/CAD are supported.', { country: source.country, currency: source.currency });
  plainObject(input.categories, 'categories');

  for (const key of Object.keys(input.categories).sort()) {
    const amount = input.categories[key];
    invariant(CATEGORY.test(key), 'INVALID_CATEGORY', 'Category keys must use lower_snake_case.', { category: key });
    invariant(Number.isSafeInteger(amount) && amount >= 0, 'INVALID_MONEY', 'Category values must be non-negative safe integer cents.', { category: key, amount });
    source.categories[key] = amount;
  }
  invariant(Object.values(source.categories).some((amount) => amount > 0), 'EMPTY_SOURCE', 'At least one category must be non-zero.');

  const fingerprintMaterial = {
    schemaVersion: source.schemaVersion,
    realmId: source.realmId,
    restaurantId: source.restaurantId,
    locationId: source.locationId,
    businessDate: source.businessDate,
    timezone: source.timezone,
    country: source.country,
    currency: source.currency,
    sourceVersion: source.sourceVersion,
    categories: source.categories,
  };
  return deepFreeze({ ...source, sourceFingerprint: sha256(stableStringify(fingerprintMaterial)) });
}

export function sourceIdentity(source) {
  return Object.freeze({
    realmId: source.realmId,
    locationId: source.locationId,
    businessDate: source.businessDate,
  });
}
