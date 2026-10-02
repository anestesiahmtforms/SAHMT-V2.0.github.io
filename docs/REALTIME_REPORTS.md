# Relatórios em tempo real — SAHMT V2

Base inicial verificada: `59eb7488deb73b292d53c36fa25af81820edd693`, obtida de `origin/main` antes das alterações. O trabalho usa checkout isolado; as três alterações do checkout original em `docs/LABEL_AI_WORKER.md`, `src/firebase-app.js` e `src/styles.css` foram preservadas. Para reversão, revisar um `git revert` do commit desta entrega sobre a main atual, evitando reset da branch ou restauração indiscriminada de outros trabalhos. As Rules anteriores foram conferidas pela API antes da implantação; qualquer reversão de Rules exige a mesma validação e publicação separada.

## Escopo e arquitetura

Os relatórios diário e mensal de Eventos, Etiquetas e Checklist usam `onSnapshot` do Firestore. A apresentação, as regras de preenchimento, os cálculos de Eventos, os identificadores estáveis e o fluxo de escrita existente permanecem nos módulos atuais.

A implementação é dividida por responsabilidade:

- `src/live-report-session.js`: geração da consulta, metadados, estado de conexão e descarte de callbacks antigos.
- `src/report-runtime.js`: propriedade dos listeners por módulo/sessão e reconciliação com uma leitura compartilhada da fila pendente do usuário.
- `src/report-live-data.js`: consultas autorizadas de Eventos e catálogo de arsenais.
- `src/label-report-reader.js`: união autorizada das consultas de Etiquetas, com deduplicação por ID.
- `src/checklist-report-listener.js`: registros do período e última resposta anterior de cada arsenal.
- `src/checklist-responsibility-listener.js`: fontes de responsabilidade do Checklist diário, exclusivamente para administradores autorizados.
- `src/report-dom.js`: atualização dos cartões existentes, preservando seus nós e o contexto de leitura.
- `src/main.js`: período selecionado, diálogos, exportação, ações e controle de assinatura.

Cada consulta pertence a um UID, módulo, período, conjunto de permissões e limite carregado. A tela também confere a rota, o diálogo aberto e a identidade do container. Retornos de consultas antigas deixam de ter autoridade após troca de data, mês, módulo, sessão ou permissões.

### Ciclo de vida

Ao abrir um relatório, o runtime reutiliza o listener compatível ou encerra o anterior antes de iniciar a nova consulta. Fechar o relatório, sair do módulo, trocar a sessão ou perder o acesso encerra a observação e invalida seus callbacks. A resolução tardia de um import assíncrono também encerra imediatamente o listener que já perdeu sua propriedade.

Quando o app fica oculto, os listeners dos relatórios abertos são suspensos. Ao retornar, somente o período ainda aberto e autorizado é observado novamente. O retorno à conexão exige nova conferência; o conteúdo anterior não é considerado confirmação atual do servidor.

Uma repetição idêntica do perfil ou da configuração de módulos evita reconstruir a tela. A reconciliação do relatório altera cartões, campos exibidos e totais sem recriar a página, o formulário de lançamento ou a foto capturada. Mantém foco, seleção, rolagem, âncora de leitura, histórico aberto e justificativa de confirmação. O cache de markup usa `WeakMap` vinculado aos nós vivos, permitindo liberar seus dados quando os nós deixam de ser utilizados; não é armazenamento persistente.

## Autorização, cache e estados

Eventos mantém os filtros existentes: administrador vê o período autorizado; usuário comum vê os registros de sua autoria ou relacionados à sua sigla. Etiquetas mantém as consultas por autoria e participação nas siglas de plantonistas, ou o acesso administrativo previsto por `labelsManage`. Os resultados são deduplicados sem manter um registro que saiu de todas as consultas autorizadas.

As Rules de Etiquetas recebem a correção necessária para que a consulta de participação pela lista `staffSiglas` possa ser autorizada pelo Firestore, além da consulta por autoria. O acesso continua limitado ao mesmo usuário participante ou administrador autorizado; o padrão de `createdByUid` não cria acesso anônimo e a validação do tipo da lista permanece no contrato de gravação. A verificação de histórico reutiliza as capturas `get`/`getAfter` dentro de cada avaliação para evitar exceder o limite de expressões, mantendo as conferências de autor, revisão e campos alterados. Esse ajuste exige implantação das Rules para que o cliente publicado consiga executar a consulta de participação.

O SDK completo usa o cache em memória configurado em `src/firebase.js`. Etiquetas não recebe cache persistente adicional de dados de pacientes. O Checklist reutiliza somente o cache operacional seguro já existente, separado por UID e período, e mantém a fila offline e seus IDs. Respostas antigas salvas podem ser apresentadas enquanto o servidor é consultado; não autorizam assinatura por si só.

O indicador pertence ao relatório aberto e deriva dos metadados `fromCache`, `hasPendingWrites`, da reconciliação local e da integridade das fontes:

| Estado apresentado | Condição |
| --- | --- |
| Atualizando | Ainda faltam fontes ou confirmação atual do servidor. |
| Confirmado pelo servidor | Fontes necessárias confirmadas, sem alterações pendentes e sem incompletude detectada. |
| Alterações pendentes de envio | Há gravações locais/SDK ainda não aceitas ou rascunhos com falha/conflito. |
| Sem conexão | O navegador informa ausência de conexão; não equivale a confirmação atual. |
| Falha de atualização | A consulta falhou; há ação para tentar novamente. |
| Relatório incompleto · carregar mais | O limite atingido ou uma fonte incompleta impede apresentar a consulta como completa. |

Registros pendentes, recusados, em conflito ou ainda marcados como gravação local ficam fora dos arquivos exportados. Uma contribuição aceita pelo servidor substitui a contribuição local pelo ID estável, sem duplicação. Histórico e edição são oferecidos apenas no relatório diário e para os registros/perfis autorizados. Consultas antigas de histórico não substituem o histórico de outra revisão ou sessão.

## Paginação

Eventos inicia com limite de 100 registros. Etiquetas inicia com limite de 50 por consulta autorizada; a união de autoria e participação pode apresentar mais registros, sempre deduplicados. Cada consulta pede um documento adicional como sentinela para detectar se há mais dados.

`Carregar mais` amplia o prefixo observado, em vez de manter páginas independentes que poderiam criar lacunas após exclusões ou mudanças de filtro. A ampliação substitui o listener do período por outro com o novo limite. Inclusões, alterações, exclusões e entradas/saídas do filtro reconciliam a lista inteira carregada, e não apenas uma concatenação de registros novos.

O Checklist diário mantém o limite de segurança de 1.000 registros e bloqueia confirmação quando a consulta está truncada. O mensal inicia com 2.000 e permite ampliar o prefixo em etapas. O resumo parcial permanece identificado até carregar os registros restantes.

Quando há mais registros, Eventos e Etiquetas avisam que totais e PDF abrangem somente os registros carregados. O cabeçalho do PDF recebe `PARCIAL`. O mensal mantém o compartilhamento PDF/WhatsApp existente e não oferece edição ou histórico de alterações.

## Checklist: herança, responsabilidade e quantidade de listeners

Para um catálogo com 28 arsenais aplicáveis, a primeira observação do relatório usa:

| Fonte | Listeners |
| --- | ---: |
| Catálogo de arsenais, incluindo inativos | 1 |
| Registros do dia ou mês selecionado | 1 |
| Última resposta anterior ao período, uma consulta `limit(1)` por arsenal | 28 |
| Total do relatório | 30 |
| Fontes de responsabilidade do diário para administrador com `checklistSign`: escala, férias, contatos e Eventos | +4 |

O total de 30 depende dos IDs aplicáveis ao período: a implementação não fixa a quantidade em 28. O conjunto de histórico acompanha o catálogo; a troca de IDs reinicia as consultas históricas necessárias. Uma mudança em um registro do dia não dispara novamente 28 consultas `getDocs` de histórico. Os listeners históricos já abertos acompanham as alterações relevantes.

As respostas herdadas, a ordenação dos arsenais, os inativos, a manutenção e o responsável do registro continuam usando os resolvedores existentes. A responsabilidade de assinatura mantém a primeira posição da escala e as regras de substituições, férias e eventos. Para usuário comum, permanece o preview autorizado já existente no backend; não se consulta o catálogo inteiro de contatos ou todos os Eventos como se ele fosse administrador.

A confirmação exige período atual, permissão de assinatura, conexão, fontes completas, dados confirmados e ausência de pendências. Mudanças nos dados ou na responsabilidade invalidam a revisão preparada e desabilitam seu envio, preservando a justificativa digitada. A validação do backend continua sendo a autoridade final; um estado visual confirmado não concede assinatura ou pontuação.

## Pré-carregamento e custo de leitura

O banner inicial continua com duração de 4 segundos. O pré-carregamento abre listeners somente para os relatórios do dia e os módulos autorizados. Um relatório aberto enquanto seu pré-carregamento ainda pertence à sessão assume o mesmo controller, sem criar outro listener ou repetir uma consulta de abertura. Pré-carregamentos que não foram assumidos são encerrados após a janela de 30 segundos; encerrar o app ou a sessão também os libera.

O pré-carregamento autorizado de vários módulos tem custo real. O número de listeners não é o número de leituras faturadas: uma consulta pode devolver muitos documentos, e a união de Etiquetas pode ler o mesmo documento por duas consultas antes da deduplicação local. A abertura inicial, a ampliação de paginação, mudanças nos documentos e determinadas reconexões podem gerar leituras adicionais. Consultas vazias também têm regras de cobrança. Não há promessa de custo zero.

A mudança remove consultas de histórico repetidas a cada atualização do Checklist, mas passa a manter observações vivas durante o período em que o relatório está aberto. Avaliar faturamento com métricas do projeto após a implantação. Referências oficiais: [listeners do Firestore](https://firebase.google.com/docs/firestore/query-data/listen) e [preços e cobrança de listeners](https://firebase.google.com/docs/firestore/pricing).

## Validação e medidas

Foi executado um fixture com funções reais do `src/main.js`, o runtime e a reconciliação de DOM em Microsoft Edge, viewport de 430 × 932. As contas, fontes e registros do fixture são fictícios. A execução verifica preservação de rascunho/foco/foto/rolagem, atualização de cartões, callback antigo de outro dia ou UID, histórico de revisão antiga, exportação parcial sem pendências, bloqueio de confirmação obsoleta e transferência do pré-carregamento. O fixture teve 9/9 cenários aprovados, sem erros de página. A publicação e seu workflow são conferidos separadamente.

Medição comparativa do relatório diário de Eventos, com 100 registros fictícios e 25 alterações em um cartão:

| Medida | Base `59eb748` | Implementação atual |
| --- | ---: | ---: |
| Primeira renderização com layout | 136,6 ms | 146,1 ms |
| Atualização, mediana | 60,6 ms | 27,7 ms |
| Atualização, p95 | 94,6 ms | 40,2 ms |
| Cartões anteriores preservados | 0/100 | 100/100 |
| Registros de mutação do DOM por atualização, mediana | 101 | 1 |

Os dois lados incluem leitura de `scrollHeight` para concluir o layout antes de encerrar a medição. Sem essa etapa, a substituição por `innerHTML` adia parte do trabalho e a comparação fica desigual. A mediana de atualização caiu aproximadamente 54%; a primeira renderização teve acréscimo de 9,5 ms neste ensaio. Uma mudança exclusivamente de metadados de confirmação não reescreve o conteúdo do relatório.

Os valores medem renderização local no Edge, sem latência real do Firebase, rede móvel, CPU de telefone ou dispositivo físico. Não são uma medição de propagação entre dois aparelhos de produção. Android físico, iPhone/Safari físico, suspensão pelo sistema operacional e compartilhamento nativo nesses aparelhos precisam ser homologados separadamente com contas e dados fictícios. Nenhum paciente real foi usado no fixture.

As evidências locais estão em `.local-preview/report-main-browser/results.json`, `measurements.json` e `fixture.png`. Esses arquivos de diagnóstico não fazem parte dos assets publicados do PWA. Foram aprovados 444 testes de domínio, 57 de Rules (50 existentes e 7 cenários de SDK real), 12 do Worker e 19 de Functions em emuladores. Os testes de Functions foram serializados porque os arquivos de teste compartilham e limpam a mesma coleção de fixtures. O runner de Rules usa `--test-force-exit` após testes, hooks e asserções de encerramento para liberar o transporte residual do SDK após o cenário offline; isso não muda o ciclo de vida de produção.

### Service worker real e limites de atualização

O build final foi servido localmente ao Edge com service worker real: 14/14 arquivos dos grafos essenciais ficaram disponíveis offline; PDF e seus três módulos auxiliares ficaram fora do cache inicial. O fixture passou 8 verificações, incluindo abertura do shell offline, preservação de rascunho/foco/fila fictícia no IndexedDB/imagens durante a atualização e entrega do bundle atual em nova navegação. Não houve recarga automática do rascunho.

A asserção de remoção do cache antigo ficou inconclusiva: uma requisição do controller anterior pode recriar esse cache, portanto sua existência isolada não identifica a versão ativa. Foi observado 404 ao pedir um import da versão antiga que nunca tinha sido carregado depois que o servidor passou a servir somente o novo build. Esse risco entre hashes de versões já existia na estratégia atual; a integração de relatórios não o resolve. Uma aba antiga pode precisar ser fechada e reaberta após a atualização, mantendo a fila offline. Não apagar dados do app para atualizar.

Na abertura offline anônima do fixture, o import do SDK opcional App Check não estava em cache e falhou; isso não é validação de login, leitura por IA ou fluxo autenticado offline. As configurações de App Check/IA foram mantidas. Evidência local: `.local-preview/sw-real/results.json`.

### Duas sessões fictícias e implantação Firebase

Os 7 cenários com SDK completo e Rules reais passaram em `demo-sahmt-v2`, sem dados de produção. Os testes cobrem autoria e participação, edição com histórico, acesso negado, exclusão administrativa de fixture, entradas/saídas de filtros, paginação, herança do Checklist, responsabilidade e envio offline. No ensaio local, inclusão/edição em Eventos propagaram entre sessões em 193,49/190,06 ms; em Etiquetas, 169,58/92,05 ms. A gravação de Etiquetas pendente ficou fora da sessão remota até reconectar, com confirmação em 102,43 ms. São medidas pontuais do emulador neste computador, sem comparação de latência de produção.

Com 28 arsenais, a recarga anterior executava 29 consultas; uma nova resposta no listener estabelecido criou 0 novas subscriptions, repetiu 0 consultas históricas e produziu 1 callback do período. As 29 subscriptions de registros/históricos permanecem, além do catálogo e, quando aplicável, responsabilidade.

Os 11 índices compostos existentes de Eventos, Etiquetas, Checklist e Férias foram consultados pela API administrativa e estavam `READY`; nenhum índice novo foi implantado. Somente `firestore:rules` foi publicado em `sahmt-17a16` em 02/10/2026. A release `cloud.firestore` aponta para o ruleset `9c957946-b7ab-4c15-80cc-4bef227f798b`, e o conteúdo obtido pela API corresponde ao arquivo local (SHA-256 normalizado `697786c5131d4db2e6726fadd7e17ca0fe359da0a726e5c502d0b14d3332c420`). Nenhuma Function, Hosting, IA, integração ou gatilho foi implantado.

## Implantação e conferência

1. Confirmar a versão atual de `main`, preservar alterações locais e integrar somente os arquivos deste fluxo.
2. Executar as suítes de domínio, Rules e os testes pertinentes de Worker/Functions, além do build, com Node 22 e Java 21 para os emuladores.
3. As consultas usam os índices existentes. Após validar a correção de autorização da consulta de participação em Etiquetas e as avaliações de histórico, publicar somente `firestore:rules` no projeto `sahmt-17a16`; registrar o resultado real da implantação. Não publicar Functions, Hosting, IA, Apps Script ou gatilhos neste fluxo.
4. Enviar a alteração autorizada para `main` e acompanhar o workflow **Build and deploy SAHMT V2** até a conclusão. O workflow publica o PWA no GitHub Pages e preserva as variáveis existentes de IA/App Check.
5. Conferir os assets efetivamente servidos, o manifesto do build e o service worker da versão publicada. Um commit no GitHub, isoladamente, não confirma publicação no Pages ou implantação de Rules.
6. Homologar duas sessões autorizadas, com dados fictícios: abrir o mesmo período, incluir/editar/excluir registros, alterar filtros, carregar mais, interromper e retomar a conexão, suspender/retomar o app, fechar o relatório e trocar o usuário. Conferir que usuários comuns não recebem os dados de outros membros e que rascunhos e arquivos exportados respeitam os estados apresentados.

Registrar no encerramento o commit, o workflow, os componentes Firebase realmente publicados, as suítes executadas e as limitações ainda não testadas. O relatório acima descreve a implementação e a evidência local; não substitui a conferência final da publicação.
