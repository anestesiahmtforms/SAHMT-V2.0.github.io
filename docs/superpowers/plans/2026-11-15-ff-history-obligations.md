# FF history and activity obligations — implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Track each task here and in the plan ledger. User approved the design and implementation on 15/11/2026; do not repeat approval for routine implementation steps.

**Goal:** Archive complete sent-message and read histories in the specified Drive folder and enforce authenticated per-member activity obligations across FA/FB.

**Architecture:** Existing FF worker remains the authorization boundary. A Sheets adapter writes stable reserved ranges with RAW values; recoverable queue jobs sync historical events. Active FF messages and recipients retain only operational state. A session-level banner uses authoritative server time and source-service completion checks.

**Tech Stack:** Existing JavaScript, Node tests, Cloudflare Workers/queues, Firestore FF, Google Sheets/Drive APIs, Firebase Google sessions, Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ff-history-obligations-design.md` (copy of approved chat output).

## Global constraints

- Folder `1oRqrwBKs6I6YHyGLxMj8j0_MI8dcuI3X`; Google Sheets annual archive; no public sharing.
- Each member sees only own messages and obligations; authorized Central administrators see global history.
- Enquete ends on accepted participation; training requires completed attempt of exact version with explicit minimum score.
- Prior valid completion counts; no repeated submission of the same survey cycle.
- Compact movable banner has no dismiss; full container at 120 hours according to server time; activity/session recovery/logout remain reachable.
- No invented historical reads/recipients; no new performance points; no legacy data deletion in initial activation.
- Commit/push through GitHub Desktop; preserve unrelated untracked test.
- No real notices sent during validation. Existing free-tier and external-call budgets remain.

## Review focus

1. A user changes institutional group after publication: original recipients remain fixed, unauthorized new recipients cannot read.
2. A Sheets write succeeds but response is lost: retry uses identical row addresses, never duplicate history.
3. A browser submits another identity's completion/score: source token binding and server source query reject it.
4. Several obligations or top-layer dialogs exist on small screens: activity and session recovery remain operable.
5. An activity version disappears or attempts are exhausted: show unavailability and audited administrator cancellation, never silent completion.

## Task 1 — Domain and archive schema

Files: create `communication/history.js`, `communication/obligations.js`, tests `tests/communication-history.test.js`, `tests/communication-obligations.test.js`.

Interfaces: `historyMessageRow(message,binding)`, `historyRecipientRow(message,recipient)`, `historyEventRow(event)` produce plain RAW cell arrays. `obligationStage(publishedAt,serverNow)` returns 0..5; `validateObligation(value)` validates fixed kind/id/version/cycle/minimumScore metadata; `trainingCompletion(training,state,obligation)` returns evidence or pending.

- [ ] Write tests for RAW text (formula-like input preserved), historical unknown recipients, exact 24-hour boundaries ending at 120 hours, completed exact-version sufficient attempts, insufficient/forged/wrong-version attempts, survey accepted participation.
- [ ] Run tests and observe missing behavior failure.
- [ ] Implement pure schema/validation functions, then run tests green.

## Task 2 — Native Drive artifact and Sheets adapter

Files: create `worker-communication/history-drive.js`, `scripts/provision-communication-history.mjs`, tests `tests/communication-history-drive.test.js`.

Interfaces: `createCommunicationHistoryDrive({getToken,fetchImpl,spreadsheetId,folderId})` provides `verify()`, `write(data)` and bounded `readMessages({before,limit,filters})`/`readRecipients({start,count})`. FF metadata stores stable row allocations; values batchUpdate uses RAW. Queue retries overwrite reserved ranges, not append.

- [ ] Create local verified .xlsx via bundled artifact-tool; import as native Sheets, move to exact folder and verify parent/MIME/tabs/capabilities before personal data.
- [ ] Test wrong parent, inaccessible file, formula-like text, bounded pagination, idempotent writes after lost response and API failure.
- [ ] Implement adapter, run tests green. Verify selected-file service access using existing FF principal, with no folder-wide/public grant.

## Task 3 — FF sent history and receipts

Files: modify `worker-communication/service.js`, `store.js`, `worker.js`, `google.js`; create `worker-communication/history-service.js`; extend domain/worker tests.

Interfaces: `MESSAGE_READ {id}`; `SENT_DETAIL {id}`; `SENT_MESSAGES {cursor,filters}`. Recipient snapshots fixed at publication; per-person first-read receipt authenticated and idempotent. Archive queue kind `history`, stable job/row reservation. Legacy messages remain explicitly unknown where evidence absent.

- [ ] Tests prove ordinary-user isolation, fixed group membership, no read on list/banner, first read preserved, retry-safe archive queue and visible sync failure.
- [ ] Integrate snapshot and job reservation without external writes inside Firestore transactions; add paged recipients/allocations respecting existing 40-write/44-call budgets.
- [ ] Test all communication domain/workerd fixtures. No legacy deletion.

## Task 4 — Activity registry and source confirmation

Files: create `worker-communication/activity-source.js`, `obligation-service.js`; modify worker/service/client source-token handling; extend source services only where a restricted metadata operation is necessary.

Interfaces: `ACTIVITY_CATALOG`, `PREVIEW_ACTIVITY`, `CREATE_ACTIVITY`, `PENDING_ACTIVITIES`, `VERIFY_ACTIVITY {id}`, `CANCEL_ACTIVITY {id,reason}`. Exact activity registry selects training FB or institutional survey FE; no arbitrary URL. Same Google principal binds FF and source token. Source queries return only authorized metadata/completion.

- [ ] Tests reject foreign identity, supplied score/completed flags, inaccessible source, ineligible audience; preserve exact version/cycle and prior valid completion.
- [ ] Implement source service calls and per-recipient operational obligation state; cancellation audit; source failure/unavailable and attempt exhaustion stay explicit.
- [ ] Run focused source and communication suites; verify no additional performance writes or broad cross-project IAM.

## Task 5 — Central UI and complete history

Files: modify `src/communication-ui.js`, `communication-client.js`, `communication.css`; create focused `communication-history-ui.js`, `communication-activity-ui.js` if needed; browser/domain UI tests.

- [ ] Tests cover complete body, named recipients, read/completion timestamps, filtering/pagination, unknown historical data and administrator-only actions.
- [ ] Implement history detail and dedicated TREINAMENTOS E ENQUETES composer. Catalog + minimum score + preview confirm audience. Existing event sending preserved.
- [ ] UI test repeated sends, failed sync, session changes and recovery.

## Task 6 — Global persistent banner and activity navigation

Files: create `src/communication-obligation-banner.js`, CSS; integrate session lifecycle `src/main.js`; extend training/survey deep links and completion refresh events; browser tests.

- [ ] Tests cover 0..120 hours, multiple obligations, no dismiss, drag/touch/keyboard bounds, top-layer modal, own-only session cleanup, FA/FB navigation, offline and source-unavailable recovery.
- [ ] Mount once per authenticated session; routes do not destroy it. Server-now offset only while session valid; refresh on resume/explicit activity completion, no polling loop.
- [ ] Full-stage panel routes only to activities/recovery/logout and permits activity execution. Read is separate from completion. Completed receipt removes only corresponding obligation.

## Task 7 — Release and verification

- [ ] Run full domain suite and meaningful worker/browser integration checks, build both published apps.
- [ ] Independent whole-change review; fix material findings with regression evidence.
- [ ] Read-back archive setup, source checks and synthetic unauthenticated-denied probes. Deploy FF service/source extensions and client, preserving bindings and free limits.
- [ ] Commit/push through Desktop; wait both CI workflows; inspect actual public release SHA and emitted assets before reporting success.
- [ ] Keep legacy historical unknowns truthful; report limitations, archive URL and actual validation. No real group messages sent.
