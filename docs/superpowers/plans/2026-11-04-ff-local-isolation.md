# FF local isolation implementation plan

**Goal:** Communication uses only FF Auth and the `comunicacao` Firestore database. The sole cross-project operation is the explicit FA schedule release action.

**User authorization:** One initial copy of FA users and FB groups was explicitly approved on 2026-11-04. No recurring synchronization. Owners remain excluded from user lists.

**Architecture:** Keep existing directory identifiers as FF-local identifiers to preserve messages and subscriptions. Bind verified FF identities to the local directory by unique email. Import institutional membership and management areas once, translating FB membership by email. General inbox, individual/group selection, device inventory and queued Push use FF exclusively. Only SCHEDULE_RELEASE_NOTICE validates an FA identity and reads that actor profile plus the one schedule day; it resolves the recipient by sigla in FF.

**Alternatives:** Live federation was rejected by the user because of quotas. Using only existing FF profiles would omit users and groups; user selected one initial import followed by isolation.

## Tasks

- [x] Add isolation tests for all ordinary operations, queued Push and unsupported source imports. Assert that only explicit release reaches FA.
- [x] Replace runtime federation, paired ordinary authentication and FA inbox/device reads with local FF lookups. Limit source adapter to FA users GET and scheduleDays GET for release only.
- [x] Capture device presence locally in FF; preserve Push subscription identifiers and historical local audience identifiers. Remove source-import UI/API.
- [x] Implement bounded one-time import with email/UID/group integrity checks, protected backups, exclusions for deleted users and no overwrites without explicit matching migration state.
- [ ] Remove FF service-account memberships from FB/FC/FD/FE and reduce FA permission to document GET only. Restrict request paths in code as well as IAM.
- [ ] Run communication unit/runtime/browser checks and dry-run build; review diff, create PR and publish authorized production changes. Check isolated FF requests and FA release path without sending a real notice.

## Review focus

- Duplicate/missing email or sigla must fail closed; never guess a recipient.
- Existing devices/messages retain their local identifiers; no token or profile is logged.
- Group membership comes only from the imported local record, never from a live fallback.
- Ordinary requests never validate an FA token or call another project, even if the browser includes an old header.
- Failed preparation cannot enable an empty directory or reintroduce cross-project reads.

## Execution record — 2026-11-05

- User resumed. Completed protected capture without repeating the previous FA user scan. FA was the single source of identical group memberships, as explained to the user on 2026-11-04; no recurring synchronization is introduced.
- Ruling: omit one stale management-area member only after a bounded FA Auth lookup confirmed the account is absent. Same-source proof is preserved in the private snapshot; no identity was inferred and source records were not altered.
- Atomic import succeeded: 58 users, 12 areas, 6 devices, 6 recipient records, 82 writes, zero missing nonowner affiliations. FF counts and the actual directory query were verified.
- Fresh verification: communication/Auth unit/runtime suite passed (159 cases before the added absence-proof case); six import cases pass; Wrangler dry-run passes. Previous Central browser checks (3) and Home layout check (1) passed. Astra review reports no remaining release-blocking defects.
- IAM revocation and production publication remain gated and pending at this checkpoint.
