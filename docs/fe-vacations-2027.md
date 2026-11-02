# Escala de férias 2027 em FE

Fonte principal: Firestore `outros-48120`, documento `vacations2027Schedules/current` (esquema 2).
Referência preservada no Drive: https://drive.google.com/drive/folders/1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl
Planilha de origem da migração: https://docs.google.com/spreadsheets/d/1NFR4jJUV2HRWD68hrh3zT8g6N1i3sGrQ5LXexf-Xm8w/edit
Aplicativo original: https://anestesiahmtforms.github.io/ferias2027/

Abertura e desempenho: a consulta autenticada lê, em paralelo, perfil FE, sigla vinculada, configuração de contato FR e escala no Firestore. Não faz chamadas ao Sheets nem consulta contínua. A credencial do runtime solicita somente o escopo datastore. A sessão FA existente continua autenticando o participante; nenhum PIN ou novo login é adicionado. A referência do Drive não é uma fonte de sincronização automática: os ajustes posteriores passam a ser gravados no Firestore.

Apresentação: removido o bloco introdutório de SAHMT até os controles. O usuário comum vê diretamente as tabelas. Atualizar escala e Gestão administrativa aparecem somente para administradores. O comando REFRESH também exige administrador no servidor; LOAD permanece disponível para a abertura autenticada. Mensagens de erro e orientação de uma ação continuam disponíveis quando necessárias.

Simulação: usuários comuns usam exclusivamente a sigla vinculada ao e-mail verificado. Administradores escolhem qualquer uma das 31 siglas pelo seletor Simular com sigla, inclusive em contas administrativas sem sigla pessoal. Essa escolha é apenas para simular e não troca a identidade autenticada nem grava dados. A mensagem de WhatsApp identifica uma simulação administrativa quando a sigla escolhida difere da pessoal.

Anotações após a sigla, com ou sem espaço antes dos parênteses, permanecem na apresentação e são ignoradas no cálculo. A simulação avalia as duas semanas e os meios dias previstos nas regras. O resultado só fecha pelo botão Fechar, ou ao sair do módulo; Solicitar Mudança abre o WhatsApp de FR com a mensagem preparada. A pessoa ainda precisa enviá-la. A simulação não efetiva trocas nem cria pontos. Texto sem sigla reconhecida gera resultado inconclusivo.

Gravação: somente administrador salva ajustes com justificativa. Os dois lançamentos, a nova revisão, a auditoria permanente em vacations2027Audit, a projeção recente em vacations2027History e o comprovante idempotente em vacations2027Operations são confirmados na mesma transação do Firestore. Conflitos de versão exigem atualização antes de salvar novamente. A auditoria permanente não é apagada quando a projeção dos últimos 200 itens é renovada. Os registros antigos completos permanecem na planilha; os 200 mais recentes são importados para a consulta em FE.

Migração: scripts/migrate-fe-vacations-firestore.mjs produz uma prévia; --apply adquire o bloqueio usado pelo executor antigo para impedir gravações concorrentes na planilha, salva cópia local protegida por DPAPI e cria escala, histórico e comprovante em uma transação. A execução não sobrescreve uma escala já migrada. O bloqueio de migração expira em 15 minutos e não é usado para edições do novo serviço. O deploy exige o documento migrado e validado antes de publicar o Worker. Nenhuma célula é alterada na planilha.

Serviço: worker-fe-vacations → sahmt-fe-vacations.anestesiahmtforms5.workers.dev/v1/vacations-2027. Workers Free; billing Firebase desativado. Segredo FE_SERVICE_ACCOUNT_JSON. O helper do Sheets é utilizado somente na migração e fica fora do pacote de produção. O teste workerd verifica leitura completa em FE sem nenhuma chamada ao Sheets; o marco de compatibilidade local é 2026-10-13 por limitação do executável instalado.

Reversão: pode-se reverter a apresentação mantendo o novo serviço, cujo protocolo LOAD/UPDATE é compatível com a versão anterior. Não retornar o serviço à planilha sem reconciliar primeiro os ajustes gravados após a migração. Preserve vacations2027Schedules, vacations2027Audit, vacations2027History, identidades e comprovantes de operação.
