# Integração FC

O Worker real `sahmt-fc-integration` está na conta FC
`57b8b02c577b6f61e96a61ce44142d2e`, em
`https://sahmt-fc-integration.anestesiahmtforms3.workers.dev`.
O plano Free foi confirmado. O Apps Script FC e o Desempenho FC exclusivo já
estão ativos; as três rotas HTTP continuam desativadas até o corte aprovado.
Este branch contém a configuração pretendida para essa próxima ativação.

Este entrypoint reutiliza os três relays existentes de QMENTUM e Ocorrências e
a admissão SQLite. Não emite tokens de login, não recebe parâmetros para escolher
o projeto Firebase e não expõe as rotas operacionais de FA ou o gateway FB.

Configuração de servidor necessária:

- `FC_INTEGRATION_ENABLED`, `QMENTUM_WRITE_ENABLED` e
  `OCCURRENCE_SCORING_ENABLED`: `true` no candidato; atualmente `false` no servidor.
- `FC_MODULE_SCRIPT_URL`: URL real da implantação do projeto Apps Script FC,
  com a conta executora FC conferida. Não há fallback para o projeto central.
- `OPERATIONAL_SHEETS_HMAC_SECRET` e `OCCURRENCE_SCORING_HMAC_SECRET`:
  segredos próprios do par FC, instalados no servidor e nas propriedades
  correspondentes do Apps Script. Nunca usar variáveis `VITE_*` para segredos.
- `FC_ADMISSION`: namespace próprio da conta FC para
  `FcIntegrationAdmissionState`. Não copiar o ID do namespace central.

O PWA usa `VITE_FC_INTEGRATION_ENABLED=true` e
`VITE_FC_INTEGRATION_ORIGIN` somente depois de observar a URL pública do Worker
e passar pela validação/aprovação de corte. A origem deve ser HTTPS exata, sem
credenciais, caminho, query, fragmento ou barra final. Login e instâncias
Firebase continuam sob responsabilidade do coordenador existente.

Os prints finais permanecem privados de FC por decisão do usuário. Clientes
antigos precisam do encaminhamento de compatibilidade para o Worker FC; o
executor central não recebe acesso às cópias. A reversão deve coordenar as
referências Drive, o encaminhamento e a configuração do frontend.

Ver diagnóstico, inventário e pendências em
`../docs/fc-service-cutover-2026-11-01.md` e o diagnóstico histórico em
`../docs/fc-integration-isolation-2026-11-01.md`.
