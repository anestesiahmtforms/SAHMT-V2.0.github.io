# Inventário da V1

## Fontes analisadas

- Pacote `SAHMT.github.io-main.zip` recebido em `C:\Users\SAHMTIA\Desktop\ATUALIZAÇÕES MAIS RECENTES PWA` (96 entradas ZIP, 80 arquivos e 16 diretórios; raiz web `SAHMT.github.io-main/`). SHA-256: `0E679A6DE9520B5E3C6A872E9621A793241E2D58FB6E13B93B898A7ED7EC715E`.
- `Code.gs` (140.643 bytes; 156 funções de nível superior), `appsscript.json` e `validacao.json`, no mesmo diretório de entrega. SHA-256 do `Code.gs`: `288D2E6A9B33225E7211189EDB5B8F0E0B026D0E64AE494FF3540FA65AD9CA46`.
- Auditoria do índice executada em 25/09/2026 contra `Code.gs` original: 156 declarações e 156 entradas correspondentes; zero omissões e zero nomes extras. O índice comprova cobertura nominal, não execução ou paridade semântica.
- Reabertura e rehash do ZIP na auditoria de 25/09/2026 confirmaram os metadados acima: 96 entradas (80 arquivos, 16 diretórios), uma raiz `SAHMT.github.io-main/` e o mesmo SHA-256. `validacao.json` mantém o estado `NOT_DEPLOYED_AWAITING_GOOGLE_LOGIN`; nenhum código V1 foi alterado.
- Planilha nativa `SAHMT_DATABASE`: em 24/09/2026 foram conferidos metadados e cabeçalho da primeira linha das 15 abas, sem ler registros. IDs, títulos e campos estão em [`V1_CURRENT_SHEET_HEADERS.md`](V1_CURRENT_SHEET_HEADERS.md); a leitura não confirma valores, vigência ou volume das linhas.
- Checkout de referência `C:\Users\SAHMTIA\Documents\ChatGPT\SAHMT-BH`, observado apenas para localizar complementos; contém alterações locais não publicadas e foi preservado sem edição.

## Snapshot dinâmico somente leitura (25/09/2026)

Fonte `SAHMT_DATABASE` (ID e abas em `V1_CURRENT_SHEET_HEADERS.md`); metadados relidos antes dos intervalos. A amostra usou apenas colunas necessárias para contagens, sem abrir colunas de autorização nem registrar identificadores pessoais:

- `USUARIOS!J2:N1000`: 60 linhas com cadastro; 60 e-mails preenchidos e distintos; 31 siglas preenchidas e distintas; 59 registros ativos e 1 inativo; telefone preenchido em 31 linhas. Os valores de e-mail, nome, telefone e sigla não foram copiados para este inventário.
- `ESCALA!J2:AB1000`: 307 datas válidas de 01/01/2026 a 31/12/2026; 17 posições possíveis, com 14 preenchidas em 52 dias, 16 em 104 dias e 17 em 151 dias; 255 dias contêm `DC`. As marcações JSON foram normalizadas em 209 destaques de sigla e 20 de evento; 14 chaves false não viram destaques ativos.
- `FERIAS!J2:M1000`: 52 períodos válidos de 05/01/2026 a 03/01/2027; 51 têm lista JSON explícita de siglas e 1 depende do rótulo como fallback. A coluna de notas não foi lida.
- `ATIVIDADES!X2:X1000`: nenhum estado preenchido no campo `status`.
- `REGRAS_PONTUACAO!N2:N1000`: quatro linhas, todas `ACTIVE`.
- Recontagem de `id` não vazio em `A2:A1000` nas 15 abas: `USUARIOS` 60, `ATIVIDADES` 0, `INTERACOES` 0, `PONTUACOES` 0, `REGRAS_PONTUACAO` 4, `ESCALA` 307, `FERIAS` 52, `ETIQUETAS` 1, `EVENTOS` 0, `TREINAMENTOS` 4, `PARTICIPACOES` 9, `CHECKLIST_UNIDADES` 28, `CHECKLIST_REGISTROS` 31, `CHECKLIST_ASSINATURAS` 1 e `AUDITORIA` 33. Os IDs preenchidos eram distintos por aba. É uma contagem de IDs na primeira coluna, não de linhas ativas nem de alterações válidas.
- Agregações adicionais sem campos pessoais: `ETIQUETAS!O2:P1000` tem 1 registro (`Convênio`, credor `Plantão`); `PARTICIPACOES!K2:K1000` tem 9 itens `checklist`, e `P2:P1000` tem 7 `Concluido` e 2 `Pendente`; `CHECKLIST_REGISTROS!J2:K1000` tem 31 datas e 31 referências de estação, enquanto `M2:M1000` tem 25 `SIM` e 6 `NAO`.
- Rechecagem dinâmica delimitada em 25/09/2026 confirmou os mesmos agregados: `ATIVIDADES!X2:X1000` sem estados, quatro regras de pontuação `ACTIVE`, nove participações `checklist` (sete `Concluido`, duas `Pendente`), 25 `SIM`/seis `NAO` no Checklist e a única etiqueta com tipo/credor `Convênio / Plantão`. Foram consultados somente os intervalos não pessoais citados; não foram lidos valores de paciente, usuário, ocorrência ou assinatura.

Este é um retrato agregado da fonte, não reconciliação de migração. O preview local gitignored contém candidatos para 28 estações, 4 treinamentos, 307 dias de escala e 52 períodos de férias. Em Eventos, a coluna de IDs não tem registros; Etiquetas, Participações, Checklist e Auditoria foram consultados somente nas colunas citadas acima. Nenhum nome/e-mail, ocorrência, conteúdo de assinatura, paciente ou outro valor de registro foi copiado para o inventário. Ordem, notas/cancelamentos de férias, autoria, mapeamento UID e aprovação de destino continuam pendentes antes de qualquer importação.

O ZIP contém o frontend PWA, não o backend Apps Script. O backend e seu manifesto foram entregues separadamente. O manifesto concede acesso anônimo ao Web App e solicita escopos de Sheets, Forms, Drive metadata e requisições externas. `validacao.json` registra `NOT_DEPLOYED_AWAITING_GOOGLE_LOGIN`; portanto, é evidência de empacotamento local, não de implantação ou validação operacional.

## Identidade e inicialização

- Idioma `pt-BR`, nome `SAHMT`, tema azul-marinho `#0d3257`, slogan “Gestão Responsável!” e ícone SAHMT.
- O shell apresenta tela de inicialização e aplica modo PWA. O manifesto e o service worker ficam na raiz.
- O cliente web configura Firebase Auth no projeto `sahmt-17a16`, app `sahmt`; a presença do config não prova que Firebase Auth/Firestore estejam autorizados, que regras estejam publicadas ou que dados estejam migrados.
- O roteador usa hash routes e entrega as páginas no mesmo documento, com escopos isolados para cada view.

## Telas e capacidades encontradas

| Tela/área | Evidência no pacote | Capacidades a preservar e confirmar |
|---|---|---|
| Home / Escala | `core/views/home.js`, `home.json`, CSS raiz e imagens de escala | Seletor de data, anterior/hoje/próximo, gesto de navegação, siglas clicáveis, seleção/realce compartilhado, detalhes/contatos, férias ordenadas, liberação de contato, Checklist e Treinamentos, avisos com mídia e instalação PWA. A grade acrescenta o botão “OFF LINE”, que abre a galeria estática Escala/Férias 2026. Escala e férias são apresentadas por dia e sigla; a origem definitiva das posições e regras de plantão ainda requer conferência. |
| Avisos / Notificações | `core/views/home.json`, `home.js` e payload global `SAHMT_NOTICES` | A Home contém o modal de aviso com título, mensagem, imagem/vídeo e apresentação em slides. No pacote recebido, o aviso de abertura está explicitamente desativado em `home.js`; o botão “Notificações” também aparece desabilitado com “Em breve”. Não há view independente de notificações no inventário de views do ZIP. |
| Pessoas / Administração | `core/views/home.json`, `home.js`, `Code.gs` (`user_`, `authorizeFirebase_`, `publicUser_`) | A Home tem modal de contato acionado por sigla e lê payload de contatos; o backend tem autenticação Firebase legada, associação por e-mail à aba `USUARIOS` e rotinas administrativas/editor de cadastro. O ZIP contém apenas as views Home, Eventos, Etiquetas, Gestão, Checklist, Treinamentos e Offline; não foi localizada view autônoma de Administração ou CRUD de usuários. Portanto, rotinas administrativas do backend não comprovam interface V1 de gestão de perfis. |
| Operacional / Eventos | `core/views/eventos.js`, `eventos.json`, `apps/eventos/styles.css` | Escala e marcações por sigla; leitura/edição de eventos; formulário com data, membro+situação, tipo, descrição, múltiplo de atraso, substituto, turno, pagador, credor e valor; relatório diário e mensal, geração de arquivo, registros pendentes e sincronização. Catálogos dinâmicos incluem membros, pagadores e credores. Tipos observados no backend: Pessoal, Férias, ATRASO, Suporte, Gestão, Congresso, Saúde, Ausência e Outros; turnos Manhã/Tarde/Integral; múltiplos 0–6. As regras observadas escondem membro em Suporte; para ATRASO exigem membro+múltiplo e escondem substituto/turno; Pessoal/Férias/Saúde/Ausência/Gestão/Congresso exigem substituto/turno; Outros exige descrição, múltiplo, substituto e turno. Pagador, credor e valor permanecem obrigatórios. Autopreenchimento depende dos catálogos de membros/valores; V2 não deve copiar nomes pessoais estáticos nem afirmar paridade de cálculo até importar/configurar esses catálogos autorizados. |
| Etiquetas | `core/views/etiquetas.js`, `etiquetas.json`, `apps/etiquetas/styles.css` | Câmera/arquivo, recorte e OCR por IA, edição manual, formulário com data, paciente, convênio, cirurgia, atendimento, tipo, valor, credor e plantonistas, revisão antes de enviar, lista/edição autorizada, relatório diário/mensal e geração de arquivo. Dados identificáveis de paciente: não persistir em cache local; IA exige endpoint protegido e confirmação humana. Valores Tipo/Tipo de atendimento e credor observados no template: Particular, Complementação, Convênio, Consulta Pré-anestésica, SADT; Caixa, Plantão, Plantão/Caixa. |
| Gestão | `core/views/gestao.js`, `gestao.json`, `apps/gestao/styles.css` | O `managementItems` estático de `core/views/gestao.js` enumera os 12 nomes incluídos no modelo Firestore. A view abre contexto Gestor/Equipe e atividades da área; Gestão de Documentos fica dentro de Gestão. Os 24 destinos `gestorUrl`/`equipeUrl` no pacote são `#`, portanto não provam conteúdo, dados atuais ou destinos publicados. |
| Checklist | `core/views/checklist.js`, `checklist.json`, `checklist-contract.js`, assets, ZXing e layouts de relatório | QR e captura de imagem, formulário Arsenal com SIM/NÃO por item, ocorrência, liberação/inativação/reset conforme permissão, salvar, relatório diário/mensal, foto, assinatura após conclusão, assinatura parcial com justificativa (“A pedido”/“Tempo limite excedido”), retry e estados de pendência. Há fluxo próprio de conclusão/assinatura; não reduzir a gravação genérica. Campos e catálogo Arsenal precisam de extração completa por estação/versão. |
| Treinamentos | `core/views/treinamentos.js`, `treinamentos.json`, `apps/treinamentos/styles.css` | Catálogo e atividades, player YouTube, acompanhar intervalos vistos e posição, pausar/retomar, pergunta de entendimento aproximadamente na metade, concluir somente com vídeo assistido, progresso local/remoto e pontos. |
| Gestão de atividades e pontos | `core/activity-ui.js`, `core/views/gestao.js`, `treinamentos.js`, `Code.gs` | Atividade configurável, janela temporal, público-alvo, categoria e regras de recorrência, interações/evidências, conclusão, progresso, pontos, auditoria, idempotência/replay, revisão de evidência e reconciliação. Regras server-side do Code.gs são referência de domínio, não um modelo Apps Script a transportar para Auth ou cliques da V2. |
| Offline | `core/views/offline.js`, outbox, cache e service worker | Conteúdo disponível sem rede e reenvio idempotente quando a conexão voltar. |

## Arquitetura observada

- `core/app.js`: shell, roteamento hash, troca de páginas e estado inicial.
- `core/auth.js`, `auth-store.js`, `session.js`, `device-trust.js`: fronteira de autenticação/sessão e compatibilidade de dispositivos.
- `core/api.js`, `services.js`, `scope-services.js`, `page-data.js`: chamadas e adaptação dos serviços por página.
- `core/store.js`, `outbox.js`, `checklist-local-store.js`: cache local, fila e persistência de checklist.
- `core/firebase-client.js`: SDK Firebase Web/Auth bundled; `config.js` guarda o firebaseConfig público.
- `core/runtime.js`: ambiente isolado de view; `core/pwa.js` e `service-worker.js`: atualização/cache.
- Frontend empacotado: 96 entradas, incluindo imagens, CSS, 7 views principais + offline, contratos JSON, SDK Firebase Auth e biblioteca ZXing.
- Catálogo visual abaixo: 29 arquivos de imagem no total, reduzidos a 19 conteúdos únicos por SHA-256; caminhos duplicados da raiz e dos subapps foram agrupados. O service worker V1 referencia os assets do pacote, mas isso comprova pré-cache configurado, não que cada imagem esteja visível no fluxo normal.
- Índice estático dos 156 cabeçalhos de função de `Code.gs`, em [`V1_BACKEND_FUNCTION_INDEX.md`](V1_BACKEND_FUNCTION_INDEX.md), com linha de origem para auditoria e navegação.
- Semântica por domínio do roteador, autenticação Firebase legada, permissões, eventos, etiquetas, checklist, treinamento, pontuação e rotinas manuais: [`V1_BACKEND_SEMANTICS.md`](V1_BACKEND_SEMANTICS.md), com regras e destino V2 citados por linha.
- A referência por cabeçalhos da planilha atual é complementar ao modelo de `LEGACY_SCHEMA` analisado no código; os dados reais não foram copiados para a V2.

## Backend legado e banco

`Code.gs` concentra 156 funções e foi lido como fonte auxiliar de regras, campos, integrações Google e comportamento de negócio. Não é a arquitetura nem o fluxo de autenticação-alvo da V2 e não será portado como backend operacional. A V2 autentica diretamente com Firebase Authentication, resolve `users/{uid}` e usa Firestore Rules para autorizar operações. Apps Script e Sheets ficam fora do núcleo; qualquer integração posterior exige finalidade concreta e não participa de sessão, autenticação operacional, navegação ou banco principal. A validação fornecida registra o pacote legado como não implantado; isso não determina o modelo V2.

Entidades identificadas no esquema auxiliar legado: `USUARIOS`, `ESCALA`, `FERIAS`, `ETIQUETAS`, `EVENTOS`, `TREINAMENTOS`, `PARTICIPACOES`, `CHECKLIST_UNIDADES`, `CHECKLIST_REGISTROS`, `CHECKLIST_ASSINATURAS` e `AUDITORIA`. O backend também descreve referências, atividades, interações, pontuações e configurações. Esses nomes/campos servem para recuperar requisitos de negócio; o modelo Firestore V2 é próprio e está descrito separadamente. Dados e IDs atuais ainda precisam ser inventariados na conta antes de qualquer carga.

## Autenticação: propósito da V2

O prompt exige Firebase Authentication como autenticação única; autenticar uma vez, resolver UID → `users/{uid}` → perfil/permissões e manter a sessão ao navegar. Inspeção somente leitura do Console em 24/09/2026 encontrou Google ativo e nenhum provedor Email/Password ativo listado. V2 oferece Google sem alterar providers. O perfil lista `uid`, `email`, `displayName`, `sigla`, `phone`, `active`, `access`, `role`, `permissions`, `createdAt` e `updatedAt`; senha nunca vai ao perfil. Role não substitui permissões granulares. A existência do `firebaseConfig` web não prova que Rules estejam implantadas.

## Limites da inspeção

Foi analisada a estrutura completa do ZIP e os componentes centrais de roteamento, auth, serviços, persistência, outbox, config e service worker; foram verificados os contratos de view e o inventário de funções/esquema do Apps Script. Isso é análise estática do pacote fornecido. Não houve execução em navegador/dispositivo, leitura/escrita autenticada em Firestore/Sheets, conferência do deployment do Apps Script nem validação visual comparativa tela a tela. Esses itens ficam como critérios explícitos de homologação.

O inventário de telas deste ZIP é fechado em sete views: Home, Eventos, Etiquetas, Gestão, Checklist, Treinamentos e Offline. Avisos, contatos e modais são superfícies incorporadas à Home. Não há view autônoma de Administração no pacote; cadastro administrativo no backend é descrito separadamente e não é contado como tela. Avisos dinâmicos, cadastros vigentes e linhas de operação exigem a fonte autenticada, e não foram inferidos de valores de exemplo ou fallbacks locais.

### Evidência de markup extraída dos templates JSON

- Home: `dateInput`, navegação anterior/hoje/próximo, contato, checklist, treinamentos e avisos.
- Eventos: `dateInput`, `recordsDateInput`, `eventDateInput`, `memberStatusInput`, `eventTypeInput`, `delayMultipleInput`, `substituteInput`, `shiftInput`, `payerInput`, `creditorInput`, `amountToPayInput`, `monthlyRecordsInput`; ações de relatório diário/mensal, lançamento e arquivo.
- Etiquetas: `data`, `nomePaciente`, `convenio`, `cirurgia`, `atendimento`, `tipo`, `valor`, `credor`, `plantonistas`, `summary-date`, `report-month`; câmera/arquivo, OCR assistido, registro manual, revisão, edição, relatório diário/mensal e geração de PDF para WhatsApp. Tipos: Particular, Complementação, Convênio, Consulta Pré-anestésica, SADT. Credores: Caixa, Plantão, Plantão/Caixa. Consulta oculta cirurgia/convênio/valor/plantonistas e força Caixa; SADT oculta cirurgia; valor aparece em Particular, Complementação e SADT; plantonistas não se aplicam a Caixa. Convênio é obrigatório exceto na Consulta. Plantonistas exigidos fora de Caixa. O catálogo legado inclui siglas, mas a V2 deve consumir catálogo autorizado em vez de fixar essa lista no código.
- Checklist: opções `SIM`/`NAO`, `reportDate`, `declaration`, `reportMonth`, ocorrência, foto, controles de estação Arsenal, relatório, checagem/liberação/inativação/reset e justificativas de assinatura parcial.
- Treinamentos: catálogo, player, progresso/pontuação, pergunta “Está entendendo?” com Sim/Não e conclusão.

### Contratos de interface por template

Os templates abaixo foram extraídos de `core/views/*.json` usando IDs e rótulos do markup. IDs são referências para preservar fluxos/controles, não uma exigência de repetir o DOM legado.

| View | Controles/IDs observados | Diferença estrutural a resolver na V2 |
|---|---|---|
| Home | `scheduleCard`, `dateInput`, `prevButton`, `todayButton`, `nextButton`, `siglasGrid`, `installButton`; lançadores `checklistLauncher`, `trainingLauncher`, `notificationsLauncher`; modais `contactModal`, `eventsModal`, `managementModal`, `labelsModal`, `noticeModal` com estados de backdrop/fechamento; avisos têm media/presentation/countdown | Manter a composição e navegação rápidas dentro do shell único; portais/modais permanecem internos e sem iframes/apps independentes. |
| Eventos | `authGate`, `authForm`, `authPasswordInput` no template; `toggleRecordsPanel`, painel pendentes/confirmar; `recordsDateInput`, `recordsList`; `eventEntryForm` com `eventDateInput`, `memberStatusInput`, `eventTypeInput`, `eventDescriptionInput`, `delayMultipleInput`, `substituteInput`, `shiftInput`, `payerInput`, `creditorInput`, `amountToPayInput`; `siglaChoiceModal`; `monthlyRecordsInput` e `shareMonthlyPdfButton` | O login próprio da view V1 deve desaparecer em favor da sessão Firebase global única. Preservar estados de pendência/confirmação, edição/seleção de sigla e export mensal, sem chamar planilha em cada gravação. |
| Etiquetas | Captura `camera`, `preview`, `snapshot`, `capture-image`, `process-image`; form `label-form` com `data`, `nomePaciente`, `convenio`, `cirurgia`, `atendimento`, `tipo`, `valor`, `credor`, `plantonistas`; `pending-submissions-status`, `confirm-overlay`; `summary-date`, `summary-totals`, `summary-list`; `report-month`, `monthly-list`, `generate-month-pdf-whatsapp`; overlay `edit-*`; configurações `script-url`, `save-settings` | Manter OCR/captura assistiva, revisão antes de salvar, edição, pendências, relatórios e PDF/WhatsApp. URL de Web App configurável não deve continuar como destino operacional da V2. |
| Checklist | QR/câmera `scanSymbol`, `photo`, `cameraDialog`, `video`; `recordDialog` com `conditionFieldset`, `occurrence`; ações Arsenal `arsenalActionCheck/Release/Inactivate/Reset`; diário `reportDialog`, `reportDate`, navegação por dia, `equipmentList`, `responsible`; declaração/`sign`; faixas de assinatura completa e incompleta, `incompleteJustification`, motivos “A pedido”/“Tempo limite excedido”; `monthlyDialog`, `reportMonth`, `monthlyDays` | A assinatura é uma operação de relatório revisional e justificada, não uma checkbox genérica. A V2 deve manter locks/versões/histórico e pode manter a escrita fechada enquanto não existir transação confiável. |
| Treinamentos | `training-score`, `training-status`, `training-retry`, `training-catalog`, `training-activities`; `training-player`, `training-video-wrap`, `training-progress`, `training-play`, `training-complete`, `training-back`; `training-question`, `training-yes/no` | Progresso e total são lidos por UID; o início grava recibo/pontos de acesso uma vez via callable. O botão de conclusão e os pontos de conclusão seguem desativados até validação confiável do progresso. |
| Gestão | `iconGrid`, `folderOverlay`, `folderTitle`, `folderSubtitle`, `folderGestor`, `folderEquipe`, `management-activities`, `cardTemplate` | Manter grade e contexto Gestor/Equipe, mas abrir conteúdo no mesmo shell. Identificar destino/contrato interno de cada área antes de declarar Gestão completa. |
| Offline | `core/views/offline.json` e `offline.js`; âncoras `segunda`, `terca`, `quarta`, `quinta`, `sexta`, `sabado`, `ferias`; sete imagens `escala-imagens/*-2026.jpg`; navegação por âncoras com scroll suave | View visual estática “Escala/Ferias 2026”, distinta da tela de status da outbox. V2 contém a galeria na rota `offline` em aba interna do mesmo shell, mais o estado/retry da fila; botão sob demanda prepara as sete imagens no cache do service worker para uso offline posterior, sem carregar aproximadamente 3,9 MB na instalação inicial. |

### Catálogo de assets visuais

Tamanhos e hashes vêm dos arquivos extraídos do ZIP, sob `.local-preview/v1-reference/SAHMT.github.io-main/`. O status V2 foi conferido nos assets e referências de `public/`, `src/` e `index.html` em 25/09/2026.

| Asset visual V1 | Cópias no pacote / SHA-256 inicial | Bytes por conteúdo | Destino observado na V2 |
|---|---|---:|---|
| `sahmt_option1.png`, `sahmt_option1_clean.png`, `apps/eventos/sahmt_option1.png`, `apps/eventos/sahmt_option1_clean.png`, `apps/gestao/assets/sahmt-logo.png` | 5 cópias idênticas / `9F0E7956A26A` | 300.030 | Reutilizado como `public/assets/sahmt-logo.png`, reamostrado para 76.556 bytes e referenciado no shell; ícones PWA continuam versões distintas. |
| `icons/icon-192.png`, `apps/eventos/icons/icon-192.png` | 2 / `799BA271AB3B` | 53.351 | Reutilizado como ícone de 192 px no manifest, tela inicial e login. |
| `icons/icon-512.png`, `apps/eventos/icons/icon-512.png` | 2 / `C8034CF31624` | 314.166 | Reutilizado como ícone de 512 px no manifest. |
| `apps/checklist/assets/carrinho-anestesia-checklist.png` | 1 / `BC40A2FC13C5` | 2.320.919 | Reutilizado em JPEG otimizado como `public/assets/carrinho-anestesia-checklist.jpg` (536.200 bytes), sob demanda na área Checklist. |
| `gestao_operacional.png`, `apps/eventos/gestao_operacional.png` | 2 idênticas / `64375DC548F0` | 1.409.256 | Não localizado em `public/` nem referido por `src/`; tela-alvo e necessidade dependem da comparação da V1. |
| `logo_administrativo.png`, `apps/eventos/logo_administrativo.png` | 2 idênticas / `37161B245958` | 1.678.070 | Não localizado em `public/` nem referido por `src/`; não há tela administrativa correspondente no ZIP para justificar descarte. |
| `logo_equipe.png`, `apps/eventos/logo_equipe.png` | 2 idênticas / `0C244033F8F2` | 1.652.293 | Não localizado em `public/` nem referido por `src/`; uso no fluxo de equipe precisa ser comparado antes da decisão de paridade. |
| `logo_gestao.png`, `apps/eventos/logo_gestao.png` | 2 idênticas / `C087DA4D07FD` | 1.639.702 | Não localizado em `public/` nem referido por `src/`; contexto de Gestão requer comparação visual. |
| `apps/gestao/assets/selo-qga-accredited-qmentum-diamond.png` | 1 / `8D3D12A48448` | 129.040 | Reutilizado sem alteração em `public/assets/selo-qga-accredited-qmentum-diamond.png`, exibido no cabeçalho “Segmento de Gestão · SAHMT”; comparação visual completa da tela ainda pendente. |
| `escala-imagens/ferias-2026.jpg` | 1 / `574CE1B9F35A` | 455.035 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/segunda-2026.jpg` | 1 / `F47F9AE80332` | 589.219 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/terca-2026.jpg` | 1 / `8A31E3CF9120` | 588.703 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/quarta-2026.jpg` | 1 / `5D80AF3A5D9C` | 576.183 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/quinta-2026.jpg` | 1 / `2AE234D276CD` | 591.086 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/sexta-2026.jpg` | 1 / `A425DDF97D60` | 556.744 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `escala-imagens/sabado-2026.jpg` | 1 / `EA774CD9E79C` | 514.727 | Copiado para `public/assets/offline-schedule/`; permanece estático e só é preparado no cache local após ação explícita online. |
| `apps/gestao/assets/icon-192.svg` | 1 / `9F112333FF91` | 812 | Ícone do subapp Gestão; V2 usa ícone PWA PNG global, sem comparação visual completa do módulo. |
| `apps/gestao/assets/icon-512.svg` | 1 / `A15C6B178FB4` | 825 | Ícone do subapp Gestão; V2 usa ícone PWA PNG global, sem comparação visual completa do módulo. |
| `apps/checklist/icons/icon.svg` | 1 / `B24D1A91B8B1` | 499 | Ícone específico do subapp; V2 não o referencia, destino da navegação unificada pendente de comparação. |

O inventário registra assets não encontrados na V2 como pendências de comparação, não como remoções aprovadas. A conversão da imagem do carrinho e a reamostragem do logo são as únicas transformações de imagem; o selo QGA foi copiado sem alteração e os assets não usados da V1 seguem pendentes de revisão visual.

Template Eventos mantém uma tela de credenciais local além do auth shell. No backend V1, no entanto, `dispatch_` valida Firebase ID token para cada chamada protegida e `authorizeFirebase_` liga UID a usuário por email na planilha. A V2 remove ambos os padrões inadequados: uma sessão Firebase Auth e UID→`users/{uid}` para o PWA inteiro, com Rules por operação.
