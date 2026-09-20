# Production adapter contract

## Toast input

A production Toast adapter must return one finalized location-day as canonical schema v1. It owns vendor-field parsing and sign normalization. It must not guess missing categories, accounts, timezone, country or currency.

Required behavior:

- return stable restaurant, location, source-version and business-date identifiers;
- use the location's IANA timezone;
- return non-negative safe integer cents after documented sign normalization;
- distinguish not-finalized, missing, authentication and rate-limit outcomes;
- preserve source tax totals; never calculate GST, QST or sales tax;
- prove US and Canadian behavior with anonymized real fixtures.

## QuickBooks transport

A production QuickBooks adapter must implement the behavior exercised by `FakeQuickBooks`:

- create a locked journal with a caller-supplied idempotency key;
- read a journal by ID;
- find an exact journal by deterministic `DocNumber`;
- find accounting-equivalent journals by date, transaction-level location and normalized lines;
- surface rejected writes separately from unknown outcomes;
- honor rate limits and refresh credentials without changing the payload;
- preserve `TxnDate`, `DocNumber`, `PrivateNote`, transaction `DepartmentRef`, line `ClassRef`, accounts, directions and amounts.

The adapter must never blindly retry a create after a timeout. The engine's reference query runs first.

## OAuth and credentials

The web shell owns OAuth redirects and stores encrypted refresh credentials in a replaceable secret vault. Workspace deletion must revoke external credentials before primary customer-data purge. No token or client secret belongs in SQLite, fixtures, logs or the release bundle.

## Required external proof

Production readiness requires successful contract runs in one US/USD and one CA/CAD QuickBooks sandbox, approved commercial Toast access, real anonymized US and Quebec fixtures, and an accountant-approved expected journal for each fixture.
