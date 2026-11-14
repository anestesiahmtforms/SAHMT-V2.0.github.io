# FK Funcional Worker

This Worker belongs to `sahmt-funcional-fk`. It accepts only same-UID custom-token sessions created by the FA-to-FK bridge.

## Institutional surveys

Climate, stress/fatigue, and epidemiological submissions use the dedicated `sahmt-functional-auth-fk` Worker and the standalone FK Apps Script. The script validates the FA identity and EQUIPE/admin role, then performs create-only Firestore commits in FK. This uses the previously granted Apps Script write permissions and requires no service-account reader for another project. The client reads only its own participation status under `firestore.fk.rules`.

Keep FA's `VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED` disabled until the updated Apps Script and auth Worker are deployed and the FK Firestore create-only permissions are confirmed.

## SAHMT performance

The FK Worker schedules one consolidation each Saturday at 23:50 in Brasília (Sunday at 02:50 UTC). The FK Apps Script reads only the published performance summaries and their runtime/reference metadata in FB, FC, FE, FG and FJ, plus the active Equipe roster in FA. It writes private documents to `functionalPerformance/{uid}`. Total points include negative entries. The percentage uses the highest combined total in the same active Equipe roster and is rounded and bounded to 0–100. If the highest total is zero or negative, all percentages are 0. A failed consolidation preserves the previous confirmed snapshot and its timestamp.
