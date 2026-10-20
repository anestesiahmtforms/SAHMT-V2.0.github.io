# PWA v212 — offline and bounded reads

Based on current main (7ef7353), preserving the arsenal title changes.

## Changes
- Remove notification polling and automatic data/report warmup at login. Offline preparation remains an explicit action.
- Reuse stable local catalogs for 15 minutes on access.
- Preserve quota backoff across reloads; coalesce SDK requests until settlement, including after a UI timeout.
- Check actual cached JavaScript dependencies before declaring offline preparation complete.
- Enable Checklist report launchers only after their click handlers are attached.
- Preserve authentication, UID separation, authorization and explicit confirmation of pending writes.

## Validation on this tree
- Domain: 1,048 passing tests.
- Offline: 146 passing tests, including launch and on-demand read regressions.
- Browser: 13 passing scenarios; repeated with expired App Check (13 passing). All external calls intercepted, zero production Firestore reads or writes.
- Vite build and consolidated FA runtime check passed.

## Scope and limitations
No Firebase data, Rules, IAM, billing, Worker or Apps Script changes in this release. The FA/FB migration remains paused. An existing authenticated session and previously cached data are required for offline use; iOS can evict site storage. This does not guarantee that the daily Firestore quota cannot be exhausted by other clients or jobs.

## Release verification and recovery
GitHub Actions must succeed before publication is declared complete. Confirm the served service worker contains sahmt-v2-shell-v212. To roll back, revert this release commit through the same Pages workflow; local IndexedDB drafts are not cleared by this release.
