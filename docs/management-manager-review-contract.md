# Contrato local: revisão do gestor por material e versão

## Decisão confirmada e estado da implementação

O usuário confirmou: **2 pontos uma vez por material e versão revisados**. A unidade não é uma sugestão analisada nem uma requisição do aplicativo. A revisão deve estar COMPLETA e validada pelo backend, com gestor designado e direitos atuais.

A categoria adotada é **GOVERNANCE**, conforme a separação do contrato existente: `FormsEvaluation.gs:1267` declara revisões de gestor exclusivamente em governança; `docs/EVALUATION_DEPLOYMENT.md:5` mantém Avaliação dos Gestores fora do percentual geral da equipe.

Foi preparado somente o planner puro `scripts/lib/management-manager-review-plan.js`, sua suite sintética e este contrato. O planner produz especificações locais e não obtém credenciais, acessa banco, concede créditos, instala gatilhos ou ativa runtime. Nenhuma política real de decisões/validação foi criada.

**Continuam pendentes decisões explícitas** sobre quais decisões de revisão recebem o crédito (APPROVE, REJECT ou ambas), e se a confirmação requer apenas backend confiável ou também administrador independente. A ausência de qualquer escolha bloqueia o plano. A suite usa políticas fictícias para testar os caminhos; elas não representam autorização de produção.

## Reaproveitamento e fronteiras atuais

- `apps-script-v2/EvaluationLedger.gs:20`: identidade determinística do award por categoria, UID, escopo, versão e modalidade. O planner reproduz esse hash.
- `EvaluationLedger.gs:27`: validação pura da modalidade e dos valores; a whitelist atual ainda não aceita MANAGER_REVIEW. A integração precisará aprovar a modalidade em GOVERNANCE e seu valor normal [0,2].
- `EvaluationLedger.gs:197`: planeja awards/ledger e marca runtime/reference por categoria na transação existente.
- `EvaluationLedger.gs:333`: correções administrativas versionadas preservam identidade, fingerprint e evidências, alterando saldo de modo auditável.
- `FormsEvaluation.gs:915`: REVIEW_SUGGESTION beneficia o participante; não comprova a nova unidade de revisão de material.
- `FormsEvaluation.gs:942` e `:1010`: designação, snapshots, fingerprints e validação de alterações de material/questões podem ser reaproveitados pelos adaptadores. Os créditos MATERIAL1/QUESTIONS1 continuam distintos de MANAGER_REVIEW2.
- `FormsEvaluation.gs:1057`: transação central dos requests. É o ponto adequado para integrar o futuro comando específico de revisão completa de material/versão, depois de definir sua evidência e suas Rules.

O fluxo atual de atualização de conteúdo não prova automaticamente que uma revisão completa de material/versão aconteceu. Não inferir MANAGER_REVIEW de abrir documento, responder Form, analisar sugestão, mudar número de versão, pedir validação ou migrar dados.

## Identidade e registro auditável

A origem canônica tem `{projectId, materialId}`, com projeto FA ou FB e ID estável do material. O adaptador deve resolver o vínculo aprovado com o material real (inclusive Drive) e conservar a origem original de FA em uma cópia para FB. Material novo criado em FB tem origem FB. O campo não pode ser escolhido pelo navegador.

```text
unit = {materialOrigin: {projectId, materialId}, materialVersion}
eventId = "manager-review-" + SHA256(canonical(unit))
awardId = identidade existente de GOVERNANCE/gestor/eventId/versão/MANAGER_REVIEW
```

Request, gestor, decisão, área, designação e versão de regra não criam outra unidade. Os dados de negócio correspondentes ficam auditados e congelados no evento. Uma nova versão legítima, reconhecida pelo backend, é outra unidade; fornecer o evento de versão anterior como se fosse o da nova é CONFLICT.

A coleção proposta é `evaluationManagerReviewEvents`. O evento contém:

| Grupo | Campos |
| --- | --- |
| Unidade | origem canônica, versão do material, eventId |
| Beneficiário | UID e memberId do gestor |
| Negócio | matéria, área, designação e versão, decisão, conclusão, fingerprint do conteúdo e da revisão |
| Regra | ID, versão, decisões elegíveis, modo de validação e início de vigência |
| Validação | backend completo, modo, administrador quando exigido, instante da validação |
| Crédito | GOVERNANCE, MANAGER_REVIEW, 2, awardId, creditScopeId |
| Auditoria | primeiro request e status CONFIRMED |

Não copiar respostas privadas, e-mails ou conteúdo integral do material para o evento. O planner seleciona campos mínimos e hashes; metadados extras do contexto não saem no plano.

## API do planner

```js
planManagementManagerReview({
  review,
  policy,
  context,
  existingEvent: null,
  existingAward: null
});
```

### Política obrigatória, ainda não definida para produção

A política exige schemaVersion1, ID/versão, confirmed=true, unit=MATERIAL_VERSION, category=GOVERNANCE, modality=MANAGER_REVIEW, points=2, eligibility=CURRENT_DESIGNATED_MANAGER, effectiveFrom e retroactive=false.

`creditedDecisions` deve enumerar explicitamente APPROVE e/ou REJECT. `validationMode` deve ser explicitamente BACKEND_ONLY ou INDEPENDENT_ADMIN. BACKEND_ONLY exige prova completa produzida pelo adaptador confiável; INDEPENDENT_ADMIN acrescenta administrador ativo, autorizado e diferente do gestor beneficiário.

Ser administrador não torna alguém beneficiário. O beneficiário sempre deve ser o gestor atualmente designado ao material/área, com perfil ativo, acesso vigente e permissão de revisão revalidada. O modo administrativo seleciona quem confirma a revisão, não quem recebe os pontos.

### Revisão e contexto confiáveis

`review` contém origem/versão, activityId, areaId, managerUid/memberId, assignmentId/version, decision, completedAt, sourceFingerprint, reviewFingerprint e requestId. Campos points/category/modality extras no pedido são rejeitados.

`context` contém projeto de execução, now/checkedAt, perfil, designação, direito efetivo de revisão, validação e, quando exigido, perfil do administrador. O contexto deve ser montado pelo backend com leituras e verificações atuais; booleanos vindos do cliente não são prova. `reviewPermissionVerified` é uma evidência normalizada pelo adaptador a partir das permissões existentes, não uma permissão nova criada no app.

A validação deve ligar exatamente origem/versão, gestor, decisão, instante de conclusão e os dois fingerprints. Deve ser COMPLETE, trustedBackend, com origem canônica e conteúdo verificados. Verificações de autorização e validação têm limite técnico de idade de 60 segundos no planner; relógio confiável é passado pelo adaptador, sem Date.now interno.

Revisões anteriores a effectiveFrom são bloqueadas. Não existe backfill ou crédito retroativo automático.

### Resultados

| Status | Efeito do planner |
| --- | --- |
| READY | Evento e awardSpec novos, mais exigências de integração; não executa writes. |
| DUPLICATE | Unidade equivalente já tem evento/award íntegros; nenhum evento ou awardSpec. |
| CONFLICT | Beneficiário, unidade, conteúdo, revisão, regra ou contrato existente divergente; nenhum reparo/recrédito automático. |
| BLOCKED | Política, acesso, designação, contexto ou evidência insuficiente; nenhum crédito. |

Evento sem award ou award sem evento é CONFLICT. Outra requisição equivalente não repaga a unidade. Nova designação não muda seu beneficiário anterior. Fingerprints e versão não podem ser substituídos em uma unidade existente.

Uma correção administrativa compatível, marcada adminOverride e ADMIN_CORRECTION, conserva a identidade/fingerprint/evidência originais e permanece intocada no retry. O planner nunca restaura automaticamente o saldo para2. Sinalizar adminOverride isoladamente ou alterar fingerprint/evidência não prova uma correção válida.

## Integração futura em uma única transação

1. Ler o pedido ainda pendente, evento determinístico e award, além de perfil/designação/permissões atuais, no mesmo contexto transacional.
2. Validar revisão COMPLETA do material/versão e a política explícita. Fixar origem e snapshots/hash verificáveis; revalidar mudanças antes de confirmar o commit.
3. Invocar o planner. BLOCKED/CONFLICT exigem pendência explícita; DUPLICATE preserva evento e saldo.
4. Para READY, criar o evento com precondição `exists:false` e timestamp de servidor.
5. Enviar o awardSpec ao ledger junto de quaisquer outras mudanças do mesmo negócio, em **uma única chamada** de `evaluationApplyAwards_`. Duas chamadas podem planejar duas alterações concorrentes dos mesmos documentos runtime/reference.
6. Confirmar evento, awards, ledger e resultado terminal do request no mesmo commit. Não publicar evento confirmado com crédito parcial ou plano NEEDS_REVIEW.
7. Recalcular resumos/reference GOVERNANCE pelo mecanismo existente; não modificar estado PERFORMANCE nem percentuais da equipe.

A chamada pura não garante serialização. A transação e a precondição de criação protegem concorrência e retries reais. O adaptador precisa ler o evento pela mesma chave antes de chamar o planner; não passar ausência presumida.

A identidade dos UIDs/membros e a época de corte FA/FB precisam seguir o plano de migração. Não permitir escritores antigos e novos criando unidades independentes durante o corte. Mudança ou ausência de vínculo canônico interrompe o processamento.

## Integrações ainda necessárias

- Ledger: aceitar MANAGER_REVIEW em GOVERNANCE com a regra aprovada.
- Backend/requests: definir o comando e a prova de revisão COMPLETA por material/versão; usar adaptadores atuais de acesso, designação, snapshot e transação.
- Rules: coleção de eventos sem escrita de cliente; consultas privadas por beneficiário/admin conforme direitos vigentes.
- Planner de migração: classificar a nova coleção e permitir explicitamente a modalidade; `management-split-plan.js:151` atualmente a rejeita.
- UI: apresentar “Revisão do gestor” em governança; não mover para PERFORMANCE.
- Consolidação: preservar origem/evento/award e sidecars ao deduplicar FA/FB. O consolidador já aceita modalidades textuais nas categorias existentes.
- Homologação: concorrência real, revogação entre leitura/commit, retry, indisponibilidade e cópia migrada, depois de aprovar a política.

Nenhum módulo existente, whitelist, Rules, UI, processo nativo ou dado de produção foi alterado por esta preparação.

## Verificação local

Suite focada: `node --test tests/management-manager-review-plan.test.js`. As políticas, identidades, hashes e tempos da suite são sintéticos. Ela cobre duplicação/migração, unidade/versão, conflitos, revogação, validação completa, políticas ausentes, decisão/administrador explícitos, preservação de correção e ausência de rede/credenciais/relógio global. O teste de compatibilidade compara o awardId com o helper atual e confirma que a modalidade ainda está bloqueada no ledger de base.
