# Folder read control: source coverage inventory

## Contract and current scope

`server/folder-read-policy.js` is a framework-independent enforcement primitive. It does not deploy rules, publish policy, authenticate administrators, wrap transports, or intercept existing reads. The locations below are integration work, not a claim of enforced production coverage.

Every participating source uses the decoded control document `runtimePolicy/folders`:

```json
{"schemaVersion":1,"revision":1,"disabled":["FA/gestao","FB/treinamentos/curso%20especial"]}
```

IDs consist of canonical `encodeURIComponent` segments joined by `/`. Explicit disabled IDs are retained independently. Removing a parent from `disabled` preserves each disabled child. The guard rejects disabled folders and descendants for every role. Administrators have the separate ability to activate folders.

The shared guard checks current policy before reads and again before returning results. Authentication and policy reads are control metadata and remain available for administration.

Content callbacks must return buffered data and must not stream, send messages, mutate data, or deliver side effects. A second check can prevent returning a result after revocation; it cannot undo an already-started read or create atomicity across an external policy service and content provider. An active stream, listener or websocket needs its own revocation and delivery checks.

## Source map and integration points

| Source | Read choke points requiring integration |
| --- | --- |
| FA `sahmt-17a16` | `worker-fa-performance/store.js`; central Firestore SDK rules; `functions/index.js` callable handlers, `readSnapshot()` before parallel reads, and `createReportSyncTrigger()` before event processing |
| FB `sahmt-gestao-5ae66` | `worker-training/firestore.js:createFirestoreStore()` / `request()` covers training, professional data, vaccination, dosimetry and FB performance; Drive/document adapters need explicit checks before Drive reads |
| FC `indicadores---sahmt` | `worker-fc-integration/worker.js` calls direct proof readers in `worker-management-auth/{qmentum-write-relay,qmentum-print-relay,occurrence-score-relay}.js`; Apps Script FC workflow readers and Firestore rules |
| FD `rotinas-8a617` | `worker-indicators/store.js`, `sources.js`, `sahmt-performance-sources.js`; check each source dependency before cross-project collection reads |
| FE `outros-48120` | `worker-training/firestore.js` is reused by FE survey and vacation workers, including nested year-end records; `worker-fe-surveys/performance-read.js` is a separate direct reader |
| FF `sahmt-comunicacao-ff`, database **`comunicacao`** | `worker-communication/store.js:request()` including aggregation; `worker-communication/worker.js:queue()` before loading jobs and messages. `worker-ff-communication` is a retired 404 stub |
| FG `sahmt-checklist-fg` | Firestore rules; `worker-checklist-fg/science-relay.js`; local Apps Script config and direct `Firestore.gs` transport |
| FH `sahmt-etiquetas-fh` | Firestore rules; `worker-label-fh/worker.js` delegates label-image requests to `worker-label-ai/worker.js`; local Apps Script |
| FI `sahmt-operacional-fi` / FJ `sahmt-escala-fj` | Firestore rules; `worker-operational-domain/module-store.js:request()` and scheduled projection drain before `listPending()`; local Apps Script. Resolve active migration routing rather than assuming UI station equals physical source |
| Shared management gateway | `scripts/lib/management-broker-firestore-adapter.js` REST transport and `apps-script-management-gateway/Gateway.gs:mgwFirestoreHttp_()` |
| Operational continuity copies | `worker-operational-channel/worker.js`, continuity Durable Object storage, bootstrap/recovery/list and realtime delivery. A Firestore-only guard leaves these copies reachable |

Guard GET/document listing, batchGet, runQuery including nested collection queries, runAggregationQuery and transaction reads. Source mappings must come from an explicit canonical manifest; collection names alone are insufficient for nested content sharing one collection. A request touching disabled descendants must be rejected or constrained before reading, never fetched then filtered. No generic request classifier is provided until those mappings exist.

## Apps Script and background work

Add a generated equivalent of the policy contract to each deployed Apps Script bundle. Primary Firestore transport hooks are `Config.gs:firestoreRequest_()` in v2, FG, FH, FI and FJ. Direct transports also require coverage:

- v2 `FaPerformance.gs`, `OperationalContinuitySync.gs:ocsFirestore_()`, `FormsEvaluation.gs:formsEvaluationGoogleRequest_()`, `ManagementQuestionPublication.gs`, `ManagementDriveSupport.gs`, `QmentumPrints.gs`.
- FB `FbPerformance.gs`; FF `ComunicacaoFf.gs`; FG `Firestore.gs`.
- `OperationalSheetControl.gs:oscRun_()` and workbook openers must check before `SpreadsheetApp.openById()` / range reads. Forms and Drive entrypoints need checks before native API calls.

`apps-script-v2/ReadSafety.gs` provides an FA background read budget, not folder availability enforcement. A paused job must preserve its queue item, cursor and retry state rather than acknowledge completion. FD scheduled refresh, FI/FJ projection drain, FF queue consumers, Apps Script triggers and Firebase report triggers need source checks before ordinary-user/background content reads. IAM service credentials do not exempt background tasks from checking the folder policy.

## Rules and publishing requirements

Firestore rules cannot restrict IAM service-account reads. Workers, Functions and Apps Script therefore require their own guards in addition to client rules. Require active folders for content reads regardless of role. Keep administration writes on the separate policy path. A separate catch-all deny cannot override an existing allow. The policy document needs a separate authenticated control path so blocked content does not prevent administration or policy checks.

Preserve rule generation: `build-fc-module-rules.mjs` produces `firestore.fc.base.rules`, followed by `build-qmentum-rules.mjs` and `build-fc-performance-rules.mjs`. `build-climate-rules.mjs` and fragments in `scripts/lib/*rules.js` also produce deployed rules. Editing generated output alone is insufficient.

Policy publishing needs an authenticated administrator endpoint that verifies the FA session and authoritative administrator profile, validates manifest IDs and expected revision, and writes source-local documents with scoped credentials. There is no universal policy publisher in this primitive. Existing module credentials must not be assumed to have cross-project publication rights. Cross-project publication is not atomic: do not report successful deactivation until all affected sources acknowledge the revision; partial publication requires explicit pending/error status and retries. The administration/control path remains reachable while content folders are disabled.

Validate deployment coverage separately: inactive folders must produce zero content-provider calls for ordinary-user direct clients, background handlers, cached copies and retries. Verify that only trusted administrators can reactivate a folder and that direct reads stay blocked until activation. Existing deployments remain unchanged until their respective integration and release steps run.

## Verified local increment (2026-11-09)

Implemented locally: training hierarchy and content service; operational administration and revision publisher for FA/FG/FH/FI/FJ; client route/cache entry guards; operational Firestore read rules; FI/FJ projection pause; FG/FH/FI/FJ Apps Script transport and sheet-job checks. These changes have not been deployed.

The operational publisher requires FOLDER_POLICY_SERVICE_ACCOUNT_JSON (an FA service account with explicitly granted destination document access), FA_PUBLIC_API_KEY, FOLDER_POLICY_ENABLED=true, and the frontend VITE_OPERATIONAL_FOLDER_POLICY_ENDPOINT ending in /v1/operational-folders. It must not be enabled until all participating consumers are integrated. Missing policy documents retain staged-rollout access in the operational backends.

Schedule reads contain embedded event/vacation data. Rules reject those mixed documents when their sources are disabled. The frontend conservatively pauses the schedule loader while either dependency is disabled. This needs independent projections if schedule-only access must continue in that situation.

Not yet integrated: FC/FD/FE/FF policy replication and readers, governance area/document hierarchy, communication queue/copies, operational continuity Durable Objects/realtime, Firebase Functions, shared management gateway and Apps Script v2/FC/FB/FF native API entrypoints. The existing source inventory above remains the release checklist. A successful build or operational test suite does not establish whole-ecosystem enforcement.

### Label extraction integration

FA and FH extraction now check their local runtimePolicy/folders after verifying identity and before profile/image processing, and check again before returning AI output. Disabled ancestors prevent AI calls. Malformed policy and provider failures deny access. Missing policy preserves staged rollout. FH rules expose only single-document control reads to active leased sessions; client policy writes and listing remain denied. Verified: 21 label Worker tests, 12 operational rules tests, FH Wrangler dry-run packaging. This has not been deployed.

### Operational channel HTTP delivery

Authenticated list/source/bootstrap/recover requests now read authoritative FA control metadata before accessing content and recheck before returning successful responses. Channel submission and acknowledgment also use the same folder dependencies. An unavailable or malformed policy blocks delivery. Missing policy retains staged rollout. Authentication and notification-ticket metadata remain available. Realtime sockets carry collection/day change notifications only; subsequent content list requests pass the policy guard. This increment does not claim policy-gated background imports, internal Durable Object processing or revocation of data already downloaded by an older client.

Bootstrap/recovery combines folders and conservatively rejects the whole request while any participating folder is disabled, rather than reading disabled data and filtering it afterward. Schedule copies also require Events and Vacation availability. Verified: 45 policy/channel/realtime tests and 8 workerd integration tests.

### Signed continuity imports and Apps Script reconciliation

Signed drain/claim/complete/source-change and resource imports now check fresh FA folder policy before reading internal copies and again before returning successful responses. Read-only module audit metadata remains available. The importer supplies X-Continuity-Policy-Authorization with a Google OAuth access token authorized to read FA runtimePolicy/folders; the HMAC remains required independently. Apps Script sends its ScriptApp OAuth token. The local install script requires SAHMT_CONTINUITY_POLICY_ACCESS_TOKEN for content imports; never persist that token in repository files. Missing authorization and unavailable policy deny the operation.

The Apps Script reconciliation job checks policy before seed/source/queue work and before content Firestore transport calls. Disabled or malformed policy pauses the job and preserves a pending seed rather than permanently marking it BLOCKED. Mixed operations conservatively require every operational source active. Queue items and cursors remain stored. Missing policy continues to allow staged rollout. Publish the sender and Worker together. Existing operations already started before policy revocation cannot be undone. Verified: 18 import/background/Apps Script/audit/workerd tests, plus 6 bootstrap/source-change/Apps Script tests; Worker dry-run packaging passed.

### Communication FF integration

The administrator manifest now includes the Central de Comunicação (comunicacao). Publication replicates policy into projects/sahmt-comunicacao-ff/databases/comunicacao/documents/runtimePolicy/folders, with the same pending/retry protocol. Extend the publisher IAM grant to this named database before enabling the revised publisher. Existing policies and missing documents retain staged-rollout behavior. FF SDK rules already deny every direct content read.

The FF store checks policy before GET, query, batchGet, aggregation and transaction entry. The actual service checks at request/queue entry, before FCM send and before returning HTTP results. A paused queue retries instead of acknowledging. Active-source schedule reads require scale, events and vacation folders. The frontend keeps the communication entry visible but disabled for users already authorized to see it. Other governance panels are not yet integrated.

Added checks count toward the existing 44 external-call budget; no positive policy cache is introduced. Runtime verification caught unsupported redirect:error in workerd: policy transports now use manual redirect and reject non-success responses. This correction also applies to previously integrated policy readers.

Communication frontend requests now check the live policy before using an in-flight read or exchanging tokens; the direct communications route is also registered. Two client lifecycle tests passed, including zero network requests while disabled. The remaining governance folders are not represented by a generic parent toggle until their own source enforcement exists.

### FC, FD, FE and consolidated performance reports

The performance parent and four children have independent administrator controls. The publisher replicates the policy into FC, FD and FE. FC direct report access uses generated Firestore rules. The FC Apps Script transport adapter checks the folder for performance collections, and needs to be included when assembling the deployed Apps Script project. FD report and consolidated endpoints check policy before content and before delivering it. Consolidated scheduled processing checks before starting and before source calls. FE summary and signed historical relay check their local policy.

The consolidated report is suspended when a covered source folder is disabled because stored totals can contain that source. New FE survey submissions check the policy within the Firestore transaction before accessing award records. When paused, neither the response nor participation is committed. An already accepted submission can still be confirmed without opening the performance ledger. FB training contribution gating and other Governance modules remain open integration work. Production requires destination IAM, coordinated deployment and verification. Local validation passed 77 focused tests, 5 FC emulator tests, app build and FD/FE Worker dry runs.

### Management groups and FE consultations

FA/FB rules now guard scoped activities, interactions, reviews, indicators, plans, documents and equipment. The group catalog remains readable for navigation. FB subscribes to its local policy replica. The HTML training Worker also checks the document management area before loading its own folder index. The FA checklist signature callable checks its mixed sources in its transaction. The legacy activity callables accept only an activity ID, so any management folder pause blocks those callables until an area index can scope the initial lookup.

FE now checks year-end SDK reads, its status Worker, the vacations Worker, survey transactions and the generated climate/stress report read rules. The professional registration and registration Drive endpoints check their FB policy before and after execution. FA performance Worker and Apps Script source reads check the performance folder and source dependencies.

The remaining coverage includes direct and privileged FC records workflows, remaining cross-source and Apps Script consumers, FB aggregate performance and older clients. Verify each deployed entrypoint before enabling global controls. The publisher also needs FB destination IAM. Verified locally: 71 operational/FB/training tests, 48 consultations regressions before the added rule case, 20 final FE/FB rules tests, 2 Worker runtime tests and 13 FA performance tests. App compilation passed.

### FC records

The Registros parent and independent Ocorrências/QMENTUM controls apply to the app routes and generated FC rules, including content, request proofs and new commands. The FC Apps Script transport adapter checks the matching folders before REST calls. FC performance and the consolidated report also depend on both records folders because their totals may include either source. Verified locally with 39 tests, including sibling and parent checks in the Firestore emulator. The deployed Apps Script bundle must incorporate the transport adapter. Any separate privileged readers remain subject to the rollout inventory.

### FB aggregate

FB performance has a separate administrative toggle. The FB Worker checks the FB runtime policy and the HTML training folder policy before report reads and again before returning. The Apps Script projector checks both before starting, before each content query and before confirming a revision. The FD consolidated endpoint and job also verify the FB control documents. The aggregate pauses for any disabled management area or HTML training subfolder because its totals mix contributions and cannot safely be partitioned after reading. These checks require read access to the two FB control documents for the FB and FD service identities. Verified locally with 44 tests and FB/FD Wrangler dry runs. No deployment was performed.

### Legacy Apps Script, FD indicators and professional folders

The v2 REST transport now checks the policy in the destination project before mapped content GET, batch, query, aggregation and commit calls. Legacy management batches with no known area pause if any management descendant is disabled. The operational workbook and schedule source check before opening Sheets. Forms, document Drive and QMENTUM print reads check their relevant folders. The management gateway accesses authorization projections rather than folder contents. Its profile and permission reads remain available.

FD indicators and scheduled source refresh check the indicator folder and mixed source dependencies before accessing content. Cached indicator reports also check before delivery. The compiler conservatively pauses if any covered source is disabled, including an HTML training subfolder. The FB worker checks individual biosafety and professional document folders before content and Drive access. Vaccination proofs follow the vaccination toggle. The deployed policies still require end-to-end validation, including IAM access, the published Apps Script versions and legacy clients. Verified locally: 266 legacy regressions, 34 final transport and sheet checks, 48 FD regressions, 50 FB professional tests, app build and FD Worker packaging.

### Policy propagation safety

Reactivation now stages the restrictive policy at the new revision in every destination before the coordinator enters release. A preparation failure leaves destinations restricted. Release remains distributed and a subset can accept the activation before another destination acknowledges. The FA coordinator retains the restrictive state and reports pending until all acknowledge. A failed deactivation also remains pending and an unreachable destination can retain its earlier policy until retry. The publisher compares Firestore documents independent of field order. Verified locally with 25 policy/communication tests and a publisher Wrangler dry run.

### Pre-publication checks

The administrator-only inspection reads the FA coordinator and nine replicas. It reports missing, invalid, behind, different, unavailable, prepared and confirmed states without writing or exposing policy contents. It rechecks the coordinator document version to avoid presenting a mixed-revision report as current. Initialization can establish an empty revision without disabling content and refuses to overwrite existing replicas. Interrupted initialization uses the same resume flow.

Install the coordinated reader versions and verify their rules, endpoints and service identities before enabling the client switch. The inspector verifies reads. Empty initialization verifies writes in a fresh environment. Neither proves that every deployed consumer enforces the policy. Use a staging environment to verify old clients, direct access, active sessions and background operations, and compare content reads before and after a reversible pause. The named FF database is comunicacao and all other destinations use (default).

### FI Central integration on current main

FI is the administrative authority. The full FI route provides folders.inspect and folders.publish after the existing FA login, App Check configuration, FI identity link and FI administrator profile checks. The FA coordinator still stores the revision and replicates to all destinations. The old standalone public publisher returns 410. The FI pilot never admits folder management actions.

Search checks the authoritative FA policy before content queries and checks it again before AI synthesis or response delivery. FB training search also checks its local training-folder control. Search skips blocked collections, and mixed FB queries pause when any management area is disabled. Monthly generation and saved monthly analysis pause if their QMENTUM or consolidated dependencies are disabled. Source records already downloaded before a change are not delivered by a request that detects the change. This does not make distributed policy publication atomic.

Homologation requires the complete FI service, the FI folder-management flag, the app folder-policy flag, the existing FI credential for FA policy and FB training policy reads, and the dedicated publisher service credential for policy replicas. Install the coordinated readers before enabling it. The local pilot remains unchanged. The rebase preserves the removal of the legacy FD indicators UI and service. Verified locally with 64 focused tests, app build and FI Worker dry run.

### FI production cutover compatibility

The FI production release separates the search route from the administrative central. Folder controls belong only to the latter. The FI administrative write cutover remains in place for existing actions. Keep the live FA and FJ cutover restrictions when preparing Firestore rules for rollout. Use `addFiCutoverRules` to compose the candidate base files and compare with the live rules before releasing. The local operational rules test composes both gates and seeds the active cutover marker.

For staging, begin with the folder control disabled and confirm that every deployed reader understands the policy. Verify the FI reader account can read the FA and FB policy documents, and verify the publisher can inspect every destination. In an isolated environment, initialize an empty policy, pause one child, pause its parent, restore the parent and confirm the child stays paused. Use a regular and an administrative account to verify the UI, deep links and search. Confirm blocked content reads in Worker, Firestore and Apps Script logs before activating the production control.

The browser test exercises the real FI panel and Worker with synthetic roles and an in-memory policy store. It verifies initialization, independent child and parent toggles, all nine replicas and the 403 response to a member's attempted update. The Firestore emulator separately verifies protected reads. The standard FI deployment script uses production targets and does not enable the folder management flag. Live App Check, destination IAM, deployed Apps Script versions and read counts require a separate staging target and remain unverified.
