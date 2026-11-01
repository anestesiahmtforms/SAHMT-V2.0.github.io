# FC integration isolation implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. The user explicitly authorized autonomous diagnosis, preparation and reversible verification, and requires approval only before production cutover or changes affecting the current environment.

**Goal:** Operate FC through its own Apps Script executor, Cloudflare account and Drive resources while preserving the common PWA and existing identities.

**Architecture:** Keep the current Google/Firebase session coordinator. Add a build configuration for only FC's three service routes, reuse existing relay/security logic in a dedicated Worker, and prepare a separate Apps Script from verified live sources. Preserve central services, business data and legacy client compatibility.

**Tech Stack:** Existing JavaScript, Firebase Auth/Firestore, Apps Script V8, Workers and SQLite Durable Objects.

**Spec:** `docs/fc-integration-isolation-2026-11-01.md` and the user's full request in this chat.

## Global constraints

- Target Cloudflare account: `57b8b02c577b6f61e96a61ce44142d2e`; source account: `1851e9f4cd5f026371beaa2c5a85f1b8`.
- Target Google account: `anestesiahmtforms3@gmail.com`; target folder: `1HKohx4MezyQC4tW2gim11ar_7OfmFtPc`.
- Preserve UIDs, automatic login and station permissions. No business-data migration, new account, paid plan, or production cutover during preparation.
- No administrative credentials in the PWA and no secret values in evidence/Git.

## Review focus

1. FC endpoint selection must never redirect FA operational sheets.
2. Invalid enabled FC configuration must fail closed rather than silently invoke a legacy backend.
3. Equal UIDs with another Firebase audience must not authorize a request.
4. A missing FC Apps Script URL must not fall back to central bindings.
5. Old clients, deterministic receipts and cron transition must not create duplicate processing.

## Task 1: Diagnose real dependencies

- [x] Read common PWA and current Auth/session coordinator.
- [x] Inventory accessible central Cloudflare via read-only script; save safe evidence.
- [x] Inventory identified Drive images and per-file permissions; preserve originals.
- [x] Run baseline contract tests and unauthenticated HTTP probes.
- [ ] Obtain complete FC/Apps Script/Firestore inventories and capture protected live backups.

## Task 2: Prepare isolated routing and Worker

**Files:** `src/fc-integration-config.js`, three existing FC clients, `.github/workflows/pages.yml`, `worker-fc-integration/worker.js`, `worker-fc-integration/wrangler.toml`, dedicated tests.

**Interfaces:** `fcIntegrationEndpoint(path, {env, fallback})` resolves only the three fixed FC routes; unset/false feature flag preserves the existing fallback. `createFcIntegrationWorker({fetchImpl})` returns the dedicated fetch handler and reuses the existing relays and admission state.

- [ ] Write and observe failing tests for routing/rollback, malformed origin, non-FC paths and fallback prevention.
- [ ] Implement minimal code; keep new production flags disabled.
- [ ] Exercise actual clients and relays with controlled external HTTP/DO boundaries, including mismatched Firebase context and no upstream forwarding on denial.
- [ ] Run relevant existing auth, CORS, HMAC, replay, QMENTUM and service-worker suites; record exact results.

## Task 3: Prepare real FC services and resources

- [ ] Verify destination account and reuse an adequate existing Worker; validate plan and consumption.
- [ ] Export current Apps Script source/configuration, resolve all FC dependencies, create dedicated project and verify real executor/trigger owner.
- [ ] Set per-pair server secrets, check current authorization and deploy inactive destination services.
- [ ] Copy necessary Drive resources into FC with verified permissions/ownership; complete old/new mapping.
- [ ] Prepare restricted reference patches and inverse patches with Firestore preconditions. No business-data migration.

## Task 4: Integrated validation and controlled activation

- [ ] Verify actual PWA login, session renewal, same-UID cross-station denial, files, writes, scoring receipts, old-cache behavior and other stations.
- [ ] Produce resource URLs, test evidence, quota checks and concrete activation/reversal commands.
- [ ] Obtain user approval for production cutover.
- [ ] Activate only FC; transition exclusive FC cron without overlapping processing; monitor and verify rollback feasibility.

Task 3 depends on destination write/authentication access and protected live export. Do not fabricate project IDs, deployed URLs or migration mappings while that access is missing.
