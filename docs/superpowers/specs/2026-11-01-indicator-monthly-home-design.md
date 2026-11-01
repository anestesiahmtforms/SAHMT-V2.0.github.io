# Monthly information home for indicator registration

The user requests a new home under Governance → Records → Indicator registration. A month calendar sits above a monthly information block. Initial selection is the last month with recorded information, not the current calendar month. At the bottom, `INDICADORES OBRIGATÓRIOS QMENTUM` opens the existing 18-indicator selection in a modal; selecting an indicator shows its monthly percentages as horizontal bars. Managers/administrators retain manual entry as an alternative to references. Future screenshots and user instructions will define additional fields and extraction rules.

## Existing authority and scope

Current source uses only FC (`indicadores---sahmt`, default database), `qmentumUnits/{unit}/months/{YYYY-MM}`, historical definitions and the existing trusted command service. Read-only inventory confirmed January–June 2026 in unit `sahmt`. June is the initial selection. Those records and their histories remain unchanged.

The user supplied the existing `INDICADORES QMENTUM` spreadsheet as the reference (Drive ID `15Ggyw33Hr4p3_p74vBxk_xpvTEpfG-L0HY6Q8bvtdFo`). Read-only Drive inspection confirmed tabs `ANESTESIAS`, `TAXA ` and `OUTROS INDICADORES`. The first block follows the thirteen `ANESTESIAS` rows: general, sedation, regional, spinal, epidural, local, support, anesthetic procedures, surgical procedures, blocks with toxicity risk, diabetes/hyperglycemia, local anesthetic toxicity and post-dural-puncture headache. The two totals use the same existing source grouping: seven techniques, and regional + epidural + local. Read-only comparison found one disagreement between reference tabs; the user explicitly confirmed keeping the existing canonical FC entry. The private comparison is excluded from source control. No historical data correction is required.

No reference data or percentage is invented. Missing values stay distinct from zero. Manual input reuses the existing monthly form, version checks, definitions, roles and saving channel. No new collection, access grant, extraction routine or automatic approval is introduced. Future screenshots and extraction mapping remain for the next stage.

## Interface

Preserve the app shell and fixed Home/back controls. Home has unit, month selector, scrollable monthly information, an authorized manual-entry action and the QMENTUM button at the bottom. Move the current indicator grid and its tools into one modal. Indicator and quarterly views replace that modal rather than stacking dialogs. Back from an indicator returns to the selection; back from selection returns to the monthly information home, preserving selected month and drafts.

Reuse the current `monthlyChart(series,{title,target})` interface, replacing the line visualization with responsive horizontal month rows and percentage labels. Preserve source/status labels, unavailable months, zero, provisional values, metadata, target and accessible values. Do not change calculation formulas, weighting, clinical definitions or scoring.

## Data and failure behavior

A bounded FC lookup discovers the last recorded period with real input. It must recheck current identity, preserve FC binding and respect existing list limits. Unit/month changes are committed to UI state only after successful server reads and definition loads; a failed change preserves the previous month and unsaved input. Empty months show an explicit empty state and remain available for authorized manual entry. No duplicate monthly documents are created.

## Verification

Test default June selection, another month and year, empty state versus zero, bounded latest lookup and FC/session checks, all 18 existing indicators behind the button, one-modal navigation/focus/scroll, horizontal monthly percentages and missing data, manual save/reload, rejected unit/month changes preserving drafts and collector/manager behavior. Run existing QMENTUM/security/domain/build tests and remote Chromium/WebKit mobile/desktop checks. Future print extraction is intentionally deferred until the user supplies the reference and mapping.
