# Auditoria SAHMT — 08/11/2026

## Fechamento desta etapa

Pessoas corrigido localmente para FI: leitura, cadastro, edição, importação e sincronização contacts/eventMembers sem fallback/espelhamento FA; sessão FI inclui peopleManage local e rota people. Regras FI publicadas correspondem ao arquivo local (hash `00476b7d1e21b2ef4977ab5444999c0f642cfe780b489eabd45ab006055df1b6`), catálogo contado por duas agregações (31/31) e health com corte ativo. Leitor Cloudflare específico de FI funcionou; essa confirmação não cobre outras contas. Template FI local tem corte false e não deve substituir a configuração remota ativa.

INFORMAÇÕES foi retirado por autorização explícita: cartão, tela, formulário, banner, observador e APIs de comunicados/ciência removidos. Links antigos retornam à Home; flag de esquema é normalizada para false. FF continua independente.

Validação final: 88 testes dirigidos aprovados; suíte ampla 1.243 aprovados/zero falhas/8 Forms históricos ignorados; build PWA/Gestão/Enquetes e Worker FI em dry-run concluídos. Nenhum frontend/Worker foi publicado e nenhum cadastro real foi gravado nesta etapa. Relatório completo: `outputs/PESSOAS_FI_E_RETIRADA_INFORMACOES_2026-11-08.md`. As seções abaixo descrevem a evolução histórica; este fechamento prevalece para o estado local mais recente.

Continuação das demais rotas: política FG/FH/FI/FJ por consumidores implementada localmente em `operational-session-route.js` e integrada à criação das sessões. Preserva FI/FJ compartilhados; suspende instâncias sem uso na nova rota; callback antigo verifica geração e usuário. 51 testes dirigidos passaram; suíte ampla final 1.242 aprovados/8 ignorados; build concluído. Logs `work/session-routes-final-{domain,build}.log`. Relatório `outputs/SESSOES_POR_ROTA_SAHMT_2026-11-08.md`. Pessoas ainda mantém leitores/escritores de contacts/eventMembers FA; migração desse fluxo pendente. Não publicado.

Correção local do ciclo de sessão: `operational-module-session.js` ganhou suspensão com cancelamento de timer, invalidação e logout serializado; `operational-session-route.js` liga essa suspensão à Home; a integração Firebase verifica atividade após awaits. Reentrada só troca sessão ao receber solicitação de acesso. Testes dirigidos 31/31; suíte ampla 1.242 aprovados/8 históricos ignorados; build concluído. Não publicado. Ver `outputs/FA_CONSUMIDORES_E_SESSOES_2026-11-08.md`. Ainda revisar consumidores das outras rotas, páginas ocultas e homologação real. A checagem global de whitespace acusa problemas anteriores em arquivos fora deste ajuste.

Continuação às 16:09 (São Paulo): readback por API confirmou HEAD de 83 arquivos com o hash já registrado; versões 45/54/55 ainda contêm rotas HTTP operacionais. Relatório: `outputs/FA_ROTAS_PUBLICADAS_2026-11-08.md`. Nenhum endpoint operacional foi executado nesta conferência. O relay local `operational-sheet-relay.js` ainda declara origem Firestore FA; bindings publicados seguem pendentes. Dois testes de aposentadoria foram atualizados para a ausência final dos entrypoints/ferramenta removidos; a bateria dirigida de aposentadoria e cache passou 12/12. Isso não substitui a homologação remota.

## Arquitetura determinada pelo proprietário

FA serve exclusivamente para entrada, navegação e autenticação. Pontuação, avaliações, Forms antigos e rotinas operacionais centrais estão aposentados. A Home deve usar apenas cache de apresentação da Escala e botões de Eventos, Checklist e Etiquetas. Atualização de dados ocorre ao abrir a instância correspondente. A presença de código legado não altera essa decisão arquitetural.

## Evidências e alterações

- O proprietário executou `retirarAcionadoresLegadosFA20261108`, no arquivo `FaRoutineRetirement.gs`, às 08:37:34–08:37:41 (São Paulo). Resultado: `FA_LEGACY_TRIGGERS_REMOVED`, 20 removidos, zero restantes, zero leituras e gravações Firestore nessa execução. Alcance: conta executora no projeto FA; não comprova ausência de acionadores instalados por outras contas.
- Antes do corte: 13 envios Forms; reconciliação de avaliação e validação de ciência a cada 5 min; pontuação, links e continuidade a cada 15 min; dois eventos de planilha. Os cinco relógios somam até 864 disparos nominais/dia. Disparos não equivalem a leituras, e algumas funções já retornavam sem trabalho.
- Bloqueio do produtor de pontuação FA aplicado no editor e conferido por API. Cache de releituras dentro da mesma transação aplicado ao `EvaluationLedger`; não atravessa execuções nem substitui autorização atual.
- Cron redundante `0 7-10 * * *` retirado do Worker central `sahmt-indicators` na conta FA, com leitura de confirmação vazia. O handler FD encaminhado já era inerte: quatro invocações/dia evitadas, sem atribuir economia Firestore a essa alteração. Agendador próprio FD não foi alterado.
- A revisão desta sessão identifica funções de instalação/restauração aposentadas. Cada remoção remota exige comparação de hash, verificação de referências, compilação conjunta e leitura posterior. Alterar HEAD não altera automaticamente versões Web App já publicadas.
- Frontend local: retirada da interface/rota Desempenho FA; cache exclusivo de apresentação e entrada explícita em Escala; perfis FG/FH sob demanda. Ainda não publicado.

## Matriz de instâncias e cobertura

| Instância | Responsabilidade / projeto | Fontes e consumidores conhecidos | Estado da verificação |
|---|---|---|---|
| FA | Entrada, navegação e autenticação / `sahmt-17a16` | Auth, `users/{uid}`, `accessRequests`, configuração da entrada; perfis consultados pelo cliente e mecanismos de autenticação. Código compartilhado legado ainda contém outras coleções. | HEAD remoto conferido em 08/11: 83 arquivos, 785 funções, hash `fac49ce14611d3c9c125892a6256a916631c3bff7cc7fcffe92eb294f34b7449`. O proprietário informou 20 acionadores removidos e zero restantes na conta executora; a API de conteúdo não lê o inventário atual de acionadores. Implantações versionadas 45/54/55 e uma sem versão permaneceram inalteradas. |
| FB | Gestão, treinamentos / `sahmt-gestao-5ae66` | Documentos/treinamentos/avaliações, projeções de desempenho; PWA Gestão e Worker de treinamento; Apps Script de desempenho próprio. | 3 arquivos exportados; domínio gerado não deve ser confundido com arquivo ausente. Acionadores e consumidores completos pendentes. |
| FC | Registros, QMENTUM / `indicadores---sahmt` | QMENTUM, ocorrências e desempenho FC; `sahmt-fc-integration` e Apps Script próprio. | 24 arquivos no bundle remoto gerado. HEAD e versão 2 identificados. Conferência atual dos bindings pendente. |
| FD | Indicadores e consolidado / `rotinas-8a617` | Fontes FG/FI/FB/FC/FE; Worker de indicadores e agendador próprio. | Há evidência anterior do cron diário `0 5 * * *`; não foi acionado manualmente. Auditoria completa de publicação/IAM/rotinas pendente. |
| FE | Enquetes e consultas / `outros-48120` | Clientes Enquetes, Workers FE e respectivas projeções. | Fontes locais e histórico de corte; publicação e acionadores não verificados integralmente. |
| FF | Comunicação / `sahmt-comunicacao-ff` | Worker `sahmt-ff-comunicacao`, filas e notificações; fonte de escala FJ. | Exportação Apps Script HTTP 403. Não classificar como limpo. |
| FG | Checklist / `sahmt-checklist-fg` | `stations`, checklists, assinaturas/pedidos, projeções; leitor próprio, planilha e Worker de sessão. Ainda há referências a FI/FJ e `userCategories` FA na fonte. | 14 arquivos: 13 GS correspondem ao repo; manifesto difere. Lista de implantações HTTP 403. |
| FH | Etiquetas / `sahmt-etiquetas-fh` | Registros de etiquetas, perfis e catálogos; leitor PWA, Apps Script de planilha e Worker FH. | 6 arquivos correspondem ao repo; acionadores/consumidores completos pendentes. |
| FI | Operacional / `sahmt-operacional-fi` | `events`, `contacts`, `eventCatalogs`; PWA, Apps Script de planilha, Worker FI e consumidores FG/FD. | 6 arquivos correspondem ao repo; acionadores e consumidores completos pendentes. |
| FJ | Escala / `sahmt-escala-fj` | `scheduleDays`, `vacations`; publicação validada da planilha, PWA e consumidores FG/FF. | 6 arquivos correspondem ao repo; acionadores/consumidores completos pendentes. |

A matriz registra evidências disponíveis, não um inventário exaustivo de coleções, escritores, endpoints ou IAM. Arquivos-base, arquivos gerados e ajustes remotos precisam continuar separados. Nunca publicar `apps-script-v2/` inteiro sobre o projeto real.

## Publicação do PWA observada

GitHub Pages informou V2.50 e revisão `5d14b6ee9322a279ce42406a1cb1d8426d73d72c`. HTML e chunks de autenticação foram baixados da origem publicada para auditoria. O fluxo de Google Auth direto aparece nos chunks e na configuração de build. FI–FJ usam Workers próprios de troca de sessão; não confundir essa troca com o antigo gateway central FB/FC.

O projeto Apps Script FA ainda expõe versões históricas com rotas FB/FC e continuidade. Isso não prova uso atual, mas impede afirmar que todos os consumidores foram eliminados. Não houve atualização dessas versões nesta revisão.

## Consumo

Cloud Monitoring, projeto FA: 25.047 documentos lidos e 3.152 gravados somados na janela 07/11/2026 08:37–08/11/2026 08:37 (São Paulo). Séries paginadas foram lidas até o fim. São métricas observadas de documentos, não uma fatura nem atribuição por função. Ausência de amostra não foi tratada como zero.

A primeira janela posterior disponível era de apenas dois minutos, sem leituras, assim como os dois minutos imediatamente anteriores. Isso não demonstra redução causal ou sustentada. A comparação de 24 horas após o corte só poderá fechar em 09/11/2026 após 08:38, respeitando o atraso de publicação das métricas. Não criar agendamento sem solicitação do usuário.

Houve falha histórica `SAHMT_URLFETCH_DAILY_QUOTA` no executor FA. URLFetch, documentos Firestore e execuções de acionadores são métricas distintas. As APIs Apps Script de processos/métricas retornaram 403 com a credencial disponível. Projetar menos campos reduz payload, não o número de documentos lidos.

## Validação e limites

Testes locais de autenticação, identidade por projeto, logout e leitura atual do perfil: 61 aprovados. Primeira bateria de integração cache/navegação/relatórios: 90 aprovados. Cache inclui casos de vazio, expiração, corrupção, quota local, isolamento por usuário, retorno e recusa do servidor. Builds FA, FB e Enquetes concluíram. As demais baterias têm logs locais próprios; verificar os resultados finais da sessão.

Os testes com navegador Edge falharam ao iniciar o processo (Crashpad/pipe do Windows), antes de validar a aplicação. O controle do navegador via Work também retornou desativado. Não declarar login real, layout móvel, revogação real, publicação do frontend ou todo o ecossistema homologados.

## Pendências obrigatórias

1. Verificar e desativar consumidores HTTP legados antes de apagar versões Apps Script ou criar um substituto mínimo.
2. Remover restantes instaladores/processadores/configurações sem uso, preservando dependências compartilhadas até terminar o rastreamento.
3. Fechar inventário FA–FJ com origem publicada, acionadores por dono, coleções, leitores, escritores, endpoints, IAM e Rules.
4. Homologar o cache no navegador e publicar o frontend; aferir que Home não dispara requisições dos quatro módulos.
5. Comparar consumo em janelas completas e com volume de uso documentado.

O ecossistema ainda não foi declarado limpo.

## Continuação local — 08/11/2026

- `src/data-lite.js:listActiveContacts()` agora lê o catálogo de contatos de FI quando chamado pelo módulo Escala. A chamada exige o modo independente; FI desativado ou acesso negado não volta silenciosamente ao Firestore FA. A rota Home continua apenas com cache local para a prévia da Escala.
- O leitor de indicadores FD agora encaminha os registros operacionais para seus projetos proprietários: checklists → FG, labels → FH, eventos → FI. Os IDs antigos de atividades `FA.*` foram mantidos no formato dos indicadores para não quebrar planos de atualização já salvos; os documentos são lidos do projeto dono e os orçamentos são cobrados na origem correta. A configuração antiga de eventos FA foi retirada do template FD e o fallback genérico para FA foi removido.
- As três consultas operacionais são limitadas ao ano solicitado e paginadas por data/documento. Essa alteração reduz varredura histórica; a máscara de campos permanece apenas redução de payload.
- Novos testes cobrem o roteamento FG/FH/FI, a ausência de fallback, filtros anuais, paginação e orçamento por origem. Testes dirigidos: 7 aprovados; suíte `test:domain`: 1.249 aprovados, zero falhas. Build do painel FD e build FA/Enquetes concluíram.
- A entrada da Home deixou de importar em repouso `data.js`, interface de desempenho, equipamento e câmera de Etiquetas. O pré-carregamento era acionado no `render()` e após login/troca de usuário antes de abrir qualquer instância. A remoção limita a inicialização aos caminhos acionados pelo usuário; as importações permanecem nas ações/rotas que as consomem.
- A Home mantém botão explícito da Central de Comunicação FF, mas removeu o carregamento automático de avisos e mensagens. Registros FF são solicitados ao abrir a Central.
- O Worker de comunicação agora lê escala exclusivamente em FJ e rejeita configuração FA para `scheduleDays`; mantém somente a consulta `users/{uid}` FA usada para validação de acesso. Esta alteração é local e não publicada.
- Verificação final desta continuação: `test:domain` 1.249/1.249 aprovados; build PWA concluído. Testes dirigidos relevantes incluem 61 casos para Home/contatos/roteamento FD/comunicação nesta execução. O navegador real continua indisponível, então não houve inspeção de rede em sessão Chrome.
- O status FE da campanha de fim de ano foi movido para abertura explícita da rota, com botão visível apenas a quem tem acesso. Home/login e retries de visibilidade/rede não consultam FE; o fluxo de escala final de ano permanece disponível. Isso não elimina Auth/FA ou outras chamadas necessárias à sessão.
- Teste Playwright de Escala Final de Ano e regressões dirigidas relacionadas: 20 aprovados, zero falhas. Esse teste é automatizado; não substitui a inspeção do Chrome real nem mede Firestore de produção.

## Estado do Apps Script FA — readback remoto posterior

- Apps Script API `projects.content` confirmou primeiro o hash pós-poda `c36c89f4…` e serviu as fontes atuais. O call graph identificou que `FormsEvaluation.gs` contém utilitários compartilhados por ROPS, treinamentos e leitura/publicação de documentos; o arquivo inteiro foi preservado.
- Removidos do HEAD, após checagem de referências e compilação conjunta: `ManagementMigrationInventoryNative`, `FaRoutineRetirement`, `TrainingProductionControl`, `TrainingProductionRelease`; quatro instaladores sem consumidores (`installChecklistResponsibilityTrigger`, `installChecklistValidationTrigger`, `installManagementScoreValidationTrigger`, `installTrainingValidationTrigger`); e os handlers/instaladores aposentados de Forms (`installEvaluationTriggers`, `onEvaluationFormSubmit`, `processEvaluationRequests`, `reconcileEvaluationResponderAccess`, `reconcileEvaluationResponses`, `reconciliarAvaliacaoSahmtV2`).
- Também removidos os pontos de entrada da pontuação FA (`instalarDesempenhoFaV1`, `iniciarDesempenhoFaV1`, `executarDesempenhoFaV1`) e o guard auxiliar usado somente por eles. Leitores/ajudantes ainda referenciados pela migração FI/FJ e pelo envio de Checklist foram preservados.
- Readback final do HEAD: 83 arquivos, 785 funções, hash `fac49ce14611d3c9c125892a6256a916631c3bff7cc7fcffe92eb294f34b7449`; compilação conjunta passou; zero referências aos nomes removidos; implantações versionadas não mudaram. Isso não altera código das versões Web App já publicadas.
- Permanecem 19 funções de instalação/continuação de rotinas para e-books, revisão de documentos, ROPS, materiais, treinamento, planilha operacional e continuidade. Ainda não foram removidas porque dependem de outros arquivos/controles e falta confirmar bindings atuais dos Workers e quais consumidores migrados continuam chamando as versões 45, 54, 55 ou a implantação sem versão. A matriz desses consumidores segue pendente; não declarar o projeto limpo.
- As alterações acima estão somente no workspace local. Nenhum Worker FD foi publicado nesta continuação. O Chrome continua bloqueado pelo Work; Wrangler respondeu “You are not authenticated”. Portanto, os bindings/versões remotas e permissões dos service accounts FG/FH/FI ainda não foram conferidos. Antes de publicar o FD, confirmar IAM de leitura e índices de consulta nos projetos proprietários; sem isso os resultados ficam `UNAVAILABLE` em vez de consultar dados antigos de FA.
- Medição anterior permanece a única observação comparável: 196 leituras de FA nos 46 minutos anteriores e 131 nos 46 minutos posteriores ao corte dos acionadores. Isso não mede o efeito desta mudança local e não demonstra redução causal/sustentada. Nenhuma medição posterior atribuível ao novo roteamento existe.

## Revalidação local — 08/11/2026

- Build `node scripts/build-independent-apps.mjs`: concluído para PWA, Gestão e Enquetes. Vite ainda reporta chunks acima de 500 kB; build válido, otimização de bundle continua pendente.
- Suíte `test:domain`: 1.242 aprovados, zero falhas e 8 ignorados. Esses oito casos exercitam dispatcher/handlers Forms removidos do FA; foi acrescentado teste estático exigindo que os seis entrypoints aposentados permaneçam ausentes. Testes dos helpers compartilhados continuam ativos.
- Inventário das 19 funções de instalação/continuação foi separado em `outputs/APPS_SCRIPT_FA_FUNCOES_DE_INSTALACAO_PENDENTES_2026-11-08.md`. Não remover sem mapear criadores dos acionadores e consumidores das implantações sem versão, 45, 54 e 55.
