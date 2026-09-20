# Restaurant Sales Sync for QuickBooks — Engine Candidate

This package implements the locked non-visual engine for a Toast-first restaurant sales sync. It converts one finalized restaurant location-day into one balanced QuickBooks journal, prevents duplicate writes, exposes failures, and supports controlled reversal-and-replacement corrections.

## Current status

**ENGINE PROVISIONAL**

The canonical engine, SQLite persistence, billing rules, localization, CSV pilot adapter, deterministic QuickBooks simulator, diagnostic harness and automated tests are included. Production status remains provisional until WorksBien obtains:

1. approved Toast integration access and real United States and Canadian source fixtures;
2. QuickBooks sandbox proof for United States/USD and Canada/CAD journal writes;
3. independent external verification and user acceptance of the plain harness.

No visual production UI is included. That boundary is intentional: the engine must be verified before it is skinned.

## Requirements

- Node.js 24 or later. The project uses built-in `node:sqlite`, `node:test` and Web Crypto only.
- No package installation is required.

## Run it

```bash
npm run check
npm test
npm run harness -- list
npm run harness -- run normal-us
npm run harness -- run normal-ca-fr
npm run harness -- run timeout-after-commit
npm run harness -- run correction
npm run harness -- run external-edit
npm run harness -- run all
npm run benchmark
npm run gate
```

Use `--locale en-US`, `en-CA`, `es-US` or `fr-CA` after a scenario command to change the diagnostic output language without changing source or accounting data.

## Safety model

- Monetary values are integer cents from input through journal generation.
- Every non-zero category requires an approved mapping.
- Debits must equal credits exactly; the engine never creates a plug.
- One workspace belongs to one QuickBooks realm.
- A stable 21-character reference identifies every write.
- Every write is claimed in the durable attempt ledger and uses a QuickBooks `requestid` plus a stable `DocNumber`.
- Timed-out and process-interrupted writes are queried before retry, including stale `POSTING` and `CORRECTING` rows recovered at startup.
- Colliding shortened reference scopes are rejected when a location is created.
- An existing unreferenced equivalent journal blocks as a possible duplicate.
- External edits or deletion block automated correction.
- New source revisions replace an unstarted correction or queue behind one already in flight.
- Billing-denied writes persist as `ENTITLEMENT_BLOCKED` and resume from their prior state after entitlement returns.
- Posted records retain their source fingerprint and mapping version.
- Locale changes never translate or mutate restaurant or accounting data.

## Project map

- `contracts/` — atomic requirements, test manifest and locked decisions.
- `src/domain/` — normalization, journals, state transitions and orchestration.
- `src/persistence/` — SQLite schema and durable posting ledger.
- `src/adapters/` — CSV pilot and deterministic Toast/QuickBooks simulators.
- `src/billing/` — trial, subscription and grace-period rules.
- `src/i18n/` — complete locale catalogs and formatters.
- `src/harness/` — runnable acceptance scenarios.
- `fixtures/` — United States and Quebec/CAD sample days and mappings.
- `test/` — unit, integration, property, recovery and localization tests.
- `reports/` — generated gate and benchmark evidence.

## Production adapter boundary

`QuickBooksPort` and `ToastPort` behavior is exercised through deterministic simulators. A production adapter must satisfy the same contract and pass the same fixtures. The engine contains no embedded client secrets, credentials, or undocumented scraping.
