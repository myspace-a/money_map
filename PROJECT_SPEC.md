# Personal Money Analyzer — Project Specification

**Status:** Initial specification
**Primary country:** Italy
**Primary bank:** ING Italy
**Target platforms:** Android and Linux

## 1. Goal

Build a personal finance application that imports ING Italy bank CSV exports, stores transactions locally, categorizes spending, learns from user corrections, and provides transaction analysis, dashboards, export and backup/restore.

The application is primarily for one user and is local-first. No cloud account or cloud database is required.

## 2. MVP Scope and UX/UI Principles

The priority is to deliver a functional and usable MVP that satisfies the agreed product requirements.

UX/UI design is intentionally not fully defined at the MVP stage. UX/UI decisions should be made only when necessary to satisfy an MVP requirement, basic usability, or an architectural constraint.

Features, enhancements and UX improvements that are not required for the MVP should be treated as backlog candidates rather than included in the MVP scope.

The MVP should provide a clear and usable experience, but visual polish, advanced interaction patterns and UX optimization can be addressed after the MVP.

The MVP should avoid speculative features and unnecessary architectural complexity introduced solely to support potential future requirements.

## 3. Functional requirements

### 3.1 Incremental ING CSV import

The application must:

- import ING Italy CSV files without replacing existing transactions;
- preserve existing transactions unless explicitly updated/merged;
- support a configurable ING import profile;
- allow source-column mapping to internal fields;
- persist import settings;
- handle dates, value dates where available, amounts, currency, descriptions, merchants/counterparties and transaction/debit/credit information where available;
- keep the internal model independent from ING column names.

### 3.2 Duplicate detection

Imported transactions must be checked against local transactions.

The system must:

- detect obvious duplicates;
- distinguish possible duplicates from confirmed duplicates;
- allow user review of duplicate candidates;
- never silently delete a transaction because it appears similar;
- generate a fingerprint from normalized transaction data.

Supported outcomes include unique/new, exact duplicate and probable duplicate. The user must be able to keep existing, import new, keep both, or merge/ignore as appropriate.

### 3.3 Categorization

Every transaction must have a current category and categorization method.

Methods: `default`, `rule`, `learned`, `manual`, `uncategorized`.

Priority:

1. custom user rule
2. built-in default rule
3. historical learning
4. uncategorized

Default rules must be separate from user rules and versionable. Users must be able to create, edit, enable/disable and delete custom rules. Rules must support at least keyword/merchant or description matching, category, priority and enabled state.

No external AI service is required.

### 3.4 Learning

The application should learn from manual categorization using historical patterns such as exact/normalized merchant, similar descriptions, transaction characteristics and repeated categorization.

Learning must be explainable and should produce suggestions when confidence is insufficient rather than irreversible decisions. Manual corrections must remain possible and may provide future learning data.

### 3.5 Explainability

The application must expose why a transaction was categorized, including method and relevant rule/evidence and confidence where applicable.

### 3.6 Categories

Categories use stable internal IDs; names are not identifiers.

The user must be able to:

- create, rename and deactivate categories;
- split categories;
- merge categories;
- move transactions between categories.

Historical transactions must remain consistent and category changes must not corrupt data.

**Split and merge behavior (MVP, resolved during Phase 5):**

- **Split** moves all transactions in a category whose merchant/description matches a given filter into another category — not a free-form selection of individual transactions. This covers the realistic split use case (e.g. pulling all "Amazon" purchases out of a generic "Shopping" category).
- **Merge** also reassigns any rules pointing at the source category to the target category, so no rule is left silently categorizing new imports into a category that no longer exists.
- Transactions moved by split or merge are recorded using the same `manual` categorization method as a direct manual correction (§3.3), so they inform future learning suggestions (§3.4) and remain explainable (§3.5).

### 3.7 Transactions

Provide a transaction list showing at least:

- date;
- description;
- merchant/counterparty;
- amount and currency;
- income/expense;
- category;
- categorization method;
- confidence where applicable.

Users must be able to edit category, search, filter, inspect categorization and duplicate status.

### 3.8 Filters

Support filtering by month, date range, category, income/expense and search text. Search should include relevant description, merchant and counterparty fields. Filters should behave consistently in transaction and dashboard views.

### 3.9 Dashboard

Provide:

- spending by category;
- monthly income, expenses and net cash flow;
- top merchants/counterparties by spending;
- income versus expenses;
- total income, total expenses, net balance, spending distribution and monthly evolution.

Charts must respond to applicable filters.

### 3.10 Export

Support:

- normalized CSV transaction export;
- JSON application-data export.

JSON should be capable of containing transactions, categories, custom rules, learning data, import configuration and application settings.

### 3.11 Backup and restore

Provide full local backup and restore including transactions, categories, rules, learning history, settings and import mappings. The backup must be restorable by the same application.

### 3.12 Persistent local storage

Financial data must persist between sessions in a local database. No user account or cloud database is required.

### 3.13 User-initiated data reset

The application must provide a way for the user to permanently delete all locally stored data (transactions, categories, rules, learning history, settings, import mappings), for cases such as starting over or clearing test data.

This capability must:

- be disabled/hidden by default — it must not appear in the normal UI until the user has explicitly activated it (e.g. via a setting);
- once activated, still require an explicit confirmation step before any data is deleted — a single click/tap must never be sufficient;
- only ever delete this application's own data, never data belonging to any other application;
- never run automatically, on error, or as a side effect of any other action.

This directly extends the safety principle in §4 ("must never silently delete or overwrite financial data") to a feature that is, by design, destructive — the safeguard is the opt-in plus confirmation, not the absence of the feature.

## 4. Privacy and financial-data safety

Financial data is sensitive.

Requirements:

- local-first operation;
- no mandatory cloud backend;
- no external AI/API required for categorization;
- no transaction data sent externally by default;
- exports are explicitly user initiated;
- local database storage.

External services, if ever introduced, must be opt-in.

Money must use integer minor units or another decimal-safe representation. Floating-point financial calculations must not be used where precision matters.

The application must never silently delete or overwrite financial data.

## 5. Non-functional requirements

The application must run on Android and Linux.

The architecture must support:

- persistent local storage;
- safe migrations;
- data preservation and backward compatibility;
- testability;
- explainable categorization;
- maintainable separation between domain logic and UI.

## 6. Development phases

1. Foundation — repository/app setup, local database, schema, domain models and persistence.

2. ING Import — parser, mapping, normalization, validation, fingerprinting, duplicate detection/review and incremental import.

3. Categorization — defaults, user rules, priority, metadata, learning, confidence and manual correction.

4. Transaction UI — table, search, filters, sorting, details and categorization explanation.

5. Category Management — create, rename, split, merge, deactivate and reassignment.

6. Dashboard — category charts, trends, income/expense, merchants and filters.

7. Export/Backup — CSV, JSON, backup and restore, and user-activated data reset (§3.13).

8. Testing/Hardening — unit, integration, E2E, real ING validation, edge cases, backup/restore, performance and UX refinement.

This document defines product requirements. Technical implementation decisions belong in `docs/ARCHITECTURE.md`; development process belongs in `docs/DEVELOPMENT.md`.
