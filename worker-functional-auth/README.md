# FK Functional authentication Worker

Dedicated Cloudflare Worker for FK only. It validates the exact FA-to-FK broker request shape, applies origin checks, signs an HMAC envelope, and calls the standalone FK Apps Script. The Apps Script validates the FA identity and applicable group for each request.

## Configuration

- `FK_AUTH_ORIGIN` is the GitHub Pages origin hosting FA.
- `APPS_SCRIPT_URL` is the public web-app URL of the standalone FK Apps Script.
- `FK_HMAC_SECRET` is a Cloudflare secret and must match the Apps Script `FK_HMAC_SECRET` Script Property. Never commit the value.
- Deploy only with the Wrangler account for the FK Cloudflare account (`735b93b5ee83e7b713a494ca297a1812`). This Worker is independent of `sahmt-auth-broker`.

FK authentication now uses the same existing Google identity and UID through Firebase Auth. This Worker does not issue or exchange login tokens. `/v1/functional/refresh` saves the user's own functional overview to FK. `/v1/functional/survey` forwards climate, stress/fatigue, and epidemiological submissions to the FK Apps Script, which validates the FA identity and EQUIPE group before writing create-only records to FK Firestore. FE and FB data stores are not queried by this survey path.

`/v1/functional/team-overview` accepts one selected UID and returns that FK profile only after the Apps Script validates the administrator and the selected member’s active Equipe affiliation.
