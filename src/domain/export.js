import { stableStringify } from './canonical.js';

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportDaysJson(days) {
  return `${stableStringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), days })}\n`;
}

export function exportDaysCsv(days) {
  const columns = ['workspace_id', 'realm_id', 'location_id', 'business_date', 'status', 'currency', 'debit_cents', 'credit_cents', 'quickbooks_journal_id', 'error_code'];
  const rows = days.map((day) => [
    day.workspaceId, day.realmId, day.locationId, day.businessDate, day.status,
    day.source?.currency, day.journal?.totals?.debitCents, day.journal?.totals?.creditCents,
    day.qbJournalId, day.errorCode,
  ].map(csvCell).join(','));
  return `${columns.join(',')}\n${rows.join('\n')}\n`;
}
