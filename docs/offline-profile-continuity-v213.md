# v213 — local profile continuity

## Reproduced failure
With a valid Firebase Auth session and Firestore quota failure, a previously validated profile cached 25 hours earlier was discarded. The UI therefore entered auth-limited even though local operational data had a seven-day retention window. A missing cache and an explicit server denial could produce the same generic message. The exact condition on the user's iPhone has not been read directly.

## Fix and safeguards
- Align the last verified local profile lifetime to seven days. Its timestamp is never renewed by local use. This increases the period during which previously granted permissions may be used locally while the server is unavailable.
- Match the authenticated UID; reject invalid and future timestamps; require boolean active/access.
- A server denial still blocks access. Missing profiles are not invented.
- Local mode blocks outbox submission until the live profile and current operation permission are revalidated; explicit confirmation is retained.
- Display only fixed diagnostic codes for missing local profile, unavailable local storage, denied access, authentication requirement or unknown read failure. No response bodies or exception messages.

## Validation
Regression tests first reproduced failures. Offline suite: 155 passing tests. Profile/presentation suite: 39 passing tests. Domain suite, production build and browser coverage are checked before release. All external browser dependencies are intercepted; no production document access is needed.

## Recovery
Revert this commit through the Pages workflow if needed. IndexedDB schema is unchanged and queued records are retained. Do not clear site data when installing the update. A device with no previously validated profile still needs one successful online profile validation.
