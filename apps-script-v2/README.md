# Apps Script V2 · relatórios assíncronos

Este script é um consumidor de relatório. Ele não faz login, não autoriza pessoas, não lê `users`/permissões, não recebe tokens Firebase e não atende chamadas do PWA. A sessão e as operações continuam em Firebase Auth + Firestore; falha na planilha nunca impede a confirmação do Firestore.

Triggers server-side em Cloud Functions criam `syncQueue/{jobId}` após mudanças em `events`, `checklists`, `trainings`, `trainingReceipts`, `trainingCompletions`, `activities`, `activityInteractions`, `indicators`, `indicatorMeasurements`, `actionPlans`, `actionPlanItems`, `scores` e `auditLogs`. O job contém somente tipo/ID/operação/versão e estado de retry; o script lê a versão atual e grava colunas explicitamente permitidas. Não há trigger para `users`, `trainingProgress` ou `labels`.

O script prepara as abas `CHECKLIST`, `EVENTOS`, `TREINAMENTOS`, `GESTAO_ATIVIDADES`, `GESTAO_INDICADORES`, `GESTAO_PLANOS_ACAO`, `PONTUACOES` e `AUDITORIA`. O relatório genérico de Indicadores fica consolidado com Gestão de Indicadores; não há aba `USUARIOS`, pois o perfil V2 pertence somente ao Firestore. Etiquetas permanece fora da fila e da exportação: o formulário contém dados assistenciais identificáveis. A aba `Etiquetas Resumo` da planilha é apenas reservada; nenhum agregado é produzido até existir projeção resumida aprovada e implementada. Os relatórios de Etiquetas seguem disponíveis na PWA/Firestore.

## Preparação manual

1. Confira no Drive quem consegue abrir a pasta oficial `APP SAHMT-V2.0`. Se a pasta ou a planilha estiver acessível por link ou compartilhada amplamente, restrinja o acesso antes de continuar.
2. Crie um projeto Apps Script V2 nessa pasta e copie os arquivos deste diretório, inclusive `appsscript.json`. O setup procura uma única planilha de mesmo nome na pasta oficial e a reutiliza; só cria uma quando ainda não há nenhuma. Se encontrar duplicatas, interrompe sem criar outra.
3. Depois de revisar o compartilhamento da pasta e do destino, defina `SAHMT_V2_REPORTS_DESTINATION_APPROVED=YES` em **Propriedades do script**. Sem essa confirmação o setup permanece bloqueado.
4. Execute `setupSahmtV2Reporting` pela conta proprietária. Ela confirma pasta e planilha privadas e que o arquivo está na pasta oficial, valida todos os cabeçalhos existentes antes de alterá-los, cria as abas/cabeçalhos/filtros/formatos e guarda somente o ID da planilha em Script Properties. Ela não cria o gatilho de execução.
5. O Apps Script usa OAuth da conta proprietária para consultar Firestore REST com o escopo `datastore`, em vez do escopo geral `cloud-platform`; os métodos usados pelo consumidor ([`runQuery`](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery), [`get`](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/get) e [`commit`](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit)) aceitam esse escopo. A API IAM ignora Firestore Rules; uma função IAM customizada ainda concede leitura/listagem por projeto/database e atualização de jobs, não por coleção. Revise cuidadosamente o usuário executor e o escopo desse acesso antes de autorizar. Não armazene chave de service account no script.
6. As Rules já negam acesso cliente a `syncQueue`; o índice local `status + nextAttemptAt` atende à consulta da fila. As Cloud Functions ainda precisam de billing Blaze e deploy autorizado. Após o deploy, valide leitura e upsert controlados antes de instalar `installSahmtV2SyncTrigger`.

## Operação e recuperação

- `syncPendingReports` lê até 40 jobs pendentes vencidos a cada execução do trigger de cinco minutos, sob `ScriptLock`.
- `syncKey = tipo/ID` torna upsert repetido idempotente. O script relê o estado atual do Firestore, então um job atrasado não deve aplicar um snapshot antigo. Exclusão só remove a linha se o documento realmente não existir; se ele foi recriado, a linha atual é atualizada.
- A leitura `get` usa `mask.fieldPaths` com somente os campos da aba de destino, mais `id` e `version` necessários para validar o job. Campos fora da projeção da planilha não são retornados ao Apps Script; isso reduz exposição acidental, mas não limita a permissão IAM do executor.
- Falhas usam backoff exponencial; depois de oito tentativas o job fica `error` para inspeção. O script não altera nem remove registros operacionais.
- A IAM usada por Firestore REST contorna Rules. A verificação de pasta/planilha privada protege o destino, mas não restringe o alcance da leitura IAM; trate o proprietário do script como operador privilegiado do projeto.
- O código local ainda não foi copiado para um projeto Apps Script, autorizado ou implantado. A planilha e o worker não estão ativos.
