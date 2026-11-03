# Central de Notificações SAHMT V2 — Push manual

Esta implementação adiciona **apenas envio manual pelos administradores** à estrutura existente de comunicados `notifications`. Não cria gatilhos de envio automático.

## Publicação necessária
1. No projeto Firebase **FA** (`sahmt-17a16`), habilitar Cloud Messaging/Web Push e criar uma chave VAPID pública.
2. Definir `VITE_SAHMT_WEB_PUSH_VAPID_KEY` no ambiente de build do GitHub Pages. A chave VAPID pública pode ser incluída no bundle; **nunca** publicar a chave privada, service-account ou credenciais do Firebase Admin.
3. Implantar Cloud Functions do projeto FA (`registerSahmtPushDevice`, `unregisterSahmtPushDevice`, `sendSahmtManualNotification`) usando a configuração atual de `firebase.json`. Não implantar estas funções no projeto FB sem adaptação.
4. Publicar o bundle/PWA e o `service-worker.js` em conjunto. O cache do shell foi incrementado para v293.
5. Testar com iPhone (PWA instalado na tela inicial e iOS compatível), Android e desktop, sempre concedendo permissão mediante toque no botão.
6. Testar autorização negativa: usuário não administrador não pode chamar o envio, inclusive diretamente pela API.
7. Testar o envio de um comunicado de baixa prioridade com público USER antes de qualquer mensagem para ALL.

## Fluxo
- Usuário autenticado e ativo toca em **Ativar notificações neste aparelho**, concede permissão e registra seu token FCM vinculado ao UID na coleção `sahmtPushDevices`.
- Administrador publica um comunicado no formulário **INFORMAÇÕES**, como já fazia.
- Administrador clica **Enviar Push**, confirma e a Cloud Function revalida o ator, o comunicado publicado, a audiência e os perfis dos destinatários.
- A função registra status e totais de envio no documento do comunicado. Não reenvia o mesmo comunicado automaticamente.
- O service worker exibe a notificação e abre a rota selecionada ao toque.
- Os registros de token não possuem regra de leitura cliente; só a função Admin SDK os acessa.

## Limitações atuais
- Audiência MANAGEMENT_AREA não recebe Push nesta versão; o comunicado continua existindo.
- Não há agendamentos, reenvio, automações ou relatório de leitura/entrega confirmado pelo aparelho.
- O resultado `delivered` representa a aceitação pelo FCM, **não** a confirmação de exibição pelo sistema operacional.
- O envio manual foi limitado a 120 segundos. Audiências muito grandes precisarão de uma fila assíncrona com paginação e deduplicação de mensagens.
- Se a função falhar após o início, não tente repetir manualmente sem inspecionar `pushStatus`, pois parte dos destinatários pode já ter recebido.
- O botão de opt-in precisa ser usado novamente quando o token do navegador for substituído; a primeira versão não inclui atualização periódica de tokens ou revogação visível na UI.
- Informações de pacientes e dados pessoais sensíveis não devem ser enviados por push, pois a prévia pode aparecer na tela bloqueada.
- A disponibilidade e o formato dos banners dependem das permissões e configurações do aparelho.

## Verificações antes do merge
- Executar `npm ci && npm run build` na configuração FA, e os testes de regressão existentes.
- Testar a implantação em homologação com um administrador e um usuário comum.
- Confirmar índices e custos de Firestore/FCM; não há listener permanente de Firestore adicionado pelo push.
