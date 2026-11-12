# FK Funcional Worker

This Worker belongs to `sahmt-funcional-fk`. It accepts only same-UID custom-token sessions created by the FA-to-FK bridge.

## Institutional surveys

Climate, stress/fatigue, and epidemiological submissions use the dedicated `sahmt-functional-auth-fk` Worker and the standalone FK Apps Script. The script validates the FA identity and EQUIPE/admin role, then performs create-only Firestore commits in FK. This uses the previously granted Apps Script write permissions and requires no service-account reader for another project. The client reads only its own participation status under `firestore.fk.rules`.

Keep FA's `VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED` disabled until the updated Apps Script and auth Worker are deployed and the FK Firestore create-only permissions are confirmed.

## SAHMT performance

Performance remains separate in each instance and is not integrated with FK. FK does not read performance ledgers or events from FB, FC, FE, FG, or FJ, and no source publisher is configured. A future transfer requires a separately approved process.
