# Production boundary contracts

## Restaurant CSV input

Launch supports uploaded CSV, not a Toast API connection.

- Accept only a named, versioned profile whose exact headers and field meanings were proven by an anonymized real export.
- Bind workspace, realm, restaurant, internal location, source-location key, timezone, country and currency from authenticated server configuration.
- Use an explicit date format and an explicit sign rule for every mapped amount.
- Preserve source tax totals; never calculate GST, QST or sales tax.
- Reject unknown/duplicate headers, mixed locations, duplicate dates, malformed quotes, unexpected signs, sub-cent values, oversized files and unsupported encodings.
- Create a fingerprint per location-day, not per uploaded file.
- Never infer categories, gross/net relationships, accounts or posting directions from labels alone.

Real US and Quebec Toast CSV files and accountant-approved expected journals are required before either native profile can become `LOCKED`.

## QuickBooks Online transport

`QuickBooksOnlineAdapter` must:

- create a locked `JournalEntry`, sending the durable attempt key as QBO `requestid`;
- preserve `TxnDate`, `DocNumber`, `PrivateNote`, `CurrencyRef`, transaction `DepartmentRef`, line `ClassRef`, accounts, directions and amounts;
- verify that a create response is accounting-equivalent to the submitted journal;
- read by ID, query the stable `DocNumber`, and search same-date entries for an order-independent accounting equivalent;
- distinguish known rejection from an unknown create outcome;
- refresh authorization once after a 401 without changing request body or identity;
- expose 429 `Retry-After` data and never blindly replay an uncertain create;
- paginate same-day duplicate searches.

The durable attempt ledger, `requestid`, `DocNumber` and `PrivateNote` are independent safeguards. Production correctness must not depend on the deterministic fake adapter.

## OAuth and credential custody

- Request only `com.intuit.quickbooks.accounting`.
- Generate and validate a high-entropy OAuth state value bound to the initiating browser session.
- Exchange and refresh tokens with HTTP Basic client authentication.
- Store refresh credentials encrypted in a replaceable secret vault; do not store them in SQLite, logs, fixtures or release bundles.
- Revoke the external token before workspace customer-data purge begins.

## Required external proof

Production readiness requires a successful original, duplicate, timeout/recovery, external-edit and correction suite in one US/USD and one CA/CAD QBO sandbox; real anonymized CSV/accounting fixtures; independent review; and owner acceptance.
