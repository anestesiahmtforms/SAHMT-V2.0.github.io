# Continuação da migração de Gestão em 9 de outubro de 2026

Este registro reúne a preparação local e as evidências da migração no branch
`codex/management-firebase-split`. A sequência original das quatro quartas de FA
terminou `INCOMPLETE`; a recuperação separada **FA-rec1 terminou COMPLETE**.
A auditoria local e a captura manual vazia de FB também foram concluídas.
FA é `sahmt-17a16`; FB é `sahmt-gestao-5ae66`. A etapa fechada de cópia histórica
foi concluída como **FB-stage2 COMPLETE**, com 134 documentos e 134 registros
de proveniência conferidos. Não houve importação Auth, concessão de acesso/pontos
ou ativação da PWA em FB; a cópia permanece fechada e histórica.

## Resultado concreto

- Revisão dos backups protegidos: 134 cópias propostas e 231 registros mantidos
  em FA. São dados históricos das capturas, não uma leitura atual do catálogo.
- CLI produtiva `scripts/management-migration.mjs`: revisão local sem credenciais; cópia
  exige cápsula protegida, pins, evidência fresca e destino fechado.
- REST: leitura consistente de pares, criação atômica com `exists:false` em ambos,
  conferência de documento/proveniência, sem sobrescrita ou repetição automática.
- Persistência: checkpoints e reservas cifrados com DPAPI, lock exclusivo,
  atualização atômica e retenção obrigatória diante de falha ou commit incerto.
- Orçamento de FB separado, finito e ligado ao plano. Não usa a pausa ou a
  medição de FA como seu consumo. Não representa limite exato do app.
- Proposta privada de permissões: 60 perfis, um administrador geral designado,
  uma exceção preservada e 58 intenções de usuário comum. Nenhum grant efetivo.
- Ponte dedicada de Auth, adaptador REST e gateway privado Firestore do broker
  preparados e desativados; OAuth permanece somente no processo privilegiado.
- Sequência histórica original das quatro quartas: até 92 documentos por bloco,
  **365 cumulativos**, com `INCOMPLETE/CHECKPOINT_TIMEOUT` e 214 verificações de
  subcoleções pendentes. Seus artefatos e políticas continuam preservados.
- Recuperação separada **FA-rec1 COMPLETE**: 365 documentos, 43 raízes, 365 pais
  conferidos e 418 requisições confirmadas. A auditoria local encontrou os
  **365 registros idênticos** ao baseline revisado: **134 COPY e 231 KEEP_FA**.

## Estado atual da preparação fechada

As capturas Auth históricas de **9/10 às 19:41 UTC** registraram **60 usuários em
FA e zero em FB**. A revisão ficou local; não houve importação ou grant. Essas
capturas não certificam o estado Auth atual.

A execução real do inventário nativo às **19:53 UTC** encontrou **zero gatilhos
do usuário executor**. A cobertura permanece limitada aos módulos conhecidos e
àquele executor; não certifica a ausência global de produtores ou gatilhos.

A revisão da PWA publicada confirmou o projeto **FA** no entry servido e nas
fontes do main pinado `3e628197fb39f9d63de521fde72104da38a88b42`. O binding de
`src/data.js` para `src/firebase.js` usa o app primário configurado e guardado
para FA. A revisão não observa todas as sessões abertas nem ativa FB.

As quatro consultas administrativas `functions.list`, v1/v2 de FA/FB, em
**10/10 às 00:17 UTC**, responderam **HTTP 403 / SERVICE_DISABLED**. O inventário
Functions permanece **desconhecido**, sem prova de lista vazia, `STOPPED` ou
ausência global. Essa limitação é preservada na preparação fechada.

A captura independente **FB-manual1 terminou COMPLETE**: **44 raízes, zero
documentos e 44 tentativas confirmadas**, no readTime
**2026-10-10T00:25:37.594Z** (**9/10 às 21:25:37.594 BRT**). A autorização e as
reservas dessa captura são próprias; as políticas históricas e artefatos de FA
permaneceram preservados. Destino vazio comprova somente o escopo capturado,
sem certificar a ausência de escritores administrativos.

O rascunho privado local prepara uma cópia histórica fechada de **134 documentos
mais 134 proveniências**, preservando manifesto, UIDs e ACLs. A
[especificação da etapa fechada](management-closed-staging-spec-20261009.md) e o
[plano local](superpowers/plans/2026-10-09-management-closed-staging.md) descrevem
um lote único atômico com `exists:false`, 268 leituras de FB antes e 268 depois,
reservas duráveis e interrupção diante de conflito ou resultado incerto.
A execução **FB-stage2 terminou COMPLETE às 00:39:48.013 UTC de 10/10**
(**21:39:48.013 BRT de 9/10**). Os 268 caminhos estavam ausentes antes do lote
e foram conferidos como idênticos ao conteúdo esperado após o commit.

Essa etapa usa o snapshot histórico FA-rec1 pinado e auditado, com **zero novas
leituras de FA**. O executor produtivo e seus gates existentes permanecem
intactos. O recibo registra `historicalCapture:true` e
`requiresReconciliationBeforeActivation:true`. Principal, banco, faturamento e
Rules fechadas de FB foram conferidos antes da escrita; as Rules foram
conferidas novamente depois. Nenhuma Rules, permissão, conta ou flag foi alterada.

## Cópia fechada concluída em 9 de outubro

O commit real de FB ocorreu em **2026-10-10T00:39:38.364990Z**
(**9/10 às 21:39:38.364990 BRT**). A conferência consistente posterior usou esse
mesmo horário de commit. Foram criados **134 documentos de Gestão e 134
proveniências**, em lote com precondição de ausência; **268 documentos conferidos**.
Os **231 KEEP_FA** permanecem na origem. O conteúdo corresponde à captura
FA-rec1 de **2026-10-09T19:29:04.765Z**, sem nova consulta de FA nessa cópia.

A primeira tentativa, **FB-stage1**, parou no precheck com HTTP 400 e **zero
requisições de escrita**. Dois diagnósticos limitados confirmaram que o relógio
local estava adiantado: readTime de um segundo atrás ainda era futuro para o
servidor. Stage2 usou cinco segundos atrás para o precheck e o horário real do
commit para a conferência posterior. Os artefatos stage1 e as duas reservas de
diagnóstico foram preservados; não houve repetição automática ou reembolso.

Reservas locais conservadoras: **536 em stage2**, **270 anteriores** (268 no
precheck stage1 e uma em cada diagnóstico), **806 cumulativas dessa etapa**.
Incluindo as 44 da captura vazia separada, são **850 reservas locais de FB**.
Esses valores não medem o total diário ou a cota efetivamente faturável.
Stage2 emitiu duas requisições de leitura e um commit; confirmou 268 gravações.

Recibo privado: `stage-management-FB-stage2-receipt.json`. Checkpoint DPAPI:
`stage-management-FB-stage2-checkpoint-0008.dpapi.json`, SHA256
`276e58b014f456338fe966758746318bf196302349cbb8475a097003a447ca47`.
Batch SHA256: `960c8c96c060472e8959a7b7c0ca86ce8fe7de2c584f6298cac310ee8590085a`.
Metadados pré-commit em **00:39:32.776 UTC** confirmaram owner, banco e
faturamento desabilitado; Rules publicadas continuaram negando acesso de clientes.
Inventário global de produtores permanece não certificado. Todos os dados e
recibos privados seguem fora do Git.

A autoridade humana original de continuar foi preservada, sem nova validade de
minutos nem redatação. FB continua fechado, a PWA publicada segue usando FA e
nenhum Auth, grant, crédito, runtime, broker ou produtor FB foi ativado.

A captura enviada pelo usuário às **21:31 BRT de 9/10** mostra **2.939/50.000
leituras, 6 gravações e zero exclusões** no painel diário, atualizado às 21:31:04.
O identificador do projeto está ausente na imagem; o valor permanece observação
humana histórica e não foi convertido em medida atual da API ou atribuído a um
projeto sem evidência.

A unidade pura passou **38/38 testes**, zero falhas ou skips, em 4.042,5231 ms
na execução do coordenador. A agregação local das unidades staging/plan/context/
executor passou **189/189**, zero falhas ou skips, em 4.663 ms. Essas execuções
não certificam login, host do broker ou dispositivo autenticado.

## Evidências anteriores

Em 9/10 às 12:38:36 UTC, o preflight somente de metadados de FB verificou sete
checks: projeto/principal, banco Standard/Native `(default)` em São Paulo,
faturamento desabilitado, Google e domínio da PWA, além das Rules publicadas
iniciais fechadas. Nenhum documento foi lido por esse preflight.

Às 12:38:33 UTC, Monitoring de FA indicou 1.696 leituras, com último ponto às
12:36:00 UTC. Esse valor é **histórico**. A tentativa de captura naquele checkpoint
detectou a métrica vencida e parou antes de carregar credenciais ou ler documentos.
A pausa de FA ficou retida para revisão sob o limite de 45.000.

Após a confirmação humana de continuar, a avaliação às 13:33:29 UTC retornou
1.698 leituras, mas o último ponto era 13:05:00 UTC (`fresh:false`). Foi apenas uma
consulta de Monitoring; naquele checkpoint nenhuma captura foi admitida e a
pausa permaneceu. Esse valor também não prova margem atual.

A conta Cloudflare reconheceu a sessão OAuth e o Worker de Etiquetas existente.
A API de subscriptions respondeu 403; o plano efetivo de hospedagem do novo
broker não foi confirmado. Não houve deploy, criação de secret, ajuste de
faturamento ou alteração do Worker existente.

O helper `ManagementMigrationInventoryNative.gs` foi acrescentado ao editor
Apps Script em 9/10 às 13:40 UTC. O readback confirmou 17 arquivos e preservação
exata dos 16 anteriores, inclusive manifesto e escopos. A função
`consultarInventarioMigracaoGestaoNativaSahmtV2` foi executada pelo usuário às
13:43:16 UTC: 232 funções, sem divergência e sem leituras Firestore. Sua cobertura
é limitada aos 12 módulos conhecidos e gatilhos do usuário executor;
`complete:false` não equivale a inventário global completo.

## Primeira captura fracionada de FA — 14:44:43 a 14:44:45 UTC

O usuário informou **3.000 leituras** em uma mensagem recebida às **14:42:31 UTC**.
O modo `USER_CURRENT_USAGE_HUMAN_REPORT` registrou a origem
`HUMAN_USER_MESSAGE_TEXT` e o período `CURRENT_FA_QUOTA_DAY_TO_REPORT`, do início
do dia LA, 07:00 UTC, até o relato. Para a avaliação local, a estimativa superior
conservadora foi **4.000**, com as margens do app e do atraso preservadas.

Esse dado é um **relato humano contextual do consumo até aquele momento**;
não é captura de tela, consulta API, métrica Monitoring nem total global exato.
A validade de cinco minutos começa no recebimento original, 14:42:31 UTC, e
não se renova durante a execução. O relato anterior recebido às 14:30:04 UTC
não foi redatado nem reaproveitado como evidência atual.

O primeiro bloco começou às **14:44:43.850 UTC** e terminou às
**14:44:45.845 UTC**, com os seguintes metadados:

| Campo | Resultado |
| --- | --- |
| Estado | `PARTIAL_REVIEW` |
| Documentos capturados no bloco e cumulativos | 92 |
| Reservas locais do bloco | 309 |
| Tentativas emitidas | 13 |
| Máximo de documentos por bloco | 92 |
| Máximo de blocos da captura preparada | 4 |
| Teto local de reservas por bloco | 1.500 |
| Próximo bloco automático | Não |
| Revisão humana necessária | Sim |
| Captura parcial elegível para migração | Não |
| Decriptação e conferência de hash | Confirmadas |
| Escritas Firestore emitidas | 0 |

**309 são reservas conservadoras locais, não uma medição de leituras faturáveis.**
A pausa de FA foi preservada após o bloco. Não houve cópia produtiva em FB,
retomada automática, grants, pontos ou corte de escritores FA.

Os metadados acima foram conferidos no recibo privado
`.local-preview/management-split/capture-FA-20261009144443839-receipt.json`.
Dados, identidades e snapshots protegidos continuam fora do Git.

## Segundo lote autorizado de FA — 15:07:44 a 15:07:51 UTC

Após um relato humano de **3.400 leituras**, recebido às **15:03:25 UTC**, o
usuário escolheu explicitamente **"Capturar segundo lote"**. O modo textual
conservou `CURRENT_FA_QUOTA_DAY_TO_REPORT` e a estimativa superior local
**4.000**, sem transformar o relato em medição exata. A validade continuou
vinculada ao horário original da mensagem; não houve renovação por retry.

O segundo bloco começou às **15:07:44.703 UTC** e terminou às
**15:07:51.637 UTC**. Foram preservados `startedAt` original,
**14:44:43.850 UTC**, e `readTime`, **14:44:36.804 UTC**.
Metadados conferidos:

| Campo | Segundo bloco | Cumulativo |
| --- | ---: | ---: |
| Documentos protegidos capturados | 92 | 184 |
| Reservas conservadoras locais | 318 | 627 |
| Tentativas emitidas | 18 | 31 |
| Escritas Firestore emitidas | 0 | 0 |

O resultado continua **`PARTIAL_REVIEW`**, com próximo bloco automático
desativado, revisão humana necessária e snapshot parcial **não elegível para
migração**. Não houve erro de captura ou de decriptação/hash. As 627 reservas
cumulativas não são um total medido de leituras faturáveis.

A conferência usou os metadados do recibo privado
`.local-preview/management-split/capture-FA-20261009150741295-receipt.json`:
HEAD revision **41**, hash
`a8f390179e2cf51032b0257fc8536aa557a98ef18317b3e46b63600140d2e26a`.
O snapshot permanece protegido no arquivo DPAPI correspondente e fora do Git.
O checkpoint confere com o hash fixado no HEAD:
`df5f818f2db7631be00fa436a2964967754bde586ce9b0db9532c83b9089f9d8`.
A política terminou pausada por `MANUAL_QUARTER_REVIEW_REQUIRED`; nenhuma
cópia produtiva para FB foi emitida.

## Autorização para concluir os lotes restantes — 15:12:31 UTC

O usuário autorizou concluir todas as leituras restantes. A decisão foi recebida
em **15:12:31 UTC** e cobre os lotes 3 e 4 da sequência atual, sem pedir novamente
aprovação por lote. A concessão preserva o head e checkpoint do segundo lote,
o histórico, plano e readTime originais, limite diário de 45.000, até 92 entradas
por bloco e reservas de até 1.500 por bloco/6.000 cumulativas.

O horário humano não muda entre os dois comandos. O digest da concessão fica
fixado no histórico do terceiro lote e precisa ser idêntico no quarto.
Reinício, quinto lote, alteração da concessão e prazo vencido são recusados.
O prazo de consistência termina em **15:44:36.804 UTC**, uma hora após o readTime
original. Cada execução continua sendo um bloco limitado, sem gatilho ou loop.

A concessão foi conferida localmente contra o checkpoint atual, sem API e sem
alterar a pausa. A execução ainda precisa de consumo atual admissível: o relato
numérico anterior de 3.400 não foi redatado. Autorização e observação de consumo
são evidências distintas. Até essa preparação, somente os dois lotes descritos
acima foram executados; FB permanece com zero cópias produtivas.

Um backup completo é consistente no readTime original. O executor produtivo
mantém a exigência de contexto atual de até cinco minutos. A etapa preparatória
histórica fechada descrita acima usa a captura FA-rec1 pinada e exige
reconciliação posterior antes da ativação.

## Terceiro e quarto lotes executados — 15:42:37 a 15:44:36 UTC

O usuário confirmou **"CONTINUA EM 3.400"** às **15:41:51 UTC**. O novo relato
foi registrado com sua origem e horário atuais, mantendo a estimativa superior
conservadora de 4.000. A mesma decisão humana original de 15:12:31 autorizou
os dois comandos; seu horário e a concessão não foram alterados entre lotes.

| Campo | Terceiro bloco | Quarto bloco | Cumulativo |
| --- | ---: | ---: | ---: |
| Documentos protegidos capturados | 92 | 89 | 365 |
| Reservas conservadoras locais | 326 | 389 | 1.342 |
| Tentativas emitidas | 14 | 161 | 206 |
| Escritas Firestore emitidas | 0 | 0 | 0 |

O terceiro bloco foi `PARTIAL_REVIEW`, de **15:42:37.072** a **15:42:44.240 UTC**.
O quarto começou em **15:43:22.279 UTC**, com 365 documentos e 43 coleções-raiz
listados. A descoberta de subcoleções chegou a **151 de 365 caminhos**, todos
sem descendentes conhecidos até esse ponto. Restaram exatamente **214** tarefas
`listCollectionIds`, com `active:null`. Todos os 206 proofs foram `COMPLETE`,
sem resultado HTTP incerto.

A janela de consistência do readTime original terminou em **15:44:36.804 UTC**.
O último checkpoint consumiu a margem final; a captura encerrou em
**15:44:36.807 UTC** como **`INCOMPLETE/CHECKPOINT_TIMEOUT`**, com `snapshot:null`.
Contagem cheia de documentos não comprova cobertura integral das subcoleções.
O consumidor local de captura completa mantém esse pacote recusado.

A auditoria DPAPI local confirmou os pins do estado final: HEAD revision **397**,
hash `acf64cbd77878682953608dc57cd942d3df9aeb4ecdd1df224f579daf3961654`,
checkpoint `29946eaa38bfbb18b46e6033a6583a5967eb79b20c8dc102af8f3a68d262ffd5`.
Política e lock foram preservados pausados por `CHECKPOINT_TIMEOUT`, sem refund.
As reservas conservadoras não são uma medição de leituras faturáveis.

Recibos privados `capture-FA-20261009154234040-receipt.json` e
`capture-FA-20261009154319925-receipt.json`, com a auditoria em
`remaining-quarters-actual-proof-20261009.json`, permanecem fora do Git.
Nenhuma cópia produtiva em FB, exclusão FA, grant, crédito ou ativação foi feita.

A recuperação posterior usou nova sequência e readTime real, preservando os
artefatos anteriores. A captura antiga serve para comparação; seu tempo não
foi misturado aos novos resultados e a trava histórica permaneceu preservada.

## Preparação histórica da recuperação separada

O plano local do namespace **FA-rec1** foi preparado em **16:18:41.092 UTC**,
com SHA **fa7881ef763ecda996fc8738a94918bcb807ab5264ee127a6a0de1da04a8ac96**.
A validação usou o head, checkpoint DPAPI, política e escopo reais, sem acessar
APIs. O escopo preserva exatamente os cinco campos e a ordem das 43 raízes.
Sua evidência humana continua datada de **15:12:31 UTC**, sem mudar a data.

A tentativa então proposta previa novo readTime, prazo fixo de 240 segundos,
páginas de 25 documentos e reserva adicional máxima de 3.000. O piso de 1.342 e
o teto cumulativo de 6.000, margem do app de 5.000, atraso de 2.000 e limite
diário de FA de 45.000 foram preservados. Naquela preparação, nenhum binding ou
reserva da nova tentativa havia sido criado; a política e a trava da sequência
antiga não mudaram. A execução real posterior está registrada abaixo.

O número de 3.400 informado às **15:41:51 UTC** permanece evidência histórica.
Sua validade local de cinco minutos terminou em **15:46:51 UTC**. Antes da
execução então proposta, ainda eram necessários CLI e duração validados e um
novo informe humano de consumo. O plano não mede o consumo e não fornece corte global
exato do app. A recuperação não copia dados para FB nem ativa funcionalidades.

Os testes puros do plano/orçamento passaram **127/127**, sem falhas ou skips,
em **3.215,5448 ms**, em recovery-pure-root-20261009.log. O readback
síncrono autenticado de envelopes da mesma instância de proteção passou
**7/7** testes Windows com dados sintéticos em **13.888,5375 ms**, em
protector-local-open-root-20261009.log, e recebeu revisão independente.
Arquivos históricos e a conferência final continuam usando DPAPI independente.

## Validação local e CI

A agregação com a concessão dos lotes restantes passou **1.906/1.906** testes,
sem falhas ou skips, em **95.694,3982 ms**, usando fixtures e transportes locais.
Log `remaining-grant-final-aggregate-20261009.log`, sob
`.local-preview/management-split`. A revisão independente confirmou as guardas
de âncora, prazo, prefixo, orçamento e preservação da decisão humana original.
Essa agregação precede a nova unidade local de revisão de captura completa.
A nova conferência local de captura completa passou **39/40** casos focados,
sem falhas, com um skip de symlink de arquivo regular no Windows. O teste DPAPI
real sobre dados sintéticos passou. Log `quarter-snapshot-review-root-20261009.log`,
com duração de **7.590,2174 ms**. Essa unidade recebeu revisão independente;
ela recusa a captura original incompleta e mantém produção/migração/frescor falsos.

A agregação local anterior à concessão dos lotes restantes, incluindo as verificações HEAD, passou **1.872/1.872**
testes, sem falhas ou skips, em **129.077,5421 ms**. Log:
`quarter-first-final-aggregate-20261009.log`, sob
`.local-preview/management-split`. O guard de HEAD da CLI também recebeu
revisão independente de 53 testes, somente local e sem APIs.

A agregação anterior de **1.828** testes fica como evidência histórica do estado
pré-HEAD, sem falhas ou skips, em `quarter-first-aggregate-20261009.log`.
O build passou em **23,26 s**, com log `quarter-first-build-20261009.log`.

O CI `37941971308` passou para o head já commitado `2ac9a73` do PR #30. Isso não
representa CI das novas alterações locais de quarter/gateway ainda não
commitadas. A validação anterior de 12 testes de
`management-destination.rules.test.js` ocorreu no emulador Firestore demo.

Testes e build não comprovam IAM/assinatura do broker, login FB, revogação entre
projetos, experiência em dispositivo autenticado ou operação em Safari.
Os quatro blocos reais de FA descritos acima também não comprovam essas etapas.

## Verificação final da recuperação em 9 de outubro

A recuperação separada FA-rec1 foi conferida localmente. A reserva é
persistida antes de cada transmissão; o readback AES-GCM, o CAS, os pins
antigos, o limite diário de 45.000 e as margens continuam exigidos. A
atestação privada aceita somente o packet imutável criado no mesmo processo;
packet externo ou deserializado mantém a validação integral. Não há retomada
implícita nem mudança na pausa histórica.

A agregação atual passou **2.162/2.164** casos, **zero falhas** e **dois skips**
(symlink regular no Windows e benchmark longo selecionável), em
**135.988,1346 ms**. Log: `recovery-final-management-root-20261009.log`.
O benchmark foi executado separadamente com 365 documentos sintéticos de
1.272.756 bytes e 420 operações duráveis: **150.219,783 ms**, sem rede,
reduzindo o resultado anterior de 327.371,300 ms. Isso não mede a latência
real nem garante conclusão dentro do prazo fixo de 240 segundos. Prova:
`recovery-attested-performance-proof-20261009.json`.

A PWA passou **915/915** testes de domínio, sem falhas ou skips, em
36.547,5433 ms; o build passou em **12,25 s**, com o aviso existente de
chunk maior que 500 kB. Logs: `recovery-domain-root-20261009.log` e
`recovery-build-root-20261009.log`. Não houve publicação da PWA.

A imagem enviada mostra **3,3 mil leituras** e **6 gravações** no período
`out. 8 - out. 9`. O nome do projeto está cortado e o painel exibe uma
janela móvel de 24 horas; portanto, ela foi registrada como evidência
histórica, sem produzir autorização ou medição exata do dia de cota.
Prova: `user-panel-image-3300-20261009-evidence.json`.

Ao terminar essa verificação local anterior, o checkpoint original estava
**INCOMPLETE**, com 365 documentos e 214 pais pendentes, e FA-rec1 ainda não
havia sido executada. A atualização manual e a captura real posterior estão
registradas na seção seguinte. O checkout principal mantém suas três alterações
preexistentes. A autorização original das leituras restantes continua em
2026-10-09T15:12:31Z; não foi redatada.

## Captura manual concluída em 9 de outubro

O usuário substituiu a exigência de renovação do relato a cada cinco minutos
pelo controle manual de uma captura. A instrução humana e o relato numérico
ficaram registrados separadamente com texto/hash e horário original do app.
O relato de 3.300 manteve reportedAt **18:54:13 UTC**; sua estimativa conservadora
é 4.000, com observationCurrent:false. Preparação posterior não atualiza esse
consumo. O limite diário de 45.000 e as reservas de app/atraso permaneceram.

O preflight manual não consultou credenciais nem Firestore. Os testes focados
passaram **136/137**, zero falhas, um skip do benchmark opcional, em
**30.604,3156 ms**. Log: manual-read-integration-root-20261009.log.
A integração também recebeu revisão independente após corrigir a passagem de
undefined no modo antigo. Nenhuma publicação ou atualização do PR ocorreu.

A captura real FA-rec1 terminou **COMPLETE**. Leitura consistente única:
**2026-10-09T19:29:04.765Z**. Execução: **19:29:09.795–19:33:00.146 UTC**.
Foram capturados **365 documentos**, **43 coleções** e **365 pais conferidos**,
sem pais ausentes. Todas as **418 requisições** foram confirmadas.
Reservas conservadoras: **1.690** nesta captura e **3.032** cumulativas incluindo
as 1.342 anteriores. Esses valores são reservas locais, não medição do total do
projeto. O timeout técnico de execução não renovou a autorização nem o relato.

Captura protegida: capture-recovery-FA-rec1.dpapi.json. Recibo:
capture-recovery-FA-rec1-receipt.json. Ciphertext SHA256:
fd7ee26d83dd7a6650b426d5276ab1103f054c1c88f683eca12d4db09856bdb9.
Snapshot SHA256:
f53440723ad073107dcb528b1bb67c28132e4268e8fe38c3b63740a33dc66dd1.
Decriptação e hash finais foram conferidos; o coordenador desta captura foi
liberado. O head, checkpoint, política e lock antigos permaneceram preservados.
A autorização única foi consumida, sem repetição ou retomada automática.

**Nenhuma gravação Firestore, cópia para FB, mudança de Auth, grant ou crédito**
foi realizada nesta captura. productionAuthorized, migrationReady e
operationalFreshnessEvaluated permanecem falsos. A conclusão comprova somente
a captura da origem; a comparação local e o contexto da cópia são etapas
separadas.

## Próximas condições de operação

A captura FA-rec1, sua auditoria, o preflight FB e a cópia histórica fechada
foram concluídos. A liberação produtiva continua separada:

1. Preparar e revisar o executor de importação de identidade e o host real do
   broker, preservando UIDs, privilégios, exceções e acesso fechado.
2. Reconciliar dados, Auth, ACLs, identidade/direitos e produtores antes de
   qualquer ativação de FB. A cópia histórica não certifica deltas posteriores.
   Os pares já criados exigem plano de reconciliação; não repetir o executor
   produtivo antigo que ainda espera um destino vazio.
3. Conferir host, sessões/dispositivos autenticados, logout e revogação nessa
   liberação; nenhuma data ou flag substitui evidência operacional.
4. Obter validação humana da migração antes de interromper escritores antigos FA.

FA permanece preservado. Desempenho permanece em FA e a consolidação preparada
exige origem confiável para não duplicar eventos migrados. O rollout anterior de
75 treinamentos continua cancelado; nenhuma janela ou gatilho é rearmado.
