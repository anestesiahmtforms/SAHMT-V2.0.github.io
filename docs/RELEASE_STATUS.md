# SAHMT V2.0 — relatório de release e limites

## Artefato publicado

- Repositório oficial: [SAHMT-V2.0.github.io](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io), branch `main`.
- Commit mais recente publicado: `c448286ca43887e4b0b2860e6d75e8b72aa61eb6` (inclui a integração de relatórios assíncronos preparada localmente).
- Aplicação pública: [abrir SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/).
- [Workflow de build e publicação do código V2](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36209596068): build, testes e deploy concluídos com sucesso para o commit acima. Após o deploy, a página respondeu HTTP 200; o service worker `v22` e os quatro símbolos do shell retornaram HTTP 200. O teste de instalação offline confirmou o precache dos imports estáticos e símbolos e a preservação do cache de férias.
- O workflow do commit mais recente [concluiu build e deploy](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36213411544) em 26/09/2026; GitHub Pages respondeu HTTP 200.

## O que foi validado

- `npm run test:domain`: 64/64 testes passaram.
- `npm run test:rules`: 35/35 casos passaram no Firestore Emulator.
- Testes das Cloud Functions: 15/15 passaram no Emulator, incluindo assinatura do Checklist, treinamento e operações de Gestão.
- `npm run build`: build Vite concluído com 334 módulos transformados. O SDK completo do Firestore (550,77 kB bruto) e o PDF (419,34 kB) são carregados em chunks dinâmicos; o Vite mantém o aviso para o chunk Firestore acima de 500 kB.
- Os testes usaram o projeto fictício `demo-sahmt-v2`; não leram nem gravaram dados do projeto Firebase real.
- O proprietário provisionou `users/{uid}` no Console e confirmou login Google imediato no PWA publicado em 26/09/2026. A captura mostra a Home autenticada; o calendário informa que não há escala publicada na data consultada. Isso confirma Auth → perfil UID → shell, mas não prova disponibilidade de dados migrados nem operações do módulo.

## Modelo V2 entregue

Firebase Authentication resolve a identidade uma vez; o UID identifica `users/{uid}` e as Firestore Rules autorizam as operações. A PWA usa um único shell, sessão e fonte operacional Firestore. Apps Script/Sheets não participam da autenticação nem das gravações e o worker lateral foi removido. Templates genéricos de Etiquetas sem registros ou contrato na V1 também foram removidos; permanecem as opções de tipo e campos condicionais definidos no formulário. A V1 não foi alterada.

O inventário de V1 e os documentos de arquitetura, esquema, sincronização, segurança e paridade estão em [`docs/`](./). O plano corrente está em [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Limites e próximos portões

- **Conta Firebase:** em 25/09/2026, `firebase login:list` confirmou a sessão e `firebase projects:list` listou SAHMT `sahmt-17a16`; a CLI confirmou o Firestore `(default)`, Standard/Native.
- **Rules, índices e Functions de produção:** `firestore.rules` foi compilado e liberado; os 29 índices do manifesto foram implantados e confirmados `READY`. Functions não foram implantadas: permanecem dependentes da confirmação de Blaze/billing e autorização correspondente.
- **Homologação real:** login Google, perfil inicial e chegada à Home estão confirmados. Consultas por módulo, offline/retry, escrita controlada e validação em celular permanecem pendentes.
- **Migração:** o preview local é somente leitura e exige conferência manual de 423 registros e 8 itens globais. Origem/destino, ordem, autoria, UIDs e totais precisam de aprovação antes de importar.
- **UI e dispositivos:** comparação interna tela a tela, câmera OCR/QR e layout PDF em Android/iPhone continuam pendentes.
- **Templates:** a V1 inspecionada não contém uma coleção de modelos reutilizáveis; não se afirma paridade de tal catálogo.

Não considerar o release homologado para uso operacional até que o novo índice de fila chegue a `READY`, Functions necessárias sejam avaliadas/publicadas e os fluxos sejam testados com uma conta autorizada. O provisionamento do primeiro perfil e o acesso ao shell já foram confirmados.
