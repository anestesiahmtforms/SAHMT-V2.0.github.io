# FF — Histórico de comunicação e atividades obrigatórias

Proposta para revisão — 15/11/2026. Ainda não implementada.

## Objetivo e decisões do usuário

Substituir as informações resumidas de MENSAGENS ENVIADAS por um histórico completo de mensagens a grupos e indivíduos, com confirmação individual de leitura. Criar o arquivo na pasta Drive `1oRqrwBKs6I6YHyGLxMj8j0_MI8dcuI3X`.

Adicionar à Central um botão exclusivo TREINAMENTOS E ENQUETES, com seleção de atividade e destinatários. O aviso será pequeno, deslocável e sem botão de fechamento, persistirá por toda a navegação e desaparecerá somente após conclusão confirmada. Enquetes terminam com o envio aceito das respostas; treinamentos exigem a nota mínima especificada. Uma pendência não cumprida ampliará o aviso até bloquear a navegação geral por volta do quinto dia.

O usuário escolheu planilha Google Sheets no Drive para o histórico e somente mensagens/pendências ativas no FF.

## Alternativas

1. **Escolhida: histórico no Drive e estado ativo no FF.** Permite consulta administrativa tabular e mantém as pendências rápidas. Exige sincronização confiável e confirmação do arquivamento.
2. Histórico completo também no FF, espelhado no Drive. Facilita consultas, mas mantém o acúmulo que o usuário deseja reduzir.
3. Tudo somente no Drive. Não recomendado: cada verificação de banner e atualização dependeria da planilha, de sua latência e de suas cotas.

Não se promete custo zero nem redução imediata de todas as leituras: leitura, sincronização e validação de conclusão também consomem operações. Medir antes/depois e manter os limites gratuitos existentes.

## Arquivo proposto

Uma planilha anual, inicialmente **SAHMT — Histórico de Comunicação FF — 2026**, dentro da pasta indicada. Abas:

- **Mensagens:** identificador, título, conteúdo integral, remetente, data/hora, tipo de envio, público selecionado, atividade vinculada, versão/ciclo e critério de conclusão.
- **Destinatários:** uma linha por mensagem e integrante, com identidade estável, nome no momento do envio, grupo no envio, situação, primeira leitura e conclusão.
- **Eventos:** registro cronológico de publicação, abertura confirmada, conclusão, cancelamento administrativo e sincronização.
- **Controle:** versão do formato, datas de sincronização e referências de lotes.

Datas apresentadas em America/Sao_Paulo; identificadores e instantes absolutos preservados. Dados como texto, sem executar fórmulas oriundas do conteúdo das mensagens. A planilha não conterá respostas individuais de pesquisas, alternativas marcadas, prontuários ou documentos de saúde.

Verificar o acesso efetivo da pasta antes de gravar dados pessoais: os arquivos herdam permissões do destino. Não criar link público nem alterar o compartilhamento da pasta. Credenciais ficam no servidor; não publicar token ou acesso à planilha no JavaScript do PWA. O mecanismo final de autenticação deve usar somente o arquivo/destino autorizado; eventual autorização adicional necessária será apresentada com o arquivo concreto e o acesso exato, antes de ativá-la.

## MENSAGENS ENVIADAS

Lista pesquisável e paginada por período, tipo de mensagem, grupo, destinatário e situação. Cada item abre conteúdo completo e uma relação dos destinatários, mostrando separadamente:

- publicação no app;
- situação de push, quando houver informação;
- mensagem aberta pelo integrante, com data/hora;
- atividade pendente ou concluída, com data/hora e confirmação do critério.

Aceitação do push pelo provedor não significa entrega ao aparelho nem leitura. “Mensagem aberta” significa que o conteúdo foi expandido/aberto em uma tela visível e o servidor aceitou o registro autenticado; não afirma compreensão humana. Não marcar leitura ao listar mensagens ou exibir somente o banner compacto. O registro deve ser idempotente por mensagem/integrante e manter a primeira abertura.

Acesso ao histórico global somente aos administradores autorizados da Central. O integrante consulta apenas suas mensagens e pendências. Não expor o arquivo global como link de navegação para participantes.

## TREINAMENTOS E ENQUETES

Formulário administrativo com título, orientação, tipo de atividade, seleção de um item existente/publicado, versão ou ciclo e público: TODOS, EQUIPE, RESIDENTES, SUBSTITUTOS ou INDIVIDUAL, seguindo os grupos já existentes. O botão cria e envia a convocação; a autoria do conteúdo de treinamento ou pesquisa continua nos módulos especializados existentes.

No treinamento, exibir a pontuação máxima e exigir nota mínima válida (maior que zero e menor ou igual à máxima). A nota mínima da convocação será explícita, pois o módulo atual usa nota máxima para seu indicador de conclusão. A convocação não muda a pontuação de desempenho nem concede pontos adicionais. A conclusão exige uma tentativa finalizada da versão vinculada, contendo as etapas obrigatórias de leitura/ciência e nota suficiente. Não exigir aprovação de sugestão por gestor para liberar o banner.

Na enquete, usar exclusivamente a confirmação de participação/envio aceito do ciclo vinculado, sem ler as respostas. Não inventar nota para pesquisas sem avaliação.

Reconhecer conclusão anterior ao envio quando for da mesma versão/ciclo e satisfizer o critério. Pesquisas já respondidas não podem ser reenviadas no fluxo atual; não exigir uma repetição impossível. Uma nova obrigação de refazer exige uma nova versão/ciclo autorizado no módulo de origem. A conferência desta regra foi o único ponto relevante levantado na revisão independente.

Público e destinatários ficam fixados no momento do envio, usando integrantes ativos/autorizados do diretório FF. Novos integrantes não recebem retroativamente a convocação. Destinatário sem permissão para a atividade não deve receber uma obrigação impossível: validar elegibilidade e mostrar o motivo antes do envio. Confirmação administrativa mostra título, atividade, nota mínima quando aplicável e quantidade de destinatários. Evitar duplicação ao repetir envio após perda de conexão.

## Banner persistente e crescimento

Componente no nível da sessão, independente da rota. Deve funcionar nas duas superfícies publicadas, FA e FB, inclusive acima de modais, e abrir diretamente a atividade correta no ambiente de origem. A troca entre FA e FB não elimina a obrigação.

Proposta de progressão pelo tempo do servidor desde a publicação: inicialmente compacto; após 24, 48, 72 e 96 horas, tamanhos crescentes; após **120 horas (cinco dias completos)**, ocupa o contêiner e impede abrir áreas gerais. A apresentação é recalculada ao abrir/retomar o app; várias aberturas no mesmo dia não antecipam o prazo. Mostrar o prazo e o critério de conclusão no próprio aviso.

O aviso compacto pode ser arrastado por toque/mouse e reposicionado por teclado, sem sair da tela e sem cobrir permanentemente controles essenciais. Não existe × nem comando de dispensar. Várias pendências usam um painel compacto com quantidade e prioridade pela mais antiga, evitando banners sobrepostos.

No estágio de tela inteira, continuam acessíveis a atividade exigida, a seleção de outras pendências, recuperação de sessão/conexão e saída da conta. Durante a execução da atividade, o painel deve deixar os controles necessários utilizáveis. A consulta ao histórico não é a ação que libera a obrigação.

O desaparecimento ocorre somente com confirmação do serviço de origem, vinculada à mesma pessoa e à versão/ciclo. Nunca aceitar pontuação, conclusão ou relógio enviados livremente pelo navegador. Ao concluir, atualizar imediatamente as duas superfícies no próximo retorno/consulta válida.

Para essa integração, a chamada deverá autenticar as identidades da mesma conta Google nos ambientes envolvidos. Usar somente serviços fixos de origem e uma resposta de conclusão restrita, sem dar ao FF acesso genérico aos bancos de treinamentos ou às respostas de pesquisas. A forma concreta será validada no plano técnico e nos testes de isolamento.

Se a atividade estiver indisponível, desativada, retirada ou com tentativas esgotadas abaixo da nota mínima, apresentar o motivo. Não criar um bloqueio sem saída: o administrador pode cancelar a convocação com justificativa auditada. Não restaurar tentativas nem alterar regras de avaliação silenciosamente. Falha de rede isolada não conta como nova abertura nem antecipa o crescimento; mostrar que a verificação está pendente e manter meios de recuperação.

## Persistência, sincronização e economia

No FF ficam somente estado operacional necessário, referências e uma fila limitada de sincronização. No Drive ficam o histórico completo e os eventos individuais. Cada evento tem identificador estável para impedir duplicação quando uma tentativa de gravação perde a resposta.

Após publicação, capturar o público real, gravar evento e sincronizar de forma recuperável. Falha do Drive não pode gerar confirmação falsa de arquivamento. Exibir pendência de sincronização e repetir com espera progressiva, sem sondagem contínua no navegador. Usar lotes e paginação; não carregar a planilha inteira em cada abertura.

Uma mensagem ativa continua disponível à leitura no app. Uma convocação obrigatória não expira automaticamente após os sete dias usados pelos avisos comuns. Arquivar/remover do armazenamento ativo somente após confirmação verificável do histórico completo e encerramento de todas as pendências aplicáveis. Não apagar documentos legados nesta primeira ativação; preparar o inventário e verificar o arquivamento antes de qualquer migração posterior.

## Compatibilidade com o que existe

- Preservar envios de eventos comuns e avisos de liberação de escala.
- O FF atualmente mantém diretório próprio e não deve receber acesso genérico aos bancos de FB/FE.
- Os treinamentos estão em FB; as pesquisas institucionais, em FE. Validar conclusão por uma integração restrita com seus serviços, autenticando a mesma conta e retornando somente metadados de conclusão.
- Não aceitar URL arbitrária como atividade nem usar mensagem do navegador como prova de conclusão.
- O código de banners antigos é dispensável e hoje não está montado na Home; a nova obrigação exige integração no ciclo global da sessão, não apenas alterações naquele arquivo.

## Histórico anterior

Importar mensagens existentes somente com informações comprovadas. Onde não houver lista original de destinatários ou leitura, mostrar **não registrado no envio original**. Não reconstruir grupos antigos a partir do grupo atual nem inventar confirmações retroativas. Os registros novos terão lista fixa e recibos individuais.

## Verificação antes da publicação

Testes de autorização e isolamento de usuários; repetição de envio/leitura/sincronização; tentativa de forjar conclusão; grupo alterado após envio; versão atualizada; pesquisa já respondida; nota insuficiente e suficiente; cinco dias por relógio do servidor; navegação FA/FB, modal, teclado, toque, telas pequenas; falha de Drive e rede; retomada sem duplicar eventos.

Usar mensagens e integrantes sintéticos nos testes, sem enviar avisos reais aos grupos. Confirmar criação e leitura do arquivo no destino, autenticação do serviço e recuperação após falha. Commit/push pelo GitHub Desktop, testes de publicação e conferência da versão pública. Não anunciar como pronto antes da integração e da publicação verificadas.

## Decisões propostas para aprovação

O formato anual de planilha, a leitura como abertura autenticada, a progressão até 120 horas, o campo explícito de nota mínima, o reconhecimento de conclusão anterior válida, o botão de convocação ligado às atividades existentes e o cancelamento administrativo auditado para obrigações inviáveis são propostas de implementação. A escolha Drive + estado ativo no FF e a conclusão de enquetes por envio confirmado já foram aprovadas pelo usuário.

## Referências técnicas verificadas

- Google Sheets: cotas por minuto e orientação de usar lotes e espera progressiva: https://developers.google.com/workspace/sheets/api/limits
- Google Drive: permissões herdadas da pasta de destino e verificação de capacidades: https://developers.google.com/workspace/drive/api/guides/manage-sharing
