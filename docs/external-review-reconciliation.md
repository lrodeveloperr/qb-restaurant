# External review reconciliation

This record maps the structural-integrity review to release `0.2.0` changes. The same release also replaces the former direct-Toast launch assumption with an exact-profile CSV upload boundary.

| Finding | Disposition | Evidence |
|---|---|---|
| A second source revision could throw from `CORRECTION_REQUIRED` | Fixed | Unstarted corrections now replace their pending source; in-flight corrections retain their snapshot and queue the newer source. `T-REVISION-QUEUE` covers both paths. |
| A process stop could strand `POSTING` | Fixed and extended | Engine startup reconciles every durable `POSTING`/`OUTCOME_UNKNOWN` row by deterministic QuickBooks reference. The same recovery boundary now moves interrupted `CORRECTING` rows to resumable partial correction. `T-INTERRUPTED-WRITE` and `T-INTERRUPTED-CORRECTION` cover these crash windows. |
| Correction 2+ replacements were labeled `ORIGINAL` | Fixed | Journal kind is explicit for correction writes; the second replacement is asserted as `REPLACEMENT`. |
| `ENTITLEMENT_BLOCKED` was never persisted | Fixed | Denied posts/corrections persist the block and prior state, then restore that state when entitlement returns. |
| The attempts table was write-only and the adapter contract assumed unsupported idempotency | Hardened; contract premise corrected | Attempts are now atomically claimed and consulted during posting/correction recovery. Intuit documents a caller-supplied, company-unique `requestid`; the production adapter contract now names it explicitly while retaining `DocNumber` reconciliation. |
| The 32-bit scope hash could collide | Fixed | Location creation and migration reject duplicate shortened scope hashes within a workspace. A deterministic known collision is covered by `T-REFERENCE-SCOPE`. Existing reference-content checks continue to fail closed. |
| `toCsvSource` did not escape cells | Fixed | All cells receive RFC-style quote escaping; identity/category cells receive reversible spreadsheet-formula neutralization. |
| Node 24 was declared but not enforced | Fixed | `.npmrc` rejects incompatible engines, validation checks the running major version, and CI runs the full gate on Node 24. Local verification used Node 24.19.0. |
| Malformed quoted CSV fields were tolerated | Fixed | Quotes inside unquoted cells and trailing characters after a closing quote now fail with `MALFORMED_CSV`. |
| Direct Toast access was still a launch dependency | Removed from launch | `TOAST_CSV_UPLOAD` is now the only input method. Trusted-context binding, exact profiles, explicit signs, per-day fingerprints and stale-review protection are implemented; real US/Quebec exports remain external evidence. |
| Internal location IDs could become QBO departments | Fixed | QBO `DepartmentRef` is a separately stored optional reference; the engine never derives it from the source/internal location ID. |
| QBO line order could defeat equivalence | Fixed | Accounting projections canonical-sort account, direction, amount and class before duplicate/external-change comparison. |

QuickBooks request identifier reference: <https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions>
