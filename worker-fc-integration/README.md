# Integração FC

Preparação local, ainda sem implantação no destino. A configuração aponta para
a conta FC `57b8b02c577b6f61e96a61ce44142d2e`, mas o nome
`sahmt-fc-integration` é uma proposta: primeiro inventariar e reutilizar um
Worker FC existente quando adequado. Não publicar enquanto esse inventário e
as permissões/plano não estiverem verificados.

Este entrypoint reutiliza os três relays existentes de QMENTUM e Ocorrências e
a admissão SQLite. Não emite tokens de login, não recebe parâmetros para escolher
o projeto Firebase e não expõe as rotas operacionais de FA ou o gateway FB.

Configuração de servidor necessária:

- `FC_INTEGRATION_ENABLED`, `QMENTUM_WRITE_ENABLED` e
  `OCCURRENCE_SCORING_ENABLED`: permanecem `false` na preparação.
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

Desabilitar a flag de frontend e republicar recupera os endereços anteriores.
Conservar o serviço central durante a janela de clientes antigos; nenhuma
configuração consegue substituir os bundles que já estão instalados. O ciclo
existente de publicação e atualização do shell deve ser usado na ativação e na
reversão aprovadas.

Ver diagnóstico, inventário e pendências em
`../docs/fc-integration-isolation-2026-11-01.md`.
