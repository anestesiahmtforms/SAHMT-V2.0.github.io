# Gestão e Desempenho em FB — entrada Google única, dados independentes

## Escopo autorizado

Migrar o estado atual de Gestão e Desempenho de FA para FB, preservando apresentação, regras de negócio, usuários, UIDs e permissões. QMENTUM e módulos operacionais permanecem em FA. A entrada Google continua em FA; a confirmação já validada estabelece sessões Auth independentes com os mesmos UIDs. Não reativar broker, leases, vinculação por e-mail, primeiro login especial, cobrança ou Blaze.

## Evidência e estado em 22/10/2026

- Contas FA e FB verificadas pela identidade OAuth de cada proprietário; faturamento desabilitado em ambos.
- Capturas privadas completas, incluindo descendentes: FA 487 documentos selecionados para inspeção; FB 480 documentos existentes. Somente coleções do domínio e perfis/configuração necessários participam da cópia.
- Cópia verificada por conteúdo tipado Firestore: 484 documentos, incluindo 54 perfis, configuração de módulos e dados de negócio. 387 equivalentes, 93 substituições de conteúdo antigo e quatro inclusões; total de 97 gravações. Zero documentos de origem excluídos. Contas Auth não foram alteradas.
- 92 divergências de negócio originais estavam em atividades/configurações de avaliação, referência, estado e resumos. A inclusão da configuração e comparação de perfis acrescentou uma substituição. Não confundir esses totais.
- Cópias de recuperação privadas preservadas em `.local-preview/management-fb-20261022-recovery` da área de trabalho FIRESTORE, fora do controle de versão.
- Regras FB derivadas da política FA efetivamente publicada, mantendo as condições de perfil, grupos e permissões. Coleções operacionais e QMENTUM removidas do destino. Ausência de regras de broker/lease. Compilação pelo serviço de Rules aprovada; regras independentes ativadas após a reconciliação final.
- Quatro índices ausentes de Gestão preparados em FB, além dos 28 existentes. Conferência final: 32 índices READY.
- Executor existente possui get/list/create/update e databases.get, condicionado ao banco default de FB. Nenhuma ampliação de IAM foi necessária. Leitura real do marcador FB pelo executor FA: HTTP 200.
- Apps Script: 63 arquivos anteriores e manifesto preservados; adicionado o controle independente de FB. Versão 27 instalada preservando os 63 arquivos anteriores e o manifesto. A API de execução devolveu HTTP 403; o administrador executou a função no editor e confirmou INDEPENDENT_FB_BACKEND_ARMED às 17:16:55.
- Marcador FB promovido para ACTIVE às 17:21:03 após conferência final de 484 documentos equivalentes, zero novas gravações e bloqueio dos escritores antigos de Gestão em FA. QMENTUM e operacional preservados.

## Comportamento da versão candidata 220

- Duas compilações do mesmo código e estilos: FA na raiz, FB em `/gestao/`. Gestão e Desempenho encaminham para FB; HOME e QMENTUM retornam para FA.
- App Firebase, IndexedDB, filas, geração de dados e escopo/cache do service worker separados por destino.
- App FB restaura a sessão Google já estabelecida em FA. Se não existir, oferece retorno à entrada principal para a confirmação. Não cria um novo cadastro.
- Logout em FB também encerra as cinco sessões Auth. Não existe nova consulta periódica de perfil.
- Notificações da instalação independente usam o perfil e banco locais; foi removida a dependência antiga de `managementAuthorizationLeases`.
- Apps Script mantém Config/operacional em FA e direciona Gestão/avaliação para FB somente após a chave de liberação. Evidências operacionais são lidas em transações próprias; nenhuma transação escreve em dois projetos.
- Checklist e Ocorrências conservam seus registros em FA, entregando apenas os créditos confirmados ao ledger FB. Recibos idempotentes preservam as duas pernas da transferência de Checklist e impedem duplicação por repetição.
- QMENTUM continua integralmente em FA. A pontuação é entregue por outbox restrita ao servidor e recibo em FB; confirmação perdida é recuperável sem crédito duplicado. Não há novo acionador de varredura.
- As proteções de leitura e pausas de tarefas já existentes no Apps Script publicado foram preservadas ao mesclar as funções modificadas.

## Validação já executada

- 1.065 testes de domínio aprovados.
- 55 testes dos contratos independentes, ledger e participação QMENTUM aprovados após o ajuste final de isolamento.
- Três testes das regras FB no emulador aprovados: acesso Google direto ao próprio saldo, bloqueio de terceiros/revogados e de escritas de pontuação/operacional/QMENTUM, e fechamento do domínio sem marcador ativo.
- Compilação das entradas FA e FB aprovada.
- `FA_RUNTIME_CLEANUP_VERIFIED`: zero módulos/chunks antigos de integração alcançáveis.

Estes resultados não constituem validação do aplicativo FB já publicado nem teste de operação real no iPhone.

## Sequência do corte

1. Concluído: administrador executar `ativarGestaoDesempenhoFbV1` em `ManagementIndependentFb.gs`, no editor do projeto existente com a conta proprietária. Esperado: `INDEPENDENT_FB_BACKEND_ARMED`.
2. Concluído: bloquear escritores de Gestão antigos por meio do marcador FA já previsto nas regras. Manter usuários, operacional e QMENTUM acessíveis.
3. Concluído: capturar/reconciliar uma única vez as diferenças finais; preservar o backup inicial e o marcador de migração FB. Não apagar dados de destino gerados após o corte.
4. Concluído: confirmar índices prontos, promover o marcador FB para ACTIVE e publicar as regras independentes.
5. Conferir a rota efetiva do backend e só então publicar a PWA candidata. Conferir por HTTP as duas entradas, namespaces e configurações.
6. Validar os consumidores antes de remover a origem. Não excluir `users`, `appConfig`, QMENTUM ou áreas usadas por autorização/comunicados FA. Limpeza de caminhos requer equivalência atualizada e ausência de escritores, com precondição de updateTime; ausência de conflito não se infere apenas de contagens.

## Reversão

Antes do corte público, a propriedade ausente mantém o processamento anterior em FA. Após armar, não restaurar a propriedade cegamente: reconciliar qualquer crédito gerado em FB antes de reabrir escritores FA. Preservar ambas as capturas, recibos, perfis e filas. Nunca limpar armazenamento local ou trocar UIDs para reverter.

## Estado do leitor protegido

O Worker existente foi inspecionado por leitura e manteve suas configurações: broker de sessões aposentado; leitor protegido ainda sem ativação/segredo de produção. Esse estado de preparação do FA foi preservado. O adaptador de leitura ganhou suporte opt-in ao token nativo FB e teste de rejeição de audiência FA quando selecionado FB; não houve implantação do Worker nem ativação de um recurso anteriormente desligado. Arquivos Drive, PDFs, formulários e respectivas políticas foram preservados.
