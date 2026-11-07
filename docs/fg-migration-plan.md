# Checklist FG migration

The owner requested the same isolation pattern used for FI/FJ and FH: central FA login and preserved UIDs, with Checklist records, validation, reporting, permissions and performance hosted in FG. FG uses `sahmt-checklist-fg`, the supplied Cloudflare account and the supplied private Drive folder under `sahmtcheck@gmail.com`.

FJ Escala and FI Operacional remain the authorities for the scheduled person. Preserve the existing rotation algorithm, event projection chain and server snapshot comparison. Only server-validated daily acknowledgements may affect points. Institutional membership comes from the linked category assignment, never the chosen account presentation.

FA remains the authority for institutional group membership throughout the ecosystem. FG reads only the signer’s current hashed category assignment before scoring, through a read-only native integration. The initial category copy in FG is preserved reference data; it never overrides the current central assignment. Permissions and all resulting performance entries belong to FG.

A first valid acknowledgement by another Equipe member creates +1 for that author and −1 for the scheduled person in one transaction, once per day. An acknowledgement by the scheduled person creates a zero-point daily receipt. A different author outside Equipe creates no points. Missing or conflicting identities cannot create points. At exactly 23:59:00 São Paulo time, new acknowledgements are denied by FG rules and a day without any recorded acknowledgement creates one −1 debit for the scheduled person. The first recorded acknowledgement starts validation immediately through the signed FG relay. The 23:59 processor only reads the day of its scheduled cutoff. It never processes earlier days. Absence and acknowledgement share a daily receipt and debit identity, preventing duplicate penalties. Missing or conflicting scheduled identities are logged for review without points. Saturday, Sunday and nationwide holidays in the federal calendar allow acknowledgement without a credit or debit. The 23:59 run skips their scoring, including absence. Optional observances such as Carnaval and Corpus Christi remain eligible. Historical acknowledgements retain their original evidence and are not rescored under the new rule.

## Execution

- [x] Protect the source documents, nested records, archives and identities before changing any producer.
- [x] Create and verify the FG project and Firestore; enable Authentication through the owner.
- [x] Import and compare all FA UIDs and profiles; preserve central login and disable destination sign-up.
- [x] Verify the exact Cloudflare destination account.
- [x] Authorize Apps Script, verify the supplied folder and publish the independent script.
- [x] Test the FG session exchange, permission gates, source sign-out and expired leases. Extend the established module broker with a fixed FG destination.
- [x] Route all Checklist reads, writes, QR lookup, history, listeners and outbox replay to FG. Keep FJ/FI reads in their own destinations; never fall back after an FG access failure.
- [x] Generate FG Firestore rules from the existing Checklist contracts, require a current FG lease and prohibit client performance writes. Exercise them with the emulator.
- [ ] Preserve and reconcile Checklist records, institutional assignments and historical evidence in FG, with explicit preconditions and protected before-images.
- [x] Publish an inactive FG Worker with only destination profile-read credentials. Prepare the independent native validator and Desempenho FG transaction.
- [ ] Verify owner preparation and activation receipts. Retire only future Checklist producers and scoring in FA, preserving historical awards and all other modules.
- [ ] Drain and reconcile outstanding work during cutover; publish the client only after native readiness, rules, indexes and destination checks pass.
- [ ] Verify production entry, read routing and no duplicate daily points. Save rollback references and the release outcome.

## Review focus

Check old browser outbox requests, UID switches during sign-in, incomplete rotation inputs, category changes, repeated acknowledgements, changed report snapshots, exact transaction boundaries and historical points. The migration must preserve FI/FJ and FH production and keep the Checklist Home entry available to permitted users.

Current status: FG infrastructure, owner preparation and read-only readiness are verified. Trusted scoring, destination routing, permissions and access rules pass local checks. Source retirement and final reconciliation remain gated on review and CI; native activation and public deployment follow the verified final copy. Checklist production still uses FA.
