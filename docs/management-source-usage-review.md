# Revisão humana atual do consumo de FA

A avaliação manual de FA, `sahmt-17a16`, conserva o limite diário já aprovado
de **45.000** leituras. As três fontes permanecem distintas:

| Fonte | Origem registrada | Período/evidência |
| --- | --- | --- |
| Relato textual humano | `USER_CURRENT_USAGE_HUMAN_REPORT` / `HUMAN_USER_MESSAGE_TEXT` | Dia atual LA até o relato, com horário de recebimento real |
| Captura enviada pelo usuário | `USER_CURRENT_USAGE_DASHBOARD_REVIEW` / `HUMAN_USER_MESSAGE_ATTACHMENT` | `LAST_24_HOURS` cobrindo o dia LA |
| Cloud Monitoring | `CLOUD_MONITORING` | Pontos completos/frescos da métrica validada pelo modo existente |

Esses modos autorizam somente a captura de Gestão em FA no escopo aprovado.
Não autorizam FB, cópia create-only, treinamentos, gatilhos ou créditos. A
autorização de FB continua independente. Relato textual não enfraquece as
condições da captura enviada ou do modo Cloud Monitoring.

## Controle manual solicitado em 9 de outubro

O modo separado `MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION` atende ao pedido
humano de controlar as leituras manualmente. Sua autorização vale para **uma
captura**, dentro do dia de cota aprovado de Los Angeles, e não expira após cinco
minutos. O modo anterior conserva sua regra histórica; não é usado para esta
captura manual.

O relato numérico conserva o texto, a proveniência e o horário original. Ele é
uma estimativa histórica informada pelo usuário, com `observationCurrent:false`,
`totalUsageKnown:false` e `measuredTotalReads:null`. Uma revisão posterior não
renova a medição. A mensagem humana que solicitou o controle manual é uma
segunda evidência, fixada ao plano e à autorização original do escopo.

Continuam o limite FA de 45.000 por dia, as reservas de 5.000 para o app e 2.000
para atraso, as 1.342 já reservadas, até 3.000 para esta nova captura e o teto
cumulativo de 6.000. A reserva precede cada requisição e não é devolvida em falha.
Concluir ou falhar consome a tentativa; não há repetição ou retomada automática.
A renovação do dia não cria uma autorização.

O timeout técnico de 240 segundos da execução e a leitura consistente única
permanecem. Esse timeout limita a operação em andamento; não é prazo para o
usuário responder ou informar novamente o consumo.

## Relato textual atual do usuário

O modo `USER_CURRENT_USAGE_HUMAN_REPORT` aceita uma leitura informada diretamente
pelo usuário na conversa. A origem é `HUMAN_USER_MESSAGE_TEXT`; não converter o
relato em anexo, captura de tela, consulta API ou observação Monitoring.

A revisão confiável registra o texto literal, seu SHA256 UTF8 sem normalização,
a mensagem humana de origem e o `reportedAt` de recebimento real. Esses campos
ficam ligados a um evidence ID opaco, à observação inteira e à autoridade privada
`EXPLICIT_HUMAN_FA_QUARTER_CAPTURE_REVIEW`, com finalidade
`MANAGEMENT_BACKUP_ONLY` e limite FA 45.000. A aprovação real já concedida à
quarter é preservada; não fabricar uma nova aprovação no horário do relato.

A observação contém `reportedText`, `reportedReads`, estimativa `reads`,
`reportedAt`, `reviewedAt`, `evidenceId`/`evidenceSha256` e a proveniência:

~~~js
{
  schemaVersion: 1, source: 'HUMAN_USER_MESSAGE_TEXT',
  humanMessageId, evidenceId, evidenceSha256, reportedAt
}
~~~

`manualReportEvidence` e `manualReportSha256` fixam a evidência na política.
`manualReportAuthorization` vincula IDs humanos da autorização e do relato,
projeto, finalidade, limite, dia LA, horários reais, evidence ID/hash,
`observationSha256` e `maximumCaptureReserve`. O cap da quarter precisa coincidir
com o cap aprovado, impedindo aumento posterior. Só o fluxo privado que conferiu
as instruções humanas reais pode construir esse registro.

`sourceUsageHumanReportTextSha256` confere o texto literal;
`sourceUsageHumanReportObservationSha256` fixa o conjunto da observação.
`sourceUsageHumanReportUpperReads` toma um inteiro informado e reserva o milhar
seguinte: **3.000 → 4.000**; **4.000 → 5.000**. O resultado é estimativa superior
conservadora, não total exato ou certificação do consumo faturável.

O período é `CURRENT_FA_QUOTA_DAY_TO_REPORT`: desde `quotaDayStart` até o relato,
conforme o contexto humano explícito de FA. Não afirmar cobertura LAST24H ou
semântica de uma métrica a partir desse texto. Exige
`reportedAt <= reviewedAt <= now`, aprovação real `humanDecisionAt <= reviewedAt`
e no máximo **cinco minutos desde o reportedAt original**. Revisão posterior,
retry ou nova execução não podem redatar a mensagem.

O modo textual nega `capturedAt`, `captureProvenance`, `displayedEstimate` e
campos que aleguem API/métrica. Mantém `totalUsageKnown:false`,
`measuredTotalReads:null` e `exactGlobalCutoff:false`, margem de pelo menos 5.000
leituras para o app e 2.000 para atraso, reservas anteriores e próxima operação.
Uso alto, cap insuficiente e `pausedRequiresReview:true` continuam bloqueando.

### Primeira aplicação real, somente leitura de FA

Um relato de **3.000**, recebido em **9/10/2026 às 14:42:31 UTC**, produziu upper
local **4.000**. O bloco começou às **14:44:43.850 UTC** e terminou às
**14:44:45.845 UTC**. Capturou 92 documentos,
reservou 309 leituras conservadoras em 13 tentativas e terminou
`PARTIAL_REVIEW`, com pausa/revisão exigida. A decriptação e o hash foram
conferidos; nenhuma escrita Firestore foi emitida. A captura parcial não é
elegível para migração. Não houve cópia produtiva para FB nem próximo bloco
automático. Consulte [o registro da continuação](management-migration-status-20261009.md).

## Captura enviada pelo usuário: evidência e autorização

Uma revisão real precisa de:

- Captura enviada diretamente pelo usuário, identificada pelo arquivo original, SHA256, horário real e mensagem humana de origem.
- Identificação do projeto FA e período `LAST_24_HOURS`, cobrindo integralmente o dia atual da cota de Los Angeles.
- Valor exibido lido da captura, estimativa superior conservadora e ausência de declaração de total exato.
- Instrução humana explícita para a captura de Gestão, vinculada a essa revisão, com message ID, horário e escopo concretos.

`manualReviewEvidence` é um identificador opaco aprovado dessa evidência. Não é uma data mágica nem uma condição que autoriza uma observação futura. Ele deve coincidir com `observation.evidenceId`, com a proveniência do arquivo e com `policy.manualReviewAuthorization.evidenceId`.

A observação contém `captureProvenance` com os seis campos:

~~~js
{
  schemaVersion: 1, source: 'HUMAN_USER_MESSAGE_ATTACHMENT',
  humanMessageId, evidenceId, evidenceSha256, capturedAt
}
~~~

A política contém `manualReviewAuthorization` com `authorized:true`, autoridade `EXPLICIT_HUMAN_FA_BACKUP_REVIEW`, IDs opacos de autorização e mensagem da decisão, projeto FA, finalidade `MANAGEMENT_BACKUP_ONLY`, limite 45.000, dia da cota, os três horários, evidence ID/hash, `captureHumanMessageId`, `captureSource` e `observationSha256`.

`sourceUsageReviewObservationSha256(observation)` fixa os campos essenciais da observação inteira, incluindo valor exibido, estimativa, período, horários e proveniência. Uma troca de `4.1k` para `4.2k` invalida a aprovação anterior mesmo que ambos tenham o mesmo arredondamento superior.

**Hashes e flags não provam autoridade humana.** Somente o fluxo de revisão confiável pode elaborar esse pacote após examinar a captura e a instrução humana reais. Não aceitar prova autodeclarada pelo navegador nem substituir um anexo humano por captura automática do agente. Recalcular hashes não transforma a origem automática em humana.

## Captura enviada: horários e estimativa

Exige `capturedAt <= reviewedAt <= humanDecisionAt <= now` e captura com no máximo cinco minutos. Os horários podem coincidir quando a captura, sua revisão e a autorização explícita estão no mesmo envio humano. Não alterar horários para renovar a observação.

`periodStart` é exatamente 24 horas antes de `capturedAt`, deve anteceder o início do dia LA, e a captura deve ocorrer no dia atual. No último trecho de um dia LA de 25 horas, um painel das últimas 24 horas pode não cobrir o dia inteiro: nesse caso a revisão é negada.

`sourceUsageReviewUpperReads(displayedEstimate)` aceita números inteiros e valores com `k`/`mil` ou `m`/`mi`/`milhão`/`milhões`, com até duas casas decimais e separador decimal ponto ou vírgula. Inclui o intervalo de arredondamento do display e arredonda para o próximo milhar:

| Display | Estimativa superior local |
| --- | ---: |
| 4.1k ou 4,1 mil | 5.000 |
| 3k | 4.000 |
| 5.00k | 6.000 |
| 12,7 mil | 13.000 |

Essa conta não certifica o total faturável ou um corte global exato. A observação declara `totalUsageKnown:false`, `measuredTotalReads:null` e `exactGlobalCutoff:false`. Mantêm-se as margens do app, atraso, trabalho anterior e próxima operação; consumo alto ou reserva insuficiente continua bloqueando.

## Pausa e registros anteriores

`assessManagementReadBudget` é puro: não obtém hora, captura, credenciais, métrica ou permissão, e não grava nem limpa políticas. `pausedRequiresReview:true` continua bloqueando antes de qualquer avaliação manual. Renovação de dia, nova imagem ou uma prova sintética não limpam a pausa.

O controle privado antigo de treinamentos permanece histórico, pausado e expirado, sem alteração. A função pura não limpa a pausa automaticamente. Para a captura atual de Gestão houve revisão humana explícita deste único bloco; a operação terminou novamente pausada, com estado `PARTIAL_REVIEW`. Isso não rearma o trabalho de treinamentos ou qualquer próximo bloco.

A fixture de 8 de outubro mantém data, `4.1k` e estimativa 5.000, com a proveniência explícita apenas no teste local. Uma prova operacional exige revisão humana real; o teste não a produz nem renova a validade da evidência histórica.

## Testes

~~~powershell
node --test tests/management-read-budget.test.js
~~~

Fixtures locais verificam captura enviada e relato textual, pins, origem humana real, prazo original, cobertura LA, arredondamento, margens, cap da quarter e negações. Os testes não fazem APIs, carregam credenciais, alteram políticas privadas ou comprovam consumo atual. A operação real somente leitura está registrada separadamente acima.
