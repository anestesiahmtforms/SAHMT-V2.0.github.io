# Apps Script FK

Standalone gateway project for `sahmt-funcional-fk`. It bridges an active FA ID token to the same UID in FK and writes only to FK Firestore. Survey submissions are authenticated and HMAC-signed by the FK Cloudflare Worker before they reach this web app.

## Project and deployment

- Apps Script project: `FK - FUNCIONAL SAHMT` (project ID is stored in `.clasp.json`).
- Web app runs as the deploying FK owner and accepts anonymous HTTP requests only because the Worker verifies HMAC envelopes. Do not call the web app from browser code directly.
- Keep the deployed Web App URL aligned with `APPS_SCRIPT_URL` in `worker-functional-auth/wrangler.toml`.
- Save the `FK_HMAC_SECRET` Script Property to the same private value configured as the Cloudflare secret on `sahmt-functional-auth-fk`. Never put the secret in source control.

## Required access

The Apps Script owner needs only `iam.serviceAccounts.signJwt` on `fk-functional-token-signer@sahmt-funcional-fk.iam.gserviceaccount.com`. Firestore writes use that service account through a short-lived OAuth token; grant it only `datastore.entities.create` and `datastore.entities.update` on FK. The script reads only the FA identity/category documents using the current FA ID token; it has no server credential for reading other project databases. Functional profile sources such as professional registration, performance, and biosafety stay `PREPARING` until their source modules write the migrated data into FK. Do not restore a legacy cross-project reader to populate those cards.

The manifest scopes are used for external requests, FK Firestore writes, and short-lived JWT signing. This gateway does not create Google service-account keys.

## Performance source batches

Approved source producers send normalized, cutoff-pinned batches with the `PERFORMANCE_SOURCE_PUSH` action and publish a completion marker using `PERFORMANCE_SOURCE_PUBLISH`. The gateway currently accepts FG, FJ, FC, and FE labels, validates UID/category/points/timestamps, and writes create-only chunks and manifests to FK. FG, FJ, and FC use Apps Script exporters; FE records answer-free EQUIPE participation events in its own source database and its Worker exports them. Incomplete chunks have no manifest and are ignored. Each source uses its own `FK_SOURCE_HMAC_SECRET_<SOURCE>` key, separate from the auth/survey broker HMAC key. The FK performance worker reads its EQUIPE roster and source snapshots only in FK. It refuses to publish while the required FB contribution is missing; no FB project reader is configured. Do not activate performance until FB has an approved source-side publisher and complete batches are reconciled. Copy `FKPerformanceSourceClient.gs` into FG/FC/FJ only and set each source's unique HMAC property plus `FK_APPS_SCRIPT_URL` before enabling its push.

## Sync and deploy

From this directory, authenticate `clasp` as the FK owner, then run `clasp push`. In Apps Script, save and update the existing Web App deployment so the published URL remains the one configured in the Worker. Confirm the deployment executes as the FK owner and retains the HMAC Script Property. Do not enable the Pages survey flag until this deployment is live.
