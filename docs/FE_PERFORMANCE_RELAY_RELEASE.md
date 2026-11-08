# FE performance relay deployment

The relay runs in the existing FE Worker and uses its existing service-account secret. It exposes only fixed performance projections; it does not grant FD Firestore list permissions or expose survey answers.

Both commands below default to read-only remote preflight and bundle compilation:

```sh
node scripts/deploy-fe-performance-relay.mjs
node scripts/deploy-fd-fixed-sync.mjs --enable-performance
```

FE uses the Wrangler keyring profile `sahmt-fe-isolation`; FD uses `sahmt-fd-isolation`. Both verify the account identity and existing free-plan confirmation. Existing secret values are retained through Cloudflare `keep_bindings`; existing nonsecret bindings and runtime settings are carried forward.

When deployment is separately authorized, the order is FE first, then FD, adding `--apply` to each command. FE creates or reuses `.local-preview/fd-fixed-sync/fe-performance-read-secret.dpapi.json`, backs up current source/settings under DPAPI, checks remote drift, publishes, checks source/bindings, and performs an authenticated runtime-only historical read. FD requires that same local protected pairing and repeats the runtime smoke before any remote mutation. A failed smoke prevents FD deployment and schedule changes. The smoke reads no profiles, awards, or survey responses.

Only the FD executor receives `FE_PERFORMANCE_READ_URL`, `FE_PERFORMANCE_READ_SECRET`, and the public `FD_WEB_API_KEY` from the FD project configuration. The scheduler receives no relay credentials. Existing legacy authentication bindings remain intact. Do not use the older generic `deploy-fd-fe-services.mjs` for this release: it rebuilds bindings without this preservation/pairing workflow.

Preflight verification on 2026-11-07: both commands above returned READY; 12 relay/release/survey-worker tests passed. No deployment, shared-secret creation, live authenticated relay smoke, IAM grant, or business write was performed. The live smoke occurs only during an authorized apply after FE publication.
