# Revisão humana atual do consumo de FA

O modo `USER_CURRENT_USAGE_DASHBOARD_REVIEW` é uma alternativa **manual e específica** para avaliar uma nova captura de Gestão em FA, `sahmt-17a16`, com o limite diário já aprovado de **45.000** leituras. Não autoriza FB, cópia create-only, treinamentos, gatilhos ou créditos. O modo de métricas Cloud Monitoring permanece com sua validação anterior.

## Evidência e autorização

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

## Horários e estimativa

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

O controle privado anterior permanece histórico, pausado e expirado. Nenhum registro privado foi migrado ou rearmado por esta alteração. A fixture de 8 de outubro mantém data, `4.1k` e estimativa 5.000, com a nova proveniência explícita apenas no teste local. Uma futura prova operacional depende da revisão humana real; o teste não a produz.

## Testes

~~~powershell
node --test tests/management-read-budget.test.js
~~~

Fixtures locais verificam o caso anterior e uma captura nova de 9 de outubro, pins, proveniência humana, prazo, cobertura LA, arredondamento, margens e negações. Não fazem APIs, carregam credenciais, alteram políticas privadas ou comprovam consumo atual.
