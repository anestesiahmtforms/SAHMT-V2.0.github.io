# Monthly indicator input from two prints

## Agreed behavior

The user supplies a monthly technique table and a monthly indicator-count panel. Every named anesthesia contributes to its own technique field even when associated. `Outra Técnica` means both sedation and regional block. `Analgesia Sistêmica` accompanying general anesthesia does not add a separate technique. The final user clarification on 2026-11-01 overrides the previous mapping: **surgical procedures come from Total geral in PROCEDIMENTOS ANESTÉSICOS; anesthetic procedures are the sum of the individual technique counts**. General + spinal with quantity one contributes one general and one spinal. Ignore **Total de registros** in the event panel. Never add the surgical and anesthetic totals together or count the table total again as an anesthetic modality. This resolves the pending source clarification and authorizes the July–October import after validation.

DM/hyperglycemic patients populate diabetes. The other event counts map to existing fields, without creating indicators or changing formulas. Toxicity cases do not prove effective management, diabetes cases do not prove effective control, and absent headache data remain absent. Keep all eighteen indicators, FC persistence, permissions and versioned history. January–June 2026 are excluded from this import and synchronization.

## Approach and implementation choices

Reuse the existing FC command service, Apps Script Drive authorization and authenticated Worker. Add a manager-only monthly input dialog with two image selections and **Sincronizar alterações** for the supplied source folders. Both paths produce the same editable preview before a deliberate confirmation. This is a bounded user-triggered synchronization; no timer or silent background overwrite is introduced. This is the implementation choice, based on the user's request for direct app input and new/changed-only sources. A schedule would need timing the user has not supplied; permanent reimport would not meet their requirement.

Use Drive OCR through private temporary conversion documents and export text, cleaning up the temporary documents after each attempt. No paid AI service, new account, browser-dependent native OCR or source-file edits. Read only allowlisted configured folders; identify source roles from content, not their order in a request. Restrict images, counts, text length and request time. Unknown techniques, ambiguous extraction, missing totals or incomplete pairs block automatic application and retain manual-entry access.

## Data compatibility

Add optional count `anestheticProcedures` and its origin for an explicit source/manual total. Old monthly records without that key remain valid, readable and writable; their previous total calculation remains the legacy fallback. New print imports always provide the explicit total. The monthly overview displays its origin appropriately. Do not rewrite January–June or legacy definitions just to add the field.

The server owns private configuration, expiring previews, source baselines and immutable receipts under each existing FC unit. Client reads/writes continue through existing rules or authenticated endpoints; private processing documents are denied to direct clients by default. Every call revalidates active FC user, manager grant, unit and enabled module. Apply confirms an immutable source hash and rechecks Drive metadata immediately before the FC commit; the month, history, baseline, receipt and current authorization/version preconditions are atomic in FC. Drive edits after that check appear on the next scan; no cross-service transaction is claimed. Closed periods remain closed. Reuse prepareQmentumWrite for month/history data.

## Incremental behavior

Compare file IDs, modification/version metadata and content hashes. Unchanged content is a no-op. For changed sources, merge only fields actually supplied by prints. Preserve absent fields and manual changes; when both source and manual value changed, show an explicit keep/manual or use/source resolution. Keep the last source baseline separately from the initial importHash. Same preview confirmation is idempotent, concurrent edits fail without overwriting, and a missing/deleted source never deletes month data. Source-only changes with identical values may update provenance without another monthly revision.

The initial source year is 2026, inferred from the established series and confirmed month comparisons. Legacy filenames MM.png belong to that configured year; future YYYY-MM.png names explicitly identify another year. The minimum synchronized period is 2026-07. Do not silently assign old MM.png images to a newly selected year. Duplicate files for a period are a visible conflict.

## Interface and verification

Keep existing one-dialog navigation, month selection, focus and drafts. Managers get a compact print-input action; upload/Drive candidates show the selected month, independent totals, per-field values, unprovided fields and source-change/manual conflicts before confirmation. Session changes and failed requests preserve the selected scope and do not falsely report a save.

Tests use synthetic values only. Cover independent totals versus technique multiplicity, aliases, Portuguese thousands separators, OCR ambiguity, missing counts, old-schema compatibility, no-op/retry/manual conflicts, scope/year limits, unauthorized calls, replay and concurrent saves. Run the QMENTUM/domain suite, backend/relay tests and remote Chromium/WebKit UI checks. Inspect screenshots and served release metadata after normal publication. Real source comparison and authorized initial July–October records remain in ignored private artifacts, never the repository.
