# Locked Implementation Decisions

## Product and tenancy

- One workspace connects to exactly one QuickBooks realm.
- One workspace may contain many Toast locations.
- One Toast location may be active in only one workspace at a time.
- A user may belong to multiple workspaces; cross-realm consolidated posting is excluded.
- Roles remain `OWNER` and `MEMBER`. Owners control connections, members, billing and deletion. Both roles may map, review, post and correct.

## Authentication boundary

- Production authentication uses verified email one-time codes through a replaceable identity adapter.
- Disconnecting an accounting/POS connection, transferring ownership or deleting a workspace requires recent reauthentication.
- The last owner cannot leave without transferring ownership.
- The engine enforces roles; email delivery and browser sessions belong to the later web shell.

## Input contract

- Canonical schema version is `1`.
- All money enters the canonical engine as non-negative safe integer cents. Raw connector signs are normalized before entry.
- Country/currency pairs are only `US/USD` and `CA/CAD`.
- Business dates use ISO `YYYY-MM-DD`; the Toast location timezone controls the business date and daylight-saving behavior.
- Unknown fields may be retained by an adapter for diagnostics but never affect posting. Missing required or unsupported schema fields block the day.
- The CSV bridge has a fixed header, a 10 MiB limit and 100,000-row limit.
- Retrieval begins at configured close time plus 120 minutes. A location processes oldest business dates first with one write in flight.
- Posted Toast days are rechecked nightly for 14 calendar days. A changed fingerprint opens correction; nothing is changed silently.

## Accounting contract

- Every non-zero category maps to one approved QuickBooks account and one explicit `Debit` or `Credit` direction.
- Zero categories are omitted from the journal and may remain unmapped.
- Debits and credits must match exactly to the cent.
- Refunds, discounts, redemptions and other contra categories enter as positive cents with direction determined by the approved mapping.
- GST, QST and United States sales-tax totals are source amounts mapped to liability accounts. The app never calculates, files or advises on tax.
- Inactive, deleted or inaccessible mapped accounts block posting.
- Closed accounting periods fail visibly. The app never rolls a journal to a different date.

## QuickBooks payload and identity

- `TxnDate` equals the Toast business date.
- The stable `DocNumber` is exactly 21 or fewer characters: `RSQ` + 8-character scope hash + `YYYYMMDD` + 2-digit sequence.
- `PrivateNote` contains the complete workspace/realm/location/date/correction identity.
- The 8-character scope hash is registered per workspace; a colliding location is rejected before it can post.
- QuickBooks Location/Department is transaction-level; Class is line-level when configured.
- An exact app reference is a hard duplicate and is adopted into the local ledger.
- An unreferenced journal with the same date, location dimension, accounts, directions and amounts is `POSSIBLE_DUPLICATE`; the user must adopt or dismiss it.
- Every external write first claims a durable local attempt. Identical retry attempts reuse the same idempotency key as the QuickBooks `requestid` and reuse the same payload.
- A process-interrupted `POSTING` row is reconciled by `DocNumber` at startup before it may become retryable; interrupted `CORRECTING` rows become resumable partial corrections using their stable references.

## Corrections and external changes

- A changed Toast source after posting requires one full reversal and one replacement.
- The original journal must still match the stored snapshot before correction.
- An externally edited, voided or deleted journal becomes `EXTERNAL_CHANGE`; no automatic recreate, reversal or replacement occurs.
- If a reversal succeeds and replacement fails, retry resumes from the durable partial state and never repeats the reversal.
- A newer revision replaces a correction that has not started. Once correction writes begin, the active source snapshot is immutable and a newer revision queues for the next correction.

## Trial and billing

- One 14-day trial is available per workspace/QuickBooks realm and starts when the first live location is activated.
- No card is required for the trial. All selected locations receive the full workflow during the trial.
- Paid conversion is explicit; the app never charges without an approved payment method.
- A billable location is one with scheduled sync enabled. Adding a location is prorated; removing it ends billing at renewal.
- `Pause sync` stops retrieval and posting immediately but does not cancel billing.
- A failed payment has a seven-day grace period; after that, new posting stops while history remains readable.
- A denied write persists `ENTITLEMENT_BLOCKED` with the prior workflow state so restored entitlement resumes safely.
- Cancellation leaves history/export available for 30 days.

## Scheduling and alerts

- Source retrieval retries after 15, 30, 60, 120, 240, 480, 720 and 1,440 minutes.
- QuickBooks rate-limit retries honor `Retry-After` and remain capped at 24 hours.
- The first actionable failure sends one email; unresolved failures receive one reminder after 24 hours. Resolution may send one recovery message.
- Catch-up runs oldest-first per location. A newer day never overtakes an unresolved older write for that location.

## Data lifecycle and operations

- Active customers retain summarized source, mapping, journal and posting-ledger history while subscribed.
- Cancellation retains read/export access for 30 days, then primary customer data is purged within 30 additional days.
- Explicit deletion revokes tokens immediately, purges primary customer data within 30 days and ages encrypted backups out within 35 days.
- Security logs contain no source totals or credentials and are retained for 90 days.
- Production hosting is Canada-primary with documented subprocessors and cross-border transfers.
- Daily encrypted backups target a 24-hour recovery point and eight-hour recovery time.

## Localization and support

- Launch locales are `en-US`, `en-CA`, `es-US` and `fr-CA`.
- English is one language with United States and Canadian format profiles.
- All user-facing engine messages, statuses, billing messages and accessibility labels require complete catalogs and placeholder parity.
- Account names, class/location names and source labels are never translated.
- Product help and email support are offered in English, United States Spanish and Quebec French.

## Performance budgets

- Journal normalization and preview generation target 250 ms p95 excluding network calls.
- A deterministic 25-location, 24-month preview dataset must complete in under 10 seconds with under 256 MiB resident memory on the release-gate runner.
- A finalized valid source should reach a terminal posted/blocked state within 10 minutes when external APIs are healthy.
