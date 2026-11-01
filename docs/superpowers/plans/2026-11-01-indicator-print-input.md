# Monthly print input implementation plan

> **For agentic workers:** Use executing-plans for integration. Independent count compatibility and pure parsing/reconciliation tasks may run under dispatching-parallel-agents; review the final branch before publication.

**Goal:** Import monthly technique/event prints in the app and synchronize only new/changed source content, preserving independent totals and manual data.

**Architecture:** Backward-compatible explicit anesthetic total, shared pure parser/reconciler, manager-only authenticated OCR/Drive preview/apply service and one-dialog UI. Existing FC month/history writes remain canonical.

**Tech stack:** Existing Node ESM/Vite/Firebase FC/Worker/Apps Script/Drive; no paid OCR dependency.

**Spec:** docs/superpowers/specs/2026-11-01-indicator-print-input-design.md

## Global constraints

- Final user rule: Total geral -> surgical; sum individual technique counts -> anestheticProcedures. Ignore event-panel Total de registros. Count every association component individually, including Outra Técnica as sedation + regional. Never add the surgical total to the anesthetic total.
- Outra Técnica -> sedation + regional. Keep eighteen indicator definitions and missing counts distinct from zero.
- Exclude periods before 2026-07 from print import/sync. Do not rewrite January–June.
- Preserve original checkout, untracked local scripts, FC authorization, manual values and immutable history. No forced app-update campaign.
- Clinical counts/images, OAuth tokens and source configurations stay private. Remote browser CI only.

## Review focus

- Explicit zero versus missing total and legacy records without the optional field.
- Ambiguous OCR row/column ordering must not silently pair unrelated counts.
- A newer source and a concurrent manual edit must never silently overwrite each other.
- Calendar/source year, source role and unit must remain fixed through asynchronous operations.
- Duplicate confirmations, partial failure and source metadata-only updates must not duplicate month revisions.

### Task 1: Explicit anesthetic procedure total

**Files:** src/qmentum-catalog.js, qmentum-engine.js, qmentum-overview.js; tests; generated apps-script-v2/QmentumCore.gs.

- [ ] RED: independent explicit total wins over technique sum, zero is respected, old input schema remains valid, overview origin distinguishes source and fallback.
- [ ] Add optional anestheticProcedures count/origin without changing existing indicator arithmetic or rewriting records. GREEN focused tests.

### Task 2: Print parser and incremental reconciliation

**Files:** src/qmentum-print-import.js; tests/qmentum-print-import.test.js.

**Interface:** parseTechniquePrint(text) -> {rows,counts,anestheticProcedures,tableTotal}; parseIndicatorPrint(text) -> {counts}; preparePrintPreview({period,techniquesText,indicatorsText}) -> {period,counts,rows,missingFields}; reconcilePrintImport({currentInputs,baseline,sourceCounts,resolutions}) -> {inputs,changes,conflicts,changed}.

- [ ] RED complete synthetic OCR fixtures, unknown/ambiguous rows, duplicate labels, missing/zero totals, independent source totals.
- [ ] Implement strict normalization/mapping, no guessed clinical outcomes; test three-way field merge and idempotency. GREEN.

### Task 3: Authenticated source preview and application

**Files:** server/qmentum-print-service.js; worker-management-auth/qmentum-print-relay.js + worker route; apps-script-v2/QmentumPrints.gs + generated print core + dispatcher; deployment helpers/tests.

**Interface:** POST /v1/qmentum/prints body operations SCAN, PREVIEW, APPLY, unitId and period/year; signed bounded relay to FC Apps Script. Server injects Drive/OCR/store adapters for deterministic tests.

- [ ] RED source limits/metadata no-op, wrong year/unit, missing/duplicate pairs, session/manager denial, signed relay replay/response limits and atomic CAS application.
- [ ] Implement allowlisted folder reads and private temporary OCR lifecycle; store expiring private previews, baseline and receipts; use prepareQmentumWrite and existing FC commit semantics.
- [ ] Verify unchanged content and duplicate confirmation create no monthly revision; missing fields/manual conflicts/closed months are protected. GREEN backend/relay tests.

### Task 4: Manager UI, integration and publication

**Files:** src/qmentum-print-ui.js + CSS, qmentum-ui.js, qmentum-data.js; synthetic browser fixtures/tests, package/workflows, scoped deployment/initial-import scripts and documentation.

- [ ] RED two-file upload, Drive candidates, editable preview, explicit totals, manual conflict choices, session changes and one-dialog return.
- [ ] Integrate manager actions and authenticated client; keep manual entry and existing navigation. GREEN unit/domain/build and remote Chromium/WebKit.
- [ ] Independent full-branch review, fix material findings with RED/GREEN, open/attach PR and pass CI.
- [ ] Deploy only scoped FC backend/relay changes with existing settings preserved; verify real OCR and source fingerprints. Apply authorized July–October import atomically with audit and zero writes to January–June.
- [ ] Publish normally with automatic versioning, verify served assets and FC values/receipts; do not dispatch mandatory updates.
