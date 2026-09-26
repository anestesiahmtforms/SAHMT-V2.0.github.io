# SAHMT V2.0

Reconstrução técnica do PWA SAHMT: um único shell mobile-first, Firebase Authentication como sessão única e Firestore como fonte operacional V2. A V1 permanece intacta.

## Modelo

- O UID do Firebase Authentication identifica o perfil mínimo em `users/{uid}`; as Firestore Rules conferem perfil e permissão a cada acesso do cliente.
- Home, Eventos, Etiquetas, Gestão, Checklist, Treinamentos, Administração e sincronização offline permanecem dentro do mesmo PWA.
- A V2 não usa Sheets ou Apps Script para autenticar nem para gravar operações. Uma integração assíncrona de relatórios está preparada no código, mas não implantada.

## Estado atual — 26/09/2026

- GitHub Pages está publicado em [SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/); o último workflow de documentação concluiu com sucesso.
- O primeiro perfil administrador foi provisionado e o proprietário confirmou entrada na Home autenticada.
- Firestore contém o catálogo de Etiquetas com 30 siglas ativas e o catálogo Checklist com 28 estações (23 ativas, 5 inativas). A ordem das estações segue a posição sugerida pela planilha V1 e ainda precisa de conferência visual.
- Rules estão publicadas e os 29 índices aparecem como prontos. Cloud Functions de produção não estão implantadas; dependem de revisão de faturamento e autorização do proprietário.
- Não foram importados escala, férias, contatos pessoais, treinamentos, respostas ou assinaturas do Checklist. A Home pode continuar sem escala publicada até a revisão e migração desses dados.

A carga inicial de catálogos foi feita por API administrativa do Firebase, que não executa Security Rules do cliente; a autoria lógica e o limite desse procedimento estão registrados em [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md). As gravações normais devem ocorrer pela sessão do PWA.

## Documentação

Inventário V1, paridade, arquitetura, esquema, segurança, sincronização, implantação e plano estão em [`docs/`](docs/).

## Desenvolvimento local

`npm ci`

`npm run dev`

`npm run build`

`npm run test:domain`

`npm run test:rules`

`npm run validate:catalog-preview` valida somente a prévia local ignorada pelo Git; não escreve dados no Firebase.

## Validação pendente

Login confirma Auth → perfil UID → Home. Consultas e gravações autenticadas por módulo, fluxos offline em dispositivo, conferência da ordem das estações e comparação visual interna em Android/iPhone ainda precisam de homologação.