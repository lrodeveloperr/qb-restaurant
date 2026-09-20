# Operator runbook

## Local verification

```bash
npm run check
npm test
npm run mutation
npm run fuzz
npm run benchmark
npm run harness -- all
npm run gate
```

The automated gate may pass while the verdict remains `PROVISIONAL` because real fixtures, live sandboxes and human reviews are external gates.

## CSV import failure

1. Identify the authenticated workspace, selected location, profile ID and file checksum; never trust a CSV identity cell as tenant identity.
2. For `INVALID_CSV_HEADER`, obtain a fresh export and compare it with the approved profile. Do not rename columns to force acceptance.
3. For `CSV_LOCATION_MISMATCH`, select the correct configured location or obtain the correct export.
4. For `UNEXPECTED_CSV_SIGN`, `INVALID_CSV_MONEY` or an unbalanced journal, stop. Do not take absolute values, round sub-cent values or insert a plug.
5. A revised uploaded row for a posted date must enter correction; it must not silently overwrite the stored source.

## Posting failure

1. Locate the workspace, location, business date, day state and most recent durable attempt.
2. A process-left `POSTING` row is moved to `OUTCOME_UNKNOWN` at startup and queried by stable `DocNumber`.
3. A process-left `CORRECTING` row becomes `CORRECTION_PARTIAL`; resume only after its stable reversal/replacement references are reconciled.
4. For `OUTCOME_UNKNOWN`, query QuickBooks before any retry. Record `NOT_FOUND` before releasing a day.
5. For `POSSIBLE_DUPLICATE`, require the user to adopt the accounting-equivalent journal or explicitly dismiss it.
6. For `EXTERNAL_CHANGE`, stop. Do not recreate, edit or delete the external journal.
7. For `CORRECTION_PARTIAL`, preserve the confirmed reversal and resume only the missing replacement.
8. For `ENTITLEMENT_BLOCKED`, retain the day and `blockedFromStatus`; restored entitlement resumes from that state.
9. For `POSTING_PAUSED`, unpause only at an authorized user's request. Pausing does not cancel billing.

## Never do

- edit SQLite to force `POSTED`;
- delete an attempt to enable retry;
- add a balancing/suspense line;
- coerce an unknown CSV into a supported profile;
- reuse a source location across active workspaces;
- use an internal/source location ID as QBO `DepartmentRef`;
- translate account, source or journal content;
- log tokens, source totals, guest/order data or complete uploaded files.

## Recovery objectives

Production targets encrypted daily backups, RPO 24 hours and RTO 8 hours. Restore drills must prove that state and attempts survive interruptions both before and after QBO commit. Raw upload retention and deletion must match the published privacy disclosure.
