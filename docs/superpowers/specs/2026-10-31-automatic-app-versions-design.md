# Automatic app versions and administrator receipts

The user requested automatic V2.2 → V2.3 → V2.4 numbering on future updates, preserving the shared label in Home, administration and device receipts. They also report no user confirmations through Governance → Management despite Home V2.2.

## Decisions

Use the last successful GitHub Pages deployment and its public `app-release.json` as the publication authority. Increment the minor component for a newer source revision, embed it at build time, and include source revision in public metadata. A retry of the currently published revision reuses both its visible version and numeric release. Tests, PR builds and failed publications do not advance the published state. Serialize main publication runs, validate public metadata against the successful deployment SHA, and reject older/diverged revisions. Revalidate prepared artifacts immediately before deployment, including deploy-only retries. Run post-deploy verification in a separate job without the Pages environment, so a transient verification failure cannot misclassify an actual completed deployment. Existing V2.2 publication is an exact pinned bootstrap; do not guess on unavailable or mismatched state.

Alternatives considered: workflow run numbers also count tests/failures; git commit counts also count unpublished commits; a new mutable version database adds credentials and recovery paths. The existing successful deployment plus published metadata avoids these issues and adds no writable service or dependency.

The receipt issue is separate: the deployed cutover navigates Management to FB, while Home device receipts live in FA. Keep the administrator button in Management and open a dedicated, authenticated administrator control route in the principal FA app. Close returns to Management. Read existing Home receipts without creating update campaigns, deleting choices, changing permissions or moving user data.

## Verification

Test V2.2→V2.3, V2.9→V2.10, same-revision retry, failed deployment exclusion, mismatched/cached metadata, missing network state, stale revision rejection, and one embedded value across both build targets. Test the real cutover navigation to FA, administrator-only access, existing per-device confirmations and close/cleanup. Run existing domain/security tests, Chromium/WebKit in remote CI and public release verification.
