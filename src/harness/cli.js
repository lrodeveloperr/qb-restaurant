#!/usr/bin/env node
import { WriteBehavior } from '../adapters/fake-quickbooks.js';
import { buildJournal } from '../domain/journal.js';
import { normalizeSource } from '../domain/normalize.js';
import { translate } from '../i18n/index.js';
import { createHarness, loadFixture } from './environment.js';

let localeOverride = null;
const scenarios = {
  'normal-us': () => {
    const context = createHarness();
    const day = context.engine.ingest(context.source);
    const posted = context.engine.post(day.id);
    return result('normal-us', context, posted, 'en-US');
  },
  'normal-ca-fr': () => {
    const context = createHarness({ market: 'CA' });
    const day = context.engine.ingest(context.source);
    const posted = context.engine.post(day.id);
    return result('normal-ca-fr', context, posted, 'fr-CA');
  },
  unmapped: () => {
    const context = createHarness();
    const source = { ...context.source, categories: { ...context.source.categories, delivery_fee: 100, card: context.source.categories.card + 100 } };
    const day = context.engine.ingest(source);
    return result('unmapped', context, day, 'en-US');
  },
  'timeout-after-commit': () => {
    const context = createHarness();
    const day = context.engine.ingest(context.source);
    const posted = context.engine.post(day.id, { behavior: WriteBehavior.TIMEOUT_AFTER_COMMIT });
    return result('timeout-after-commit', context, posted, 'en-US');
  },
  duplicate: () => {
    const context = createHarness();
    const day = context.engine.ingest(context.source);
    const journal = structuredClone(buildJournal(normalizeSource(context.source), context.mapping));
    journal.docNumber = 'MANUAL-IMPORT';
    context.quickBooks.seedJournal(journal);
    const blocked = context.engine.post(day.id);
    return result('duplicate', context, blocked, 'en-US');
  },
  correction: () => {
    const context = createHarness();
    const day = context.engine.ingest(context.source);
    context.engine.post(day.id);
    context.engine.ingest(loadFixture('us-day-changed.json'));
    const corrected = context.engine.correct(day.id);
    return result('correction', context, corrected, 'en-US');
  },
  'external-edit': () => {
    const context = createHarness();
    const day = context.engine.ingest(context.source);
    const posted = context.engine.post(day.id);
    context.quickBooks.mutateJournal(posted.qbJournalId, (journal) => ({ ...journal, privateNote: 'manual edit' }));
    context.engine.ingest(loadFixture('us-day-changed.json'));
    const blocked = context.engine.correct(day.id);
    return result('external-edit', context, blocked, 'en-US');
  },
  'trial-expired': () => {
    const context = createHarness({ entitlement: { status: 'TRIAL', trialStartedAt: '2026-09-01T00:00:00.000Z', trialEndsAt: '2026-09-15T00:00:00.000Z', syncPaused: false } });
    const day = context.engine.ingest(context.source);
    const blocked = context.engine.post(day.id);
    return { scenario: 'trial-expired', status: blocked.status, error: blocked.error, externalWrites: context.quickBooks.writeCount };
  },
  'locale-switch': () => {
    const context = createHarness({ market: 'CA' });
    const day = context.engine.ingest(context.source);
    const before = JSON.stringify(day.journal);
    const messages = ['en-CA', 'fr-CA', 'es-US'].map((locale) => ({ locale, message: translate(locale, 'summary.posted', { date: day.businessDate }) }));
    return { scenario: 'locale-switch', status: day.status, accountingUnchanged: before === JSON.stringify(context.store.getDay(day.id).journal), messages };
  },
};

function result(scenario, context, day, locale) {
  locale = localeOverride ?? locale;
  const key = ['POSTED', 'ALREADY_POSTED', 'CORRECTED'].includes(day.status) ? 'summary.posted' : 'summary.blocked';
  const values = key === 'summary.posted' ? { date: day.businessDate } : { date: day.businessDate, reason: day.errorCode ?? day.status };
  return {
    scenario,
    status: day.status,
    businessDate: day.businessDate,
    currency: day.source.currency,
    totals: day.journal?.totals ?? null,
    quickBooksJournalId: day.qbJournalId,
    externalWrites: context.quickBooks.writeCount,
    message: translate(locale, key, values),
  };
}

function usage() {
  return { usage: 'node src/harness/cli.js <list|run SCENARIO|all>', scenarios: Object.keys(scenarios) };
}

const [command = 'list', name, ...options] = process.argv.slice(2);
const localeIndex = options.indexOf('--locale');
if (localeIndex >= 0) localeOverride = options[localeIndex + 1] ?? null;
try {
  if (command === 'list') console.log(JSON.stringify(usage(), null, 2));
  else if (command === 'run') {
    if (!scenarios[name]) throw new Error(`Unknown scenario: ${name}`);
    console.log(JSON.stringify(scenarios[name](), null, 2));
  } else if (command === 'all') console.log(JSON.stringify(Object.values(scenarios).map((run) => run()), null, 2));
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: { code: error.code ?? 'HARNESS_ERROR', message: error.message, details: error.details ?? {} }, ...usage() }, null, 2));
  process.exitCode = 1;
}
