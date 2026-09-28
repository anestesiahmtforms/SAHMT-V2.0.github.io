# SAHMT V2.0

Reconstrução técnica do PWA SAHMT: um único shell mobile-first, Firebase Authentication como sessão única e Firestore como fonte operacional V2. A V1 permanece intacta.

## Modelo

- O UID do Firebase Authentication identifica o perfil mínimo em `users/{uid}`; as Firestore Rules conferem perfil e permissão a cada acesso do cliente.
- Home, Eventos, Etiquetas, Gestão, Checklist, Treinamentos, Administração e sincronização offline permanecem dentro do mesmo PWA. Administradores também controlam sem código a visibilidade dos módulos configuráveis.
- Firebase Auth e Firestore Rules continuam autenticando e autorizando o PWA. ESCALA/FÉRIAS tem uma planilha privada como fonte de autoria; o Apps Script V2 publica manualmente snapshots validados no Firestore. O PWA não grava posições da escala nem acessa Sheets por chamadas de dados. Os demais registros operacionais seguem gravações diretas autorizadas no Firestore.

## Estado atual — 28/09/2026

- O PWA está publicado em [SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/). O commit [`cc6fc6f`](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/commit/cc6fc6f08a1915fcfee0946c287b9b4179ad9dce) passou no workflow [36494925745](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36494925745), que executou testes de domínio, Rules, Functions Emulator, build e deploy.
- Firebase Authentication e Firestore são a sessão e o modelo operacional V2. O primeiro perfil administrador foi provisionado pelo proprietário, que confirmou entrada na Home autenticada.
- No Firestore foram verificados 307 dias de escala e 51 períodos de férias válidos publicados; `BA` na semana de 23–29/03 foi confirmado pelo proprietário e a semana de `CONGRESSO` fica sem férias por contingência. A planilha privada ESCALA/FÉRIAS segue como fonte de autoria; o PWA não grava posições de escala nem acessa Sheets diretamente.
- Os catálogos verificados incluem 28 estações do Checklist (23 ativas, 5 inativas), 30 siglas ativas de Etiquetas, 31 contatos ativos após a atualização dos cinco campos e 31 projeções mínimas para Eventos, além de quatro treinamentos. A ordem sugerida para as estações ainda requer conferência visual.
- As Rules estão publicadas. A API Firestore confirmou 37 índices `READY` em 27/09/2026; a consulta atual do Firebase CLI lista 39 definições, mas não informa o estado de construção desses 39. O PWA grava os fluxos operacionais autorizados diretamente no Firestore. Consumidores Apps Script para validações assíncronas e espelhamento de relatórios seguem inativos enquanto a revisão IAM e a homologação não forem concluídas.
- A callable opcional `readLabelImage` não está implantada. Ela depende da decisão do proprietário sobre faturamento Blaze, configuração privada do segredo `OPENAI_API_KEY`, App Check para o domínio e implantação da função. Não envie a chave no chat nem a inclua no frontend ou GitHub; veja o passo a passo em [`docs/OWNER_SETUP.md`](docs/OWNER_SETUP.md).
- A homologação de gravações reais por módulo, a conferência visual em aparelhos Android/iOS e algumas decisões sobre os registros V1 remanescentes continuam pendentes; os limites atuais estão detalhados em [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md).

A carga inicial de catálogos foi feita por API administrativa do Firebase, que não executa Security Rules do cliente; a autoria lógica e o limite desse procedimento estão registrados em [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md). As gravações normais devem ocorrer pela sessão do PWA.

## Documentação

Inventário V1, paridade, arquitetura, esquema, segurança, sincronização, implantação e plano estão em [`docs/`](docs/).

As ações do proprietário necessárias para liberar Functions e o consumidor seguro do Drive estão descritas passo a passo em [`docs/OWNER_SETUP.md`](docs/OWNER_SETUP.md). Nenhuma credencial deve ser enviada.

## Desenvolvimento local

`npm ci`

`npm run dev`

`npm run build`

`npm run test:domain`

`npm run test:rules`

`npm run validate:catalog-preview` valida somente a prévia local ignorada pelo Git; não escreve dados no Firebase.

`npm run validate:user-contact-preview` valida a prévia local de usuários/contatos sem imprimir dados pessoais nem atribuir UID, role ou permissão V2; também não escreve no Firebase.

Para conferir manualmente a prévia sem importar nada, abra a [ferramenta de revisão dos catálogos](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/tools/catalog-review.html) ou a cópia [`tools/catalog-review.html`](tools/catalog-review.html), selecione `.local-preview/catalog-import-preview.json`, revise estações, treinamentos, escala e férias e baixe `catalog-review-decisions.json`. A ferramenta mantém os dados da prévia somente no navegador e exporta as marcações de revisão; o arquivo de decisões não importa nem aprova automaticamente registros. O código hospedado não contém a prévia privada.

Para conferir a prévia privada de usuários/contatos, abra [`tools/user-contact-review.html`](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/tools/user-contact-review.html) ou a cópia local [`tools/user-contact-review.html`](tools/user-contact-review.html), e selecione `.local-preview/user-contact-import-preview.json` deste checkout. A página hospedada também só lê o arquivo escolhido pelo navegador: guarda UIDs e decisões no armazenamento local e exporta referências por linha sem nomes, e-mails ou telefones. Não usa permissões V1, não define role/acesso V2 e não grava em Firebase; apague as decisões locais ao terminar.

## Validação pendente

Login confirma Auth → perfil UID → Home. Consultas e gravações autenticadas por módulo, fluxos offline em dispositivo, conferência da ordem das estações e comparação visual interna em Android/iPhone ainda precisam de homologação.
