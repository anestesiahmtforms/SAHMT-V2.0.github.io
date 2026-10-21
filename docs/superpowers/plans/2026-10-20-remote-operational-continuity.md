# Remote Operational Continuity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, preserving the user's existing autonomous execution authorization. Check each deliverable with tests before proceeding.

**Goal:** Recover the operational app from a remote durable copy and preserve mutations independently of the iPhone and Firestore availability.

**Architecture:** Extend the existing Worker/SQLite service with a last-verified profile and resource snapshot, a per-user operation journal, and a trusted reconciliation interface. Hydrate existing IndexedDB adapters instead of replacing module UIs.

**Tech Stack:** JavaScript, Cloudflare Workers/SQLite Durable Objects, Firebase Auth, existing IndexedDB/outbox and Apps Script REST integration.

**Spec:** `docs/superpowers/specs/2026-10-20-remote-operational-continuity.md`

## Global Constraints
- Seven-day last-verified profile maximum; preserve its original timestamp.
- Zero production Firestore reads during local development and synthetic tests.
- No invented identities or browser-issued permissions; no production IAM/Rules/billing changes.
- No removal of pending records or existing local migration work.
- Automatic send requires current server authorization and idempotent writes.

## Review Focus
- Cache loss while Auth persists must still recover the same UID and authorized data.
- A last-known profile must not be renewed by rereading the mirror.
- A failed second phase of remote submission must be recoverable by a repeated stable ID.
- A reply after account change must never populate another user's cache or outbox.
- Old Checklist and schedule conflicts must remain visible until safely reconciled.

## Task 1 — Versioned snapshot contract
Files: create `src/remote-continuity-contract.js`, `tests/remote-continuity-contract.test.js`.
Interfaces: `validateContinuityProfile`, `validateContinuityResource`, `continuityEntriesForActor`, constants for retention and bounded sizes.
- [ ] Write failing tests for profile age, real UID matching, resource kinds, permission filtering, bounded daily/monthly report keys and stable timestamps.
- [ ] Run tests, implement pure validation/view construction, rerun to green.

## Task 2 — Durable authority, snapshots and recovery journal
Files: create `worker-operational-channel/continuity.js`; modify `worker-operational-channel/worker.js`; create `tests/remote-continuity-worker.test.js` and workerd integration coverage.
Interfaces: authenticated private import; authenticated `bootstrap` and `recover`; additive SQLite tables in existing classes; submit/ack/withdraw update the per-user journal.
- [ ] Test cache-free bootstrap with Firestore forbidden, revocation, outdated imports, tampering, idempotency and a lost submission response.
- [ ] Implement bounded storage, private import authentication and worker handlers with feature flag disabled by default.
- [ ] Run existing channel and new SQLite tests.

## Task 3 — Client hydration and authentication fallback
Files: create `src/remote-continuity-client.js`, `src/remote-continuity.js`; modify `src/auth.js`, `src/outbox.js` and minimal module invalidation in `src/main.js`.
Interfaces: cold-user bootstrap; stable `cacheProfile(...,{validatedAt})`; hydrate resource entries and own pending operations guarded by current UID/generation.
- [ ] Test no local cache, Firestore 429, server mirror available, server timeout, account change and denied identity.
- [ ] Integrate bootstrap before dependency on Firestore for cold startup, preserving immediate existing local startup.
- [ ] Run offline, profile and domain suites; browser test wipes all app data while keeping Firebase Auth and restores modules from a synthetic Worker.

## Task 4 — Mutation mirroring and automatic recovery
Files: modify `src/provisional-operational-channel.js`, `src/provisional-channel-client.js`, `src/data.js`, `src/main.js`; create focused recovery/mutation tests.
Interfaces: remote submission immediately after staging; recover owned server operations on bootstrap; automatically confirm only authorized non-conflicting recovered operations after live validation.
- [ ] Test ordinary online save, failed Firestore save, remote-only queue recovery, duplicate receipt, revoked permission, independent conflicting items and schedule CAS.
- [ ] Preserve existing UI/record contracts and distinguish stored-remotely from Firestore-confirmed status.

## Task 5 — Trusted seeding and reconciliation tools
Files: create `scripts/prepare-remote-continuity.mjs`, local/private import tooling, `apps-script-v2/OperationalContinuitySync.gs` with mocked tests.
Interfaces: snapshot input records with provenance/timestamps; private signed import; bounded drain protocol; batch validation against actual profiles; exact idempotent Firestore writes and schedule side effects.
- [ ] Test dry-run without external access, invalid/old snapshot rejection, empty drain causes zero Firestore requests, per-record conflicts and historical dates.
- [ ] Preserve remote Apps Script files/manifest. Install only after verification and available authorization; report any real execution/API block.

## Task 6 — Verification and controlled installation
Files: package/CI test commands, Worker README, runtime readiness report and service worker version.
- [ ] Run full relevant suites, actual workerd SQLite tests, browser cache-loss scenario and production build.
- [ ] Read-only check Cloudflare account/Free limits and existing deployment/configuration before mutation.
- [ ] Deploy disabled, import verified real data when available, verify synthetic bootstrap/receipt/recovery, then connect the PWA.
- [ ] Verify deployed versions and cost controls; retain data and document disable/rollback procedure. Report remaining real external prerequisites precisely.
