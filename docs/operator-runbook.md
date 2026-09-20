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
3. For `POSTING` left behind by a process stop, restart the engine normally. Startup changes it to `OUTCOME_UNKNOWN` and queries QuickBooks by the stored stable reference.
4. For `CORRECTING` left behind by a process stop, restart normally. Startup moves it to `CORRECTION_PARTIAL`; resume the correction so its stable reversal/replacement references are reconciled.
5. For `OUTCOME_UNKNOWN`, query QuickBooks by the stored stable reference before permitting another write. If no matching journal exists, record `NOT_FOUND` before releasing the day for retry.
6. For `POSSIBLE_DUPLICATE`, require the user to adopt an accounting-equivalent journal or explicitly dismiss it.
7. For `EXTERNAL_CHANGE`, stop automation. Do not recreate, edit or delete the external journal.
8. For `CORRECTION_PARTIAL`, preserve the confirmed reversal and resume only the missing replacement. A newer source revision remains queued for a later correction.
9. For `ENTITLEMENT_BLOCKED`, retain the persisted day and its `blockedFromStatus`; restoring entitlement resumes that prior workflow state.

## Never do

- edit SQLite to force `POSTED`;
- delete an idempotency attempt to make a retry possible;
- add a balancing line;
- reuse a location across active workspaces;
- translate account, source or journal content;
- log credentials, source totals or guest/order data.

## Recovery objectives

Production operations target encrypted daily backups, RPO 24 hours and RTO 8 hours. A restore drill must prove that posting state and attempts survive restart before production activation. The drill must cover process interruption both before and after the QuickBooks commit.
