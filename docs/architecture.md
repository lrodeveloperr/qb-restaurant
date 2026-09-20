# Application architecture

The application is an asynchronous command core with a strict accounting boundary. A web shell may orchestrate it, but cannot duplicate or bypass its accounting rules.

## Command path

1. A user selects a configured restaurant location and uploads a supported CSV.
2. `importRestaurantCsv` matches an exact versioned profile, binds trusted workspace/location context, validates signs and precision, and creates one canonical source per business date.
3. `SyncEngine.ingest` verifies realm, location, country, currency and timezone, then loads the approved mapping.
4. `buildJournal` creates immutable deterministic lines and refuses unmapped, inactive or unbalanced input.
5. `CsvPostingService.importForReview` returns safe review records without writing to QuickBooks.
6. `CsvPostingService.postReviewed` rechecks both source and accounting fingerprints, orders confirmed days oldest first and calls the engine sequentially.
7. `SyncEngine.post` checks location/entitlement state, searches for exact and equivalent journals, claims a durable attempt, then uses the async QBO adapter.
8. An uncertain response or interrupted write is searched by stable reference before retry.
9. Re-uploading changed data for a posted day opens the controlled reversal/replacement correction workflow.

## Trust boundaries

- CSV profiles parse proven source fields but cannot choose accounts or posting directions.
- Upload identity cells cannot choose the tenant, realm, location, timezone, country or currency.
- The QuickBooks adapter transports a locked journal and verifies the create response; it cannot alter accounting intent.
- QuickBooks `DepartmentRef` and line `ClassRef` are stored QBO references, not source identifiers.
- Locale rendering never enters the accounting projection.
- SQLite is authoritative for source fingerprints, mapping versions, state, attempts and QBO IDs; credentials do not belong there.
- The production shell must protect OAuth state, encrypt refresh tokens, enforce recent reauthentication and serialize writes per location.

## Deliberately excluded

Toast API access, automatic retrieval, order/guest data, cardholder data, inventory, recipes, payroll, invoices, tax calculation/filing, bank reconciliation and automatic journal deletion are outside launch scope.

## Candidate boundary

The real QBO HTTP/OAuth adapter is implemented and locally contract-tested. Production remains provisional until real Toast CSV profiles are proven, live US/CA QBO sandbox evidence passes and the production web/operations layer exists.
