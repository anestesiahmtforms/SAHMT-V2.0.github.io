# Apps Script FK

Standalone gateway project for `sahmt-funcional-fk`. Browser login uses the existing Google account in the FA and the same Google identity/UID in FK Firebase Auth. This Apps Script does not issue or exchange Firebase login tokens. It validates FA identity and team membership for snapshots and surveys, then writes only to FK Firestore. Survey submissions are HMAC-signed by the FK Cloudflare Worker before they reach this web app.

## Project and deployment

- Apps Script project: `FK - FUNCIONAL SAHMT` (project ID is stored in `.clasp.json`).
- Web app runs as the deploying FK owner and accepts anonymous HTTP requests only because the Worker verifies HMAC envelopes. Do not call the web app from browser code directly.
- Keep the deployed Web App URL aligned with `APPS_SCRIPT_URL` in `worker-functional-auth/wrangler.toml`.
- Save the `FK_HMAC_SECRET` Script Property to the same private value configured as the Cloudflare secret on `sahmt-functional-auth-fk`. Never put the secret in source control.

## Required access

The Apps Script owner needs only `iam.serviceAccounts.signJwt` on `fk-functional-token-signer@sahmt-funcional-fk.iam.gserviceaccount.com` to obtain a short-lived OAuth token for its narrow Firestore writer. This service-account assertion is only backend Firestore authorization; Firebase user login does not use JWT or custom tokens. Grant the FK snapshot service account `datastore.entities.create`, `datastore.entities.update` and `datastore.entities.get` on FK. The administrative lookup reads one FK profile document after checking the administrator and the selected member’s active Equipe affiliation against FA using the administrator’s FA ID token. Functional profile sources such as professional registration, performance, and biosafety stay `PREPARING` until their migration is defined. Performance remains independent in each instance; FK does not read its ledgers/events or accept performance batches. Do not restore a cross-project reader or source publisher without approving a future transfer process.

The manifest scopes are used for external requests, FK Firestore writes, and short-lived JWT signing. This gateway does not create Google service-account keys.

## Sync and deploy

From this directory, authenticate `clasp` as the FK owner, then run `clasp push`. In Apps Script, update the existing Web App deployment so the published URL remains the one configured in the Worker. Confirm it runs as the FK owner and retains the HMAC Script Property.
