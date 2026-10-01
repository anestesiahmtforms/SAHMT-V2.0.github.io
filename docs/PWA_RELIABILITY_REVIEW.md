# Revisão de confiabilidade e desempenho — 30/09 a 01/10/2026

## Fonte e entrega

Base final desta conciliação: `main` v155 em `f5c9f02c773e4cb18da8941f4bd65bfa624073f7`, com os 53 commits posteriores à base anterior `282272adc22b328d853d46630687cc06897d2cb3` preservados. O ZIP de Downloads contém 146 arquivos iguais ao commit histórico `1a2fb621c921ebeb3b8f0c776c2256c0f4f2c634`, sem diferenças de conteúdo; ele permanece apenas como referência histórica.

O trabalho foi feito em checkout isolado. A cópia original permanece em `c7797f3`, com suas três modificações em `docs/LABEL_AI_WORKER.md`, `src/firebase-app.js` e `src/styles.css` preservadas.

PR consolidado para revisão: [confiabilidade, títulos e Arsenal #1](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/pull/1). As mudanças visuais preparadas no PR #2 foram reunidas neste pacote para testar e implantar uma única composição. Não houve merge em `main` nem publicação de produção desta revisão.

## Correções, na ordem solicitada

### Conciliação com as atualizações até a v155

Foram mantidos o banner inicial intencional de quatro segundos e seus três textos, os relatórios/cartões novos, edição somente diária, confirmação do registro manual, mudanças de Gestão, estilos dos modais e atraso a R$200 por múltiplo. A unificação do histórico de Etiquetas/Eventos sem texto de versão, recebida durante a revisão, também foi incorporada. Os testes novos de `main` continuam no comando de domínio; fixtures de Windows normalizam CRLF.

A revisão corrigiu a primeira transição `loading-profile` → `signed-in` com o mesmo UID, que antes não iniciava as pré-consultas. As respostas iniciais têm chave de escopo efetivo, e os relatórios de Eventos/Etiquetas conferem sessão, permissão, período, diálogo, rota e identidade do alvo antes e depois de imports/leituras. Alteração apenas do nome não invalida o preenchimento. Gravações diretas limpam o cache inicial antes da escrita autorizada, evitando mostrar um relatório anterior ao registro como sincronizado. A edição de um valor histórico preserva o valor gravado; somente mudar tipo/múltiplo/turno recalcula pela regra atual, sem migração de registros existentes.

Concessões de permissão e mudanças de papel durante uma leitura retomam somente o relatório aberto, usando o novo escopo; não deixam a tela em "Carregando" nem reconstruem o formulário. Nome, estado offline e permissões de outro módulo não reiniciam a consulta. A revogação real continua bloqueando imediatamente.

Foram preservados também o QR central com recorte alinhado, o catálogo de 28 arsenais incluindo inativos, o rodapé com nome do responsável e o novo Voltar no relatório diário. A leitura do responsável revalida o contexto entre imports, consultas e páginas; captura o papel administrativo antes de começar. Cada abertura da confirmação tem geração própria: fechar/reabrir descarta a prévia anterior, e fechar durante uma leitura libera o botão para nova tentativa. Os arsenais do relatório em paisagem foram redistribuídos para preservar alvos de 32 px no menor visor validado, mantendo os textos e o retorno.

O cache candidato avança de V155 para V156. HTML, manifesto e arquivos fixos são revalidados com `reload` na instalação, porque suas URLs podem permanecer iguais entre builds. Os testes simulam HTTP cache quente e impedem ativação quando um arquivo essencial está indisponível. Nenhuma publicação de produção foi feita.

1. **Checklist:** cada consulta captura geração, data, rota, UID, período e abertura do relatório. Resultados e erros antigos não substituem o relatório atual. Preparação e transação de assinatura repetem a validação, inclusive após a leitura da transação. O banner da estação também possui geração própria: salvar, fechar ou reutilizar o banner não permite que callbacks antigos fechem outro banner ou reabram outro dia.
2. **Sessão:** snapshots repetidos atualizam a identidade sem reconstruir formulários. Eventos e Etiquetas mantêm preenchimento, foto, foco e diálogo. A entrega de uma revogação precede a escrita opcional em IndexedDB; cache lento ou com falha não adia o bloqueio. Mudança de sigla do usuário comum exige nova consulta do escopo pessoal. Guardas de escrita revalidam sessão/permissão após imports e leituras e antes de persistir ou enfileirar. As Rules continuam sendo a autoridade no servidor.
3. **Offline:** o SW V156 deriva o grafo necessário do manifesto emitido pelo Vite. Auth, projeções Lite, dados operacionais, controlador de câmera e decoder QR ZXing entram no precache. O decoder é necessário em aparelhos sem `BarcodeDetector`, incluindo Safari. Quando emitido pelo build com IA configurada, o pequeno SDK App Check também entra: a inicialização Firestore existente aguarda esse módulo, inclusive no fluxo de perfil/cache local. A sequência de proteção foi preservada. PDF, IA e assinatura ficam fora. Instalação incompleta falha. O shell anterior permanece para imports de abas antigas, e a navegação offline seguinte prefere o shell atual. Reload offline recupera JS/CSS com hash e o decoder essencial; imagens pedidas com `reload` continuam exigindo o servidor, evitando confirmar uma imagem antiga como atualizada. A galeria preparada tem prioridade sobre cópias da mesma URL em shells anteriores.
4. **Consultas:** pedidos idênticos em andamento são compartilhados por UID, período, estações e limite. Depois de ler o intervalo atual, só se busca histórico anterior para estações sem resposta no primeiro dia. A sentinela de truncamento mensal não é usada como resposta retida. Vigência, herança do último NÃO, autorização, assinatura e aviso de histórico incompleto permanecem.
5. **Desempenho móvel:** abertura, primeira interação, troca para Etiquetas e alternativas de galeria foram medidas. Não foi acrescentado pré-carregamento novo além do que já havia na v133; a revisão corrigiu apenas o início e o escopo dessas consultas. As alternativas de lazy loading da galeria reduziram bytes ocultos, mas aumentaram a espera pela primeira imagem; foram descartadas. As imagens originais e a legibilidade foram preservadas.

IDs determinísticos, reconciliação, fila offline e taxas atuais de Eventos foram mantidos. Não houve alteração em Rules, índices, Functions, Worker, Apps Script ou configuração de serviços.

## Medidas de consultas

Fixture local com 30 estações fictícias, cinco amostras e atraso de 90 ms por consulta, repetida na composição final de 01/10. Execute `npm run measure:checklist`. Contagens de documentos são retornos de snapshots, não uma estimativa exata de faturamento Firestore. A medição isola o leitor de respostas/histórico; não soma catálogo de estações nem a consulta do responsável recebida da v154.

| Cenário | Consultas antes → depois | Documentos antes → depois | Mediana antes → depois |
| --- | ---: | ---: | ---: |
| Diário completo, 1.000 registros | 31 → 1 | 1.030 → 1.000 | 97 → 96 ms |
| Diário, cinco estações sem resposta | 31 → 6 | 1.030 → 1.005 | 100 → 192 ms |
| Diário vazio | 31 → 31 | 30 → 30 | 98 → 198 ms |
| Mensal, dia 1 completo, 2.001 registros/sentinela | 31 → 1 | 2.031 → 2.001 | 94 → 104 ms |

**Custo remanescente:** dias parcialmente respondidos ou vazios recebem uma ida adicional à rede, porque o histórico depende da resposta atual. A redução de leituras não representa ganho geral de latência. O teste de resumo mensal compara a herança antes/depois e cobre o limite de registros. Uma estratégia que reduza também essa latência exigiria outra revisão do modelo de consultas/dados.

## Build e experiências no navegador

O build final consolidado sobre a v155 foi executado com as mesmas variáveis públicas do workflow atual. O grafo estático do shell tem dois arquivos/523.133 bytes; o grafo offline selecionado tem 13 arquivos/1.418.114 bytes. Incluindo HTML, manifestos, ícones, imagens fixas e o decoder QR, o precache integral tem **23 arquivos/2.346.517 bytes**. São tamanhos descompactados dos arquivos, sem contabilizar cabeçalhos; não são bytes transferidos com gzip. O aviso existente do chunk Firestore de 550,77 kB permanece.

Uma fixture local serviu os builds reais anterior e atual em Edge/Chromium, com viewport 390×844, toque móvel, CPU 4×, latência de 150 ms e download de 1,6 Mbps. Cada medição de tempo usa três amostras. O perfil, a escala e a fila são fictícios; requisições externas são abortadas. Os tempos e as amostras estão em [benchmarks/pwa-2026-09-30.json](benchmarks/pwa-2026-09-30.json). Isso mede o shell com perfil local; não mede login Google, latência real do Firestore, câmera ou IA.

Abertura offline, escala em cache, registro manual de Etiquetas e imports posteriores de uma aba antiga passaram com o servidor bloqueado e sem erros de página. A navegação offline seguinte carregou o build novo. O marcador de ação pendente conservou seu ID. Chromium tenta atualizar o SW em segundo plano mesmo fora da emulação offline da página; o servidor local recusou também essas conexões.

Para reproduzir, prepare dois builds com as mesmas variáveis públicas, instale/disponibilize Playwright e Chromium e execute `node scripts/verify-pwa-browser.cjs`, depois `node scripts/verify-pwa-browser.cjs --measure`. `SAHMT_BASELINE_DIST` aponta para o build separado do main; `SAHMT_PLAYWRIGHT_MODULE` e `SAHMT_BROWSER_EXECUTABLE` permitem usar uma instalação existente. O cabeçalho do script descreve as opções. O script não instala dependências nem altera o workflow; os JSONs de cada execução ficam em `.local-preview/`.

Para a imagem na mesma URL, o servidor local trocou dois PNGs sintéticos de 8×8. `fetch(..., {cache: 'reload'})` recebeu a imagem nova e a gravou no cache dedicado. Depois do corte de rede, o corpo corrigido foi conferido diretamente em CacheStorage e a ação pendente em IndexedDB continuou intacta. A precedência do cache preparado sobre um shell antigo é coberta separadamente pelo teste do SW. A fixture não substitui uma conferência visual de imagem corrigida em aparelho.

Na galeria, a versão atual solicita 589.219 bytes mesmo oculta, e a primeira imagem já preparada aparece em mediana de 245 ms após abrir. Todas as imagens lazy evitam esses bytes, mas a primeira imagem leva 16,9 s; lazy com dimensões originais leva 11,5 s. São experiências locais de rede limitada, sem SW; a contagem de bytes soma os arquivos requisitados, não a transferência concluída em cada instante. Nenhuma dessas variantes foi aplicada.

## Medidas históricas após conciliar a v134

O pacote consolidado passou novamente nos 251 testes de domínio, no build e nos cenários offline, incluindo aba V134 → V135 e preservação do ID da fila. Os resultados anteriores de [pwa-2026-09-30.json](benchmarks/pwa-2026-09-30.json) são históricos contra a base anterior e documentam também as experiências de galeria. As novas amostras e os 70 cenários visuais estão em [pwa-v134-2026-10-01.json](benchmarks/pwa-v134-2026-10-01.json).

| Mediana da fixture móvel | Main V134 | PR consolidado |
| --- | ---: | ---: |
| Abertura | 10.070 ms | 10.249 ms |
| Primeira interação | 514 ms | 592 ms |
| Troca para registro manual de Etiquetas | 997 ms | 850 ms |

São três amostras por build em 390×844, CPU 4× e 150 ms/1,6 Mbps. Não há ganho geral de velocidade demonstrado: abertura ficou 179 ms mais lenta e primeira interação 78 ms mais lenta; a troca para Etiquetas ficou 147 ms mais rápida. Essa amostra pequena não separa diferença consistente de variação da fixture. O banner intencional de quatro segundos foi mantido. O perfil local é marcado offline para bloquear serviços externos; isso não mede o login real nem as pré-consultas autenticadas corrigidas. Emuladores, build e outras execuções visuais foram encerrados antes dessa medição.

## Validação final sobre a v155

Os cenários offline foram repetidos com os builds reais V155 → V156: aba antiga manteve seus imports, a navegação offline seguinte usou o pacote novo, houve zero respostas de servidor durante o corte de rede e o ID da fila foi preservado. A correção de imagem na mesma URL passou novamente. O script agora lê as versões dos dois service workers, sem simular uma versão diferente da contida no build.

| Mediana da fixture móvel final | Main V155 | PR consolidado |
| --- | ---: | ---: |
| Abertura | 10.175 ms | 10.268 ms |
| Primeira interação | 476 ms | 451 ms |
| Troca para registro manual de Etiquetas | 743 ms | 898 ms |

São novamente três amostras por build, com os mesmos limites da fixture anterior. Abertura ficou 93 ms mais lenta, primeira interação 25 ms mais rápida e Etiquetas 155 ms mais lenta. Não há ganho geral de velocidade demonstrado, e as três amostras não distinguem efeito consistente de variação local. Por isso não foram aplicadas outras mudanças especulativas de pré-carregamento ou galeria. Build, emuladores e execução visual estavam encerrados durante a medição. Amostras, consultas, offline e resumo dos 112 cenários visuais estão em [pwa-v155-2026-10-01.json](benchmarks/pwa-v155-2026-10-01.json). Os benchmarks anteriores permanecem identificados como históricos.

## Testes e limites

- Domínio: **281/281**, com regressões de A→B chegando fora de ordem, sessão/cache lentos, revogação, concessão durante leitura, preservação do shell, banners, assinatura, consultas/herança, toque e SW. Foram acrescentadas 14 regressões do leitor e da confirmação nova; o SDK App Check também foi coberto com chave relativa ou gerada no manifesto, sem ampliar a seleção a outros módulos.
- Firestore Rules: **41/41** no emulador, incluindo a edição de Outros recebida do main.
- Worker: **12/12**, com respostas de serviços simuladas.
- Functions: **19/19** nos emuladores Auth/Firestore/Functions, Node 22 e Java 21, com descoberta de 60 s. Uma tentativa sem emuladores foi descartada; nas primeiras inicializações a porta 8080 ainda era ocupada pelo processo do teste de Rules. O processo de teste foi identificado e encerrado, e a execução final dos três emuladores passou. Isso não implantou Functions.
- Build e verificador do manifesto: passaram; `git diff --check` sem erros.
- A composição final preserva todo o main v155 e as mudanças visuais do PR #2: 13 arquivos no grafo offline, 23 no precache integral/2.346.517 bytes. A validação também cobriu dependências ligadas por junction, que fazem o Vite emitir um caminho relativo para o SDK App Check.
- Layout final consolidado: 70 combinações de cinco páginas, dois perfis e sete viewports (320×568, 375×667, 390×844, 844×390, 568×320, 667×375 e 768×1024). Escala, Eventos, Etiquetas e Checklist sem rolagem da página nem controles cortados nos 56 cenários desses módulos. Nos 28 de Escala/Eventos, célula, índice e férias são o mesmo botão nativo: mínimo de 32 px de altura/38,08 px de largura, sem sobreposição, inclusive DC com três aliases. Foram conferidos 1.470 pontos de toque e 126 ações de toque/Enter/SUPORTE. A regressão do candidato visual intermediário, que havia reduzido o alvo a 11,11 px, foi corrigida antes da entrega. Gestão tem cabeçalho uniforme; seu conteúdo administrativo mantém a rolagem existente. Arsenal inteiro, com proporção 3:2, inclusive em 844×390.

Para reproduzir o layout, execute `node scripts/validate-mobile-layout.mjs` com Playwright disponível. `PLAYWRIGHT_MODULE_PATH` aponta para um `package.json` a partir do qual o módulo pode ser resolvido; `CHROME_EXECUTABLE_PATH` indica o Chromium/Edge instalado e `MOBILE_LAYOUT_OUTPUT` escolhe a pasta de capturas. A fixture usa os renderers e CSS reais com perfis fictícios, sem inicializar Firebase nem acessar serviços externos.

Além do shell, **42/42 cenários dos modais** passaram: relatório diário, confirmação e QR nos dois perfis/sete visores. Os 28 arsenais, cinco inativos e seis funções permaneceram visíveis, sem cortes ou sobreposição. Voltar fechou o relatório pelos controles nativos em todos os 14 casos. O vídeo e a área de captura QR ficaram alinhados; foco da confirmação e do QR foi conferido. Mínimos medidos: Arsenal 32 px, confirmação 34 px e Voltar 32 px. Esses alvos compactos ainda precisam de avaliação de uso com os dedos em aparelhos físicos.

| Relatório diário em paisagem | Alvo Arsenal no main v155 | PR consolidado |
| --- | ---: | ---: |
| 568×320 | 9,5 px | 32 px |
| 667×375 | 21,875 px | 43,875 px |
| 844×390 | 25,25 px | 47,25 px |

O ajuste usa `:has(#checklist-day-control:not([hidden]))` apenas no relatório diário em paisagem até 400 px de altura; o estilo mensal existente permanece. CSS nativo v155, incluindo a distribuição mais recente da imagem e ações em f5c9f02, foi conservado integralmente em src/styles.css. Os ajustes de títulos, toque e relatório desta revisão estão em src/mobile-layout.css, importado logo depois. O build reúne os dois no mesmo CSS final. A imagem usa contain: conteúdo 3:2 inteiro, enquanto a caixa pode ter outra proporção; no menor visor horizontal o conteúdo mede 74,39×49,59 px.

Não foi possível testar Android/iPhone físicos, Safari/WebKit, instalação nativa, câmera/QR físicos, login real, escrita autenticada fictícia ou assinatura validada por um consumidor de produção. Nenhum dado real de paciente foi usado. As capturas de layout usam dados fictícios e validam a composição do shell, não a autorização de cada operação.

## Integrações verificadas separadamente

Auditoria somente de leitura em 30/09: Worker `/health` HTTP 200, tráfego de 100% na versão `2f609917-ffa3-46ab-aea3-fc573541ffac`; presença do Secret confirmada sem ler seu valor. As variáveis atuais já têm IA habilitada, endpoint correto e site key presente. A Firebase CLI confirmou enforcement e proteção contra replay do App Check Firestore desligados, sem alteração anterior registrada; nenhuma configuração foi alterada. Os nove arquivos Apps Script remotos coincidem com o pacote local após normalização; deployments HEAD e versões 1/2 existem. Metadados de execução retornaram 403, portanto gatilhos, propriedades de runtime, IAM efetivo e execução dos validadores não foram confirmados. O relato do proprietário de leitura IA no iPhone em 29/09 é uma evidência histórica, não um novo teste desta revisão. Consulte [RELEASE_STATUS.md](RELEASE_STATUS.md).

Em 01/10 o `/health` foi relido: `ok=true`, projeto `sahmt-17a16`, modelo `gpt-6-luna`. As variáveis públicas do workflow foram relidas para o build, sem alteração. A consulta somente de leitura `firebase functions:list --project sahmt-17a16 --non-interactive` falhou; portanto a presença/disponibilidade das Functions de produção não foi confirmada. Nenhuma Function foi invocada ou implantada por essa consulta. Functions, Worker, Apps Script, Rules e índices são idênticos ao main v155; os testes usam emuladores ou serviços simulados.

**Dependência recebida da v154 e preservada:** o nome do responsável no rodapé é pré-requisito do botão. Para não administradores, o leitor usa a callable `checklistSignature`, que exige e-mail verificado, permissão de assinatura, dia atual e perfil V2 único do responsável. Se esse serviço estiver indisponível ou o perfil não puder ser resolvido, o rodapé permanece bloqueado. A alternativa administrativa lê escala/férias/contatos/eventos com a autorização existente. A homologação desse novo rodapé em produção continua necessária; esta revisão não ativa Functions ou consumidores de validação para resolver essa dependência.

## Implantação após revisão

1. Revisar o PR consolidado, principalmente a troca entre menos leituras e uma etapa adicional de rede no relatório parcial/vazio.
2. Após aprovação, conferir alterações posteriores em `main` e repetir CI/build do resultado integrado antes da implantação.
3. Integrar o PR aprovado. O push em `main` executa automaticamente **Build and deploy SAHMT V2** para Pages; execução manual só se necessária. O workflow de PR testa e constrói, com deploy ignorado.
4. Em uma conta e dados fictícios, verificar abertura online/offline, A→B, revogação, concessão durante leitura, assinatura, Eventos/Etiquetas preservados, imagem corrigida e atualização com aba antiga em Android e iPhone. Confirmar que o SW é V156 e que a fila pendente foi preservada.
5. Monitorar erros e leituras, sem ativar gatilhos, IA adicional, Functions, faturamento ou integrações como consequência deste release.

Em caso de regressão, preparar um commit de reversão com nova versão de SW; preservar IndexedDB e ações pendentes. Não orientar limpeza dos dados do aparelho como procedimento de atualização.
