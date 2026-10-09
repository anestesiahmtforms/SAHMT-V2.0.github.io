# Protocolo local Worker → Apps Script de Gestão

Este módulo é uma preparação de servidor. Não contém transporte, endpoint, segredo real, credenciais OAuth, ledger produtivo, IAM, deploy ou consultas reais. Não altera FA/FB, não importa Auth, não concede direitos e não retoma treinamentos. Os três handlers estão desativados por padrão.

## Interface

`scripts/lib/management-gateway-protocol.js` exporta `createManagementGatewayProtocol({policy,secret,now?,monotonicNow?})`, `gatewayCanonicalJson`, `gatewayEnvelopeHash` e constantes de versão, audience, operações e códigos de negação. `secret` é Uint8Array/Buffer fornecido pelo host com 32..1024 bytes, copiado privadamente. Tamanho não certifica entropia: o operador deve fornecer pelo menos 256 bits de entropia criptográfica, armazenados somente no servidor. Não gerar esse segredo no browser ou guardá-lo no repositório. `dispose()` zera a cópia e cancela operações pendentes.

Métodos:

- `createRequest({operation,requestId,nonce,issuedAtMs,expiresAtMs,body})` cria envelope validado.
- `verifyRequest(envelope)` valida e devolve cópia do envelope.
- `createResponse(request,{status,code,body})` cria resposta vinculada ao pedido.
- `verifyResponse(response,request)` devolve `{status,code,body}` validado.
- `receiveRequest(request,{claimNonce,handlers,signal?,deadlineMs?})` admite duravelmente antes de despachar; devolve envelope assinado ou rejeita pedido inválido/expirado.
- `acceptResponse(response,request,{claimNonce,signal?,deadlineMs?})` admite a resposta duravelmente antes de devolver o corpo ou negação autenticada.

As funções puras de criação/verificação não substituem `receiveRequest`/`acceptResponse` no endpoint real: não oferecem proteção contra repetição, autorização de negócio ou admissão de orçamento. Somente código de servidor confiável deve acessar a chave e essas primitivas.

`handlers` tem apenas chaves da allowlist, cada uma `{enabled:boolean,dispatch:function}`. Ausência/false nega antes de chamar o ledger. O host precisa habilitar explicitamente tanto a operação em `policy.enabledOperations` quanto o handler. `dispatch` recebe corpo copiado e `{signal,deadlineMs,operation,projectId}`; projectId é FA para lookup FA e FB para lookup FB/SIGN. Callbacks de ledger/handler são injetados de servidor, nunca recebidos do navegador.

## Policy fechada

Campos obrigatórios:

| Campo | Valor/limite |
| --- | --- |
| schemaVersion | 1 |
| protocolVersion | SAHMT_MANAGEMENT_GATEWAY_V1 |
| audience | sahmt-management-dedicated-appscript-v1 |
| keyId | 1..100 caracteres ASCII alfanuméricos, ponto, sublinhado ou hífen |
| maximumTtlMs | inteiro 1..120000 |
| maxFutureSkewMs | inteiro 0..60000 |
| maxEnvelopeBytes | inteiro 1024..65536 |
| operationTimeoutMs | inteiro 1..120000 |
| customTokenMaxTtlSeconds | inteiro 1..3600 |

`enabledOperations` opcional exige as três chaves booleanas exatas; ausente equivale a todas false. Campos extras são rejeitados. Policy e segredo são copiados antes de qualquer await.

## Wire e HMAC

Request tem exatamente: `schemaVersion,protocolVersion,audience,keyId,direction,sourceProjectId,destinationProjectId,operation,requestId,nonce,issuedAtMs,expiresAtMs,body,bodySha256,signature`. Projetos fixos: FA `sahmt-17a16`, FB `sahmt-gestao-5ae66`. Direção request: `WORKER_TO_APPS_SCRIPT`.

Response tem esses campos e somente mais `requestHash,status,code`; direção `APPS_SCRIPT_TO_WORKER`. Metadados, requestId, nonce, operação e dois tempos devem ser idênticos ao pedido. `requestHash` é SHA256 do pedido canônico completo, inclusive assinatura. `bodySha256` é SHA256 do corpo canônico. Digests e assinatura são 64 hexadecimais minúsculos.

A serialização canônica ordena chaves recursivamente por code units JavaScript, preserva arrays, usa JSON.stringify para primitivas e rejeita números não inteiros seguros, -0, getters, propriedades ocultas, símbolos, objetos com protótipo customizado, arrays esparsos/customizados, ciclos, undefined e funções. Limites: profundidade 16, 4096 nós e bytes UTF8 configurados (máximo 65536). Não usar localeCompare.

HMAC-SHA256 sobre bytes UTF8:

- request: literal `SAHMT_MANAGEMENT_GATEWAY_V1_REQUEST` + LF + JSON canônico do envelope sem `signature`;
- response: literal `SAHMT_MANAGEMENT_GATEWAY_V1_RESPONSE` + LF + JSON canônico do envelope sem `signature`.

Assinaturas são comparadas com timingSafeEqual após validação hexadecimal de comprimento fixo. Corpo é autenticado; nunca o tratar como seguro antes da verificação e admissão. requestId e nonce são, cada um, 32 caracteres hexadecimais minúsculos, gerados por CSPRNG pelo caller de servidor. O módulo valida formato de 128 bits; não certifica aleatoriedade de strings fornecidas.

## Operações e projeções

`AUTH_USER_LOOKUP_FA` e `AUTH_USER_LOOKUP_FB`: request somente `{uid}`. Retorno somente `{users:[]}` ou um registro com `localId` igual ao UID solicitado, `emailVerified:boolean`, `providerUserInfo:[{providerId,rawId}]` (máximo 20, providerId único), `disabled?:boolean`, `validSince?:string` decimal seguro de segundos. Não retorna e-mail, nome, foto, senha, bearer/OAuth ou outros campos da API Auth. Conta ausente não equivale a identidade autorizada; o adapter superior aplica essa negação.

`SIGN_FB_CUSTOM_TOKEN`: request somente `{uid,claims,issuedAtSeconds,expiresAtSeconds}`. Os tempos são derivados pelo Worker confiável, não pelo navegador. Seis claims exatas:

- managementSourceProjectId = FA;
- managementMemberId identificador até 200 caracteres;
- managementSourceVersion inteiro positivo;
- managementSourceHash SHA256 hexadecimal minúsculo;
- managementPolicyVersion identificador até 100 caracteres;
- managementSourceAuthTimeMs inteiro positivo.

Claims têm até 1000 bytes canônicos. `exp>iat`, delta até customTokenMaxTtlSeconds e nunca acima de 3600; segundos convertidos para milissegundos seguros. `iat*1000<=now+skew`, `exp*1000>now`, `iat*1000>=request.issuedAtMs-skew-999` e authTime da claim não supera iat+skew. A assinatura usa signatário e iss/sub/aud fixados pelo host; não recebe JWT completo, URL, projeto, signatário ou payload arbitrário. Retorno `{keyId,signedJwt}` apenas (JWT com três segmentos base64url, até 16000 caracteres). Esse protocolo verifica a forma/HMAC, não a assinatura Google do JWT: o adapter Worker deve verificar certificado público, signatário, payload exato e tempos esperados.

SUCCESS exige `code:OK` e retorno fechado da operação. DENIED exige body null e um código estático: `GATEWAY_DISABLED`, `GATEWAY_ADMISSION_DENIED`, `GATEWAY_REPLAY_DENIED`, `GATEWAY_OPERATION_FAILED`, `GATEWAY_OPERATION_TIMEOUT`, `GATEWAY_RESULT_INVALID`, `GATEWAY_ABORTED`. Erros/corpos brutos do handler nunca são retornados. Pedido inválido, clock inválido ou prazo final vencido rejeita com erro estático; não gera resposta com prazo renovado.

## Admissão durável obrigatória

`claimNonce(metadata,{signal,deadlineMs})` recebe exatamente:

`schemaVersion,namespace,direction,requestHash,envelopeHash,requestId,nonce,operation,keyId,sourceProjectId,destinationProjectId,issuedAtMs,expiresAtMs`.

namespace = `protocolVersion + ':' + audience + ':' + direction`. Não inclui chave/operação: rotação de chave ou troca de operação não deve permitir replay. No request, envelopeHash=requestHash; na resposta, envelopeHash identifica a resposta completa e requestHash continua vinculando o pedido.

Recibo de sucesso contém esses mesmos campos, com valores exatos, mais `status:CLAIMED,durable:true,atomic:true,budgetAllowed:true,capacityAllowed:true,retained:true`. Ausência/erro/mismatch/false nega antes de dispatch/retorno. Recibo de ledger `{status:REPLAY}` produz negação estática de repetição. Flags só expressam o contrato de um adapter confiável: não certificam atomicidade por si.

O ledger real deve impor unicidade de requestId e nonce **individualmente**, por namespace, antes de OAuth/lookup/assinatura, sob transação/lock durável, inclusive em concorrência/restart. Cache em memória, combinações requestId+nonce ou chave de operação não servem como defesa produtiva. Resultado desconhecido, timeout ou expiração não liberam claim. Capacidade/orçamento/estado incompleto/reinício não verificável devem falhar fechados. Retenção/purge precisam de janela comprovadamente segura, relógio durável sem regressão e regra explícita; este módulo não purga nem implementa TTL de tombstone. As duas direções têm ledgers separados.

Os testes usam somente um ledger em memória **double**, para observar as exigências da interface. Não é uma implementação produtiva de ledger.

## Prazo, cancelamento e limites

Admissão e dispatch compartilham um único prazo `min(request.expiresAtMs,caller.deadlineMs,now+operationTimeoutMs)`. O prazo é pinado antes dos awaits, limitado também por relógio monotônico; timer não é a única proteção. Antes/depois de awaits e dentro do thunk enfileirado, o módulo revalida clock, prazo e cancelamento. Resposta mantém os tempos originais. Relógio inválido/regressivo nega. Cleanup protege remoção de listener e sempre aborta o sinal interno; métodos/aborted do sinal externo são validados e erros de setup são sanitizados. Não há retry automático.

AbortSignal não desfaz uma operação iniciada no serviço remoto. Lookup/assinatura podem terminar tarde ou com resultado desconhecido; o módulo impede devolver esse resultado e conserva a claim. O host deve sustentar a execução/cleanup quando necessário e registrar reconciliação sem tokens. O gateway não escreve leases ou grants. JWT assinado é provisório: CAS, fencing, readback e nova confirmação de perfil/Auth/ACL/política no broker continuam obrigatórios antes da entrega à PWA. HMAC prova posse da chave de ponte, não direitos do membro, confiabilidade do signatário ou autorização de Gestão.

## Gates de produção

Ainda necessários: implementação Apps Script/Worker e transporte limitado revisados, secret provisioning seguro fora do repo, actor/signer/audience pinados, nonce ledger durável com CAS/lock/restart/clock/retention/capacity comprovados, direitos IAM mínimos, budgets de Auth/IAM próprios e guardas FA/FB para quaisquer leituras Firestore do broker, supervisor/resultado desconhecido, CAS/fence/readback/revalidação e teste de login real aprovado. Nenhum desses gates é satisfeito por fixtures locais.

Google Auth adapter deve manter gateway e OAuth direto mutuamente exclusivos. Não oferecer OAuth/accessToken genérico, CORS livre, operação administrativa pública ou URL de destino controlada pelo caller. Transporte Apps Script redirecionado e response nonce claim são responsabilidade de adapters separados. Este arquivo não hospeda ou habilita essas funções.

## Verificação local

`node --test tests/management-gateway-protocol.test.js` usa dados, chave e JWT sintéticos: canonical/HMAC/domínios, schema/pins/TTL, allowlist/claims, zero dispatch em negações, replay individual/concorrência, receipts, timeout/abort/resultado tardio, clock e cleanup. Não chama rede, Auth, IAM ou Firestore.