# Plano de importação fechada Auth de Gestão

Spec: docs/management-closed-auth-import-spec-20261009.md

- [ ] Implementar núcleo puro scripts/lib/management-closed-auth-import.js e tests/management-closed-auth-import.test.js, TDD.
- [ ] Conferir snapshots/provas privadas e preparar helper ignorado --preflight/--import, namespace único sem retry.
- [ ] Revisar independentemente request flags, preservação UID/Google, DPAPI, transporte parcial e saída agregada.
- [ ] Consultar Auth atual FA/FB e metadados FB, recompor plano antes de uma escrita fechada.
- [ ] Importar somente contas Google selecionadas e conferir Auth FB posterior; manter Rules/app fechados.
- [ ] Registrar resultado real e pendências de login/broker/reconciliação.
