# Ações do proprietário para concluir a ativação

Este guia cobre somente os passos que dependem do proprietário do projeto. **Não envie senhas, códigos de login, tokens, chaves de API nem arquivos JSON de conta de serviço.** A sessão Firebase CLI já está autenticada localmente.

## Firebase Functions

Estado conferido em 26/09/2026: o projeto é `sahmt-17a16`; Firestore, Rules e índices existem. A Cloud Functions API retorna `403 SERVICE_DISABLED` e o projeto ainda não tem uma conta Cloud Billing vinculada. O deploy de Functions exige o plano Blaze; vincular a conta muda o projeto para cobrança conforme uso. A documentação oficial informa que Functions usa serviços pagos e recomenda acompanhar custos; alertas de orçamento notificam, mas não limitam automaticamente a cobrança. [Requisitos de deploy](https://firebase.google.com/docs/functions/get-started), [planos Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) e [alertas/controles](https://firebase.google.com/docs/projects/billing/advanced-billing-alerts-logic).

1. Abra [Firebase Console do SAHMT](https://console.firebase.google.com/project/sahmt-17a16/overview) e confirme que o projeto selecionado é `sahmt-17a16`.
2. Em **Configurações do projeto → Uso e faturamento**, revise a opção de mudar para **Blaze**. A tela pedirá uma conta de faturamento Google Cloud. Confira os dados e as condições de cobrança antes de concluir; essa vinculação é uma decisão financeira do proprietário.
3. Configure alertas de orçamento e, se disponíveis para Cloud Functions no Console, revise também os limites de gasto. Alertas comuns não são teto de cobrança.
4. Habilite a [Cloud Functions API para `sahmt-17a16`](https://console.developers.google.com/apis/api/cloudfunctions.googleapis.com/overview?project=sahmt-17a16). Confira novamente o ID do projeto antes de habilitar.
5. Quando terminar, basta avisar: **“Blaze vinculado e Cloud Functions API habilitada”**. Não envie recibos, números de cartão nem credenciais.

Depois dessa confirmação, eu verifico a propagação, reviso os serviços que o CLI solicitar (como Cloud Build e Artifact Registry) e, com a autorização de publicação já dada, implanto somente as Cloud Functions V2 neste projeto e valido o estado implantado. Não é necessário executar comandos nem copiar chaves.

## Pasta e planilha de relatórios no Drive

Leitura de metadados do Drive em 26/09/2026 confirmou `anyone: reader` tanto na pasta `APP SAHMT-V2.0` quanto em `SAHMT V2.0 - BASE DE RELATÓRIOS`. O consumidor Apps Script bloqueia a ativação quando qualquer uma delas está pública.

1. Abra a [pasta oficial no Drive](https://drive.google.com/drive/u/0/folders/1sL1NPK-CkZHmWJO_39MLajU-VpJIOZ74).
2. Selecione **Compartilhar → Acesso geral → Restrito**. Mantenha apenas os colaboradores explicitamente autorizados.
3. Abra a [planilha de relatórios](https://docs.google.com/spreadsheets/d/1I4FO9iNIFXot8O2p4GI6St76Qu_pznO8iSdyzt65E64/edit) e aplique a mesma configuração: **Compartilhar → Acesso geral → Restrito**.
4. Avise quando concluir. Eu releio os metadados para confirmar a restrição antes de configurar o Apps Script.

Essa alteração pode retirar o acesso de quem dependia somente do link público; adicione previamente as pessoas que ainda precisam acessar. A aba `Etiquetas Resumo` continua sem integração, e nenhum dado de Etiquetas será espelhado.

## O que já está pronto

- A PWA está publicada em [SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/).
- O projeto Firebase existente e o Firestore `(default)` são usados; não foi criado projeto ou banco alternativo.
- O primeiro perfil foi provisionado pelo proprietário e o login até a Home foi confirmado.
- As Rules e os 32 índices foram publicados; os catálogos iniciais de 30 siglas e 28 estações foram semeados.
- A planilha de relatórios já existe, suas oito abas V2 e cabeçalhos foram conferidos, e o setup Apps Script recusa uma planilha pública ou fora da pasta oficial.

## Fontes oficiais

- [Implantar Cloud Functions for Firebase](https://firebase.google.com/docs/functions/get-started)
- [Planos de preços Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Alertas e controles de gasto](https://firebase.google.com/docs/projects/billing/advanced-billing-alerts-logic)
