# Retomada do isolamento FF — 05/11/2026

User explicitly deferred completion until tomorrow because both FA and FB are quota-blocked. Stop cloud work until resumption. Do not retry source scans today.

## Current state

- Branch `codex/ff-local-isolation`, based on `origin/main` b3684da. Changes remain uncommitted; no PR created, no merge or production deployment for this change.
- No production IAM permissions changed and no imported records written into FF.
- FF has only 1 existing user profile, 6 recipients/devices, no institutional assignment/area directory. Runtime previously federated FA/FB reads, including FA schedule reads on Home.
- User approved one initial directory copy, then complete isolation except explicit FA LIBERAR action. First FA users capture succeeded: 58 active profiles, all valid UID/email. FB users request returned429; alternative FA group capture also returned429. No more attempts today.
- Protected partial capture is outside git: `%LOCALAPPDATA%/SAHMT/ff-isolation-2026-11-04/partial.dpapi.json`. Contains only `at` and `faUsers` from the last inspected checkpoint, with possibly pinned groupSource after the later capture attempt. Never output private capture contents or tokens.

## Implemented locally

- Ordinary Worker auth validates FF only. Push recipients and delivery eligibility, directory, areas/groups and inbox read FF only.
- Only `SCHEDULE_RELEASE_NOTICE` accepts paired FA+FF tokens, reads the FA actor profile and one schedule day, then resolves the clicked sigla in FF.
- Worker fetch guard denies foreign Firestore/Auth project requests outside that explicit FA path. Source adapters deny FB/FC/FD/FE and prohibit FA searches.
- Home release pointer stored in FF replaces repeated FA schedule reads. Legacy audience IDs are retained as local identifiers.
- FF installation presence is recorded locally; no FA installation inventory fetches. Foreign source-import UI/API disabled.
- Added `waitForIsolatedFfSession` / `confirmIsolatedFfAccess` to auth adapter: Central restoration/reconnection no longer starts the all-project coordinator or reauthenticates FA.
- Import helper validates identity/membership, preserves FF-local access settings, fails missing nonowner affiliations, excludes the previously deleted wx2901 account and subscriptions/memberships. The reviewer’s final excluded-membership finding had already been fixed and covered in the added test before their final message.
- Migration script performs a protected, resumable capture; atomic import (<=400 writes) including READY marker; repeated same snapshot is a no-op. `--refresh-ff` refreshes FF-only preconditions without repeating foreign capture.
- IAM revoke mode requires complete local directory, reduces FA principal role to document GET, removes FF principal memberships in FB/FC/FD/FE, then marks `permissionsIsolated:true`. Deployment now requires both READY and permissionsIsolated.
- Preparation script no longer grants six-project source roles.

## Verification already performed

- Initial 11 isolation regressions failed before changes and passed afterward.
- 159 combined communication + Google Auth unit/runtime tests passed before latest small UI/test/translation edits; rerun affected checks on resumption.
- Actual Worker workerd test asserts ordinary requests never reach FA and succeeds with FF-only identity.
- Two new auth adapter tests prove FF setup creates/checks only FF and does not reconnect other projects.
- Home browser layout check passed after updating its stale mock dependency.
- Wrangler dry-run passed before latest auth/UI changes; rerun before publishing.
- Browser Central fixture/tests were updated from stale manual-Push/forwarding expectations to automatic Push and absence of cross-project forwarding. On closing session77205, its final output confirmed all 3 browser tests had completed successfully. Local Vite server session4088 on port5189 was stopped. Port5178 belonged to a preexisting server and was not stopped.
- Review by Astra found several issues that were fixed; final review only repeated a membership-exclusion finding that is now fixed. No remote actions by reviewer.

## Resume sequence

1. Read current diff and this checkpoint; preserve user’s stop for today. On explicit resumption, finish local Central browser checks and rerun changed unit/runtime checks.
2. Inspect partial capture stage metadata only. Resume `node scripts/isolate-communication-ff.mjs --capture` using original FB groups, or `--capture --groups-from-fa` for identical FA memberships per user’s assertion. Group source is pinned once group data is captured; do not mix sources. FA users must be reused from protected checkpoint.
3. If incomplete affiliations or unknown memberships are found, resolve explicitly; never infer institutional affiliation from administrative role.
4. Validate import summary and FF profiles/device IDs; use `--apply` only with complete validated snapshot. Import is atomic; on stale FF preconditions use `--refresh-ff` before applying again.
5. Finish review, commit/push/PR and required CI. Production publication was already authorized in this chat; no redundant confirmation needed. Do not publish empty/incomplete directory.
6. At cutover run `--revoke`, verify role membership evidence, publish Worker through gated deployment script and publish frontend. Verify ordinary requests stay FF-only and explicit release targets only the clicked sigla; do not send a real notice without user-directed test.

Next quota reset is expected around 05:00 Brasília on 05/11, based on Pacific midnight. No reminder or automation was created.
