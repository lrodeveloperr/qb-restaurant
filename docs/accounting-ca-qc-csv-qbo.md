# Canada/Québec CSV-to-QuickBooks production contract

**Review date:** 2026-09-20  
**Scope:** Canada/CAD, including Québec and `fr-CA`  
**Status:** `PROVISIONAL — ACCOUNTANT APPROVAL AND LIVE QBO CA SANDBOX PROOF REQUIRED`

This document is the independent Canada/Québec accounting and QuickBooks review for the CSV-only launch. It is not tax advice, an assurance opinion, or approval of a customer's chart of accounts. The fixture and account names are illustrative until Lateef approves the debit/credit treatment and GST/QST liability mappings.

## Executive conclusion

The repository now implements the CSV-only launch contract and local workflow. `TOAST_CSV_UPLOAD` is the only launch input method; direct Toast API access, scheduled retrieval and missing-day monitoring are excluded. The profile-driven `WIDE_DAILY_SUMMARY` adapter enforces an exact versioned header, explicit amount polarity, trusted workspace/location context and a deterministic per-location-day source version. `CsvPostingService` imports days for review and requires fingerprint-bound confirmation before its asynchronous posting path can write to QuickBooks.

Four previously open shared items are implemented and covered by automated tests:

1. **CSV-only contract:** `contracts/requirements.json`, `contracts/decision-register.md` and `contracts/gate-manifest.json` consistently make CSV upload the launch path and remove Toast API access from the release gate.
2. **Real QBO department reference:** restaurant-location configuration persists an optional QBO `departmentRef`; `SyncEngine` passes that value into `buildJournal()`. The internal/Toast location ID is never substituted, and the field is omitted when it is not configured.
3. **Asynchronous QBO adapter:** `QuickBooksOnlineAdapter` implements awaited create, read, exact-reference query and paginated equivalent lookup calls. The engine awaits those port methods, sends the durable attempt key as Intuit `requestid`, refreshes an access token once after HTTP 401, classifies uncertain create outcomes for reference recovery and verifies the returned journal before treating the write as committed.
4. **Line-order-independent equivalence:** `journalsEquivalent()` canonical-sorts accounting lines before hashing. The Canadian contract test and QBO adapter tests prove that a reordered but otherwise identical journal remains equivalent.

These are implemented local behaviours, not live certification. The Canadian input profile remains unproven because the bundled restaurant profile is a synthetic US shape rather than a captured Toast Canada export. A real anonymized Canadian Toast CSV, Lateef's accounting decisions and live CA/CAD QBO sandbox evidence remain release blockers.

## 1. Implemented CSV-first contract

The shared requirements, decision register and gate manifest now encode the following CSV-first rules. This table records the implemented contract transition; it is not an outstanding change list.

| Former direct-sync assumption | Locked CSV-first rule |
|---|---|
| `REQ-SCOPE-001`: a Toast location-day retrieved by integration | One supported restaurant-sales CSV is normalized into one restaurant location-day and then one summarized QBO journal. |
| CSV treated as a pilot input | `REQ-INPUT-003` makes CSV upload `LAUNCH`; the exact profile, amount format, file/date/location limits and safe error behaviour are release-critical. |
| Toast API access, credentials and connector certification | The Toast API requirement and external-access gate are absent. The replacement compatibility gate requires anonymized US and Canadian CSV fixtures, a versioned parser profile and expected canonical outputs. |
| Multiple source methods | The support matrix contains `TOAST_CSV_UPLOAD` only. Direct Toast remains excluded unless a later contract deliberately reopens it. |
| Restaurant/location identity accepted from a source connector | The importer binds workspace, QBO realm, restaurant and internal location from trusted application context. A configured source-location label may be compared with a CSV cell, but a CSV cannot choose its tenant or QBO company. |
| Source revision supplied by a connector | The restaurant adapter derives a deterministic source version per business date from the approved parser profile, source-location label and normalized category totals. |
| Toast timezone and close-time scheduling | Timezone belongs to the saved restaurant-location configuration. Manual CSV upload has no background close-time or finalization scheduler. |
| Automatic retrieval, catch-up and nightly rechecks | Upload immediately creates or revises each included day. A changed later upload for the same location/date enters the correction workflow. |
| `WAITING`, `SOURCE_MISSING`, retrieval retries and missing-day alerts | These are outside CSV launch. The product cannot infer that a file should exist and must not claim source monitoring. |
| Automatic posting | The application imports days for review and requires a confirmation containing the current source and accounting fingerprints. Confirmed valid days are then posted oldest-first; changed fingerprints reject stale confirmation. |
| Pause sync | The locked commercial control is **Pause posting**. It does not imply that a nonexistent source sync has been stopped. |
| Billable location means scheduled sync is enabled | A billable location is an activated restaurant location with saved mappings and QBO posting entitlement during the billing period. |
| Raw CSV retained implicitly | Raw-file handling remains governed by the security/retention contract: validate in a quarantined upload path, retain only the disclosed evidence/summaries, delete raw content after the disclosed short window and never log CSV rows. |

### Outstanding Canadian input-profile evidence

The adapter architecture is implemented, but Canadian Toast compatibility is not. The production profile must target one reproducible Toast export, not “any Toast CSV.” Toast's published accounting guidance describes tax, cash, card payments, tips, gift-card redemptions, deferred gift-card sales, refunds, gratuities, service charges and other entities, but the exact downloaded columns must be proven from a real customer export. Toast also states that Sales Summary net sales include refunds for the day, so the Canadian profile must document whether revenue lines are gross with separate contra lines or already net; it must never post both conventions and double-count a refund.

Until a real file establishes that convention:

- the bundled v2 fixture is a **canonical accounting fixture**, not proof of Toast CSV compatibility;
- non-zero voids are blocked from automatic journal construction unless the parser profile proves they are included in gross sales and Lateef approves a contra mapping;
- same-day voids excluded from finalized sales/tenders remain diagnostic only and do not become journal lines;
- a refund category is posted only when the chosen source profile's sales/tender totals require the separate contra line.

Official Toast evidence:

- [Create and Map General Ledger Codes for Toast POS](https://central.toasttab.com/articles/Knowledge/Creating-and-Mapping-General-Ledger-Codes) identifies tax, cash, card payments, gift-card redemptions, tips, gift-card sales, refunds, gratuities, service charges and other accounting entities.
- [Issue a Refund](https://central.toasttab.com/articles/en_US/Knowledge/Issuing-a-Refund) distinguishes same-day voids from post-capture refunds and states that Sales Summary net sales include issued refunds.
- [Understand Cash Adjustments on Reports](https://central.toasttab.com/articles/Knowledge/What-Contributes-to-Cash-Adjustments-on-the-Sales-Summary-Z-Report) shows that cash adjustments, tip-outs and cash payments have different reporting treatment.

## 2. Minimum Canada/Québec production workflow

1. Owner connects one QuickBooks Online company through Intuit OAuth.
2. App reads and stores the realm ID, confirms a Canadian company and CAD home/transaction currency, and loads active accounts plus optional QBO Classes and Locations.
3. Owner creates a restaurant location, selects `America/Toronto` or the applicable IANA timezone, and optionally selects a real QBO Location/Department ID.
4. User uploads the supported Toast CSV. The server MIME-sniffs and size-checks it, rejects formulas/malformed quoting/mixed identities, and displays the detected restaurant location, business date and totals before committing.
5. Vendor adapter normalizes source signs and amounts once. The canonical engine continues to receive non-negative integer cents; direction comes only from the approved mapping.
6. App surfaces every non-zero accounting category and requires a saved QBO account plus Debit/Credit direction. A zero category may remain unmapped.
7. App generates a balanced CAD preview. GST and QST shown in the preview are the **source-supplied totals**; the app performs no rate calculation, return preparation or filing.
8. User confirms the journal. The app durably claims the write, checks for an existing stable reference/equivalent journal and then creates the QBO JournalEntry at most once.
9. A repeated identical upload adopts the already-posted day. A changed upload for the same location/date shows the differences and, after confirmation, uses one full reversal and one replacement.
10. History records the source hash/profile, canonical totals, mapping version, QBO ID/reference, attempts and correction chain. Interface locale can switch between `en-CA` and `fr-CA` without changing any accounting bytes.

### Canada/CAD journal behaviour

All amounts below are imported values. The engine does not derive any one of them from another.

| Source category | Illustrative journal role | Required behaviour |
|---|---|---|
| Food/beverage sales | Credit revenue | Preserve the selected Toast profile's gross-or-net convention; never mix conventions. |
| Discounts/comps | Debit contra-revenue or approved expense | Positive cents with the approved debit mapping. Do not infer the account. |
| Refunds | Debit contra-revenue/original category only when separately required by the source profile | Block if including the line would duplicate a refund already netted into sales/tenders. |
| Voids | Normally no journal line when excluded from finalized sales and captured tenders | Non-zero posting requires a proven source convention and explicit approval. The CA v2 fixture uses zero and leaves it unmapped. |
| GST/TPS | Credit customer-selected GST liability account | Preserve exact source cents; no tax-rate validation, calculation or filing. |
| QST/TVQ | Credit customer-selected QST liability account | Preserve exact source cents; keep separate from GST. |
| Voluntary tips | Credit tips-payable/clearing liability | Preserve exact source amount. Do not treat it as restaurant revenue or calculate tax. |
| Mandatory/suggested service charge | Credit revenue or liability as approved | Keep distinct from voluntary tips. Revenu Québec says mandatory or suggested service charges on the bill are taxable, but classification between revenue and an employee liability remains customer/accountant policy. |
| Gift cards sold | Credit customer-selected gift-card liability in the illustrative workflow | Do not add GST/QST to the sale of the gift card. Lateef must approve the financial-reporting policy. |
| Gift cards redeemed | Debit the approved gift-card liability | GST/QST belongs to the underlying goods/services and must already be present in the source tax totals. |
| Cash | Debit cash/undeposited-funds account | Import the finalized tender total; do not infer bank deposits. |
| Card/other/delivery tenders | Debit the relevant processor or clearing account | Keep processors separate when the customer wants deposit reconciliation; no bank-feed reconciliation is promised. |
| Over/short or plug | **Never generated** | A source imbalance blocks. An explicit source cash-over/short category may post only to a separately approved account; it cannot be invented to balance the journal. |

Revenu Québec confirms that freely offered tips are not subject to GST/QST while mandatory or suggested service charges are taxable. It also confirms that gift-card sales are not taxable and tax applies when the card is used for taxable goods/services. See [Tips and Service Charges](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/special-cases-gsthst-and-qst/food-services-sector-applying-the-gst-and-qst/tips-and-service-charges/) and [Gift Cards and Gift Certificates](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/special-cases-gsthst-and-qst/gift-cards-and-gift-certificates-gsthst-and-qst/). Revenu Québec's mandatory-billing guidance also requires distinct pre-tax, GST, QST and after-tax amounts and says the pre-tax subtotal includes service charges: [Amounts to Be Sent](https://www.revenuquebec.ca/en/businesses/sector-specific-measures/mandatory-billing/mandatory-billing-sending-information/mandatory-billing-amounts-to-be-sent/).

### Required approval from Lateef

| Decision | Fixture assumption awaiting approval |
|---|---|
| Food and beverage | Credit separate revenue accounts. |
| Discounts | Debit contra-revenue. |
| Refunds | Debit contra-revenue under a gross-sales source convention. |
| Service charges | Credit service-charge revenue; source GST/QST totals already include applicable tax. If amounts are owed to employees, use a liability instead. |
| Voluntary tips | Credit tips-payable liability. |
| Gift cards sold/redeemed | Credit/debit the same gift-card liability. |
| GST and QST | Credit separate GST-payable and QST-payable accounts selected from the customer's QBO company. |
| Tenders | Debit cash, card-clearing and delivery-platform clearing accounts. |
| Voids | Zero/no posting line in the supported net-finalized source profile. |

Approval applies only to the exemplar pattern. Each customer still approves its own account IDs and mapping version; the app must never describe mappings as accountant-approved merely because a template suggested them.

## 3. Exact QuickBooks Online adapter semantics

### Connection and master-data checks

- OAuth scope is the minimum QBO accounting scope required by Intuit.
- Persist the authorized `realmId` only in the workspace connection; never accept it from CSV.
- Read CompanyInfo/currency settings and require Canada/CAD for this path. A multicurrency-enabled Canadian company is allowed only when the created journal is CAD and no foreign exchange or home-currency adjustment is requested.
- Read active QBO accounts by immutable ID. Names are display snapshots only; posting always uses the ID. Inactive, deleted or inaccessible accounts block preview/posting.
- Read QBO Classes and Locations/Departments only when configured. `DepartmentRef` and `ClassRef` are QBO IDs, never Toast IDs.

Intuit defines JournalEntry as debit/credit lines whose totals must balance and documents a maximum 21-character `DocNumber`. It also documents `DepartmentRef` as the QBO Location dimension and `CurrencyRef` as the transaction currency. References: [JournalEntry SDK definition](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/JournalEntry.html), [DocNumber](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/742f6ef7-c205-6638-b4ee-44c169d17d32.htm), [JournalEntry properties](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm) and [JournalEntryLineDetail properties](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/62627c63-90a3-c87a-ef9b-8b4b06daee08.htm).

### Create payload

Use `POST /v3/company/{realmId}/journalentry?requestid={stableAttemptKey}&minorversion={pinnedVersion}`. Convert integer cents to a JSON decimal with exactly two fractional digits at the transport boundary. The logical payload is:

```json
{
  "TxnDate": "2026-09-18",
  "DocNumber": "<deterministic, <=21 chars>",
  "PrivateNote": "<full WorksBien location-day/correction identity>",
  "CurrencyRef": {"value": "CAD"},
  "DepartmentRef": {"value": "<optional QBO Location ID>"},
  "Line": [
    {
      "Amount": 1220.18,
      "Description": "Card tender — card",
      "DetailType": "JournalEntryLineDetail",
      "JournalEntryLineDetail": {
        "PostingType": "Debit",
        "AccountRef": {"value": "<QBO account ID>"},
        "ClassRef": {"value": "<optional QBO Class ID>"}
      }
    }
  ]
}
```

- Omit `DepartmentRef`/`ClassRef` when not configured; never send empty references.
- Do not send `TxnTaxDetail`, tax rates, tax codes, exchange rates or `HomeCurrencyAdjustment`. GST/QST are ordinary mapped liability lines using source amounts.
- Claim the local attempt before the POST. Identical retries reuse the exact request ID, DocNumber, PrivateNote and payload bytes.
- Treat a 2xx response as committed only after it contains an ID and the adapter can normalize/read back the expected date, references, currency and accounting lines.
- Normalize create and read responses into the internal journal model, stripping QBO-generated line IDs/timestamps so later external-change detection does not fail merely because QBO reordered fields or added metadata.

### Lookup, duplicates and recovery

1. Exact lookup searches JournalEntry by deterministic DocNumber in the connected realm and confirms PrivateNote plus the canonical accounting fingerprint. Zero matches means not found; more than one is a collision requiring manual review.
2. Equivalent lookup examines JournalEntry candidates for the same transaction date and optional QBO DepartmentRef, then compares an order-independent multiset of `(accountRef, PostingType, amount, classRef, departmentRef)` lines. It does not compare descriptions or account names.
3. A network timeout, connection reset, malformed 2xx response or HTTP 5xx after submission becomes `OUTCOME_UNKNOWN`. Query the stable DocNumber before any new create.
4. If exact content exists, adopt it and store its QBO ID. If the DocNumber exists with different content, block as `REFERENCE_COLLISION`. If it does not exist, record `NOT_FOUND` before permitting one exact retry.
5. Corrections use deterministic sequence references, one reversal then one replacement. Each write has its own durable attempt/request ID and is recovered independently.

### Error classification

| Response/condition | Adapter result |
|---|---|
| 400 validation/business fault, inactive account/dimension, closed books | Deterministic failure; no blind retry. Refresh master data when relevant and show a safe, actionable error. Never change `TxnDate`. |
| 401 | Refresh once. If refresh fails, require reconnection. If the request outcome could be ambiguous, run stable-reference recovery before create. |
| 403 | Permission/scope block; require an authorized QBO admin or reconnection. |
| 404 for referenced entity/realm | Block and revalidate the company or mapping; do not substitute another account/location. |
| 429 | Honor `Retry-After`, preserve the claimed attempt and cap automated delay at the contract's 24-hour limit. |
| 5xx, gateway timeout, socket timeout/reset, truncated response | `OUTCOME_UNKNOWN`; query before retry. |
| 2xx without a usable QBO ID or with mismatched read-back | `OUTCOME_UNKNOWN` or reference collision, never `POSTED`. |

### Mandatory CA/CAD sandbox scenarios

1. Connect a Canadian QBO sandbox and prove Canadian company/CAD validation.
2. Load active accounts, one optional Class and one optional QBO Location; prove Toast and QBO location IDs cannot be confused.
3. Create the v2 fixture journal and read it back with exact CAD cents, separate GST/QST liability lines and no tax-calculation fields.
4. Run the same fixture under `en-CA` and `fr-CA`; the QBO payload and accounting fingerprint must be identical.
5. Replay the same create repeatedly; only one journal may exist.
6. Simulate timeout before commit and after commit; prove query-before-retry and one final journal.
7. Seed an equivalent manual journal with reordered lines; it must become `POSSIBLE_DUPLICATE`.
8. Deactivate the GST or QST account after mapping; posting must block.
9. Close the accounting period; the business date must fail visibly and never roll forward.
10. Exercise OAuth expiry/refresh, failed refresh/reconnect and HTTP 429 `Retry-After`.
11. Edit and delete the posted journal externally; automatic correction must block.
12. Upload a revised Canadian CSV and prove one reversal plus one replacement without repeating a successful reversal.
13. Prove accents and French account names survive round-trip without being translated or corrupted.

## 4. Canadian billing and Québec-French implications

- Keep the locked Canadian price at **C$39 per activated restaurant location/month**, plus applicable tax, with a 14-day no-card trial, no setup fee and no per-file/transaction overage.
- Trial begins when the owner activates the first real location for posting, not when viewing sample data. It never auto-converts without an approved payment method.
- Manual upload means a location is billable for access to saved mapping, validation, QBO posting, duplicate recovery, correction and history—not for unattended sync.
- “Pause sync” is misleading. Use **Pause posting** (billing unchanged) and **Deactivate location** (ends billing at renewal). History/export remains available for the disclosed retention window.
- Billing systems must add GST/HST/QST according to WorksBien's registrations and the customer's place of supply; rates must not be hard-coded into the product price. Revenu Québec's place-of-supply example states that when the purchaser's relevant address is in Québec, GST and QST apply to the service: [Sales of Services](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/place-of-supply/sales-of-services/).
- Québec-facing app, onboarding, pricing, help, notices and commercial web/listing copy must be genuinely available in French. The OQLF states that commercial publications of businesses operating in Québec must be in French: [Langue du commerce et des affaires](https://www.oqlf.gouv.qc.ca/francisation/droits_linguistiques/droits/langue-du-commerce-et-des-affaires.html).
- Any standard-form customer contract offered in Québec should be supplied in French first; an English version may be chosen after the French version is provided. See [Contrats d'adhésion](https://www.oqlf.gouv.qc.ca/francisation/entreprises/contrats-adhesion.html). Legal counsel should confirm the final WorksBien terms.
- Account names, class/location names and source labels are customer accounting data and remain unchanged. Only interface labels/help are localized.

### Locked `fr-CA` terminology

| English | Québec French |
|---|---|
| Upload CSV | Téléverser le fichier CSV |
| Drop your CSV here | Déposez votre fichier CSV ici |
| Journal entry | Écriture de journal |
| Chart of accounts | Plan de comptes |
| Account mapping | Mise en correspondance des comptes / mappage des comptes |
| Map an account | Associer un compte |
| Business date | Date d'exploitation |
| Debit / Credit | Débit / Crédit |
| GST / QST | TPS / TVQ |
| Tips payable | Pourboires à payer |
| Gift cards | Cartes-cadeaux |
| Service charges | Frais de service |
| Discounts | Rabais |
| Refunds | Remboursements |
| Voids | Opérations annulées |
| Tender / payment type | Mode de paiement |
| Clearing account | Compte d'attente |
| Ready for review | Prêt à vérifier |
| Posted | Comptabilisé |
| Possible duplicate | Doublon possible |
| Post to QuickBooks | Comptabiliser dans QuickBooks |

OQLF specifically prefers **téléverser** for “upload,” **écriture de journal** for “journal entry,” and **plan de comptes** for “chart of accounts”; it recognizes **mise en correspondance** and **mappage** for data mapping. References: [téléverser](https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/2075523/televerser), [écriture de journal](https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/503234/ecriture-de-journal), [plan de comptes](https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/500572/plan-de-comptes), [mise en correspondance](https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/8873847/mise-en-correspondance).

## 5. Canada/Québec marketplace review evidence

The reviewer pack must contain:

1. **Resettable CA/CAD demo company:** synthetic Montréal restaurant, no personal information, with active demo accounts for revenue, GST payable, QST payable, tips payable, gift-card liability and tender clearing.
2. **Two CSV files:** the valid v2 fixture rendered in the exact supported Toast export layout, plus one malformed/unbalanced file that visibly blocks without writing to QBO.
3. **Reviewer steps in English and `fr-CA`:** connect the Intuit sandbox, choose the demo company, bind the restaurant location, upload, confirm detected date/totals, review mapping, preview and post.
4. **Expected journal sheet:** every line, direction and cent amount; conspicuously labelled “illustrative test oracle — not accountant-approved and not tax or accounting advice” until Lateef approves the real-source result.
5. **Safety evidence:** repeated upload produces no duplicate; timeout recovery; revised upload creates one reversal and one replacement; inactive GST account blocks; closed period does not change the date.
6. **Localization evidence:** the full workflow, billing disclosure, errors, privacy/retention notice, support and disconnect/deletion instructions in natural `fr-CA`; accounting output identical to `en-CA`.
7. **Security evidence:** CSV data-flow diagram, encryption, raw-file deletion window, no Toast credentials/API, least-privilege QBO scope, encrypted token vault, token revocation and workspace deletion.
8. **Commercial evidence:** C$39/location/month plus applicable tax, 14-day no-card trial, no automatic conversion, cancellation/deactivation effect and support contact.
9. **Reviewer account and URLs:** production launch, redirect, disconnect, privacy, terms and support URLs; stable demo credentials delivered through Intuit's approved reviewer channel, never committed to the repository.

Intuit's current partner guide says production access requires an approved assessment questionnaire and marketplace publication adds security, technical and marketing reviews: [Intuit App Partner Program Guide](https://static.developer.intuit.com/resources/Intuit_App_Partner_Program_Guide.pdf).

## Release status and remaining evidence

`PROVISIONAL`. The deterministic CA fixture and local engine tests can prove arithmetic preservation and journal balance. They cannot prove:

- the exact columns/sign convention of a real Toast Canada CSV;
- Lateef's approval of the debit/credit and GST/QST liability mappings;
- QBO CA acceptance of the final payload and `requestid` recovery semantics;
- Québec customer comprehension or native-language QA;
- the marketplace security, technical or marketing review outcome.

Those five items remain external gates.
