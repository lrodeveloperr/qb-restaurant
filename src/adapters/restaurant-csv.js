import { sha256, stableStringify } from '../domain/canonical.js';
import { invariant } from '../domain/errors.js';
import { normalizeSource } from '../domain/normalize.js';
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsvRows } from './csv.js';

export const CsvPolarity = Object.freeze({
  NON_NEGATIVE: 'NON_NEGATIVE',
  NON_POSITIVE_TO_MAGNITUDE: 'NON_POSITIVE_TO_MAGNITUDE',
});

const POLARITIES = new Set(Object.values(CsvPolarity));
const DATE_FORMATS = new Set(['YYYY-MM-DD', 'M/D/YYYY', 'MM/DD/YYYY']);

function requiredText(value, field) {
  invariant(typeof value === 'string' && value.trim(), 'INVALID_CSV_PROFILE', `${field} is required.`, { field });
  return value.trim();
}

function parseDate(value, format) {
  const text = String(value).trim();
  if (format === 'YYYY-MM-DD') return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  invariant(match, 'INVALID_CSV_DATE', `Date must match ${format}.`, { value: text, format });
  if (format === 'MM/DD/YYYY') {
    invariant(match[1].length === 2 && match[2].length === 2, 'INVALID_CSV_DATE', 'Date must use two-digit month and day.', { value: text });
  }
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function parseMoney(value, profile, column) {
  let text = String(value).trim();
  invariant(text, 'INVALID_CSV_MONEY', 'A mapped amount cannot be blank.', { column });
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  for (const symbol of profile.currencySymbols ?? ['$']) text = text.replaceAll(symbol, '');
  if (profile.thousandsSeparator) text = text.replaceAll(profile.thousandsSeparator, '');
  const decimalSeparator = profile.decimalSeparator ?? '.';
  if (decimalSeparator !== '.') text = text.replace(decimalSeparator, '.');
  text = text.trim();
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) text = text.slice(1);
  invariant(/^\d+(?:\.\d{1,2})?$/.test(text), 'INVALID_CSV_MONEY', 'Amounts must contain at most two decimal places.', { column, value });
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  invariant(Number.isSafeInteger(cents), 'INVALID_CSV_MONEY', 'Amount exceeds the safe integer range.', { column, value });
  return negative ? -cents : cents;
}

function normalizeAmount(rawCents, polarity, column) {
  invariant(POLARITIES.has(polarity), 'INVALID_CSV_PROFILE', 'Every category column needs an explicit polarity.', { column, polarity });
  if (polarity === CsvPolarity.NON_NEGATIVE) {
    invariant(rawCents >= 0, 'UNEXPECTED_CSV_SIGN', 'This amount must be zero or positive.', { column, rawCents });
    return rawCents;
  }
  if (polarity === CsvPolarity.NON_POSITIVE_TO_MAGNITUDE) {
    invariant(rawCents <= 0, 'UNEXPECTED_CSV_SIGN', 'This amount must be zero or negative.', { column, rawCents });
    return Math.abs(rawCents);
  }
  invariant(false, 'INVALID_CSV_PROFILE', 'Unsupported amount polarity.', { column, polarity });
}

function validateProfile(profile) {
  invariant(profile && typeof profile === 'object' && !Array.isArray(profile), 'INVALID_CSV_PROFILE', 'A saved CSV profile is required.');
  invariant(profile.schemaVersion === 1, 'INVALID_CSV_PROFILE', 'Only CSV profile schema version 1 is supported.');
  invariant(profile.format === 'WIDE_DAILY_SUMMARY', 'INVALID_CSV_PROFILE', 'Only WIDE_DAILY_SUMMARY is supported at launch.');
  invariant(DATE_FORMATS.has(profile.dateFormat), 'INVALID_CSV_PROFILE', 'Unsupported date format.', { dateFormat: profile.dateFormat });
  requiredText(profile.dateColumn, 'dateColumn');
  invariant(profile.categoryColumns && typeof profile.categoryColumns === 'object' && !Array.isArray(profile.categoryColumns),
    'INVALID_CSV_PROFILE', 'categoryColumns is required.');
  const categories = new Set();
  for (const [column, rule] of Object.entries(profile.categoryColumns)) {
    requiredText(column, 'category column');
    invariant(rule && typeof rule === 'object', 'INVALID_CSV_PROFILE', 'Every category column needs a rule.', { column });
    requiredText(rule.category, 'category');
    invariant(!categories.has(rule.category), 'INVALID_CSV_PROFILE', 'A canonical category may be mapped only once.', { category: rule.category });
    categories.add(rule.category);
    invariant(POLARITIES.has(rule.polarity), 'INVALID_CSV_PROFILE', 'Every category column needs an explicit polarity.', { column });
  }
  return profile;
}

function assertHeader(actual, profile) {
  const expected = profile.expectedHeaders ?? [
    profile.dateColumn,
    ...(profile.locationColumn ? [profile.locationColumn] : []),
    ...Object.keys(profile.categoryColumns),
    ...(profile.ignoredColumns ?? []),
  ];
  invariant(new Set(actual).size === actual.length, 'INVALID_CSV_HEADER', 'CSV headers must be unique.', { actual });
  invariant(actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    'INVALID_CSV_HEADER', 'CSV headers changed from the approved import profile.', { expected, actual });
}

export function importRestaurantCsv(input, rawProfile, context) {
  invariant(typeof input === 'string' || Buffer.isBuffer(input), 'INVALID_CSV', 'CSV input must be a UTF-8 string or buffer.');
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  invariant(buffer.byteLength <= MAX_CSV_BYTES, 'CSV_TOO_LARGE', 'CSV files cannot exceed 10 MiB.', { bytes: buffer.byteLength });
  const profile = validateProfile(rawProfile);
  invariant(context && typeof context === 'object' && !Array.isArray(context), 'INVALID_CSV_CONTEXT', 'Import context is required.');
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = parseCsvRows(text);
  invariant(parsed.length >= 2, 'EMPTY_CSV', 'CSV must include a header and at least one data row.');
  invariant(parsed.length - 1 <= MAX_CSV_ROWS, 'CSV_TOO_MANY_ROWS', 'CSV files cannot exceed 100,000 data rows.', { rows: parsed.length - 1 });
  const header = parsed[0];
  assertHeader(header, profile);
  const indexes = new Map(header.map((column, index) => [column, index]));
  const seenDates = new Set();
  const sources = [];

  for (let rowIndex = 1; rowIndex < parsed.length; rowIndex += 1) {
    const row = parsed[rowIndex];
    if (row.length === 1 && row[0] === '') continue;
    invariant(row.length === header.length, 'MALFORMED_CSV', 'Every data row must match the saved header.', { row: rowIndex + 1, fields: row.length });
    if (profile.locationColumn) {
      invariant(row[indexes.get(profile.locationColumn)].trim() === String(context.sourceLocationLabel).trim(),
        'CSV_LOCATION_MISMATCH', 'CSV location does not match the selected restaurant location.', { row: rowIndex + 1 });
    }
    const businessDate = parseDate(row[indexes.get(profile.dateColumn)], profile.dateFormat);
    invariant(!seenDates.has(businessDate), 'DUPLICATE_BUSINESS_DATE', 'A CSV import may contain only one row per business date.', { businessDate });
    seenDates.add(businessDate);
    const categories = {};
    for (const [column, rule] of Object.entries(profile.categoryColumns)) {
      const rawCents = parseMoney(row[indexes.get(column)], profile, column);
      categories[rule.category] = normalizeAmount(rawCents, rule.polarity, column);
    }
    const rowHash = sha256(stableStringify({
      parserProfile: profile,
      businessDate,
      sourceLocationLabel: profile.locationColumn ? row[indexes.get(profile.locationColumn)].trim() : context.sourceLocationLabel,
      categories,
    }));
    sources.push(normalizeSource({
      schemaVersion: 1,
      workspaceId: context.workspaceId,
      realmId: context.realmId,
      restaurantId: context.restaurantId,
      locationId: context.locationId,
      businessDate,
      timezone: context.timezone,
      country: context.country,
      currency: context.currency,
      sourceVersion: `csv-${rowHash.slice(0, 24)}`,
      categories,
    }));
  }
  invariant(sources.length > 0, 'EMPTY_CSV', 'CSV contains no importable daily rows.');
  return Object.freeze(sources);
}
