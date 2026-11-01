# Indicator Monthly Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the FC/home integration. An independent chart task may run in parallel under dispatching-parallel-agents; review the complete branch before publication.

**Goal:** Show the latest monthly information first, with calendar selection and existing mandatory indicators in a modal with horizontal monthly charts.

**Architecture:** Reuse canonical FC monthly documents and the trusted existing saving path. A pure overview helper formats recorded fields and identifies real inputs. The UI owns one selected scope and one replaceable modal. Monthly charts retain their public interface.

**Tech Stack:** Existing Firebase/FC, Node ESM, Vite, CSS/HTML and Node/remote Playwright tests; no dependency changes.

**Spec:** `docs/superpowers/specs/2026-11-01-indicator-monthly-home-design.md`.

## Global Constraints

- Keep all monthly data in FC `indicadores---sahmt`; preserve January–June 2026 records, immutable history and formulas.
- Reuse permissions and trusted versioned writes; no access grants, reset, automatic clinical approval or forced app campaign.
- Reference screenshots, additional fields and extraction mapping will be supplied later. Start with existing recorded fields and do not invent numbers.
- Browser control is disabled locally; UI verification runs remotely in Chromium/WebKit.
- Exclude six preexisting `scripts/*.local.mjs` and private diagnostics from commits.

## Review Focus

- A newer empty draft must not hide the last recorded month.
- Missing, zero, unavailable, provisional and informed percentages stay distinct.
- Late reads and failed month/unit changes cannot put a draft into the wrong period.
- Closing a modal must preserve the selected month and avoid nested or orphaned dialogs.
- Calendar year changes and percentages beyond a single current year must not confuse periods.

### Task 1: Overview and latest FC period

**Files:** New `src/qmentum-overview.js`, `tests/qmentum-overview.test.js`; update `src/qmentum-data.js`, `tests/qmentum-runtime.test.js`.

- [x] Write/run RED tests for recorded versus empty input, overview missing/zero values and latest period across years.
- [x] Implement pure formatting and bounded authenticated FC period lookup; run GREEN.

### Task 2: Horizontal monthly chart

**Files:** `src/qmentum-charts.js`, chart styles and focused tests; independent implementer owns only these files.

- [x] Add a failing horizontal monthly rendering test, then replace the line graph while preserving the function API and metadata.
- [x] Test percentages, zero, absent/provisional values, target and accessible labels; no arithmetic changes.

### Task 3: Monthly home and mandatory selection modal

**Files:** `src/qmentum-ui.js`, `src/qmentum-ui.css`, `src/qmentum-shell.js`, runtime/browser fixtures and regressions.

- [x] Default to the latest FC period, display month calendar and existing monthly data with manual-entry action.
- [x] Move the 18-indicator grid/tools into the mandatory selection modal and preserve one-modal back/focus/draft behavior.
- [x] Update browser tests for new navigation, latest month, safe save and failure handling; run remotely in CI.

### Task 4: Review and publication

- [x] Run focused/domain/build checks and review scope/auth/lifecycle; FC rules checks run in required CI.
- [ ] Create/attach PR and pass required CI plus Chromium/WebKit.
- [ ] Publish through automatic versioning and verify the served monthly home/charts; no production data edits.
