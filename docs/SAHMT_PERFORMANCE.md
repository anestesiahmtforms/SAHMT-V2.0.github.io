# Desempenho SAHMT

O painel fica em Governança → Indicadores → **DESEMPENHO - SAHMT**. O cabeçalho e a identificação usam o contêiner existente. Cada pessoa consulta seu próprio saldo e histórico; o maior total da equipe serve de referência sem identificar outra pessoa.

As seis categorias são Operacionais (FG/FI), Treinamentos e Gestão (FB), Registros (FC), Enquetes (FE), Notificações e Educação Continuada. As duas últimas recebem entradas administrativas. Correções mantêm o lançamento original e acrescentam uma diferença auditável. O saldo confirmado só muda na apuração diária, inclusive para lançamentos manuais.

O percentual é `total pessoal / maior total elegível × 100`. Débitos e percentuais negativos são preservados. Sem maior total positivo, a comparação é indisponível. Os períodos originais de ativação são mantidos, registrados no lote e explicados no painel.

## Rotina diária

O cron privado é `0 5 * * *`, equivalente a 02h00 em America/Sao_Paulo. Substitui as agendas antigas de 00h00 e 12h00. A tarefa usa envelopes HMAC e service binding; a rota interna não aceita uma requisição pública de usuário para iniciar apuração.

A apuração divide as fontes e a materialização em etapas com checkpoints, preservando o limite de 50 requisições externas por execução no plano Free. O consolidado não usa Cloud Functions, não ativa faturamento nem altera limites pagos. Fonte indisponível, identidade ambígua, paginação incompleta ou orçamento esgotado preservam o último lote completo. Repetir uma etapa concluída não relê suas fontes.

Todos os bancos de origem são lidos no mesmo `readTime`, o corte das 02h00. A recuperação fica limitada à janela histórica disponível no Firestore; o código nunca substitui uma leitura histórica recusada por dados atuais. Leituras fora da janela usual de uma hora exigem PITR já autorizado e disponível, que esta alteração não ativa.

FG fornece os deltas validados do Checklist. FB e FC fornecem contribuições de concessões atuais reconciliadas com seus resumos/revisões, congeladas no corte; seus ledgers projetados mutáveis não são somados novamente. FE fornece concessões de participação, sem respostas anônimas. FI reutiliza a regra existente de atraso: múltiplo zero equivale a −0,5; múltiplos de 1 a 6 equivalem ao débito do múltiplo. Eventos cancelados não pontuam. A regra só funciona após configurar explicitamente sua vigência; não há nova pontuação inventada.

O diretório de FD associa explicitamente o UID de FA ao UID de cada origem. A igualdade de nomes, e-mails ou UIDs não cria vínculos automaticamente. A população de comparação vem dos perfis ativos/autorizados de FA no corte; identidades sem associação são pendências. O cliente não consulta os bancos de origem nem instala listeners de pontuação.

## Configuração e publicação

As flags `SAHMT_PERFORMANCE_ENABLED` permanecem `false` nos dois Workers até a configuração ser validada. O projeto de FD é `rotinas-8a617`, na conta Cloudflare `434b7325287b58f36d214c9403819db2`. O compilador usa o segredo existente `INDICATOR_SERVICE_ACCOUNT_JSON`; nenhuma chave é incluída neste repositório ou no navegador.

Preparar um JSON privado com `members` e `fiPolicy`. Cada pessoa contém `uid`, `displayName`, `active`, `access` e `sourceUids` com os UIDs oficiais de FG, FI, FB, FC e FE. `fiPolicy` contém `rule: "ATRASO_V1"`, `effectiveFrom` em ISO e `cutoffDay` no formato `YYYY-MM-DD`, preservando a vigência institucional existente. Não estimar essas identidades ou datas.

1. Conferir o diretório e as vigências com os registros institucionais. Validar que os perfis e as rotinas de pontuação das fontes estão ativos e consistentes.
2. Conferir o acesso mínimo do principal `indicator-compiler@rotinas-8a617.iam.gserviceaccount.com` aos recursos necessários. Esta alteração não concede privilégios IAM automaticamente. FA exige `users`; FG exige `users`, `fgPerformanceRuntime`, `fgPerformanceLedger`, `fgPerformanceSummaries`; FI exige `users`, `events`; FB exige `users`, `fbPerformanceRuntime`, `fbPerformanceReference`, `fbPerformanceAwards`, `fbPerformanceSummaries`; FC exige `users`, `fcPerformanceRuntime`, `fcPerformanceReference`, `fcPerformanceAwards`, `fcPerformanceSummaries`; FE exige `users`, `fePerformanceRuntime`, `fePerformanceAwards`, `fePerformanceSummaries`.
3. Executar `node scripts/configure-sahmt-performance.mjs --config=CAMINHO_PRIVADO.json` para validar sem escrita. O utilitário exige associações únicas e não imprime dados pessoais. Com a credencial administrativa de FD fornecida por ambiente, `--apply --enable` grava o diretório e a configuração; o histórico anterior fica privado em FD. A publicação é pausada durante a troca do diretório.
4. Executar o preflight de `scripts/deploy-fd-fixed-sync.mjs`. Somente após a conferência das fontes, executar com `--apply --enable-performance`. O utilitário preserva os bindings/segredos existentes, mantém o agendador sem URL pública e verifica o cron e o código publicados.
5. Publicar o frontend pelo processo existente do repositório. Verificar um ciclo real das 02h00 e sua referência de publicação antes de anunciar pontuações disponíveis.

O endpoint do usuário mantém as permissões normais de autenticação Google, identidade verificada e acesso ativo em FA e FD. Administração manual exige administração nos dois perfis, revalidada na transação de FD. As novas coleções de FD continuam cobertas pela negativa global das Rules existentes; nenhum acesso direto de cliente é liberado.

## Estado desta entrega

O acionador antigo foi removido. A leitura posterior da API da Cloudflare retornou uma lista vazia. O segundo endereço fornecido, conta `679464db2379db8562b62ae982f30471`, foi confirmado como a conta de FB. O Worker `sahmt-fb-performance` está habilitado nela. O agendador pertence à conta de FD indicada acima.

A verificação de implantação reconheceu a conta FD e compilou a configuração do cron `0 5 * * *`. A ativação permanece pendente. A leitura de produção de FD confirmou que faltam o documento `sahmtPerformanceRuntime/current` e o diretório `sahmtPerformanceMembers`. Em FE, a credencial de FD tem apenas `datastore.entities.get`, enquanto a consulta paginada de concessões requer `datastore.entities.list` ou um fluxo de exportação de pontuações próprio de FE. A auditoria foi somente de leitura.

A revisão de autorização do navegador bloqueou a abertura da prévia local. A validação visual permanece pendente.
