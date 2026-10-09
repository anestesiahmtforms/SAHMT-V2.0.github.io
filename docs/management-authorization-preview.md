# Prévia privada de identidade, relações e público de Gestão

`scripts/lib/management-authorization-preview.js` é um gerador puro offline.
Recebe snapshots locais pinados e produz evidências e propostas para revisão.
Não é uma projeção normalizada consumível pelo broker/browser: não fornece
sourceVersion/authorizationVersion, contexto fresco, binding aprovado, lease,
custom token, registro Auth ou documento de concessão.

## Interface e pins

```js
buildManagementAuthorizationPreview({
  sourceSnapshot, destinationSnapshot, sourceAuth,
  manifest, policy, aclBindings, pins
})
```

Os snapshots Firestore usam o schema tipado do planejador existente. Auth usa o
snapshot normalizado existente. `manifest` contém classificação e mapa v2;
`prepareSplitPlan` precisa continuar estruturalmente pronto. Hashs obrigatórios:
sourceSnapshotSha256, destinationSnapshotSha256, sourceAuthSha256, manifestSha256,
identityMappingsSha256, policySha256 e aclBindingsSha256. `snapshotDigest`,
`documentDigest`, `authSnapshotDigest` e `authSourceRecordDigest` são reutilizados.
O resultado tem `resultSha256`, calculado sem esse próprio campo.

Objetos precisam ser JSON de dados, sem getters, propriedades escondidas,
protótipos personalizados, ciclos ou arrays esparsos. A ordenação é lexical por
code units, independente do locale. Erros têm códigos estáticos sem dados privados.
O resultado não retém referências mutáveis aos inputs.

## Política de superfície

A política pinada exige schemaVersion 1, version, sourceProjectId/destinationProjectId,
mode OFFLINE_PROPOSAL_ONLY, baseline FA_APP_MANAGEMENT_ADMIN_ONLY,
managementSurfaceEnabled false, performanceSurfaceEnabled false e
cancelledTrainingRemainsStopped true. futureManagementGate aceita somente DENIED
ou ADMINISTRATOR_ONLY. Mesmo a segunda opção é intenção futura sem concessão.

O código atual da Home/rota Gestão verifica admin. `managementRead`, uma relação
de gestor/membro, grupos documentais ou `trainingsManage` não podem substituir
esse limite e ampliar a superfície. Isso não prova a configuração global publicada:
flags de appConfig capturadas são evidência histórica separada. Na captura usada
nesta etapa existe appConfig/labelStaff; management/trainings e os containers de
flags conhecidos estão ausentes. Ausência no escopo não é prova de bloqueio da UI.

Todo retorno contém productionAuthorized false, authorizationReady false,
writeEnabled false, surfaces management/performance false e arrays vazios grants,
leases, runtimeContexts e authImportRecords. Contadores de permissões, memberships,
ACLs e contextos efetivos são zero. Não há executor, rede ou CLI de produção.

## Evidência separada de proposta

- Perfis: role, permissions e flags capturados ficam em sourceEvidence. São
  validados pela whitelist FA, sem ampliar permissão por catálogo de role/nome.
  O predicado admin capturado diferencia um perfil ativo com access de uma role
  admin em perfil negado. Não é acesso concedido.
- Identidade: faUid/proposedFbUid/proposedMemberId vêm exclusivamente do mapa
  pinado, um para cada perfil/Auth capturado. Mapa duplicado, UID remapeado,
  memberId divergente ou registro desconhecido interrompem a prévia. memberId
  ausente não é fabricado no perfil; version ausente fica null e é gate explícito.
- Auth: Google único, emailVerified e disabled capturados classificam somente
  evidência histórica. DEFER_UNLINKED_SOURCE_CAPTURE_ONLY preserva o mapa e não
  cria conta FB, provider, login, contexto ou grants. Não se infere anonymous.
- Áreas: listas managerUids/memberUids explícitas geram relações para revisão.
  Perfil negado, área inativa ou identidade não confirmada são preservados como
  sourceDenials; membershipEffective e createsPermission permanecem false.
  Autoria/configuração/designação não é usada para inventar participação em área.
- Recursos: a classificação COPY/KEEP_FA/REBUILD do manifesto fica associada à
  evidência/proposta. KEEP_FA/REBUILD nunca têm destinationCandidateRequestedByManifest
  true. COPY indica somente classificação solicitada, não operação autorizada.
- Documentos genéricos não recebem GENERAL por padrão: ficam como
  LEGACY_AUDIENCE_UNSPECIFIED. scopedDocuments preservam grupo explícito.
- Configurações/atividades exigem pares, áreas, versões positivas, status e grupos/UIDs
  coerentes. Marcadores publicados são históricos; não certificam ACL corrente ou
  status READY. PENDING permanece gate, sem runtime, trigger ou segundo consumidor.
- A autoria ARCHIVED_UNRESOLVED validada pelo manifesto estreito permanece somente
  histórica: não entra nos mapas, candidatos de identidade, Auth, memberships ou ACL.

## Prova de intenção ACL

`aclBindings` é uma lista privada explícita de:

```js
{schemaVersion: 1, path, sourceDocumentSha256, faUid, googleUid,
 authRecordSha256, classification: 'CAPTURED_INTENT_ONLY'}
```

O UID já deve existir no mapa, com Google subject capturado único. O path/hash deve
ser da ACL capturada; email Auth e do provider Google precisam coincidir com o
email lowercase da ACL, com um único proprietário no Auth selecionado. Essa
correlação resolve somente intenção documental para uma identidade já pinada;
não cria identidade por email. Email/displayName/sigla do perfil não são prova.
Não se usa título, categoria ou nome para vínculo.

Prova repetida, usuário/Google/hash divergente, ACL inválida, ambiguidade de email,
grupo duplicado ou ator desconhecido interrompem. Sem prova, a ACL fica intenção
não resolvida com binding null; o snapshot não permite associar os 53 DEFER a
Google por email. Mesmo com prova, grantEffective/active/access são false, e
perfil negado permanece explicitamente negado. A saída não contém emails, nomes,
questions/answers ou providerData; prova com path email continua privada no input.

A prova offline não equivale a email_verified/sign_in_provider de uma sessão
corrente, frescor, checkRevoked ou ACL atual do Drive/Form. Não alimenta documentGroups
efetivos no broker. Ainda é necessário leitor real com vínculo privado revisado.

## Gates que permanecem

1. Autoridade versionada/coerente, binding aprovado e contexto realmente fresco.
   Firestore e Auth foram capturados em horários separados; não são snapshot
   atômico conjunto. O gerador não fabrica tempo de confirmação/expiração.
2. Token Google atual, status do perfil e revogação conferidos; permissão de
   superfície explicitamente aprovada. Treinamentos cancelados continuam parados.
3. notificationGroups ausente do escopo capturado não comprova coleção vazia;
   qualquer escopo dependente deve obter cobertura própria antes de ativação.
4. ACL real, paridade com Rules, host/broker/browser, CAS e canonical persistence.
5. Orçamento fresco por projeto, com FA/FB independentes e pausa humana persistente,
   antes de I/O futuro. Hashs e prévias offline não são autorização de produção.

## Verificação local

`node --test tests/management-authorization-preview.test.js` executa somente doubles
locais. A suíte cobre determinismo/reexecução, zero efeitos, admin/DEFER/negados,
policy/pins/cobertura/tipos/versões, collisions, UID desconhecido, intenção ACL,
retenção KEEP_FA, público legado, pares/status e JSON adversarial. Não demonstra
login real, IAM, persistência, revogação remota ou fluxo em dispositivo.

Prévia com dados reais só pode ser gravada em novo arquivo privado ignorado,
AES-GCM/DPAPI CurrentUser e CreateNew/wx, acompanhada por receipt agregado. Não
substituir manifesto/plano v2 nem emitir documentos/identificadores privados em logs.
