# FG to FK performance push

FG now pushes its validated checklist ledger into FK after its daily scoring invocation. The push reads only FG's own `fgPerformanceLedger`, signs the envelope with the configured script property, and writes normalized rows to FK through the standalone FK Apps Script gateway. It does not read or write FB.

Before publishing FG, copy `FKPerformanceSourceClient.gs` into the FG Apps Script project and set `FK_SOURCE_HMAC_SECRET_FG` and `FK_APPS_SCRIPT_URL` in that project's Script Properties. The FG key is unique to this source and must match the FK gateway's `FK_SOURCE_HMAC_SECRET_FG`. Until those properties and the FK deployment exist, the scorer logs `functionalSync: PENDING`; the next successful snapshot includes the FG ledger since its last acknowledged push.
