# Desempenho FA Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. Preserve the approved production authorization.

**Goal:** Publish isolated administrator-only FA performance, starting at activation.
**Architecture:** Pure reconciliation domain, additive central Apps Script processor, read-only Worker, dedicated PWA view. Existing authentication and operational routes remain intact.
**Tech Stack:** JavaScript, Apps Script, Firestore REST, Cloudflare Workers, Vite.
**Spec:** ../specs/2026-11-02-fa-performance-design.md

## Global Constraints
- Project sahmt-17a16; existing central script and FA Cloudflare account only; no billing.
- No historical import, automatic external sync or authentication changes.
- Checklist third-party science +1/-1 once per day; self science zero.
- ATRASO multiples 0..6 => -0.5,-1,-2,-3,-4,-5,-6; preserve financial values.
- Administrator authorization on server and UI; negative totals valid.

## Review Focus
- Ambiguous/reassigned member siglas must not penalize the creator or a guessed person.
- Missing timestamps and pre-cutoff requests must not enter a new balance.
- Retry after partial writes must preserve ledger and confirm only consistent totals.
- Paid events remain penalties; cancellations and edits reconcile without duplication.
- Versioned central deployments and stale clients must not restart Checklist credits in FB.

### Task 1: deterministic scoring
**Files:** fa-performance/domain.js; tests/fa-performance-domain.test.js.
**Interfaces:** projectFaPerformance({events,signatures,requests,profiles,previousAwards,effectiveFrom,cutoffDay,now,complete}) => {awards,ledger,totals,maxPerformance,pending}; runtime supplies trusted snapshot validity.
- [ ] Write/run failing cases for all penalty values, self/third-party science, cutoff, ambiguity, retry, cancellation and edits.
- [ ] Implement projection with stable award IDs, signed deltas and prior subject retention.
- [ ] Run node --test tests/fa-performance-domain.test.js; expect all pass; commit.

### Task 2: additive processor
**Files:** apps-script-v2/FaPerformance.gs; generated FaPerformanceDomain.gs; scripts/build-fa-performance.mjs; tests/fa-performance-runtime.test.js.
**Interfaces:** instalarDesempenhoFaV1 sets immutable runtime and own 15-minute trigger; executarDesempenhoFaV1 reads complete consistent source snapshot and publishes confirmed revision.
- [ ] Add tests for create-only cutoff, partial writes/retries, own trigger scope and isolated write allowlist.
- [ ] Implement validated source projection, bounded queries, PENDING/CONFIRMED revision and ledger persistence.
- [ ] Remove legacy delivery for new accepted science while preserving signature validation.
- [ ] Run focused runtime/domain tests; expect pass; commit.

### Task 3: reader and interface
**Files:** worker-fa-performance/; src/fa-performance-client.js; src/fa-performance-ui.js; src/main.js; src/router.js; tests/fa-performance-worker.test.js; tests/fa-performance-ui.test.js.
**Interfaces:** POST /v1/fa-performance action GET_PERFORMANCE provides confirmed team/subject summary to active administrators only.
- [ ] Add failing admin/revision/negative-value tests.
- [ ] Implement dedicated read adapter without changing shared auth/store project boundaries.
- [ ] Add Checklist-only button and route lifecycle; preserve integrated login.
- [ ] Run focused auth/navigation and FA tests, build PWA; expect pass; commit.

### Task 4: production preparation and activation
**Files:** scripts/prepare-fa-performance.mjs; scripts/activate-fa-performance.mjs; protected local candidate/backup; sanitized report.
**Interfaces:** exact account/project checks, disabled Worker, protected reader credentials; central additive upload conditioned on HEAD hash.
- [ ] Verify current deployed files, rules and free infrastructure; snapshot deployments.
- [ ] Prepare least-privilege reader and disabled Worker; upload central candidate preserving other files/manifest.
- [ ] Execute runtime installation (request a single manual execution only if Google blocks remote execution), verify initial real cycle and immutable cutoff.
- [ ] Enable reader after reference CONFIRMED. Record zero fabricated business actions.

### Task 5: final review and publication
**Files:** release report and existing release configuration/workflow.
- [ ] Fresh whole-branch review under executing-plans; fix material findings with regression coverage.
- [ ] Publish authorized release through GitHub Desktop; verify workflow success and deployed source SHA.
- [ ] Record status, limitations, rollback and actual activation timestamp.
