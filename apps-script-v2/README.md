# Apps Script V2 · relatórios assíncronos

Este projeto só transporta cópias de `events`, `labels` e `checklists` do Firestore para a planilha privada de relatórios. O PWA confirma cada ação no Firestore e cria `syncQueue` no mesmo batch; Sheets nunca participa da autenticação, das consultas do usuário ou da confirmação operacional. A fila não contém o conteúdo do registro.

**Estado atual:** a pasta oficial e a planilha existente foram observadas com acesso de leitor por link, e as abas existentes não correspondem ao contrato V2. O worker bloqueia setup/sincronização enquanto pasta ou planilha não forem privadas. O setup confere todas as abas antes de qualquer alteração, recusa cabeçalhos diferentes e só grava o ID em Script Properties depois de concluir. Não habilite a propriedade de aprovação nem instale o gatilho até o responsável restringir e revisar o destino; não reutilize a planilha existente enquanto seus cabeçalhos divergirem.

## Preparação manual

1. Confira no Drive quem pode abrir a pasta oficial `APP SAHMT-V2.0`. Etiquetas incluem nome do paciente e identificadores do atendimento; não execute a configuração enquanto pasta e planilha não estiverem privadas e revisadas pelo responsável.
2. Crie um projeto Apps Script V2 nessa pasta e copie os arquivos deste diretório, inclusive `appsscript.json`.
3. Nas propriedades do script, após conferir o acesso ao destino, defina `SAHMT_V2_REPORTS_DESTINATION_APPROVED` como `YES`.
4. Execute `setupSahmtV2Reporting` pela conta Google proprietária do projeto. A função verifica o acesso da pasta e da planilha antes de configurar abas, prepara `CHECKLIST`, `ETIQUETAS` e `EVENTOS` e registra apenas o ID em Script Properties. Ela não agenda execuções recorrentes. A verificação exige `PRIVATE`; links públicos ou compartilhamentos amplos interrompem a execução.
5. O OAuth usa a conta proprietária para chamar a API Firestore REST com `cloud-platform`. Uma função IAM customizada com `datastore.entities.get`, `datastore.entities.list` e `datastore.entities.update` limita as operações, mas continua valendo para o banco/projeto concedido e o acesso REST IAM ignora Firestore Rules. Revise identidade, escopo, projeto, pasta e dados exportados antes de concedê-la.
6. Publique primeiro Rules e índice de `syncQueue` no projeto correto. Faça uma gravação controlada e confira uma linha por `syncKey`, edição na mesma linha, retry e falha recuperável. Depois execute `installSahmtV2SyncTrigger`; a função consulta a fila e só agenda o gatilho se a chamada passar.

## Operação

- `syncPendingReports` lê até 40 jobs pendentes e vencidos por execução, protegida por `ScriptLock`.
- Os dados são mapeados por listas fixas de campos; perfis, permissões, progresso individual, tokens e outras coleções não são exportados.
- A planilha atualiza por `tipo/ID`; reexecução após falha de resposta substitui a linha existente e não cria duplicata.
- Erros recebem backoff exponencial, limite de oito tentativas e estado `error`. O script não apaga nem altera o registro operacional.
- A API Firestore chamada com OAuth IAM não usa as Firestore Rules para limitar leitura. A conta de execução precisa ser confiável; não conceda acesso IAM antes da revisão do projeto, escopo, pasta e dados exportados.
- A leitura inicial em `installSahmtV2SyncTrigger` confirma que a consulta está operacional naquele momento; não substitui a revisão IAM nem um teste controlado de ponta a ponta.

O código local não foi copiado para um projeto Google, autorizado nem implantado. Esse passo depende do login Google e da revisão do destino e das permissões.
