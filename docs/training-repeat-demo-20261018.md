# Treinamentos, consulta administrativa e demonstração

## Regra implementada

- Repetição ilimitada para quem já está autorizado ao treinamento.
- O crédito permanece vinculado à primeira resposta enviada e validada de cada pessoa, matéria estável e versão. Se os callbacks chegarem fora de ordem, o servidor reconcilia o crédito pela data do envio, mantendo o histórico dos ajustes. Refazer pode mudar a cor, mas não aumenta nem substitui os pontos dessa primeira resposta.
- A correção da nota da mesma resposta pelo gestor continua reconciliável; correções administrativas no desempenho são preservadas.
- Verde: leitura/declaração/questões concluídas e nota maior ou igual a 50% do máximo.
- Amarelo: etapas incompletas, nota pendente ou nota inferior a 50%.
- Azul: sem participação na versão atual ou material/questões em revisão.
- Uma revisão efetiva mantém o histórico e exige nova versão validada. O incremento de versão sem mudança de conteúdo continua bloqueado pelo servidor.
- A publicação de material/questões invalida a confirmação anterior de todos; não apaga participações nem pontua alguém automaticamente. Formulários ficam fechados até concluir a validação da revisão e do acesso por leitura já existentes.
- A nova versão admite outro crédito independente. Mesmo uma revisão só de questões requer nova sessão de leitura na nova versão do treinamento.

## Componentes

- `FormsEvaluation.gs`: política de repetição, cálculo das etapas no servidor, primeiro crédito e registro separado de tentativas.
- `TrainingRepetition.gs`: ativação em lotes com recuperação privada anterior às alterações. Preserva audiência, respostas e publicações fechadas.
- `DiretrizesReading.gs`: progresso parcial individual sem e-mail/capacidade de sessão na projeção do app; chave de leitura inclui a versão de treinamento.
- `ManagementPdfSync.gs` e `ManagementQuestionPublication.gs`: invalidam o treinamento antes da alteração de conteúdo. As proteções de aprovação/publicação anteriores continuam obrigatórias.
- `training-participation-state.js`: apresentação das cores; não concede pontos.
- `evaluationTrainingAttempts`: histórico de tentativas exclusivo do servidor; somente titular/administrador lê. Não entra nas consultas de saldo, filas de aprovação ou participações resumidas.
- O app observa participações resumidas e as atividades da pasta aberta. Não cria temporizador de varredura de perfis.
- Cores de conclusão exigem confirmação de todas as fontes pelo servidor; cache e alterações pendentes não podem confirmar verde. O instalador guarda a intenção de reabertura de cada formulário e retoma falhas sem anunciar conclusão falsa. Um lote parcial pode receber configurações novas em uma nova execução, sem repetir os IDs concluídos.

## Consulta administrativa

Em Administração, “Consultar como usuário” apresenta o perfil e os treinamentos elegíveis daquela pessoa. A sessão Google continua sendo a do administrador. A consulta não fornece token do usuário, não faz login no seu nome e não envia atividades por ele. O detalhamento de desempenho continua na seleção “Consultar pessoa”, respeitando a permissão existente de auditoria de ocorrências.

## Dois perfis de demonstração

`demo.html` oferece **Usuário comum** e **Administrador**, sem contas no Firebase Authentication. Há exemplos fictícios de Escalas, Eventos, Etiquetas, Checklist, Gestão, Desempenho, Informações, Ocorrências, Pessoas, QMENTUM e Administração.

São exercícios simplificados de navegação/registro, não cópias de dados reais. Não importam SDK Firebase, autenticação, outbox, Drive, Forms ou integração Apps Script. A política CSP bloqueia conexões, frames e envio de formulários. Dados existem somente na memória da página e são separados por perfil; “Reiniciar dados fictícios” ou recarregar descarta-os. Não compartilha a sessão Google nem o cache HTML de produção.

## Conferência real somente de leitura em 18/10/2026

- FA, `evaluationFormConfigs`: HTTP 200, 40 documentos; 36 READY e 4 CONFIGURATION_PENDING.
- FA, `evaluationActivities`: HTTP 200, mesmos totais.
- Configurações com `FIRST_RESPONSE_PER_VERSION`: zero.
- Comparação com os 57 Forms do inventário documental privado: 37 configurados, 20 sem configuração de avaliação. As outras três configurações pertencem a formulários fora desse catálogo e não entram no lote.
- Não foram lidas respostas de participantes nem alterados dados reais nesta etapa.

## Aplicação controlada

O código local não constitui ativação em produção. Aplicar em conjunto:

1. Atualizar os cinco arquivos Apps Script existentes alterados e acrescentar `TrainingRepetition.gs`, preservando todos os demais arquivos, configuração privada e manifesto. Não há escopo OAuth novo.
2. Publicar somente a regra adicional de leitura de `evaluationTrainingAttempts` após comparar o arquivo completo de regras com a versão instalada. Ela não autoriza escritas de pontuação pelo app.
3. Executar `conferirRepeticaoTreinamentosV1`, somente leitura. Antes da ativação geral, completar as 20 configurações ausentes usando a matéria estável, o gestor/área, os grupos, a vigência e os campos reais confirmados. Não inventar gestores, pesos ou autorizações, nem remover os bloqueios das quatro configurações pendentes. Validar um formulário controlado com a nova política e os controles de público existentes.
4. Executar uma vez `ativarRepeticaoTreinamentosV1`, no novo `TrainingRepetition.gs`. Processa apenas os Forms desse catálogo privado que já têm configuração, cinco por lote, salva recuperação privada e usa continuação automática temporária. Não cria as configurações ausentes nem altera as outras três origens. Se faltarem configurações, informa `TRAINING_REPEAT_PARTIAL_READY` e a quantidade restante, sem anunciar liberação geral. Se uma validação falhar, para; o formulário permanece fechado e o cursor é preservado.
5. Após `TRAINING_REPEAT_READY`, conferir limite de respostas desativado, edição pós-envio desativada, audiência preservada, primeiro crédito inalterado e uma segunda resposta sem novo crédito.
6. Publicar o build da PWA com `demo.html` e cache v205. A demonstração também funciona separadamente e não exige ativar pontuação real.
7. Confirmar no dispositivo: parcial amarelo, conclusão 50% verde, repetição sem pontos extras, revisão validada azul, nova versão com novo crédito. Histórico anterior deve continuar disponível.

Novos formulários preparados após a ativação usam várias respostas por padrão. O pipeline de publicação/consentimento individual permanece responsável por liberar o acesso real. Arquivos ainda sem configuração de avaliação não são configurados automaticamente, pois exigem vínculo de matéria, gestor, público e questões confirmados.

## Reversão

- Restaurar o build anterior da PWA e seu service worker, preservando dados do usuário/outbox.
- Desativar o processamento afetado antes de reverter uma configuração. Excluir somente o acionador `continuarRepeticaoTreinamentosV1` se ainda existir.
- Remover `SAHMT_TRAINING_REPEAT_ENABLED` para preparar futuros formulários com a política antiga.
- Os IDs da recuperação privada estão em `SAHMT_TRAINING_REPEAT_JOB.backupIds` (e `backupId` aponta para o primeiro). Conferir os snapshots antes de restaurar limite/configuração de cada Form. Não apagar respostas, tentativas, créditos ou revisões produzidos depois da instalação; não substituir configurações que tenham evoluído.
- A demonstração é removida retirando seu link/página; não há contas de testes para excluir em produção.

## Validação local concluída em 18/10/2026

- `npm run verify:training-experience`: 566 testes unitários, 3 testes no navegador e build Vite aprovados; sintaxe dos seis arquivos Apps Script conferida sem execução externa.
- Emulador Firestore: 11 testes das regras de avaliação aprovados, incluindo leitura do histórico de tentativas pelo titular/administrador e bloqueio de escrita pelo cliente.
- Prova de navegador da tela real de Desempenho: verde passa a azul ao receber versão nova, metadados em cache não liberam envio, revisão pendente fecha a participação e todos os observadores são encerrados ao sair.
- Recuperação do instalador testada também com confirmação HTTP perdida após commit terminal: retomar recupera a intenção persistida sem deixar o formulário fechado por engano.
- Relatório automatizado: `.local-preview/training-experience-validation.json`. Não contém credenciais ou identificadores de participantes.
- Prévia local da demonstração: `http://127.0.0.1:5198/SAHMT-V2.0.github.io/demo.html` enquanto o servidor de prévia estiver em execução. Não é um endereço publicado para os participantes.
- Nenhum arquivo remoto, regra de produção, formulário, conta real ou pontuação de participante foi alterado por essa validação.

## Aplicação operacional em 18/10/2026

Os seis arquivos foram instalados no Apps Script operacional, agora com 47 fontes. Quatro fontes existentes foram atualizadas e duas acrescentadas. A implantação operacional passou da versão 19 para 20; a releitura confirmou o conteúdo exato planejado, manifesto idêntico e preservação das outras três implantações. Nenhuma propriedade ou acionador foi alterado por essa instalação e nenhum formulário ou documento Firestore foi escrito por ela.

O operador executou `conferirRepeticaoTreinamentosV1`: TRAINING_REPEAT_CONFIGURATION_INCOMPLETE, 57 Forms documentais, 37 configurados, 20 sem configuração e 3 configurações externas preservadas. A tentativa pela Execution API retornou HTTP 403; o controle do Chrome falhou com Debugger unattached. A ativação em lotes depende do ponto de entrada `ativarRepeticaoTreinamentosV1` já instalado, sem necessidade de colar código.

A conferência também constatou que o backend de leitura não estava instalado no projeto operacional. Agora sua fonte foi acrescentada, mas nenhuma política, HMAC ou flag desse fluxo foi instalada ou habilitada. As dependências e a homologação do leitor permanecem separadas da repetição dos Forms.
