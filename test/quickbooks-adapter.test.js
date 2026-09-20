import test from 'node:test';
import assert from 'node:assert/strict';
import { QuickBooksOnlineAdapter, fromQuickBooksJournalEntry, toQuickBooksJournalEntry } from '../src/adapters/quickbooks-online.js';
import { QuickBooksOAuthClient } from '../src/adapters/quickbooks-oauth.js';
import { buildJournal, journalsEquivalent } from '../src/domain/journal.js';
import { normalizeSource } from '../src/domain/normalize.js';
import { fixture } from './helpers.js';

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function qboEntry(payload, id = '901') {
  return { ...payload, Id: id, SyncToken: '0', MetaData: { CreateTime: '2026-09-20T12:00:00-04:00' } };
}

test('T-QB-PAYLOAD: locked journal maps to and from the documented JournalEntry shape', () => {
  const journal = buildJournal(normalizeSource(fixture('us-day.json')), fixture('us-mapping.json'));
  const payload = toQuickBooksJournalEntry(journal);
  assert.equal(payload.TxnDate, '2026-09-18');
  assert.equal(payload.DocNumber, journal.docNumber);
  assert.equal(payload.Line[0].DetailType, 'JournalEntryLineDetail');
  const record = fromQuickBooksJournalEntry(qboEntry(payload), { fallbackCurrency: 'USD' });
  assert.equal(record.id, '901');
  assert.equal(record.journal.totals.debitCents, 123000);
  assert.equal(record.journal.totals.creditCents, 123000);
  const reordered = fromQuickBooksJournalEntry(qboEntry({ ...payload, Line: [...payload.Line].reverse() }), { fallbackCurrency: 'USD' });
  assert.equal(journalsEquivalent(record.journal, reordered.journal), true);
});

test('T-QB-REQUESTID: create sends the durable idempotency key as requestid', async () => {
  const journal = buildJournal(normalizeSource(fixture('us-day.json')), fixture('us-mapping.json'));
  let captured;
  const adapter = new QuickBooksOnlineAdapter({
    realmId: 'realm-us', currency: 'USD', accessToken: 'test-token', environment: 'sandbox',
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return response({ JournalEntry: qboEntry(JSON.parse(options.body)) });
    },
  });
  const record = await adapter.createJournal(journal, { idempotencyKey: 'rsq_test_key' });
  assert.equal(record.id, '901');
  assert.match(captured.url, /requestid=rsq_test_key/);
  assert.equal(captured.options.headers.Authorization, 'Bearer test-token');
});

test('T-QB-UNKNOWN: an unconfirmed create becomes an unknown write outcome', async () => {
  const journal = buildJournal(normalizeSource(fixture('us-day.json')), fixture('us-mapping.json'));
  const adapter = new QuickBooksOnlineAdapter({
    realmId: 'realm-us', currency: 'USD', accessToken: 'test-token',
    fetchImpl: async () => { throw new TypeError('network down'); },
  });
  await assert.rejects(() => adapter.createJournal(journal, { idempotencyKey: 'rsq_test_key' }), { code: 'OUTCOME_UNKNOWN' });
});

test('T-QB-UNKNOWN: an unverifiable create response becomes an unknown write outcome', async () => {
  const journal = buildJournal(normalizeSource(fixture('us-day.json')), fixture('us-mapping.json'));
  const adapter = new QuickBooksOnlineAdapter({
    realmId: 'realm-us', currency: 'USD', accessToken: 'test-token',
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      return response({ JournalEntry: qboEntry({ ...payload, DocNumber: 'UNEXPECTED' }) });
    },
  });
  await assert.rejects(() => adapter.createJournal(journal, { idempotencyKey: 'rsq_test_key' }), { code: 'OUTCOME_UNKNOWN' });
});

test('T-QB-RATE-LIMIT: a throttle remains a known retryable rejection', async () => {
  const adapter = new QuickBooksOnlineAdapter({
    realmId: 'realm-us', currency: 'USD', accessToken: 'test-token',
    fetchImpl: async () => response({ Fault: { Error: [{ code: '003001' }] } }, 429, { 'retry-after': '17' }),
  });
  await assert.rejects(() => adapter.listActiveAccounts(), (error) => error.code === 'QUICKBOOKS_RATE_LIMITED' && error.details.retryAfterSeconds === 17);
});

test('T-QB-OAUTH: authorization uses minimum accounting scope and token exchange uses Basic auth', async () => {
  let captured;
  const oauth = new QuickBooksOAuthClient({
    clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://example.test/oauth/callback',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, x_refresh_token_expires_in: 8_726_400, token_type: 'bearer' });
    },
  });
  const url = new URL(oauth.authorizationUrl({ state: '12345678901234567890123456789012' }));
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(url.searchParams.get('state').length, 32);
  const tokens = await oauth.exchangeCode('authorization-code');
  assert.equal(tokens.refreshToken, 'refresh');
  assert.match(captured.options.headers.Authorization, /^Basic /);
  assert.doesNotMatch(String(captured.options.body), /client-secret/);
});

test('T-QB-OAUTH: a 401 refreshes once before failing the operation', async () => {
  const tokenCalls = [];
  const requestTokens = [];
  const adapter = new QuickBooksOnlineAdapter({
    realmId: 'realm-us', currency: 'USD',
    accessTokenProvider: async (options) => {
      tokenCalls.push(options);
      return options.forceRefresh ? 'fresh-token' : 'expired-token';
    },
    fetchImpl: async (_url, options) => {
      requestTokens.push(options.headers.Authorization);
      if (requestTokens.length === 1) return response({ Fault: { Error: [{ code: '3200' }] } }, 401);
      return response({ QueryResponse: { Account: [] } });
    },
  });
  assert.deepEqual(await adapter.listActiveAccounts(), []);
  assert.deepEqual(tokenCalls, [{ forceRefresh: false }, { forceRefresh: true }]);
  assert.deepEqual(requestTokens, ['Bearer expired-token', 'Bearer fresh-token']);
});
