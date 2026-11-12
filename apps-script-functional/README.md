# Apps Script FK

Standalone gateway project for `sahmt-funcional-fk`. It bridges an active FA ID token to the same UID in FK and writes only to FK Firestore. Survey submissions are authenticated and HMAC-signed by the FK Cloudflare Worker before they reach this web app.

## Project and deployment

- Apps Script project: `FK - FUNCIONAL SAHMT` (project ID is stored in `.clasp.json`).
- Web app runs as the deploying FK owner and accepts anonymous HTTP requests only because the Worker verifies HMAC envelopes. Do not call the web app from browser code directly.
- Keep the deployed Web App URL aligned with `APPS_SCRIPT_URL` in `worker-functional-auth/wrangler.toml`.
- Save the `FK_HMAC_SECRET` Script Property to the same private value configured as the Cloudflare secret on `sahmt-functional-auth-fk`. Never put the secret in source control.

## Required access

The Apps Script owner needs only `iam.serviceAccounts.signJwt` on `fk-functional-token-signer@sahmt-funcional-fk.iam.gserviceaccount.com`. Firestore writes use that service account through a short-lived OAuth token; grant it only `datastore.entities.create` and `datastore.entities.update` on FK. The script reads only the FA identity/category documents using the current FA ID token; it has no server credential for reading other project databases. Functional profile sources such as professional registration, performance, and biosafety stay `PREPARING` until their migration is defined. Performance remains independent in each instance; FK does not read its ledgers/events or accept performance batches. Do not restore a cross-project reader or source publisher without approving a future transfer process.

The manifest scopes are used for external requests, FK Firestore writes, and short-lived JWT signing. This gateway does not create Google service-account keys.

## Sync and deploy

From this directory, authenticate `clasp` as the FK owner, then run `clasp push`. In Apps Script, save and update the existing Web App deployment so the published URL remains the one configured in the Worker. Confirm the deployment executes as the FK owner and retains the HMAC Script Property. Do not enable the Pages survey flag until this deployment is live.
