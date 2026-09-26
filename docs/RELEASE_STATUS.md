# SAHMT V2.0 — relatório de release e limites

## Artefato publicado

- Repositório oficial: [SAHMT-V2.0.github.io](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io), branch `main`.
- Commit do código publicado: `17320fa030ab819843334cb9c8d5cc905930986f`.
- Aplicação pública: [abrir SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/).
- [Workflow de build e publicação](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36208734098): build, testes e deploy concluídos com sucesso para o commit acima. Após o deploy, a página respondeu HTTP 200 e o HTML servido coincidiu com `dist/index.html`. O service worker `v21` e os quatro símbolos do shell retornaram HTTP 200; o símbolo Operacional tem 7.983 bytes.

## O que foi validado

- `npm run test:domain`: 61/61 testes passaram.
- `npm run test:rules`: 35/35 casos passaram no Firestore Emulator.
- Testes das Cloud Functions: 15/15 passaram no Emulator, incluindo assinatura do Checklist, treinamento e operações de Gestão.
- `npm run build`: build Vite concluído com 334 módulos transformados. O SDK completo do Firestore (550,77 kB bruto) e o PDF (419,34 kB) são carregados em chunks dinâmicos; o Vite mantém o aviso para o chunk Firestore acima de 500 kB.
- Os testes usaram o projeto fictício `demo-sahmt-v2`; não leram nem gravaram dados do projeto Firebase real.
- A tela pública observada é a entrada/login. Não houve login real, gravação de dados nem homologação de fluxos autenticados em aparelho.

## Modelo V2 entregue

Firebase Authentication resolve a identidade uma vez; o UID identifica `users/{uid}` e as Firestore Rules autorizam as operações. A PWA usa um único shell, sessão e fonte operacional Firestore. Apps Script/Sheets não participam da autenticação nem das gravações e o worker lateral foi removido. Templates genéricos de Etiquetas sem registros ou contrato na V1 também foram removidos; permanecem as opções de tipo e campos condicionais definidos no formulário. A V1 não foi alterada.

O inventário de V1 e os documentos de arquitetura, esquema, sincronização, segurança e paridade estão em [`docs/`](./). O plano corrente está em [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Limites e próximos portões

- **Conta Firebase:** verificação local atual com `firebase login:list` não encontrou conta autorizada; `firebase projects:list --json` falhou por autenticação. Não foi possível conferir ou operar o projeto real nesta sessão.
- **Rules, índices e Functions de produção:** ainda não publicados. Sucesso no Emulator/Pages não os publica nem valida.
- **Homologação real:** login Google autorizado, perfil inicial por UID, Firestore online, offline/retry e escrita controlada continuam pendentes.
- **Migração:** o preview local é somente leitura e exige conferência manual de 423 registros e 8 itens globais. Origem/destino, ordem, autoria, UIDs e totais precisam de aprovação antes de importar.
- **UI e dispositivos:** comparação interna tela a tela, câmera OCR/QR e layout PDF em Android/iPhone continuam pendentes.
- **Templates:** a V1 inspecionada não contém uma coleção de modelos reutilizáveis; não se afirma paridade de tal catálogo.

Não considerar o release homologado para uso operacional até que Rules/índices sejam revisados e publicados no Firebase correto e os fluxos sejam testados com uma conta autorizada.
