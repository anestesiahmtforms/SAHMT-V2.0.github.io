# SAHMT Worker — authentication compatibility and operational relays

This is a dedicated FA → FB + FC Worker. It does not import or share the Etiquetas Worker. `wrangler.toml` keeps `workers_dev` false, declares the local SQLite Durable Object binding `BROKER_STATE`, and has no route, endpoint, or secret. No remote namespace has been created.

The default export composes `runtime.js` but remains disabled by default. Wrangler sets the primary, FB, FC, first-login, and Gateway activation flags to false. Runtime verifies FA token signatures, issuer, audience, expiry and revocation; reads the current FA profile through the authenticated Gateway; and executes independent FB/FC broker exchanges, signers, deadlines and cleanup. An FA token is not used to authenticate to a destination project. User supplied project IDs, UIDs, permissions and roles do not override server authorization.

The Worker adapter composes `management-gateway-client.js` with the HMAC protocol, bounded Apps Script redirect handling, and a Durable Object response-nonce claimer. The HMAC secret is a server binding only; it is absent from Wrangler variables, browser settings and the repository. Each Gateway operation requires its matching server policy switch.

For a one-person operational pilot, `MANAGEMENT_AUTH_PILOT_ONLY=true` requires a server-only `MANAGEMENT_AUTH_PILOT_UIDS_JSON` containing exactly one validated FA UID. The broker checks the UID returned by verified FA claims and the fresh FA profile before any destination Auth lookup, lease write or token signing. Missing, malformed, extra-UID or stale allowlist configuration fails closed. The local Wrangler default is false and the allowlist is not stored in this repository or frontend. This pilot gate restricts secondary authentication; Firestore Rules still independently decide access to destination data.

## Gateway operation sets

The legacy Gateway profile contains the six privileged Auth lookup/sign operations; all six are false. Runtime also needs four optional, individually gated data operations: `READ_FA_AUTHORIZATION`, `READ_FB_LEASE`, `WRITE_FB_LEASE`, and `INVALIDATE_FB_LEASE`. The disabled local runtime template includes all ten with every flag false. The data bridge reads a fixed projection from FA `users/{uid}` and confirms Auth UID/provider. It returns allow-listed direct permissions only. It does not infer areas, groups or document grants. FB lease writes use fixed paths, Firestore transactions, version comparison and grant fences. No FC Firestore read is needed by this bridge.

Under an extended policy, Apps Script stores compact v2 request-nonce records. ScriptLock protects replay checks; only records strictly past retention are pruned after persisting the clock high-water mark. Capacity is 1,536 records and 400 KB. The prior six-operation record format stays supported. A local stress test admitted 1,100 records (55 users × two targets) under that byte cap. This is a storage test, not a latency/quota certification.

## Local verification

Run `npm run prepare:management-auth` to validate Gateway syntax/functions and manifest scopes, confirm all default flags are off, run the management and domain suites, build the PWA, bundle the Worker, and create a local disabled preparation artifact. `tests/management-worker-platform.test.js` loads the default Worker in Miniflare/workerd and exercises the SQLite admission and replay routes. `tests/management-operational-runtime.test.js` runs the complete PWA → Worker → HMAC → Gateway VM → synthetic Google/Firebase flow. No live Google, Firebase, Apps Script or Cloudflare calls occur in these tests.

## External dependencies before production

- Verify/install protected FA identity UIDs and reviewed `firstLoginCohort` profile values in trusted server configuration.
- Install a current Apps Script Web App endpoint, matching private HMAC secret and canonical operation policy; keep every operation false until an approved cutover.
- Configure Cloudflare Worker secrets/policy, route and remote Durable Object namespace.
- Provision FB and FC Firebase Auth users with the same verified FA UIDs before custom-token exchange; this runtime never imports or creates users.
- Confirm the real identity and permission for the read-only FA Firestore REST request. The previous 403 is unresolved because the local Firebase CLI session expired before a request reached Google. Reauthenticate with `npx firebase login --reauth` before any separately authorized live read. A historical text about billing is not sufficient evidence that standard Firestore GET requires Blaze.
- Confirm runtime quotas and latency with a controlled operational rollout. The local 55-user nonce capacity test does not establish Google Apps Script or Firebase daily quotas.

No production deployment, Firebase data mutation, IAM change, or service activation is performed by this local package.

## QMENTUM writes

The dedicated relay verifies an exact private `qmentumWriteRequests` document using the user FA ID token, then signs only its ID and verified actor for the existing Apps Script endpoint. Source inputs never travel through this relay. The backend independently rechecks the current profile, grant, unit, definition and config, calculates all results, and atomically commits the month/history/confirmation with preconditions. Browser writes to authoritative month/history/definition/config are denied. HMAC request/response domains are separate from Sheets and Occurrence scoring, nonces expire, redirects are restricted, and requests are bounded with no automatic retries. `QMENTUM_WRITE_ENABLED=false` is the Wrangler default. Existing server-only HMAC binding is reused; no key is embedded in code.
