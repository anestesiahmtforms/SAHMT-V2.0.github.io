# Prévia local de dependências das contas candidatas

## Escopo e identidade

O scanner aceita somente os marcadores presentes no índice FA DPAPI:

- `HOMOLOGATION_CANDIDATE_1`
- `HOMOLOGATION_CANDIDATE_2`
- `STRUCTURAL_OWNER`

Cada marcador deve aparecer uma única vez, com UID único, e o índice deve ter até 24 horas. Os dois UIDs candidatos são obtidos em memória do índice protegido. O UID estrutural é validado e explicitamente excluído do conjunto de consulta. O e-mail não é armazenado pelo índice: o capturador FA o reduz a um marcador categórico em memória e descarta o objeto original.

O agregador existente continua exigindo que os snapshots de Authentication confirmem UID e e-mail exatos em cada projeto. Conflitos, ausência ou ambiguidade impedem uma conclusão segura.

## Mapa estático de referências

O catálogo em `scripts/lib/management-retirement-dependency-scan.js` foi derivado do `firestore.rules`, de `src/data.js`, `src/evaluation-data.js` e do adaptador do broker. Ele verifica apenas os caminhos e campos listados no código. As consultas selecionam o campo referenciador e, quando a classificação depende de estado, o campo de estado. O endpoint recebe UIDs exatos em filtro `IN` ou `ARRAY_CONTAINS_ANY`; nenhum campo/coleção é aceito da linha de comando.

| Classe no relatório | Uso encontrado no modelo | Exemplos de coleções/campos |
| --- | --- | --- |
| Operacional/ativo | Acesso, designação, atribuição pendente ou trabalho em andamento. Bloqueia uma proposta de exclusão. | `users/{uid}`, `accessRequests`, `managementSourceContexts/{uid}`, `managementAreas.memberUids/managerUids`, `evaluationActivities.eligibleUids/managerUid`, `actionPlans.responsibleUid`, `actionPlanItems.responsibleUids`, `activities.responsibleUids`, `equipment.responsibleUid`, leases do broker em FB |
| Treinamento/histórico | Progresso, recibos, pontuação, participação e resumo de atividades. O estado desconhecido vira ambíguo. | `trainingProgress.uid/status`, `trainingReceipts.uid/accessPointsStatus`, `trainingCompletions.uid/validationStatus`, `learningActivityReceipts.uid`, `evaluationAwards.uid`, `evaluationLedger.uid`, `scores.uid`, `evaluationSummaries/{uid}` |
| Auditoria/histórico | Autoria, alteração, assinatura, solicitação resolvida ou trilha histórica. A referência é relatada e preservada. | `auditLogs.actorUid`, `events`/`labels`/`checklists`/`trainings` `createdByUid` e `updatedByUid`, `checklistSignatures.signerUid`, `history` collection group |
| Ambígua | Relação cujo estado ou significado não corresponde aos valores conhecidos. Exige revisão manual e bloqueia proposta. | Estado ausente/desconhecido em solicitação, tarefa ou revisão; `checklistSignatureRequests` com estado não reconhecido |

O documento `managementAuthorizationFences/{id}` no FB é tratado como dependência operacional crítica, pois representa um bloqueio de autorização/revogação atual. Qualquer referência do UID candidato nele impede proposta de retirada até revisão explícita.

O scanner percorre a lista compartilhada nos três IDs de projeto. O código local conhece o modelo Firestore completo de FA; FB também possui documentos de sessão do broker. FC não tem adaptador Firestore ativo no checkout e não há um catálogo FC independente. Por isso, os resultados FC só cobrem os caminhos do modelo compartilhado. Antes de afirmar cobertura total no FC, será necessário comparar a lista de coleções existente no Console com este catálogo.

O scanner não descobre campos arbitrários ou documentos em caminhos desconhecidos. Um inventário de coleções não mapeadas e a confirmação dos subcaminhos devem preceder qualquer conclusão de ausência. A fila offline/IndexedDB nos navegadores também não é visível pelo Firestore; operações locais pendentes exigiriam uma conferência separada antes de qualquer retirada.

## Classificação e bloqueios

- Referências ativas ou de acesso ficam em `OPERATIONAL`.
- Referências de treinamento e auditoria são agregadas separadamente. Nenhum documento é removido.
- Estado ausente ou não reconhecido fica em `OTHER` e bloqueia proposta.
- Resultado truncado, erro, coleção com campo incompatível ou leitura incompleta não produz índice utilizável.
- A consulta para em 501 resultados por campo/coleção para detectar truncamento; o máximo de 500 resultados completos por consulta deve ser respeitado.
- O agregador nunca habilita exclusão. Mesmo sem referências críticas, qualquer decisão é manual e exige aprovação posterior.

## Atualização segura do índice FA

O índice legado pode não conter os marcadores novos. Após autorização para a leitura FA, `node .\scripts\management-fa-inventory.mjs` executa a leitura paginada já preparada, cria um índice mínimo com UIDs e marcadores e grava o envelope DPAPI em `.local-preview/management-split`. O relatório em texto contém só contagens. O arquivo anterior não deve ser sobrescrito; a nova captura é um arquivo separado e datado.

Esse comando faz leituras reais e não deve ser executado sem autorização específica. Nesta tarefa não foi executado.

## Consultas futuras

O runner usa apenas `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents:runQuery`, com `POST` para `structuredQuery` somente de leitura. O token OAuth é mantido em memória e usa `cloud-platform`. O runner não chama Authentication, IAM, Rules nem endpoints de escrita. Respostas trazem só campos projetados; nomes e campos inesperados são descartados depois da agregação. Erros e logs são códigos fixos.

A execução futura está conectada ao CLI, mas não foi executada nesta preparação. Ela deverá ocorrer por projeto, após nova autorização individual, começando pelo FA e verificando o relatório antes de FB e FC. O relatório de saída troca UIDs por rótulos `candidateOne` e `candidateTwo`; nenhum e-mail ou UID aparece. O índice descriptografado existe apenas em memória e a saída é agregada.

## Comandos locais

```powershell
node .\scripts\management-retirement-dependency-plan.mjs
node --test .\tests\management-retirement-dependency-scan.test.js .\tests\management-account-retirement-impact.test.js .\tests\management-fa-inventory.test.js .\tests\management-fa-cohort-preview.test.js .\tests\management-fb-inventory.test.js .\tests\management-auth-import-plan.test.js
```

O primeiro comando é plan-only. O segundo usa mocks/snapshots sintéticos. Nenhum dos dois consulta Firebase.

Comando preparado para uma futura leitura real (não executar sem autorização específica para o projeto indicado):

```powershell
node .\scripts\management-retirement-dependency-scan.mjs --read-project=FA --confirm-read-only
```

Para FB ou FC, trocar somente `FA` por `FB` ou `FC` e executar em uma etapa separada. O comando exige um índice FA protegido recente (até 24 horas) e a conta Firebase CLI `fa-owner@example.invalid`; consulta apenas o catálogo fixo de `runQuery` do projeto selecionado. As consultas usam POST de leitura, OAuth `cloud-platform`, não fazem gravações e interrompem se faltar índice/escopo ou se houver erro/truncamento. O comando não foi executado nesta tarefa.

## Resultado das leituras reais — 12/10/2026

A execução autorizada consultou o catálogo estático por campo, com o proprietário correspondente de FA e FB. O FA concluiu as 95 consultas compatíveis; o resumo foi emitido, mas o processo terminou com erro ao tentar limpar uma matriz imutável já relatada. Corrigimos esse encerramento localmente, sem repetir as leituras. O FB concluiu 98 consultas com saída de processo normal.

- FA: 48 coleções consultadas; contagens agregadas candidateOne: 1 operacional, 23 auditoria; candidateTwo: 2 operacional.
- FB: 49 coleções consultadas; candidateOne: 0 referências nas consultas executadas; candidateTwo: 1 operacional.
- Ambos deixaram sem consulta `notificationReads.uid`, `history.createdByUid` e `history.updatedByUid`, pois a consulta de grupo retornou HTTP 400. Também não confirmaram ausência global em coleções não mapeadas. O FC não foi consultado porque a sessão do proprietário correspondente não estava disponível.

A mudança local para uma consulta por campo reduz a dependência de índices compostos. A lacuna de coleção-grupo e a cobertura estática incompleta continuam bloqueando qualquer decisão de retirada, mas não bloqueiam a integração operacional. Nenhum dado ou conta foi modificado.

## Seleção de identidade executora por projeto

A versão atual do runner não contém endereços de proprietários no código. Ela requer a identidade do proprietário correspondente em uma variável de ambiente local por projeto (`SAHMT_RETIREMENT_OWNER_FA_EMAIL`, `SAHMT_RETIREMENT_OWNER_FB_EMAIL` ou `SAHMT_RETIREMENT_OWNER_FC_EMAIL`). Sem a variável e sessão correspondente, o runner falha antes de obter token ou enviar requisição.
