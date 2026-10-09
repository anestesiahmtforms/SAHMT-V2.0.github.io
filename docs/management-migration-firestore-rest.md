# Transporte REST da migração de Gestão

`createManagementMigrationFirestoreRest` fornece somente `readDestinationPair` e
`commitCreatePair` para o executor existente. Permanece desligado por padrão. Não
obtém aprovação, contexto fresco, orçamento, credencial, lock ou checkpoint por
conta própria; não constitui uma CLI de migração nem liga Gestão à PWA.

## Configuração confiável de servidor

A ativação requer propósito `MANAGEMENT_MIGRATION_CREATE_ONLY`, `planSha256` e
uma allowlist imutável de pares:

```js
{
  path,
  provenancePath,
  documentFieldsSha256: snapshotDigest(operation.fields),
  provenanceFieldsSha256: snapshotDigest(operation.provenanceFields)
}
```

Os pares devem vir do plano já regenerado e conferido pelo executor. O transporte
aceita exclusivamente FA `sahmt-17a16`, destino FB `sahmt-gestao-5ae66` e banco
`(default)`. Não aceita coleções operacionais, usuários, fila de pedidos,
runtime ou projeções derivadas como documento de negócio da migração. O digest e
a allowlist restringem o transporte; não substituem a cápsula autorizada nem
atestam identidade, ACL, IAM ou atualidade do plano.

`getAccessToken({projectId,databaseId,authorizedPurpose,operation},{signal})`
retorna uma string OAuth administrativa obtida e conferida no servidor confiável.
`fetchImpl` é injetado, sem fallback para fetch global. Não passar token Firebase
de usuário FA, API key ou credencial administrativa pelo navegador. O provedor
real precisa comprovar principal/IAM e escopo datastore ou cloud-platform; o
adapter não inspeciona ou certifica essas permissões a partir da string.

## Leitura e criação

A leitura faz um único `documents:batchGet`, com os dois nomes pinados e
`readTime` fixado no maior instante entre um segundo antes do relógio local e o `commitTime` confirmado daquele par na mesma instância. A comparação conserva nanossegundos com BigInt. Para o wire batchGet, a pós-conferência arredonda o instante confirmado PARA CIMA ao próximo microssegundo, incluindo carry de segundo/dia, porque readTime exige precisão de microssegundo. Assim nunca consulta um snapshot anterior ao commit; não usa Date.parse para truncar a fração. O registro acontece somente após a resposta validada dentro do prazo; uma resposta desconhecida não ancora leituras. Confere ambos os resultados,
sem duplicatas ou documentos adicionais, na mesma hora solicitada; normaliza a
ordem e ausências para o contrato do executor, preservando tipos Firestore. Erro
ou divergência não produz `consistent:true`. [API batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet)

A criação usa somente `documents:commit`, com exatamente documento e proveniência
na ordem conferida, campos com digests pinados e `currentDocument.exists:false`
em ambos. Máscaras, transforms, updateTime, delete, sobrescrita e terceiro documento
são negados antes da credencial. A resposta normalizada associa o resultado de
índice i ao nome da escrita i; a API não retorna paths no writeResult. Essa operação
é atômica para o par, não para o conjunto da migração. [API commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)

## Falhas e limites

Timeout padrão 20 segundos, máximo 30; limite padrão de request 4 MiB e resposta
8 MiB. O relógio monotônico acompanha o prazo, além do relógio de parede. A
reserva é consumida antes de obter credencial e nunca devolvida. O limite total é três reservas por par pinado (leitura, commit e pós-conferência explícita), sem retry automático. IDs repetidos ou
segunda tentativa do mesmo commit são negados na instância. Retomada entre
processos depende dos checkpoints duráveis e reconciliação do executor.

Não há retry, batchWrite, redirect ou chamada FA. Um erro após despachar commit,
inclusive resposta malformada ou recusa HTTP, retorna
`MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN`; o executor preserva a intenção e exige
reconciliação dos dois documentos antes da retomada. AbortSignal não prova que
uma escrita remota foi cancelada. Uma credencial ou resposta recebida depois do
prazo não inicia transporte nem confirma commit.

Corpos e erros remotos não vão para logs/erros públicos. O adapter conserva dados
apenas na memória do chamador. Orçamento anterior à leitura, contexto fresco,
isolamento FB, auditoria, proteção de backups e confirmação humana antes de
cortar escritores FA continuam responsabilidade da composição confiável.

A suíte `tests/management-migration-firestore-rest.test.js` usa Responses e relógios
sintéticos, sem credenciais, Firebase ou dados reais. Não comprova IAM, wire format
real, custo ou execução produtiva.
