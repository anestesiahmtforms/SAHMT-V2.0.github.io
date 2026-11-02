# Escala de férias 2027 em FE

A escala finalizada utiliza a cópia preparada para FE:
https://docs.google.com/spreadsheets/d/1NFR4jJUV2HRWD68hrh3zT8g6N1i3sGrQ5LXexf-Xm8w/edit
Pasta de referência: https://drive.google.com/drive/folders/1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl
Origem do layout e cálculo: https://anestesiahmtforms.github.io/ferias2027/

Acesso: Governança → Enquetes e Consultas → ESCALA DE FÉRIAS 2027. Usuários ativos autenticados podem abrir apenas o menu FE e esta escala, sem liberar outros módulos restritos. A sessão FA existente autentica as requisições; o serviço verifica o perfil FE. Não há PIN nem segunda autenticação, fila de escolhas ou convite WhatsApp.

A sigla é relacionada automaticamente pelo e-mail verificado do usuário e pelo cadastro de contatos. O vínculo é armazenado apenas em FE (`vacations2027Identities`), sem modificar perfis FA/FB ou permitir escolha de outra identidade. As 31 siglas são preservadas; três contatos ainda não têm perfil de usuário correspondente e serão reconhecidos pelo e-mail se forem cadastrados. Contas sem vínculo podem consultar, mas não simular por outra sigla.

A consulta é realizada ao abrir e pelo botão Atualizar escala. Não há consulta contínua. A simulação roda inteiramente no dispositivo: toque na vaga livre ou na sigla do colega, depois na sua semana de saída. Calcula as duas semanas, inclui meios dias das exceções da origem e mostra o total de coincidência comparado ao limite de 3 dias. Após 5 segundos o resultado esmaece. Nunca grava nem gera pontos. Texto desconhecido na planilha produz resultado inconclusivo, sem inventar sigla ou afirmar que a troca atende à regra. O cálculo não substitui a avaliação administrativa de outras restrições operacionais.

Somente administrador pode salvar correções ou trocar dois lançamentos. Justificativa é obrigatória. Atualização das células e auditoria são uma única operação atômica na cópia FE, com valores de texto literal. Controle de versão detecta mudanças anteriores; bloqueio transacional em FE coordena administradores do módulo. Evite editar a mesma célula diretamente na planilha enquanto um ajuste está sendo salvo: Google Sheets não fornece compare-and-swap de valores. Resultado desconhecido não é reenviado cegamente. A auditoria inclui ator, valor anterior e identificador da operação. O módulo não escreve nas fontes FA/FB/FC/FD nem altera o app original.

Serviço: `worker-fe-vacations` → `sahmt-fe-vacations.anestesiahmtforms5.workers.dev/v1/vacations-2027`. Workers Free; billing Firebase continua desativado; sem gatilhos. Credencial privada somente no segredo `FE_SERVICE_ACCOUNT_JSON`. Planilha compartilhada como Editor com `fe-survey-worker@outros-48120.iam.gserviceaccount.com` pelo proprietário. Google Sheets API habilitada no projeto FE.

Reversão: desativar `VACATIONS_ENABLED` no Worker e reverter este commit do PWA para a estrutura visual. Não apagar as identidades nem os registros de auditoria. As marcações da planilha permanecem intactas na ativação; nenhum lançamento de férias é criado para teste.
