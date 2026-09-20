# QuickBooks App Store submission pack

Product: **Restaurant Sales Sync for QuickBooks**  
Tagline: **Toast sales mapped right, posted once, and easy to fix.**  
Candidate status: **PROVISIONAL**

## Accurate customer claim

Import a supported Toast Sales Summary CSV, review a transparent balanced journal, and post it safely to QuickBooks Online with duplicate protection, durable recovery, correction history and English, US Spanish and Quebec French support.

Do not claim direct Toast connectivity, real-time or automatic sync, unattended retrieval, tax calculation/filing, reconciliation, or accountant approval.

## Commercial disclosure

- 14-day no-card trial; no automatic paid conversion.
- US$29 per active posting location/month in the United States or C$39/month in Canada; no annual plan at launch.
- A location is billable while enabled as a QBO posting destination.
- Pausing stops new QBO writes but does not cancel billing; deactivation changes billing at renewal.
- Manual CSV export/upload must be disclosed on the listing, checkout and onboarding pages.
- Quebec checkout must display C$39 per active posting location/month and applicable taxes before purchase.

## Reviewer walkthrough

1. Sign in with the reviewer account.
2. Connect the supplied QBO sandbox through OAuth.
3. Add the supplied restaurant location and select the QBO department if used.
4. Upload the supplied real-format anonymized CSV.
5. Review detected location/date, all source categories, accounts, debit/credit directions, classes, department and exact debit/credit totals.
6. Confirm the unchanged source and accounting fingerprints, then post.
7. Show the JournalEntry in QBO with its date, `DocNumber`, note, currency and dimensions.
8. Post the same day again and prove no second journal is created.
9. Upload a changed version of that day and demonstrate full reversal plus replacement.
10. Demonstrate a timeout/unknown-outcome recovery and an externally edited-journal block.
11. Pause the location and demonstrate that posting stops while history remains visible.
12. Disconnect QBO and demonstrate credential revocation.

Repeat the accounting flow in both a US/USD and Canada/CAD sandbox. Provide a Quebec French walkthrough or captions for the CA review evidence.

## Technical evidence checklist

- [x] Minimum QBO accounting scope in OAuth helper.
- [x] Stable `requestid`, `DocNumber` and `PrivateNote` identity layers.
- [x] Currency, QBO department and line class transport.
- [x] Durable attempt ledger and interruption recovery.
- [x] Exact-reference and line-order-independent equivalent duplicate checks.
- [x] Reversal/replacement correction and external-change blocking.
- [x] Local QBO payload, OAuth, auth-refresh, rate-limit and unknown-outcome tests.
- [ ] Production OAuth callback and encrypted token vault.
- [ ] Live US/USD sandbox evidence.
- [ ] Live CA/CAD sandbox evidence.
- [ ] Production disconnect/revoke evidence.
- [ ] Reviewer credentials and stable demo data.

## Accounting evidence checklist

- [x] Expert US restaurant accounting workstream and simulated fixture.
- [x] Expert Canada/Quebec workstream with GST/QST and simulated fixture.
- [x] Source taxes remain unchanged; the app does not calculate tax.
- [ ] Real anonymized US Toast CSV and Lateef-approved expected journal.
- [ ] Real anonymized Quebec Toast CSV and Lateef-approved expected journal.
- [ ] Approved service-charge, tip, gift-card, refund, discount, tender and clearing-account policies.
- [ ] Confirmation that each supported report avoids gross/net double counting.

## Security and marketing checklist

- [x] CSV-only scope removes Toast credentials and partner dependency.
- [x] Secret scanner and deletion-order test in the automated gate.
- [x] Data-flow/control checklist in `docs/security-data-flow.md`.
- [ ] Deployed HTTPS application and Canada-primary hosting evidence.
- [ ] Privacy policy URL: **OWNER INPUT REQUIRED**.
- [ ] Terms URL: **OWNER INPUT REQUIRED**.
- [ ] Support URL and monitored support email: **OWNER INPUT REQUIRED**.
- [ ] Launch/landing URL with accurate CSV workflow and pricing: **OWNER INPUT REQUIRED**.
- [ ] Disconnect/delete instructions URL: **OWNER INPUT REQUIRED**.
- [ ] Logo, listing images, product walkthrough and production screenshots.
- [ ] Intuit security questionnaire/assessment and remediation evidence.
- [ ] Subprocessor, retention, deletion and cross-border disclosure.

## Intuit configuration inputs owned by the founder

- Intuit Developer production app and production client credentials.
- Exact redirect URIs for development, staging and production.
- US and Canadian sandbox companies with representative charts of accounts, departments and classes.
- Reviewer account, test CSV files and repeatable reviewer instructions.
- Legal entity name, address, support contacts, privacy/terms owners and incident contact.
- Billing provider account, actual CAD price presentation and tax configuration.

## Release rule

Do not submit while any critical external gate in `contracts/gate-manifest.json` is blocked. A passing local gate proves the candidate bundle is internally consistent; it does not substitute for real CSV semantics, live QBO evidence, deployed security controls or human accounting approval.
