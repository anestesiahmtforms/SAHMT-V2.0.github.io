# SAHMT V2.0

Reconstrução técnica do PWA SAHMT: um único shell mobile-first, Firebase Authentication como sessão única e Firestore como fonte operacional V2. A V1 permanece intacta.

## Modelo

- O UID do Firebase Authentication identifica o perfil mínimo em `users/{uid}`; as Firestore Rules conferem perfil e permissão a cada acesso do cliente.
- Home, Eventos, Etiquetas, Gestão, Checklist, Treinamentos, Administração e sincronização offline permanecem dentro do mesmo PWA. Administradores também controlam sem código a visibilidade dos módulos configuráveis.
- Firebase Auth e Firestore Rules continuam autenticando e autorizando o PWA. ESCALA/FÉRIAS tem uma planilha privada como fonte de autoria; o Apps Script V2 publica manualmente snapshots validados no Firestore. O PWA não grava posições da escala nem acessa Sheets por chamadas de dados. Os demais registros operacionais seguem gravações diretas autorizadas no Firestore.

## Estado atual — 27/09/2026

- GitHub Pages está publicado em [SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/); o commit `608aa35` atualizou a documentação da fonte ESCALA/FÉRIAS e o workflow [36328683306](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36328683306) concluiu com sucesso.
- O primeiro perfil administrador foi provisionado e o proprietário confirmou entrada na Home autenticada.
- Firestore contém o catálogo de Etiquetas com 30 siglas ativas, o catálogo Checklist com 28 estações (23 ativas, 5 inativas), 31 contatos (30 ativos e um inativo), 31 projeções mínimas de membros para Eventos e 307 dias da escala V1. A ordem das estações segue a posição sugerida pela planilha V1 e ainda precisa de conferência visual.
- Rules estão publicadas e os 35 índices aparecem como `READY` em 26/09/2026. Cloud Functions de produção não estão implantadas; dependem de revisão de faturamento e autorização do proprietário.
- A planilha privada ESCALA/FÉRIAS é a fonte de autoria. A consulta de 27/09 confirmou que os 307 dias de escala no Firestore coincidem com a aba `ESCALA`. A aba `FÉRIAS` contém 51 períodos aprovados com siglas; `BA` na semana de 23–29/03 foi confirmado pelo proprietário, e a semana de `CONGRESSO` não tem férias por contingência. Esses períodos ainda não foram publicados no Firestore: a execução da prévia Apps Script foi recusada por permissão. Nenhum dado de treinamento, resposta ou assinatura do Checklist foi importado.

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
