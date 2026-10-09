# Orçamento independente de FB para a cópia de Gestão

## Escopo

A autorização humana para continuar normalmente no FB é aplicada somente à cópia de Gestão no projeto **sahmt-gestao-5ae66**, banco **(default)**. O modo explícito é `USER_AUTHORIZED_BOUNDED_FB_MIGRATION`, com finalidade `MANAGEMENT_MIGRATION_CREATE_ONLY`.

A pausa e o limite diário de **45.000** leituras de FA continuam independentes. Este módulo não altera políticas de FA, não libera leituras da origem, não reabre treinamentos e não reutiliza a autorização já consumida do backup inicial de FB. Broker, sessão do app, gatilhos e créditos também não recebem autorização por este modo.

O uso total de FB permanece **desconhecido**. A política declara `totalUsageKnown:false`, `measuredTotalReads:null`, `dailyReadLimit:null` e `exactGlobalCutoff:false`. Não exige Monitoring, não herda o limite antigo de 35.000 e não fabrica uma medição do consumo total.

## Limite da execução

O escopo fixa os seis hashes do plano, fonte, manifesto, destino, ACL e identidade, além de `runId` e da lista exata de documentos. A autorização fixa:

- Até 1.000 unidades e no máximo 10.000 reservas locais.
- Reservas separadas para `READ_PAIR` e `COMMIT_PAIR`, com mínimo de duas por etapa.
- Conferência `POSTCHECK` com até quatro reservas por par e teto cumulativo explícito.
- Prazo de execução de até cinco minutos e autorização de até quinze minutos.
- Dia de cota `America/Los_Angeles`; mudança de dia interrompe a execução.
- Uma reserva de leitura e uma de commit por unidade, sem repetição implícita de etapa.

Para o plano atual de **134 pares**, com duas reservas em cada etapa e duas para conferir cada par:

| Etapa | Reservas locais |
| --- | ---: |
| Leitura e commit dos 134 pares | 536 |
| Conferência dos 134 pares | 268 |
| Total máximo da execução | 804 |

Esses números são reservas locais do transporte, não uma medição faturável, um teto certificado de leituras reais ou uma promessa de margem global. `COMMIT_PAIR` conserva uma margem local mesmo sendo uma operação de gravação. Um plano diferente precisa de um novo escopo e limites explícitos.

## Integração e persistência

Implementação pura: `scripts/lib/management-migration-destination-budget.js`. Não obtém credenciais, relógio, métricas, arquivos, rede ou serviços.

1. Criar uma nova política com `createFbMigrationDestinationBudget({projectId,scope,authorization,nowMs})`. Ler antes qualquer política existente; jamais sobrescrever um registro pausado ou consumido para rearmar a mesma execução.
2. Sob o lock do registro de FB, chamar `assessFbMigrationDestinationBudget({projectId,scope,policy,nowMs,reservation})`.
3. Persistir atomicamente o `nextPolicy` pendente em armazenamento protegido, preservando a reserva antes de qualquer transporte.
4. Chamar `acknowledgeFbMigrationDestinationReservation` com `{persisted:true,reservationId,policySha256}` do registro efetivamente persistido.
5. Persistir também o `nextPolicy` confirmado retornado pelo acknowledgement. Somente depois usar sua `proof`.
6. Revalidar a prova imediatamente antes do transporte com `validateFbMigrationDestinationBudgetProof({proof,nowMs,maximumReads,expected:{runId,pins,path,stage}})`.
7. Conservar a reserva diante de timeout, resposta incerta ou falha. Não descontar ou reutilizar a mesma etapa.
8. Persistir `pauseFbMigrationDestinationBudget` em falha que exija revisão, inclusive quota indisponível ou persistência sem confirmação. Finalizar apenas o estado local com `finishFbMigrationDestinationBudget`.

O hash de acknowledgement cobre a política inteira: `fbMigrationDestinationPolicySha256(policy)`. O acknowledgement puro não substitui a confirmação de gravação real feita pelo adaptador. A prova fica vinculada ao run, aos seis hashes, ao documento, à etapa, ao máximo de leituras e ao prazo fixo.

O adaptador deve manter o lock até confirmar ambas as gravações locais antes de soltar o transporte. Uma falha na segunda gravação deixa a reserva debitada e bloqueia a execução. Nenhum rollover de dia, nova métrica, retry ou chamada de status limpa `pausedRequiresReview`.

O executor aceita este tipo de prova de FB e conserva a validação anterior de orçamento medido. Seus controles de contexto fresco, manifesto, ACL, identidade, isolamento do destino, precondições create-only e checkpoint continuam necessários. O novo orçamento não é prova de que a origem ainda corresponde ao backup nem de que a cópia real foi concluída.

## Assinaturas principais

`scope`:

~~~js
{
  schemaVersion: 1, projectId: 'sahmt-gestao-5ae66', databaseId: '(default)',
  runId, pins, unitPaths
}
~~~

`authorization`:

~~~js
{
  schemaVersion: 1, authorized: true,
  projectId: 'sahmt-gestao-5ae66', databaseId: '(default)',
  purpose: 'MANAGEMENT_MIGRATION_CREATE_ONLY',
  authorizationSource: 'EXPLICIT_HUMAN_CONTINUE_FB',
  authorizationId, approvedAt, expiresAt,
  maximumDurationMs: 300000,
  readPairMaximumReads: 2, commitPairMaximumReads: 2,
  maximumPostcheckReads: unitPaths.length * 2,
  maximumReservedReads: unitPaths.length * 6
}
~~~

`reservation`:

~~~js
{
  projectId: 'sahmt-gestao-5ae66', databaseId: '(default)',
  runId, pins, path, stage, maximumReads, reservationId
}
~~~

`stage` admite `READ_PAIR`, `COMMIT_PAIR` e `POSTCHECK`. `path` pertence à lista aprovada. Autorização e reservas são exclusivas da execução; não aceitar credenciais ou prova fornecida pelo cliente da PWA.

## Testes locais

~~~powershell
node --test tests/management-migration-destination-budget.test.js tests/management-migration-executor.test.js
~~~

Os testes usam estados e transporte sintéticos. Conferem isolamento FA/FB, 134 pares e sua conferência, reservas cumulativas, vinculação ao executor, confirmação de persistência, falhas, prazo e mudança do dia, latches e rejeição de finalidade ou projeto diferente. Não fazem consultas ou gravações de produção e não validam login em dispositivo real.
