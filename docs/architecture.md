# Engine architecture

The accounting engine is an intentionally small synchronous command core. External web, queue, OAuth and notification layers call it; they do not duplicate accounting rules.

## Command path

1. An adapter produces canonical schema v1 or the CSV parser converts the locked pilot format.
2. `normalizeSource` validates identity, country/currency, date, timezone and integer cents, then creates the source fingerprint.
3. `SyncEngine.ingest` binds the record to its workspace, realm and location and loads the approved mapping version.
4. `buildJournal` produces immutable sorted lines, exact totals and stable QuickBooks references. It refuses unmapped, inactive or unbalanced input.
5. `SyncEngine.post` checks entitlement and location state, searches QuickBooks for exact and equivalent records, atomically claims the durable attempt and writes at most once.
6. An uncertain response or stale `POSTING` row is searched by stable reference before the day can return to a retryable state.
7. A changed posted source becomes a correction. The engine verifies the stored QuickBooks snapshot, then creates versioned reversal and replacement entries. Revisions arriving during that correction queue behind its immutable source snapshot.

## Trust boundaries

- Toast and CSV adapters may parse vendor data but cannot select accounts or posting directions.
- QuickBooks adapters may transport a locked journal but cannot alter lines, date, currency or reference.
- Locale rendering cannot enter the accounting projection.
- SQLite is the source of truth for source fingerprints, mapping versions, states, attempts and external IDs.
- The production shell must serialize writes per location and process dates oldest first.

## Data deliberately excluded

Order detail, guest data, cardholder data, inventory, invoices, recipes, payroll, tax calculation and bank reconciliation are outside this engine.

## Candidate boundary

The included QuickBooks and Toast adapters are deterministic simulators. A production adapter must be verified against approved Toast access and Intuit US/USD and CA/CAD sandboxes without changing the domain engine.
