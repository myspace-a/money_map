# Money Map — Development Process

**Companion documents:** `PROJECT_SPEC.md` (product requirements), `docs/ARCHITECTURE.md` (technical design). This document defines *how work actually happens day-to-day* — environment, git, testing, CI, and AI tool responsibilities. It does not define product scope or architecture; conflicts with those documents are flagged, not resolved, here (see §6).

---

## 0. Project Chat Structure

The project is organized into four types of chats. Project documents and chats have distinct roles — each document is owned by exactly one chat.

| Responsibility | Document / Source | Chat |
|---|---|---|
| Requirements | `PROJECT_SPEC.md` | Requirements & Architecture |
| Architecture | `ARCHITECTURE.md` | Requirements & Architecture |
| Development process | `DEVELOPMENT.md` | Development Workflow & Tools |
| Build procedure | `CHAT_BUILD_TEMPLATE.md` | Used by every Build Chat |
| Coaching | — | Project Coaching |
| Implementation | GitHub repository | Build Chats |

### 0.1 Requirements & Architecture

Responsible for: product requirements, requirements clarification, technical architecture, architecture decisions, maintaining `PROJECT_SPEC.md` and `ARCHITECTURE.md`.

This chat does not implement application code and does not touch development workflow. If a question isn't strictly about requirements or architecture, it gets redirected to the appropriate chat.

### 0.2 Development Workflow & Tools

Responsible for: development workflow, build-chat structure, Git workflow, testing workflow, AI tool usage, maintaining `DEVELOPMENT.md` and `CHAT_BUILD_TEMPLATE.md` — this is that chat.

This chat does not implement application code and does not decide requirements or architecture. Questions about those get redirected to Requirements & Architecture.

### 0.3 Project Coaching

Provides guidance across the project: evaluating project organization, preparing (not making) architectural decisions, choosing between development tools, deciding how to structure chats, resolving workflow issues, reviewing lessons learned.

The coaching chat is never the source of truth for requirements or implementation — any decision it helps shape must still be reflected in the appropriate project document by the chat that owns that document.

### 0.4 Build Chats

Implement specific development phases, following `CHAT_BUILD_TEMPLATE.md`: defined scope, reads the relevant project documents, inspects the current repository, proposes an implementation before making changes, implements only after explicit approval, tests, reviews the result against `PROJECT_SPEC.md` and `ARCHITECTURE.md`.

The GitHub repository is the implementation source of truth — not any chat's conversation history. When a Build Chat resumes (in the same tool or a different one), it inspects the repository and re-reads the docs rather than relying on prior conversation memory.

The exact number and organization of Build Chats may evolve as the project develops.

---

## 0a. Repository and Branches

**Repository:** `github.com/myspace-a/money_map`

| Branch | Contents | Status |
|---|---|---|
| `main` | The active default branch. Hosts `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `CHAT_BUILD_TEMPLATE.md`, and — going forward — all real application code, built via the process in this document. | **Active** — this is where all new work happens. |
| `ChatGPT` | An earlier, parallel exploration of the project documents produced via ChatGPT. Documentation only — **no application code**. | **Historical reference only.** Not merged into `main`, not a source for code. |
| `claude-html` | An earlier single-file prototype (`spesa-ing.html`) built in a single Claude chat, before the current multi-chat / PWA architecture was adopted. | **Historical reference only.** Superseded by the architecture in `ARCHITECTURE.md` §1–2; not built on going forward. |

**Rule for Build Chats:** all work targets `main` (via a feature branch off `main`, per §2.1) and never reads from or merges `ChatGPT` or `claude-html`. Those two branches exist purely as a paper trail of how the project got here — if a Build Chat wants to reference something from them (e.g. the original prototype's logic, or a wording choice from the ChatGPT docs), that's fine as inspiration, but nothing is pulled in automatically or assumed current.

---

## 1. Minimum Environment

### 1.1 Pinned versions

- **Node.js:** `22.x` (LTS). Pinned in `package.json` under `"engines": { "node": ">=22 <23" }`.
- **Package manager:** `npm` (whatever ships with Node 22). No yarn, no pnpm — one tool, no ambiguity.
- **Lockfile policy:** `package-lock.json` is committed to the repo and is the single source of truth for exact dependency versions. It is never `.gitignore`'d.

> Why Node 22 (updated from an earlier Node 20 pin): Node 20 reached end-of-life on April 30, 2026 and no longer receives security patches. Node 22 is the current Maintenance LTS release (supported into 2027) and was also what was actually reachable in the Build Chat 01 (Foundation) container after Node 20 install attempts hit network restrictions — so this pin reflects both a security requirement and a practical constraint, not just a preference. If a future dependency requires a newer Node, that's a deliberate decision made in a Build Chat and reflected here — not a surprise.

### 1.3 One-time local machine setup

Confirmed painful in practice (Build Chat 01) — do these once per machine so they stop causing confusion mid-session:

**Node version management.** A fresh machine's default Node may be far below the pin (e.g. a system Node 12 was found against a Node 22 pin), and reinstalling Node manually every time this happens is error-prone. Use [`nvm`](https://github.com/nvm-sh/nvm) instead:

```bash
# one-time nvm install, then:
nvm install 22
nvm use 22
nvm alias default 22   # makes 22 the default for new terminal sessions
```

After this, `node -v` should show `22.x` in any new terminal without further action.

**GitHub authentication for pushing over HTTPS.** GitHub no longer accepts a plain password for HTTPS git operations — pushing requires a [Personal Access Token](https://github.com/settings/tokens) (or SSH keys, as an alternative). One-time setup:

```bash
# when git push prompts for a password, use a PAT instead:
# Settings → Developer settings → Personal access tokens → generate one with 'repo' scope
# paste the token in place of your password when prompted
```

Git can also be configured to remember it (via a credential helper) so this isn't repeated on every push:

```bash
git config --global credential.helper store   # or 'cache' for a temporary, in-memory version
```

If you'd rather use SSH keys instead of a token, that's an equally valid one-time alternative — either way, plan for this before your first `git push` on a new machine, not during it.

**On using GitHub Codespaces instead of a local machine:** Codespaces is a reasonable way to get a real browser and normal internet access when you're away from your Linux machine (e.g. on Android), and the `nvm`/PAT setup above applies there too. However, per §3.2, Codespaces has shown storage-timing-related Playwright failures that didn't reproduce on local Linux — so it's a fallback for convenience, not a substitute for the authoritative local run.

**Local machine paths (this project's Linux machine):**

- **Repo clone:** `/home/alberto_allocato_archive/Money_Analizer` — this folder is a clone of `github.com/myspace-a/money_map` (confirmed via `git remote -v`). The directory name is a holdover from before the repo was renamed; it does not need to match the GitHub repo name to work correctly.
- **Downloaded delivery bundles:** `/home/alberto_allocato_archive/Downloads` — when a Build Chat's sandbox has no direct push access and instead delivers work as a `.bundle` file (see below), this is where it lands before being applied to the local clone.

**Applying a delivered `.bundle` file.** When a Build Chat cannot push directly (see `DEVELOPMENT.md` §5 — no AI tool has unattended push permission), it may instead produce a git bundle for you to apply locally:

```bash
cd /home/alberto_allocato_archive/Money_Analizer
git fetch /home/alberto_allocato_archive/Downloads/<bundle-filename>.bundle <branch-name>
git checkout -b <branch-name> FETCH_HEAD
```

Then continue as normal: run the test suites (§3), and push the branch to open a PR (§2.3).

### 1.4 How a Build Chat verifies the environment before touching code

This directly targets the Build Chat 01 failures (missing lockfile, Node v12 vs. assumed-modern Node). Before writing or modifying any application code, a Build Chat must run and report the result of:

```bash
node -v          # must be 22.x — if not, stop and flag it, don't proceed
npm -v
git status       # confirm working tree is clean, confirm current branch
```

Then:

```bash
npm ci
```

`npm ci` must succeed from a clean checkout. If `package-lock.json` is missing or `npm ci` fails, that is a blocking problem — it gets fixed (or explicitly flagged to you) *before* any application code is written, not discovered later when tests are attempted.

This verification step is not optional and not skippable because "it worked last time." Every Build Chat does it fresh — see `CHAT_BUILD_TEMPLATE.md` §3.

---

## 2. Git Workflow

### 2.1 Branching

One branch per Build Chat, created from `main`:

```
build/<phase-number>-<short-phase-name>
```

Examples: `build/01-foundation`, `build/02-ing-import`, `build/03-categorization`. Phase numbers/names follow `PROJECT_SPEC.md` §6.

If a Build Chat's scope is narrower than a full phase (e.g. a bugfix or a follow-up), use:

```
build/<phase-number>-<short-description>
```

Example: `build/02-fix-duplicate-fingerprint`.

### 2.2 Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), kept simple:

```
<type>: <short summary>

[optional longer description]
```

Types used in this project: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`.

Examples:
- `feat: add ING CSV column mapping UI`
- `fix: correct Italian decimal parsing for negative amounts`
- `test: add Vitest coverage for duplicate fingerprinting`
- `docs: update ARCHITECTURE.md with WASM adapter notes`

Commit early and often within a Build Chat's branch — commits don't need to be squashed or perfect, since the branch is reviewed as a whole at merge time.

### 2.3 Getting work into `main`

1. Build Chat finishes its approved scope (see `CHAT_BUILD_TEMPLATE.md`) and confirms tests pass locally (§3).
2. Push the branch and open a **Pull Request** into `main` on GitHub.
3. **You** review and merge the PR yourself. No auto-merge, no AI-tool merge permissions.
4. After merge, delete the branch.

`main` is always the clean, working starting point for the next Build Chat — this mirrors how this chat already treats `main` as the baseline.

---

## 3. Testing Workflow

This is the *day-to-day mechanics* of running tests. The testing *architecture* (why two tiers, what each tier covers, adapter parity) lives in `ARCHITECTURE.md` §7 — this section doesn't repeat that reasoning, only how to run it.

### 3.1 Commands

```bash
npm test              # runs the Vitest suite (Tier 2 — narrow, see ARCHITECTURE.md §7.2)
npx playwright test   # runs the Playwright suite (Tier 1 — primary, acceptance-level)
```

Both must succeed before a phase is considered done — Vitest in the Build Chat's container, Playwright on your local machine (see §3.2). Neither is optional.

### 3.2 Who runs what, and when

**Structural constraint (confirmed in Build Chat 01):** Playwright (Tier 1) cannot run inside a Build Chat's sandboxed container. The container's network blocks downloading a browser (`cdn.playwright.dev` is not reachable), and the `apt` fallback (`chromium-browser`) is a snap stub that also doesn't work in that environment. This is not a one-off glitch to retry — **assume every Build Chat from now on that Tier 1 verification happens on your local machine, not in the container.** A Build Chat should write Playwright tests and the code they exercise, run Vitest (Tier 2) itself since that works fine in-container, and clearly mark Playwright results as "written, not executed here" rather than attempting workarounds each session.

**GitHub Codespaces is not a reliable substitute for local Linux either — confirmed after Phase 1.** Codespaces has normal internet access (so it can install a browser, unlike the Build Chat container), but running the Phase 1 Playwright suite there produced 3 failures — persistence-across-reload and adapter-parity tests — that did **not** reproduce when the identical suite was run on the local Linux machine immediately after. The failures cluster around OPFS/storage timing, consistent with Codespaces' own container sandboxing affecting browser storage behavior rather than a real bug in the app. **Treat the local Linux machine as the authoritative Playwright result.** Codespaces can be used as a quick sanity check (e.g. confirming a test file runs at all) when Linux isn't reachable, but a Codespaces-only failure — especially involving persistence/storage/reload — should be re-verified on Linux before being reported to a Build Chat as a real bug.

- **During implementation:** the Build Chat (with Claude and/or Copilot, per §5) runs Vitest repeatedly while building. Playwright tests are written but not run in-container — this is expected, not a gap to solve.
- **Before requesting merge:** the Build Chat runs Vitest one final time from a clean state and reports the result. Playwright results are reported as "not executed in this container" rather than a pass/fail guess.
- **You:** run `npx playwright test` yourself locally (per §1.3) before considering a phase done. This is not optional spot-checking for Playwright specifically — it's the only place Tier 1 actually gets verified, every phase.

### 3.3 What most new features need

Per `ARCHITECTURE.md` §7.2, most new features get a **Playwright** test, not a Vitest test. Vitest is only for the four narrow areas listed there (money math, migrations, categorization rule logic, duplicate-detection fingerprinting). A Build Chat should default to Playwright unless the change clearly falls into one of those four areas.

---

## 4. CI (GitHub Actions)

### 4.1 Current status: not set up yet

Per `ARCHITECTURE.md` §7.5, CI is a **deliberate setup task**, never an assumption. As of this document, GitHub Actions is **not configured**. Treat it as absent until a workflow file exists in the repo and you have personally seen a green run.

### 4.2 When it gets set up

Deferred until after the **Foundation** phase (`PROJECT_SPEC.md` §6, phase 1) is complete and both test suites are reliably green locally. Setting up CI on top of a shaky local setup just reproduces the Build Chat 01 problem in a different place.

### 4.3 Who owns it

**You** own creating and pushing the GitHub Actions workflow file, or explicitly delegating that single task to a Build Chat *in this chat* (Development Workflow & Tools), with your direct involvement — not silently to an unattended AI tool. This directly addresses the Build Chat 01 failure where Copilot didn't have permission to push a CI workflow file: no AI tool should be assumed to have that permission. If a Build Chat is asked to help write the workflow file, its output is a *proposal* for you to review and push yourself, unless you've confirmed the tool actually has push permission for workflow files.

### 4.4 What runs automatically vs. manually, once CI exists

- **Automatic (on push / PR to `main`):** `npm ci`, `npm test`, `npx playwright test` — the same two suites run locally, as a second check.
- **Manual only:** anything exploratory, anything touching real ING CSV fixtures with personal data, anything you haven't reviewed. CI never gains scope beyond "run the existing test suites" without a deliberate decision recorded here.

---

## 5. Division of Responsibility: Claude vs. GitHub Copilot

Both tools may be used across Build Chats. Roles are kept explicit so neither tool assumes the other's job:

| Responsibility | Claude | GitHub Copilot |
| --- | --- | --- |
| Reading `PROJECT_SPEC.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` and planning scope | ✅ Primary | — |
| Proposing an implementation plan and waiting for your approval | ✅ Primary | — |
| Writing application code (once a plan is approved) | ✅ Primary, in Build Chats | ✅ Inline completion/assistance while you or Claude write code |
| Writing tests (Playwright/Vitest) | ✅ Primary | ✅ Inline assistance |
| Setting up or modifying CI workflow files | ❌ Not unattended — see §4.3 | ❌ Not unattended — see §4.3 |
| Git commands (branch, commit, push) | Can propose/run commands within an approved Build Chat scope, in a normal dev environment with your oversight | Not typically involved — Copilot is an inline coding assistant, not a workflow driver |
| Reviewing code/tests against `PROJECT_SPEC.md` / `ARCHITECTURE.md` | ✅ Primary, before wrap-up | — |
| Deciding product requirements or architecture | ❌ Never — belongs to Requirements & Architecture chat | ❌ Never |

The general split: **Claude drives Build Chats end-to-end** (plan → implement → test → review), because it has this document, the spec, and the architecture as context. **Copilot is a lower-level assistant** used for inline code completion while working inside the repo — it does not own planning, CI, or merges. No tool sets up or pushes CI unattended (§4.3).

---

## 6. Flagging Conflicts Between Code and Docs

A Build Chat may discover that the code needs to diverge from what `PROJECT_SPEC.md` or `ARCHITECTURE.md` currently says (e.g. an ING CSV quirk not yet documented, a data model detail that needs adjusting). When this happens:

1. The Build Chat **does not** edit `PROJECT_SPEC.md` or `ARCHITECTURE.md` directly.
2. The Build Chat **proposes** the fix — what's inconsistent, and a suggested resolution — as a clearly flagged note at wrap-up (see `CHAT_BUILD_TEMPLATE.md` §7).
3. You take that note to the **Requirements & Architecture chat**, where the actual doc change is made.
4. This chat (Development Workflow & Tools) only updates `DEVELOPMENT.md` and `CHAT_BUILD_TEMPLATE.md` — never `PROJECT_SPEC.md` or `ARCHITECTURE.md`.

This keeps a single source of truth for product/architecture decisions and stops process docs from silently drifting out of sync with spec docs.

---

## 7. Deployment (GitHub Pages)

Per `ARCHITECTURE.md` §8, the app is deployed as a static site to **GitHub Pages** directly from this repository — no build step, no separate hosting account, no server to manage.

### 7.1 One-time repo setup

1. On GitHub: `Settings` → `Pages`.
2. **Source:** "Deploy from a branch."
3. **Branch:** `main`, folder **`/ (root)`** — the app's `index.html` lives at repo root, not inside `docs/` (that folder is reserved for the markdown project docs, not the deployed app).
4. Add an empty `.nojekyll` file at repo root. GitHub Pages runs Jekyll processing by default, which can silently skip files/folders it doesn't expect (e.g. anything starting with `_`) — `.nojekyll` disables that, which matters here since this is a plain static site with no Jekyll involvement.

Once enabled, the live URL is:

```
https://myspace-a.github.io/money_map/
```

### 7.2 ⚠️ This URL is effectively permanent — read before touching repo/hosting settings

Restated from `ARCHITECTURE.md` §8.2, at the point where it actually matters: **OPFS storage (where the real database lives) is scoped to this exact URL.** Once real data has been entered into the app at this address, the following all count as a *different origin* to the browser — meaning the installed app would open to an empty database, not the existing one:

- Renaming the `money_map` repository
- Moving off GitHub Pages to another host
- Adding a custom domain
- Changing the published path/branch/folder

**Before doing any of the above:** use the app's own export/backup feature (`PROJECT_SPEC.md` §3.11) first. There is no automatic migration — this is a manual step only you can remember to do, at the moment you decide to make such a change, not something to fix after the fact.

### 7.3 Deployment is continuous, not a separate release step

Because Pages deploys straight from `main`, **every PR merge into `main` (§2.3) goes live automatically** — there's no separate "publish" action. This means the same PR-review discipline in §2.3 is effectively also your release gate: don't merge to `main` until you're actually ready for that change to be live at the public URL.

### 7.4 What this URL is useful for, day-to-day

- The primary way to verify installability ("Add to Home Screen" on Android) and offline behavior on a real device, per `ARCHITECTURE.md` §7.4 — more reliable for this than a Codespaces forwarded port (§1.3), since the Pages URL is the actual stable origin the app will really run at, not a temporary preview URL.
- Unlike a Codespaces preview, data entered here persists across visits (that's the point of OPFS) — so this URL will accumulate real local data over time, the same as the installed app would. Treat it accordingly, not as a disposable test environment.

---

## 8. Out of Scope for This Document

If you need help with any of the following, it belongs in a different chat, not here:

- Product requirements or MVP scope → **Requirements & Architecture chat**
- Technical/architecture decisions (data model, adapters, stack choices) → **Requirements & Architecture chat**
- General project structure or coaching → **Project Coaching chat**
- Actually writing application code → a **Build Chat**, following `CHAT_BUILD_TEMPLATE.md`
