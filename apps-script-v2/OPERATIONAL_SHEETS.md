# Controle de Eventos, Etiquetas e Checklist na planilha oficial

`OperationalSheetControl.gs` preenche a planilha oficial com os lançamentos ativos de `events`, `labels` e `checklists`, mantendo em primeiro plano os mesmos nomes e a mesma ordem dos campos preenchidos no app. A aba `ETIQUETAS` contém um registro por leitura; `Etiquetas Resumo` continua sendo um resumo derivado.

As datas dos formulários aparecem como `DD/MM/AAAA` e os horários de auditoria como `DD/MM/AAAA HH:mm`, no fuso `America/Sao_Paulo`. Somente os campos dos formulários ficam visíveis; autoria, datas técnicas, chave e versão são colunas ocultas.

## Instalação

Na conta proprietária `anestesiahmtforms@gmail.com`, executar uma vez `instalarControleOperacionalCompletoV1()` no Apps Script.

A função faz a cópia privada de recuperação, carrega e confere as abas, grava a linha de base protegida e instala apenas os gatilhos de edição de células e remoção de linhas. Não instala consultas periódicas.

O primeiro carregamento não grava no Firestore. Depois, uma edição válida da planilha só grava quando a versão de origem ainda coincide. Edições concorrentes ficam sinalizadas para revisão. Remover uma linha arquiva o documento e substitui seu conteúdo por um tombstone com o mesmo ID: o app deixa de mostrar o lançamento, o ID não pode ser reutilizado por uma gravação offline atrasada e o conteúdo pode ser recuperado.

As atualizações e exclusões detectadas são feitas no projeto FA, coleções `events`, `labels` e `checklists`. O arquivo não consulta nem altera outras coleções, usuários, permissões ou regras.

## Resultado esperado

`CONTROLE_COMPLETO_INSTALADO`, com contagens e `firestoreWrites: 0` na carga inicial. Confirme no painel os dois acionadores da planilha e o acionador preexistente de validação do Checklist. O estado automático permanece desligado se a instalação lançar erro.

Para retirar apenas os intervalos, executar `cancelarIntervalosPlanilhaV1()`. Os nomes antigos dos sincronizadores também chamam essa função antes de qualquer leitura Firestore. Para parar inclusive a edição/exclusão, executar `desativarControleOperacionalV1()`.

## Envio por registro — configuração separada

O cancelamento do intervalo **não ativa** o envio. `OperationalSheetPush.gs`, o relay do Worker e o cliente da PWA são os três componentes desse fluxo; precisam ser instalados/configurados juntos.

1. Apps Script: manter o controle inicial pronto; cadastrar `SAHMT_OPERATIONAL_PUSH_HMAC_SECRET` com 32 bytes aleatórios em base64url (43 caracteres), e `SAHMT_OPERATIONAL_PUSH_ENABLED=YES`. Não guardar esse segredo no Git. Publicar o receptor `doPost` como proprietário. A URL aceita chamadas sem login interativo, mas exige HMAC válido antes de acessar a planilha.
2. Worker existente de autenticação: segredo `OPERATIONAL_SHEETS_HMAC_SECRET` idêntico; `OPERATIONAL_SHEETS_SCRIPT_URL` com a URL `/exec`; `OPERATIONAL_SHEETS_ENABLED=true`. Não modifica o Worker de Etiquetas nem os contratos de autenticação FB/FC.
3. Build PWA: `VITE_OPERATIONAL_SHEETS_ENDPOINT=https://<worker>/v1/operational-sheets/notify`. Ausência dessa variável mantém o envio desligado. Nenhum segredo chega ao navegador.

A PWA guarda somente identificadores pendentes antes da gravação, marca o envio como pronto após a confirmação do Firestore e avisa o Worker. Escritas recusadas ou ainda offline não são enviadas. A retomada da fila offline também prepara o aviso, inclusive para ações enfileiradas antes desta versão. Uma falha de armazenamento local do aviso mantém os metadados em memória e não impede a gravação principal. O Worker lê **um documento** com o token FA do próprio autor e as regras existentes; não utiliza OAuth administrativo para essa leitura. Envia à planilha o documento obtido, autenticado por HMAC, sem varrer coleções. O Apps Script não lê Firestore nesse recebimento.

A linha é inserida uma vez por chave técnica. Repetições não duplicam nem sobrescrevem linhas existentes ou excluídas. Falhas ficam pendentes no aparelho e são retomadas ao entrar/reconectar ou concluir outra gravação; não há cron nem leitura em ociosidade. Esse mecanismo depende de o aparelho voltar ao app: não é uma garantia de entrega com o navegador permanentemente fechado. Se o aparelho encerrar exatamente entre a confirmação do Firestore e a persistência do aviso, ou se o armazenamento estiver indisponível e a página for fechada, usar a recuperação manual abaixo. Registros feitos diretamente no Console ou por outro produtor precisam de aviso equivalente; não existe um gatilho nativo Firestore→Apps Script nesta solução Spark.

O código de instalação com segredo é um artefato privado e temporário: retirar esse arquivo do Apps Script e do pacote de instalação após o uso. O receptor utiliza apenas a propriedade privada. Se um segredo aparecer em uma captura, substituí-lo nos dois lados antes de liberar o cliente; não reaproveitar o instalador anterior.

Edições de registros já existentes no app não são reenviadas por este fluxo de **inclusão**. As edições/exclusões pela planilha continuam seguindo o controle bidirecional. Recuperação explícita de registros não avisados: `recuperarRegistrosPlanilhaManualmenteV1()`; ela consulta o cursor e não deve ter gatilho de tempo.

Encerramento/reversão: remover a variável do build ou definir `OPERATIONAL_SHEETS_ENABLED=false`, definir `SAHMT_OPERATIONAL_PUSH_ENABLED=NO` e arquivar somente a implantação desse receptor. Não reinstalar polling automaticamente. O validador de conferência do Checklist é independente e permanece preservado.
