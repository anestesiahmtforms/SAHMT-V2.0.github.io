# Revisão de confiabilidade e desempenho — 30/09/2026

## Fonte e entrega

Base desta conciliação confirmada por Git e pela API GitHub: `main` v133 em `65944c5eda6b109eeb8e11519a067965b5ec811b`, com os 27 commits posteriores à base anterior `282272adc22b328d853d46630687cc06897d2cb3` preservados. O ZIP de Downloads contém 146 arquivos iguais ao commit histórico `1a2fb621c921ebeb3b8f0c776c2256c0f4f2c634`, sem diferenças de conteúdo; ele permanece apenas como referência histórica.

O trabalho foi feito em checkout isolado. A cópia original permanece em `c7797f3`, com suas três modificações em `docs/LABEL_AI_WORKER.md`, `src/firebase-app.js` e `src/styles.css` preservadas.

PRs para revisão: [confiabilidade e desempenho #1](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/pull/1) e [títulos e Arsenal #2](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/pull/2). Não houve merge nem publicação de produção desta revisão.

## Correções, na ordem solicitada

### Conciliação com as atualizações da v133

Foram mantidos o banner inicial intencional de quatro segundos e seus três textos, os relatórios/cartões novos, edição somente diária, confirmação do registro manual, mudanças de Gestão, estilos dos modais e atraso a R$200 por múltiplo. Os testes novos da v133 continuam no comando de domínio; fixtures de Windows normalizam CRLF.

A revisão corrigiu a primeira transição `loading-profile` → `signed-in` com o mesmo UID, que antes não iniciava as pré-consultas. As respostas iniciais têm chave de escopo efetivo, e os relatórios de Eventos/Etiquetas conferem sessão, permissão, período, diálogo, rota e identidade do alvo antes e depois de imports/leituras. Alteração apenas do nome não invalida o preenchimento. Gravações diretas limpam o cache inicial antes da escrita autorizada, evitando mostrar um relatório anterior ao registro como sincronizado. A edição de um valor histórico preserva o valor gravado; somente mudar tipo/múltiplo/turno recalcula pela regra atual, sem migração de registros existentes.

O cache candidato avança de V133 para V134. A atualização local com aba antiga e a fila pendente foi validada usando os builds reais dessas versões; nenhuma publicação de produção foi feita.

1. **Checklist:** cada consulta captura geração, data, rota, UID, período e abertura do relatório. Resultados e erros antigos não substituem o relatório atual. Preparação e transação de assinatura repetem a validação, inclusive após a leitura da transação. O banner da estação também possui geração própria: salvar, fechar ou reutilizar o banner não permite que callbacks antigos fechem outro banner ou reabram outro dia.
2. **Sessão:** snapshots repetidos atualizam a identidade sem reconstruir formulários. Eventos e Etiquetas mantêm preenchimento, foto, foco e diálogo. A entrega de uma revogação precede a escrita opcional em IndexedDB; cache lento ou com falha não adia o bloqueio. Mudança de sigla do usuário comum exige nova consulta do escopo pessoal. Guardas de escrita revalidam sessão/permissão após imports e leituras e antes de persistir ou enfileirar. As Rules continuam sendo a autoridade no servidor.
3. **Offline:** o SW V134 deriva o grafo necessário do manifesto emitido pelo Vite. Auth, projeções Lite, dados operacionais, controlador de câmera e decoder QR ZXing entram no precache. O decoder é necessário em aparelhos sem `BarcodeDetector`, incluindo Safari. Quando emitido pelo build com IA configurada, o pequeno SDK App Check também entra: a inicialização Firestore existente aguarda esse módulo, inclusive no fluxo de perfil/cache local. A sequência de proteção foi preservada. PDF, IA e assinatura ficam fora. Instalação incompleta falha. O shell anterior permanece para imports de abas antigas, e a navegação offline seguinte prefere o shell atual. Reload offline recupera JS/CSS com hash e o decoder essencial; imagens pedidas com `reload` continuam exigindo o servidor, evitando confirmar uma imagem antiga como atualizada. A galeria preparada tem prioridade sobre cópias da mesma URL em shells anteriores.
4. **Consultas:** pedidos idênticos em andamento são compartilhados por UID, período, estações e limite. Depois de ler o intervalo atual, só se busca histórico anterior para estações sem resposta no primeiro dia. A sentinela de truncamento mensal não é usada como resposta retida. Vigência, herança do último NÃO, autorização, assinatura e aviso de histórico incompleto permanecem.
5. **Desempenho móvel:** abertura, primeira interação, troca para Etiquetas e alternativas de galeria foram medidas. Não foi acrescentado pré-carregamento novo além do que já havia na v133; a revisão corrigiu apenas o início e o escopo dessas consultas. As alternativas de lazy loading da galeria reduziram bytes ocultos, mas aumentaram a espera pela primeira imagem; foram descartadas. As imagens originais e a legibilidade foram preservadas.

IDs determinísticos, reconciliação e fila offline existentes foram mantidos. Não houve alteração em Rules, Functions, cálculos de Eventos, Worker, Apps Script ou configuração de serviços.

## Medidas de consultas

Fixture local com 30 estações fictícias, cinco amostras e atraso de 90 ms por consulta. Execute `npm run measure:checklist`. Contagens de documentos são retornos de snapshots, não uma estimativa exata de faturamento Firestore.

| Cenário | Consultas antes → depois | Documentos antes → depois | Mediana antes → depois |
| --- | ---: | ---: | ---: |
| Diário completo, 1.000 registros | 31 → 1 | 1.030 → 1.000 | 94 → 96 ms |
| Diário, cinco estações sem resposta | 31 → 6 | 1.030 → 1.005 | 94 → 192 ms |
| Diário vazio | 31 → 31 | 30 → 30 | 95 → 190 ms |
| Mensal, dia 1 completo, 2.001 registros/sentinela | 31 → 1 | 2.031 → 2.001 | 94 → 95 ms |

**Custo remanescente:** dias parcialmente respondidos ou vazios recebem uma ida adicional à rede, porque o histórico depende da resposta atual. A redução de leituras não representa ganho geral de latência. O teste de resumo mensal compara a herança antes/depois e cobre o limite de registros. Uma estratégia que reduza também essa latência exigiria outra revisão do modelo de consultas/dados.

## Build e experiências no navegador

O build final foi executado com as mesmas variáveis públicas do workflow atual. O grafo estático do shell tem dois arquivos/488.528 bytes; o grafo offline selecionado tem 13 arquivos/1.383.461 bytes. Incluindo HTML, manifestos, ícones, imagens fixas e o decoder QR, o precache integral tem **23 arquivos/2.311.094 bytes**. São tamanhos descompactados dos arquivos, sem contabilizar cabeçalhos; não são bytes transferidos com gzip. O aviso existente do chunk Firestore de 550,77 kB permanece.

Uma fixture local serviu os builds reais anterior e atual em Edge/Chromium, com viewport 390×844, toque móvel, CPU 4×, latência de 150 ms e download de 1,6 Mbps. Cada medição de tempo usa três amostras. O perfil, a escala e a fila são fictícios; requisições externas são abortadas. Os tempos e as amostras estão em [benchmarks/pwa-2026-09-30.json](benchmarks/pwa-2026-09-30.json). Isso mede o shell com perfil local; não mede login Google, latência real do Firestore, câmera ou IA.

Abertura offline, escala em cache, registro manual de Etiquetas e imports posteriores de uma aba antiga passaram com o servidor bloqueado e sem erros de página. A navegação offline seguinte carregou o build novo. O marcador de ação pendente conservou seu ID. Chromium tenta atualizar o SW em segundo plano mesmo fora da emulação offline da página; o servidor local recusou também essas conexões.

Para reproduzir, prepare dois builds com as mesmas variáveis públicas, instale/disponibilize Playwright e Chromium e execute `node scripts/verify-pwa-browser.cjs`, depois `node scripts/verify-pwa-browser.cjs --measure`. `SAHMT_BASELINE_DIST` aponta para o build separado do main; `SAHMT_PLAYWRIGHT_MODULE` e `SAHMT_BROWSER_EXECUTABLE` permitem usar uma instalação existente. O cabeçalho do script descreve as opções. O script não instala dependências nem altera o workflow; os JSONs de cada execução ficam em `.local-preview/`.

Para a imagem na mesma URL, o servidor local trocou dois PNGs sintéticos de 8×8. `fetch(..., {cache: 'reload'})` recebeu a imagem nova e a gravou no cache dedicado. Depois do corte de rede, o corpo corrigido foi conferido diretamente em CacheStorage e a ação pendente em IndexedDB continuou intacta. A precedência do cache preparado sobre um shell antigo é coberta separadamente pelo teste do SW. A fixture não substitui uma conferência visual de imagem corrigida em aparelho.

Na galeria, a versão atual solicita 589.219 bytes mesmo oculta, e a primeira imagem já preparada aparece em mediana de 245 ms após abrir. Todas as imagens lazy evitam esses bytes, mas a primeira imagem leva 16,9 s; lazy com dimensões originais leva 11,5 s. São experiências locais de rede limitada, sem SW; a contagem de bytes soma os arquivos requisitados, não a transferência concluída em cada instante. Nenhuma dessas variantes foi aplicada.

## Novas medidas após conciliar a v133

O pacote combinado passou novamente nos 227 testes de domínio, no build e nos cenários offline, incluindo aba V133 → V134 e preservação do ID da fila. Os resultados anteriores de [pwa-2026-09-30.json](benchmarks/pwa-2026-09-30.json) são históricos contra a base anterior. As novas amostras e os 70 cenários visuais estão em [pwa-v133-2026-09-30.json](benchmarks/pwa-v133-2026-09-30.json).

| Mediana da fixture móvel | Main V133 | PRs combinados |
| --- | ---: | ---: |
| Abertura | 10.079 ms | 10.078 ms |
| Primeira interação | 493 ms | 458 ms |
| Troca para registro manual de Etiquetas | 634 ms | 637 ms |

São três amostras por build em 390×844, CPU 4× e 150 ms/1,6 Mbps. Não há ganho geral de velocidade demonstrado: abertura e troca de módulo ficaram equivalentes, e a diferença de primeira interação não basta para separar ganho de variação da fixture. O banner intencional de quatro segundos foi mantido. O perfil local é marcado offline para bloquear serviços externos; isso não mede o login real nem as pré-consultas autenticadas corrigidas. Emuladores foram encerrados antes dessa medição.

## Testes e limites

- Domínio: **227/227**, com regressões de A→B chegando fora de ordem, sessão/cache lentos, revogação, preservação do shell, banners, assinatura, consultas/herança e SW. O SDK App Check também foi coberto com chave relativa ou gerada no manifesto, sem ampliar a seleção a outros módulos.
- Firestore Rules: **40/40** no emulador.
- Worker: **12/12**, com respostas de serviços simuladas.
- Functions: **19/19** nos emuladores Auth/Firestore/Functions, Node 22 e Java 21. O primeiro teste local em Node 24 excedeu o tempo de descoberta; o teste final usou Node 22, correspondente ao CI, com descoberta de 60 s. Isso não implantou Functions.
- Build e verificador do manifesto: passaram; `git diff --check` sem erros.
- A combinação local dos PRs #1 e #2 não apresentou conflitos textuais e passou no build/verificador: 13 arquivos no grafo offline, 23 no precache integral/2.319.446 bytes. A validação conjunta também cobriu dependências ligadas por junction, que fazem o Vite emitir um caminho relativo para o SDK App Check.
- PR visual: 70 combinações de cinco páginas, dois perfis e sete viewports (320×568, 375×667, 390×844, 844×390, 568×320, 667×375 e 768×1024). Escala, Eventos, Etiquetas e Checklist sem rolagem da página nem controles cortados nos 56 cenários desses módulos. Gestão tem cabeçalho uniforme; seu conteúdo administrativo mantém a rolagem existente. Arsenal inteiro, com proporção 3:2, inclusive em 844×390.

Não foi possível testar Android/iPhone físicos, Safari/WebKit, instalação nativa, câmera/QR físicos, login real, escrita autenticada fictícia ou assinatura validada por um consumidor de produção. Nenhum dado real de paciente foi usado. As capturas de layout usam dados fictícios e validam a composição do shell, não a autorização de cada operação.

## Integrações verificadas separadamente

Auditoria somente de leitura em 30/09: Worker `/health` HTTP 200, tráfego de 100% na versão `2f609917-ffa3-46ab-aea3-fc573541ffac`; presença do Secret confirmada sem ler seu valor. As variáveis atuais já têm IA habilitada, endpoint correto e site key presente. A Firebase CLI confirmou enforcement e proteção contra replay do App Check Firestore desligados, sem alteração anterior registrada; nenhuma configuração foi alterada. Os nove arquivos Apps Script remotos coincidem com o pacote local após normalização; deployments HEAD e versões 1/2 existem. Metadados de execução retornaram 403, portanto gatilhos, propriedades de runtime, IAM efetivo e execução dos validadores não foram confirmados. O relato do proprietário de leitura IA no iPhone em 29/09 é uma evidência histórica, não um novo teste desta revisão. Consulte [RELEASE_STATUS.md](RELEASE_STATUS.md).

## Implantação após revisão

1. Revisar os dois PRs, principalmente a troca entre menos leituras e uma etapa adicional de rede no relatório parcial/vazio.
2. Aprovar e integrar os PRs, resolvendo eventuais alterações posteriores em `main`; repetir CI/build do resultado integrado.
3. Executar o workflow **Build and deploy SAHMT V2** para Pages. O workflow de PR testa e constrói, com deploy ignorado.
4. Em uma conta e dados fictícios, verificar abertura online/offline, A→B, revogação, assinatura, Eventos/Etiquetas preservados, imagem corrigida e atualização com aba antiga em Android e iPhone. Confirmar que o SW é V134 e que a fila pendente foi preservada.
5. Monitorar erros e leituras, sem ativar gatilhos, IA adicional, Functions, faturamento ou integrações como consequência deste release.

Em caso de regressão, preparar um commit de reversão com nova versão de SW; preservar IndexedDB e ações pendentes. Não orientar limpeza dos dados do aparelho como procedimento de atualização.
