# Títulos dos arsenais

O Checklist apresenta os 17 nomes de salas solicitados em 20/10/2026 e mantém os seis títulos anteriores. Os títulos aparecem em preto na lista e no banner. O número do arsenal e o QR não mudam.

O campo opcional `stations/{id}.functionLabel` substitui o título padrão de `src/checklist-display.js`. Estações sem esse campo usam os títulos padrão sem exigir migração. A edição fica no banner do arsenal, em **Editar título** / **Salvar título**; aceita de 1 a 120 caracteres. A transação altera somente o título, a autoria da atualização, o timestamp e a versão. As demais edições do catálogo preservam o título corrente.

Somente `wx2064@gmail.com` e `marcio.henrique82@gmail.com`, com e-mail verificado, perfil ativo, acesso liberado e autorização de gestão do Checklist, podem editar títulos. A interface e as Rules usam o e-mail autenticado; o e-mail editável do perfil não concede acesso. Administradores com outros e-mails não podem criar, alterar nem remover `functionLabel`. A gestão existente de manutenção e ativação permanece com suas permissões anteriores.

## Validação e publicação

`npm run test:checklist-title` verifica os títulos, a autorização da interface, a gravação e as regressões do banner/catálogo. `npm run test:rules` inclui os testes de criação, alteração e remoção do título pelas duas contas, e as negativas para outro administrador, perfil com e-mail forjado, e-mail não verificado, leitor e perfil inativo. O workflow Pages executa os testes de domínio e Rules antes do build.

As Rules não são publicadas pelo workflow Pages. Antes de usar a edição de títulos em produção, publicar o arquivo `firestore.rules` validado, por uma sessão já autorizada ao projeto FA:

```sh
npx firebase deploy --only firestore:rules --project sahmt-17a16
```

O merge em `main` dispara a publicação do PWA pelo workflow existente. Sem a publicação das Rules, a lista mostra os novos títulos padrão, mas a gravação de títulos personalizados é recusada pelo servidor.

Homologação autenticada: conferir um título novo e Endoscopia; salvar e reabrir um título com cada conta autorizada; confirmar que outra conta, inclusive administrador, não apresenta o editor; confirmar que manutenção e ativação preservam o título salvo.
