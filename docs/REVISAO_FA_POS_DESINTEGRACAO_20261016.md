# Revisão do FA após retirada das sessões FB/FC — 16/10/2026

## Escopo e evidências

Revisão do código, dependências do cliente, configuração do build e consultas administrativas de leitura ao FA, Apps Script e Worker. A consulta ao Firestore listou metadados de 49 coleções raiz e leu seis documentos de controle; não varreu documentos operacionais ou clínicos. As cópias de recuperação ficam fora do Git, em `%LOCALAPPDATA%/SAHMT/fa-cleanup-20261016/`.

## Autoridade atual

| Processo | Autoridade preservada |
| --- | --- |
| Login Google, UID, perfis e permissões | Authentication/Firestore FA |
| Escala, Eventos, Etiquetas e Checklist | FA; autoria da escala permanece no fluxo aprovado de planilha |
| Gestão, treinamentos e Desempenho | FA, com autorização por perfil e Rules |
| Registro de Ocorrências e sua pontuação | FA; Worker valida a sessão FA e encaminha ao processador confiável |
| QMENTUM | FA, com concessões próprias em qmentumAccess |
| Planilha operacional | Envio autenticado por registro pelo Worker/Apps Script; não depende de sessão FB/FC |

Os marcadores `managementRuntime/faConsolidation` e `occurrenceRuntime/faConsolidation` foram lidos com HTTP 200, ACTIVE e FA_CONSOLIDATION_VERIFIED. Ciência do Checklist está habilitada; o estado consultado de Desempenho não tinha recálculo pendente. Faturamento FA: consulta HTTP 200, billingEnabled=false.

## Limpeza executada

- Retirados do cliente principal o conector automático FB/FC, suas chamadas em login/reconexão/retorno de tela e os botões de conexão secundária na Gestão.
- Retirados o registro e painel do piloto antigo da PWA normal; preservados o login FA, logout e limpeza defensiva de instâncias secundárias que eventualmente já existam em memória.
- Removidas as configurações Web FB/FC encaminhadas pelo build e os endpoints antigos nos metadados HTML. As três marcas de compatibilidade ficam fixas em false.
- Removidos o CSS exclusivo do painel de conexão e a indicação antiga “(FC)” na permissão de registrar ocorrências; a chave da permissão não mudou.
- No Worker, desligadas MANAGEMENT_AUTH_ENABLED, MANAGEMENT_AUTH_FB_ENABLED, MANAGEMENT_AUTH_FC_ENABLED, MANAGEMENT_DOMAIN_ENABLED e MANAGEMENT_GATEWAY_ENABLED. MANAGEMENT_FIRST_LOGIN_ENABLED já estava false e permanece assim. MANAGEMENT_SECONDARY_AUTH_RETIRED permanece true.
- A alteração do Worker foi somente de configuração. Todos os demais bindings foram comparados e preservados, incluindo nove segredos e o namespace de admissão. Planilha, pontuação de Ocorrências e QMENTUM continuam habilitados.
- Acrescentada uma verificação obrigatória do grafo de imports e manifesto Vite para impedir módulos de inicialização, broker e piloto FB/FC no build principal.
- Corrigido um teste de roteamento anterior à consolidação de Ocorrências que ainda esperava FC; agora exige FA, sem mudar o roteamento já existente.

## Elementos preservados deliberadamente

- Os 49 conjuntos consultados não incluíram as coleções raiz antigas de leases/fences secundários. Não foi demonstrada uma coleção descartável no FA; nenhum documento foi apagado.
- `migrationOrigins`, recibos, IDs de premiação e atribuições históricas FB/FC continuam necessários para proveniência e deduplicação. Renomeá-los ou removê-los poderia pontuar novamente eventos já processados.
- Marcadores de consolidação são barreiras de segurança atuais, não lixo da migração.
- Bibliotecas e testes históricos ficam conservados no repositório, fora do grafo executável e dos chunks da PWA. Não constituem conexão de produção.
- Worker, Apps Script, HMAC e Durable Object ainda atendem processos próprios de FA. Não foram excluídos como se servissem apenas à autenticação secundária.
- `VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN` conserva um nome legado, mas ainda é usado pelo cliente de entrega de pontuação de Ocorrências. Sua remoção indiscriminada interromperia esse processo FA.
- Gestão e Desempenho continuam visíveis e bloqueados para usuários comuns conforme a política existente; nenhuma permissão ou flag de liberação foi ampliada.

## Limites e coerência

- Todos os arquivos operacionais Apps Script com correspondente local coincidiram com a fonte remota consultada. Quatro módulos privados/remotos sem arquivo local foram incluídos na cópia de recuperação e preservados.
- As Rules em produção são uma composição que inclui consolidação, Ocorrências e QMENTUM; não são idênticas ao arquivo-base firestore.rules. A fonte publicada foi guardada privadamente. Esta limpeza não publica Rules nem autoriza substituir a composição pelo arquivo-base.
- Não foi feito inventário remoto dos acionadores por Execution API, cuja autorização de execução já se mostrou indisponível. A revisão de fonte e das configurações não comprova ausência de acionadores de outros proprietários.
- As provas externas desta revisão não enviaram token Firebase nem gravaram dados: endpoint de sessões antigas bloqueado com 503; serviços FA recusaram pedidos sem sessão com 401. Isso confirma roteamento e admissão, não substitui um teste autenticado de gravação no dispositivo.
- O pedido de conferência de 13/10 continua preservado para revisão administrativa. A limpeza não contorna esse bloqueio nem altera seus pontos.

## Validação local

- Sintaxe de todos os módulos Apps Script conferida.
- Consolidação: 35 testes aprovados, um teste de emulador não executado nesta suíte local.
- Domínio: 967 aprovados.
- Gestão: 2.730 aprovados, três casos não executados pela suíte local.
- Integração de destinos/roteamento: 91 aprovados.
- QMENTUM: 109 aprovados.
- Serviços FA com flags secundárias desligadas: três testes aprovados.
- Cache da PWA: seis testes aprovados.
- Build completo aprovado; verificador de dependências: 91 arquivos-fonte alcançáveis, zero módulos e zero chunks dos sete componentes secundários proibidos.
- O relatório legado de preparação de migração mantém productionReady=false por definição; localReady=true e todas as verificações locais passaram. O estado real ACTIVE foi conferido separadamente no FA. Esta limpeza não executa uma nova migração.

## Recuperação da limpeza

Reverter apenas o commit de limpeza da interface restaura o cliente anterior sem restaurar banco ou filas. A configuração anterior do Worker está no arquivo privado worker-flags-before-private.json; uma restauração deve alterar somente as flags registradas, herdando os bindings atuais e preservando os serviços FA. Não restaurar uma cópia antiga do Firestore sobre registros novos e não reativar FB/FC como efeito automático da reversão.

Referência do mecanismo de preservação de bindings na atualização de configurações: [Cloudflare Workers API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/).
