import { AppError, UnknownWriteOutcomeError, invariant } from '../domain/errors.js';
import { journalsEquivalent } from '../domain/journal.js';

const ENVIRONMENTS = Object.freeze({
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
});

function moneyNumber(cents) {
  invariant(Number.isSafeInteger(cents) && cents >= 0, 'INVALID_MONEY', 'QuickBooks amounts must be non-negative safe integer cents.');
  return Number((cents / 100).toFixed(2));
}

function moneyCents(amount) {
  const cents = Math.round(Number(amount) * 100);
  invariant(Number.isSafeInteger(cents) && cents >= 0, 'INVALID_QUICKBOOKS_RESPONSE', 'QuickBooks returned an invalid amount.', { amount });
  return cents;
}

function escapeQueryLiteral(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function toQuickBooksJournalEntry(journal) {
  invariant(journal && typeof journal === 'object', 'INVALID_JOURNAL', 'Journal is required.');
  return {
    TxnDate: journal.txnDate,
    DocNumber: journal.docNumber,
    PrivateNote: journal.privateNote,
    CurrencyRef: { value: journal.currency },
    ...(journal.departmentRef ? { DepartmentRef: { value: journal.departmentRef } } : {}),
    Line: journal.lines.map((line) => ({
      Description: line.description,
      Amount: moneyNumber(line.amountCents),
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: {
        PostingType: line.postingType,
        AccountRef: { value: line.accountRef },
        ...(line.classRef ? { ClassRef: { value: line.classRef } } : {}),
      },
    })),
  };
}

export function fromQuickBooksJournalEntry(entry, { fallbackCurrency } = {}) {
  invariant(entry && typeof entry === 'object' && Array.isArray(entry.Line), 'INVALID_QUICKBOOKS_RESPONSE', 'QuickBooks returned an invalid journal entry.');
  const lines = entry.Line.filter((line) => line.DetailType === 'JournalEntryLineDetail').map((line, index) => ({
    category: `quickbooks_line_${index + 1}`,
    description: line.Description ?? '',
    amountCents: moneyCents(line.Amount),
    postingType: line.JournalEntryLineDetail?.PostingType,
    accountRef: String(line.JournalEntryLineDetail?.AccountRef?.value ?? ''),
    ...(line.JournalEntryLineDetail?.ClassRef?.value ? { classRef: String(line.JournalEntryLineDetail.ClassRef.value) } : {}),
  }));
  invariant(lines.every((line) => line.accountRef && ['Debit', 'Credit'].includes(line.postingType)),
    'INVALID_QUICKBOOKS_RESPONSE', 'QuickBooks returned an incomplete journal line.');
  const debitCents = lines.filter((line) => line.postingType === 'Debit').reduce((sum, line) => sum + line.amountCents, 0);
  const creditCents = lines.filter((line) => line.postingType === 'Credit').reduce((sum, line) => sum + line.amountCents, 0);
  return {
    id: String(entry.Id),
    syncToken: String(entry.SyncToken ?? '0'),
    createdAt: entry.MetaData?.CreateTime ?? null,
    journal: {
      schemaVersion: 1,
      kind: 'QUICKBOOKS_RECORD',
      docNumber: entry.DocNumber ?? '',
      privateNote: entry.PrivateNote ?? '',
      txnDate: entry.TxnDate,
      currency: entry.CurrencyRef?.value ?? fallbackCurrency,
      departmentRef: entry.DepartmentRef?.value ?? null,
      lines,
      totals: { debitCents, creditCents },
    },
  };
}

function retryAfterSeconds(response) {
  const value = Number(response.headers?.get?.('retry-after'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export class QuickBooksOnlineAdapter {
  constructor({ realmId, currency, accessToken, accessTokenProvider, environment = 'sandbox', minorVersion, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
    invariant(typeof realmId === 'string' && realmId, 'QUICKBOOKS_CONFIG_REQUIRED', 'QuickBooks realm ID is required.');
    invariant(['USD', 'CAD'].includes(currency), 'QUICKBOOKS_CONFIG_REQUIRED', 'QuickBooks company currency must be USD or CAD.');
    invariant(typeof accessToken === 'string' || typeof accessTokenProvider === 'function', 'QUICKBOOKS_CONFIG_REQUIRED', 'An access token provider is required.');
    invariant(ENVIRONMENTS[environment], 'QUICKBOOKS_CONFIG_REQUIRED', 'QuickBooks environment must be sandbox or production.');
    invariant(typeof fetchImpl === 'function', 'QUICKBOOKS_CONFIG_REQUIRED', 'A fetch implementation is required.');
    this.realmId = realmId;
    this.currency = currency;
    this.accessToken = accessToken;
    this.accessTokenProvider = accessTokenProvider;
    this.baseUrl = ENVIRONMENTS[environment];
    this.minorVersion = minorVersion;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async createJournal(journal, { idempotencyKey } = {}) {
    invariant(typeof idempotencyKey === 'string' && idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'QuickBooks requestid is required.');
    const body = await this.#request('POST', 'journalentry', {
      requestId: idempotencyKey,
      body: toQuickBooksJournalEntry(journal),
      unknownWriteOnTransportFailure: true,
    });
    try {
      const record = fromQuickBooksJournalEntry(body.JournalEntry, { fallbackCurrency: this.currency });
      invariant(record.journal.docNumber === journal.docNumber
        && record.journal.privateNote === journal.privateNote
        && journalsEquivalent(record.journal, journal),
      'QUICKBOOKS_CREATE_MISMATCH', 'QuickBooks returned a journal that differs from the submitted payload.');
      return record;
    } catch (cause) {
      throw new UnknownWriteOutcomeError('QuickBooks accepted the create request but did not return a verifiable journal.', {
        causeCode: cause?.code ?? 'INVALID_QUICKBOOKS_RESPONSE',
      });
    }
  }

  async getJournal(id) {
    try {
      const body = await this.#request('GET', `journalentry/${encodeURIComponent(id)}`);
      return fromQuickBooksJournalEntry(body.JournalEntry, { fallbackCurrency: this.currency });
    } catch (error) {
      if (error instanceof AppError && error.code === 'QUICKBOOKS_NOT_FOUND') return null;
      throw error;
    }
  }

  async findByDocNumber(docNumber) {
    const records = await this.#query(`select * from JournalEntry where DocNumber = '${escapeQueryLiteral(docNumber)}' maxresults 2`);
    if (records.length === 0) return null;
    invariant(records.length === 1, 'REFERENCE_COLLISION', 'More than one QuickBooks journal uses the stable document number.', { docNumber });
    return records[0];
  }

  async findEquivalent(journal, { excludeDocNumber } = {}) {
    for (let startPosition = 1; ; startPosition += 1000) {
      const records = await this.#query(`select * from JournalEntry where TxnDate = '${escapeQueryLiteral(journal.txnDate)}' startposition ${startPosition} maxresults 1000`);
      const equivalent = records.find((record) => record.journal.docNumber !== excludeDocNumber && journalsEquivalent(record.journal, journal));
      if (equivalent) return equivalent;
      if (records.length < 1000) return null;
    }
  }

  async listActiveAccounts() {
    const body = await this.#request('GET', 'query', { query: "select * from Account where Active = true maxresults 1000" });
    return body.QueryResponse?.Account ?? [];
  }

  async getCompanyInfo() {
    const body = await this.#request('GET', `companyinfo/${encodeURIComponent(this.realmId)}`);
    return body.CompanyInfo;
  }

  async #query(query) {
    const body = await this.#request('GET', 'query', { query });
    return (body.QueryResponse?.JournalEntry ?? []).map((entry) => fromQuickBooksJournalEntry(entry, { fallbackCurrency: this.currency }));
  }

  async #request(method, path, { query, requestId, body, unknownWriteOnTransportFailure = false } = {}) {
    const url = new URL(`/v3/company/${encodeURIComponent(this.realmId)}/${path}`, this.baseUrl);
    if (query) url.searchParams.set('query', query);
    if (requestId) url.searchParams.set('requestid', requestId);
    if (this.minorVersion !== undefined) url.searchParams.set('minorversion', String(this.minorVersion));
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = this.accessTokenProvider
        ? await this.accessTokenProvider({ forceRefresh: attempt === 1 })
        : this.accessToken;
      invariant(typeof token === 'string' && token, 'QUICKBOOKS_AUTH_REQUIRED', 'QuickBooks access token is unavailable.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        response = await this.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });
      } catch (cause) {
        if (unknownWriteOnTransportFailure) throw new UnknownWriteOutcomeError('QuickBooks did not confirm whether the journal was created.', { transport: cause?.name ?? 'network' });
        throw new AppError('QUICKBOOKS_UNAVAILABLE', 'QuickBooks could not be reached.', {}, cause);
      } finally {
        clearTimeout(timeout);
      }
      if (response.status !== 401 || !this.accessTokenProvider || attempt === 1) break;
    }
    if (response.ok) return responseBody(response);
    const responseJson = await responseBody(response);
    const qboError = responseJson.Fault?.Error?.[0];
    const details = { status: response.status, code: qboError?.code, retryAfterSeconds: retryAfterSeconds(response) };
    if (response.status === 401 || response.status === 403) throw new AppError('QUICKBOOKS_AUTH_REQUIRED', 'QuickBooks authorization must be renewed.', details);
    if (response.status === 404) throw new AppError('QUICKBOOKS_NOT_FOUND', 'QuickBooks record was not found.', details);
    if (response.status === 429) throw new AppError('QUICKBOOKS_RATE_LIMITED', 'QuickBooks temporarily limited requests.', details);
    if (response.status >= 500 && unknownWriteOnTransportFailure) throw new UnknownWriteOutcomeError('QuickBooks did not confirm whether the journal was created.', details);
    throw new AppError('QUICKBOOKS_REJECTED', 'QuickBooks rejected the request.', details);
  }
}
