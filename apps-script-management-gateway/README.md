# Gateway dedicado Apps Script de Gestão — preparação local

Este diretório é um projeto separado de Apps Script, preparado somente no worktree
management-firebase-split. Não existe deployment, editor configurado, secret real,
consentimento novo, IAM concedido, conta criada, endpoint operacional ou gatilho.
Os Apps Scripts existentes e o Worker de Etiquetas não são alterados.

Gateway.gs contém um dispatcher síncrono do protocolo
SAHMT_MANAGEMENT_GATEWAY_V1. O código não contém configuração produtiva nem chave;
sem as propriedades privadas completas, nega a chamada. Além da chave global
enabled, cada operação precisa estar explicitamente habilitada na configuração
pinada. Não importar este arquivo na PWA.

## Operações fechadas

| Operação autenticada | Corpo permitido | Resultado ao Worker |
| --- | --- | --- |
| AUTH_USER_LOOKUP_FA | somente uid | users com localId, emailVerified, providerUserInfo(providerId/rawId), disabled e validSince quando presentes |
| AUTH_USER_LOOKUP_FB | somente uid | mesma projeção; projeto FB fixo |
| SIGN_FB_CUSTOM_TOKEN | uid, claims, issuedAtSeconds, expiresAtSeconds | somente keyId/signedJwt, provisório e em memória |

Os projetos, endpoints, audiência Firebase e signatário FB não vêm do corpo.
O signatário é uma service account FB fixa na configuração privada pinada.
As claims são exatamente as seis do núcleo: managementSourceProjectId,
managementMemberId, managementSourceVersion, managementSourceHash,
managementPolicyVersion e managementSourceAuthTimeMs. A policy version é pinada
também no gateway. TTL máximo é o menor contrato configurado, sempre ≤3.600 segundos;
iat precisa ser plausível e pertencer à janela da requisição.

O gateway confia no Worker autenticado como executor de servidor. HMAC não prova
direitos do participante. Somente o núcleo do broker, após validar token FA,
direitos, vínculo e usuário FB existente, pode fornecer UID/claims ao signer.
Não é um endpoint para UID ou permissões enviados pela PWA. O dispatcher não
cria/importa/vincula usuários e não fornece uma reconciliação JIT dos 53 DEFER.
Entregar um custom token sem as verificações do broker continua proibido.

A assinatura é preparada antes do CAS e deve ficar só na memória do servidor.
O broker só pode entregá-la à PWA após CAS, readback e revalidações finais;
falha/timeout/conflito descarta a assinatura e exige o fence correspondente.
Este gateway Auth não implementa esse CAS/fence.

## Propriedades privadas obrigatórias

- MANAGEMENT_GATEWAY_CONFIG_JSON: JSON estrito completo, esquema 1.
- MANAGEMENT_GATEWAY_CONFIG_SHA256: SHA256 do JSON canônico da configuração,
  com ordenação lexical de chaves conforme management-gateway-protocol.js.
- MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL: bytes aleatórios de servidor
  (32–128 bytes), base64url canônico sem padding. Nunca gerar, imprimir ou
  entregar esse secret no browser, no pedido HTTP público ou na resposta.

Forma da configuração (todos os campos obrigatórios; os limites têm de receber
uma política revisada antes de uso):

- schemaVersion: 1; enabled: false na preparação.
- actorEmailSha256: SHA256 do e-mail efetivo normalizado trim/lowercase,
  derivado de evidência privada do ator autorizado; não de parâmetro de cliente.
- signerServiceAccountEmail: endereço fixo de conta de serviço FB já auditada.
- managementPolicyVersion: versão de direitos aceita pelo núcleo.
- maxGoogleResponseBytes: inteiro 1.024–262.144.
- policy: schemaVersion, protocolVersion, audience, keyId, maximumTtlMs,
  maxFutureSkewMs, maxEnvelopeBytes, operationTimeoutMs,
  customTokenMaxTtlSeconds e enabledOperations com as três chaves booleanas.
  A versão/audiência são os literais do protocolo; keyId contém somente
  letras/números/ponto/underscore/hífen. TTL/operação ≤120.000 ms,
  skew ≤60.000 ms, envelope 1.024–65.536 bytes, custom TTL 1–3.600 s.
  Os três enabledOperations começam false.
- noncePolicy: maxNonceRecords (1–512), maxPropertyBytes (1.024–8.192),
  maxStorageBytes (16.384–400.000), lockTimeoutMs (1–1.000) e
  retentionMs (1–86.400.000). Esses são limites admissíveis do código,
  não valores operacionais aprovados nem certificação de custo/capacidade.

O hash configura uma pinagem de autoridade privada; não certifica por si só
quem forneceu os valores. Alterar config/keyId/secret com journal existente
exige reconciliação e handoff revisados, conservando tombstones de toda janela
ainda válida. O checkpoint contém configSha256 e recusa config nova.
Apagar propriedades/checkpoint para rotacionar ou reabrir uma janela não é um
procedimento de recuperação autorizado.

## Autenticação e replay durável

O JSON em doPost contém o HMAC, pois o evento documentado do Apps Script não
oferece uma interface geral de headers recebidos. Somente application/json,
corpo limitado, query/pathInfo vazios e contentLength coerente são aceitos.
Projeto, direção, audiência, keyId, requestId/nonce de 32 hex, hash do corpo,
prazo e shape fechado são conferidos antes de obter OAuth.

Utilities calcula SHA256/HMAC sobre os mesmos bytes UTF8 e JSON canônico do
protocolo Node. Resposta usa um domínio HMAC separado, requestHash da requisição
com assinatura e os mesmos IDs/operação/issuedAtMs/expiresAtMs. Um envelope
invertido, corpo alterado ou resposta de outra operação não autentica acesso.

PropertiesService + ScriptLock conservam metadados/hash e status CLAIMED antes
da operação Google. requestId e nonce têm unicidade independente no namespace;
não basta o par combinado. Escrita e checkpoint exigem readback exato. Toda execução conserva também o maior horário já observado;
recuo intrarrequisição nega mesmo quando o valor ainda supera o início. Lock,
capacidade, corrupção, propriedade desconhecida, clock regressivo ou readback
incerto negam antes de OAuth. Falha parcial conserva o nonce consumido e,
se o checkpoint faltar, bloqueia o journal para reconciliação.

Não há expurgo durante doPost. managementGatewayCleanupExpiredNonces_ é um
helper privado separado, sem trigger/caller instalado: só remove estritamente
depois de expiresAtMs + skew + retentionMs, sob o mesmo lock/checkpoint.
A limpeza persiste/readback seu maior horário antes de remover qualquer registro;
falta dessa confirmação conserva os tombstones. A expiração não permite reapresentar o mesmo nonce durante essa retenção.
Depois da remoção revisada, um envelope original já expirou; novos IDs devem
ser aleatórios/únicos no host. IDs não têm uma garantia global eterna após
remoção ou perante scripts separados/reinicialização manual das propriedades.

Nenhum token, UID de usuário, resposta Auth, e-mail, nome, gabarito, hash de senha,
salt, payload JWT ou custom token é persistido no journal. São mantidos apenas
IDs opacos do protocolo, hash/metadata, datas, operação e estado consumido.
A prova VM demonstra o contrato local de escrita/readback/retomada em doubles;
não certifica persistência/concorrência real do serviço Google nem quota.

## OAuth, prazos e respostas Google

ScriptApp.getOAuthToken fica exclusivamente na chamada UrlFetchApp a endpoints
fixos Auth/IAM. Não retorna pela ponte e não é parâmetro de request/response HMAC.
O manifesto separado contém apenas identitytoolkit, iam, external_request e
userinfo.email; não contém datastore, Drive, Forms, Sheets ou Execution API.

UrlFetch usa HTTPS verificado, redirects false e timeoutSeconds igual ao inteiro
inferior do prazo restante (inclusive operationTimeout absoluto desde a entrada).
Resto <1 segundo não inicia fetch. Relógio/prazo são conferidos antes/depois
dos efeitos e antes da resposta. Deadline não se estende por retry; não há retry.
Uma chamada Google já enviada pode terminar tarde: assinatura tardia é descartada,
nonce continua consumido e esta preparação não afirma cancelamento remoto.

A resposta Google é materializada pelo próprio UrlFetch antes de seu tamanho ser
conferido. O limite local de bytes não certifica streaming, CPU ou teto de memória
da plataforma. São recusados HTTP não200, redirects, JSON inválido, Age positivo,
UTF8 incompatível, usuário ambíguo/divergente e campos de identidade malformados.
Auth é consultado novamente em cada envelope; não há cache de usuário/resultado.
Campos privados recebidos em Auth são descartados antes de assinar a resposta.

No GAS, o resultado IAM precisa ter header/key/payload iguais ao construído.
Essa comparação não verifica RSA criptograficamente. O adapter Node/Worker
management-google-auth-adapter.js continua obrigado a verificar a assinatura
RS256 com as chaves públicas rotativas e o payload exato antes de aceitar token.
Auth vigente também continua obrigatório no núcleo; não existe revogação
instantânea ou atomicidade Auth/FA/FB.

ContentService redireciona a resposta a uma URL Google temporária. O cliente
dedicado aceita um redirect limitado, sem reenviar corpo/credenciais, e verifica
o envelope retornado. Não logar a URL temporária ou bodies. CORS/no-store públicos
pertencem ao Worker; este projeto não disponibiliza tokens via JSONP ou doGet.

## Entrada nativa preparada, sem pedido de execução

autorizarPonteGestaoSemChaveV1() é uma conferência somente de metadados:
configpin, hash do ator efetivo e getAuthorizationInfo(FULL, escopos exatos).
Ela retorna aliases/códigos e operational:false. Não ativa enabled, cria IAM,
chama OAuth, faz fetch, assina token, escreve journal ou instala gatilho.
A preparação no arquivo local não coloca a função no editor do usuário.

Intervenção nativa só será indispensável depois de preparar/revisar o projeto
dedicado, configuração privada/segredo, ator/deployment e grants específicos.
Nesta etapa não executar nem pedir ao usuário para executar a função.
Consentimento de escopos não prova IAM ou API habilitada; conferir esses gates
separadamente antes de qualquer teste remoto autorizado.

## Provas e próxima unidade

tests/management-appscript-gateway.test.js usa VM, doubles sintéticos de
Utilities/Properties/Lock/ScriptApp/UrlFetch/Session/ContentService, relógios e
RSA somente em memória. Uma composição inteira liga protocolo Node, cliente
HTTPS, adapter Auth e GAS VM reais, com redirect e endpoints Google sintéticos.
Ela cobre assinatura/chaves, projeção, revogação, usuário ausente, replay e
ausência de OAuth no tráfego Worker. Não toca Auth, Firestore, IAM ou editor reais.

Próxima menor unidade para o broker: gateway Firestore separado, com
readFaAuthorization/contexto versionado coerente, readFbLease e transação real
que leia o fence do grant e a revisão do lease antes de gravar. invalidateFbLease
deve registrar fence mesmo se o lease ainda não existir, e nunca invalidar grant
mais novo. CAS só de updateTime ou ScriptLock não impede write tardio por outro
executor. Cada leitura/transação/cleanup precisa de reserva FA45k/FB35k anterior,
com limites/custos/medição/pausa próprios. A preview offline atual não é fonte
productionAuthorized. Admission, supervisor/journal Worker e writers de
revogação/Rules ainda precisam de implementação e prova antes do entrypoint.

## Referências oficiais conferidas

- [Web Apps](https://developers.google.com/apps-script/guides/web):
  evento POST e identidade efetiva/consentimento.
- [ScriptApp](https://developers.google.com/apps-script/reference/script/script-app):
  getOAuthToken/getAuthorizationInfo.
- [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app):
  HTTPS, redirects e timeoutSeconds.
- [ContentService](https://developers.google.com/apps-script/guides/content):
  redirect de resposta.
- [Utilities](https://developers.google.com/apps-script/reference/utilities/utilities):
  SHA256/HMAC e bytes.
- [Properties](https://developers.google.com/apps-script/reference/properties/properties),
  [LockService](https://developers.google.com/apps-script/reference/lock/lock-service) e
  [quotas](https://developers.google.com/apps-script/guides/services/quotas):
  serviço persistido/lock, 9KB por valor e 500KB por store; limites configurados
  permanecem abaixo disso e falham fechado sem certificação produtiva.
