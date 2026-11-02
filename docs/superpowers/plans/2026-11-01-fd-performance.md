# Desempenho FD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing FD performance module that awards 1 point for acknowledging an authorized indicator and 2 points for a suggestion approved by a different authorized reviewer, starting only after explicit activation.

**Architecture:** Extend the existing authenticated FD indicator service and its Firestore project with idempotent acknowledgement, suggestion-review, award, and self-only summary records. Add an independent PWA route and UI that reads those records only through the FD authenticated session; keep the current permission boundary and do not write to FB. Create any Apps Script executor/bootstrap assets only in the supplied FD Drive folder, after confirming its access and that an Apps Script executor is actually required by the chosen deployment path.

**Tech Stack:** JavaScript ES modules, Firebase Auth/Firestore, Cloudflare Worker (`worker-indicators`), Apps Script only if required for server-side scheduled processing, Vite, Node.js test runner, Firebase Firestore emulator.

**Spec:** `docs/superpowers/specs/2026-11-01-fd-fe-performance-design.md`

## Global Constraints

- Firebase destination is `rotinas-8a617`; Cloudflare account supplied for FD is `434b7325287b58f36d214c9403819db2`.
- FD Apps Script Drive folder is `19IYxC1Bbc_ZBIE8EPOegCrMpiN4q4hDR`; verify folder ownership and access before creating a script.
- One acknowledgement and one suggestion per person, stable indicator ID, and year; acknowledgement is 1 point, approved suggestion is 2 points.
- The suggestion author cannot approve their own suggestion; only an authorized reviewer can approve or reject it.
- Award values are computed on the server. New awards require server timestamps after the explicit FD activation timestamp.
- No historical points, FB writes, user/UID copying, cross-station permissions, billing, or plan upgrades.
- Keep indicator visibility and actions behind existing FD `managementIndicatorsRead` / `managementIndicatorsWrite` authorization; do not grant permissions in bulk.
- Preserve existing FA, FB, FC, and FD indicator behavior outside the new actions and route.

## Review Focus

- A repeated acknowledgement or suggestion submission must not create another award; pin in the FD service idempotency tests.
- A self-approval or unauthorized review must not award points; pin in the FD service authorization tests.
- A source created before activation must not receive points; pin in the activation-boundary test.
- An indicator no longer authorized/available to the user must not expose data or accept a new action; pin in access and scope tests.
- Requests aimed at a different Firebase project or an FB route must fail without writes; pin in destination-guard tests.

---

### Task 1: FD award domain and server-side transaction

**Files:**
- Modify: `worker-indicators/service.js`
- Modify: `tests/indicators-platform-service.test.js`
- Modify: `tests/indicators-platform-workerd.test.js`

**Interfaces:**
- Consumes: existing `authorize(identity, manage)`, indicator snapshot lookup, transactional store, and `BOOTSTRAP` / `REFRESH` / `SAVE_REVIEW` / `SAVE_ACTION` service actions.
- Produces: `ACKNOWLEDGE_INDICATOR`, `SUBMIT_SUGGESTION`, and `REVIEW_SUGGESTION` actions. Persist one `fdPerformanceAcknowledgements` record per UID/metric/year, pending or terminal `fdPerformanceSuggestions` records, idempotent `fdPerformanceAwards`, and `fdPerformanceRuntime` containing `enabled`, `effectiveFrom`, `projectId`, and schema version. `GET_PERFORMANCE` returns only the caller's summary and up to 200 of their awards.

- [ ] **Step 1: Add failing service tests** for the point values, per-year uniqueness, second-person approval, rejection, unauthorized access, idempotent retries, activation cutoff, and caller-only ledger reads.
- [ ] **Step 2: Run `node --test tests/indicators-platform-service.test.js`** and confirm the new cases fail for the missing actions.
- [ ] **Step 3: Implement the actions in `worker-indicators/service.js`** with exact, allowlisted payload fields; validate current indicator IDs against the authorized snapshot; derive actor UID and timestamps from verified identity/server clock; commit source and award atomically with deterministic IDs; never accept a client point value.
- [ ] **Step 4: Add workerd contract tests** proving the HTTP adapter rejects malformed payloads, unauthorized identities, cross-project paths, and action names outside the allowlist.
- [ ] **Step 5: Run `node --test tests/indicators-platform-service.test.js tests/indicators-platform-workerd.test.js`**; all cases pass and all target writes identify project `rotinas-8a617`.

### Task 2: FD Firestore rules and indexes

**Files:**
- Modify: `firestore.indicators-platform.rules`
- Modify: `firebase.indicators-platform.test.json` only if test configuration needs an index/rules fixture
- Create: `firestore.fd-performance.indexes.json` only if a query added by Task 1 requires a composite index
- Create: `tests/fd-performance.rules.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: collection names and exact record shapes from Task 1.
- Produces: rules that deny client writes to all award, runtime, suggestion-review, and acknowledgement records; permit only the minimum self-read required by the UI (or deny direct reads if UI uses the authenticated service response); emulator command `test:fd-performance-rules`.

- [ ] **Step 1: Write emulator rules tests** for self-read, cross-UID read denial, all client-write denial, and preservation of existing FD indicator permissions.
- [ ] **Step 2: Run `npm run test:fd-performance-rules`** and confirm the new rule cases fail before rule changes.
- [ ] **Step 3: Add the narrow rules and any needed indexes** without changing access to existing indicator snapshots or expanding user roles.
- [ ] **Step 4: Run `npm run test:fd-performance-rules`**; all cases pass under the FD test project.

### Task 3: FD client repository and performance view

**Files:**
- Create: `src/fd-performance-data.js`
- Create: `src/fd-performance-ui.js`
- Create: `src/fd-performance.css`
- Create: `tests/fd-performance-data.test.js`
- Create: `tests/fd-performance-ui.test.js`

**Interfaces:**
- Consumes: authenticated FD session/project helpers, Task 1 service actions, and the existing FC performance UI conventions.
- Produces: `createFdPerformanceRepository({auth, service})` with `loadSummary()`, `acknowledge(metricId, year)`, `submitSuggestion(metricId, year, text)`, and `reviewSuggestion(suggestionId, decision)`; `mountFdPerformanceModule({root, repository, identity})`.

- [ ] **Step 1: Write data/UI tests** for loading, pending suggestions, one-point acknowledgement, two-point approved suggestion, rejected suggestion, loading/offline/blocked states, and no display of another person's history or response content.
- [ ] **Step 2: Run `node --test tests/fd-performance-data.test.js tests/fd-performance-ui.test.js`** and confirm expected failures.
- [ ] **Step 3: Implement the repository and UI** with no local point calculation and with all actions handled by the server repository.
- [ ] **Step 4: Run `node --test tests/fd-performance-data.test.js tests/fd-performance-ui.test.js`**; all cases pass.

### Task 4: FD route, menu, release gates, and integration verification

**Files:**
- Modify: `src/router.js`
- Modify: `src/management-hub.js`
- Modify: `src/main.js`
- Modify: `src/firebase-projects.js` and `src/deployment-context.js` only if the existing FD session cannot directly supply the project-scoped module
- Modify: `.github/workflows/pages.yml` only to add an independently disabled FD release flag and safe build verification
- Create: `tests/fd-performance-navigation.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 mount API and existing FD auth/session/profile permissions.
- Produces: `#/fd-performance`, a “Desempenho FD” entry visible only to existing authorized FD indicator users, and a disabled-by-default release gate that cannot route FD to FA/FB.

- [ ] **Step 1: Add navigation and release-gate tests** for authorized FD, unauthorized FD, FA/FB/FC routes, automatic login restoration, and flag-off behavior.
- [ ] **Step 2: Run `node --test tests/fd-performance-navigation.test.js tests/router.test.js tests/management-access.test.js`** and confirm the FD cases initially fail.
- [ ] **Step 3: Wire the route and menu** using the FD session and existing permission check; add no new mass grants and leave the FD release flag off.
- [ ] **Step 4: Run `npm run test:indicators-platform` and the focused navigation tests, then `npm run build`**; all pass and the disabled route is omitted/blocked as designed.
- [ ] **Step 5: Inspect the deployment diff** and verify no billing configuration, secrets, FA/FB writes, or live activation settings were introduced.

### Task 5: FD deployment preparation and explicit cutover review

**Files:**
- Create only after access verification: FD Apps Script project files in Drive folder `19IYxC1Bbc_ZBIE8EPOegCrMpiN4q4hDR`, if a scheduled executor is required
- Modify only after authenticated inventory: FD Worker deployment configuration/route and Firebase rules deployment target
- Create: `docs/superpowers/reports/2026-11-01-fd-performance-cutover.md`

**Interfaces:**
- Consumes: tested disabled release from Task 4 and authenticated FD/Cloudflare/Drive account inventory.
- Produces: reviewable report with exact project IDs, script/Worker IDs, rules diff, ACL result, billing-free plan status, disabled runtime status, activation command, and tested rollback procedure. No production activation occurs in this task.

- [ ] **Step 1: Verify account, project, folder ACL/ownership, Worker destination, Apps Script need, and billing state** using authenticated read-only access; stop if an access failure or billing requirement appears.
- [ ] **Step 2: Prepare station-scoped executor/deployment artifacts** with project-ID assertions and idempotent setup; leave routes, runtime, triggers, and scoring disabled.
- [ ] **Step 3: Run emulator, service, worker, client, browser, build, and release checks** named in Tasks 1–4 and record exact outputs without real point-generating business actions.
- [ ] **Step 4: Write the cutover and rollback report** with an activation timestamp boundary, idempotency checks, no-history proof, zero FB writes, and the exact operation that would activate FD.
- [ ] **Step 5: Present the concrete cutover package for one final production approval**; do not activate or publish while that approval is pending.
