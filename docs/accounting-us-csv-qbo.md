# US CSV-to-QuickBooks accounting and review contract

Status: **PROVISIONAL — CSV-first implementation reconciled; real US Toast CSV, Lateef accounting approval and live US QBO proof required**

This note covers the United States half of the CSV-only launch decision. The local implementation now reflects the CSV-first contract, but it does not claim that a simulated mapping is accountant-approved, that the synthetic parser profile proves a real Toast export, or that a live QuickBooks Online journal has been created.

## Executive reconciliation

The repository now implements the CSV-only launch boundary. Direct Toast OAuth, polling, scheduling, source-missing alerts and certification dependencies have been removed from the launch contract. `TOAST_CSV_UPLOAD` is the only supported launch method.

The previously identified local structural gaps are resolved:

1. `src/adapters/restaurant-csv.js` implements an exact-header, profile-driven importer that binds workspace, realm, location, timezone, country and currency from trusted context. It creates a deterministic fingerprint per location-day, so changing one row in a multi-day file does not revise unchanged days. Its included Toast-style CSV remains synthetic, so native Toast compatibility is still externally blocked.
2. The selected QBO department/location reference is persisted separately from the internal/source location. `SyncEngine` supplies that selected reference to `buildJournal`; it is encoded as transaction-level `DepartmentRef` and tested not to equal the internal location ID.
3. The engine and QBO transport are asynchronous. `QuickBooksOnlineAdapter` and the OAuth helper implement local create/read/query, `requestid`, response verification, token refresh, rate-limit classification and unknown-create behavior.
4. Accounting equivalence canonicalizes the journal lines as an order-independent multiset. QBO returning the same lines in a different order no longer defeats exact-content, recovery or possible-duplicate matching.

Three US release blockers remain: a real anonymized Toast Sales Summary CSV, Lateef's approval of the resulting US journal, and successful live US/USD QBO sandbox contract runs.

## 1. CSV-first contract reconciliation

### Requirements and scope

| Contract item | Implemented disposition | Current status |
|---|---|---|
| `REQ-SCOPE-001` | Now specifies one supported restaurant-sales CSV location-day → one summarized QBO journal. | `LOCKED` |
| `REQ-TENANT-002` | Uses configured source location rather than assuming a Toast API location. | `LOCKED` |
| `REQ-INPUT-003` | CSV is promoted from pilot to launch input with strict size, row, header and quoting controls. | `LOCKED` |
| `REQ-CSV-PROFILE-001` | Adds exact versioned profiles, trusted identity context, explicit sign/precision rules and fail-closed schema behavior. | `PROVISIONAL` only because real US/Canada exports remain external. |
| Direct Toast requirement | Removed from launch; no OAuth, polling, scheduler or partner-access gate remains. | Implemented |
| `EXT-TOAST-ACCESS` | Removed. | Implemented |
| `EXT-US-FIXTURE` | Real anonymized US Toast Sales Summary CSV plus Lateef-approved journal. | `BLOCKED_EXTERNAL` |
| `EXT-CA-FIXTURE` | Real Quebec/CAD CSV plus approved journal. | Owned by Canadian workstream; `BLOCKED_EXTERNAL` |
| Launch method | Gate manifest now contains only `TOAST_CSV_UPLOAD`. | Implemented |

### Implemented CSV rules and remaining external proof

- The user selects the workspace and configured restaurant location **outside the file**. The adapter binds the upload to that trusted context and does not trust workspace, realm or QBO account identifiers supplied by a CSV.
- The importer accepts one explicitly named report profile per parser version. Similar-looking spreadsheets are rejected rather than guessed.
- A real anonymized Toast export is required before headers, required columns, total semantics, delimiter/encoding and report-version detection can be locked.
- Toast officially allows the Sales Summary report to be downloaded as CSV or XLS, so the no-API acquisition path is valid. Launch should name the exact supported route: **Toast Web → Reports → Sales → Sales summary → download CSV**. See [Toast Sales Summary Report Overview](https://support.toasttab.com/en/article/Sales-Summary-Report).
- The user confirms the location and business date detected from the report or supplied context. If either is absent or ambiguous, posting is blocked.
- Location timezone comes from the configured location and is displayed for confirmation. It is not inferred from a browser clock.
- `sourceVersion` is now a deterministic **per-location-day** identity derived from the parser profile, business date, location label and normalized categories. The regression suite proves that changing one row in a multi-day file leaves other days unchanged. A whole-file hash, if retained for upload evidence by the production shell, must remain separate from the accounting fingerprint.
- Uploading the same bytes again adopts the prior location-day and creates no new posting.
- Uploading different bytes for the same unposted location-day replaces the preview. Different bytes after posting open the existing reversal-and-replacement flow.
- The parser retains raw source labels for review, but only explicitly normalized accounting categories enter the journal.
- Unknown columns may be retained for diagnostics. Unknown or ambiguous **accounting-bearing** fields block the import.
- Sales-category labels are restaurant-configured and optional in Toast. The parser must not assume every restaurant has `Food` and `Beverage`, and an uncategorized non-zero bucket must block for mapping rather than disappear. Toast also says category changes affect future reports but do not rewrite existing reports. See [Toast sales-category guidance](https://doc.toasttab.com/doc/platformguide/adminAssigningSalesCategories.html).
- Service-charge names are also restaurant-configured and shown individually in Sales Summary. Treat newly observed non-zero names as new mapping categories; do not collapse them into tips or revenue by name alone. See [Toast service-charge reporting](https://doc.toasttab.com/doc/platformguide/adminServiceChargeViewing.html).
- Avoid the parser's permissive `ABSOLUTE` polarity for launch accounting fields: it can conceal a source sign reversal. Each supported Toast column should have a real-fixture-proven sign contract (`NON_NEGATIVE` or `NON_POSITIVE_TO_MAGNITUDE`) unless Lateef approves an explicit exception.
- CSV size, row, UTF-8/BOM, strict quoting, formula-safety, exact-header, sign, precision and row-count controls are implemented. Real Toast encoding, line endings, header layout and numeric formats still require the external US fixture.
- Raw uploads should be encrypted, access-controlled and deleted on a short disclosed schedule after normalization unless retention is necessary for a support dispute. The long-term ledger needs normalized totals and hashes, not guest/order detail.

### Implemented process, state and claim boundary

- The launch contract has removed `Connect Toast`, Toast OAuth, API certification, scheduled retrieval, finalization buffers, source-missing alerts, retrieval retry schedules and nightly API rechecks.
- The locked workflow is: connect QuickBooks → add restaurant location → upload supported CSV → validate → map → preview → explicitly post → retain proof.
- `WAITING` and `SOURCE_MISSING` are not CSV-source engine states. Absence of an upload is not a failed import.
- The state model retains `NEEDS_MAPPING`, `INVALID_SOURCE`, `READY_FOR_REVIEW`, `POSTING`, `OUTCOME_UNKNOWN`, `POSTED`, `ALREADY_POSTED`, `POSSIBLE_DUPLICATE`, `CORRECTION_REQUIRED`, `CORRECTION_PARTIAL`, `CORRECTED`, `EXTERNAL_CHANGE`, `FAILED` and `ENTITLEMENT_BLOCKED`.
- Posting requires explicit confirmation of unchanged source and accounting fingerprints. “Automatic posting” remains prohibited marketplace language.
- The submission pack now uses: “Import a supported Toast Sales Summary CSV, review a transparent balanced journal, and post it safely to QuickBooks Online.”
- The locked name remains `Restaurant Sales Sync for QuickBooks`; listing copy must clearly disclose manual CSV input before purchase.

### Implemented data-model boundary

- Persistence now uses `sourceLocationKey` for the configured source location and retains backward compatibility for the earlier SQLite column name.
- WorksBien location identity and optional QBO `DepartmentRef` are persisted separately. `ClassRef` remains an optional line-level mapping value.
- Close-time, Toast API connection and scheduled-sync behaviors are outside the launch contract.
- The launch data boundary retains location name, timezone, QBO location/class selection, mapping version, alert email and interface language.
- Treat the current canonical CSV as an internal test/import interchange format unless the final product deliberately offers a downloadable WorksBien template. Do not call it a Toast export.

## 2. Minimum production workflow and US accounting contract

### Minimum workflow

1. User signs in, creates a workspace and connects one US/USD QBO company.
2. App verifies the selected company and retrieves active posting accounts plus enabled class/location dimensions.
3. User creates a restaurant location, confirms its IANA timezone, and optionally selects a real QBO Location and/or Class.
4. User uploads a supported Toast sales CSV and confirms detected date/location.
5. Adapter validates the exact report profile and derives normalized, non-negative integer-cent categories without guessing.
6. User maps every non-zero category to an active QBO account and explicit debit/credit direction.
7. App previews every line, account, direction and cent total; debit must equal credit with no plug.
8. User confirms `Post to QuickBooks`.
9. Engine performs exact-reference and accounting-equivalence duplicate checks, durably claims the attempt, posts once and stores QBO proof.
10. A repeated identical upload adopts the existing day. A revised upload opens a visible correction; it never silently edits or deletes the original entry.

### Recommended US category semantics

The following are candidate defaults, not accounting approval. A category must be derived only once from the chosen Toast report. In particular, do not post gross sales plus a net-sales figure or net tenders plus their components.

| Normalized category | Candidate journal behavior | Approval/risk note |
|---|---|---|
| Food sales | Credit selected sales-income account | Confirm whether the source is gross before discounts/refunds. |
| Beverage/other sales | Credit selected sales-income account | Preserve the restaurant's sales-category granularity; no alcohol-specific fixture is assumed. |
| Discounts and comps | Debit contra-revenue, or approved expense | Lateef must approve policy; never silently combine with refunds. |
| Refunds/returns | Debit sales returns/contra-revenue or reverse original category | Confirm whether Toast already nets these from the sales fields. |
| Voids | Normally informational only if the transaction never completed | Do not post merely because a report displays a void statistic. Use only if the real export arithmetic proves an accounting effect. |
| Sales tax | Credit the selected sales-tax payable liability for the **source amount** | The app does not calculate tax. A JE to a liability account may not populate QBO's sales-tax subledger/return workflow; disclose and test this with the accountant. |
| Tips/gratuities | Credit tips payable/clearing liability | App does not allocate, payroll-process or pay tips. |
| Service charges | Credit revenue or liability according to policy | High-judgment item; legal/tax/payroll treatment can differ by restaurant and jurisdiction. |
| Gift cards sold | Credit gift-card liability | Third-party/vendor-managed programs may require due-to/from treatment. |
| Gift cards redeemed | Debit the same gift-card liability | Breakage and escheatment are outside the daily import. |
| Cash tender | Debit cash on hand or undeposited funds | Cash over/short must be a distinct source-backed category, never a balancing plug. |
| Card tender | Debit card/processor clearing or undeposited funds | Processor fees and deposits are reconciled separately. |
| Delivery-platform tender | Debit a platform clearing receivable | Prefer gross clearing; commissions/fees follow the settlement and are outside this daily journal. |

Toast's own refund guidance makes gross/net confirmation mandatory: ordinary refunds appear in payment-type refund fields, tips have a separate refunded-tip field, and custom-amount refunds can also appear as a negative Sales Category row. A parser that posts all visible refund fields without a reconciliation rule can double count. See [Toast refund reporting](https://doc.toasttab.com/doc/platformguide/adminViewingRefundsInToastReports.html). Likewise, `Expected Deposit` includes cash actions and claimed tips; it must not be assumed equal to cash tender without an approved cash-control policy. See [Toast cash-deposit reporting](https://doc.toasttab.com/doc/platformguide/adminCashDeposits.html).

The simulated v2 fixture encodes one coherent candidate journal:

- Debits: card clearing 1,100.00; cash 150.00; delivery clearing 130.00; discounts/comps 40.00; refunds 30.00; gift cards redeemed 60.00.
- Credits: food sales 1,000.00; nonalcoholic beverage sales 200.00; service charges 50.00; sales tax 90.00; tips payable 120.00; gift cards sold 50.00.
- Total debits and credits: 1,510.00.

This is deliberately labelled `SIMULATED_NOT_ACCOUNTANT_APPROVED`. Lateef must approve the source semantics, accounts and directions after reviewing a real Toast CSV and the restaurant's intended QBO journal.

### Invariants

- No negative canonical amount; the mapping direction carries the sign.
- No category can be both embedded in another source total and posted separately.
- No new non-zero label inherits a mapping by fuzzy name.
- No suspense, rounding or “difference” line is created.
- Currency must be USD and match the QBO company/home-currency contract.
- Journal date equals the confirmed Toast business date, not upload date or UTC date.
- Mapping changes are versioned; they never rewrite the evidence for an already posted day.
- Corrections are full reversal plus replacement only after the live original still matches the stored snapshot.

## 3. Implemented QBO JournalEntry adapter semantics

### Local implementation

The production-boundary code is no longer only a synchronous simulator:

1. `QuickBooksOAuthClient` generates a minimum-accounting-scope authorization URL and implements code exchange, refresh and revocation. Browser-session state validation and encrypted production token custody remain shell responsibilities.
2. `QuickBooksOnlineAdapter` asynchronously reads company information and active accounts, creates JournalEntry, reads by ID, queries deterministic `DocNumber`, and paginates same-date candidates for possible-duplicate comparison.
3. `SyncEngine` awaits QBO reads and writes throughout original posting, recovery, adoption, correction and external-change checks.
4. The durable attempt key is sent as QBO `requestid`; transport failures and unverifiable create responses become `OUTCOME_UNKNOWN`.
5. A 401 invokes one forced token refresh without changing the request, 429 exposes `Retry-After`, and a create-side 5xx remains an unknown outcome.
6. Payload encoding/decoding preserves currency, the actual selected QBO department, per-line class, accounts, posting directions and integer cents.
7. Local create-response verification and duplicate/recovery comparisons are line-order independent.

The US live-sandbox gate remains blocked. Local mocked HTTP tests prove control flow and payload shape, not that the selected QBO company accepts every field/dimension combination.

Intuit documents unique caller-generated `requestid` values as the reliable idempotency layer for duplicate avoidance. The app must still keep its local durable attempt ledger and deterministic `DocNumber`; no single mechanism is sufficient by itself. See [Intuit basic ID and field definitions](https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions).

### Implemented create request

- The adapter uses `POST /v3/company/{realmId}/journalentry?requestid={stable-id}` against the configured sandbox or production base URL and supports a configured minor version.
- The engine reuses the durable attempt identity and payload for the same attempt; loss of an HTTP response does not authorize a new identity or blind create.
- Integer cents are encoded as two-decimal QBO amounts and decoded back to integer cents for comparison.
- Payload fields:
  - `TxnDate`: confirmed business date;
  - `DocNumber`: deterministic engine reference, within the currently locked 21-character limit;
  - `PrivateNote`: complete stable app identity, within QBO field limits;
  - `CurrencyRef`: USD only if accepted/required by the tested company configuration; do not create an exchange-rate path at launch;
  - optional transaction-level `DepartmentRef`: the actual selected QBO reference, never the internal/source location ID;
  - `Line[].Amount`: positive decimal amount;
  - `Line[].DetailType`: `JournalEntryLineDetail`;
  - `Line[].JournalEntryLineDetail.PostingType`: `Debit` or `Credit`;
  - `Line[].JournalEntryLineDetail.AccountRef.value`: active QBO account ID;
  - optional `ClassRef.value`: actual active QBO class ID;
  - `Line[].Description`: stable human-readable source category, without customer/order data.
- Create responses are decoded and checked for stable reference, private note and complete accounting equivalence before a day becomes `POSTED`; an unverifiable success becomes `OUTCOME_UNKNOWN`.
- QBO's SDK schema exposes `AccountRef`, `ClassRef`, `DepartmentRef` and `PostingType` on JournalEntry line detail; actual JSON acceptance and dimension placement must be proven in both sandboxes rather than inferred from the simulator. See [Intuit JournalEntryLineDetail schema](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/JournalEntryLineDetail.html).

### Implemented lookup and equivalence

- Exact lookup uses a safely escaped QBO query for `JournalEntry.DocNumber`, then validates `PrivateNote` and full normalized accounting content. A same DocNumber with different content is a hard `REFERENCE_COLLISION`.
- Equivalent lookup queries same-date JournalEntry candidates with 1,000-record pagination and compares:
  - date and currency;
  - actual QBO location/department dimension;
  - every line's account, debit/credit, exact cents and class;
  - total debits/credits.
- Description, account name, line order and QBO-generated metadata do not control accounting equivalence. The engine sorts the normalized `(accountRef, postingType, amountCents, classRef)` line projection before hashing; transaction date, currency, department and totals remain part of the fingerprint.
- If an unreferenced equivalent exists, stop in `POSSIBLE_DUPLICATE`; adoption requires the user to choose that live JE. Dismissal is recorded before create is enabled.

### Error and retry classification

Use Intuit's current [Accounting API error catalogue](https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes) as the transport source of truth.

| Outcome | Engine behavior |
|---|---|
| Local validation failure | No API call; return actionable mapping/source error. |
| HTTP 400 validation/business fault | Known failed write; persist sanitized Intuit code/detail; no automatic retry until corrected. |
| HTTP 401 expired access token | Adapter refreshes once through its token provider and replays the same operation; persistent 401 requires reconnect. |
| HTTP 403/insufficient scope | Adapter returns `QUICKBOOKS_AUTH_REQUIRED`; production UI must request owner reconnection/permission. |
| HTTP 404 on GET/query target | Treat as not found only in the currently executing reconciliation/read context. Never convert a create timeout directly to failed from an HTTP status guess. |
| HTTP 429 | Adapter returns `QUICKBOOKS_RATE_LIMITED` with parsed `Retry-After`; production orchestration must schedule the bounded retry without changing payload or `requestid`. |
| HTTP 5xx, gateway error, timeout, connection reset after create dispatch | `OUTCOME_UNKNOWN`; query the stable DocNumber before any create retry. |
| QBO account/class/location inactive or inaccessible | Known blocked mapping; refresh reference lists and require remap. |
| Closed books/closed period | Fail visibly; never move `TxnDate`. |
| QBO company/subscription unavailable | Block connection/write, preserve the upload and preview, and require restoration/reconnection. |

### Required US/USD sandbox scenarios

1. OAuth connect, refresh and revoke; reconnect after invalid refresh grant.
2. Company/realm mismatch and non-USD rejection before activation.
3. Read active/inactive accounts and optional classes/locations.
4. Create the approved US fixture with no dimension, then with the supported QBO location/class combinations.
5. Exact cents and echoed-response verification.
6. Repeat identical command: one JE only.
7. Timeout after commit: query/adopt, no second JE.
8. Timeout before commit: query finds none, then retry same payload/request ID safely.
9. Process stop after dispatch and before local commit: startup reconciliation.
10. Existing same DocNumber/different content: hard collision.
11. Existing unreferenced accounting-equivalent JE: possible-duplicate adopt and dismiss paths.
12. Inactive account/dimension, permission failure, 401 refresh, 429 with `Retry-After`, 5xx and closed-period failure.
13. Revised CSV: one reversal and one replacement; interruption after reversal resumes replacement only.
14. External edit, void or deletion of the original: `EXTERNAL_CHANGE`, no automated recreate.
15. Locale switch `en-US` to `es-US`: identical accounting payload and references.

## 4. US billing and commercial implications

- Locked launch pricing is US$29 per active posting location/month in the United States and C$39 per active posting location/month in Canada. There is no annual launch plan. The continuing value is saved mappings, exact journal preview, duplicate-safe posting, correction workflow and history—not unattended Toast automation.
- A location is billable while enabled as a QBO posting destination, whether the customer uploads during that month or not.
- `Pause location` stops new QBO writes immediately but does not cancel billing; deactivation controls billing at renewal.
- The 14-day no-card trial starts when the first live location is activated and never auto-converts to paid.
- The commercial contract has no setup fee, overages or transaction limit; conversion is explicit, failed payments receive seven days of grace, and cancellation preserves history/export for 30 days.
- Expiry blocks new QBO writes while preserving readable history and export; previously posted evidence is not stranded.
- Listing, checkout and onboarding must say that users export a Toast CSV and upload it. Do not use “automatic daily sync,” “real-time,” “connect Toast,” “scheduled retrieval,” or equivalent wording.
- Manual CSV reduces onboarding/security cost and eliminates Toast API fees/certification, but it also weakens the automation comparison with Shogo/xtraCHEF. The $29 value proposition therefore depends on a very short upload-to-post path and visibly superior correction/recovery.

## 5. US marketplace reviewer fixture and evidence pack

Intuit states that marketplace apps undergo review for quality, functionality and branding, including technical, security and marketing review. See [List your app on our marketplaces](https://developer.intuit.com/app/developer/qbo/docs/go-live/list-on-the-app-store), [technical requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/technical-requirements), [security requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/security-requirements) and [marketing requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/marketing-requirements).

### Reviewer data pack

- One dedicated US reviewer account with a reset function and no production customer data.
- One accessible US/USD QBO sandbox company populated with the exact fictional accounts referenced by the approved fixture; optional class/location dimensions configured for their test steps.
- One **real-format but anonymized** Toast CSV whose accounting fields reconcile to an approved expected journal. The included JSON v2 fixture is only a simulated interim oracle.
- One revised version of that same business day for correction testing.
- One unreferenced equivalent JE pre-seeded for possible-duplicate testing.
- A mapping manifest showing source label → normalized category → QBO account ID/name → direction → approval date/version.
- Expected payload and expected canonical response, with secrets/tokens removed.

### Reviewer walkthrough

1. Sign in using supplied reviewer instructions.
2. Connect/select the US sandbox QBO company.
3. Create/select the restaurant location and actual QBO dimension.
4. Upload the US Toast CSV.
5. Review detected location/date and map any deliberately unmapped category.
6. Preview the 12-line approved balanced journal and post it.
7. Open the resulting QBO JE from the stored ID and compare date, reference, accounts, directions, dimensions and amounts.
8. Upload the identical file again and verify `ALREADY_POSTED` with no second JE.
9. Exercise possible-duplicate adopt/dismiss using the seeded equivalent JE.
10. Upload the revised file and complete reversal-and-replacement correction.
11. Disconnect QBO, reconnect, export history, then demonstrate workspace deletion/token revocation.

### Evidence to retain

- build/commit hash; parser profile and fixture hashes; sandbox realm alias (not secret); test date;
- redacted HTTP request/response evidence for OAuth, account/dimension reads, create, exact lookup and retry/recovery;
- request ID, DocNumber, JE ID and SyncToken lineage without bearer/refresh tokens;
- automated results for balance, duplicate, timeout, restart, correction, CSV malformed/schema drift and localization parity;
- screenshots/video showing CSV disclosure, consent before posting, successful JE in QBO, duplicate prevention, correction and disconnect/delete;
- privacy policy, terms/EULA, support, launch, redirect, disconnect and deletion URLs;
- data inventory and retention schedule showing no cardholder, guest/order or employee payroll detail is required;
- owner contact, reviewer credentials delivered through Intuit's approved secure field, pricing/trial/cancellation disclosure and support response path.

### Submission claim boundary

The reviewer and public listing may claim only: supported Toast CSV import, transparent mappings, balanced journal preview, confirmed QBO posting, duplicate protection, correction and history for US/USD. They may not claim live Toast connectivity or automatic daily retrieval. The technical gate stays `PROVISIONAL` until the real Toast-format parser fixture, Lateef-approved expected journal and live US/USD QBO contract suite pass.

## Decisions requiring Lateef

1. Approve each debit/credit mapping after comparing the real Toast export with the intended US JE.
2. Confirm gross-versus-net semantics so discounts, refunds, taxes, tips, gift cards and tenders are not double counted.
3. Decide service-charge treatment for the target restaurant pattern.
4. Confirm whether sales tax posted by JE to the chosen liability account is acceptable despite any QBO sales-tax-center/subledger limitation.
5. Confirm clearing-account choices for card and third-party delivery tenders and that settlement/fee reconciliation remains excluded.
