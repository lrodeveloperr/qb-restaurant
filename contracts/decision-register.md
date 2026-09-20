# Locked Implementation Decisions

## Product and tenancy

- The launch product is **Restaurant Sales Sync for QuickBooks**.
- Launch input is a supported restaurant sales CSV upload. There is no Toast API connection, polling, scheduler, partner dependency or Toast credential at launch.
- One workspace connects to exactly one QuickBooks realm and may contain many configured restaurant import locations.
- One source-location key may be active in only one workspace at a time.
- Roles remain `OWNER` and `MEMBER`. Owners control connections, members, billing and deletion. Both roles may map, review, post and correct.

## Authentication boundary

- Production authentication uses verified email one-time codes through a replaceable identity adapter.
- Intuit OAuth uses the minimum QuickBooks Accounting scope, a state value bound to the browser session and encrypted token storage.
- Disconnecting QuickBooks, transferring ownership or deleting a workspace requires recent reauthentication.
- The last owner cannot leave without transferring ownership.
- The engine enforces roles; email delivery, browser sessions, OAuth callback routing and token-vault operations belong to the production web shell.

## CSV input contract

- Canonical schema version is `1`.
- All money enters the canonical engine as non-negative safe integer cents. Source signs are normalized only by a versioned, explicit column rule.
- Country/currency pairs are only `US/USD` and `CA/CAD`.
- Business dates use ISO `YYYY-MM-DD`; the configured restaurant timezone controls the business date.
- Workspace, QuickBooks realm, internal location, source-location key, timezone, country and currency come from trusted configuration, never from user-editable CSV identity cells.
- A production import accepts only an exact known header profile. Unknown, duplicate or missing headers; malformed quoting; unexpected signs; more than two decimal places; mixed locations; files over 10 MiB; and inputs over 100,000 rows fail closed.
- One accepted row produces one location-day. The fingerprint is calculated per location-day, so changing one row never creates false revisions for other dates in the same file.
- Real anonymized US and Quebec Toast Sales Summary CSV files remain external launch evidence. Synthetic profiles prove architecture, not native Toast compatibility.
- There is no automated source-missing alert or nightly source recheck. Uploading a changed supported CSV for an already-posted date opens the correction workflow.

## Accounting contract

- Every non-zero category maps to one approved QuickBooks account and one explicit `Debit` or `Credit` direction.
- Zero categories are omitted and may remain unmapped.
- Debits and credits must match exactly to the cent. The system never creates a balancing or suspense line.
- Refunds, discounts, redemptions and other contra categories enter as positive cents with direction determined by the approved mapping.
- GST, QST and United States sales-tax totals are source amounts mapped to liability accounts. The app never calculates, files or advises on tax.
- Inactive, deleted or inaccessible accounts block posting. Closed accounting periods fail visibly; dates are never shifted.
- Default restaurant maps and fixtures are examples until Lateef approves the source semantics, account choices and directions against real CSV files.

## QuickBooks payload and identity

- `TxnDate` equals the confirmed restaurant business date.
- The stable `DocNumber` is at most 21 characters: `RSQ` + 8-character scope hash + `YYYYMMDD` + 2-digit sequence.
- `PrivateNote` contains the complete workspace/realm/location/date/correction identity.
- The 8-character scope hash is registered per workspace; a colliding location is rejected before posting.
- QuickBooks `DepartmentRef` is the selected QuickBooks location reference and is never an internal or source location ID. `ClassRef` is line-level when configured.
- `CurrencyRef` must match the QuickBooks company currency.
- An exact app reference is a hard duplicate and is adopted into the ledger.
- An unreferenced journal with the same date, department, currency, accounts, directions, amounts and classes is `POSSIBLE_DUPLICATE`; line order is irrelevant and a user must adopt or dismiss it.
- Every write first claims a durable local attempt. The stable attempt key is also sent as QuickBooks `requestid`.
- A network failure or server response that cannot establish whether a create committed becomes `OUTCOME_UNKNOWN`; the system queries the stable reference before retrying.
- A process-interrupted `POSTING` row is reconciled at startup. Interrupted corrections resume using their stable reversal and replacement references.

## Corrections and external changes

- A changed uploaded location-day after posting requires one full reversal followed by one replacement.
- The original QuickBooks journal must still match the stored snapshot before correction.
- An externally edited, voided or deleted journal becomes `EXTERNAL_CHANGE`; no automatic recreate, reversal or replacement occurs.
- If reversal succeeds and replacement fails, retry resumes without repeating the reversal.
- A newer upload replaces a correction that has not started. Once writes begin, the active snapshot remains immutable and the newer revision queues behind it.

## Trial, pricing and billing

- One 14-day no-card trial is available per workspace/QuickBooks realm and starts when the first live location is activated.
- Paid conversion is explicit; the app never charges without an approved payment method.
- Locked public price is US$29 per active posting location/month in the United States and C$39 per active posting location/month in Canada. There is no annual plan at launch.
- A billable location is an enabled QuickBooks posting destination, whether or not a CSV is uploaded that month.
- `Pause location` stops new QuickBooks writes immediately but does not cancel billing. Deactivation changes billing at renewal.
- A failed payment has seven days of posting grace; after that, new writes stop while history remains readable.
- A denied write persists `ENTITLEMENT_BLOCKED` with its prior workflow state so restored entitlement resumes safely.
- Cancellation leaves history/export available for 30 days.

## User workflow and alerts

- The launch flow is: connect QuickBooks, add location, upload supported CSV, validate, map, preview, explicitly post, retain proof, and correct by reversal plus replacement when necessary.
- Posting is sequential per location. A later write never overtakes an unresolved earlier write for that location.
- QuickBooks rate-limit retries honor `Retry-After` and remain capped at 24 hours.
- The first actionable posting failure sends one email; an unresolved failure may receive one reminder after 24 hours and one recovery message after resolution.
- There are no Toast retrieval failures, retry schedules or missing-day emails at launch.

## Data lifecycle and operations

- Active customers retain summarized source, mappings, journal snapshots and the posting ledger while subscribed.
- Raw uploaded files are processed for validation and should be deleted after the disclosed short diagnostic window; canonical location-day records are retained.
- Cancellation retains read/export access for 30 days, then primary customer data is purged within 30 additional days.
- Explicit deletion revokes external credentials before purge begins; encrypted backups age out within 35 days.
- Security logs contain no source totals or credentials and are retained for 90 days.
- Production hosting is Canada-primary with documented subprocessors and cross-border transfers.
- Daily encrypted backups target a 24-hour recovery point and eight-hour recovery time.

## Localization and support

- Launch locales are `en-US`, `en-CA`, `es-US` and `fr-CA`.
- English uses United States and Canadian formatting profiles.
- All engine messages, statuses, billing messages and accessibility labels require complete catalogs and placeholder parity.
- Account names, QuickBooks class/location names and source labels are never translated.
- Product help and email support are offered in English, United States Spanish and Quebec French.

## Performance and release state

- Normalization and preview target 250 ms p95 excluding network calls.
- A deterministic 25-location, 24-month preview dataset must complete in under 10 seconds and 256 MiB resident memory on the gate runner.
- Automated tests are necessary but do not make the candidate production-ready. `PROVISIONAL` remains until both real CSV/accounting fixtures, live US and CA QBO sandbox suites, independent review and the user acceptance harness pass.
