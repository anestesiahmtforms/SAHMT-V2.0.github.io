# SAHMT Performance Implementation Plan

> **For agentic workers:** Execute independent UI, source adapter and schedule tasks in parallel; root implements the server service and integrates, then request whole-change review.

**Goal:** Consolidated individual SAHMT points in Indicators with one daily 02:00 America/Sao_Paulo batch and audited administrator entries.
**Architecture:** FD stores immutable daily batches, sanitized category histories and one publication pointer. Trusted source adapters reconcile validated source data using explicit UID mappings. The browser reads FD only; manual entries await the next daily batch.
**Tech Stack:** JavaScript ES modules, Cloudflare Workers, Firestore REST, Vite, node:test, Playwright.
**Spec:** Approved `outputs/desempenho-sahmt-proposta.txt` in original chat deliverables (copied into specs at integration).

## Global Constraints
- Six categories: OPERATIONS, MANAGEMENT, RECORDS, SURVEYS, NOTIFICATIONS, CONTINUING_EDUCATION.
- No inferred identities, missing-source zeros, partial batch publication or duplicate points.
- Positive and negative totals preserved; percentage null unless team maximum is positive.
- Sole schedule 02:00 America/Sao_Paulo; old 00:00 and 12:00 removed.
- Manual writes require administrator; own data only; no source scans on panel opening.

## Review Focus
- Unmapped source UIDs must block complete publication rather than disappear.
- Concurrent daily invocations cannot publish mixed data or repeat external source reads.
- Failure after partial batch staging cannot replace last complete result.
- Manual corrections are immutable deltas and must not overwrite pending or confirmed originals.
- Session changes during requests cannot display another person's data; category pagination pins batch.

### Task 1: Trusted source adapter
Files: worker-indicators/sahmt-performance-sources.js; tests/sahmt-performance-sources.test.js.
Interface: createSahmtPerformanceSources({getAccessToken,fetchImpl,readBudget,now}).load({cutoff,members}) -> {complete,rows,readsByProject}.
- [ ] Write tests for signed points, provenance, immutable cutoff, paging and source failure; observe RED.
- [ ] Implement exact real source contracts; reject missing prerequisites; observe GREEN.

### Task 2: Daily service and manual ledger
Files: worker-indicators/sahmt-performance-service.js, store.js, service.js, worker.js, read-budget.js; tests/sahmt-performance-service.test.js.
Interface: createSahmtPerformanceService({store,sources,authorize,now,uuid}).execute(action,input,identity); .runDaily(scheduledTime).
- [ ] RED: total/max, manual permission/idempotency/correction, daily lease/failed source/atomic publication, own history.
- [ ] Implement authenticated FD-only queries, versioned manual deltas, immutable batch pages and publication pointer.
- [ ] Wire server routes and shared read budgets, run meaningful service/integration checks.

### Task 3: Frontend
Files: src/sahmt-performance-ui.js, .css, -client.js; tests/sahmt-performance-ui*.js; preview fixture.
Interface: mountSahmtPerformance(root,{request,isCurrent}) -> synchronous cleanup.
- [ ] RED: six buttons, signed totals, missing reference, PREPARING/stale, admin-only form, request/session guards.
- [ ] Implement category histories, pagination, manual entry pending next 02:00, mobile layout; verify GREEN.

### Task 4: Sole daily schedule
Files: schedule-envelope.js, scheduled-refresh.js, worker-fd-scheduler/*, deploy-fd-fixed-sync.mjs; schedule tests.
- [ ] RED: accept 05:00 UTC only; reject legacy windows; once daily ID and year boundary.
- [ ] Add PERFORMANCE signed action before aggregate collection; preserve signatures and budgets.
- [ ] Update configured cron and displayed schedule to 02:00; verify GREEN.

### Task 5: Integrate, verify, package
Files: src/main.js, management-hub.js/.css, firestore.indicators-platform.rules, deployment instructions/tests as necessary.
- [ ] Add hub panel, remove old launch buttons, preserve activity access and current authorizations.
- [ ] Verify backend, sources, schedule, browser interactions and affected existing tests; compile apps/Worker.
- [ ] Fresh reviewer inspects complete diff; fix important findings with regression checks.
- [ ] Commit work, package a reviewable patch in original outputs, report actual production state separately.

## Execution ledger
- Spec approved by user on 2026-11-07. Native implementation with bounded independent parallel tasks avoids duplicate approval prompts.
- Worktree base 4abcd09085c6d17e0912218c7c0115acaec1ebe9, detached and managed by Codex.
- Old FD scheduler trigger removed and saved through authenticated dashboard; visible state: No cron triggers configured. New schedule not yet deployed.
