# Transporte privado Firestore do broker Gestão

## Estado

Preparação local desativada. `scripts/lib/management-broker-firestore-gateway.js`
completa a fronteira entre o broker sem OAuth e o adaptador REST privilegiado.
Não registra endpoint, Worker, Durable Object, Apps Script, credenciais, IAM,
fonte produtiva, cópia, Rules ou ativação da PWA. O gateway Auth-only existente
permanece separado. Este módulo não usa rede ou credenciais por conta própria.

A cadeia preparada é:

```text
broker privado / Worker
  -> adapters high-level + admissão atual privada
  -> requestPrivileged injetado, envelope HMAC
  -> servidor privado + claim durável + admissão atual privada
  -> management-broker-firestore-adapter.js
  -> reserva independente + OAuth somente no servidor + Firestore REST
```

O transporte não expõe um endpoint REST genérico. Só admite:

| Operação | Projeto | Contrato |
| --- | --- | --- |
| readFaAuthorization | sahmt-17a16 (FA) | Contexto fonte produtivo, completo, versionado e atual |
| readFbLease | sahmt-gestao-5ae66 (FB) | Lease inteira ou ausência com revisão nula explícita |
| writeFbLease | FB | CAS da lease inteira; revisão exata e fence do grant |
| invalidateFbLease | FB | Fence/revogação do grant esperado, preservando grants posteriores |

Transações, caminhos fixos, leitura lease/fence e revisão com nanos continuam no
adaptador REST existente. O novo transporte não substitui essas garantias.

## Composição local

- `createManagementBrokerFirestoreGatewayProtocol({policy, secret, now?, monotonicNow?})`:
  validação, assinatura, vínculo request/response, metadados, claims, admissão e
  prazo limitado. Segredo privado de 32 a 1024 bytes, copiado internamente;
  `dispose()` apaga essa cópia e interrompe os guards. Nunca entregar ao browser.
- `createManagementBrokerFirestoreGatewayAdapters({enabled:false, protocol,
  requestPrivileged, claimResponse, admitCurrentRequest})`: fornece os mesmos
  quatro métodos do adaptador REST, com `(body, {signal?, deadlineMs?})`.
  `requestPrivileged(envelope, context)` é porta privada injetada; não recebe
  token OAuth ou parâmetros de URL do wire.
- `createManagementBrokerFirestoreGatewayServer({enabled:false, protocol,
  claimRequest, admitCurrentRequest, adapters})`: `receive(envelope, context)`
  chama os quatro métodos do adaptador REST privilegiado injetado. O contexto
  enviado contém somente `signal` e o prazo original, sem recibo upstream.

Os dois lados devem usar políticas e chave pinadas por configuração protegida.
`enabled:true` isolado não configura callbacks, não instala um host e não prova
prontidão produtiva. Nunca colocar esse módulo ou seu segredo na SPA/PWA.

## Política fechada

A política contém schema 1, keyId, policyVersion e policySha256 protegidos;
maximumTtlMs e operationTimeoutMs (até 120 s), maxFutureSkewMs (até 60 s),
maxEnvelopeBytes (1024 a 65536), maxReservationRecords, maxMeasurementAgeMs e
maxSnapshotAgeMs (até 5 min), leaseMaxDurationMs (até 24 h), dailyLimits,
operationReadBounds e enabledOperations para exatamente os quatro métodos.

FA admite 35.000 ou 45.000 leituras diárias. 45.000 exige o pin literal
`USER_FA_DAILY_LIMIT_45000_2026_10_08`. FB admite 35.000 nesta política de runtime;
a autorização temporária da cópia limitada não se aplica ao broker. Os projetos
não compartilham recibos ou totais. Limites e medidas seguem o dia
`America/Los_Angeles`, incluindo o tráfego do app.

Cada bound é pelo menos 1/1/2/2 respectivamente. Esses mínimos são estrutura do
contrato, **não um teto certificado**; o host deve definir os bounds a partir do
comportamento real antes de ativar. A versão/digest pinados devem corresponder a
uma política aprovada e persistida, não a um boolean ou digest enviado pelo app.
O transporte exige ao menos 5.000 leituras de margem do app e 2.000 de atraso da
métrica. Isso não oferece interrupção global exata diante de tráfego simultâneo.

## Envelopes, replay e dados

Requests e responses têm domínio HMAC separado do gateway Auth-only e também
entre direções. Incluem projeto fonte/destino fixo, operação, chave/política
pinadas, IDs/nonce de 128 bits, prazo, hash do body e assinatura. Response fica
vinculada ao hash do request, IDs, operação e prazo. JSON é limitado em bytes,
profundidade/nós, sem getters, ciclos ou números não inteiros. Os bodies fechados
rejeitam URL, OAuth, e-mail, proof, budgetAllowed e upstreamReservation.

`claimRequest(metadata, context)` e `claimResponse(metadata, context)` devem
persistir atomicamente a unicidade de **requestId e nonce individualmente** em
armazenamento protegido, independente de operação, UID, chave ou versão de
política, dentro do namespace/direção do protocolo. O metadata inclui
schemaVersion, namespace, direction, requestHash, envelopeHash, requestId, nonce,
operation, projectId, uid, issuedAtMs, expiresAtMs, keyId, policyVersion e
policySha256. O recibo exato adiciona `status:'CLAIMED'`, `durable:true`,
`atomic:true`, `retained:true`. Essas flags só são aceitas da função privada.
Um host que apenas devolva as flags sem persistir o claim é inválido.

Capacidade e retenção dependem do ledger/supervisor protegido do host. Nunca
reutilizar tombstones ou IDs ao girar chaves, encerrar requests ou restaurar
estado. Erros, timeout e abort não apagam claim. Esta unidade não implementa nem
certifica o armazenamento durável do host.

Responses contêm resultados normalizados e validados ou uma negação de código
estático com `body:null`. Erros privados não são serializados. O contexto fonte
pode conter UIDs de áreas e deve continuar privado ao broker; o browser receberá
uma projeção mínima própria por outra fronteira autorizada. Não logar envelopes,
resultados ou identidades em produção.

## Admissão atual e orçamento protegido

`admitCurrentRequest(metadata, context)` deve consultar o estado **atual** de
política, pausa, medida e ledger no processo privilegiado, e reservar/persistir
duravelmente antes de retornar. Uma prova antiga ou flags passadas pelo cliente
nunca substituem essa consulta. O callback é executado antes do envio do caller
e, novamente, depois do claim no servidor, antes de dispatch.

O recibo exato adiciona aos metadados:

- kind `PROTECTED_CURRENT_BROKER_ADMISSION`, allowed/currentProtectedStateVerified/
  durable true, pausedRequiresReview false, authorityRevision positiva;
- reservationId, reservationExpiresAtMs limitado pelo envelope, maximumReads;
- quotaTimezone/dia LA, dailyReadLimit do projeto, metricsComplete true;
- measurementTimeMs não futuro nem antigo (máximo 5 min e mesmo dia),
  measurementEvidenceSha256;
- totalReadCount, outstandingReservedReads, unreportedConsumedReads,
  applicationReserveReads e metricLagReserveReads.

A soma total+reservas+consumo não reportado+margens deve ser inferior ao limite.
As reservas atuais incluem pelo menos a operação. O módulo conserva tombstones
locais e pisos por projeto para negar recibos reutilizados, queda de revisão,
queda de medida no mesmo dia ou contabilidade incompleta. Esses controles locais
complementam, sem substituir, o estado durável do callback.

O ledger existente ainda não fornece adoção/validação de reservas recebidas no
wire. Portanto o servidor não transmite recibo upstream ao REST. O REST executa
sua própria reserva antes de OAuth/Firestore, incluindo suas tentativas e cleanup
no prazo original. As admissões podem contabilizar margens conservadoras extras;
não descontar, reembolsar ou adotar uma reserva sem uma futura unidade durável
específica. Renovar o dia não remove uma pausa que exige revisão humana.

## Prazo, falha e reconciliação

Prazo é o mínimo de expiry, prazo do caller e operationTimeoutMs. Reservas podem
encurtá-lo; nunca estendê-lo. Relógio monotônico e relógio de parede são conferidos
antes/depois de callbacks, transporte e dispatch; timer/signal limitam callbacks
pendentes. Não existe retry automático ou settle/refund neste transporte.

Após enviar uma operação de gravação, perda de transporte, resultado inválido,
perda de claim da resposta, abort ou timeout exigem reconciliação. Negação assinada
que confirmou ausência de dispatch permanece uma negação conhecida. O servidor
marca falha após dispatch como potencialmente incerta. Claims e reservas ficam
retidos; não reenviar uma gravação incerta ou emitir um novo grant para contornar
esse estado. Cleanup é a operação invalidate, com claim/admissão novos e prazo
limitado; não ganha autorização implícita a partir de uma falha anterior.

## Gates restantes

1. Escolher e instalar o endpoint privado que hospede o adaptador REST sem
   disponibilizar OAuth ao Worker; validar HTTPS/redirect, isolamento e identidade
   real do executor. O gateway Apps Script Auth-only atual não tem escopo datastore
   e não recebe automaticamente novos handlers deste módulo.
2. Instalar armazenamento protegido de claims/admissão, namespace, supervisor,
   journal durável e fontes reais de métrica/revisão humana. Test doubles não são
   prova dessas autoridades.
3. Autorizar IAM/scopes mínimos do executor real; não habilitar faturamento,
   comprar planos ou adotar IAM amplo como atalho.
4. Publicar fonte FA/projeção própria de verdade, com política administrativa,
   versão/hash/cobertura/revogação coerentes. Nenhum planner preview pode gerar
   `productionAuthorized:true` para atravessar este gate.
5. Rules/recursos FB, importação de identidade, cópia em unidades autorizadas e
   sessão/logout/revogação/permissões reais permanecem validações separadas antes
   da ativação da Gestão e antes de interromper writers FA.

## Extensão para outra instância Firebase/Firestore

O protocolo e o adaptador atuais são deliberadamente fixos em FA
(`sahmt-17a16/(default)`) e FB (`sahmt-gestao-5ae66/(default)`). Eles podem ser
reaproveitados como base, mas ainda não aceitam um terceiro projeto ou database.
Qualquer destino adicional deve entrar em uma allowlist privada com identidade
`{projectId, databaseId}`, operações e permissões próprias. O envelope assinado,
admissão, reserva, lease/binding e identidade do executor devem validar esse par
completo; não criar endpoint que aceite projectId/databaseId arbitrários do app.

Há duas opções diferentes:

- Outro projeto Firebase: é a extensão compatível com o desenho atual de projetos
  separados. O broker pode reutilizar o transporte e receber uma nova rota
  explicitamente pinada, mas o novo projeto exige configuração própria de Auth,
  Rules, região e identidade/binding. Nada disso foi criado ou ativado nesta
  preparação.
- Outro database nomeado dentro do projeto `sahmt-gestao-5ae66`: Firestore permite
  múltiplos databases, porém somente um database por projeto recebe a cota
  gratuita; o uso dos adicionais exige faturamento habilitado. Além disso, a API
  `getFirestore(app, databaseId)` do SDK Web está marcada na documentação oficial
  como preview e não recomendada para produção. Portanto esta opção não combina
  com manter o projeto sem faturamento e não deve ser implementada para uso
  produtivo com o SDK atual.

Referências oficiais consultadas em 10/10/2026:

- [Criar e gerenciar databases Firestore](https://firebase.google.com/docs/firestore/manage-databases)
- [Preços e cota gratuita do Firestore](https://firebase.google.com/docs/firestore/pricing)
- [Referência Web `getFirestore(app, databaseId)`](https://firebase.google.com/docs/reference/js/firestore)

Decisão atualizada pelo usuário: FC é o projeto Firebase separado
`indicadores---sahmt`, banco `(default)`, e deve entrar no mesmo fluxo de login
FA + FB + FC. O FA continua como identidade primária. Uma única chamada ao
broker privado deve validar o FA e retornar tokens customizados distintos e
vinculados ao UID para FB e FC; o cliente autentica FB e FC em paralelo. O token
FA não pode ser reaproveitado como token dos outros projetos. Uma falha/timeout
de FC deve ser reportada isoladamente e nunca bloquear o PWA, FA ou a sessão FB.

O scaffold local está desabilitado por padrão. FC ainda não tem a configuração
Web completa no cliente, signatário/iamCredentials autorizado, operação no
gateway nem emissão de token no endpoint atual. Portanto, a intenção de integrar
está aprovada, mas a autenticação tripla ainda não está operacional. As Rules FC
permanecem `allow read, write: if false`; inicializar Auth não abre Firestore.
Nenhum documento/coleção FC, dado migrado ou Rules foi criado/alterado. Não
publicar nem ativar o cliente/broker antes de concluir os gates abaixo.

Pontos locais identificados para a expansão, depois de escolhido o destino:

1. `src/management-session.js` e `src/management-session-browser.js`: conectar
   o coordenador FA/FB/FC ao ciclo de sessão mantendo o estado FB como requisito
   de Gestão e FC como sessão independente; preservar a navegação FA durante a
   conexão e em falhas do alvo FC.
2. O broker privado precisa validar FA uma vez, validar FB conforme a lease atual
   e emitir tokens customizados assinados separadamente para FB e FC, com claims
   de origem/UID/versão. A service account e a permissão `signJwt` de FC devem ser
   específicas do projeto e ficar apenas no servidor. O gateway atual fixa FA/FB
   e não atende este contrato.
3. `scripts/lib/management-broker-firestore-gateway.js` e
   `scripts/lib/management-broker-firestore-adapter.js`: substituir o roteamento
   FA/FB por uma allowlist de destinos `{projectId, databaseId}` e operações
   fechadas, preservando a compatibilidade do par atual.
4. Políticas de admissão/orçamento: cada projeto/database precisa de autoridade,
   reserva e estado de pausa próprios; não compartilhar recibos nem presumir que
   databases do mesmo projeto tenham cotas gratuitas independentes.
5. Rules FC seguem negadas até a definição e revisão do primeiro processo FC.
   A conexão de Auth, por si só, não habilita leituras/gravações nem inicia
   importação. Não há migração de dados nesta etapa.

## Validação local

Suítes sintéticas dedicadas:

```text
node --test tests/management-broker-firestore-gateway.test.js tests/management-broker-firestore-gateway-budget.test.js
```

Cobrem contrato fechado, pins/HMAC, claims, admissão atual FA/FB, pausa, medida,
replay, prazos, serialização, fonte produtiva, revisão nanos, ausência de OAuth no
caller e falhas incertas sem retry/refund. Nenhuma prova usa dados reais ou rede.
