# Contrato do ledger durável de orçamento da Gestão

Implementação local: `scripts/lib/management-budget-ledger.js`. Nenhum serviço,
API, binding, credencial, gatilho, autorização pública ou publicação é criado por
este módulo. A factory fica desabilitada por padrão. A suíte usa somente SQLite
local em memória, autoridades e relógios sintéticos.

## Projetos e autorização

| Projeto | Identidade | Política |
| --- | --- | --- |
| `sahmt-17a16` | FA, aplicativo atual | Teto inicial de 35.000; 45.000 somente com a nova autorização humana explícita e policy própria. |
| `sahmt-gestao-5ae66` | FB, Gestão | Teto e aprovação próprios. Nenhuma pausa, medição, limite ou aprovação de FA é herdada. |

Os tetos aceitos são 35.000 e 45.000 leituras totais por projeto no dia
`America/Los_Angeles`. Cada configuração deve declarar os dois valores
explicitamente. O teto inclui as leituras observadas do PWA e das rotinas, com
reserva adicional para uso do app, atraso da métrica e próxima operação. Um
pedido de custo menor que o máximo configurado é recusado.

`policyHashes[projectId]` e `status.policyHash` identificam a policy do projeto.
O hash inclui seu teto e suas operações, além dos parâmetros compartilhados
explicitamente configurados. Alterar teto ou operação de FA não invalida FB.
Uma alteração em parâmetro compartilhado afeta explicitamente os dois projetos.
O hash não é uma assinatura de autoridade: o armazenamento e as autoridades
privadas precisam ser confiáveis.

A pausa é persistente. Um novo ponto de métrica, uma nova instância do processo
ou a renovação do dia nunca a removem. Cada projeto começa pausado até receber
medição válida e revisão humana própria. O adapter privado pode reconhecer a
aprovação humana existente de FB; não deve exigir nem inventar nova autorização
por causa de FA. Nenhum controle dos treinamentos cancelados é alterado.

## Factory e policy obrigatória

```js
createManagementBudgetLedger({
  enabled: false, // precisa ser true explicitamente
  store,         // transação durável, ver abaixo
  policy,
  clock: Date.now,
  newReservationId, // default randomUUID, jamais ID informado pelo browser
  authorizeMeasurement,
  authorizeHumanReview,
})
```

Quando habilitada, retorna `enabled`, `policyHashes`, `status`,
`recordMeasurement`, `reviewPause`, `reserveFirestoreReads` e
`settleReservation`. O objeto e os hashes expostos são imutáveis. Inputs são
copiados antes de qualquer espera e getters, valores não JSON ou campos extras
são negados.

Campos da policy, todos explícitos:

- `schemaVersion: 1`, `version`, `dailyLimits` com as duas identidades e
  `quotaTimezone: 'America/Los_Angeles'`.
- `maxMeasurementAgeMs`: positivo, no máximo 300.000 ms. Usa o horário do último
  ponto confirmado, nunca o horário da consulta.
- `applicationReserveReads`, `metricLagReserveReads`: inteiros positivos.
- `reservationTtlMs`, `transactionTimeoutMs`: positivos, no máximo 120.000 ms.
- `maxApprovalAgeMs`: idade máxima da revisão humana.
- `maxReservationRecords`, `maxDayRecords`, `maxApprovalRecords`,
  `maxSettlementRecords`, `maxObservationRecords`: limites explícitos de retenção.
- `operationReadBounds`: máximos positivos por operação. O núcleo reconhece
  `readFaAuthorization`, `readFaSourceContext`, `readFbLease`, `writeFbLease` e
  `invalidateFbLease`; as três últimas pertencem somente a FB.

Não há custo certificado, TTL de remoção nem limite de retenção implícito. Os
valores da suíte são sintéticos. O host deve provar os limites de cada operação,
incluindo leituras dependentes de Rules, escopo das queries e efeitos de retries,
antes de usar uma policy real. Operações não configuradas são recusadas.

## Armazenamento transacional

```js
await store.transact(projectId, current => ({state, result}), {
  signal, deadlineMs,
});
```

O transform é **síncrono** e não faz espera, rede ou I/O. `current === null`
significa que a linha nunca existiu. Uma linha existente inválida, inclusive JSON
`null`, não pode virar bootstrap. O wrapper deve clonar estado e resultado,
serializar efetivamente todos os callers do mesmo projeto, persistir com rollback
integral e somente entregar `result` depois do commit. Nenhum caller escolhe
namespace arbitrário ou transforma snapshot fora da transação.

`management-budget-sqlite-store.js` fornece o adapter local com
`storage.transactionSync`, limite de bytes e verificação de cancelamento/prazo
antes do SQL e do commit. Os testes do ledger o exercitam com SQLite real local.
Uma futura Durable Object precisa mapear todos os callers a um namespace privado
constante e a esse mesmo banco. Uma instância separada por usuário ou worker não
preserva o orçamento agregado.

O ledger verifica schema, projeto, policy, dia, revisões, IDs únicos, vínculos de
aprovação/observação/liquidação e contabilidade. Corrupção ou policy incompatível
nega; não recria, apaga ou reduz o snapshot. Mudança de policy em linha existente
requer procedimento privado explícito de migração e revisão, preservando débitos
anteriores. Esse procedimento não é implementado aqui.

## Interfaces privadas

`ctx = {signal, deadlineMs}` limita cada espera por relógio lógico e monotônico.
Nenhum destes métodos é endpoint de administração HTTP público.

### Status

```js
await ledger.status({projectId}, ctx);
```

Retorna apenas policy/hash, revisão, dia, pausa/epoch/motivo, último ponto
confirmado, margens, totais conservadores e contagens de registros. Se faltar
medição ou ela estiver velha, persiste pausa. Não retorna snapshot bruto.

### Medição

```js
await ledger.recordMeasurement({
  projectId, quotaDay,
  metric: 'read_count', // ou read_ops_count, nunca somar os dois
  totalReadCount,
  measurementTimeMs, pointTimeMs, // iguais: horário do último ponto completo
  metricsComplete: true,
  observationId, observationHash,
}, {measurementContext, ...ctx});
```

`authorizeMeasurement(proof, measurementContext, ctx)` precisa confirmar a
proveniência, identidade do projeto, janela completa do dia e ID/hash/horário do
ponto obtido por uma autoridade privada. Um booleano enviado pelo cliente não é
prova. A prova é pinada antes da callback. A callback pode ser assíncrona, fora
da transação. Observações são tombstones únicos: replay idêntico é aceito sem
criar registro; mesmo ID com payload diferente pausa.

Ponto incompleto, futuro, antigo, count menor que o maior já observado, horário
regredido ou troca de métrica no mesmo dia pausa. Métricas alternativas não são
parcelas. Aumento de count nunca desconta débitos locais presumindo absorção.
Medição válida mantém qualquer pausa existente.

Recusa/falha da authority persiste uma parada. Se ela lançar, travar ou sofrer
cancelamento, o núcleo tenta uma transação separada de limpeza com prazo próprio
para persistir `LEDGER_MEASUREMENT_UNAVAILABLE`. Essa limpeza só escreve pausa;
nunca admite reads nem estende uma autorização. O supervisor do host deve manter
essa limpeza viva e bloquear todos os consumidores se a pausa não puder ser
confirmada no armazenamento. Não há garantia de pausa durável durante falha do
próprio banco.

### Revisão humana

```js
await ledger.reviewPause({
  projectId, quotaDay, dailyLimit, expectedPolicyHash,
  expectedPauseEpoch, expectedRevision,
  approvalId, approvedAtMs, decision: 'continue',
}, {approvalContext, ...ctx});
```

`authorizeHumanReview(review, approvalContext, ctx)` deve reconhecer uma decisão
humana real com o mesmo projeto/dia/teto/hash/epoch/revisão. Revisão expirada,
replay de `approvalId` ou contexto mudado não libera nada. Só com medição fresca
e margem disponível é persistida a retirada da pausa. A renovação diária exige
nova revisão própria. O núcleo não interpreta silêncio como autorização.

### Reserva antes do consumidor

```js
const receipt = await ledger.reserveFirestoreReads({
  projectId, operation, maximumReads,
  dailyLimit, quotaTimezone, quotaDay,
  applicationReserveReads, metricLagReserveReads,
}, ctx);
```

A reserva máxima e o tombstone único são persistidos atomicamente antes de o
consumidor receber o recibo. Duas instâncias concorrentes não podem ler o mesmo
saldo e reservar como se a outra não existisse. Antes do retorno, o recibo ainda
precisa pertencer ao dia atual e não ter expirado nos relógios lógico e monotônico. A validade termina, no máximo,
no fim do dia LA; não presume que todo dia tenha 24 horas.

O formato atende os guardas broker/browser: `schemaVersion`, `projectId`,
`operation`, `reservationId`, `quotaDay`, `quotaTimezone`, `dailyLimit`,
`pausedRequiresReview`, `metricsComplete`, `measurementTimeMs`, `expiresAtMs`,
`reservedReads`, `totalReadCount`, `outstandingReservedReads`,
`unreportedConsumedReads`, `applicationReserveReads`, `metricLagReserveReads`.
Guardas configurados para 35.000 recusam recibos FA de 45.000. Os consumidores broker/browser desta continuação já aceitam FA 45.000 com pinagem privada e mantêm FB 35.000; uma integração futura ainda precisa da
policy explicitamente aprovada, sem relaxar validação de FB.

### Liquidação interna

```js
await ledger.settleReservation({
  projectId, reservationId, settlementId,
  outcome: 'consumed', // ou unknown
  completedAtMs,       // null em unknown
}, ctx);
```

Somente o adapter privado que possui evidência do consumidor pode chamar esta
operação. `unknown` mantém o débito máximo como outstanding. `consumed` apenas
move o máximo para consumed; nunca reduz para uma estimativa de reads reais.
Pode reconciliar unknown para consumed com evidência de conclusão e horário.
Replay idêntico de settlement é idempotente; ID reutilizado com dados diferentes
ou consumo já terminal é recusado. O ledger não recebe endpoint do browser para
forjar resultado ou horário de conclusão.

## Contabilidade conservadora e retenção

Admissão exige:

```text
observado atual do projeto
+ reservas pendentes/desconhecidas acumuladas
+ máximos consumidos ainda não atribuídos à métrica
+ máximo da próxima unidade
+ margem do app
+ margem do atraso
< teto aprovado do próprio projeto (margem positiva)
```

Atribuição não provada permanece debitada mesmo que uma medição seguinte possa
já incluir a operação. Isso pode contar a mesma leitura duas vezes e interromper
antes do teto; é deliberado. Não existe API de desconto por suposta absorção.
Expiração, timeout, abort ou reinício jamais liberam reserva. Pending/unknown
carrega inteiro para dias posteriores até haver prova de conclusão. Consumo
confirmado continua debitado em todos os dias entre reserva e conclusão,
inclusive; somente um dia posterior à conclusão confirmada deixa de carregar
esse consumo. O tombstone nunca é apagado por essa mudança de dia.

Limites de registros/bytes esgotados negam e preservam registros. Capacidade de
ledger deve ser planejada antes de habilitar o host. Não existe TTL de exclusão,
reset por renovação diária ou limpeza automática que recicle IDs.

Se a espera pelo store vence depois de um commit, nenhum recibo admissível é
entregue e o débito pode já estar persistido. O host deve registrar resultado
incerto, reconciliar usando IDs/journal privado e jamais repetir a operação como
se nenhum efeito houvesse ocorrido. Erros são códigos estáveis e sanitizados.

## Gates antes de produção

- Binding privado único, SQLite durável e serialização real no host, inclusive
  reinício e execução concorrente; backup/recuperação que não volte a saldo antigo.
- Authority de Monitoring que valide janela completa, ID/hash/ponto fresco;
  sem confiar em flags/client-side counts e sem somar métricas alternativas.
- Authority humana privada que vincule projeto/dia/teto/hash/epoch/revisão.
- Integração de todos os consumidores e diário durável de efeitos, consumo e
  reconciliação de writes tardios/resultado desconhecido; nenhuma chamada direta
  contornando o ledger. Cada nova unidade pede nova reserva.
- Prova dos máximos de custo e margens, inclusive Rules e retries; testes de
  composição com os guardas configurados para cada teto.
- Supervisor que drene limpeza e bloqueie enquanto armazenamento/resultado da
  pausa ou execução forem desconhecidos. Nenhum endpoint admin público.

O ledger organiza admissão das rotinas integradas. Não é corte automático exato
de todo o PWA: Monitoring é amostrado e pode chegar atrasado; tráfego simultâneo
fora dos consumidores integrados continua consumindo o projeto. Não reativa
Gestão/Desempenho, treinamentos, evaluationRuntime, créditos ou faturamento.

## Verificação local

```powershell
node --test tests/management-budget-ledger.test.js
```

70 testes locais: namespace independente, FA45k/FB35k com hash próprio, pausa
persistente, autoridade/pins, prova fresca, regressão/alternativas, reservas
concorrentes sob SQLite real, reinício e replay, liquidação desconhecida,
retenção sem TTL, renovação sem retomada, corrupção, mudança de policy,
limite de bytes, abort/prazos lógicos e monotônicos, store pendurado, commit tardio
e recibo não confirmado. Sem conexão a qualquer projeto Firebase.
