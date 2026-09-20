# Build status

Status: **ENGINE PROVISIONAL**

## Implemented and locally verified

- Canonical US/USD and Canada/CAD location-day normalization.
- Explicit versioned mappings and exact-cent balanced journals.
- Stable QuickBooks references and private identity notes.
- SQLite scope, day, attempt, mapping and entitlement persistence.
- Exact idempotency, equivalent-journal review and safe timeout recovery.
- Versioned reversal-and-replacement corrections with partial resume.
- External edit/deletion detection.
- Fixed-schema CSV pilot bridge.
- Trial, payment-grace, pause, pricing and role rules.
- Locale catalogs for `en-US`, `en-CA`, `es-US` and `fr-CA` with structural parity.
- Locale-neutral formula-safe posting-register export.
- Plain acceptance harness, deterministic fixtures, property tests, structured fuzzing, mutation sentinels and performance gate.

## Deliberately not claimed

- Production Toast integration access or field contract.
- Real xtraCHEF migration fixture.
- Production Intuit OAuth, token refresh or journal-write proof.
- Accountant approval of real US and Quebec outputs.
- Independent code-breaker review or user acceptance.
- Visual production UI.

Those are external release gates, not hidden assumptions. The local gate can pass while the overall candidate remains provisional.
