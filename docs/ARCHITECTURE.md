# Money Map — Architecture

**Status:** Revised architecture (supersedes previous ARCHITECTURE.md)
**Companion document:** `PROJECT_SPEC.md` defines product requirements; this document defines how those requirements are built.

---

## 1. Overview

Money Map is a local-first personal finance app for one user, targeting Android and Linux, built as an **installable Progressive Web App (PWA)**. It imports ING Italy CSV exports, categorizes spending, and provides dashboards, export, and backup — all without a server or cloud account. All data lives in a real SQLite database running in the browser via WebAssembly.

This revision reflects three decisions made while discussing this document:

1. The frontend is plain HTML/CSS/JS — no build step, no framework.
2. The app runs as a PWA rather than a Tauri native shell — this removes Rust, a native build toolchain, and platform-specific packaging from day one, while keeping a real SQL database and a path to Tauri later if ever needed.
3. The testing strategy is built around Playwright as the primary tool, with Vitest scoped narrowly, in response to real setup problems hit during Build Chat 01.

Everything else — layering, money as integer minor units, stable UUIDs, the ING import boundary, categorization priority, and migrations — carries forward unchanged.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Shell / packaging | Progressive Web App (installable via browser "Add to Home Screen" on Android and Linux) |
| UI | Plain HTML, CSS, JavaScript — no framework, no bundler |
| App logic (domain, repositories, services) | Plain JavaScript modules |
| Persistence (production) | SQLite compiled to WebAssembly (`wa-sqlite` or `sql.js`), persisted via OPFS (Origin Private File System) |
| Persistence (tests) | A plain Node-compatible SQLite library (e.g. `better-sqlite3` or Node's built-in `node:sqlite`) |
| Unit/technical tests | Vitest (narrow scope — see §7) |
| Acceptance tests | Playwright, run against a real browser |
| CI | GitHub Actions (set up deliberately, not assumed — see §7.5) |

There is no custom native code at all. The entire app — UI, domain logic, categorization, import parsing, persistence — is plain JavaScript running in the browser. This matches the "open one file, it works" simplicity of the earlier single-file prototype (`spesa-ing.html`), just organized into a few files.

**Library loading:** third-party libraries (`wa-sqlite`, and Chart.js when the dashboard phase adds it) are loaded from a CDN at runtime rather than bundled/vendored into the repo — consistent with the no-build-step approach in §1. This is simpler day-to-day, but has an offline-installability consequence documented in §5 and §8.

**Why not Tauri:** Tauri would give a more "native" installed-app feel and direct filesystem access, at the cost of a Rust toolchain, native build/signing steps per platform, and the setup friction already hit in Build Chat 01. For a single-user local app, that cost isn't currently justified. If a genuine need for native capability appears later (e.g. background sync, deeper filesystem integration), the adapter boundary in §4 is designed specifically so that move would replace one adapter, not the app.

---

## 3. Layering

```
┌─────────────────────────────────────────┐
│  UI layer (index.html + feature .js)     │  transactions.js, dashboard.js, categories.js
├─────────────────────────────────────────┤
│  Application/Service layer               │  import, categorization, duplicate detection,
│                                           │  dashboard aggregation, backup/restore
├─────────────────────────────────────────┤
│  Domain layer                            │  Transaction, Category, Rule, Money (pure JS,
│                                           │  no I/O, no browser-specific dependency)
├─────────────────────────────────────────┤
│  Repository layer                        │  TransactionRepository, CategoryRepository, etc.
│                                           │  — depends only on a small Database port
├─────────────────────────────────────────┤
│  Database adapters                       │  WasmSqliteAdapter (production) /
│                                           │  NodeSqliteAdapter (tests)
└─────────────────────────────────────────┘
```

**Rule:** domain and repository code may only depend on the `Database` port (§4). It must never import the WASM SQLite library directly. This is what makes domain/repository code runnable in plain Node/Vitest, and what would make a future native adapter a contained change.

---

## 4. Persistence Architecture

### 4.1 The problem this solves

In Build Chat 01, running any test required a full chain of setup — Node version, lockfile, Vitest, Rust, a native shell, a plugin, SQLite — before a single line of app logic could be checked. Choosing a browser-only stack removes the Rust/native portion of that chain entirely; the `Database` port removes the rest.

### 4.2 The `Database` port

A small interface (not a class hierarchy — just an object shape) that repository code depends on:

```js
// db-port.js (JSDoc typedef, not enforced by a compiler — this is plain JS)
/**
 * @typedef {Object} Database
 * @property {(sql: string, params?: any[]) => Promise<any[]>} query
 * @property {(sql: string, params?: any[]) => Promise<{lastInsertId?: number, rowsAffected: number}>} execute
 * @property {(fn: (db: Database) => Promise<void>) => Promise<void>} transaction
 */
```

Repositories (`TransactionRepository`, `CategoryRepository`, `RuleRepository`, …) take a `Database` in their constructor and only ever call `query`, `execute`, and `transaction`. They contain no browser-specific imports and no Node-only imports.

### 4.3 Two adapters, one schema

- **`WasmSqliteAdapter`** — wraps a WASM build of SQLite (`wa-sqlite` or `sql.js`), used in the actual running app (Android and Linux, both via browser/PWA). Storage is backed by OPFS, the browser's private persistent file storage, so data survives restarts like a normal local database file.
- **`NodeSqliteAdapter`** — wraps a Node-native SQLite library, used only in Vitest tests.

Both adapters run against the **same schema and the same migration SQL files** (§6). To keep them behaviorally equivalent:

- Only standard SQLite dialect is used — no engine-specific extensions.
- The migration runner (§6) and repository SQL are written once and executed unchanged by both adapters.
- A small **adapter-parity test suite** runs the same repository test cases against both adapters where practical, so a query that passes under Node but behaves differently under the WASM build is caught early.

### 4.4 Where each adapter is used

| Context | Adapter |
|---|---|
| Vitest unit tests (money math, migrations, categorization, duplicate detection) | `NodeSqliteAdapter` |
| Playwright acceptance tests, run against the real app in a browser | `WasmSqliteAdapter` |
| Installed app (Android, Linux) | `WasmSqliteAdapter` |

### 4.5 Threading model: OPFS requires a Web Worker

Fast, synchronous OPFS file access — the mode a real SQLite engine needs for reasonable performance — is only available **inside a Web Worker**, not on the browser's main thread. (The main thread only has a slower asynchronous OPFS API, which isn't suitable for how SQLite reads/writes.)

This is a real constraint on the persistence architecture, not an implementation detail:

- The actual SQLite engine runs inside a dedicated worker script, `db-worker.js` — never on the main thread.
- `WasmSqliteAdapter` (as seen by repositories, per §4.2) does **not** call SQLite directly. It sends queries to `db-worker.js` via `postMessage` and receives results back the same way, then presents that to the rest of the app as the normal async `Database` interface (`query`/`execute`/`transaction`).
- This is invisible to domain/repository code — the `Database` port abstraction absorbs it — but it does mean the adapter itself has real complexity (message correlation, worker lifecycle/startup) that a from-scratch implementer should expect going in.

### 4.6 Local reset (development utility)

A running app holds an open OPFS `SyncAccessHandle` on the database file inside `db-worker.js` (§4.5). Because of that lock, the file can't simply be deleted out from under a live page — browser DevTools "Clear storage" tooling is inconsistent here (and Firefox's Storage tab doesn't expose OPFS at all currently), so there is no reliable way to reset local test data from outside the app.

To make this workable during development, `main.js` exposes a console-only utility:

```
window.MoneyMapApp.resetDatabase({ confirm: true })
```

It closes the adapter first (releasing the OPFS lock), deletes only the app's own OPFS directory, then reloads. The `{ confirm: true }` argument is required and has no default — this is deliberate, so it can't be triggered accidentally by pasting a snippet or from a stray call.

This is a **developer console utility, not a UI feature** — there is no button or menu entry for it, nothing a normal user would stumble into while using the app. That's a direct consequence of `PROJECT_SPEC.md` §4 ("the application must never silently delete or overwrite financial data"): destructive resets exist only as a deliberate, hard-to-trigger developer action, never as an in-app affordance.

**Not to be confused with:** `PROJECT_SPEC.md` §3.13 defines a separate, *end-user-facing* data reset requirement — off by default, requires explicit activation plus a confirmation step, and scoped to this app's own data only. That is a real product feature (planned for Phase 7, alongside backup/restore) with its own opt-in UI, distinct from this console-only developer tool. The two will likely share the same underlying deletion logic when Phase 7 is built, but that's an implementation detail to work out at that time, not a decision made here.

### 4.7 Backup, restore, and export

Since the app has no direct filesystem access outside the browser sandbox:

- **Export/Backup** produces a file (CSV or JSON per `PROJECT_SPEC.md` §3.10–3.11) via the browser's normal file-download mechanism.
- **Restore** is done by the user picking a previously exported file via a file-input, which the app reads and applies through the same repository/domain layer used everywhere else — restore is not a special code path, just another writer.
- This is slightly less convenient than direct filesystem access would be, but keeps the storage model simple and portable.

---

## 5. Frontend Architecture

- **Entry point:** a single `index.html`.
- **Feature modules:** plain ES modules loaded via `<script type="module">` — `transactions.js`, `dashboard.js`, `categories.js`, `import.js`, etc. Each owns one screen/feature area and calls into the service layer (§3).
- **No build step.** No bundler, no JSX, no transpilation. What you edit is what runs — open `index.html` in a browser and see the change.
- **No framework.** DOM updates are done directly (`document.querySelector`, template literals, or small hand-written render functions).
- **PWA basics:** a `manifest.json` (name, icons, start URL) and a minimal service worker (caches static assets so the app opens instantly and works offline) are the only additions needed to make the app installable on Android and Linux.
- **CDN-loaded libraries must be explicitly cached for offline use.** Because `wa-sqlite` and Chart.js load from a CDN at runtime (§2) rather than being part of the app's own files, the service worker's cache list must explicitly include those CDN URLs, not just the app's own HTML/CSS/JS. If it doesn't, a fully offline launch (or a launch after the CDN is unreachable) would fail to load the database engine itself — silently breaking the entire app, not just degrading a feature. This must be verified when the service worker is built, not assumed to work because other assets are cached.
- **Shared UI utilities** (formatting money for display, date formatting, small DOM helpers) live in a `ui-utils.js` shared module.

This mirrors the ease of the earlier single-file prototype (`spesa-ing.html`): the app is still "a page plus some scripts," just organized into a few files instead of one, so features don't collide as the app grows.

---

## 6. Data Model & Core Rules (carried forward)

- **Money** is stored and computed as integer minor units (cents). No floating-point arithmetic for financial values, anywhere in the domain layer.
- **Stable IDs:** transactions and categories use stable internal UUIDs; display names are never identifiers.
- **ING import boundary:** the ING CSV column layout is normalized into the internal transaction model at the import boundary only. Nothing downstream of the importer knows about ING-specific column names.
- **Categorization priority:** custom user rule → built-in default rule → historical learning → uncategorized. Default rules are versioned separately from user rules.
- **Migrations:** schema changes ship as ordered, versioned SQL migration files, applied by a migration runner shared by both database adapters. Migrations must be additive/non-destructive by default; no migration may silently drop financial data.

---

## 6a. ING CSV Import Format (concrete)

Based on a real ING Italy export, the raw format has several quirks the importer must handle explicitly, all confined to the import boundary (§6):

- **Columns:** `DATA CONTABILE, DATA VALUTA, USCITE, ENTRATE, CAUSALE, DESCRIZIONE OPERAZIONE` — accounting date, value date, outflow amount, inflow amount, ING's transaction-type label, and a free-text description.
- **Number format is Italian:** e.g. `-35,00` and `+5.316,83` — comma as the decimal separator, period as the thousands separator. Must be parsed explicitly (not `parseFloat`) and converted straight to integer minor units (§6) — never passed through a floating-point intermediate.
- **Dates are `DD/MM/YYYY`.**
- **Debit and credit are separate columns** (`USCITE` for outflows, `ENTRATE` for inflows), never both filled on the same row. The importer merges these into a single signed amount in the internal model.
- **`CAUSALE` is ING's own transaction-type label** (e.g. "Pagamento Carta", "Bonifico In Uscita", "Accredito Stipendio/Pensione", "Prelievo Carta", "Addebito Diretto"). This is stored and used as one input to seed built-in default categorization rules — it is a strong, bank-provided signal, distinct from the free-text description.
- **Merchant name is embedded in free text**, in `DESCRIZIONE OPERAZIONE`, typically after the word "presso" for card payments (e.g. "...presso FARMACIA SAN PANCRAZIO..."). The importer extracts a best-effort merchant string via pattern matching; the full original text is always preserved alongside the extracted value, since extraction is inherently imperfect and must remain inspectable/correctable (per the explainability requirement in `PROJECT_SPEC.md` §3.5).
- **First and last rows are running-balance markers**, not transactions (`CAUSALE` blank, description "Saldo iniziale" / "Saldo finale"). The importer must recognize and exclude these rows rather than storing them as zero-category transactions.
- **No bank-provided transaction ID exists.** This confirms the fingerprint used for duplicate detection (`PROJECT_SPEC.md` §3.2) must be derived from normalized (date, signed amount, causale, description) — there is no natural key to rely on instead.

---

## 6b. Category Split/Merge Mechanics (concrete)

Resolved during Phase 5 (Category Management):

- **Split** is implemented as a single bulk primitive, not free-form multi-select: move all transactions in category X whose merchant/description matches a given filter into category Y. This avoids adding multi-select UI to the already-built Transaction UI (Phase 4), while covering the realistic split use case (e.g. pulling "Amazon" purchases out of a generic "Shopping" category).
- **Merge** automatically reassigns any rules (`category_id`) pointing at the source category to the target category, and reports the number of rules moved — this prevents a rule from silently continuing to categorize new imports into a category that's now inactive.
- **Learning integration:** transactions moved by split or merge are recorded with `categorization_method: 'manual'` and evidence such as `{ type: 'manual', reason: 'category-merge' }` (or an equivalent `reason` for split) — reusing the same mechanism `applyManualCategory` already uses, rather than a special-cased code path. This means split/merge actions naturally feed the learning engine (`PROJECT_SPEC.md` §3.4) and stay explainable (`PROJECT_SPEC.md` §3.5).

---

## 7. Testing Strategy

### 7.1 Guiding principle

The testing strategy exists to protect financial and architectural integrity — correct money math, no data loss, no silent duplication — **without requiring day-to-day operation of a complex testing infrastructure.** Setup problems (Node versions, lockfiles, toolchains, CI config) must not block the ability to answer "does this feature actually work."

### 7.2 Two tiers

**Tier 1 — Playwright (primary, acceptance-level).**
Playwright is the default way to verify a feature works, because it tests the app the way it's actually used: import a real ING CSV fixture, check that a €12.50 transaction appears correctly, that a duplicate is flagged, that the dashboard total updates. Because the app is a plain browser app, Playwright simply loads it like a user would — there's no native shell to build first. Most new features should get a Playwright test, not a Vitest test.

**Tier 2 — Vitest (narrow, technical).**
Vitest is scoped to a small, specific set of concerns where a fast, precise unit test is genuinely the better tool than an end-to-end test:

- money math (integer minor-unit arithmetic, rounding, currency handling)
- migrations (schema upgrades apply cleanly and preserve data)
- categorization rule logic (priority resolution, rule matching)
- duplicate-detection fingerprinting

Vitest is **not mandatory as a general practice** — it's an implementation detail scoped to those four areas. A Build Chat is not expected to write Vitest tests for UI wiring, dashboard rendering, or general service-layer glue; those are covered by Playwright.

### 7.3 SQLite integration testing

- Vitest tests (Tier 2) run domain/repository logic against `NodeSqliteAdapter` — a real SQLite engine, just not the WASM build the app ships.
- Playwright tests (Tier 1) run against the actual app in a real browser, which exercises the actual `WasmSqliteAdapter` and OPFS storage — this is what catches WASM/browser-specific integration issues.
- The adapter-parity suite (§4.3) is the safety net between these two: it directly checks that the same repository behavior holds under both adapters, so passing Vitest tests are a meaningful signal about the real app, not just about a stand-in database.

### 7.4 Android testing cadence

Because the app is a PWA rather than a native build, there is no separate Android build/emulator chain to run. Routine development is verified with Playwright against a desktop browser. Actually installing and using the PWA on an Android phone (via "Add to Home Screen") should still be checked periodically — at the end of each development phase (per `PROJECT_SPEC.md` §6) and before any release intended for real daily use — mainly to confirm installability, offline behavior, and OPFS storage persistence on that platform, since these can behave slightly differently across browsers/devices.

### 7.5 Where tests run, and who's responsible

- **Local machine (primary):** Vitest and Playwright both run locally during development. This is the loop you rely on day-to-day — it must never depend on CI to tell you whether something works.
- **CI (GitHub Actions):** runs the same Vitest + Playwright suites on push, as a second check — but CI is a deliberate setup task, not something to assume works. A Build Chat that wants CI enabled must actually add and verify the workflow file (including confirming it has permission to push it), not just reference GitHub Actions as if it already runs.
- **Ownership:** you (the sole maintainer) own keeping both the local and CI test runs green. A Build Chat is responsible for leaving the environment in a state where `npm test` and `npx playwright test` succeed locally before considering a task done — CI, if present, is a bonus check, not a substitute.

### 7.6 Minimum environment a Build Chat must assume or verify

Before writing or modifying application logic, a Build Chat must confirm:

- **Node version:** an LTS version is pinned in `package.json` (`engines.node`) and matches the Node actually installed (`node -v`). If they don't match, that mismatch must be resolved (or explicitly flagged to you) before proceeding — it must not be discovered only once tests are attempted.
- **Lockfile policy:** `package-lock.json` is committed to the repo. `npm ci` must succeed from a clean checkout before any application code is written or changed in that session.
- **No implicit assumption of a working CI pipeline.** Treat CI as "not set up" unless a Build Chat has verified it directly (e.g. seen a green run).

---

## 8. Hosting & Deployment

### 8.1 GitHub Pages is a good fit

Because the app has no build step and no server-side logic (§1, §5), it can be deployed as-is to **GitHub Pages** — static HTML/CSS/JS served over HTTPS, directly from the repository.

This does not conflict with the local-first privacy requirement (`PROJECT_SPEC.md` §4): that requirement is about **user data** never leaving the device, not about the app's own code being private. GitHub Pages only serves files; it runs no server logic and collects nothing. HTTPS is required anyway for PWA installability and for OPFS (§4.5) to work at all, and GitHub Pages provides this by default.

### 8.2 Origin stability — a real data-continuity risk

OPFS storage (where the SQLite database file actually lives, §4.3–4.5) is scoped to the exact origin/URL the app was opened from. This has a direct consequence for deployment:

- The URL the app is deployed and installed at (e.g. `https://<user>.github.io/<repo>/`) must be treated as effectively **permanent**.
- Changing the repository name, moving off GitHub Pages, adding a custom domain, or restructuring the deployed path later all count as a **different origin** to the browser. The installed app would start from an empty database — existing data is not automatically carried over.
- The only way to move data across an origin change is an explicit export/import through the app's own backup feature (§4.7, `PROJECT_SPEC.md` §3.11) — this is a manual step the user must remember to do *before* any such change, not something the architecture can do silently on their behalf.

**The origin is also shared across every app hosted under it, not just Money Map's own history.** `myspace-a.github.io` hosts multiple independent projects as separate paths (e.g. `Acqua`, `Digital_Library`) on the same GitHub Pages account — and since OPFS storage is scoped to the *origin* (`myspace-a.github.io`), not the path, all of those projects share one browser storage bucket. Concretely: a blanket "Clear site data" action in browser DevTools clears storage for the whole origin, wiping every project's data at once, not just Money Map's. This is exactly why the reset utility in §4.6 deliberately deletes only its own `money-map-opfs` directory rather than clearing storage wholesale — a general-purpose "clear everything" reset is not safe to offer at all on a shared origin like this one.

This risk should be re-stated as a concrete warning wherever deployment/hosting setup is actually documented (`DEVELOPMENT.md`), so it's seen at the moment someone is about to pick or change a hosting URL — not just here.

### 8.3 Out of scope for this document

Static hosting introduces no new architectural component — no server, no backend to design. What GitHub Pages configuration actually requires (repo settings, branch/folder to publish, custom domain setup if any) is a deployment/process concern, not an architecture decision, and belongs in `DEVELOPMENT.md` (owned by the Development Workflow & Tools chat).

---

## 9. Open Questions / Backlog

- **Service worker must cache CDN library URLs.** Flagged during Phase 1 (Foundation): when the service worker is built, it must explicitly cache the `wa-sqlite` (and Chart.js) CDN URLs, per §5 — not just app files — or offline installs will be missing the database engine.

- Exact choice of WASM SQLite library (`wa-sqlite` vs. `sql.js`) — `wa-sqlite` supports OPFS directly for better performance with larger datasets; `sql.js` is simpler but typically needs manual persistence wiring. To be settled by the Build Chat implementing persistence.
- Exact choice of Node-native SQLite library for `NodeSqliteAdapter` (`better-sqlite3` vs. Node's built-in `node:sqlite`) — to be settled based on what's stable in the pinned Node version.
- Browser support baseline: OPFS is supported in current Chrome/Edge and Firefox; Safari support should be checked if Safari/iOS ever becomes a target (not currently in scope per `PROJECT_SPEC.md`, which targets Android and Linux).
- CI workflow setup (GitHub Actions) is deferred to the Development Workflow & Tools chat.
