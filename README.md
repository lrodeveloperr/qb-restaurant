# Restaurant Sales Sync for QuickBooks

CSV-first restaurant sales posting for QuickBooks Online. The application imports a supported daily sales-summary CSV, validates it without guessing, builds a balanced journal for review, posts it once, and corrects a changed day with a controlled reversal and replacement.

## Status

**PROVISIONAL production foundation**

Included now:

- exact-profile restaurant CSV import with trusted tenant/location binding;
- US/USD and Canada/CAD journal engine using integer cents;
- real QuickBooks Online HTTP and OAuth adapters plus a deterministic test adapter;
- durable SQLite posting ledger, duplicate protection, crash recovery and corrections;
- explicit review confirmation before batch posting;
- trial, payment-grace, per-location pricing and posting-pause rules;
- `en-US`, `en-CA`, `es-US` and `fr-CA` engine catalogs;
- automated tests, structured CSV fuzzing, mutation sentinels, benchmark and release gate.

Launch does **not** connect to the Toast API and does not claim automatic daily retrieval. A user exports the supported Toast Sales Summary CSV and uploads it. Real anonymized US and Quebec CSVs, accounting approval, live US/CA QuickBooks sandbox proof, independent review and user acceptance are still required before the candidate may be called production-ready.

No production web UI, hosting, email delivery, checkout, token vault or legal URLs are included in this repository.

## Requirements and verification

Node.js 24 or later; no package installation is required.

```bash
npm run check
npm test
npm run harness -- all
npm run mutation
npm run fuzz
npm run benchmark
npm run gate
```

The gate can pass every automated check while correctly returning `PROVISIONAL` because external evidence is intentionally separate.

## Safety model

- Money remains safe integer cents from import through journal construction.
- Every non-zero category needs an approved account and debit/credit direction.
- Debits equal credits exactly; no suspense or plug line is created.
- Exact header, sign, decimal and location rules fail closed.
- CSV identity is bound from trusted configuration; uploaded cells cannot select a workspace or QuickBooks realm.
- One per-day source fingerprint prevents unrelated dates in one upload from appearing revised.
- QuickBooks department IDs are explicit QBO references, never internal/source IDs.
- Equivalent-journal comparison is independent of line order.
- Every write is durably claimed and uses a stable `requestid`, `DocNumber` and `PrivateNote`.
- Uncertain and process-interrupted writes are queried before retry.
- Posted source changes create one full reversal and one replacement.
- External edits/deletions stop automated correction.
- A reviewed source and accounting fingerprint must still match at post confirmation.

## Project map

- `contracts/` — atomic requirements, gate manifest and locked decisions.
- `src/adapters/restaurant-csv.js` — exact-profile CSV production boundary.
- `src/adapters/quickbooks-online.js` and `quickbooks-oauth.js` — real QBO transport boundary.
- `src/application/` — review-confirmed CSV-to-post workflow.
- `src/domain/` — normalization, journals, states, idempotency and correction orchestration.
- `src/persistence/` — SQLite tenancy, mapping, entitlement and attempt ledger.
- `src/billing/`, `src/i18n/`, `src/security/` — commercial and operating controls.
- `docs/accounting-*.md` — expert US and Canada/Quebec accounting reviews.
- `docs/quickbooks-submission-pack.md` — submission checklist and blocked owner inputs.

The product name and price remain locked: **Restaurant Sales Sync for QuickBooks**, US$29 per active posting location/month in the United States or C$39/month in Canada, with applicable tax shown before sale.
