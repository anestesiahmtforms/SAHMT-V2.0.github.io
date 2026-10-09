# Adapter Firestore REST do broker Gestão — preparação local

Unidade de 9 de outubro de 2026. Código de servidor em
`scripts/lib/management-broker-firestore-adapter.js`, desativado por padrão.
FA = `sahmt-17a16`; FB = `sahmt-gestao-5ae66`; bancos `(default)`.
Não há deployment, credencial descoberta, projeto criado, writer da fonte,
permissão concedida, Auth importado, faturamento ou chamada real às contas.

## Interface e identidade

`createManagementBrokerFirestoreAdapter({enabled:false, fetchImpl,
getAdminAccessToken, readFaAuthUser, reserveFirestoreReads, policy, clock?,
monotonicNow?})` oferece os quatro adaptadores exigidos pelo núcleo:

| Método | Entrada permitida | Saída |
| --- | --- | --- |
| readFaAuthorization | `{uid,projectId:FA}` | Contexto normalizado, Auth atual, versão de direitos, revisão e readTime da fonte |
| readFbLease | `{uid,projectId:FB}` | `{exists,revision,lease}` com metadados do servidor; ausência é null/null |
| writeFbLease | `{uid,projectId:FB,expectedRevision,lease}` | CAS confirmado ou `{applied:false}` |
| invalidateFbLease | `{uid,projectId:FB,expectedGrantId,expectedLeaseVersion,reasonCode}` | Resultado condicional com `fenced` confirmado somente quando seguro |

O último argumento dos métodos é contexto privado `{signal,deadlineMs,
firestoreReservation?}`. Nenhum método é endpoint do navegador. UID/lease
são derivados pelo núcleo confiável, depois de verificar a prova FA e vínculo;
a validação de shape deste adapter não substitui essa autoridade.

`getAdminAccessToken({projectId,purpose,scopes:[datastore]},context)` deve
retornar somente no servidor `{credentialType:'google-oauth2',accessToken,
expiresAtMs,scopes}`. Escopo datastore ou cloud-platform é obrigatório. JWT
Firebase de participante não é OAuth administrativo. Não há ADC, variável de
ambiente lida, OAuth persistido nem token exposto por este módulo.

A ponte Auth Apps Script atual NÃO fornece datastore/OAuth ao Worker. O host
futuro deve fornecer esta interface por identidade administrativa confiável ou
implementar um gateway Firestore fechado separado. Não copiar tokens da ponte
para o cliente e não acrescentar um endpoint genérico de documentos.

## Paths e transporte fechados

Somente os paths constantes abaixo são usados:

- FA `managementSourceContexts/{uid}`: contrato local de fonte privilegiada.
- FB `managementAuthorizationLeases/{uid}`.
- FB `managementAuthorizationFences/{sha256(canonicalJson([uid,grantId]))}`.

A escolha do path FA é preparação local, não prova de coleção produtiva existente
nem autorização para escrever uma projeção fictícia. Não há get/list/query/write
arbitrário, delete, import, ledger financeiro ou conteúdo neste adapter.

RPCs REST são POST para `firestore.googleapis.com/v1/projects/{FA|FB}/databases/(default)/documents:`
seguido exclusivamente de `batchGet`, `beginTransaction`, `commit` ou `rollback`.
HTTPS, URL retornada, ausência de redirect, JSON e Age ausente/zero são conferidos.
O corpo é lido como JSON com limites de bytes/chunks e UTF8 válido. Não existe
fetch global nem retry. `batchGet` exige todos e somente os documentos pedidos,
sem duplicação/ambiguidade. Resposta streamed REST serializada como array JSON
é aceita; outro formato nega sem ampliar o parser automaticamente.

Os únicos Values aceitos são null, boolean, string, inteiro seguro não negativo,
array e map. Timestamp/reference/bytes/double inesperados negam o schema preparado.
Getters, propriedades privadas inesperadas, protótipos customizados, arrays
esparsos, ciclos, limite estrutural ou números incompatíveis negam. Nenhum erro
remoto cru, OAuth, e-mail, hash de senha ou documento é incluído em erro/log.

## Fonte FA: nenhuma conversão de preview em autorização

Uma única leitura forte lê o contexto completo. São obrigatórios:

- schemaVersion 1; projetos FA/FB exatos; `productionAuthorized:true`,
  `coverageComplete:true` e policyVersion pinada pelo host.
- authorizationVersion positiva e sourceVersion idêntica; sourceHash SHA256.
- confirmedAtMs não futuro/fresco; validUntilMs vigente, dentro da duração
  máxima explícita. A validade é conferida novamente após consultar Auth.
- perfil ativo/access, UID/memberId estáveis, papel e todas as 14 permissões
  conhecidas do núcleo como booleanos; vínculo FA/FB/UID/memberId exato.
- áreas versionadas, relações sem duplicação e grupos GENERAL/RESTRICTED.
- sourceAuthValidAfterTimeMs igual ao watermark Auth FA recém-consultado.

`readFaAuthUser` é o `readFaAuthUser/getFaUser` do adaptador Google Auth preparado,
com identidade Google, disabled/emailVerified e revogação frescos. Não se usa
Auth armazenado na fonte como prova atual. sourceHash é recalculado exatamente
sobre a normalização usada pelo núcleo: projetos, UIDs, membro, versão, ativo,
elegibilidade, papel/permissões, áreas efetivas ordenadas, grupos, watermark e
Google UID. Uma relação ativa de documento exige Google UID correspondente.
Versão regressiva ou hash diferente na mesma versão nega na instância.

A saída contém somente o contrato de servidor esperado pelo broker, incluindo
sourceRevision. A revisão é updateTime REST original; não é uma data local ou
contador inventado. Metadados de leitura são os readTime reais retornados.

**Writer ainda ausente:** productionAuthorized/coverageComplete não comprovam
por si que todos os escritores FA atualizaram a projeção. Antes de produção é
necessário o escritor privilegiado coerente, versionamento durável, Rules que
proíbam escrita cliente, revogação e limite de propagação auditado. A proteção
local contra regressão não substitui estado durável entre reinícios.

O contexto servidor inclui relações de membros/gestores. Não publicar essas
listas integrais como projeção browser sem revisar a minimização. O navegador
precisa apenas do próprio perfil/vínculo, versão/hash e elegibilidade; sua fonte
mínima deve ser mantida pelo mesmo writer confiável e reconciliada com este hash.

## Lease, CAS e fence

readFbLease distingue documento ausente de resposta inválida. updateTime conserva
nanossegundos e serve como precondição REST exata. A validação de ordenação entre
createTime/updateTime/readTime e commit usa precisão de nanossegundos; a política
de frescor continua expressa em milissegundos.

writeFbLease abre uma transação read-write FB, lê nela o lease atual E o fence do
novo grant, depois confere revisão, membro, versão consecutiva e versão/hash da
fonte. Fonte igual não rearma lease revogado nem permite mudar hash. Fence
existente impede a escrita mesmo se o lease ainda não existir. O commit substitui
o documento inteiro, sem updateMask/merge. Criação usa exists:false; atualização
usa updateTime exato. Permissões antigas não são conservadas por merge.

invalidateFbLease abre outra transação e lê lease/fence. Cria um fence durável
se ausente, inclusive quando não há lease ou o grant já foi substituído. Só
revoga o lease quando grantId E leaseVersion correspondem; conserva integralmente
um grant posterior. Fence e revogação correspondente são escritos atomicamente.
Não há TTL, exclusão ou purge de fences implementado. Sua retenção permanente
nesta unidade é deliberada; uma futura limpeza precisa provar que nenhum writer
antigo/retry/resultado desconhecido poderá usar o grant.

A transação CAS também lê o mesmo fence. Portanto um cancelamento concorrente
conflita com um CAS iniciado antes da gravação do fence. ScriptLock, updateTime
isolado ou cancelamento local não substituem essa leitura transacional.
Os doubles locais exercitam esse cenário; não comprovam a configuração/concurrency
mode, transação ou permissões do Firestore real.

HTTP409/412 com status REST ABORTED/FAILED_PRECONDITION produz conflito conhecido
sem retry. Erro de rede, HTTP503, corpo inválido ou prazo após envio de commit
produz erro sanitizado com `requiresReconciliation:true`. Nenhuma dessas falhas
informa fenced:true ou libera reserva. Resposta de commit precisa comprovar todos
os writeResults/updateTime e commitTime. readback/revalidações finais continuam
no núcleo, antes de entregar customToken. Uma troca abortada deve chamar a
invalidação condicionada com reserva própria ou permanecer para reconciliação.

Rollback é best effort apenas antes do envio de commit, no prazo e reserva
originais. Não abre janela de limpeza nova, não autoriza retry, nem apaga fence.
O host mantém o supervisor/journal de resultados desconhecidos e recupera sem
reapresentar uma escrita como se ela não tivesse ocorrido.

## Orçamento antes de I/O

Cada invocação chama reserveFirestoreReads antes de obter OAuth, consultar Auth
ou Firestore. A reserva cobre uma unidade fechada, sem retry: fonte 1 documento,
lease 1 documento, CAS 2 documentos, invalidação 2 documentos. Estes são mínimos
de documentos explicitamente pedidos pelo código, não teto global certificado
de consumo/infraestrutura. O host deve revisar seus máximos operacionais e
configurá-los com as mesmas margens/limites do núcleo/ledger.

Antes de cada RPC, o adapter confere novamente prazo, cancelamento, dia e validade
da reserva. O batch só pode consumir o máximo restante da unidade. Limpeza é uma
invocação separada, portanto pede reserva nova. Nunca ocorre retry automático.

A policy exige dailyLimits próprios FA35k/45k e FB35k; FA45k precisa da evidência
privada USER_FA_DAILY_LIMIT_45000_2026_10_08. Recibo completo/fresco, pausa humana
false, margens positivas de app/atraso e soma estritamente abaixo do teto são
obrigatórios. IDs consumidos são tombstones locais; regressão de métricas e
contabilidade agregada insuficiente negam. Capacidade esgotada nega, sem apagar
IDs para fabricar saldo. Policy é copiada antes do primeiro await.

O núcleo já reserva antes de chamar adapters. Este adapter exige também sua
conferência independente: o callback recebe `upstreamReservation` somente como
referência privada. Um host confiável pode validar/adotar essa reserva já
registrada e devolver recibo completo atual, com consumo único durável; isto
NÃO está implementado. Injetar diretamente ledger.reserveFirestoreReads cria
uma segunda reserva conservadora e reduz margem, como na composição sintética.
Não fabricar recibo a partir dos campos reduzidos do contexto.

Medição confiável, integração durável/adopção, atribuição, retenção e autoridade
humana continuam gates. Renovação diária não remove pausa. Métricas alternativas
não são somadas. O módulo não consulta Monitoring nem apresenta corte global
exato; o host não deve depender do caminho Apps Script que exigiu faturamento.

## Policy do adapter

Campos obrigatórios (sem valores produtivos presumidos): schemaVersion=1,
policyVersion, operationTimeoutMs (1..120000), maxResponseBytes (1024..1048576),
maxResponseChunks (1..1024), maxSnapshotAgeMs/sourceMaxAgeMs (1..300000),
maxFutureSkewMs (0..60000), sourceMaxLeaseMs/leaseMaxDurationMs (1..86400000),
maxReservationRecords/maxSourceVersions (1..100000) e readBudget.

readBudget tem dailyLimits, evidência de FA45k quando aplicável, quotaTimezone
America/Los_Angeles, maxMeasurementAgeMs (1..300000), margens positivas e
operationReadBounds com as quatro operações exatas. Policy, fonte e durações
precisam ser reconciliadas com browser, núcleo, ledger e Rules antes de habilitar.
Os valores sintéticos dos testes não aprovam uma política produtiva.

Cada operação conserva um prazo lógico e monotônico único. Contexto externo,
reserva e OAuth só podem encurtá-lo. Timer, dispose e cancelamento negam resultados
tardios, mas não cancelam de forma garantida o commit enviado. Não há nova
credencial automática, retentativa ou extensão de prazo.

## Verificação local e próximos gates

65 testes focados passaram em 9/10/2026:

`node --test tests/management-broker-firestore-adapter.test.js tests/management-firebase-app.test.js`

Os testes exercitam fonte falsa/preview/stale/hash/versão/vínculo/revogação,
projetos/path/schema, readTime/revisão, orçamento, CAS inteiro, concorrência de
fence, cleanup ausente/grant novo, commit incerto, timeout, cancelamento,
transporte e composição com o núcleo real. O REST/Auth/budget é sintético em
memória. Nenhuma chamada a conta Google/Firebase foi realizada.

getManagementApp foi corrigido para conferir projectId, appId e authDomain de
uma instância nomeada existente, antes de reutilizá-la; testes usam VM/doubles.

Antes de publicação: writer da fonte e projeção mínima browser; binding e
migração/reconciliação de Auth; identidade/escopos/IAM datastore mínimos;
ledger e supervisor duráveis; host/transporte; Rules dos recursos FB; integração
PWA; backups/rollback; leitura de métricas permitida sem habilitar faturamento;
validação real de sessão, revogação e dispositivo. Este adapter não ativa nenhum
desses itens nem concede Gestão ao estar autenticado.

Referências oficiais usadas para os formatos REST:

- [batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet)
- [beginTransaction](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/beginTransaction)
- [commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)
- [Write](https://firebase.google.com/docs/firestore/reference/rest/v1/Write)
