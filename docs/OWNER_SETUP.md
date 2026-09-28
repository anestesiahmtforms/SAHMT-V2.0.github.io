# Ações do proprietário para ativar integrações no Spark

## Decisão operacional

O SAHMT V2 usa Firebase Authentication + Firestore no plano Spark para suas operações. A callable `readLabelImage` é uma exceção opcional solicitada para ler etiquetas por IA; ela exige plano Blaze/faturamento, segredo privado no Secret Manager e deploy dedicado. Está inativa enquanto esses requisitos não forem deliberadamente aprovados e configurados pelo proprietário. Não cole chaves de API no chat, frontend, GitHub ou Apps Script. As demais callables e triggers em `functions/` são legado/testes de Emulator e não fazem parte do runtime publicado.

A PWA e as Rules já estão publicadas. O que ainda depende de configuração do proprietário é o Apps Script V2 assíncrono. Sem essa integração, o PWA continua registrando dados operacionais no Firestore; validações confiáveis de assinatura do Checklist e pontos de Treinamentos/Gestão ficam pendentes, e relatórios não são sincronizados com Sheets.

## 1. Restringir pasta e planilha

Na leitura inicial de metadados de 26/09/2026, a pasta `APP SAHMT-V2.0` e a planilha `SAHMT V2.0 - BASE DE RELATÓRIOS` estavam com `anyone: reader`. O proprietário restringiu ambas depois; uma leitura posterior confirmou acesso apenas por contas nomeadas. O setup do Apps Script bloqueia enquanto qualquer uma estiver pública.

**Estado atual verificado em 26/09/2026:** o proprietário restringiu a pasta e a planilha. Uma nova leitura confirmou que ambas só têm acesso de contas nomeadas; não há permissão geral ou “qualquer pessoa”. Esta etapa está concluída e não precisa ser repetida antes de criar o projeto Apps Script, a menos que as permissões mudem.

1. Abra a [pasta oficial no Drive](https://drive.google.com/drive/u/0/folders/1sL1NPK-CkZHmWJO_39MLajU-VpJIOZ74).
2. Em **Compartilhar → Acesso geral**, selecione **Restrito**. Preserve ou adicione somente os colaboradores que precisam de acesso nominal.
3. Abra a [planilha de relatórios](https://docs.google.com/spreadsheets/d/1I4FO9iNIFXot8O2p4GI6St76Qu_pznO8iSdyzt65E64/edit) e também selecione **Restrito**.
4. Confirme que a planilha está dentro da pasta oficial. O setup valida a localização e recusa duplicatas.

Restringir remove o acesso de quem dependia apenas do link público. Confirme os usuários legítimos antes da mudança. Não coloque dados de Etiquetas nessa planilha.

## 2. Preparar o projeto Apps Script

1. Crie um projeto Apps Script V2 dentro da pasta oficial.
2. Para enviar os arquivos deste checkout pelo `clasp`, abra as [configurações do Apps Script](https://script.google.com/home/usersettings), clique em **Configurações → Google Apps Script API** e ative a chave. Essa permissão da conta permite que aplicativos que você autorizou gerenciem projetos e implantações Apps Script; ela é distinta dos escopos de execução do script e pode ser revogada nas mesmas configurações.
3. No PowerShell, entre no diretório local `apps-script-v2/` e execute `npm.cmd exec --yes --package @google/clasp -- clasp login`; autentique com a conta proprietária. Confirme que `.clasp.json` aponta para o ID do projeto V2 e execute `npm.cmd exec --yes --package @google/clasp -- clasp push`. O envio substitui os arquivos no editor; confirme antes que o projeto remoto é o projeto V2 criado na pasta oficial. O `clasp` não executa as funções nem instala gatilhos.
4. Como alternativa ao `clasp`, copie os arquivos de `apps-script-v2/` manualmente, inclusive `appsscript.json`, `Config.gs`, `ReportsSetup.gs`, `Preflight.gs`, os validadores `ChecklistValidation.gs`, `TrainingValidation.gs`, `ManagementScoreValidation.gs` e `SparkReportSync.gs`. O pacote não contém o consumidor legado `syncQueue`.
5. O projeto usa os escopos OAuth declarados no manifesto: Firestore REST (`datastore`), Sheets, Drive, requisições externas e gatilhos. Revise o manifesto antes de autorizar.
6. Antes de aprovar o destino ou executar qualquer função, conclua a revisão de IAM da seção 3 e confirme a identidade executora e suas permissões efetivas. Não use uma conta com papel amplo herdado como substituto do papel mínimo.
7. Somente depois dessa revisão, nas **Propriedades do script**, defina `SAHMT_V2_REPORTS_DESTINATION_APPROVED` como `YES` após confirmar que pasta e planilha estão restritas.
8. Execute `setupSahmtV2Reporting`. Ele verifica a privacidade/localização, valida cabeçalhos antes de alterar abas e guarda o ID da planilha nas propriedades do script. O setup não instala gatilhos.
9. Execute `verifySahmtV2ExecutorReadOnly`. Esta checagem consulta no máximo um documento da coleção `stations` projetando apenas `id`, verifica a pasta/planilha privadas e os cabeçalhos das abas. Retorna somente resultados de status e se existe ao menos uma estação; não mostra conteúdo nem altera Firestore, planilha, propriedades ou gatilhos. Se falhar, corrija o acesso indicado antes de homologar dados fictícios.

## 3. Revisar acesso Firestore/IAM

Os gatilhos executam como a conta que os instalou. Ela precisa consultar e atualizar os dados usados pelos validadores e consultar os dados projetados para relatórios. OAuth/IAM do Apps Script acessa Firestore fora das Rules do cliente. Esta revisão deve ocorrer antes de definir a propriedade de aprovação, executar `setupSahmtV2Reporting` ou qualquer validador/instalador.

O worker usa `runQuery`/`get` e commits de criação/atualização. Como base para um papel customizado, a documentação Firestore mapeia esses métodos a `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create` e `datastore.entities.update`; o código atual não chama endpoints de exclusão. Pode-se vincular esse papel no projeto com a condição `resource.name == "projects/sahmt-17a16/databases/(default)"`, que limita o acesso ao banco `(default)`. A condição e o papel **não limitam coleções ou documentos**: a conta ainda poderia ler/alterar qualquer dado desse banco pela API REST, fora das Rules. Não tratar projeções/máscaras no código como barreira IAM.

Antes de conceder acesso, o administrador do Google Cloud deve conferir as permissões efetivas e os vínculos herdados do principal: um papel `Owner`, `Editor` ou outro papel amplo não é reduzido pela adição de um papel customizado. Preferir uma conta executora dedicada, sem esses vínculos amplos, com acesso de edição somente à pasta/planilha necessárias e o papel Firestore customizado condicionado ao `(default)`. Se essa separação ou o limite de acesso a todo o banco não forem aceitáveis, manter os gatilhos desativados. Não usar chave de service account, não enviar credenciais aqui e não instalar gatilhos até a revisão e a autorização da conta executora.

**Conferência em 27/09/2026:** a política IAM do projeto retornou `roles/owner` diretamente para a conta proprietária que está conectada ao Firebase CLI e criou o projeto Apps Script. Portanto, executar os gatilhos sob essa conta manteria acesso amplo ao projeto, mesmo que um papel customizado mais estreito fosse adicionado. A [documentação de IAM](https://docs.cloud.google.com/iam/docs/roles-overview) classifica Owner como papel básico amplo, e o [acesso REST ao Firestore](https://docs.cloud.google.com/firestore/native/docs/security/iam) é controlado por IAM fora das Rules do PWA. A revisão de IAM não está concluída; antes de ativar os gatilhos, é necessário definir uma identidade executora separada e verificar seus vínculos efetivos, ou aceitar expressamente esse alcance. Nenhuma permissão foi alterada nesta conferência.

## 4. Homologar antes dos gatilhos

Use dados fictícios e confira idempotência/replay, conflito e falha para cada fluxo:

- Checklist: pedido incompleto/completo, substituto, alteração da revisão e repetição.
- Treinamentos: abaixo/acima de 95%, intervalos inconsistentes, tempo insuficiente, perfil inválido e lançamento repetido. O navegador controla faixas e sinal de encerramento; a validação não prova que o vídeo foi assistido.
- Gestão: aprovação por gestor autorizado, tentativa de autoaprovação, recusa justificada, claim divergente e repetição.
- Relatórios: projeção de campos aprovada, upsert repetido, cursor, atraso e revarredura.

Após IAM e homologação, instale apenas os gatilhos Spark necessários: `installChecklistValidationTrigger`, `installTrainingValidationTrigger`, `installManagementScoreValidationTrigger` e `installSahmtV2SparkReportTrigger`. Eles varrem o Firestore periodicamente; o PWA não espera por eles. O handler/instalador legado `syncQueue` foi removido do pacote V2 e não deve ser recriado.

## Estado já preparado

- A PWA publicada usa o Firebase `sahmt-17a16` e o Firestore `(default)`.
- Rules e 35 índices compostos estão publicados e `READY`; o primeiro perfil foi provisionado pelo proprietário.
- A planilha existe e suas oito abas/cabeçalhos V2 foram conferidos.
- O projeto `SAHMT V2.0 – Integração Spark` foi criado na pasta oficial. O pacote V2 já havia sido enviado via `clasp` sem `FirestoreSync.gs` ou handlers `syncQueue`. Em 26/09/2026, a checagem somente leitura foi enviada e um `clasp pull` isolado confirmou conteúdo correspondente nos oito arquivos remotos (manifesto e sete fontes), sem os handlers legados. A API Apps Script da conta permite a sincronização via `clasp`; isso não concede IAM Firestore nem autoriza a execução OAuth do script. Nenhuma função foi executada. IAM, autorização de runtime, propriedades do script, homologação fictícia e instalação de gatilhos continuam pendentes.
- A consulta de faturamento em 26/09/2026 indicou `billingEnabled=false`; o plano Spark mantém ativa a operação base. A callable opcional de leitura por IA não pode ser implantada nesse estado. Qualquer mudança para Blaze deve ser uma decisão explícita do proprietário, considerando custos e cotas.
