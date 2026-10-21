# Remote operational continuity — approved direction

## Goal
With internet and a valid FA Google session, recover Events, Labels, Checklist and schedule after the iPhone loses all application cache, even when Firestore is unavailable. Persist new operations remotely and automatically reconcile them after live authorization can be validated again. The user explicitly chose automatic sending after validation on 20 October 2026.

## Architecture
Extend the existing Cloudflare Worker and SQLite Durable Objects. Keep FA Authentication and UIDs unchanged. The remote store contains last server-verified profiles, confirmed resource snapshots, and a durable journal of pending operations. GitHub hosts application code; operational mutations do not create Git commits.

## Authority and consistency
- Profiles originate only from a successful server Firestore read or a private, authenticated operator import of an identified authoritative snapshot. Browser profile claims cannot seed authority.
- Last verified profiles may be used for seven days; local or remote reads never renew their verification timestamp. Explicit revocation remains effective. No invented users, UIDs or permissions.
- Bootstrap authenticates FA without reading Firestore. It returns only the requesting user's profile, authorized resource views and their own recoverable operations.
- A remote durable receipt is distinct from a confirmed Firestore commit. An operation is confirmed only after exact server proof or a trusted reconciler verifies its commit.
- Record IDs are stable. Equal repeats are idempotent; divergent repeats become conflicts. Pending operations are not deleted by retention or capacity management.
- Preserve original dates, author UID, version checks and schedule side effects. Past-date Checklist reconciliation must use an explicit trusted server path; never change dates to bypass Rules.

## Data and limits
Core snapshots: app feature configuration, stations, contacts, event members/catalog, label staff, vacations, schedule days and bounded reports. Bootstrap responses are bounded and paginated when needed. Resources are versioned; older snapshots cannot replace newer ones. A missing snapshot is reported, not represented as an authoritative empty database.

Workers Free and SQLite only. No paid upgrades, Blaze or new production IAM/Rules changes. Bound all operations and retries. No periodic collection scans. Reads needed for initial seeding are a separate bounded operation; do not retry an exhausted Firestore quota in a loop.

## Synchronization
Saving stages locally and attempts durable remote submission immediately. Acknowledged server operations can be recovered after local cache deletion, logout and subsequent same-user login. Automatic sending still requires a live current profile and operation permission. A server reconciler is prepared for app-independent draining; it checks the real profile, preserves write contracts and reports conflicts without deleting pending evidence.

## Acceptance
Tests must cover a completely empty IndexedDB/cache with Firebase Auth restored, Firestore returning 429, successful remote hydration and functioning module controls; multi-user filtering; disabled/revoked profiles; age limits; lost responses and duplicate requests; remote queue recovery; quota/capacity failure; automatic reconciliation with updated permissions; original dates and CAS conflicts; unchanged FA login when the channel fails. No real records or production credentials in tests.

## Rollout and recovery
Start disabled, verify SQLite bindings and Free plan, seed from a real bounded snapshot, validate synthetic traffic, then enable endpoint integration. Preserve both remote journal and local outbox during rollback. Do not claim service installation, complete seeding, or production functionality before those external states are verified.
