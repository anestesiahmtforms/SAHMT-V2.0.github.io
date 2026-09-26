# SAHMT V2.0 — relatório de release e limites

## Artefato publicado

- Repositório oficial: [SAHMT-V2.0.github.io](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io), branch `main`.
- Código publicado na branch `main`; o histórico integral está no [repositório oficial](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/commits/main).
- Aplicação pública: [abrir SAHMT V2.0](https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/).
- [Workflow de build e publicação do código V2](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36209596068): build, testes e deploy concluídos com sucesso para o commit acima. Após o deploy, a página respondeu HTTP 200; o service worker `v22` e os quatro símbolos do shell retornaram HTTP 200. O teste de instalação offline confirmou o precache dos imports estáticos e símbolos e a preservação do cache de férias.
- O workflow do commit mais recente [concluiu build e deploy](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36213411544) em 26/09/2026; GitHub Pages respondeu HTTP 200.
- A correção que desabilita assinatura do Checklist sem estações foi publicada em `ffbbe1a7ba37852a0af94621fc5ce22b44c52f43`; o [workflow correspondente](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/actions/runs/36214300637) concluiu com sucesso.

## O que foi validado

- `npm run test:domain`: 64/64 testes passaram.
- `npm run test:rules`: 35/35 casos passaram no Firestore Emulator.
- Testes das Cloud Functions: 15/15 passaram no Emulator, incluindo assinatura do Checklist, treinamento e operações de Gestão.
- `npm run build`: build Vite concluído com 334 módulos transformados. O SDK completo do Firestore (550,77 kB bruto) e o PDF (419,34 kB) são carregados em chunks dinâmicos; o Vite mantém o aviso para o chunk Firestore acima de 500 kB.
- Os testes usaram o projeto fictício `demo-sahmt-v2`; não leram nem gravaram dados do projeto Firebase real.
- O proprietário provisionou `users/{uid}` no Console e confirmou login Google imediato no PWA publicado em 26/09/2026. A captura mostra a Home autenticada; o calendário informa que não há escala publicada na data consultada. Isso confirma Auth → perfil UID → shell, mas não prova disponibilidade de dados migrados nem operações do módulo.
- Em 26/09/2026, os catálogos iniciais do Firestore foram gravados e relidos: `appConfig/labelStaff` contém 30 siglas de usuários V1 ativos; `stations` contém 28 estações da prévia V1 (23 ativas e 5 inativas), com QR, vigência e ordem sugerida pela linha de origem. Nenhum dado pessoal, escala, férias, treinamento ou resposta de Checklist foi importado nessa carga.
- Essa carga administrativa foi feita pela API Firestore com a sessão OAuth da Firebase CLI, portanto as Security Rules do cliente não foram avaliadas. Os documentos registram o UID do único perfil V2 ativo como autoria. A conferência do Identity Toolkit confirmou que UID, e-mail e nome do perfil correspondem à identidade Firebase; a conta Google da CLI usada na carga é diferente. A gravação administrativa não executou Security Rules e registrou o UID desse perfil como autoria por solicitação do proprietário. Tratar a carga como seed administrativo delegado, não como escrita validada pelo cliente; gravações futuras devem ocorrer pela sessão do PWA ou por processo de migração com autoria técnica explícita.
- Em 26/09/2026, `firebase deploy --only firestore:indexes --project sahmt-17a16` publicou o índice `syncQueue(status ASC, nextAttemptAt ASC)` sem alterar dados ou Rules. A CLI confirmou o novo índice em `CREATING`; os outros 29 permaneciam `READY` na mesma consulta. A conclusão da construção ainda precisa ser observada.

## Modelo V2 entregue

Firebase Authentication resolve a identidade uma vez; o UID identifica `users/{uid}` e as Firestore Rules autorizam as operações. A PWA usa um único shell, sessão e fonte operacional Firestore. Apps Script/Sheets não participam da autenticação nem das gravações e o worker lateral foi removido. Templates genéricos de Etiquetas sem registros ou contrato na V1 também foram removidos; permanecem as opções de tipo e campos condicionais definidos no formulário. A V1 não foi alterada.

O inventário de V1 e os documentos de arquitetura, esquema, sincronização, segurança e paridade estão em [`docs/`](./). O plano corrente está em [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Limites e próximos portões

- **Conta Firebase:** em 25/09/2026, `firebase login:list` confirmou a sessão e `firebase projects:list` listou SAHMT `sahmt-17a16`; a CLI confirmou o Firestore `(default)`, Standard/Native.
- **Rules, índices e Functions de produção:** `firestore.rules` foi compilado e liberado; os 29 índices iniciais estavam `READY`. O índice adicional `syncQueue(status, nextAttemptAt)` foi implantado em 26/09/2026 e está `CREATING` na última consulta. A consulta somente de leitura à Cloud Billing API em 26/09/2026 retornou `billingEnabled=false` e nenhuma conta vinculada ao projeto `sahmt-17a16`. Functions não foram implantadas; o proprietário precisa vincular faturamento Blaze para viabilizar esse deploy.
- **Homologação real:** login Google, perfil inicial e chegada à Home estão confirmados. Consultas por módulo, offline/retry, escrita controlada e validação em celular permanecem pendentes.
- **Migração:** a carga de 28 estações e 30 siglas foi limitada aos catálogos indicados acima. O restante da prévia permanece somente leitura e exige conferência manual de origem/destino, ordem, autoria, UIDs e totais antes de qualquer importação.
- **UI e dispositivos:** comparação interna tela a tela, câmera OCR/QR e layout PDF em Android/iPhone continuam pendentes.
- **Templates:** a V1 inspecionada não contém uma coleção de modelos reutilizáveis; não se afirma paridade de tal catálogo.

Não considerar o release homologado para uso operacional até que o novo índice de fila chegue a `READY`, Functions necessárias sejam avaliadas/publicadas e os fluxos sejam testados com uma conta autorizada. O provisionamento do primeiro perfil e o acesso ao shell já foram confirmados.
