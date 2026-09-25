# Offline e sincronização

## Fontes

Firestore é a fonte de dados online. IndexedDB sustenta cache e outbox. O código V2 implementa jobs seletivos `syncQueue` para relatórios em Sheets, mas o worker Apps Script, Rules e índice ainda não foram implantados no serviço real.

## Offline

- Cache IndexedDB separado por UID; persistir perfil mínimo, escala, contatos ativos, férias por dia, catálogos seguros e registros diários de Checklist necessários ao fluxo de inspeção. Marcar cópias locais como desatualizadas e compor a tela com ações pendentes do mesmo UID. Firestore SDK fica em cache de memória para não gravar indiscriminadamente etiquetas/dados privados em disco.
- A galeria estática Escala/Férias 2026 só baixa imagens após ação explícita. Cada resposta é gravada em `sahmt-v2-offline-schedule-v1` e conferida por nova leitura do Cache Storage antes de contar como pronta; esse cache é preservado quando a versão do shell muda. Falhas de rede, quota ou gravação ficam visíveis e não são contadas como preparadas.
- A lista de contatos contém nome, telefone e outros dados pessoais de trabalho; é limitada aos contatos ativos, particionada pelo UID e removida no logout. Etiquetas com dados de pacientes nunca entram no cache persistente nem na outbox.
- Só enfileirar ações cuja regra permita execução eventual. Assinaturas, pontos, aprovações e operações que dependem de concorrência exigem validação servidor/transação; não exibir sucesso confirmado antes da confirmação.
- Cada item da outbox tem `requestId` estável, tipo, payload validado, UID, criação, tentativas e status. Índices IndexedDB por UID e por UID+estado mantêm leitura, contagem, retry e limpeza restritos à sessão, inclusive após upgrade v2→v3. Nunca incluir token/chaves.
- Liberação de sigla pode ser registrada offline como intenção `scheduleReleases`: a interface atualiza a cópia de escala do UID e informa que ainda não foi confirmada. O ID estável coalesce toques repetidos do mesmo usuário/data/sigla para conservar só o último estado desejado. Ao voltar a rede, o cliente reabre uma transação no documento Firestore atual, reaplica o membro e recalcula o agregado de `DC`/sigla composta; as Rules continuam exigindo `scheduleWrite`. Essa fila é local→Firestore e não cria job de Sheets.
- Atualização de tentativas/estado e descarte individual recebem o UID da sessão e validam a propriedade do item dentro da transação IndexedDB; a atualização só aceita campos de retry e não pode trocar UID, requestId ou payload. Retry em lote e limpeza local também operam por UID; logout percorre o índice e remove os registros na mesma transação, sem ler a fila inteira para depois regravá-la. Contagem e listagem de estados pendentes usam uma transação por consulta, com leituras `uidStatus` limitadas ao usuário atual.
- Retry com backoff, limite de concorrência e retomada por evento `online`/abertura; sincronizações simultâneas são coalescidas por UID, sem misturar filas em troca de conta; sem polling contínuo no cliente.
- Relatórios diários do Checklist mesclam cache Firestore por UID com ações outbox não confirmadas, inclusive falhas permanentes, e mostram qual estado cada resposta possui.
- A gravação de Checklist só é autorizada quando a data coincide com o dia São Paulo do servidor. Se uma ação offline atravessar a meia-noite antes de sincronizar, as Rules a recusam; manter a falha visível para resolução/reenvio no dia atual, sem apresentá-la como confirmada.
- A tela oferece retry das operações recusadas e descarte individual com confirmação explícita para qualquer cópia ainda não confirmada. Se a data pendente diferir da data local, também oferece ir ao Checklist para uma verificação nova. A comparação local serve apenas como orientação; o cliente não decide se o registro é válido e o retry continua submetido às Rules baseadas em `request.time`.
- Ao sair da sessão, a confirmação contabiliza tanto ações operacionais na outbox quanto progresso de treinamento ainda não confirmado. Cancelar mantém a sessão e os dados locais; confirmar limpa os dados daquele UID, inclusive filas e progresso pendentes, sem afetar caches de outras contas.
- Ao atualizar o catálogo online, o progresso local pendente é sobreposto ao registro remoto e, quando a duração do vídeo corresponde, os trechos assistidos são unidos antes de gravar o cache. Se a duração mudou, a cópia local fica preservada e marcada para revisão na área Offline, que compara posição e percentual remoto/local e não oferece retry automático; o progresso não é mesclado silenciosamente com o novo vídeo.
- Se o player terminar offline após registrar pelo menos 95%, o cache local conserva um pedido de conclusão separado do progresso. Ao sincronizar as faixas, o cliente chama `completeTraining`; só a confirmação do servidor remove a ação pendente e marca o progresso concluído. Falha fica visível na área Offline para retry. O sinal de encerramento e as faixas vêm do player cliente, não de atestado antifraude do YouTube.
- O `requestId` também é o ID estável do documento Firestore, então replays nunca criam uma segunda ocorrência. Como Rules recusam um segundo `create`, o cliente confirma no servidor que o documento existente tem o mesmo `clientMutationId`, UID criador e payload antes de encerrar a fila como sincronizada; uma colisão com payload diferente continua visível como erro. Firestore não retorna um recibo original por esse fluxo. Erro permanente vai para resolução visível; não descartar silenciosamente.
- Criações de atividades da Gestão usam o mesmo ID idempotente e outbox, mas não criam job de Sheets. Etiquetas não podem entrar na outbox persistente porque contêm dados de pacientes: precisam de conexão para salvar; se a confirmação falhar, o formulário preserva os campos em memória para nova tentativa e informa que nada foi guardado no aparelho.

## Conflitos

Usar `version`/`updatedAt` e snapshot anterior. Dados de catálogo podem adotar last-write-wins por admin; registros operacionais conflitantes vão para reconciliação explícita. Não sobrescrever registro assinado ou evidência imutável.

## Integração administrativa de relatórios

- A ação operacional termina quando Firestore confirma; o app grava o recurso e um job `syncQueue` na mesma batch. Rules conferem UID, recurso, versão e timestamps pelo estado final da batch. Um Apps Script V2 pequeno processa a fila, registra tentativas/estado e faz upsert idempotente na planilha usando o ID estável do recurso.
- Qualquer espelhamento posterior é independente e não pode atrasar nem desfazer a confirmação do Firestore.
- A planilha serve para relatório, auditoria, consolidação e análise. Não é banco operacional; a PWA não consulta nem grava Sheets por clique.
- O worker usa identidade de execução do Apps Script. Não recebe token de sessão, não autentica usuários e não exporta `users`, perfis, permissões, tokens ou segredos. A fila guarda metadados, não o conteúdo do registro.
- A API REST com OAuth IAM ignora Firestore Rules; a permissão concedida precisa ser revisada no escopo do projeto/banco. O código depende de confirmar identidade, escopos/IAM, destino autorizado e implantação das Rules/índice. Não há sincronização real até isso ocorrer.
- O worker verifica `getSharingAccess()` na pasta e na planilha e só continua com ambos em `PRIVATE`; a checagem ocorre antes de setup, consulta da fila e instalação do gatilho. O destino observado atualmente permite leitura por link e tem cabeçalhos divergentes do contrato V2, então o worker permanece bloqueado até o responsável restringir e revisar o destino. Nenhum dado foi escrito nele.

## Recuperação

Retentar rede transitória; solicitar nova sessão quando token expirar; parar em permission-denied/schema mismatch; permitir retry manual após correção. Registrar requestId e causa técnica, sem dados sensíveis.
