# HMAC-only Apps Script homologation

This directory is a standalone, non-operational test copy. Do not copy it into the production Gateway project.

## What this variant does

- Accepts only one synthetic `AUTH_USER_LOOKUP_FB` envelope using UID `synthetic-homologation-uid`.
- Checks the current `SAHMT_MANAGEMENT_GATEWAY_V1` canonical JSON, SHA-256 body digest, HMAC-SHA256 request signature, fixed audience/key ID/project routing, 20-second maximum envelope lifetime, and 5-second future skew.
- Claims each nonce once under an Apps Script lock and a bounded Script Properties ledger.
- Returns a Worker-verifiable HMAC response with `status=DENIED`, `code=GATEWAY_DISABLED`, and `body=null`; replay returns signed `GATEWAY_REPLAY_DENIED`.
- Rejects malformed, adulterated, expired, or unconfigured input with only `GATEWAY_ADMISSION_DENIED`.
- Has no dispatcher or code path for Google Authentication, IAM, Firebase, Firestore, or outbound HTTP. All six operation switches are fixed `false` in the file.

The response is intentionally a denial. This proves protocol compatibility and HMAC in both directions without exercising privileged operations.

## OAuth scope and private test secret

The manifest declares only `https://www.googleapis.com/auth/script.storage`, needed for the temporary secret and replay ledger in Script Properties. `ContentService`, `Utilities`, and `LockService` are the only other Apps Script services used; this source has no `UrlFetchApp`, OAuth token request, or Firebase/IAM endpoint.

The only Script Property to install is:

`SAHMT_HOMOLOGATION_HMAC_SECRET_BASE64URL`

Prepare one disposable 32-byte key with a single local command. It runs the mocked HMAC suite, stores the key outside the repository in the current Windows profile's local application data with an ACL limited to that Windows user, and copies the key to the clipboard without printing it:

```powershell
node .\scripts\management-gateway-homologation-secret.mjs prepare
```

The command emits only status codes. Paste the clipboard value into the property field in the isolated Apps Script copy, then clear the clipboard. `copy` can recopy the local key later; `diagnose` checks that the local key exists without showing it. The raw value is never printed to the terminal, saved in the repository, or placed in frontend code. Do not use this key in the operational Gateway or production Worker.

## Install only after separate approval

1. Open only `SAHMT Auth Gateway FA-FB-FC — HOMOLOGAÇÃO`; verify its script identity and separate deployment list.
2. In that copy only, enable manifest visibility, replace the complete `Gateway.gs` and `appsscript.json` with the two files in this directory, then save.
3. Confirm the manifest has exactly the `script.storage` scope, and that the source has only `doPost` and the six fixed-off switches.
4. Add the single Script Property above from the locally generated clipboard value. Do not add operational Gateway properties.
5. Stop if the OAuth screen requests IAM, datastore, external requests, Firebase Authentication, or any additional scope. Do not grant it.
6. Deployment and the one-shot HTTP request require separate approval. For a later test, the local client reads the URL from `SAHMT_HOMOLOGATION_GATEWAY_URL`, reads the key from the ACL-restricted local file, sends exactly one POST, follows only an allowlisted Content Service redirect with one GET, and prints sanitized statuses and result codes.

The HMAC probe CLI is deliberately gated by `--send-once`. It prompts for the URL as normal visible terminal input, joins consecutive lines from a multiline paste, strips accidental whitespace, and prints only a safe format status. It requires the exact confirmation `HOMOLOGACAO V2` (confirming the isolated deployment) before loading the key or making network requests:

```powershell
node .\scripts\management-gateway-hmac-homologation.mjs --send-once
```

The URL is visible only while being entered; it is not repeated in result messages or logs. The redirect location, response body, key, nonce, and raw error are never printed. Invalid input reports only whether the URL is empty, incomplete, or malformed. The tool does not retry. Its one-shot sequence makes one POST and one GET to the validated Content Service redirect. This command has not been run against a remote service.

## Close and remove temporary state after the test

1. Archive/delete the temporary Web App deployment in the isolated Apps Script copy.
2. Delete `SAHMT_HOMOLOGATION_HMAC_SECRET_BASE64URL` and every `SAHMT_HOMOLOGATION_NONCE_V1_*` property from that copy.
3. Confirm there are no active deployments and no script triggers.
4. Remove the local disposable key; the command clears the clipboard only if it still contains that key:

```powershell
node .\scripts\management-gateway-homologation-secret.mjs remove
```

These steps only describe future manual cleanup. No remote files, properties, or deployments were changed while preparing this package.
