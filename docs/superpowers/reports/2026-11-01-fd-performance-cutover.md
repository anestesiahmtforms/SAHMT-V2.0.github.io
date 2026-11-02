# Desempenho FD — implantação real

Servidor publicado, pontuação ativada e PWA V2.8 publicado em produção. Build, implantação e verificação do GitHub Actions concluídos com sucesso. Revisão: b0a085d3abbe8191f972f4ca8d739e4d028bcb0b.

- Firebase: `rotinas-8a617`; billing desativado confirmado pela API.
- Cloudflare: `434b7325287b58f36d214c9403819db2`; Workers Free confirmado visualmente pelo usuário. Nenhuma contratação.
- Endpoint: https://sahmt-indicators.anestesiahmtforms4.workers.dev
- Início: `2026-11-02T02:27:29.459Z` (UTC), após drenagem de 60 segundos dos requests anteriores.
- Regra: 1 ponto por ciência e 2 por sugestão aprovada por outra pessoa; uma ciência e uma sugestão por UID/indicador/ano.
- Sem histórico importado, sem sincronização automática para FB e sem criação de pontos artificiais.
- Identidades e sessões Google existentes preservadas. Não foram concedidas permissões a usuários em massa.

## Execução e compatibilidade

O executor indicator-compiler grava somente em FD. Mantém as leituras previamente autorizadas nas fontes FA/FB/FC/FE. O agendamento diário 0 7-10 UTC foi instalado em FD; o agendamento antigo tornou-se inativo. A rota antiga de indicadores encaminha para FD.

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

Para interromper novos créditos e restaurar o atendimento central: `node scripts/rollback-fd-fe-performance.mjs FD --apply`. O procedimento desativa o runtime, remove o cron FD quando aplicável e desliga o encaminhamento. Preserva os saldos e respostas existentes. Para ocultar a tela numa publicação posterior, definir `VITE_FD_PERFORMANCE_ENABLED=false`. O rollback está preparado, mas não foi executado.
