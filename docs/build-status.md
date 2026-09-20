# Build status

Status: **ENGINE PROVISIONAL**

## Implemented and locally verified

- Canonical US/USD and Canada/CAD location-day normalization.
- Explicit versioned mappings and exact-cent balanced journals.
- Stable QuickBooks references and private identity notes.
- SQLite scope, day, attempt, mapping and entitlement persistence.
- Durable attempt claims, QuickBooks request identifiers, equivalent-journal review, and timeout/process-restart recovery.
- Versioned reversal-and-replacement corrections with partial resume and deterministic revision queuing.
- Persisted entitlement blocks that restore the exact prior workflow state.
- Reference-scope collision rejection before a location can post.
- External edit/deletion detection.
- Strict, escaped, formula-safe fixed-schema CSV pilot bridge.
- Trial, payment-grace, pause, pricing and role rules.
- Locale catalogs for `en-US`, `en-CA`, `es-US` and `fr-CA` with structural parity.
- Locale-neutral formula-safe posting-register export.
- Plain acceptance harness, deterministic fixtures, property tests, structured fuzzing, mutation sentinels and performance gate.
- Enforced Node.js 24 runtime locally and in GitHub Actions.

## Deliberately not claimed

- Production Toast integration access or field contract.
- Real xtraCHEF migration fixture.
- Production Intuit OAuth, token refresh or journal-write proof.
- Accountant approval of real US and Quebec outputs.
- Independent code-breaker review or user acceptance.
- Visual production UI.

Those are external release gates, not hidden assumptions. The local gate can pass while the overall candidate remains provisional.
