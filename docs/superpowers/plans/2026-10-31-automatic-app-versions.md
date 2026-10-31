# Automatic App Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the version automation; a separate diagnostic implementer owns the independent receipt navigation fix.

**Goal:** Number successful app publications automatically and display Home device receipts in the existing administrator flow.

**Architecture:** Resolve the last successful Pages SHA, validate its public metadata, plan the next visible/numeric version and embed one plan into FA/FB builds. Management opens the administrator control in FA, where Home installations are recorded.

**Tech Stack:** Existing Node ESM, Vite, GitHub Actions, Firebase client and Node/Playwright tests; no added dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-automatic-app-versions-design.md`.

## Global Constraints

- Preserve login, per-installation IDs, choices, scores and existing permissions. No update campaign dispatch.
- Bootstrap only V2.2/release1793453478943/revision8ca87a6e2382bf26ad15c6ca1e0b334cd25e378d.
- Local browser control is disabled; run browser regressions in remote CI.
- Exclude all preexisting `scripts/*.local.mjs` and private diagnostics from commits.

## Review Focus

- Failed deployment or repeated run must not consume a new published version.
- An old CDN response must not assign a duplicate number to different code.
- Re-running an older source must not replace a later successful publication.
- Both apps and receipts must use the same value embedded in their own JavaScript.
- A common user must not gain access through the new control route.

### Task 1: Publication planner and build integration

**Files:** Create `scripts/lib/app-publication.js`, `scripts/prepare-app-publication.mjs`, `src/app-version-seed.json`, `tests/app-publication.test.js`; modify `src/app-version.js`, `scripts/build-independent-apps.mjs`, `.github/workflows/pages.yml` and `docs/targeted-app-updates.md`.

**Interfaces:** `planAppPublication({metadata,deployedRevision,sourceRevision,comparison,now})` returns `{schema:1,appVersion,sourceRevision,release}`. `prepareAppPublication({sourceRevision,repository,fetchImpl,token,now})` reads only fixed GitHub/Pages endpoints and returns that plan. Build consumes `SAHMT_PUBLICATION_FILE`, passes `VITE_APP_VERSION` and `VITE_APP_RELEASE` to both targets, and publishes the same plan identifiers.

- [x] Write/run RED tests for increments, retry reuse, failed deployment exclusion, stale metadata/revision/network failures.
- [x] Implement planner and read-only preparation; run tests GREEN.
- [x] Embed validated plan in FA/FB build and metadata; serialize main runs, prepare only production publications and verify published metadata after deploy.
- [x] Run focused/domain/build checks and commit scoped automation files.

### Task 2: Principal-app administrator receipts

**Files:** `src/router.js`, `src/main.js`, `src/app-updates-targeted-admin.js` and focused navigation/access/browser tests, owned by `diagnose_update_receipts`.

- [x] Prove the cutover scope regression with a failing test.
- [x] Open a dedicated FA administrator route from the existing Management button, return to Management on user exit, preserve teardown behavior.
- [x] Verify access and existing per-device receipt behavior; inspect/integrate implementer changes.

### Task 3: Review, CI and publication

- [x] Request independent whole-branch review; resolve important findings with tests.
- [ ] Create/attach PR; pass full security/build and remote Chromium/WebKit CI.
- [ ] Merge and verify deployed V2.3, shared label/release and dedicated FA control route. No forced update campaign.
