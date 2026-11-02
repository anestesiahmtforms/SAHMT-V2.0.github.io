# Desempenho FE — implantação real

Servidor publicado e pontuação ativada. Publicação do PWA em andamento.

- Firebase: `outros-48120`; billing desativado confirmado pela API.
- Cloudflare: `fb3d38f501820ddf90764aadaa94fc89`; Workers Free confirmado visualmente pelo usuário. Nenhuma contratação.
- Endpoint: https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev
- Início: `2026-11-02T02:27:37.680Z` (UTC), após drenagem de 60 segundos dos requests anteriores.
- Regra: 1 ponto por participação aceita em clima, estresse ou epidemiologia; uma por UID/pesquisa/ciclo, sem conteúdo das respostas no livro de pontos.
- Sem histórico importado, sem sincronização automática para FB e sem criação de pontos artificiais.
- Identidades e sessões Google existentes preservadas. Não foram concedidas permissões a usuários em massa.

## Execução e compatibilidade

O executor fe-survey-worker grava somente em FE. A função customizada sahmtFeMembershipReader permite apenas datastore.entities.get em FB para validar perfis e grupos existentes, sem gravação em FB. O código limita essas consultas a users e userCategories. Clientes antigos encaminham SUBMIT e GET_PERFORMANCE para FE. BOOTSTRAP e REPORT antigos preservam a autorização central para relatórios epidemiológicos.

O módulo original dos dois Workers centrais foi preservado integralmente e envolvido por encaminhamento de rota. Segredos e demais bindings foram mantidos, com conferência posterior. As credenciais locais e backups estão protegidos por Windows DPAPI dentro de .local-preview, ignorado pelo Git. A pasta Drive informada não precisou ser utilizada: este fluxo é executado pelos Workers, sem Apps Script nem gatilhos adicionais.

## Evidências

- 25 verificações automatizadas direcionadas passaram; compilação independente FA/FB e pesquisas concluída.
- Contratos de encaminhamento, bloqueio de outras rotas FE e inativação do cron central conferidos.
- Leitura transacional real por cada executor concluída, sem gravar dados de negócio.
- Endpoints novos e antigos rejeitam requests sem sessão com HTTP 401.
- Inventários, permissões, implantação, corte, ativação e leitura posterior estão nos JSON desta pasta.
- Validação visual autenticada pelo navegador não foi realizada nesta etapa.

## Autorização e reversão

O usuário autorizou expressamente ativar e publicar ao terminar, sem nova aprovação ou testes manuais, em 01/11/2026. Essa instrução substitui a espera por aprovação final descrita no plano inicial.

Para interromper novos créditos e restaurar o atendimento central: `node scripts/rollback-fd-fe-performance.mjs FE --apply`. O procedimento desativa o runtime, remove o cron FD quando aplicável e desliga o encaminhamento. Preserva os saldos e respostas existentes. Para ocultar a tela numa publicação posterior, definir `VITE_FE_PERFORMANCE_ENABLED=false`. O rollback está preparado, mas não foi executado.
