# Continuidade remota operacional

O código preserva autenticação FA e as permissões existentes. Worker/SQLite guardam a última cópia verificada e os registros recebidos. Não há dados operacionais nem segredos adicionados ao GitHub.

## Funcionamento

- Sem cache local, o Firebase Authentication identifica o mesmo UID e o Worker devolve somente seu perfil previamente validado, os catálogos permitidos e sua própria fila.
- O perfil conserva a data original de verificação, com validade máxima de sete dias. Recuperar a cópia não renova essa validade. Contas novas precisam de validação real; não existe cadastro fictício de emergência.
- Eventos, Etiquetas, Checklist e Liberar entram primeiro na fila local e depois no canal com ID estável. Somente o recebimento confirmado pelo canal protege contra perda do armazenamento do aparelho. Sem internet, o registro continua dependendo do aparelho.
- A recuperação de registros remotos é automática. Envio ao Firestore exige perfil e permissão atuais. Registros exclusivamente locais conservam sua confirmação manual anterior.
- O conciliador reserva o registro antes de gravá-lo. Enquanto a conciliação está em andamento, retirada ou substituição fica bloqueada para evitar corrida. Confirmação, retirada, substituição e conflito são preservados no servidor.
- O conciliador processa até dez itens por execução. Fila vazia e nenhuma alteração de fonte pendente significam zero leituras Firestore. HTTP 429 pausa tentativas por uma hora.
- A primeira carga é limitada e única. Havendo falha ao importar, ela retoma de um arquivo privado sem reler o Firestore. Erros permanentes bloqueiam a carga, evitando varreduras repetidas.
- Alterações confirmadas no app atualizam a cópia mediante prova do documento. Gravações Apps Script em lote colocam somente os caminhos alterados na fila; são consultados até dez caminhos por execução, sem varredura periódica de coleções.
- Confirmação provisória não equivale a pontuação oficial nem a conclusão definitiva da conferência.

## Instalação autorizada

`npm run prepare:remote-continuity` prepara o pacote local. O instalador `scripts/install-remote-continuity.mjs` aceita `worker`, `script`, `activate` e `status`. Usa a sessão autenticada existente e armazena chave e recuperação fora do Git, em `%LOCALAPPDATA%\SAHMT\remote-continuity-v1`.

O Worker é conferido inicialmente com a extensão desligada, preservando as duas namespaces e o canal existente. O Apps Script preserva todos os arquivos/manifesto, adiciona o núcleo e o sincronizador, e adapta somente o despacho autenticado e o gancho pós-gravação. A primeira carga deve aguardar a renovação da cota. A publicação do código não comprova que a carga terminou: conferir `seedReady=true` no status privado e testar um aparelho autenticado.

## Reversão

Desligar `VITE_OPERATIONAL_CONTINUITY_ENABLED` no build e `OPERATIONAL_CONTINUITY_ENABLED` no Worker. Executar `desativarSincronizadorCanalRemotoV1` para remover somente seu acionador. Preservar namespaces, filas e arquivo privado até reconciliar todas as pendências. A recuperação privada contém o código/configuração anterior do Worker e os arquivos/implantações anteriores do Apps Script. Não apagar dados remotos para reverter código.

## Custos e limites

Não altera planos, IAM, Rules ou faturamento. SQLite Durable Objects funcionam em Workers Free. Os limites gratuitos continuam válidos; excedê-los pode interromper o canal. Firebase Authentication continua necessário e a reconciliação posterior consome leituras/gravações normais da cota Firestore. Cache remoto não substitui os serviços de autenticação nem garante funcionamento após sua indisponibilidade.
