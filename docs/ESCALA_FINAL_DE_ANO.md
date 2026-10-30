# Escala Final de Ano 2026 / 2027

O módulo fica em **Governança → Enquetes e Consultas → ESCALA FINAL DE ANO**. O botão usa vermelho e dourado e reúne árvore de Natal e fogos no mesmo ícone. A tela usa o diálogo de Governança existente e mantém a rolagem dentro do painel.

Cada integrante confirma exatamente um plantão e um grupo, sem restrição entre categorias:

| Categoria | Natal | Réveillon |
| --- | --- | --- |
| Plantão | 24 e 25/12/2026 | 31/12/2026 e 01/01/2027 |
| Grupo de trabalho | 26 a 29/12/2026, até 13h30 do dia 29 | 29/12/2026 após 13h30 e dias 02 e 03/01/2027 |

O dia 30/12 não foi acrescentado. As datas reproduzem a solicitação. Uma confirmação exige as duas escolhas. Atualizações preservam a posição e a data da primeira confirmação, conforme explicado no formulário.

## Firebase e autorização

“FE” é a referência interna ao projeto **outros-48120**, banco **(default)**. O módulo reutiliza a sessão Google FE do app, com o mesmo UID, troca de conta e logout globais. Não cria outro Firebase App nem uma coleção chamada FE.

Os documentos ficam em:

- `yearEndSchedules/2026-2027/registrations/{uid}`: UID, nome de exibição institucional, plantão, grupo, posição e datas de servidor.
- `yearEndSchedules/2026-2027/control/order`: última posição, UID da última inscrição e data de servidor.

A transação cria inscrição e contador juntos. Reenvios do mesmo UID não criam outra posição. O cliente trata a corrida entre a leitura do contador e a avaliação das regras com tentativas limitadas, após comprovar que o contador avançou. Falhas reais de autorização permanecem bloqueadas.

As Rules exigem perfil FE ativo e liberado, UID correspondente e conta Google verificada. A lista é visível à equipe autorizada; cada integrante altera somente suas duas opções. Nome, UID, posição e data inicial são protegidos, e exclusões pelo cliente são negadas. O próprio perfil pode ser consultado para obter o nome institucional; outros perfis e a listagem de usuários continuam bloqueados.

O acesso específico à escala permite que integrantes aprovados entrem em Governança. Os demais painéis conservam a autorização anterior, inclusive a liberação restrita das pesquisas e dos cadastros.

## Validação e publicação

```sh
npm run test:year-end
npm run test:year-end-rules
npm run test:survey-session
npm run test:domain
VITE_GOOGLE_PROJECT_AUTH_ENABLED=true npm run build
```

`tests/fixtures/year-end-schedule-preview.html` oferece uma prévia local com pessoas e dados sintéticos, sem conexão ao Firestore. Não integra o build de produção.

As regras de FE são compostas a partir de `firestore.fe.base.rules`. Para publicar exclusivamente as regras, após revisão:

```sh
node scripts/build-climate-rules.mjs
firebase deploy --config firebase.climate.json --project outros-48120 --only firestore
```

O PWA mantém o fluxo GitHub Pages existente. Não é necessário publicar as páginas de pesquisa no Firebase Hosting para este módulo, nem provisionar inscrições ou contador: a primeira confirmação autorizada cria os documentos atomicamente.

Em 30/10/2026, o Console autenticado confirmou a coleção `users` com os campos exigidos e a versão de regras publicada igual à base anterior do repositório, após normalizar quebras de linha. A validação de gravações utilizou somente o emulador. Nenhuma inscrição de teste foi criada em produção.
