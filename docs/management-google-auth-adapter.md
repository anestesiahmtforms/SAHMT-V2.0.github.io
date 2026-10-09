# Adaptador Google Auth REST/JWT — preparação de servidor

Preparado exclusivamente no worktree `management-firebase-split`. `scripts/lib/management-google-auth-adapter.js` é servidor Node, desligado por padrão e sem SDK Admin, fetch global, descoberta ADC, chave privada, credencial real, host, deploy ou mudança IAM. A suíte usa RSA e certificados X509 sintéticos gerados somente em memória e doubles de fetch/token provider. Nenhuma API produtiva é consultada pelos testes.

## Interfaces compatíveis com o broker

`createManagementGoogleAuthAdapter({enabled:false, fetchImpl, getAdminAccessToken, signerServiceAccountEmail, policy, clock})` retorna:

- `verifyFaIdToken(token, true, context)`: claims FA normalizadas, com UID derivado de `sub`; `false` é negado.
- `getFbUser({uid, projectId:'sahmt-gestao-5ae66'}, context)`: snapshot Auth administrativo atual no formato esperado pelo núcleo.
- `createFbCustomToken(uid, claims, context)`: custom token opaco para a troca Auth FB, após verificar a assinatura e o payload retornados pelo IAM.
- `getFaUser({uid, projectId:'sahmt-17a16'}, context)`, com alias `readFaAuthUser`: snapshot Auth FA fresco para composição de `readFaAuthorization`, incluindo `user.googleUid` e watermark. Não reutiliza o lookup anterior de verificação JWT.
- Aliases `readFbUser`/`signFbCustomToken`, iguais aos métodos do núcleo.
- `dispose()`: cancela esperas pendentes e limpa somente o cache local de chaves públicas.

`context` pode conter `signal` e `deadlineMs`, como o núcleo atual já fornece. O prazo efetivo é o menor entre prazo do caller e `policy.operationTimeoutMs`; o recebimento de uma credencial não o estende. As funções não concedem direitos por Auth nem importam/criam usuários. O UID/claims passados ao signer vêm do núcleo que validou token, vínculo e direitos; essas funções **não** são endpoints públicos.

## Política e dependências explícitas

A política exige `operationTimeoutMs` (máximo 120.000), `maxResponseBytes` (máximo 262.144), `maxResponseChunks` (máximo 1.024), `maxKeyCacheMs` (máximo 24 horas), `maxFutureSkewMs` (0–60.000), `maxIdTokenLifetimeSeconds` e `customTokenLifetimeSeconds` (1–3.600). Não há valores produtivos aprovados por padrão; os valores da suíte são artificiais. O relógio deve ser UTC correto e monotônico na janela da operação; regressão local nega a operação.

`getAdminAccessToken({projectId,purpose,scopes},{signal})` é uma dependência **confiável de servidor ainda não implementada**. Retorna `{credentialType:'google-oauth2',accessToken,expiresAtMs,scopes}`. A camada confere formato, tipo, escopo, expiração e limita o prazo ao vencimento da credencial. Tokens com formato JWT são recusados como credencial administrativa, incluindo Firebase FA/FB/custom tokens. A atestação do provider não comprova identidade ou IAM por si só; credenciais OAuth2 reais precisam ser obtidas pelo gateway com uma identidade de servidor aprovada. O provider poderá usar cache de access token vigente, mas **nunca cache de usuário/lookup**.

`fetchImpl` deve ser fetch de servidor com TLS verificado e sem logging de headers, bodies ou respostas privadas. As opções usam `cache:no-store`, cookies omitidos, redirects negados, referrer omitido e AbortSignal. A validação local de strings não prova origem/identidade do runtime ou permissão IAM.

## Verificação FA e revogação

A entrada é JWT de cliente Firebase FA (`sahmt-17a16`), não custom token nem access token administrativo. São exigidos base64url canônico sem padding, três segmentos limitados, header RS256/kid (typ JWT quando presente), ausência de headers de chaves remotas e payload objeto. Assinatura é verificada por `node:crypto` com RSA público de 2.048–8.192 bits.

As claims exigem aud/issuer FA exatos, sub não vazio de até 128 caracteres, UID/user_id coerentes quando presentes, tempos inteiros plausíveis, auth_time ≤ iat < exp, exp futuro, duração máxima e tolerância futura explícitas. Somente Google, e-mail verificado e identidade Google única são aceitos; tenants são negados neste contrato. UID/permissão não são lidos de parâmetros de cliente. As condições de header/issuer/aud/tempos/chaves seguem a documentação [Verify ID Tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

O endpoint público é fixo: `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`. Cache de chaves respeita max-age, desconta Age e aplica o limite menor da política, com expiração lógica e monotônica limitada também pelo notAfter de certificados X509. Ausência/ambiguidade de max-age, no-store/no-cache, Age inválido, certificado vencido/futuro ou chave inadequada negam. Um kid desconhecido faz uma nova busca finita; se continuar ausente, nega. Cache vencido nunca funciona como fallback diante de erro. PEM público é aceito para os doubles, e a forma X509 real também é exercitada com certificados sintéticos.

Depois da assinatura, **cada verificação** executa lookup Auth administrativo FA fresco, inclusive quando a chave pública está em cache. `disabled:true`, conta ausente/divergente, e-mail não verificado ou identidade Google alterada negam. `validSince` é decimal rigoroso em segundos: `auth_time*1000 < validSince*1000` revoga; igualdade permanece válida. `validSince` omitido significa ausência de watermark, e `disabled` omitido significa habilitado, reproduzindo o comportamento documentado no código oficial Admin. Campos malformados nunca recebem esses defaults. [Manage Sessions](https://firebase.google.com/docs/auth/admin/manage-sessions), [base-auth.ts](https://github.com/firebase/firebase-admin-node/blob/master/src/auth/base-auth.ts), [user-record.ts](https://github.com/firebase/firebase-admin-node/blob/master/src/auth/user-record.ts).

Essa observação não elimina a corrida entre lookup e alteração futura de conta. O núcleo continua revalidando FA/FB/direitos antes e depois da escrita privilegiada; sincronismo de revogação e Rules ainda são necessários. Não se promete revogação instantânea entre projetos.

## Lookup administrativo e projeção FB

São usados somente os endpoints fixos `POST https://identitytoolkit.googleapis.com/v1/projects/{FA|FB}/accounts:lookup`, com OAuth2 de servidor e corpo `{localId:[uid]}`. Não se envia `idToken`, e-mail, query, API key, tenant ou projeto arbitrário. A API requer `firebaseauth.users.get` e escopo identitytoolkit ou cloud-platform; não foram habilitados ou concedidos aqui. [projects.accounts.lookup](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup).

Lookup não é cacheado. Resposta com Age positivo/inválido é negada; missing/ambiguous users, UID divergente ou campo incompatível também. A camada normaliza somente UID, disabled, emailVerified, providerData e watermark. E-mails, hashes, salt, customAttributes e demais dados brutos são descartados da saída. O snapshot tem `schemaVersion:1`, projeto FA/FB correspondente, `fromCache:false`, `hasPendingWrites:false`, horário local da conclusão e `user`. Esse horário representa a conclusão da requisição Auth; não é timestamp de snapshot Firestore. Para FA, o helper agrega Google UID único ao usuário normalizado, e o escritor de `readFaAuthorization` pode compor `authUser` com UID, disabled, emailVerified, googleUid e tokensValidAfterTimeMs recém-observados. Os estados disabled/revoked são mantidos para o núcleo negar; helper não os converte em autorização. O núcleo impõe Google único/elegibilidade e não concede direitos por e-mail ou Auth. [UserInfo](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/UserInfo).

## Assinatura IAM keyless

O signer configurado deve ser um endereço de service account do projeto FB; isso não cria nem habilita essa conta. O payload é construído internamente com iss/sub iguais ao signer, audiência Firebase custom token, iat/exp derivados do relógio/política e UID recebido do núcleo. `claims` exige exatamente as seis chaves atuais: `managementSourceProjectId`, `managementMemberId`, `managementSourceVersion`, `managementSourceHash`, `managementPolicyVersion` e `managementSourceAuthTimeMs`. Claims reservadas, privilégios extras, payload arbitrário ou campos faltantes são negados. Claims adicionais têm teto de 1.000 bytes.

O request é `POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{signer}:signJwt`, sem delegates, com JSON `{payload:serializedServerPayload}` e OAuth2 escopo IAM/cloud-platform. O wildcard `-` faz parte do endpoint oficial. Retorno precisa conter keyId/signedJwt; header, kid e payload devem corresponder exatamente. A assinatura RS256 é revalidada pelas chaves públicas rotativas do endpoint oficial `https://www.googleapis.com/service_accounts/v1/metadata/x509/{signer}`. Não se aceita token alterado ou assinatura inadequada. [IAM signJwt](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt), [Create Custom Tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

A assinatura é feita por chave gerenciada do IAM, não por uma chave privada entregue ao app/disco. **Keyless não fornece identidade automaticamente ao Worker/gateway**: o token provider e a confiança da identidade ainda precisam ser implementados e validados. O módulo exige um gateway de servidor confiável; não demonstra hospedagem Spark, Apps Script ou serviço gratuito disponível.

## Falhas fechadas e limites

Toda espera tem timer, prazo monotônico e revalidação síncrona antes/depois de fetch/read/callback e antes da entrega final. Body streaming tem limites de bytes/chunks e nega chunks vazios, evitando starvation por microtasks. Cleanup de reader é defensivo sem espera; controller é abortado em qualquer saída. Abort, dispose, timeout, erro OAuth/IAM/HTTP, redirect, corpo inválido/grande, erro bruto ou conclusão tardia não retornam identidade/token. Erros possuem somente códigos constantes; não carregam texto remoto ou credenciais.

Um AbortSignal não comprova que uma API já enviada deixou de executar. Uma assinatura IAM tardia pode ter ocorrido mesmo sem token ser entregue; ela não escreve lease nem entrega sessão. As quotas Auth/IAM, rate limiting e observabilidade sem segredos precisam de política própria. Esses endpoints consultam metadados Auth/chaves/IAM, **não documentos Firestore**; nenhuma guarda Firestore é consumida aqui. Os adaptadores de documentos do núcleo exigem políticas e reservas próprias por projeto no dia America/Los_Angeles: FA admite o teto de 45.000 explicitamente aprovado em 8/10; FB conserva sua política local de 35.000. Cada política inclui app e rotinas, sem herdar pausa entre projetos. Este adapter Auth não mede leituras nem rearma qualquer pausa.

## Gates antes de usar

Implementar provider OAuth2 de servidor/identidade federada confiável; escolher e verificar runtime/gateway HTTPS; reconciliar service account/IAM/escopos/API/quota sem custos não autorizados; assegurar relógio e log redaction; instalar direitos/projeções/lease/CAS/fence/ledger durável; validar Rules e revogação com usuário real; confirmar comportamento de dispositivo e rollback. Nenhum desses gates foi cumprido por estes testes. Não instalar, publicar ou conceder acesso automaticamente com base nesta preparação.


## Continuação: ponte dedicada sem OAuth no Worker

Em 9 de outubro de 2026 foi acrescentada a alternativa privilegedGateway, com
lookupAuthUser e signFbCustomToken. É mutuamente exclusiva com getAdminAccessToken;
ambas presentes ou ambas ausentes negam antes de I/O. O caminho anterior continua
reservado a hosts que já mantenham a identidade OAuth administrativa no servidor.

No modo ponte, fetchImpl obtém somente as chaves públicas. O cliente HTTPS dedicado
verifica o envelope HMAC e a aceitação durável de resposta antes de devolver dados.
Lookup aceita somente users e os campos mínimos localId, disabled, emailVerified,
validSince e providerUserInfo com providerId/rawId. Campos extras, getters, protótipos,
arrays esparsos ou atributos privados são negados. O lookup não reutiliza o cache de
chaves como cache de revogação e não cria/importa usuário ausente.

O pedido de assinatura contém uid, seis claims aprovadas, issuedAtSeconds e
expiresAtSeconds derivados pelo servidor. A ponte constrói signer/aud/iss/sub fixos.
O adaptador exige somente keyId/signedJwt, confere igualdade exata do payload e a
assinatura pública do signatário FB antes de devolver o token provisório ao núcleo.
A assinatura não pula CAS, revalidação, fence ou confirmação do lease.

Ver [transporte da ponte](management-gateway-client.md), [protocolo](management-gateway-protocol.md)
e o pacote Apps Script dedicado. Nenhum secret foi criado, manifesto operacional foi
alterado, endpoint publicado, OAuth consentido ou superfície reativada nesta etapa.
