# Treinamentos HTML em FB

> Executar com superpowers:subagent-driven-development. Continuação expressamente autorizada pelo usuário; as regras funcionais já foram aprovadas na conversa. Branch local codex/treinamentos-html-fb preserva o trabalho de retirada do leitor.

**Goal:** integrar catálogo, leitura, duas tentativas, ciência, avaliação, sugestões, edição e auditoria ROP ao PWA FB, com dados no Firestore e resultados em Desempenho, sem Apps Script.

**Spec:** `docs/treinamentos-html-regras-aprovadas-2026-10-25.md`.

**Architecture:** serviço Worker independente com Firebase Auth FB e acesso OAuth de serviço ao Firestore FB. Nenhuma chave no navegador. Conteúdo em blocos por versão, banco/gabarito privados, transações para tentativas/concessões/publicação. Frontend carrega sob demanda e mantém cache por conta/versão. Desempenho soma uma projeção própria, sem alterar ledger histórico. Editor e auditorias usam autorização atual por item. Referência PWA→Drive usa fila persistente e indica estado real de sincronização.

**Choices:** reutilizar Apps Script contraria a decisão do usuário. Gravar avaliações somente no cliente expõe o gabarito e não controla concorrência. O serviço separado conserva o PWA estático e permite validação no servidor. A hospedagem seguirá a conta existente; não contratar plano pago ou criar conta provisória.

## Restrições

- FB = sahmt-gestao-5ae66. Não alterar autenticação ou dados de outras instâncias.
- Não publicar conteúdos, imagens, bancos ou gabaritos privados no GitHub.
- Cada item tem até duas tentativas, sem reinício automático em novas versões. A contagem ocorre somente no envio final confirmado; revisões futuras não autorizam tentativas adicionais.
- Maior nota, ciência única de 1 ponto, sugestão manual única de 0 a 2; correção administrativa substitui a mesma concessão.
- Leitura da segunda tentativa repete todas as etapas; não alegar comprovação cognitiva da leitura.
- Gestor publica somente seu item; apenas administrador altera designação. Gestor não pontua sua própria sugestão.
- Fonte com pendência institucional explícita entra como rascunho para revisão, sem alegar aprovação clínica.
- Captura de tela do sistema não pode ser impedida por PWA. Proteção de cópia/print restrita ao leitor; editor e respostas conservam edição/acessibilidade.
- Publicação real depende de credenciais Firebase/Cloudflare e acesso dos Docs ao serviço; não fingir implantação/sincronização.

## Contrato compartilhado

Serviço: `createHtmlTrainingService({store, now=Date.now, uuid})`; `store.get(collection,id)`, `store.list(collection,filters,limit)`, `store.transaction(fn)`; tx tem `get`, `set`, `create`, `delete`. Todos os métodos assíncronos; tx acumula gravações até o final. Filtros são arrays `{field,op:'EQUAL'|'ARRAY_CONTAINS',value}`. `set` substitui documento inteiro. `create` exige ausência. Dados JSON sem timestamps especiais; milissegundos numéricos.

`service.execute(action,input,identity)` recebe identidade verificada `{uid,email,emailVerified:true,provider:'google.com'}`. Retorna JSON. Erros têm `code` seguro e `status` HTTP. Identidade e autorização `users/{uid}` revalidadas em cada operação; público em `documentAccessEmails/{email}`.

Coleções: `htmlTrainings` (metadados), `htmlTrainingVersions` (banco/schema privados, id `${trainingId}_v${version}`), `htmlTrainingContent` (blocos, id `${trainingId}_v${version}_p${n}`), `htmlTrainingStates` (até duas tentativas e execução atual, id `${trainingId}_${uid}`), `htmlTrainingScores/{uid}` (projeção total própria), `htmlTrainingAudits` (rascunho/conclusão por id), `htmlTrainingSync` (fila Drive). Todas negadas a escrita direta do cliente; API verifica papéis e grupos.

Ações HTTP POST `/v1/training` com corpo `{action,input}` e Bearer Firebase FB:

- `LIST {}` → `{trainings:[metadata]}`.
- `OPEN {trainingId}` → `{training,questions:[{id,stem,options:[{id,text}],points}],state}` sem gabarito; `state` privado do próprio participante.
- `CONTENT {trainingId,version}` → `{sections:[{id,title,html}],revision}`; cache por uid/item/version, autorização OPEN atual antes de reutilizar.
- `BEGIN {trainingId,requestId}` → `{state}`. Retoma execução incompleta, cria nova somente após conclusão, não consome tentativa.
- `READ {trainingId,runId,index}` → `{state}`; index zero baseado e sequencial.
- `ACK {trainingId,runId,accepted:true}` → `{state}`.
- `QUIZ {trainingId,runId,answers:{questionId:optionId}}` → `{state}`; exige leitura/ciência, valida cinco respostas e abre sugestões sem revelar nota.
- `SUBMIT {trainingId,runId,requestId,suggestion:string}` → `{state,score}`; transação/idempotência; apenas aqui conta tentativa.
- `EDIT {trainingId}` → `{training,bank,sections,auditSchema,suggestions:[{uid,attempts,suggestionDecision}]}`; só gestor responsável/admin.
- `PUBLISH {trainingId,expectedVersion,training:{title,category,subcategory,audienceGroup,managerUid,status,source},sections,bank,selectedQuestionIds,auditSchema}` → `{training}`. Cinco IDs únicos, banco completo preservado; editor manager não troca managerUid.
- `REVIEW {trainingId,uid,expectedVersion,points,note}` → `{state,score}`. Primeira decisão manual; só admin pode corrigir decisão existente; sem duplicação.
- `AUDIT_LIST {trainingId}` → `{audits}`.
- `AUDIT_SAVE {trainingId,id,expectedVersion,draft,complete:false|true}` → `{audit}`; id criado no cliente UUID, conclusão validada por `src/domain/rop-audit.js`, conclusões imutáveis.

Metadados mínimos: `{id,title,category,subcategory,audienceGroup:'GENERAL'|'RESTRICTED',managerUid,status:'DRAFT'|'PUBLISHED',version,sectionCount,selectedQuestionIds,maxScore,source,updatedAt}`. `source` contém IDs Google Docs texto/banco/auditoria e pasta oficial. `bank` questões `{id,stem,options:[{id,text}],correctOptionId,points,comment?}`. `sections` armazenam HTML apenas do corpo, com imagens embutidas data:image e sem navegação de prévia. `state` contém `{uid,trainingId,attempts:[...],bestScore,ackPoints,suggestionDecision,version,run:{id,trainingVersion,readCount,stage:'READING'|'ACK'|'QUIZ'|'SUGGESTIONS'|'COMPLETED',answers?}}`. `score` `{uid,acknowledgement,test,suggestion,total,version}`.

## Tasks

- [ ] 1. Domínio transacional e testes de concorrência, autorização, versões, tentativas, pontuação e auditorias. Arquivos `worker-training/service.js`, `tests/html-training-service.test.js`; adaptador de store em memória apenas nos testes.
- [ ] 2. Catálogo/leitor/editor/auditoria no frontend, cache protegido e testes de browser. Arquivos `src/html-training-*.js/css`, testes correspondentes. Montagem `mountHtmlTrainings(root,{user,profile,api})`; API padrão importa Firebase auth sob demanda, usa `VITE_HTML_TRAINING_ENDPOINT`, valida projeto FB. Retorna cleanup síncrono. Não alterar main/performance; integração pelo agente principal.
- [ ] 3. Importador privado das quatro pastas já auditadas, com manifesto, hashes, imagens incorporadas, questões e ligações explícitas; diagnóstico de pendências. `scripts/prepare-html-trainings.mjs`, testes de conversão; saída somente `.local-preview/html-training-import/`, sem escrita remota nesta tarefa.
- [ ] 4. Runtime Worker, OAuth/REST transacional, identidade Firebase FB verificada, regras, testes HTTP. Integração main e Desempenho. Fila PWA→Drive explícita; sync somente com autenticação/autorização e verificação de revisão, sem Apps Script.
- [ ] 5. Conferência de browser desktop/mobile, testes de regras/domínio/HTTP, builds FA/FB, revisão independente e pacote concreto de implantação/importação.
- [ ] 6. Aplicar implantação e importar com as contas reais quando disponíveis. Retirar código/acionadores remotos antigos sem atingir Desempenho. Ler novamente versões do Drive antes de ativação. Registrar precisamente qualquer dependência de login/permissões que permaneça.

## Review focus

Idempotência após timeout e dois aparelhos; revogação durante transação; conteúdo com tags/URLs maliciosas; isolamento de contas no cache; manager tentando modificar outro item/designação; revisão sem ganhar tentativas extras; nota/ciência/sugestão não duplicadas nem alterando pontos históricos; auditoria não concede pontos; origem Docs conflitante não sobrescrita silenciosamente.
