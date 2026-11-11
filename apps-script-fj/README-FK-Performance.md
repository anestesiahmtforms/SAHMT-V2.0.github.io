# FJ → FK performance handoff

`FKPerformancePush.gs` reads only FJ `events` and `contacts`. It maps an event's unique active contact to the FJ source identity (normalized `sigla`), sends the validated atraso points to the standalone FK gateway, and advances its cursor only after a complete batch is acknowledged. It does not read FA or FB and does not write to either project.

Before enabling the daily trigger, copy `FKPerformanceSourceClient.gs` into the FJ Apps Script project and add Script Properties `FK_SOURCE_HMAC_SECRET_FJ` (unique, at least 32 characters) and `FK_APPS_SCRIPT_URL` (the FK web app URL). Add the matching FJ source secret to the private FK gateway properties. Populate each active EQUIPE member's `sourceUids.FJ` with their normalized FJ `sigla` in the FK roster. The publisher fails closed if an event has an ambiguous active contact or invalid score.

After the FK gateway is deployed and source properties are configured, run `fjEnsureFunctionalPerformanceTrigger` once to create the daily 01:00 São Paulo trigger. Keep it disabled until the FK pipeline is ready. `sahmtPerformanceMembers` remains the authority for EQUIPE eligibility; non-EQUIPE source identities are excluded by FK.
