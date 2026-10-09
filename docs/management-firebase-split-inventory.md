# Inventário para separar Gestão em um segundo Firebase

Levantamento de 8 de outubro de 2026, atualizado nesta continuação com conferências por API, captura Auth protegida e validações locais. A criação de FB, do banco e do app Web foi feita pelo usuário. Conferimos metadados, IAM, Auth, Rules e faturamento e fizemos uma avaliação de Cloud Monitoring; não lemos documentos Firestore nem Drive. O treinamento antigo permanece cancelado.

## Base e evidências

| Item | Evidência obtida | Limite da confirmação |
|---|---|---|
| Repositório | `https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io.git` | Remote Git conferido; disponibilidade do PWA publicado ainda precisa de evidência independente. |
| Checkout desta preparação | `C:\Users\SAHMTIA\.codex\worktrees\management-firebase-split\FIRESTORE` | Branch `codex/management-firebase-split`; checkout principal e drafts anteriores preservados. |
| Baseline | `a49d6f412079350fd46a3809fdc3b34a166ade44` | Commit local de `origin/main` obtido durante este levantamento. Não comprova publicação do PR #27 ou estado do dispositivo. |
| FA, projeto atual | `sahmt-17a16` confirmado no código e no Console Firebase; código usa banco `(default)` | Identificador presente em `.firebaserc`, `src/firebase-config.js`, `src/firebase-app.js` e `apps-script-v2/Config.gs`. Proprietário esperado, Auth Google, domínio, banco São Paulo e Rules publicadas conferidos por API; dados e produtores ativos ainda não reconciliados. |
| Conta conectada a FA | `anestesiahmtforms@gmail.com`, observada no Console nesta conversa | O principal esperado e seu papel de proprietário foram conferidos na política IAM por API; isso não comprova funcionamento da PWA. |
| FB, destino Gestão | Projeto **SAHMT Gestao**, ID `sahmt-gestao-5ae66`, criado pelo usuário; screenshot da lista de projetos mostra o ID | Propriedade IAM, acesso administrativo por nossas ferramentas e Google Auth foram conferidos por API; integração com a PWA ainda pendente. |
| Banco e Rules iniciais de FB | Screenshots mostram banco `(default)` criado, tela inicial vazia e aba Regras com `allow read, write: if false` | Rules publicadas também foram preservadas por API. A tela vazia não substitui captura completa de documentos; teste de negação por SDK e migração ainda pendentes. |
| Região de FB | `southamerica-east1` (São Paulo), aprovada nesta conversa e selecionada pelo usuário no assistente de criação | A região provisionada foi conferida por API. Não repetir criação do banco. |
| App Web de FB | App registrado pelo usuário; `appId` `1:613953519880:web:63b48dfa78ffd1f7ef6cbd`; `firebaseConfig` recebido como texto | Configuração completa reservada ao arquivo privado ignorado, sem reproduzi-la neste relatório. Registro do app não comprova autenticação ou uso da PWA em FB. |
| Plano financeiro | FA e FB Spark confirmados visualmente no Console nesta conversa | Faturamento desabilitado confirmado por API nos dois projetos; serviços pagos continuam fora do escopo autorizado. |
| Administração e Auth de FB | Conta indicada pelo usuário `anestesiahmtforms2@gmail.com` | Propriedade IAM, Google em Authentication e domínio conferidos por API; broker e login real ainda pendentes. |

O pedido preserva uma única entrada PWA, mantém Desempenho associado a FA e direciona Gestão, suas atividades e seus pontos a FB. O processo anterior de liberação foi cancelado. As permissões anteriores de homologação não autorizam novos acessos. O usuário autorizou continuar os passos necessários; dados e produção continuam sujeitos aos backups e validações do pedido. O desligamento dos produtores antigos depende da validação humana da migração.

## Estado implementado, local e ainda pendente

O baseline contém UI de Gestão por área, tarefas, documentos, indicadores, planos de ação e equipamentos. `src/main.js:2585` carrega o detalhe de uma área; `src/main.js:1221` monta a Avaliação dos Gestores. `src/performance-ui.js` já fornece consulta de avaliação, revisão, correção administrativa, proteção de rascunhos e distinção entre saldo confirmado e pendente. Essas partes podem ser adaptadas para o destino sem reconstruir a interface.

O commit de baseline restringe o cartão e a rota de Gestão a administradores na UI (`src/main.js:508`, `src/main.js:933`, `src/main.js:4263`). Isso não revogou as permissões granulares nas Security Rules. O PR #27 está no histórico Git local; publicação e efeito no PWA atual não foram conferidos neste levantamento.

Os bloqueios temporários de Gestão e Desempenho no roteador, o modelo simplificado de Forms, a exclusão de um item acidental e a guarda nativa de leituras existem como drafts no worktree anterior. Não fazem parte deste baseline e não devem ser apresentados como publicados. Precisam ser reconciliados explicitamente antes de reaproveitamento.

O catálogo de áreas tem 12 entradas (`src/management-seed.js`); sua existência não comprova uma implementação específica para cada área. Gestão Financeira continua apresentando placeholder de operações não configuradas (`src/main.js:966`). Documentação sobre cargas, quantidades, runtime e homologação contém evidências históricas; este inventário não comprova dados atuais ou funcionamento com participante real.

## Ferramentas locais preparadas neste trabalho

| Arquivo | Resultado preparado | Estado e limite |
|---|---|---|
| `scripts/lib/management-split-plan.js` | Valida snapshot/manifesto privados, hashes, classificação explícita, identidade preservada e plano determinístico de cópia com proveniência. | Planejador offline. Não exporta Firestore, não cria backup real e não executa migração. Preserva IDs/UIDs; remapeamento exige outro adaptador revisado. |
| `scripts/management-split-plan.mjs` | Gera o dry-run a partir de arquivos fornecidos, salva em `.local-preview` ignorado pelo Git e impede sobrescrever revisão anterior. | Entrada local por arquivos; não obtém credenciais e não conecta a Firebase. Plano não autoriza produção. |
| `scripts/lib/management-auth-import-plan.js` | Prepara criação Auth apenas para UIDs ausentes, detecta colisões UID/Google/e-mail e omite claims, senha e tokens. Preserva `disabled`. | Prévia local de `importUsers`; nunca propõe sobrescrever usuário existente. Não importa contas. Importação real exige destino fresco, exclusão de criação concorrente e gates de produção; a autorização geral já foi recebida. |
| `src/performance-consolidation.js` | Reconcilia datasets de awards/ledger FA+FB, associa membro estável, usa sidecars para cópia, preserva correções e suprime totais diante de ausência/divergência. | Função pura, sem leitor Firebase ou integração com UI publicada. Não concede pontos nem altera Desempenho atual. |
| `tests/management-split-plan.test.js`, `tests/management-split-cli.test.js`, `tests/management-auth-import-plan.test.js`, `tests/performance-consolidation.test.js` | Fixtures e validações locais das preparações acima. | Testes locais não comprovam backup de documentos, login produtivo da PWA, migração/corte, Safari/iPhone ou publicação. Acesso administrativo a FB foi conferido separadamente por API. |
| `docs/management-firebase-split-auth.md` | Opções e limites de sessão/identidade entre dois projetos a partir de documentação Firebase. | Contrato de preparação; login único, sessão FB e revogação ainda precisam implementação e validação reais. |
| Capturas e guardas de backup | Metadados/Rules/Auth/índices preservados; captura de documentos protegida com reserva, pausa, checkpoints e limites. | Backup de documentos não executado: medição sem atualização suficiente mantém a pausa. |
| Núcleo de broker e coordenador de sessão | Verificação de identidade, revogação, prazos, recibos de leitura e limpeza de respostas tardias preparados por adaptadores injetados. | Hospedagem, IAM, transporte, Rules e integração com SDK permanecem pendentes; módulos desligados. |
| Núcleo de migração | Criação atômica de dados e proveniência, checkpoints, contexto fresco, margem de leituras e reexecução equivalente. | Sem transporte real ou execução produtiva. Ver contrato do executor. |
| Planner de revisão de gestor | Dois pontos de Governança uma vez por material e versão, sem crédito duplicado. | Decisões elegíveis, validação independente/backend e integração do ledger/Forms pendentes. Não concede pontos. |

Estas preparações locais não mudaram o roteamento de dados do PWA, as Rules publicadas, a ACL do Drive ou os consumidores antigos. FB, seu banco e app Web foram criados pelo usuário conforme as evidências acima. Backup de documentos, reconciliação de identidades, integração, migração e publicação permanecem pendentes; nenhum acesso da PWA a FB foi demonstrado.

## Matriz de dados e destino proposto

As ações abaixo são classificações para preparar o plano de migração. Não autorizam copiar ou modificar produção. **Reter** significa conservar a fonte original em FA para auditoria e reversão. **Copiar** exige snapshot verificável e confirmação de vínculos. **Reconstruir** indica que o dado é uma projeção derivada; não deve adquirir confirmação apenas por ter sido copiado. **Projeção** indica espelho mínimo com fonte, versão e política de revogação próprias.

| Dados | Papel identificado | Ação proposta | Dependências e corte seguro |
|---|---|---|---|
| `managementAreas` | Catálogo e vínculos de gestores/membros | Reter FA; copiar para FB | Preservar IDs, versões, autoria e arrays de UIDs. Projetar audiência mínima em FA se os avisos continuarem usando áreas. |
| `activities`, `activityInteractions`, `activityScoreReviews` | Tarefas, comentários, conclusão/cancelamento e revisão independente de pontos | Reter FA; copiar para FB | Copiar relações por `activityId`; recibos determinísticos `completion-`/`cancellation-` e estado pendente devem acompanhar a tarefa. Não transformar claim em crédito. |
| `scoringRules/management-task-completion-v1` | Regra administrativa de tarefa | Reter FA; copiar para FB | Regra/versionamento referenciados por tarefas e revisões históricas. Outras regras precisam de classificação pelo uso. |
| `indicators`, `indicatorMeasurements` | Indicadores e medições por área | Reter FA; copiar para FB | Preservar relação `indicatorId`, período e autoria. |
| `actionPlans`, `actionPlanItems` | Planos e itens por área | Reter FA; copiar para FB | Preservar `planId`, responsáveis, estados e timestamps. |
| `documents`, `scopedDocuments` | Referências de materiais de Gestão e público geral/restrito | Reter FA; copiar registros de Gestão para FB | Preservar ID, área, `audienceGroup`, versão e referência Drive. Isso não transfere arquivos nem muda ACL do Drive. |
| `documentAccessEmails` | Público autorizado para documentos e Forms | Reter FA; projetar autorização necessária em FB | Hoje a chave é e-mail verificado Google. Não usar essa chave como identidade histórica de membro. Sincronização/revogação precisa de fonte confiável. |
| `equipment`, `equipmentEvents`, `maintenanceRecords` | Gestão de equipamentos e manutenção | Reter FA; copiar para FB | Preservar relação `equipmentId`, eventos, versões e histórico. Não confundir com datas de manutenção guardadas nos `stations` do Checklist. |
| `evaluationActivities`, `evaluationFormConfigs`, `evaluationLinks` | Projeção pública de Forms, configuração privada e vínculos de origem | Reter FA; copiar conjunto relacionado à Gestão para FB | Configuração privada contém mapeamento/grade/snapshots; nunca distribuir ao navegador. Resolver todos os vínculos antes de classificar Forms compartilhados. |
| `evaluationParticipations` | Participação e revisão de sugestão | Reter FA; copiar conforme atividade/classificação | Preservar response/form IDs, identidade, fingerprints, histórico e estado. Não reprocessar para fabricar novas respostas ou créditos. |
| `evaluationAssignments`, `evaluationAssignmentHistory`, `evaluationGovernanceRevisions` | Designação atual, histórico e revisões de material/questões | Reter FA; copiar para FB | Preservar designação histórica e beneficiário; mudança de gestor não transfere créditos antigos. |
| `evaluationRequests` | Pedidos imutáveis ao processador | Reter FA; classificar por tipo, atividade e categoria antes de copiar | `CORRECT_SCORE` pode se referir a Checklist FA ou a crédito Gestão. Não executar novamente pedidos concluídos, nem enviar pedidos pendentes a dois consumidores. |
| `evaluationAwards`, `evaluationLedger` | Créditos correntes e diferenças auditáveis, com origens Forms e Checklist | Reter FA; copiar somente créditos Gestão para FB | `PERFORMANCE` inclui Forms e Checklist. Categoria sozinha não define destino. Preservar identidade global, IDs/versionamento e origem; marcar cópia para deduplicação. |
| `evaluationSummaries`, `evaluationReference`, `evaluationRuntime` | Projeções de saldo, referência da equipe e controle por categoria | Reter histórico FA; reconstruir projeções de destino e consolidação | Não copiar estado `CONFIRMED` ou ativação como autorização. Reunir créditos únicos por membro antes de calcular máximo global e percentual. |
| `evaluationChecklistTransfers` | Par de débito/crédito da obrigação diária Checklist | Reter e operar em FA | Não mover o produtor Checklist junto de um módulo de ledger compartilhado. Referência de Desempenho deve incluir esses créditos uma única vez. |
| `scores` | Ledger legado com pontos de Checklist, cursos e tarefas Gestão | Reter FA; classificar/copiar lançamentos Gestão por origem | Tarefa usa `sourceType: MANAGEMENT_TASK_COMPLETION`. Confirmar vínculo/source ID e colisões; nome da coleção não define destino. A avaliação atual não lê esse ledger. |
| `trainings`, `trainingProgress`, `trainingReceipts`, `trainingCompletions` | Cursos de vídeo anteriores, progresso e claims | Reter FA até classificação por documento | Não migrar só porque a UI os apresenta em Desempenho. Não reiniciar validadores/cursos cancelados. |
| `learningActivities`, `learningActivityReceipts` | Tópicos/ciência; também origem de descoberta de Forms | Reter FA; classificar por atividade e vínculos antes de copiar | Evitar coleção inteira no destino por conveniência; manter coerência com Forms e créditos relacionados. |
| `users`, `roles`, `accessRequests` | Identidade, perfil e aprovação de acesso | Autoridade inicial em FA; projeção mínima de permissão em FB | Preservar UID quando suportado ou mapear FA UID ↔ FB UID ↔ membro estável. Cópia pontual de permissão não resolve revogações futuras. |
| `contacts`, `eventMembers`, `appConfig`, `appConfig/labelStaff` | Cadastro operacional, siglas e configuração do PWA | Reter FA | Não usar nomes ou e-mails como chave histórica. Projetar em FB somente campos indispensáveis e autorizados. |
| `scheduleDays`, `vacations`, `events`/`history`, `labels`/`history`, `stations`, `checklists`, `checklistSignatures`, `checklistSignatureRequests`, `checklistResponsibilities` | Operacional e Checklist | Reter FA | Os respectivos produtores e consumidores devem continuar apontando a FA. |
| `notifications`, `notificationGroups`, `users/{uid}/notificationReads` | Avisos e recibos | Reter FA; projetar vínculos de audiência quando necessário | `src/data.js:198` usa `managementAreas` para o público de avisos; mudança de fonte precisa de adaptação própria. |
| `auditLogs`, `syncQueue` | Auditoria compartilhada e fila legada de relatórios | Reter FA; classificar por recurso/origem | A fila legada não comprova produtor ativo. Auditoria pode abranger recursos dos dois projetos. |
| Google Forms, materiais e pastas Drive | Arquivos externos ao Firebase | Preservar referências/propriedade; inventariar ACL separadamente | Criar FB não transfere arquivo, resposta, gatilho nativo nem permissão Google. |

## Leitores, escritores e processos a adaptar

| Origem | Comportamento existente | Adaptação necessária |
|---|---|---|
| PWA `src/data.js:3` | Todas as operações de Gestão importam o mesmo `db` FA; há transações para tarefa, documento, equipamento e revisão. | Direcionar apenas operações Gestão a FB e revisar cada transação para que todas suas referências usem o mesmo projeto. |
| PWA `src/evaluation-data.js:3`, `:59`, `:143` | Consulta um único projeto e cria pedidos; não cria créditos confiáveis. | Serviços por fonte para Gestão/Desempenho, identidade mapeada e estado completo/parcial. |
| `ManagementScoreValidation.gs:74` | Revalida atividade, conclusão, perfil e área; `:118` grava score final; `:157` usa ID determinístico atividade+UID. | Destino FB por consumidor, contexto de permissões confiável e garantia de um único produtor após corte. |
| `FormsEvaluation.gs:191`, `:473`, `:716` | Descobre links de `managementAreas`, `documents`, `learningActivities`, `scopedDocuments`; configura atividade/designação. | Classificar fontes/vínculos e usar destino explícito. Não trocar indiscriminadamente origem de todo o Apps Script. |
| `FormsEvaluation.gs:857`, `:1076`, `:1115`, `:1120`, `:1138` | Processa respostas/pedidos, submit nativo, ACL e reconciliação. | Preservar IDs de resposta e idempotência; validar autoria/OAuth/ACL e mudar consumidor somente no corte aprovado. |
| `FormsEvaluation.gs:1185` | Instala gatilhos nativos Forms e periódicos. | Não executar durante preparação. Instalação ou troca exige função/destino específicos prontos e autorização de produção. |
| `EvaluationLedger.gs:197`, `:252`, `:295` | Grava awards/ledger, mantém transferências Checklist e publica resumos. | Manter Checklist em FA; isolar produção Gestão em FB; consolidação precisa deduplicar antes de recalcular referência global. |
| `apps-script-v2/Config.gs:2`, `:90` | Projeto global e adaptador REST compartilhados por Gestão, Checklist, escala e relatórios. | Introduzir configuração por domínio/consumidor; trocar `projectId` global desviaria operações FA. |
| `SparkReportSync.gs`, `Config.gs:36` | Varredura de relatório reúne recursos operacionais, Gestão e scores. | Cursor/chave de sync com projeto de origem e fonte explícitos. Sheets continua destino secundário. |
| `functions/index.js:433`, `:526`, `:613`–`:620` | Callables antigas Gestão e triggers de relatórios permanecem no repositório. | Conferir existência/implantação antes do corte. Código local não comprova consumidor ativo; novas Functions pagas não foram autorizadas. |

As Rules (`firestore.rules:109`–`:122`, `:1328`–`:1358`) mantêm ledger final sem escrita do cliente; os pedidos são imutáveis e revalidados pelo backend. Conservar essa fronteira em FB. As regras consultam perfis do próprio banco: não podem tratar um login FA como autorização automática para FB nem consultar perfis de outro projeto como se fossem locais.

## Identidade, ACL e dados locais

1. Confirmar comportamento suportado de Auth entre aplicativos Firebase usando documentação oficial atual; definir sessão FB, logout das duas sessões e revogação. O token Firebase de FA não é autorização direta de FB. A validação iPhone/Safari continua pendente até ensaio real.
2. Definir identidade auditável de membro. IDs determinísticos de crédito incorporam UID (`EvaluationLedger.gs:20` e `ManagementScoreValidation.gs:157`); alterar UID e reprocessar pode gerar outro crédito. Preservar ou mapear explicitamente antes de copiar.
3. Espelhar apenas permissões efetivas necessárias à Gestão, com fonte/versionamento, validade e mecanismo de revogação seguro. Não restaurar permissões canceladas de homologação. Rules FB devem negar usuários sem aprovação vigente, mesmo que a UI esteja acessível.
4. `documentAccessEmails` usa conta Google verificada para grupo geral/restrito. Preservar elegibilidade aprovada separadamente da ACL externa. Mudança da pasta Drive não autoriza alterar público no app.
5. Cache/outbox atuais são isolados por UID, sem projeto (`src/outbox.js:95`). `activities` participa do replay operacional (`src/record-write.js:1`, `src/outbox.js:6`). Novas operações precisam registrar projeto e época de corte; pendências FA existentes devem conservar seu destino. Não limpar pendências como forma de resolver migração.

## Pontuação e consolidação

O código de base implementa Ciência afirmativa de 1 ponto (`FormsEvaluation.gs:899`), Sugestão aprovada de 2 para o participante (`:932`), nota corrigida pela API Forms (`:900`) e MATERIAL 1 / QUESTIONS 1 em GOVERNANCE (`:1033`). Os dois componentes somam 2 e governança fica separada do percentual da equipe. Há correções administrativas versionadas e pares auditáveis de Checklist.

O pedido de 2 pontos ao gestor por revisão não está implementado no código inventariado. `REVIEW_SUGGESTION` credita o participante; `EvaluationLedger.gs:31` admite somente MATERIAL/QUESTIONS em GOVERNANCE. Esse requisito exige regra/modalidade própria, gatilho de negócio e idempotência definidos antes de qualquer execução. Não tratar migração como motivo para conceder créditos retroativos automaticamente.

`src/evaluation-data.js:1` declara que avaliação não lê `scores` legado. Definir quais créditos legados devem compor Desempenho faz parte da reconciliação: somar `scores` a awards sem classificar origem pode contar a mesma atividade duas vezes.

`src/performance-ui.js:61` exige awards consistentes com saldo/revisão confirmados. `EvaluationLedger.gs:295` deriva referência do conjunto de membros e awards. A consolidação FA+FB deve reconhecer cópia migrada pela identidade única de atividade/crédito, preservar diferenças e correções e reunir saldos por membro antes de calcular o máximo global. Somar percentuais ou máximos separados não produz referência correta. Se uma fonte falhar, apresentar origem indisponível e total parcial; nunca confirmar saldo global com fonte faltante.

## Backup e reversão necessários

Ainda não há executor conectado a produção nem captura completa verificável de documentos Gestão. Os novos planejadores offline preparam o plano a partir de snapshots fornecidos; não capturam dados nem tornam um arquivo em backup produtivo verificado. Há documentação de export/hash/idempotência (`docs/FIRESTORE_SCHEMA.md`), replay restrito ao emulador (`scripts/evaluation-homologation.js`) e helpers privados de snapshots parciais de catálogo e fonte Apps Script. `check-production.mjs --catalog-only` não cobre tarefas, históricos e ledger; não é backup da migração.

Antes de dados ou produção, preparar um pacote privado com seleção explícita de entidades, documentos e subcoleções; paginação comprovada; valores Firestore preservados sem conversão destrutiva; hash por arquivo/documento e manifesto; contagens, relações, origem, horário de captura e versão do código. Backup de Rules/configuração e fonte Apps Script devem registrar hashes e permitir detectar mudança concorrente. Ausências e limites excedidos precisam interromper, sem produzir snapshot parcial como completo.

O dry-run deve gerar plano determinístico com origem, ID original, destino, identidade de membro, hash e resultado previsto. A execução precisa precondições de criação/versão, auditoria por unidade e retomada idempotente. Comparar contagens, relações e amostras sem imprimir perfis, respostas, gabaritos ou documentos privados. Manter fonte FA e evitar sobrescrever destino divergente.

Rollback deve restaurar roteamento e produtores apenas na época aprovada, registrar estado das gravações novas FB e reconciliar essas gravações antes de reabrir FA. Reverter a UI isoladamente após novas escritas em FB não garante reversão dos dados. O corte inicial deve parar escritas antigas de Gestão somente depois da validação da migração pelo usuário; dados antigos permanecem retidos.

## Gates de preparação e produção

- Conferência de metadados FA/FB concluída por API: IAM de proprietário, Auth Google/domínio, Rules e banco `(default)` em `southamerica-east1` (São Paulo), com faturamento desabilitado. Reavaliar contexto antes de escritas; o preflight não cobre dados nem produtores ativos.
- Resolver Auth, identidade e ACL/revogação antes de autorizar qualquer usuário FB. Ensaiar login/logout, Safari/iPhone e falhas de sessão.
- Preparar backup verificável e prova de leitura limitada antes de capturar dados. A política histórica de leituras FA permanece aplicável; renovação diária não libera a pausa. Não reutilizar o processo cancelado nem consultar métricas em loop.
- Validar migração no emulador/fixtures: rerun, colisão, referências ausentes, timestamp/tipo, resposta repetida, usuário sem acesso e revogação. Rotas bloqueadas não substituem Rules.
- Validar consolidação com cópia FA/FB da mesma atividade, correção, origem Checklist, fonte indisponível e categoria governança separada.
- Mostrar implementação, plano, provas de backup, pendências reais e rollback ao usuário. A autorização geral de continuação já foi recebida; preparar o resultado revisável e cumprir os gates de dados, segurança e validação humana antes do corte.
- Só depois da validação humana da migração interromper escritores antigos de Gestão FA. Não apagar estrutura/dados nem reinstalar o rollout anterior.

## Limites deste inventário

O preflight por API comprova os metadados descritos neste inventário e as capturas Auth comprovaram 60 contas FA e zero FB naquele percurso. Não demonstram quantidade/consistência de documentos, produtores e gatilhos ativos, sessão da PWA, migração, publicação, respostas reais ou comportamento em iPhone. A captura de documentos permanece pausada porque a última métrica obtida está desatualizada. Direitos, vínculos e ACL efetivos precisam ser reconciliados com contexto fresco antes de qualquer escrita.


## Provas e componentes acrescentados na continuação

O preflight de metadados confirmou por API ambos os projetos, região São Paulo, contas proprietárias, Google Auth/domínio e faturamento desabilitado. Rules atuais foram preservadas em arquivo privado com hashes. Auth foi capturado criptografado com round-trip (FA 60 contas, FB zero), ainda sem mapa de membro nem consistência com Firestore. Capturador de árvores e guarda de leitura estão implementados, porém backup de documentos está bloqueado por métrica desatualizada e não foi executado. O coordenador de duas sessões está desligado sem consumidor UI. Consulte a continuação do runbook para provas e limites; os registros antigos acima descrevem o estado anterior a esta verificação.

Na continuação de 8/10, às 20h59, uma avaliação única adicional confirmou apenas a mesma métrica antiga: fresh:false, mantendo a pausa. Adaptadores browser e HTTP foram preparados em isolamento, com prazos/cancelamento e guarda anterior ao SDK. Rules específicas de entrada do destino passaram 12 testes no emulador, mantendo todos os recursos de negócio fechados. Hospedagem e identidade privilegiada, escrituras de projeção, dados completos e validação real continuam pendentes; consulte os contratos vinculados no runbook.
