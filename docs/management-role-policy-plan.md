# Reconciliação offline da política humana de acesso ao app

`scripts/lib/management-role-policy-plan.js` é um planejador puro e privado, preparado em
9 de outubro de 2026. Reconcilia a intenção humana v2 com a prévia offline pinada.
Não modifica perfis, ACLs, vínculos, Auth, Rules, app, broker ou snapshots. Não
possui relógio, leitor de credenciais, SDK, rede, gatilho ou executor de produção.

## Interface

```js
buildManagementRolePolicyPlan({
  previewInput, // entrada completa de buildManagementAuthorizationPreview
  preview,      // resultado existente, regenerado e comparado integralmente
  humanIntent,  // packet privado humano v2
  pins: {
    previewInputSha256, // snapshotDigest(previewInput)
    previewSha256,     // managementAuthorizationPreviewDigest(preview)
    humanIntentSha256  // snapshotDigest(humanIntent)
  }
})
```

`managementRolePolicyPlanDigest(plan)` calcula o hash canônico sem o próprio
`resultSha256`. O resultado é determinístico para a mesma entrada, ordenado por
code units e independente de referências mutáveis do chamador.

A função reutiliza `buildManagementAuthorizationPreview`, `snapshotDigest`,
`documentDigest` e `authSourceRecordDigest`. Regera a prévia completa antes de
aceitá-la. Os pins de fonte, Auth, manifesto, mapas e prévia do packet humano
precisam corresponder aos inputs verificados. Os projetos são exclusivamente
FA `sahmt-17a16` e FB `sahmt-gestao-5ae66`.

Hashes verificam integridade local. Não são assinatura da decisão humana,
aprovação de vínculo ou evidência de direitos correntes. O chamador deve obter
os pins de provas privadas revisadas e preservar a autorização humana. A função
não lê arquivos nem valida o arquivo da intenção v1 anterior: conserva apenas
seu hash histórico e retorna `previousIntentLineageRevalidated:false`.

## Contrato da intenção humana v2

O schema fechado exige `schemaVersion:1`,
`PRIVATE_HUMAN_IDENTITY_AND_PERMISSION_INTENT_V2_ONLY`, origem estática
`HUMAN_USER_MESSAGE_RELAYED_BY_PARENT_CURRENT_SESSION` e escopo
`APPLICATION_AUTHORIZATION_ONLY_NOT_PROJECT_IAM`.

Exige duas designações com aliases e UIDs distintos:

- `ADMINISTRATOR_DESIGNATED`: intenção
  `EXCLUSIVE_DESIGNATED_ADMINISTRATOR_AND_MANAGER_ALL_APP_PROCESSES`.
- `PERMISSIONS_EXCEPTION`: intenção
  `PRESERVE_CAPTURED_ROLE_PERMISSIONS_AND_ACL_EXACTLY`.
- Demais mapas: `COMMON_USERS_EXCEPT_PRESERVED_EXCEPTION`.

Cada designação precisa corresponder a um único Auth UID, sujeito Google,
perfil `users/{uid}`, mapa e ACL. Google verificado e sujeito único são evidência
da captura; não comprovam sessão atual. Email Auth e do provider precisam coincidir
com o endereço lowercase da ACL e com sua prova explícita na prévia. Email/nome
do perfil não estabelece identidade.

Provas de `contacts` e `eventMembers` contam somente o campo `uid:stringValue`
exato no escopo local. `users` exige path e campo uid correspondentes. As contagens
não criam membro canônico ou classificação. Referências de arquivos privados no
packet são apenas basenames validados, não são abertas pela função.

Papel, máscara completa de permissões, active/access, ACL e relações explícitas
de gestor observados precisam corresponder à captura e aos hashes. A versão da
ACL permanece a string do `integerValue` capturado. A exceção exige, adicionalmente,
o documento ACL tipado completo e metadados exatamente iguais à origem. Mudança
em qualquer campo, grupo, autoria ou tempo interrompe.

Se a exceção possuir papel `administrador_app` ou `permissions.admin:true`,
a preservação exata conflita com exclusividade: o planner interrompe com
`ROLE_POLICY_EXCEPTION_ADMIN_EXCLUSIVITY_CONFLICT`, inclusive se o perfil estiver
negado. Não escolhe silenciosamente qual decisão aplicar.

## Classificação de acesso separada do papel capturado

`entries[].applicationPolicyIntent.classification` recebe somente:

| Classificação | Significado na proposta |
| --- | --- |
| EXCLUSIVE_ADMINISTRATOR | Designação humana exclusiva para administração do app |
| PRESERVED_EXCEPTION | Preservação exata de papel, permissões e ACL capturados |
| COMMON_USER | Classificação de autorização ao app para os demais mapas |

`sourceEvidence.role` e a máscara capturada ficam intactas. Não se escreve
`usuario`, `temporario` ou outro papel sobre anestesiologista/residente/gestor,
nem se usa o papel profissional como política administrativa. Um papel legado
admin fora do designado permanece evidência e gera divergência explícita, com
reconciliação exigida antes de ativação.

Funções profissionais, permissões operacionais e elegibilidade de conteúdo são
preservadas como intenção. Nenhuma lista de permissões é resetada e não se
calcula delta, overlay ou grant. Uma máscara administrativa explícita de outro
usuário gera gate para decidir e implementar a compatibilidade por escopo;
não é retirada automaticamente.

O administrador não recebe doze relações de gestor fabricadas. O planner conserva
somente as listas explícitas e registra as relações de gestor fora do designado.
Administração de todos os processos é intenção de política futura do app, não
participação inventada em cada área nem propriedade IAM do projeto.

Perfil negado mantém sourceDenials e zero acesso proposto, inclusive o administrador
designado. DEFER permanece sem conta Google, importação, login, binding ACL ou
concessão. A classificação COMMON_USER não resolve os 53 vínculos sem Google.

## Resultado sem autoridade ou payload de aplicação

Todo resultado contém:

- `productionAuthorized:false`, `authorizationReady:false`, `writeEnabled:false`;
- `operationalFreshnessEvaluated:false`, `capturesAtomicTogether:false`;
- surfaces Gestão e Desempenho false;
- grants, leases, runtimeContexts e authImportRecords vazios;
- efeitos Firestore/Auth/gatilhos e contadores efetivos iguais a zero;
- ausência de operations, patches, authorizationVersion, confirmedAt e validUntil.

`structurallyReviewed:true` significa somente que as entradas pinadas passaram
pelas validações locais. Não elimina qualquer gate operacional.

Cada entry conserva somente evidência necessária, mapa proposto, classificação,
negações e divergências. `capturedProfileVersion` é a versão histórica, quando
existir; ausência fica null. `proposedMemberId` vem do manifesto e não passa a ser
memberId canônico. O resultado não contém emails, nomes, providerData, documento
ACL bruto, tokens ou respostas. Continua privado por conter UIDs e relações.

A elegibilidade histórica de ACL/conteúdo/pares é preservada por evidência da prévia
e `eligibilityEvidenceSha256`; nenhum grupo ou relação se torna permissão efetiva.
KEEP_FA e REBUILD conservam a classificação já conferida pelo manifesto e não
autorizam cópia. A rotina cancelada de treinamentos não é retomada.

## Gates concretos de integração

1. **Política administrativa:** `src/main.js` restringe Home/rota Gestão por
   `can('admin')`. `scripts/lib/management-auth-broker.js:validateSource` hoje
   calcula entrada por permissões OU área/grupo. Essa normalização precisa
   reconciliar a intenção exclusiva com um gate explícito e protegido, coerente
   com UI/Rules, antes de alimentar o broker. Uma área/grupo nunca deve substituir
   o gate de superfície. Não conectar este resultado diretamente a readFaAuthorization.
2. **Política em todo o app:** source role/admin ainda elevam `can` e Rules FA.
   Implementar a política independente requer contrato de projeção e todos os
   escritores/leitores versionados; só classificar no planner não corrige esses
   caminhos. Diferenças de papel ou gestores capturados exigem reconciliação.
3. **Fonte corrente:** Auth/Firestore foram capturados separadamente. Exigir
   identidade Google atual, checkRevoked, active/access, ACL corrente, versão
   monotônica e binding canônico protegido. Nenhuma data nova é fabricada aqui.
4. **Exceção e escopos:** manter paridade de papel, máscara e ACL completas;
   separar elegibilidade documental das permissões administrativas. Fontes
   incompletas ou divergentes interrompem antes de concessão.
5. **Infraestrutura:** budget fresco e independente FA/FB, host/IAM, CAS/fence,
   revogação, TTL aprovado, Rules de recursos, adapters e dispositivo real
   continuam pendentes. As Rules FB atuais negam todos os recursos; o get de
   lease próprio não concede conteúdo. O planner não publica ou modifica Rules.

Os gates obrigatórios permanecem mesmo sem divergência local. Há gates adicionais
para administrador designado negado/não elevado, admin legado, máscara privilegiada
de COMMON_USER, relações externas de gestor, DEFER, ACL não resolvida, negações e
ausência de versão/memberId canônicos.

## Segurança e ensaio local

Entrada precisa ser JSON de dados, sem getters, hidden/symbols, protótipo custom,
ciclos, arrays esparsos ou números não finitos. Limites: profundidade 80, um milhão
de nós e 16.777.216 caracteres acumulados de strings/chaves. Erros são códigos
estáticos sem dados pessoais.

`node --test tests/management-role-policy-plan.test.js` usa somente fixtures
sintéticas. Verifica determinismo, pins, regeneração, schema/enums, zero efeitos,
roles e máscaras intactas, grupos/memberships, DEFER/negados, conflitos da exceção,
ACL tipada completa, roster por UID e JSON adversarial. Não comprova APIs, IAM,
broker hospedado, publicação, login real ou custo de produção.

Uma execução sobre os backups reais só pode gerar arquivo privado novo ignorado,
cifrado AES-GCM/DPAPI CurrentUser com CreateNew/wx e receipt agregado após revisão.
Nesta implementação não foi gerada ou substituída nenhuma captura/prévia privada.
