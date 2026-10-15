# Gestão e Desempenho: evidência da consolidação

Inventário de leitura em 15/10/2026, ponto consistente 16:41:30.184 UTC. Origem FB, destino FA. Nenhuma transferência produtiva é inferida deste relatório.

| Conjunto FB | Documentos | Destino FA antes da cópia | Tratamento |
| --- | ---: | ---: | --- |
| managementAreas | 12 | 0 | IDs e responsáveis preservados |
| documents / scopedDocuments | 5 / 35 | 0 | Links Drive e escopos preservados |
| trainings | 4 | 0 | Conteúdo e versões preservados |
| trainingProgress / trainingReceipts / trainingCompletions | 1 / 1 / 1 | 0 | UID, progresso e deduplicação preservados |
| evaluationActivities / evaluationFormConfigs | 40 / 40 | 0 | Forms e regras de crédito preservados |
| evaluationAssignments / evaluationAssignmentHistory | 1 / 1 | 0 | Histórico de responsáveis preservado |
| evaluationRequests | 40 | 0 | Estados existentes preservados |
| evaluationAwards / evaluationLedger | 1 / 1 | 0 | Copiar; não recalcular nem gerar crédito |
| evaluationSummaries | 57 | 0 | Saldos existentes preservados |
| evaluationReference / evaluationRuntime / evaluationSourceReceipts | 1 / 1 / 1 | 0 | Preservar recibos históricos |
| migrationOrigins | 181 | 0 | Preservar proveniência da migração anterior |
| Total | 424 | 0 | Zero conflitos |

As demais coleções da lista fechada foram lidas e estavam vazias. `auditLogs`, `notifications` e `notificationGroups` são conjuntos compartilhados: não foram copiados em massa. A listagem de raízes confirmou sua ausência no FB nesse ponto. `users`/Authentication não são importados. `managementAuthorizationLeases`, `managementAuthorizationFences` e `managementRuntime` do FB são infraestrutura da integração antiga, preservada na origem e excluída da cópia.

## Leitores e escritores

- PWA: `management-domain-store.js`, `evaluation-store.js`, `main.js`, `data.js`; novos caminhos usam exclusivamente sessão e Firestore FA para esses dois domínios.
- Filas locais: geração `FA_CONSOLIDATED_V1`; pendências anteriores FA/FB são retidas para conciliação, sem envio automático nem descarte.
- Apps Script: `EvaluationLedger.gs` roteia Gestão/Desempenho para FA e exige marcador privado de migração completa; `TrainingValidation.gs`, `ManagementScoreValidation.gs`, `EvaluationLegacyScoreDelivery.gs` preservam a identidade dos créditos.
- Checklist: nova transferência direta em FA; entregas antigas preservam os identificadores para deduplicação.
- Ocorrências: evidência permanece no FC nesta fase; a entrega de pontuação passa a FA. Não declarar eliminação completa da dependência FC.
- Forms e relatórios: mesmos links, mesmos formulários, cursores específicos da nova geração; não trocar/zerar cursores operacionais de Eventos/Etiquetas/Checklist.
- Worker/Gateway: não são necessários para autenticar Gestão/Desempenho após esta fase. Continuam necessários às integrações de Ocorrências e primeiro login ainda não migradas.

## Cópias privadas

`%LOCALAPPDATA%\SAHMT\fa-consolidation`, sob a identidade Windows que criou os envelopes DPAPI. Contém snapshots tipados, planos, fonte/deployments Apps Script, métricas e controles anteriores. Não colocar os arquivos no Git. Conferência de restauração: 424/424, SHA-256 `389b6fa81929241a78b5bc6c538fc9c39aae737d0e36225ad55a5a420b061fcc`.
