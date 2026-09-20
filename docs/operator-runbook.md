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

`npm run gate` returns exit code zero when all local automated checks pass. Its verdict remains `PROVISIONAL` while any external gate is blocked.

## Inspect a customer-visible failure

1. Find the workspace, location and business date; never search by account name alone.
2. Read the primary day state and most recent attempt.
3. For `OUTCOME_UNKNOWN`, query QuickBooks by the stored stable reference before permitting another write.
4. For `POSSIBLE_DUPLICATE`, require the user to adopt an accounting-equivalent journal or explicitly dismiss it.
5. For `EXTERNAL_CHANGE`, stop automation. Do not recreate, edit or delete the external journal.
6. For `CORRECTION_PARTIAL`, preserve the confirmed reversal and resume only the missing replacement.

## Never do

- edit SQLite to force `POSTED`;
- delete an idempotency attempt to make a retry possible;
- add a balancing line;
- reuse a location across active workspaces;
- translate account, source or journal content;
- log credentials, source totals or guest/order data.

## Recovery objectives

Production operations target encrypted daily backups, RPO 24 hours and RTO 8 hours. A restore drill must prove that posting state and attempts survive restart before production activation.
