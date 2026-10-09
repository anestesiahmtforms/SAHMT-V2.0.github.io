# Separação de Gestão: preparação e execução controlada

Preparação de 8 de outubro de 2026. O reinício solicitado refere-se à separação de Gestão entre dois projetos Firebase. O processo de liberação de treinamentos continua cancelado; seus checkpoints e drafts foram preservados.

## Estado atual

| Item | Estado comprovado | Próxima dependência |
| --- | --- | --- |
| Código de referência | `origin/main` em `a49d6f412079350fd46a3809fdc3b34a166ade44` | Conferir publicação atual separadamente; o commit não prova deployment. |
| Preparação isolada | Worktree `management-firebase-split/FIRESTORE`, branch `codex/management-firebase-split` | Revisar os arquivos locais antes de publicar. |
| FA | Código e Console confirmam `sahmt-17a16`; conta conectada indicada pelo usuário; Console mostra Spark | IAM, região, Google Auth, domínio, faturamento e Rules conferidos via API em 8/10; escritores ainda pendentes. |
| FB | Projeto `sahmt-gestao-5ae66` (SAHMT Gestao), Spark, banco `(default)` criado e app Web registrado, segundo capturas e configuração textual enviadas pelo usuário | Conta/IAM, região provisionada `southamerica-east1`, Google Auth, domínio e faturamento conferidos via API em 8/10. |
| Recuperação de código | ZIP do baseline e patches dos checkouts anteriores com SHA256 | Isto não é backup de Firestore nem de Authentication. |
| Ferramentas locais | Planejadores de dados/Auth, capturador de documentos protegido, núcleo de execução, sessões e consolidação preparados em isolamento | Backup de documentos e integração produtiva ainda pendentes; adapters e Rules isoladas foram preparados e ensaiados localmente. |
| PWA / dados produtivos | Nenhuma alteração desta preparação publicada ou aplicada | Exige pacote revisável, backup e validações; autorização geral de continuação recebida. |

O checkout principal e o worktree de treinamentos permanecem preservados. Os drafts anteriores de Forms simplificados, pastas no app, exclusão do ROP acidental e bloqueios temporários de rotas precisam ser reconciliados antes de qualquer reaproveitamento. A decisão do usuário continua sendo **75 itens, sem substituto**, e manter a elegibilidade atual de ROPs no app apesar da mudança da pasta no Drive. Não importar o manifesto antigo de 76 itens como plano atual.

O usuário criou a infraestrutura FB com orientação neste chat. A captura de 8 de outubro às 16h12 mostra o banco inicialmente vazio; a captura às 16h14 mostra `allow read, write: if false;`. Isso comprova o estado exibido nessas telas, sem substituir snapshot completo, leitura de metadados ou teste de acesso por SDK. O objeto Web recebido foi registrado em `.local-preview/management-split/firebase-config.fb.json`, ainda sem inicialização ou vínculo com a PWA. A configuração FA foi preservada. Login no app FB, importação de usuários, sincronização de permissões, migração e publicação continuam pendentes.

Na captura de Authentication enviada depois, o Google aparece como **ativado** e `anestesiahmtforms.github.io` aparece em **Domínios autorizados** como domínio personalizado. Isso comprova a configuração exibida no Console, mas ainda não comprova login pela PWA nem autorização de documentos nas Rules.

O módulo `src/management-firebase-app.js` foi preparado para inicialização nomeada `sahmt-management`, mas retorna `null` por padrão. A ativação exige `VITE_MANAGEMENT_FIREBASE_ENABLED=true` e variáveis locais do FB; nenhum arquivo público contém essa ativação e o módulo ainda não é importado pela UI.

## Arquitetura a validar

A entrada continua sendo a mesma PWA. FA conserva autenticação inicial, módulos operacionais, Checklist e a apresentação de Desempenho. Gestão utiliza uma instância Firebase, Auth e Firestore próprias para FB. Desempenho reúne créditos únicos de FA e FB, com prova de origem das cópias e histórico de correções.

O [inventário](management-firebase-split-inventory.md) contém a classificação de dados, escritores e dependências. O [contrato de autenticação](management-firebase-split-auth.md) contém alternativas de sessão, importação de UIDs, permissões, revogação e testes de dispositivo.

Antes de ligar o cliente ao destino:

1. Comprovar configuração real FB e preservar UID mediante preflight. O mapa de membro associa explicitamente UID FA, UID FB e identificador estável; nomes e e-mails não reassociam históricos.
2. Demonstrar a segunda sessão em segundo plano e a recuperação após recarga, com verificação de FA e autorização FB próprias. A proposta de intermediário ainda precisa de hospedagem, IAM e transporte comprovados dentro das restrições Spark.
3. Implementar espelho privilegiado de direitos efetivos, versão, validade e revogação. Definir e medir o prazo máximo de propagação antes de liberar acesso. Uma concessão pelo cliente ou uma cópia antiga de claims não atende ao contrato.
4. Separar cache, filas e recibos por projeto e membro. Uma ação FA pendente nunca é redirecionada para FB por troca de configuração. Logout e troca de conta encerram ambas as sessões e invalidam respostas tardias.
5. Resolver projeções FA de audiência de notificações e cadastro mínimo necessário a FB. Não mudar globalmente `apps-script-v2/Config.gs` para FB: os consumidores compartilhados de Checklist, escala e relatórios continuam ligados a FA.

Nenhum usuário recebe acesso por ter sido importado em Authentication. Rules, espelho de direitos e direitos vigentes determinam o acesso efetivo.

## Backup real sob Spark

O backup local desta preparação está em `.local-preview/management-split/baseline/backup-receipt.json`. Sua natureza é `LOCAL_CODE_ONLY_NOT_FIRESTORE_BACKUP`. O ZIP contém o commit de referência, e os patches preservam as alterações locais anteriores. Não comprova disponibilidade da aplicação publicada nem captura de dados.

O serviço gerenciado de exportação/importação Firestore exige faturamento e Blaze. Ele não será usado com a restrição Spark do pedido. [Exportação e importação oficiais](https://firebase.google.com/docs/firestore/manage-data/export-import)

O capturador implementado prepara uma captura privada e limitada pela API de documentos, sem ativar faturamento; sua execução permanece pausada. A API `documents.list` admite paginação e um `readTime` comum, com precisão de microssegundos dentro da última hora; todos os parâmetros da paginação precisam permanecer consistentes. Isso permite preparar uma captura coerente, mas não demonstra cobertura completa por si só. [API documents.list](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list)

Requisitos antes de executar a captura:

- Reavaliar a política de leituras e a pausa mediante decisão humana e métricas atuais; reservar margem para tráfego do app, atraso da métrica e próxima unidade. A renovação diária não limpa a trava e o limite local não é um corte global exato.
- Definir escopo completo das entidades e subcoleções de Gestão, créditos relacionados e dependências de identidade. A ausência de documentos pais não autoriza omitir subcoleções existentes.
- Fixar um instante de captura comum aceito pela API; paginar até o fim de cada coleção/subcoleção. Atingir limite de tempo, páginas, leituras ou erro produz captura **incompleta**, nunca `complete:true`.
- Registrar cobertura, páginas, contagens, método, intervalo, tipo dos valores Firestore, hashes e versão do capturador. `complete` e `consistent` só podem ser atribuídos após essas provas; o planner apenas valida as declarações recebidas.
- Capturar Auth FA/FB por processo próprio e registrar horários, hashes e janela de alteração. Auth não compartilha o `readTime` de Firestore; consistência conjunta exige janela controlada e reconciliação.
- Preservar Rules, índices, configuração, contratos de produtores e fontes Apps Script com hashes. Credenciais, gabaritos, respostas e documentos privados não aparecem no terminal ou no Git.

Arquivos ignorados pelo Git não são criptografados nem têm ACL Windows garantida por `mode:0600`. Definir proteção e retenção dos backups reais antes da captura. Os snapshots antigos `catalog-only` não substituem esses backups.

## Simulação de dados preparada

`scripts/lib/management-split-plan.js` recebe snapshots locais tipados e manifesto explícito. `scripts/management-split-plan.mjs` oferece a CLI. Nenhum desses arquivos consulta Firebase ou aplica escritas.

Formato de snapshot:

```json
{
  "schemaVersion": 1,
  "projectId": "ID_REAL_DO_PROJETO",
  "databaseId": "(default)",
  "readTime": "INSTANTE_UTC_DA_CAPTURA",
  "coverage": {"complete": true, "consistent": true, "rootCollections": ["managementAreas"]},
  "documents": [{"path": "managementAreas/ID", "fields": {}, "createTime": "UTC", "updateTime": "UTC"}]
}
```

`fields` usa os tipos REST Firestore. O manifesto pinça `snapshotDigest(snapshot)` e `documentDigest(document)`; esses são hashes JSON canônicos, distintos do hash dos bytes do arquivo. Cada documento exige ação `COPY`, `KEEP_FA` ou `REBUILD`, justificativa e dependências. Coleções mistas exigem vínculo real verificado com Gestão. O mapa de membros é explícito e este planner admite apenas UID preservado; UID diferente exige outro adaptador revisado.

O snapshot FB deve abranger todas as coleções de destino selecionadas e `migrationOrigins`. Sem captura FB, o plano não fica pronto para revisão. Documento equivalente sem proveniência não é tratado como cópia existente. Divergência, relação ausente, autor não mapeado e referência sem projeção bloqueiam o plano.

Uso após produzir e conferir os arquivos privados:

```powershell
node scripts/management-split-plan.mjs --backup .local-preview/management-split/source.json --manifest .local-preview/management-split/manifest.json --destination .local-preview/management-split/destination.json --out .local-preview/management-split/plan-001.json
```

A saída deve permanecer ignorada pelo Git em `.local-preview`; a CLI rejeita escapes de caminho e junctions e não sobrescreve um plano anterior. O terminal apresenta apenas resumo, contagens e hash. Exit code 0 indica prévia sem bloqueios; 2 indica plano com bloqueios; 1 indica falha de entrada/saída. **Nenhum código de saída autoriza produção.**

Cada cópia planejada conserva campos, IDs e vínculos; referências selecionadas são reescritas para FB. Tempos `createTime`/`updateTime` do servidor não são copiáveis como metadados de criação do destino, portanto sua origem é preservada na proveniência auditável. O núcleo local de execução cria documento e proveniência na mesma operação atômica injetada, com precondição de ausência para ambos. Ainda não existe executor conectado a produção; confira [seu contrato](management-migration-executor.md).

## Preflight de usuários preparado

`scripts/lib/management-auth-import-plan.js` recebe capturas locais completas de Auth FA/FB e mapa explícito de membros. Preserva UID, identidade Google e estado desativado; detecta colisões de UID, provedor e e-mail, sem usar e-mail como chave histórica. Existente equivalente resulta em `SKIP`; divergência bloqueia o lote, sem sobrescrita.

A prévia não importa claims, senhas ou tokens. Seu `ready` significa somente estrutura reconciliada: `readiness.scope: STRUCTURAL_PREVIEW_ONLY` e `operationalFreshnessEvaluated:false`. Uma captura antiga/futura não ganha validade operacional por passar nessa prévia.

Antes da importação real, conferir capturas/contexto frescos e impedir criação concorrente de usuários FB durante a janela controlada. `Auth.importUsers()` pode substituir UIDs existentes; preflight separado não oferece precondição atômica de ausência. Nenhum executor/importador foi preparado para ignorar esse risco.

## Desempenho e regras de pontos

`src/performance-consolidation.js` é função pura, ainda sem ligação com UI ou serviços. Recebe fontes completas FA/FB, diretório de membros e proveniência confiável das cópias. Reconcilia awards e todo o ledger por versão, preserva precisão dos timestamps e limita os saldos por categoria. Cópias comprovadas entram uma vez; divergência, fonte parcial/offline, cache, páginas pendentes ou autor desconhecido produzem `UNAVAILABLE`, sem total confirmado.

Governança permanece separada. Checklist conserva seu par de débito/crédito em FA; a consolidação de equipe exige saldo zero do par e mantém membros históricos necessários à prova. A referência percentual usa os saldos únicos da equipe completa; consulta individual não fabrica referência global. O ledger legado `scores` tem contrato diferente e não é somado automaticamente a `evaluationAwards`.

| Regra solicitada | Evidência no baseline / trabalho restante |
| --- | --- |
| Ciência: 1 | Regra presente; preservar histórico e origem. |
| Sugestão: 2 ao participante após revisão | Regra presente; preservar beneficiário e revisão. |
| Teste: nota real | Regra presente; não criar resposta nem simular participante. |
| Gestor que revisa: 2 | Unidade confirmada pelo usuário: uma vez por material e versão revisados. Planner isolado de evento GOVERNANCE preparado; integração do ledger/Forms e política de decisões elegíveis ainda pendentes. |
| Material: 1; questões: 1; ambos: 2 | Governança existente; separar dos pontos de Desempenho. |
| Correção administrativa e Checklist | Conservar histórico, versões e compensações; não recalcular como novo crédito. |

O simulador não concede nenhum crédito. Proveniência/diretório completos fornecidos à função são pré-condições de um loader confiável a implementar, não declarações aceitas do navegador de um participante.

## Sequência de implantação e gates

1. Completar a conferência da infraestrutura FB já criada pelo usuário: ID `sahmt-gestao-5ae66`, Spark, banco `(default)`, app Web e regras iniciais fechadas. Confirmar IAM, região provisionada `southamerica-east1`, Google Auth e domínios. Não ativar participação ou escritores ao conferir infraestrutura vazia.
2. Resolver e ensaiar Auth, espelho/revogação, separação de filas/cache, projeções e produtores compartilhados. Implementar Rules do destino e a regra de revisão de gestor pendente.
3. Implementar e validar capturador, executor idempotente e rollback em fixtures/emulador. Usar precondições, proveniência e recibos auditáveis por unidade. Falha não apaga checkpoints nem repete efeitos concluídos.
4. Obter backups reais sob a política de leituras e gerar os preflights com capturas FA/FB. Resolver cada bloqueio e comparar relações, autores, versões e contagens.
5. Ensaiar em ambiente fechado login/logout/recarga/troca de conta, revogação e negação direta nas Rules; iPhone/Safari/PWA instalada; cópia duplicada, correção, reexecução, falha de origem e destino. Build/testes sintéticos não comprovam esses fluxos.
6. Apresentar pacote concreto: IDs, configuração, diff, hash/contagens dos backups, plano, provas, pendências e rollback. A autorização geral para continuar já foi recebida; cumprir e apresentar esses gates concretos antes da mudança produtiva.
7. Após validação do pacote, executar a janela de migração mantendo FA preservado; conferir o resultado. Parar os escritores antigos de Gestão apenas depois da validação humana da migração. Não deixar FA e FB consumirem o mesmo pedido pendente.
8. Publicar a adaptação da PWA e conferir os arquivos servidos, versão/service worker e fluxo autenticado. Separar evidência de publicação de validação com pessoa/dispositivo real.

Nenhuma etapa reinicia a homologação ou os gatilhos de liberação cancelados. Não habilitar `evaluationRuntime`, faturamento, compras ou serviços pagos por inferência.

## Rollback

Antes de ligar FB, restaurar o código/configuração de referência é um rollback de código. FA permanece intacto. Não restaurar patches sobre arquivos com mudanças posteriores sem comparação.

Depois de escritas FB, bloquear novas gravações de Gestão, congelar seus consumidores, capturar filas pendentes e dados/recibos novos e reconciliar o delta. Preservar IDs de solicitação; não limpar cache/fila para resolver duplicação. Reabrir escritores FA somente com dados novos reconciliados e decisão de corte. Reverter a UI isoladamente não restaura o estado de negócio.

Originais FA e dados/proveniência FB ficam retidos. Apagar projeto, coleção, usuário ou histórico exige autorização explícita própria. As identidades de Auth, permissões e revogações dos dois projetos precisam ser consideradas no rollback, não só a configuração Firestore.

## Continuação autorizada e provas de 8/10

O usuário autorizou avançar nas ações necessárias nesta conversa. Essa autorização evita repetir pedidos para os passos já cobertos; mantém o plano Spark, o limite de leituras e a validação humana da migração antes de interromper os escritores antigos. O rollout de treinamentos continua cancelado. Não há automação de acompanhamento antigo ativa no aplicativo.

Os preflights `scripts/management-project-preflight.mjs FA` e `FB` verificaram via API os IDs reais, banco `(default)` Standard/Native em São Paulo, proprietário esperado, Google Auth, domínio da PWA, faturamento desabilitado e Rules publicadas. Provas privadas `metadata-FA-*.json`, `metadata-FB-*.json` e `rules-FA/FB-*.json` ficam em `.local-preview/management-split`. O indicador `VERIFIED` significa resposta dos endpoints; o pacote também exige os campos semânticos conferidos: projeto/conta/região/provedor/domínio/faturamento. Essas operações não leram documentos Firestore.

`scripts/management-auth-capture.mjs` capturou por paginação 60 contas em FA e zero em FB. Os dois arquivos `auth-FA/FB-*.dpapi.json` foram descriptografados em memória e seus hashes conferidos. São capturas completas do percurso da API Auth, sem instantâneo atômico ou consistência conjunta com Firestore. Não houve criação/importação de usuários. Não existe ainda mapa validado UID→membro estável.

A proteção `WINDOWS_DPAPI_CURRENT_USER` de `scripts/lib/windows-protected-json.js` vincula a recuperação ao perfil Windows atual. Dados de identidade ficam somente em memória/pipes e arquivos criptografados; logs/recibos contêm contagens e hashes. A preservação dessa conta/perfil Windows é requisito da recuperação local; uma cópia portátil e sua retenção ainda precisam ser definidas antes de usar isto como recuperação fora desse perfil.

Às 20h09 de São Paulo, a avaliação única de Cloud Monitoring retornou 4.109 leituras no dia, mas o último ponto era das 18h14: `fresh:false`. Esse valor não representa uso atual confiável. O backup de documentos permanece pausado e nenhum documento foi consultado. A medição não removeu a trava nem alterou os checkpoints/controles do treinamento cancelado.

`scripts/lib/firestore-snapshot-capture.js` captura árvores explícitas no mesmo `readTime`, com paginação, pais ausentes e subcoleções, tipos REST, limites, reserva por tentativa, checkpoint e hashes. `INCOMPLETE` nunca fornece snapshot elegível ao planner. O núcleo recebe adaptadores e não obtém credenciais. `scripts/management-firestore-capture.mjs` prepara o transporte REST, proteção e verificação local; seu modo `FA --preflight` demonstrou bloqueio `MANAGEMENT_READ_PAUSED_REQUIRES_REVIEW` antes de consultar credenciais ou APIs. O modo `--capture` não foi executado.

A política privada `backup-read-policy-FA/FB.json` destina-se somente ao backup de Gestão. Ela não rearma o rollout. Antes de capturar, uma avaliação humana com medição fresca precisa conferir a decisão vigente, margem de tráfego do app e atraso de métricas; somente então remover a pausa desse propósito. A CLI nunca remove a pausa nem renova uma decisão automaticamente. `scripts/lib/management-read-budget.js` exige limite 35.000, reserva de app de pelo menos 5.000, atraso de pelo menos 2.000, teto local de captura de 6.000 e preservação das reservas históricas de outras rotinas. São margens conservadoras locais, sem garantia de corte exato do tráfego do app.

O coordenador `src/management-session.js` está preparado e desligado, sem importação pela UI. Os testes cobrem restauração conjunta, vínculo explícito, perfil revogado/cache/offline, expiração de direitos, UID divergente e respostas tardias durante logout/troca de conta. O núcleo de broker está preparado em scripts/lib/management-auth-broker.js e seu [contrato](management-auth-broker-contract.md) registra prazos, reserva única de leituras, revogação e reconciliação de gravação tardia. Hospedagem e ativação continuam pendentes; a continuação abaixo acrescentou Rules isoladas e adaptadores de SDK, sem publicação ou prova de login único real.

Validação desta continuação: 335 testes focados aprovados em 13 arquivos, após as correções e a revisão independente do broker. O build e a revisão de diff são registrados nas provas locais. Não há migração, alteração de Rules, publicação da PWA ou concessão de pontos nesta preparação.

## Núcleos preparados sem ativação

O [executor de migração](management-migration-executor.md) valida plano, hashes, dependências, contexto e margem antes da próxima unidade. Dados e proveniência têm precondições de ausência na mesma operação atômica. Resultado desconhecido ou divergência interrompe a execução e preserva checkpoints. Seus adaptadores reais ainda precisam ser integrados; o núcleo não acessou produção.

O [planner de revisão de gestor](management-manager-review-contract.md) usa a unidade confirmada pelo usuário: material de origem e versão, com dois pontos de Governança uma única vez. Política ausente sobre aprovação/reprovação ou validação produz bloqueio. A modalidade ainda precisa ser integrada ao ledger/Forms; nenhum evento ou crédito foi criado.

## Proteção e metadados acrescentados

O capturador de documentos usa AES-256-GCM com chave aleatória protegida por DPAPI para checkpoints rápidos, mantendo leitura dos backups Auth DPAPI v1. A CLI usa o mesmo lock no preflight e na captura, reserva a próxima página de 100 antes de credenciais, serializa reserva/pausa e conserva o lock se não conseguir salvar a pausa. Grava somente um checkpoint latest por execução com substituição atômica e limite de 20 MiB; drena gravações atrasadas e grava o estado final antes de liberar o lock. Falha deixa a captura incompleta e exige revisão, sem apagar o estado. As provas de criptografia/falha de persistência são sintéticas; não comprovam captura produtiva.

`scripts/management-index-capture.mjs` preservou metadados administrativos dos dois projetos, com contagens, paginação até fim, hashes e verificação de arquivo. FA tinha 46 índices compostos e FB zero nesse percurso. Ambos retornaram um registro de configuração padrão, sem override de campo não padrão ou TTL configurado. Esses endpoints não consultam documentos. A captura não é atômica entre chamadas e deve ser reavaliada antes de aplicar índices. O serviço desta instância recusou pageSize diferente de zero; usamos seu padrão administrativo sem supor limite de 100 para o conjunto. [API de índices](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes/list), [API de campos](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields/list).

## Continuação de login e Rules — 8/10, horário de São Paulo

Uma nova avaliação única de Cloud Monitoring às 20h59 retornou novamente 4.109 leituras, com último ponto das 18h14. A prova privada read-observation-20261008235903702.json declara fresh:false e pausedRequiresReview:true. O número é histórico; não permite avaliar margem atual. Nenhum documento Firestore foi consultado e a pausa foi mantida.

O transporte [HTTPS do broker](management-broker-http-contract.md) prepara POST/CORS exatos, body limitado, prazo monotônico, cancelamento e supervisor obrigatório. O supervisor só recebe conclusão sanitizada; HTTP 504 não demonstra conclusão de uma escrita ou limpeza remota. A guarda mantém IDs de reservas consumidos após a expiração e falha fechada ao atingir capacidade local. Host/journal/CAS/fence e ledger duráveis ainda precisam ser integrados.

Os [adaptadores browser](management-session-browser-contract.md) preparam Firebase modular para FB nomeado, restauração Auth, projeção FA e lease FB confirmados, orçamento anterior ao SDK e transporte sem popup adicional. Nenhum desses componentes é importado pela interface. O path/escritor da projeção FA, TTL e sincronismo de direitos continuam gates produtivos. Uma resposta do SDK que chega após timeout não autoriza retry sobreposto nem libera sua reserva.

As [Rules do destino](management-destination-rules.md), em firestore.management.rules, foram compiladas e ensaiadas no emulador local: 12/12 testes. Permitem somente get do próprio lease compatível com sessão custom e negam listas, escritas e todos os recursos de negócio. A versão usa resource.data sem access calls adicionais de Rules; não instala limite global de leituras. Não foram publicadas.

A [avaliação de hospedagem](management-broker-hosting-assessment.md) identificou caminhos condicionais sem Blaze. Apps Script requer uma porta própria de verificação/assinatura e transporte; Cloudflare requer identidade privilegiada Google, runtime compatível, orçamento durável e provas dos limites gratuitos. Nenhum host, signer ou serviço produtivo foi criado nesta análise.

O pacote não liga Gestão ao novo FB. A UI publicada de FA e os drafts de bloqueio temporário precisam ser reconciliados antes da publicação; este pacote não comprova que a UI atual esteja globalmente bloqueada. Não há migração, importação Auth, alteração de Rules produtivas, concessão de créditos, reinício de treinamento ou publicação da PWA.

### Provas finais desta continuação

- 496/496 testes locais focados em 15 arquivos; zero falhas, cancelamentos ou skips.
- 12/12 testes das Rules no emulador exclusivo, encerrado após execução.
- 6/6 checks no workerd local com doubles, sem bindings ou rede produtiva; 17 checks de exports/assinaturas do SDK instalado.
- Build da PWA aprovado. Compilação isolada dos dois adapters browser com o SDK instalado aprovada; nenhuma instância SDK foi inicializada.
- Revisão independente de HTTP/browser sem P1/P2 remanescente no bloco examinado. Foram fechados início tardio de thunks, reserva vencida antes de SDK, prazo monotônico e bloqueio após falha de limpeza.

A composição de browser adapter e coordenador real foi ensaiada com doubles: restore → broker → ready; mudança e observação fresca de revogação → bloqueio; saída FA/FB conserva requestId e pendências. Esses resultados não comprovam Auth/Firestore reais, publicação ou validação por participante/dispositivo.

Provas privadas: focused-second-continuation.log, build-second-continuation.log, browser-bundle-proof.json e runtime-smoke/proof.json. As evidências antigas de 335 testes correspondem ao pacote anterior e foram preservadas. O commit desta continuação é somente local; não houve push, PR ou deployment.
