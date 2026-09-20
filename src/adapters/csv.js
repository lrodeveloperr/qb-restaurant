import { AppError, invariant } from '../domain/errors.js';
import { normalizeSource } from '../domain/normalize.js';

export const CSV_HEADER = Object.freeze([
  'schema_version', 'workspace_id', 'realm_id', 'restaurant_id', 'location_id', 'business_date',
  'timezone', 'country', 'currency', 'source_version', 'category', 'amount_cents',
]);
export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 100_000;

function rows(text) {
  const output = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      }
      else cell += character;
    } else if (quoteClosed) {
      if (character === ',') {
        row.push(cell);
        cell = '';
        quoteClosed = false;
      } else if (character === '\n') {
        row.push(cell);
        output.push(row);
        row = [];
        cell = '';
        quoteClosed = false;
      } else if (character === '\r' && (text[index + 1] === '\n' || index + 1 === text.length)) {
        // CR in CRLF is consumed by the following LF; terminal CR is accepted.
      } else {
        invariant(false, 'MALFORMED_CSV', 'Only a delimiter or line ending may follow a closing quote.', { index });
      }
    } else if (character === '"' && cell === '') quoted = true;
    else if (character === '"') invariant(false, 'MALFORMED_CSV', 'A quote inside an unquoted field must be escaped.', { index });
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      output.push(row);
      row = [];
      cell = '';
    } else if (character === '\r') {
      invariant(text[index + 1] === '\n' || index + 1 === text.length, 'MALFORMED_CSV', 'A carriage return must be followed by a line feed.', { index });
    } else cell += character;
  }
  invariant(!quoted, 'MALFORMED_CSV', 'CSV contains an unterminated quoted field.');
  if (cell || row.length) {
    row.push(cell);
    output.push(row);
  }
  return output;
}

function decodeFormulaSafe(value) {
  if (value.startsWith("''")) return value.slice(1);
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function csvCell(value, { formulaSafe = false } = {}) {
  let text = String(value);
  if (formulaSafe && text.startsWith("'")) text = `'${text}`;
  else if (formulaSafe && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function parseCsvSource(input) {
  invariant(typeof input === 'string' || Buffer.isBuffer(input), 'INVALID_CSV', 'CSV input must be a UTF-8 string or buffer.');
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  invariant(buffer.byteLength <= MAX_CSV_BYTES, 'CSV_TOO_LARGE', 'CSV files cannot exceed 10 MiB.', { bytes: buffer.byteLength });
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = rows(text);
  invariant(parsed.length >= 2, 'EMPTY_CSV', 'CSV must include a header and at least one data row.');
  invariant(parsed.length - 1 <= MAX_CSV_ROWS, 'CSV_TOO_MANY_ROWS', 'CSV files cannot exceed 100,000 data rows.', { rows: parsed.length - 1 });
  invariant(parsed[0].join(',') === CSV_HEADER.join(','), 'INVALID_CSV_HEADER', 'CSV header does not match schema version 1.', { expected: CSV_HEADER, actual: parsed[0] });

  const base = {};
  const categories = {};
  const baseColumns = CSV_HEADER.slice(0, 10);
  for (let rowIndex = 1; rowIndex < parsed.length; rowIndex += 1) {
    const values = parsed[rowIndex];
    invariant(values.length === CSV_HEADER.length, 'MALFORMED_CSV', 'Every CSV row must have exactly 12 fields.', { row: rowIndex + 1, fields: values.length });
    const record = Object.fromEntries(CSV_HEADER.map((key, index) => [key, index < 11 ? decodeFormulaSafe(values[index]) : values[index]]));
    for (const field of baseColumns) {
      if (rowIndex === 1) base[field] = record[field];
      else invariant(base[field] === record[field], 'MIXED_CSV_IDENTITY', 'A CSV upload may contain only one location-day.', { row: rowIndex + 1, field });
    }
    invariant(!(record.category in categories), 'DUPLICATE_CATEGORY', 'A CSV category may appear only once.', { row: rowIndex + 1, category: record.category });
    invariant(/^\d+$/.test(record.amount_cents), 'INVALID_MONEY', 'amount_cents must be a non-negative integer.', { row: rowIndex + 1 });
    const amount = Number(record.amount_cents);
    invariant(Number.isSafeInteger(amount), 'INVALID_MONEY', 'amount_cents exceeds the safe integer range.', { row: rowIndex + 1 });
    categories[record.category] = amount;
  }

  try {
    return normalizeSource({
      schemaVersion: Number(base.schema_version), workspaceId: base.workspace_id, realmId: base.realm_id,
      restaurantId: base.restaurant_id, locationId: base.location_id, businessDate: base.business_date,
      timezone: base.timezone, country: base.country, currency: base.currency,
      sourceVersion: base.source_version, categories,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_CSV', 'CSV could not be normalized.', {}, error);
  }
}

export function toCsvSource(source) {
  const common = [1, source.workspaceId, source.realmId, source.restaurantId, source.locationId,
    source.businessDate, source.timezone, source.country, source.currency, source.sourceVersion];
  const data = Object.entries(source.categories).map(([category, amount]) => [...common, category, amount]
    .map((value, index) => csvCell(value, { formulaSafe: index < 11 })).join(','));
  return `${CSV_HEADER.join(',')}\n${data.join('\n')}\n`;
}
