# Primeiro administrador SAHMT V2

## Por que esta etapa é manual

O PWA não pode criar o próprio perfil administrador: antes do primeiro administrador não existe uma identidade autorizada a provisionar usuários. A conta proprietária cria uma única vez o perfil em `users/{uid}` pelo Console Firebase. Depois disso, novos perfis são administrados no módulo Administração da V2.

O Firebase Authentication comprova a identidade; o UID é a chave do documento. Não use o e-mail como ID, não copie usuários/permissões de planilha e não envie senha, token ou credencial ao PWA.

## Procedimento

1. Confirme que a conta Google escolhida está autorizada a administrar o projeto Firebase SAHMT `sahmt-17a16`.
2. Abra a V2 local ou publicada e entre com essa conta Google. Na tela de perfil pendente, copie o UID exibido. Esse login só revela a identidade; ainda não concede acesso ao SAHMT.
3. No Firebase Console, selecione `sahmt-17a16`, abra **Firestore Database → Data** e confirme a base `(default)`.
4. Crie a coleção `users` e um documento cujo ID seja exatamente o UID copiado. Não gere um ID automático.
5. Crie somente estes campos, com estes tipos:

| Campo | Tipo | Valor inicial |
|---|---|---|
| `uid` | string | Mesmo UID usado no ID do documento |
| `email` | string | E-mail da identidade Google autenticada |
| `displayName` | string | Nome exibido para a pessoa |
| `sigla` | string | Sigla SAHMT cadastrada; use string vazia se não houver |
| `phone` | string | Telefone cadastrado; use string vazia se não houver |
| `active` | boolean | `true` |
| `access` | boolean | `true` |
| `role` | string | `administrador_app` |
| `permissions` | map | Mapa vazio `{}`; o role administrador já concede as permissões das Rules |
| `createdAt` | timestamp | Data/hora atual do provisionamento |
| `updatedAt` | timestamp | A mesma data/hora do provisionamento |

6. Confira que não há campos extras, salve o documento e volte à V2. Atualize a página ou entre novamente. O PWA deve carregar `users/{uid}` e liberar o shell como administrador.
7. Abra Administração e crie os demais perfis com os UIDs que cada pessoa obtiver ao autenticar. Atribua somente as permissões necessárias.

## Checagens antes de concluir

- ID do documento e campo `uid` são idênticos ao UID retornado por Firebase Authentication.
- `email` e `displayName` correspondem à identidade autenticada; o e-mail é apenas dado do perfil e nunca substitui o UID.
- `active` e `access` são booleanos `true`; `role` é exatamente `administrador_app`.
- `createdAt` e `updatedAt` foram gravados como Timestamp do Firestore, não como texto.
- A V2 não faz bootstrap público e não chama Apps Script ou Sheets para esse procedimento.

Este passo provisiona somente o perfil. Não publica Firestore Rules/índices, não migra dados da V1 e não homologa gravações operacionais. Faça essas etapas separadamente conforme [`DEPLOYMENT.md`](DEPLOYMENT.md).
