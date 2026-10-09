# Contexto fresco da cópia de Gestão

`scripts/lib/management-migration-context.js` é um validador puro. Não tem SDK,
credencial, rede, relógio implícito, leitura/escrita de arquivo, gatilho ou executor.
Apenas verifica packets reais fornecidos por uma composição de servidor confiável.
Não cria uma cápsula de aprovação e não remove pausa ou ativa acesso.

## Interface para a CLI

```js
const result = buildManagementMigrationContext({
  sourceSnapshot, manifest, destinationSnapshot, plan, approval,
  evidence, nowMs
});
// result.context: contrato freshContext do executor, sem executar leituras.
// result.counts: somente agregados seguros.

const review = assessManagementMigrationContext(sameInput);
// {ready, gates:[{gate, code}], ...agregados seguros quando ready}
```

A cápsula existente é validada pelo núcleo do executor, inclusive plano
regenerado, pins e janela autorizada. Não usar saída do assessor como autorização.
`build` lança erro estático com `code` e `gates`; `assess` devolve apenas códigos,
contagens e datas, nunca documento, UID, e-mail, resposta Auth ou observação bruta.

## Packet evidence obrigatório

`schemaVersion:1`, `mode:CURRENT_MANAGEMENT_MIGRATION_EVIDENCE`, com:

| Campo | Conteúdo |
| --- | --- |
| currentSourceSnapshot | Snapshot Firestore atual FA, completo/consistente nas mesmas 43 árvores selecionadas do backup. |
| currentDestinationSnapshot | Snapshot FB atual, completo/consistente nas 44 árvores selecionadas, incluindo migrationOrigins. |
| previousSourceAuth / currentSourceAuth | Snapshots normalizados Auth FA completos, anterior revisado e atual. |
| previousDestinationAuth / currentDestinationAuth | Snapshots normalizados Auth FB completos, anterior revisado e atual. |
| previousSourceAuthRawUsers / currentSourceAuthRawUsers | Arrays completos rawUsers dos packets Auth FA protegidos; apenas em memória. |
| previousDestinationAuthRawUsers / currentDestinationAuthRawUsers | Arrays completos rawUsers Auth FB anteriores/atuais. |
| destinationMetadata | Prova atual READ_ONLY_METADATA da CLI management-project-preflight.mjs para FB. |
| destinationRules | Packet atual projectId/release/source das Rules FB, ligado à prova metadata. |
| configuredProducerRegistry / producerInventory | Registro pinado e observações atuais dos produtores configurados, descritos abaixo. |
| pins | Os 14 hashes de integridade abaixo, obtidos das provas privadas revisadas. |

Os pins usam `snapshotDigest` para currentSourceSnapshot,
currentDestinationSnapshot, destinationMetadata, destinationRules,
configuredProducerRegistry e producerInventory, com os nomes:
`currentSourceSnapshotSha256`, `currentDestinationSnapshotSha256`,
`destinationMetadataSha256`, `destinationRulesSha256`, `producerRegistrySha256`,
`producerInventorySha256`.

Para os quatro snapshots Auth, usar `authSnapshotDigest` e os nomes
`previousSourceAuthSha256`, `currentSourceAuthSha256`,
`previousDestinationAuthSha256`, `currentDestinationAuthSha256`.
Para os quatro arrays rawUsers, usar `authRawSnapshotDigest` e os nomes
`previousSourceAuthRawSha256`, `currentSourceAuthRawSha256`,
`previousDestinationAuthRawSha256`, `currentDestinationAuthRawSha256`.

Hashes não autenticam uma captura, decisão ou coletor. Um packet autodeclarado
pelo navegador, ou preenchido com datas/flags convenientes, não é evidência.
A CLI deve abrir backups/receipts protegidos, comprovar captura/paginação e
configuração real do coletor antes de fornecer estes objetos. Dados privados
permanecem em memória e arquivos protegidos fora do Git.

## Verificações dos dados e identidades

Snapshots atuais têm no máximo cinco minutos. O conjunto de paths, campos tipados,
createTime e updateTime de **todos** os documentos FA/FB selecionados deve ser
igual ao conjunto revisado. ACLs e users também participam dessa comparação; um
novo hash de um documento alterado não atualiza silenciosamente o plano. Mudança,
ausência, cobertura parcial ou árvore omitida interrompe.

O pin ACL é o `snapshotDigest` da lista documentAccessEmails do sourceSnapshot,
na ordem da captura revisada, como no review v2. Identidade preserva exatamente
os mappings do manifesto. Perfil deve ter uid/path correspondente, flags
active/access explícitos, permissões tipadas e memberId compatível quando houver.
Uma negação de perfil permanece negada: copiar autoria não é conceder elegibilidade.

Auth exige o mesmo conjunto completo de UIDs anteriores/atuais e igualdade de
`authSourceRecordDigest` para cada registro normalizado e bruto. Isso detecta
novo UID, provedores, desativação, vínculo, metadados de revogação ou outro delta
que precise de revisão. RawUsers devem normalizar exatamente para os snapshots.
Google exige um único provider/sujeito, conta verificada e habilitada, sem colisão
de UID/sujeito/e-mail. Os UIDs conhecidos referenciados por COPY exigem Google
reconciliado. Os demais sem provedor continuam DEFER, sem importação ou grant.

Autoria arquivada explicitamente validada pelo manifesto não recebe uma conta
Google fictícia. active/access negados e o ator ARCHIVED_UNRESOLVED são conservados.
Snapshots Auth e Firestore têm horários separados; esta comparação não afirma
snapshot atômico entre serviços nem implementa checagem de sessão com revogação.

Metadata FB deve confirmar proprietário/principal, endpoints completos, banco
(default) Standard/Native em southamerica-east1, faturamento desligado, Google e
domínio da PWA. Rules devem corresponder ao ruleset/hash publicado e conter
exatamente a regra deny-all inicial, sem concessões adicionais.

## Produtores configurados: prova obrigatória

O destino vazio **não** prova que não existem escritores ou gatilhos.
O registry tem schemaVersion 1, scope `CONFIGURED_PRODUCERS_ONLY`, projetos FA/FB
fixos e `producers`. Cada entrada exige exatamente:

```js
{producerId, kind, ownerProjectId, configurationSha256}
```

O registro deve cobrir as superfícies configuradas APPS_SCRIPT_NATIVE,
PWA_BROWSER e CLOUD_FUNCTIONS, incluindo comprovação explícita da lista vazia
quando um coletor administrativo não encontra Functions configuradas. Pode
acrescentar BROKER_SERVER, quando houver host configurado. Configuração local
sozinha não comprova o estado publicado ou nativo.

O inventory tem schemaVersion 1, mesmo scope/projetos, `registrySha256`,
`observedAt` real e `observations` exaustivo por producerId. Cada observação exige:

```js
{
  producerId, kind, projectId, configurationSha256,
  observationMethod, observationId, observedAt,
  writerState, writeProjectIds,
  nativeJobs: [{jobId, handler, projectId, enabled}]
}
```

Métodos permitidos por kind:

| kind | observationMethod |
| --- | --- |
| APPS_SCRIPT_NATIVE | NATIVE_READ_ONLY_STATUS |
| PWA_BROWSER | PUBLISHED_CLIENT_SOURCE_REVIEW |
| CLOUD_FUNCTIONS | ADMIN_FUNCTIONS_INVENTORY |
| BROKER_SERVER | HOST_CONFIGURATION_REVIEW |

IDs são referências opacas sanitizadas, por exemplo hash da execução ou receipt;
URLs e identidades privadas não entram nas mensagens. A configuração observada
precisa corresponder ao digest registrado. Prova nativa ausente ou velha bloqueia:
não preencher nativeJobs:[] a partir da ausência de documentos FB.

`RUNNING_FA_ONLY` exige writeProjectIds exatamente [FA]; conserva produtores FA.
`STOPPED` exige alvos de escrita vazios e nenhum job habilitado. Todos os jobs
observados devem apontar explicitamente para FA; job.projectId designa o alvo Firestore da escrita, não o projeto que hospeda o script ou a Function. qualquer job configurado para
FB, mesmo desabilitado, exige revisão. O registry, o inventory e cada observação
são pinados e ligados ao projeto, método, configuração e instante real.

A validade destes fatos depende de um coletor confiável que tenha realmente
consultado os produtores e revisado o registro completo da arquitetura escolhida.
O helper valida coerência e integridade, não autentica uma declaração manual.

## Saída e gates

A validade deriva do **instante mais antigo** de todas as evidências atuais,
limitada a cinco minutos e ao expiresAt da cápsula. verifiedAt não é nowMs.
Falha ou expiração interrompe; não há renovação automática nem retries.

`destinationWriterState:STOPPED` e `destinationNativeTriggersAbsent:true` na saída
referem-se **ao inventário configurado conferido**. A saída também registra
`producerEvidenceScope:CONFIGURED_PRODUCERS_ONLY` e
`globalNativeProducerAbsenceCertified:false`; não certifica ausência global de
produtores desconhecidos. Rules deny-all comprovadas dão clientAccess DISABLED.
Nenhum desses fatos ativa autorização de negócio ou concede pontos.

Os grupos de gates são PLAN_APPROVAL, SOURCE_CAPTURE, DESTINATION_CAPTURE,
SOURCE_AUTH, DESTINATION_AUTH, ACL_IDENTITY, DESTINATION_METADATA_RULES e
PRODUCER_INVENTORY. Assessor reúne falhas independentes para revisão; somente
sucesso de todos produz contexto. Exemplos de bloqueios:

- MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP;
- MIGRATION_CONTEXT_CAPTURE_STALE;
- MIGRATION_CONTEXT_AUTH_CHANGED_SINCE_REVIEW;
- MIGRATION_CONTEXT_DESTINATION_CLIENT_ACCESS_NOT_DENIED;
- MIGRATION_CONTEXT_PRODUCER_OBSERVATION_MISSING;
- MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_STALE;
- MIGRATION_CONTEXT_DESTINATION_NATIVE_JOB_PRESENT_OR_UNKNOWN.

A retomada atual de FA continua sujeita à pausa e orçamento fresco antes de novas
capturas. Este helper não consulta métricas, Firestore ou APIs e não limpa essa
trava. FB mantém autorização independente. O treinamento cancelado não é retomado.

A suíte management-migration-context.test.js usa somente fixtures locais e verifica
mutação, ordem, pins, deltas, Auth raw, autoria arquivada, negações, Rules,
produtores e dados adversariais. Ela não prova captura/host/IAM ou migração real.
