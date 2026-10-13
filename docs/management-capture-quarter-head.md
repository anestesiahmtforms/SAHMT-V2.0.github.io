# Head da captura manual por quartos

Esta guarda registra uma única sequência de captura de FA, preservando o plano
histórico, o readTime e o checkpoint mais recente. Não consulta Firebase, não
libera orçamento, não modifica dados produtivos e não inicia o quarto seguinte.

## Interface

- `beginManagementCaptureQuarterHead`: primeira sequência sem head existente,
  ou próximo lote a partir do checkpoint exatamente pinado pelo head.
- `advanceManagementCaptureQuarterHead`: fixa o digest de cada estado protegido
  depois de salvar o checkpoint; os contadores e o histórico não retrocedem.
- `adoptInitialManagementCaptureQuarterHead`: adoção local do primeiro lote
  concluído antes desta guarda. Exige inventário independente com uma única
  sequência, lote 1 final e os mesmos hashes/readTime.
- `validateManagementCaptureQuarterHead`: valida somente dados, pins e histórico.
- `persistManagementCaptureQuarterHead`: compara o head atual, sincroniza o
  arquivo temporário e substitui-o atomicamente sob o mesmo lock exclusivo de
  captura. O prefixo histórico e contadores são novamente verificados no store.

O arquivo `.local-preview/management-split/quarter-head-FA.json` contém apenas
metadados seguros: hashes, nomes de arquivos locais, horários, contadores e IDs
locais de sequência/revisão. Documentos e cursores continuam nos checkpoints
protegidos por DPAPI. A gravação usa `FileHandle.sync()` antes do rename; não
declara garantia de persistência do diretório diante de falha de energia.

## CLI de captura

O head é salvo antes da busca de credenciais. Cada checkpoint fica protegido
antes de atualizar o head; o próximo transporte exige ambos os passos concluídos.
Falha de CAS/gravação conserva o lock e interrompe o processo. As reservas nunca
são reembolsadas. A ausência de head com checkpoints existentes exige adoção,
impedindo reiniciar silenciosamente uma sequência histórica.

Retomada por lote exige nova revisão humana após o término, orçamento atual admissível,
checkpoint/nome/hash/readTime/lote iguais ao head atual e configuração validada
pelo core. O ID da revisão usa o mesmo digest canônico na CLI e no head.
`IN_PROGRESS`, `INCOMPLETE`, `COMPLETE` e quarto lote parcial não admitem
retomada. Nenhum head existente é apagado ou resetado automaticamente, mesmo
com novo plano ou renovação da cota. Um plano novo exige revisão e preparação
separadas.

## Adoção local do primeiro lote já concluído

Com a captura encerrada e o lock livre:

```powershell
node scripts/management-quarter-head.mjs FA --adopt-initial capture-FA-20261009144443839-latest.dpapi.json
```

Esse comando só lê os artefatos locais, verifica DPAPI, o inventário e o plano
histórico revisado, e grava o head sob lock. Não procura credenciais, não chama
API, não altera a pausa ou o orçamento e não executa o lote seguinte. Recusa
adotar novamente ou escolher uma captura entre sequências ambíguas.

## Evidência local

Os testes de CLI usam pastas temporárias, proteção/Auth/REST sintéticos e
verificam o checkpoint e head antes de cada transporte simulado. Incluem
primeiro lote, retomada positiva com o core real, checkpoint antigo, primeira
sequência duplicada, adoção com pausa intacta, falhas antes das credenciais e
falhas após reserva sem despacho nem reembolso.

## Autorização humana limitada aos lotes restantes

A decisão humana recebida em 09/10/2026 às 15:12:31 UTC autoriza concluir apenas
os lotes 3 e 4 da sequência já iniciada. Essa decisão prevalece sobre a revisão
separada por lote, sem alterar o seu horário original e sem autorizar reinício.

A `authorizationEvidence` usa shape fechado
`HUMAN_AUTHORIZED_REMAINING_QUARTERS`: projeto/purpose/limite45k, fonte humana
literal e SHA256 UTF8, âncora do head/checkpoint/horário do lote 2, sequência,
digest canônico dos dois primeiros registros, plano e readTime originais,
faixa3–4, caps92/1500/6000, deadline até readTime+1h e automáticofalse.

`validateManagementRemainingQuarterAuthorization` valida esses campos. O lote
3 grava o digest completo dessa concessão no histórico; o lote 4 exige exatamente
o mesmo digest e prefixo. O ID de revisão também inclui o checkpoint atual,
mantendo IDs distintos para os dois lotes com a mesma decisão humana.
`requiresManagementRemainingQuarterAuthorization` impede que kind/marcadores
adulterados ou o horário original sejam aceitos pelo fallback de revisão simples.

A concessão nunca fornece consumo atual. O orçamento continua sendo avaliado
antes de cada reserva, e o prazo é verificado dentro da fila de reserva e no
despacho, com cancelamento no deadline. Cada comando continua executando um
único lote e registrando pausa; qualquer retomada para o próximo
lote usa a concessão validada e observação numérica fresca, preservando
`humanDecisionAt`. Não há loop/gatilho, quinto lote, extensão ou refund.

Um backup completo permanece consistente no readTime histórico original. Ele
não substitui a prova de contexto fresco exigida antes de cópia produtiva.
