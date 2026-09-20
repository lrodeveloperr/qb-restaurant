# Build status

Status: **PROVISIONAL production foundation**

## Implemented and locally verified

- CSV-only launch scope; all Toast API, polling and scheduler dependencies removed.
- Exact versioned restaurant CSV profile with trusted context, per-day fingerprints and fail-closed signs/precision/schema.
- Canonical US/USD and Canada/CAD location-day normalization.
- Explicit versioned mappings and exact-cent balanced journals without plug lines.
- Real QuickBooks JournalEntry transport and minimum-scope OAuth helpers.
- Correct `CurrencyRef`, QBO `DepartmentRef`, line `ClassRef`, stable `requestid`, `DocNumber` and `PrivateNote` handling.
- Authentication refresh-on-401, rate-limit classification and unknown-create recovery semantics.
- Order-independent equivalent-journal comparison.
- Durable attempt claims, crash recovery, duplicate review and reversal/replacement corrections.
- Review fingerprints that prevent stale or changed journals from being posted after confirmation.
- Trial, payment grace, posting pause and per-location subscription calculations.
- Locale catalogs for `en-US`, `en-CA`, `es-US` and `fr-CA`.
- US and Canada/Quebec expert accounting review packs with simulated balanced fixtures.
- Automated contract, unit, integration, property, recovery, fuzz, mutation and performance checks on Node 24.

## External gates still blocked

1. Real anonymized Toast Sales Summary CSV plus Lateef-approved expected journal for US/USD.
2. Real anonymized Quebec Toast Sales Summary CSV plus Lateef-approved expected journal for CA/CAD.
3. Live locked-payload and recovery runs in US/USD and CA/CAD QBO sandboxes.
4. Production shell: authentication, encrypted token vault, upload storage/deletion, email, checkout, hosting and monitoring.
5. Privacy policy, terms, support, disconnect and launch URLs.
6. Intuit production credentials, development/production configuration and reviewer access.
7. Independent security/accounting verification and owner-run acceptance harness.

Synthetic files prove engine architecture only. They do not prove native Toast column semantics or constitute accounting approval.
