# Desempenho FE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing FE performance module that awards one point for each accepted survey participation, regardless of answers, with one award per user, survey, and cycle after explicit activation.

**Architecture:** Extend the existing authenticated FE survey service so accepted `surveyParticipation` receipts can create an idempotent award in the FE Firebase project without reading response documents. Add an independent FE summary route and UI that reads only the current user's FE ledger. Create any Apps Script executor/bootstrap assets only in the supplied FE Drive folder, after confirming its access and whether a scheduled executor is necessary.

**Tech Stack:** JavaScript ES modules, Firebase Auth/Firestore, Cloudflare Worker (`worker-training` survey service), Apps Script only if required for server-side scheduled processing, Vite, Node.js test runner, Firebase Firestore emulator.

**Spec:** `docs/superpowers/specs/2026-11-01-fd-fe-performance-design.md`

## Global Constraints

- Firebase destination is `outros-48120`; Cloudflare account supplied for FE is `fb3d38f501820ddf90764aadaa94fc89`.
- FE Apps Script Drive folder is `150uuRybtq-xkA8hlIRlJ11Pe5K00-0Jx`; verify folder ownership and access before creating a script.
- Award exactly one point for accepted participation in `climate`, `stress`, or `epidemiological`; uniqueness is UID + survey + cycle.
- Award values and activation cutoff are server-controlled; client submissions never contain point values.
- Read only the minimal `surveyParticipation` receipt; do not copy, inspect, or store answers, comments, response IDs, or response-document references in the points ledger.
- No historical points, FB writes, user/UID copying, cross-station permissions, billing, or plan upgrades.
- Keep participation and survey response storage separate; preserve existing survey submit, privacy, authentication, and cycle-closure behavior.
- Leave production route, scoring activation, and release flag disabled until a concrete final cutover review is approved.

## Review Focus

- A duplicate participation request must not create another award; pin in the FE service transaction test.
- A participation before activation must not receive points; pin in the activation-boundary test.
- Closed/unsupported survey cycles must not award points; pin in cycle and survey allowlist tests.
- Ledger records and UI must not contain response answers or comments; pin in service shape and UI privacy tests.
- A request or FE session targeting FD, FA, or FB must not write to another Firebase project; pin in project destination tests.

---

### Task 1: FE participation award transaction

**Files:**
- Modify: `worker-training/survey-service.js`
- Modify: `tests/survey-service.test.js`
- Modify: `tests/survey-worker.test.js`

**Interfaces:**
- Consumes: existing authenticated `SUBMIT` flow, validated `surveyParticipation` marker, supported survey kinds, cycle validation, and transactional store.
- Produces: `fePerformanceRuntime`, `fePerformanceAwards`, and `fePerformanceSummaries`; create the award atomically with the accepted participation only when runtime is enabled and server timestamp is at/after `effectiveFrom`. `GET_PERFORMANCE` returns the caller's summary and up to 200 of their awards. Deterministic award key is UID + survey + cycle.

- [ ] **Step 1: Add failing tests** for each supported survey, answer-independent scoring, one award per UID/survey/cycle, duplicate submissions, activation boundary, closed cycle, unsupported survey, and zero response fields in point records.
- [ ] **Step 2: Run `node --test tests/survey-service.test.js tests/survey-worker.test.js`** and confirm the new performance cases fail.
- [ ] **Step 3: Implement award creation in the accepted participation transaction** using the server timestamp and the existing receipt; do not read or duplicate response data and do not alter the survey response format.
- [ ] **Step 4: Add Worker contract tests** for authenticated self-only reads, exact supported action/input, and refusal of cross-project destinations.
- [ ] **Step 5: Run `node --test tests/survey-service.test.js tests/survey-worker.test.js`**; all cases pass and awards are written only to `outros-48120`.

### Task 2: FE Firestore rules and indexes

**Files:**
- Modify: `firestore.climate.rules`
- Modify: `firebase.climate.test.json` only if test configuration needs an index/rules fixture
- Create: `firestore.fe-performance.indexes.json` only if a query added by Task 1 requires a composite index
- Create: `tests/fe-performance.rules.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: collection names and exact record shapes from Task 1.
- Produces: rules denying client writes to runtime, award, and summary records; allow only caller-self reads needed by the UI (or deny direct reads if the service returns data); emulator command `test:fe-performance-rules`.

- [ ] **Step 1: Write emulator rules tests** for self-read, cross-UID read denial, client-write denial, and unchanged access to current FE survey flows.
- [ ] **Step 2: Run `npm run test:fe-performance-rules`** and confirm new rules cases fail before the rules change.
- [ ] **Step 3: Add only the narrow new collection rules** and any required indexes; preserve existing response privacy and access controls.
- [ ] **Step 4: Run `npm run test:fe-performance-rules`**; all cases pass against the FE emulator configuration.

### Task 3: FE client repository and performance view

**Files:**
- Create: `src/fe-performance-data.js`
- Create: `src/fe-performance-ui.js`
- Create: `src/fe-performance.css`
- Create: `tests/fe-performance-data.test.js`
- Create: `tests/fe-performance-ui.test.js`

**Interfaces:**
- Consumes: authenticated FE session/project helpers, Task 1 service response, and the existing FC performance UI conventions.
- Produces: `createFePerformanceRepository({auth, service})` with `loadSummary()`; `mountFePerformanceModule({root, repository, identity})` renders total, percentage relative to the highest confirmed FE balance, and the caller's recent history only.

- [ ] **Step 1: Write data/UI tests** for empty, awarded, loading, offline, and blocked states, the three supported survey labels, self-only history, and absence of answers/comments/response references.
- [ ] **Step 2: Run `node --test tests/fe-performance-data.test.js tests/fe-performance-ui.test.js`** and confirm expected failures.
- [ ] **Step 3: Implement the repository and responsive view** without client-side point calculation or access to survey response collections.
- [ ] **Step 4: Run `node --test tests/fe-performance-data.test.js tests/fe-performance-ui.test.js`**; all cases pass.

### Task 4: FE route, menu, release gates, and integration verification

**Files:**
- Modify: `src/router.js`
- Modify: `src/management-hub.js`
- Modify: `src/main.js`
- Modify: `src/firebase-projects.js` and `src/deployment-context.js` only if existing FE auth session cannot directly supply the project-scoped module
- Modify: `.github/workflows/pages.yml` only to add an independently disabled FE release flag and safe build verification
- Create: `tests/fe-performance-navigation.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 mount API and existing FE authenticated session with persistent login restoration.
- Produces: `#/fe-performance`, a “Desempenho FE” entry in the FE survey experience, and a disabled-by-default release gate that cannot route FE to another station.

- [ ] **Step 1: Add route tests** for FE authenticated entry, automatic session restoration, route flag off/on, FA/FB/FC sessions, and back-navigation to the FE survey experience.
- [ ] **Step 2: Run `node --test tests/fe-performance-navigation.test.js tests/router.test.js tests/survey-session-bridge.test.js`** and confirm new FE cases fail.
- [ ] **Step 3: Wire the route and menu** to the existing FE session and its project-specific repository; leave the release flag off.
- [ ] **Step 4: Run `npm run test:survey-session`, focused navigation tests, and `npm run build`**; all pass with no changes to login restoration or existing survey response content.
- [ ] **Step 5: Inspect the deployment diff** and verify no billing, secrets, response-content access from the points view, or live activation settings were introduced.

### Task 5: FE deployment preparation and explicit cutover review

**Files:**
- Create only after access verification: FE Apps Script project files in Drive folder `150uuRybtq-xkA8hlIRlJ11Pe5K00-0Jx`, if a scheduled executor is required
- Modify only after authenticated inventory: FE Worker deployment configuration/route and Firebase rules deployment target
- Create: `docs/superpowers/reports/2026-11-01-fe-performance-cutover.md`

**Interfaces:**
- Consumes: tested disabled release from Task 4 and authenticated FE/Cloudflare/Drive account inventory.
- Produces: reviewable report with exact project IDs, Worker/script IDs, folder ACL result, billing-free plan status, disabled runtime status, activation command, and tested rollback procedure. No production activation occurs in this task.

- [ ] **Step 1: Verify account, project, folder ACL/ownership, Worker destination, Apps Script need, and billing state** using authenticated read-only access; stop if access is unavailable or billing would be required.
- [ ] **Step 2: Prepare station-scoped executor/deployment artifacts** with destination assertions and idempotent setup; leave routes, scoring, runtime, and triggers disabled.
- [ ] **Step 3: Run service, Worker, emulator, client, browser, build, and release checks** from Tasks 1–4; record exact outputs without using real survey responses or generating points.
- [ ] **Step 4: Write the cutover and rollback report** with activation boundary, one-award proof, no-history proof, no-response-content proof, and zero cross-project writes.
- [ ] **Step 5: Present the concrete cutover package for one final production approval**; do not activate or publish while that approval is pending.
