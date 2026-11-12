# FK Funcional Worker

This Worker belongs to `sahmt-funcional-fk`. It accepts only same-UID custom-token sessions created by the FA-to-FK bridge.

## Institutional surveys

Climate, stress/fatigue, and epidemiological submissions use the dedicated `sahmt-functional-auth-fk` Worker and the standalone FK Apps Script. The script validates the FA identity and EQUIPE/admin role, then performs create-only Firestore commits in FK. This uses the previously granted Apps Script write permissions and requires no service-account reader for another project. The client reads only its own participation status under `firestore.fk.rules`.

Keep FA's `VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED` disabled until the updated Apps Script and auth Worker are deployed and the FK Firestore create-only permissions are confirmed.

## SAHMT performance

`/v1/performance` remains disabled. The FK source adapter contains no FB project ID or FB Firestore reader. The aggregate fails closed because the FB source handoff is not yet implemented, so it cannot publish a partial total. FG, FJ, and FC export their ledgers to FK; FE records answer-free EQUIPE participation events in its own project and exports them to FK. Do not enable performance until FB has an approved source-side publisher and complete batches are reconciled in FK.
