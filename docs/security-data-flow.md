# Security and data-flow evidence

## Data flow

1. An authenticated user selects a configured restaurant location.
2. The server supplies trusted workspace, QuickBooks realm, location, timezone, country and currency context.
3. The CSV importer reads the upload with an exact versioned profile and produces canonical per-day category totals.
4. The application stores the canonical source, approved mapping, immutable journal preview and durable attempt state in the workspace scope.
5. Only after explicit fingerprint confirmation does the server send the locked journal to the workspace's QBO company.
6. The application stores the QBO ID and verified snapshot for audit and correction.
7. Workspace deletion revokes QBO credentials before customer-data purge.

## Sensitive-data controls

- Request only the QuickBooks Accounting OAuth scope.
- Bind OAuth state to the initiating session and reject a missing/mismatched/expired callback.
- Encrypt refresh tokens in a dedicated secret vault; never put tokens in SQLite, logs, fixtures or browser storage.
- Bind CSV tenant identity from authenticated server state, not uploaded cells.
- Limit uploads to 10 MiB and 100,000 data rows; reject malformed quoting, schema drift, sub-cent precision and unsupported signs.
- Retain only summarized location-day accounting data after the disclosed raw-file diagnostic window.
- Exclude guest, order, cardholder, payroll, inventory and bank-feed data.
- Use parameterized SQLite operations and redact source totals from security logs.
- Require recent reauthentication for QBO disconnect, ownership transfer and workspace deletion.
- Revoke external credentials before purge and document encrypted-backup expiry.

## Required production evidence

- data-flow and threat-model review;
- encryption-at-rest/in-transit configuration;
- secret-vault access policy and key rotation;
- dependency and secret scans;
- authorization/tenant-isolation tests;
- upload malware/content handling policy at the web edge;
- incident response, vulnerability disclosure and security contact;
- privacy, retention, deletion and subprocessor disclosures;
- live OAuth connect/disconnect/revoke recording;
- independent security assessment required by the Intuit review path.

This document is an implementation checklist, not proof that hosting controls already exist.
