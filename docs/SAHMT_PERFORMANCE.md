# Desempenho SAHMT

O acesso fica em Governança → Indicadores → **DESEMPENHO - SAHMT**. O cabeçalho usa o contêiner existente. A FA encaminha ao painel de FD. Cada pessoa consulta seu próprio saldo e histórico, e o maior total da equipe serve de referência sem identificar outra pessoa.

As seis categorias são Operacionais (FG/FI), Treinamentos e Gestão (FB), Registros (FC), Enquetes (FE), Notificações e Educação Continuada. As duas últimas recebem entradas administrativas. Correções mantêm o lançamento original e acrescentam uma diferença auditável. O saldo confirmado só muda na apuração diária, inclusive para lançamentos manuais.

O percentual é `total pessoal / maior total elegível × 100`. Débitos e percentuais negativos são preservados. Sem maior total positivo, a comparação é indisponível. A vigência de todas as categorias começa em **01/12/2026 às 00h00 de Brasília**. A primeira apuração elegível é **01/12/2026 às 02h00**. Uma fonte que tenha começado depois só contribui a partir da própria ativação.

## Rotina diária

O cron privado é `0 5 * * *`, equivalente a 02h00 em America/Sao_Paulo. Substitui as agendas antigas de 00h00 e 12h00. A tarefa usa envelopes HMAC e service binding; a rota interna não aceita uma requisição pública de usuário para iniciar apuração.

A apuração divide as fontes e a materialização em etapas com checkpoints, preservando o limite de 50 requisições externas por execução no plano Free. O consolidado não usa Cloud Functions, não ativa faturamento nem altera limites pagos. Fonte indisponível, identidade ambígua, paginação incompleta ou orçamento esgotado preservam o último lote completo. Repetir uma etapa concluída não relê suas fontes.

Todos os bancos de origem são lidos no mesmo `readTime`, o corte das 02h00. A recuperação fica limitada à janela histórica disponível no Firestore; o código nunca substitui uma leitura histórica recusada por dados atuais. Leituras fora da janela usual de uma hora exigem PITR já autorizado e disponível, que esta alteração não ativa.

FG fornece os deltas validados do Checklist conforme o dia da atividade e o horário de lançamento. FB e FC fornecem contribuições de concessões atuais reconciliadas com seus resumos e revisões no corte. A data do lançamento original determina a inclusão no período. Para treinamentos HTML, FB usa apenas tentativas e decisões do período. FE fornece concessões de participação por um endpoint restrito no Worker da própria FE. FI aplica a regra de atraso aos eventos de escala. Múltiplo zero equivale a −0,5. Múltiplos de 1 a 6 equivalem ao débito do múltiplo. Eventos cancelados ficam fora do cálculo.

O diretório de FD associa explicitamente o UID de FD ao UID de cada origem. A população de comparação vem dos perfis ativos e autorizados de FD no corte. O vínculo exige a identidade institucional comprovada em cada origem. O cliente consulta somente o consolidado de FD e carrega o histórico sob demanda.

## Configuração e publicação

As flags `SAHMT_PERFORMANCE_ENABLED` permanecem `false` nos dois Workers até a configuração ser validada. O projeto de FD é `rotinas-8a617`, na conta Cloudflare `434b7325287b58f36d214c9403819db2`. O compilador usa o segredo existente `INDICATOR_SERVICE_ACCOUNT_JSON`; nenhuma chave é incluída neste repositório ou no navegador.

Preparar um JSON privado com `members` e `fiPolicy`. Cada pessoa contém o `uid` de FD, `displayName`, `active`, `access` e `sourceUids` com os UIDs oficiais de FG, FI, FB, FC e FE. `fiPolicy` deve conter `rule` igual a `ATRASO_V1`, `effectiveFrom` igual a `2026-12-01T03:00:00.000Z` e `cutoffDay` igual a `2026-12-01`.

1. Conferir o diretório e as vigências com os registros institucionais. Validar que os perfis e as rotinas de pontuação das fontes estão ativos e consistentes.
2. Conferir o acesso mínimo do principal `indicator-compiler@rotinas-8a617.iam.gserviceaccount.com` aos recursos necessários. FD usa `users` para a população e as coleções privadas de consolidação. FG usa `users`, `fgPerformanceRuntime`, `fgPerformanceLedger` e `fgPerformanceSummaries`. FI usa `users` e `events`. FB usa `users`, `fbPerformanceRuntime`, `fbPerformanceReference`, `fbPerformanceAwards`, `fbPerformanceLedger`, `fbPerformanceSummaries` e `htmlTrainingStates`. FC usa `users`, `fcPerformanceRuntime`, `fcPerformanceReference`, `fcPerformanceAwards`, `fcPerformanceLedger` e `fcPerformanceSummaries`. O Worker de FE usa a própria credencial para ler os campos permitidos de `users`, `fePerformanceRuntime`, `fePerformanceAwards` e `fePerformanceSummaries`.
3. Executar `node scripts/configure-sahmt-performance.mjs --config=CAMINHO_PRIVADO.json` para validar sem escrita. O utilitário exige associações únicas e não imprime dados pessoais. Com a credencial administrativa de FD fornecida por ambiente, `--apply --enable` grava o diretório e a configuração; o histórico anterior fica privado em FD. A publicação é pausada durante a troca do diretório.
4. Executar os preflights de `scripts/deploy-fe-performance-relay.mjs` e `scripts/deploy-fd-fixed-sync.mjs --enable-performance`. Depois da conferência do diretório e das fontes, publicar o relay de FE com `--apply`. Publicar FD com `--apply --enable-performance`. O segundo comando exige prova de leitura autenticada do relay antes de alterar Workers ou crons. Os comandos preservam os bindings e segredos existentes e verificam o código publicado.
5. Publicar o frontend pelo processo existente do repositório. Verificar um ciclo real das 02h00 e sua referência de publicação antes de anunciar pontuações disponíveis.

O painel valida a sessão Google emitida para FD e o acesso ativo no perfil de FD. A administração manual exige privilégio administrativo de FD, revalidado na transação. O cliente usa somente a API do Worker para acessar as novas coleções.

## Estado desta entrega

O acionador antigo foi removido. A leitura posterior da API da Cloudflare retornou uma lista vazia. O segundo endereço fornecido, conta `679464db2379db8562b62ae982f30471`, foi confirmado como a conta de FB. O Worker `sahmt-fb-performance` está habilitado nela. O agendador pertence à conta de FD indicada acima.

Os preflights dos Workers FD e FE passaram. A produção de FD ainda precisa do documento `sahmtPerformanceRuntime/current` e do diretório `sahmtPerformanceMembers`. A auditoria somente de leitura em FD, FG, FI, FB, FC e FE confirmou vínculos para 55 dos 58 usuários elegíveis de FD. Três contas ativas precisam de comprovante institucional para associar os respectivos UIDs nas cinco origens. FG ainda precisa de um caminho de leitura autorizado. O principal de FD não tem binding em FG, e o principal do Worker FG tem somente get. O leitor paginado atual exige list. A alternativa de leitura dos IDs diários por batchGet permanece pendente de implementação e validação. O relay FE e o cron `0 5 * * *` estão preparados para publicação. A ativação do painel permanece pendente.

A revisão de autorização do navegador bloqueou a abertura da prévia local. A validação visual permanece pendente.
