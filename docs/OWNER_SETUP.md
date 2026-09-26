# Ações do proprietário para ativar integrações no Spark

## Decisão operacional

O SAHMT V2 usa Firebase Authentication + Firestore no plano Spark. **Não vincule faturamento, não mude para Blaze e não implante Cloud Functions.** As callables e triggers em `functions/` são legado/testes de Emulator; não fazem parte do runtime publicado.

A PWA e as Rules já estão publicadas. O que ainda depende de configuração do proprietário é o Apps Script V2 assíncrono. Sem essa integração, o PWA continua registrando dados operacionais no Firestore; validações confiáveis de assinatura do Checklist e pontos de Treinamentos/Gestão ficam pendentes, e relatórios não são sincronizados com Sheets.

## 1. Restringir pasta e planilha

Na leitura de metadados de 26/09/2026, a pasta `APP SAHMT-V2.0` e a planilha `SAHMT V2.0 - BASE DE RELATÓRIOS` estavam com `anyone: reader`. O setup do Apps Script bloqueia enquanto qualquer uma estiver pública.

1. Abra a [pasta oficial no Drive](https://drive.google.com/drive/u/0/folders/1sL1NPK-CkZHmWJO_39MLajU-VpJIOZ74).
2. Em **Compartilhar → Acesso geral**, selecione **Restrito**. Preserve ou adicione somente os colaboradores que precisam de acesso nominal.
3. Abra a [planilha de relatórios](https://docs.google.com/spreadsheets/d/1I4FO9iNIFXot8O2p4GI6St76Qu_pznO8iSdyzt65E64/edit) e também selecione **Restrito**.
4. Confirme que a planilha está dentro da pasta oficial. O setup valida a localização e recusa duplicatas.

Restringir remove o acesso de quem dependia apenas do link público. Confirme os usuários legítimos antes da mudança. Não coloque dados de Etiquetas nessa planilha.

## 2. Preparar o projeto Apps Script

1. Crie um projeto Apps Script V2 dentro da pasta oficial.
2. Copie os arquivos de `apps-script-v2/`, inclusive `appsscript.json` e os validadores `ChecklistValidation.gs`, `TrainingValidation.gs`, `ManagementScoreValidation.gs` e `SparkReportSync.gs`.
3. O projeto usa os escopos OAuth declarados no manifesto: Firestore REST (`datastore`), Sheets, Drive, requisições externas e gatilhos. Revise o manifesto antes de autorizar.
4. Nas **Propriedades do script**, defina `SAHMT_V2_REPORTS_DESTINATION_APPROVED` como `YES` somente depois de confirmar que pasta e planilha estão restritas.
5. Execute `setupSahmtV2Reporting`. Ele verifica a privacidade/localização, valida cabeçalhos antes de alterar abas e guarda o ID da planilha nas propriedades do script. O setup não instala gatilhos.

## 3. Revisar acesso Firestore/IAM

Os gatilhos executam como a conta que os instalou. Ela precisa consultar e atualizar somente os dados usados pelos validadores e consultar os dados projetados para relatórios. OAuth/IAM do Apps Script acessa o projeto Firestore fora das Rules do cliente; a permissão IAM vale no escopo do projeto e **não fica limitada por coleção pelas Firestore Rules**.

Antes de conceder acesso, um administrador do Google Cloud deve revisar principal, escopos e menor papel IAM viável. Não usar chave de service account, não enviar credenciais aqui e não instalar gatilhos até essa revisão e a autorização da conta executora.

## 4. Homologar antes dos gatilhos

Use dados fictícios e confira idempotência/replay, conflito e falha para cada fluxo:

- Checklist: pedido incompleto/completo, substituto, alteração da revisão e repetição.
- Treinamentos: abaixo/acima de 95%, intervalos inconsistentes, tempo insuficiente, perfil inválido e lançamento repetido. O navegador controla faixas e sinal de encerramento; a validação não prova que o vídeo foi assistido.
- Gestão: aprovação por gestor autorizado, tentativa de autoaprovação, recusa justificada, claim divergente e repetição.
- Relatórios: projeção de campos aprovada, upsert repetido, cursor, atraso e revarredura.

Após IAM e homologação, instale apenas os gatilhos Spark necessários: `installChecklistValidationTrigger`, `installTrainingValidationTrigger`, `installManagementScoreValidationTrigger` e `installSahmtV2SparkReportTrigger`. Eles varrem o Firestore periodicamente; o PWA não espera por eles. **Não instale `installSahmtV2SyncTrigger`**, que pertence à fila legada `syncQueue`.

## Estado já preparado

- A PWA publicada usa o Firebase `sahmt-17a16` e o Firestore `(default)`.
- Rules e 32 índices estão publicados; o primeiro perfil foi provisionado pelo proprietário.
- A planilha existe e suas oito abas/cabeçalhos V2 foram conferidos.
- O código dos quatro consumidores Apps Script está versionado; nenhum foi copiado, autorizado ou ativado no projeto real.
- A consulta de faturamento em 26/09/2026 indicou `billingEnabled=false`. Isso é intencional para esta arquitetura Spark.
