# FI Administrative Control and AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the coordinator; independent administrative and source/AI tasks use the already dispatched scoped reviewers/implementers. Steps use checkbox syntax.

**Goal:** Repurpose FI as the administrative and AI control center, with scoped internal search, monthly administrative analysis, and migrated People/Admin/Update management.

**Architecture:** FI owns a server-side Cloudflare service backed by the empty `sahmt-operacional-fi` Firestore. FA keeps authentication and its access gate; FJ keeps operational consumers/projections; FD remains the numeric indicators source. Every request checks FA identity, current FA gate, an explicit FI identity link and the FI authorization profile before dispatch; data is filtered before model input.

**Tech Stack:** Existing JavaScript modules, Firebase REST, Cloudflare Workers/nodejs_compat, OpenAI Responses, Vite, node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-fi-control-ai.md`; approved chat design plus user addenda (FI reset, FI admin center, effective-only documents, explicit authorization to include administrative migration and to use Astra).

## Global Constraints

- FI project `sahmt-operacional-fi`, Cloudflare account `948f85652861c7c25506625091d2120d`, owner `anestesiahmtforms9@gmail.com`.
- No Drive cleanup by this task; owner handles it. No other Firebase project/database or Cloudflare account cleanup.
- Live inspection found zero default Firestore collections, zero Workers/KV/DO; D1 inspection denied. Never call denied inspection an empty inventory.
- Do not delete FA Auth/gate or FJ operational sources. No broad changes to roles, UID assignments or existing unrelated worktrees.
- Members `EFETIVO` only may search restricted administrative documents, in addition to their source ACL.
- Operational search is personal/official involvement; notification search is recipients/involved only. No free-text identity inference.
- Sources are internal only; unknown/incomplete/ambiguous data fail closed. No external model tools or autonomous production adjustments.
- Default model usage off without server-only key and positive budget; do not enable billing or auto recharge.
- Import links explicitly; `actor.uid` is FA UID, `actor.fiUid` is FI UID, `actor.profile.uid` is FI UID.

## Review Focus

- Different UIDs and case-normalized email across FA/FI/source projects: no implicit identity equality.
- Legacy documents without audience, recipient-only events and ambiguous names: no metadata leakage.
- Concurrent requests, failed AI calls and stale monthly leases: no budget overspend or stale report publication.
- Administrative commit succeeds while FA/FJ projection fails: visible pending state, idempotent retry, no false success.
- Account changes, revoked access and delayed frontend responses: old results discarded, no FI requests on idle Home.

---

### Task 1: Verify the FI reset and dependency boundary

**Files:** `docs/superpowers/reports/2026-11-09-fi-inventory.json`, private `.local-preview/fi-control/*`, `firestore.fi-control.rules`, `firebase.fi-control.json`.

**Interfaces:** Supplies confirmed target IDs, empty-resource evidence, original rules/index metadata and readiness status. Never exports personal data into committed reports.

- [x] Read current origin/main in isolated worktree; baseline `node --test tests/fi-retired-worker.test.js tests/people-fi-routing.test.js tests/firebase-projects.test.js` => 13 pass.
- [x] Verify Google and Cloudflare principal/account before resource requests. Record exact successes and denied surfaces.
- [ ] Inspect named databases, old indexes, active rules and known FI Apps Script source/deployments; backup configuration before authorized changes.
- [ ] Apply new FI deny-client rules; remove only positively identified obsolete FI resources if present, with recoverable capture and post-read verification. Empty resources require no destructive calls.

### Task 2: FI runtime, identity, store and frontend transport

**Files:** Create `worker-fi-control/worker.js`, `identity.js`, `store.js`, `wrangler.jsonc`, `src/fi-control-client.js`; tests `tests/fi-control-worker.test.js`, `fi-control-store.test.js`, `fi-control-client.test.js`.

**Interfaces:** `createFiControlWorker({verifyActor,buildServices})`; POST `/v1/control` body `{action,input}`. Actor `{uid,fiUid,email,profile,memberCategories,identityLink}`. Store `{get(collection,id),list(collection,filters,limit),transaction(fn)}`; transaction `{get,set,create,delete}`. Filters `{field,op:'EQUAL'|'ARRAY_CONTAINS',value}`. Frontend `fiControlRequest(action,input,uid)` and `createFiControlRequest({uid,isCurrent,getIdToken,getAppCheckToken,fetchImpl})` returning callable request plus `dispose`.

- [ ] Write and run RED tests for origin/auth/input gates, identity mismatch, request limits, account-switch results, bounded transactions and overflow.
- [ ] Implement fixed endpoints/project allowlists, current FA access lookup and FI link/profile validation; server credential only.
- [ ] Run GREEN tests. No production model call is part of tests.

### Task 3: Administrative migration (scoped Astra agent)

**Files:** Create `worker-fi-control/admin.js`, `src/fi-admin-data.js`, `src/fi-admin-adapter.js`, tests `tests/fi-admin*.test.js`; modify only agreed admin adapters and route glue in `main.js`, `router.js`, `app-updates-targeted-firebase.js`, `management-pilot.js` as needed.

**Interfaces:** `createFiAdminService({store,projections,now}).execute({actor,action,input})`. Collections: `fiAdminUsers`, `fiAdminIdentityLinks`, `fiAdminOutbox`, `fiAdminAudit`, `fiAdminUpdateRequests`, `contacts`, `eventMembers`, `memberCategoryAssignments`, `appConfig`, `users` for local authorization. `projections.FA/FJ` use Task 2 store interface.

- [ ] Test RED administrative authorization, different UIDs, optimistic versions, idempotent projections and pending errors.
- [ ] Move People/Admin/Update administrative authority to FI without breaking operational FJ projections or FA update receivers.
- [ ] Keep transport behind `VITE_FI_ADMIN_ENABLED` until the verified import/deployment. Add route `fi-control` that mounts Task 5 UI.
- [ ] Run directed and existing administrative regression suites.

### Task 4: Authorized sources, AI search, budget and monthly reports (scoped Astra agents)

**Files:** `worker-fi-control/sources*.js`, `search.js`, `monthly.js`, `ai-provider.js`, `fi-ai-policy.js`, `fi-ai-budget.js`; tests `tests/fi-sources*.test.js`, `tests/fi-ai*.test.js`.

**Interfaces:** `createFiSourceProvider({stores,resolveIdentity,now})` provides `searchRecords(actor,query)` and `monthlySnapshot(actor,period)`; `createFiAiService({store,sourceProvider,modelProvider,now,config})` provides `search(actor,input)` and `monthly(actor,input)`; `createOpenAIProvider` uses fixed Responses endpoint/model with schema/no tools/store:false.

- [ ] RED tests for restricted effective-only documents, official ownership, recipients, unknown classifications and citations.
- [ ] Implement bounded retrieval from real source schemas, explicit coverage limitations and server-validated identity resolution.
- [ ] RED/GREEN budget reservations and monthly admin signature/lease/idempotence tests, including uncertainty after provider failure.
- [ ] Monthly data comes from FD; no metrics supplied by browser. Missing sources do not become zero.

### Task 5: Control center UI and integration

**Files:** `src/fi-control-ui.js`, `src/fi-control.css`, tests `tests/fi-control-ui.test.js`; agent-owned route glue from Task 3.

**Interfaces:** `mountFiControl(host,{request,isCurrent,onNavigate,profile})` returns dispose. Search accessible to active users; admin-only analysis/actions validated in server, not merely hidden.

- [ ] Test RED safe rendering/citations/current-session handling and administration visibility.
- [ ] Implement search with internal references, monthly administrative view, service readiness and navigation into migrated administrative modules.
- [ ] Run GREEN and build existing independent apps. Do not display unimplemented features as available.

### Task 6: Import, deploy, verify and deliver

**Files:** `scripts/fi-control-release.mjs`, `scripts/lib/fi-control-migration.js`, tests `tests/fi-control-migration.test.js`, deployment report and operational runbook.

**Interfaces:** Bounded metadata/inventory mode, dry-run migration manifest, verified backup/import receipt and explicit apply. Source FA/FJ data preserved; idempotent FI writes never overwrite divergent destination changes.

- [ ] RED/GREEN pure planner tests for project binding, collisions, links, counts, unchanged replay and conflicting destination data.
- [ ] Read a bounded source snapshot, protect personal backup with Windows DPAPI and verify digest; report counts only.
- [ ] Import approved administrative state to FI, provision least-needed server identity, deploy authenticated Worker with inference off until key/credits verified, then verify no-secret health and denial cases.
- [ ] Run combined tests/build, get independent whole-change review, fix material findings with regression tests, and prepare reviewable branch/PR without unrelated edits.
- [ ] Record what is live, what is local, unavailable surfaces, remaining account setup and model usage. Never report activation without evidence.
