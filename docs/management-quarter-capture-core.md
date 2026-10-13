# Captura de Firestore em lotes com revisão

## Escopo

O núcleo em scripts/lib/firestore-snapshot-capture.js continua somente leitura,
com transporte, reserva, relógio e checkpoint injetados. Nenhum lote publica Rules,
copia dados para FB, importa Auth ou concede acesso.

O plano histórico de FA contém 365 documentos em 43 raízes. O limite proposto
de 92 entradas por chamada é ceil(365/4). Os 134 documentos classificados COPY
são outro conjunto: esta captura não é uma cópia de 34 desses documentos.
O total corrente pode mudar; o plano histórico não certifica a quantidade atual.

## Interface

A captura por lotes requer:

- maxBatchDocuments: limite de entradas devolvidas por listDocuments em uma chamada.
- maxBatches: número máximo de chamadas do mesmo plano, entre 1 e 4.
- limits.maxDurationMs: prazo de cada chamada, no máximo 180000 ms.
- pageSize: tamanho base, reduzido antes de cada request ao saldo do lote.

Entradas incluem documentos existentes e pais ausentes devolvidos por showMissing.
Isso conserva o limite mesmo diante de subcoleções órfãs. Reservas e descobertas
são adicionais ao contador de documentos; 92 entradas não significa 92 leituras
totais do projeto. As reservas continuam anteriores a cada tentativa e nunca
são devolvidas por pausa, erro ou timeout.

Ao atingir o limite com trabalho restante, o retorno é PARTIAL_REVIEW,
snapshot:null, receipt.complete:false e receipt.consistent:false. O checkpoint
privado conserva fila, cursor real, hashes de tokens, documentos, metadados,
descobertas, páginas concluídas, reservas cumulativas e readTime original.
Não existe continuação automática dentro da chamada.

## Retomada explicitamente revista

validateFirestoreCaptureResume(options) é exportado como validador puro para
a CLI usar antes de carregar credenciais. Não exige adapters e não consulta
Date.now, arquivos ou rede. Recebe a mesma configuração de captura e:

- resumeState: state do checkpoint protegido anterior.
- resumeStateSha256: pin do state obtido do envelope protegido revisto.
- resumeReviewId: identificador único da nova decisão de revisão.
- nowMs: horário explícito para conferir readTime e monotonicidade.

A captura real usa os mesmos três campos de retomada com seus adapters injetados.
O núcleo valida estado PARTIAL_REVIEW limpo, pin, configuração, projeto, banco,
raízes, readTime, limites, sequência das páginas, saldos, tarefas pendentes,
descobertas e histórico dos lotes. Mudanças de configuração, dados estruturais
corrompidos, INCOMPLETE, páginas UNCERTAIN e repetição de reviewId são recusados.
O validador devolve uma cópia privada do state; não imprimir esse retorno.

Um hash ou reviewId não autentica uma decisão humana. A CLI deve conferir sua
prova protegida, autorização nova após finishedAt e margem corrente. A unidade
pura não cria essa prova, não limpa pausa e não busca métricas.

## Prazo e elegibilidade

startedAt e readTime originais permanecem iguais. Só o deadline do lote atual
começa na chamada explicitamente revista; ele não renova a janela de consulta
de readTime, que continua estritamente menor que uma hora. Não é permitido unir
capturas de dias ou readTimes diferentes ou trocar a data para aparentar frescor.

A quarta chamada que ainda tenha trabalho pendente continua PARTIAL_REVIEW e
indica batchPlanExhausted:true. Uma quinta chamada é recusada; o crescimento exige
revisar um novo plano. Nenhuma parada parcial é elegível ao planner ou ao contexto
de migração. Mesmo depois de completar as 43 árvores, o contexto exige evidência
corrente com readTime de no máximo cinco minutos e todos os demais gates.

Se a janela original vencer antes da revisão seguinte, o checkpoint permanece
como evidência histórica parcial. Uma captura nova necessita decisão explícita;
ela não prolonga nem substitui o readTime deste checkpoint.

## Testes locais

tests/management-quarter-capture.test.js usa somente documentos sintéticos.
Cobre 92 entradas com páginas 25/25/25/17, quatro chamadas explicitamente separadas,
crescimento, pais ausentes, subcoleções, exclusão de snapshots parciais,
configuração pinada, corrupção, tokens, contadores, prazo e zero retry.

Nenhum teste comprova tráfego real, cota total, autorização humana, transporte
produtivo, captura atual, cópia para FB ou validação em dispositivo.
