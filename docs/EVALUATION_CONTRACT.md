# Avaliação integrada — contrato de implementação

Base preservada: dd381642b8e52c8433ebba24560bb4ad65de5335. Branch codex/integrated-performance-20261003. Pedido do proprietário de 03/10/2026. Firebase sahmt-17a16 Spark. Nenhuma coleção histórica será removida ou classificada por suposição.

## Coleções novas

- evaluationActivities: projeções canônicas de Forms resolvidos; id=formId real. title, formId, responderUrl, creditScopeId (matéria estável), version (versão elegível), areaIds, eligibleUids, managerUid, assignmentId, modalities {acknowledgement,suggestion,test}, maxTestScore, active, status READY/CONFIGURATION_PENDING/INACTIVE/NEEDS_REVIEW, reason, validFrom, validUntil, updatedAt. Sem gabarito/respostas na projeção.
- evaluationFormConfigs: somente backend; mapeamento de IDs de itens, snapshots de gabarito/pesos/material, fingerprints, primeira vigência, revisões e evidência de configuração.
- evaluationLinks: vínculos de origens/áreas e aliases; status e motivo explícitos, remoção lógica. Fonte collection/id/version e URL normalizada. Aliases públicos/curtos não são IDs de edição.
- evaluationAssignments: atribuição atual id=areaId, areaId, uid, version, effectiveAt, actorUid. evaluationAssignmentHistory: histórico imutável de cada mudança, incluindo anterior/atual/vigência/autoria. Não inferir um único gestor de arrays múltiplos.
- evaluationParticipations: projeção privada da resposta por usuário/creditScopeId/version. uid, activityId, areaIds, managerUid, version, responseId, status, declaration, suggestion {problem,proposal,benefit,status}, test {status,score,maxScore}, submittedAt, updatedAt. A identidade usa exclusivamente e-mail VERIFIED resolvido a exatamente um perfil autorizado.
- evaluationGovernanceRevisions: uid, activityId, areaId, assignmentId, previousVersion, newVersion, summary, materialEvidence, questionEvidence, materialFingerprintBefore/After, questionFingerprintBefore/After, components, status PENDING/APPROVED/REJECTED/NEEDS_REVIEW, approvedByUid, createdAt, updatedAt. Histórico não muda com atribuição futura.
- evaluationAwards: estados lógicos dos créditos, id determinístico categoria/uid/creditScope/versão/modalidade (Checklist: obrigação por DIA). uid, category PERFORMANCE/GOVERNANCE, modality, activityId, areaId, version, points (valor corrente), originalPoints, awardVersion, adminOverride, sourceFingerprint, transferId, evidence, approvedByUid, updatedAt. Cliente só consulta próprio/admin. Alterações geram ledger, nunca apagam história.
- evaluationLedger: imutável; id awardId + versão de alteração. awardId, uid, category, modality, activityId, areaId, version, points (DIFERENÇA assinada), originalPoints, correctedPoints, correctsId, transferId, sourceType, sourceId, evidence, approvedByUid, createdAt, reason. Não misturar categorias.
- evaluationSummaries: id=uid; uid, performanceTotal, governanceTotal, performanceCount, governanceCount, performanceRevision, governanceRevision, confirmedAt, status CONFIRMED. Somente backend, próprio/admin consultam.
- evaluationReference/team: somente agregado anônimo: maxPerformance, eligibleCount, allZero, performanceRevision, performanceStatus CONFIRMED/PENDING, governanceRevision, governanceStatus, updatedAt. Não conter nomes/UIDs de colegas. Referência positiva calcula percentual com 1 casa, negativos preservados; todos zero =>0; maior<=0 com saldos nãozero =>sem referência positiva. Inconsistente/ausente =>aguardando, nunca zero inventado.
- evaluationRuntime/state: backend; revisões/dirty por categoria, homologação e ativação. Mutação de GOVERNANCE não pode modificar campos de PERFORMANCE. Recálculo separado; publicação atômica de resumos+referência da categoria usando precondições. Budget de writes excedido deve ficar pendente explícito, sem publicar projeção parcial como confirmada.
- evaluationRequests: jobs imutáveis criados pelo cliente: id, type, actorUid, createdAt (serverTimestamp), status PENDING, payload. Backend revalida e atualiza status/result. Types ASSIGN_MANAGER, CONFIGURE_ACTIVITY, REVIEW_SUGGESTION, REQUEST_GOVERNANCE, REVIEW_GOVERNANCE, CORRECT_SCORE, RECONCILE_LINKS. IDs estáveis por ação; versão esperada em correções. Client nunca envia crédito confiável nem altera totais. Autorizações: admin can(admin) para configuração/designação/correção/revisão governança; gestor vigente ou managementManage/qualityManage autorizado da área para sugestão (diferente autor); gestor designado próprio para solicitar governança. Cada payload limitado e validado nas Rules e no processador.

## APIs cliente (arquivo src/evaluation-data.js, responsabilidade root)

watchEvaluation({actorUid,subjectUid,category,onData,onError}) retorna cleanup imediatamente; onData {summary,reference,ledger,awards,participations,revisions,requests,fromCache,pendingWrites}. Listener dados próprios; admin pode subjectUid diferente. Sem scores terceiros para máximo. Encerra tudo ao trocar sessão/rota/permissão.
listEvaluationActivities(actorUid), listEvaluationPeople(actorUid), listEvaluationAssignments(actorUid), listEvaluationReviewQueue(actorUid), submitEvaluationRequest(type,payload,actorUid,{requestId}) retornam Promises. listEvaluationPeople é somente admin usando acesso existente a users, com projeção mínima UI. Requests requerem conexão; nunca apagar fila offline existente.

## Processamento Spark

Forms -> Apps Script privilegiado -> Firestore -> PWA. Existing OAuth datastore/drive/etc; novo scope forms autorizado diretamente pelo proprietário em resposta à solicitação. Não ampliar IAM nem compartilhar arquivos automaticamente.

FormApp pode configurar modelo e validar limite/edição; Forms REST fornece emailCollectionType VERIFIED e totalScore efetivo. Não usar nota/UID/e-mail enviados pelo navegador como prova. Nota ausente fica pendente. Gabarito/IDs/máximo precisam conferência. Modelo padronizado usa marcadores estáveis por modalidade e IDs reais mapeados, ROPs preservadas. Modelo permanece não publicado. Original somente leitura; respostas originais não são importadas em massa.

Descobrir links ao salvar origem via request e por reconciliação paginada de todas managementAreas/documents/learningActivities e pastas/conteúdos acessíveis, sem IDs fixos. Aliases Forms resolvidos por responderUri/formId; sem resolução =>configuração pendente. Atividade READY só com mapeamento/audiência/vigência/versão/gestor e critérios verificados. Mesmo formulário/vínculos repetidos compartilham crédito canônico; duplicação administrativa/renomeação não gera novo crédito. Remoção lógica de vínculo preserva dados e impede novas participações se nenhuma referência ativa.

Ciência afirmativa válida1; sugestão2após revisão independente autorizada, no máximo1/uid/creditScope/versão; testes: totalScore confiável com pesos. Governança: MATERIAL1, QUESTIONS1, ambos2. Componentes não duplicam; segundo componente acrescenta somente faltante. Mudança efetiva de conteúdo/snapshot obrigatória; título/reenvio não basta. Primeiro baseline sem evidência fica NEEDS_REVIEW, não grant automático. Correção administrativa tem categoria fixa, motivo, expectedAwardVersion; override não pode ser sobrescrito por Forms: diferenças ficam NEEDS_REVIEW.

Checklist: assinatura aceita pelo backend e responsável efetivo validado; próprio0, substituto-1responsável/+1signatário, mesmo com assinatura incompleta aceita. Obrigação fixa por dia. Par sempre atômico, soma0, estorno/realocação auditável. Não pontuar requests pendentes/recusados. Manter assinatura/revisão/justificativas/elegibilidade. Remover novos +1legados desse produtor; créditos antigos permanecem em scores histórico. Callable histórica não é dependência do novo caminho Spark preparado. O leitor operacional permanece preservado nesta publicação até homologação e disponibilidade contínua da projeção; nenhuma nova Function é implantada. Projeção confiável de responsável por dia para leitura Spark, sem expor perfis/events amplos.

## UI

Rota training/featuretrainings/permissõestrainingsRead permanecem estáveis, rótulos visíveis DESEMPENHO. Página focada saldo/percentual/ledger numerado/modalidades e ajustesChecklist separados, pendências/falhas separadas. Catálogo/player legados preservados em fonte/dados mas não na página principal. Atividades/formulários em modal próprio.

Gestão: Avaliação dos Gestores com próprio histórico e escolha de sujeito somente admin; atribuições, governança, revisões aprovadas/pendentes/recusadas, pedir validação, admin editar pontos. Formulários/modal fora do container que listeners atualizam; preservar foco/rascunhos/rolagem. Cache privado por UID ou memória; sem conexão não fingir confirmação atual. Estado404docausente=aguardando integração, não saldo0.

## Propriedade de arquivos

Root: evaluation-data.js, firestore.rules/indexes, hooks src/data.js, package/cache, documentação/deployment, credenciais/APIs externas.
Backend: EvaluationLedger.gs + ChecklistValidation.gs + responsibility Spark reader/projection + testes correspondentes.
Forms: FormsEvaluation.gs + src/form-links.js + tests forms/assignment/discovery. Não mudar manifest sem coordenação root.
UI: src/performance-ui.js + src/main.js integração/rótulos + CSS novo somente módulo. Não tocar data.js/rules.