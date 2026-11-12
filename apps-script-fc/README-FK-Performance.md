# FC to FK performance push

FC now exports its immutable `fcPerformanceLedger` deltas to FK once per day during the 00:00–00:30 São Paulo window. Each push is HMAC-signed, cutoff-pinned, chunked, and create-only. It reads FC's own ledger and sends only rows newer than its last successful FK push. FK deduplicates retries by source record ID and rejects conflicting copies.

Copy `FKPerformanceSourceClient.gs` into the FC Apps Script project. Set `FK_SOURCE_HMAC_SECRET_FC` and `FK_APPS_SCRIPT_URL` in Script Properties to the FC-specific FK gateway values before deploying. The exporter includes only awards whose original version-1 ledger record began within FK's effective period, so a later correction to an older credit cannot create a new FK score. The source cycle keeps running if the FK push is unavailable and reports `functionalSync: PENDING`; FK will refuse an aggregate when the latest source batch is stale.
