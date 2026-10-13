# Captura consistente de recuperação de Gestão

Esta unidade prepara uma recuperação **separada** e somente leitura para FA
`sahmt-17a16`, namespace único `FA-rec1`. Não migra documentos para FB nem ativa
Gestão, Desempenho, Forms ou processamento de participantes.

## Evidência de origem e preservação

A sequência anterior terminou `INCOMPLETE / CHECKPOINT_TIMEOUT` em
`2026-10-09T15:44:36.807Z`, três milissegundos depois da janela de uma hora do
`readTime` original `2026-10-09T14:44:36.804Z`. Foram lidos 365 documentos e
43 coleções, porém a descoberta de subcoleções foi concluída para apenas 151
pais. Restam 214 pais. Seus 206 comprovantes HTTP são completos, mas o snapshot
permanece `null`.

A revisão local deve fixar independentemente os SHA do head, do estado
protegido, do plano anterior, do escopo e da política. Para a falha real:

- head: `acf64cbd77878682953608dc57cd942d3df9aeb4ecdd1df224f579daf3961654`;
- estado: `29946eaa38bfbb18b46e6033a6583a5967eb79b20c8dc102af8f3a68d262ffd5`;
- política: `15475490db69b1bbd761f0b09c3dfec39d0dd869d0b32e31e5bdefac08f02cbe`;
- reservas anteriores: 1.342.

A CLI conferirá esses pins contra os arquivos atuais. A guarda pura também
confere hashes, contadores, cadeias de páginas, histórico dos lotes, cobertura,
fila e ausência de comprovantes incertos. Pins fornecidos pelo chamador são
evidência de integridade; sua autoridade vem da revisão humana e do coordenador,
nunca do hash isolado.

Head, checkpoints, comprovantes, trava e política anteriores permanecem
intactos. Não se removem reservas, não se retoma o lote 4 e não se estende a
autorização técnica antiga. Os documentos antigos servem apenas para comparação;
não entram no snapshot novo.

## Autorização e orçamento

A nova evidência de recuperação referencia a instrução humana ampla recebida
às `2026-10-09T15:12:31.000Z`, com texto e hash literais:

> VEJO QUE ESTÁ BEM TRANQUILO , VAMOS FINALIZAR TODAS A S LEITURAS PARA PASSARMOS PARA PROXIMA ETAPA. VAMOS!

O tipo novo é `HUMAN_AUTHORIZED_FRESH_RECOVERY_CAPTURE`; não se aceita o grant
antigo `HUMAN_AUTHORIZED_REMAINING_QUARTERS`. Não se altera a data humana para
fabricar nova autorização. A evidência só vale no mesmo dia de cota de FA.

Cada reserva exige separadamente observação atual do consumo de FA, margem
para tráfego do app e atraso do relatório, e ledger durável sob exclusão mútua:

| Limite | Valor |
|---|---:|
| Total diário operacional de FA | 45.000 |
| Margem para o app | 5.000 |
| Margem para atraso | 2.000 |
| Reservas anteriores preservadas | 1.342 |
| Novas reservas máximas | 3.000 |
| Reservas cumulativas máximas | 6.000 |

O plano não fornece observação numérica, não limpa a pausa anterior e não
representa corte exato global do app. A observação continua sujeita à guarda de
cinco minutos antes de cada reserva.

## Contratos puros

`scripts/lib/management-capture-recovery-plan.js` exporta:

- `prepareManagementCaptureRecoveryPlan({predecessorHead, predecessorCheckpoint, predecessorPolicy, sourceScope, predecessorPins, authorizationEvidence, quotaDay, nowMs})`;
- `validateManagementCaptureRecoveryPlan({plan, ...mesmosInputs})`;
- `validateManagementCaptureRecoveryPlanEnvelope({plan, predecessorPolicy, authorizationEvidence, nowMs})`, sem receber documentos privados a cada reserva;
- `bindManagementCaptureRecoveryReadTime({plan, readTime, nowMs})`;
- `validateManagementCaptureRecoveryReadTimeBinding({plan, binding, nowMs, requireOpenDeadline})`.

`predecessorPins` tem shape fechado:

```javascript
{
  headSha256, checkpointSha256, quarterPlanSha256, scopeSha256, policySha256,
  originalReadTime, checkpointFinishedAt, reservedReads: 1342
}
```

`scopeSha256` é o hash canônico do escopo completo com exatamente cinco campos:
`schemaVersion: 1`, `projectId`, `databaseId`,
`scope: SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES` e `rootCollections`
na ordem original do arquivo, sem ordenar ou remover campos. É
igual ao do plano/head anterior. O hash do escopo do core, que omite `schemaVersion` e `scope` e ordena as raízes,
é validado separadamente.

O plano é fechado, possui `planSha256` canônico e contém `authority`, `quota`,
`predecessor` e `captureConfiguration`. Recebe exatamente as mesmas 43
raízes. Configuração: página de documentos 25, página de IDs de coleções 100,
até 3.000 páginas, 6.000 documentos, profundidade 30, 12 MiB, duração 240 segundos
e timeout individual de 20 segundos. Não inclui `readTime`, lote ou estado de
retomada.

Após preflight, proteção e credenciais, o coordenador escolhe um único
`readTime` atual, no máximo cinco segundos anterior ao relógio, e posterior ao
término da sequência falhada. O binding fixa prazo `startedAt + 240000`;
journal e CAS devem persistir esse binding uma única vez antes da primeira
reserva/transmissão. A função pura não garante sozinha que o chamador a invocou
uma vez. O validador de binding pode admitir persistência terminal depois do
prazo usando `requireOpenDeadline: false`, sem autorizar novos despachos.

## Execução e conclusão

A execução usa o core existente sem opções de lote ou retomada. Snapshot,
journal, checkpoints e trava pertencem ao namespace novo; nenhum processo
concorrente pode iniciar outra tentativa, nova sequência ou usar o orçamento
em paralelo. Falha permanece registrada e não provoca retry implícito.

A sequência histórica durou 74,528 segundos para 161 requisições, incluindo
a gravação e a validação local dos checkpoints. Esse tempo não isola a latência
da rede e não certifica a duração da recuperação. Um ensaio local com 365
documentos sintéticos e 420 operações duráveis levou 327,371 segundos sem
HTTP; portanto, essa primeira implementação não estava pronta para a janela
de 240 segundos. A atestação privada de pacotes imutáveis remove uma validação
integral duplicada no mesmo processo. Pacotes externos ou deserializados
continuam passando por descompactação, limites, hash e resumo completos.
A duração deve ser medida novamente antes de executar a fonte. Latência, novos
documentos e subcoleções podem impedir a conclusão; o prazo permanece fixo.

Somente o consumidor da captura real pode declarar `COMPLETE`, após conferir
fila e cursor vazios, todos os documentos/pais/coleções, comprovantes completos
no **mesmo novo readTime**, hashes e reservas. Os 365 documentos históricos
não são um teto atual nem prova de ausência de subcoleções. Captura completa
ainda não constitui contexto atual elegível para uma escrita de migração; essa
etapa exige suas próprias provas atuais, ACL, Auth, manifesto e produtores.

## Testes

`node --test tests/management-capture-recovery-plan.test.js` usa exclusivamente
fixtures públicas sintéticas, sem rede, credenciais, fonte ou dados reais.
Cobre pins, provas incertas, filas, cadeia de tokens, histórico, autoridade
original, mutações re-hashadas, margens, novo readTime, prazo fixo e negação de
ativação ou retomada implícita.
