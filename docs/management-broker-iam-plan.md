# Plano IAM do broker Gestão sem chave privada exportada

Versão 1 — 8 de outubro de 2026 (São Paulo). Diagnóstico e contrato local; nenhum IAM, escopo, API, deploy, gatilho ou dado foi alterado.

## Identidades e provas

| Alias | Identidade e limite da prova |
| --- | --- |
| `ATOR_FA` | Conta CLI selecionada para `sahmt-17a16` pelo preflight privado. Não prova qual usuário efetivo executará uma futura função nativa Apps Script. |
| `ATOR_FB` | Conta CLI proprietária de `sahmt-gestao-5ae66`, confirmada pelo preflight privado. |
| `FB-SA-01` | Única conta de serviço encontrada no inventário FB completo: ativa, identificada como Firebase Admin SDK. O receipt contém ID único e hash da identidade, sem e-mail. Sua existência não aprova o uso nem comprova seus grants efetivos. |

Preflights privados anteriores confirmaram ambos os projetos e bancos, proprietários esperados e faturamento desabilitado. Os receipts deste diagnóstico estão em `.local-preview/management-split/iam-plan-metadata-FA-20261009004505365.json` e `iam-plan-metadata-FB-20261009004445864.json`; o índice sanitizado é `iam-plan-receipt-v1.json`.

Metadados verificados neste turno, com um processo isolado por ator e vínculo do refresh token conferido em memória antes da primeira requisição:

| Gate FB | Resultado |
| --- | --- |
| IAM Credentials API | `DISABLED` |
| IAM API / STS API | `DISABLED` / `DISABLED` |
| Identity Toolkit / Firestore API | `ENABLED` / `ENABLED` |
| Inventário de contas de serviço | Completo: 1 página, 1 conta ativa (`FB-SA-01`) |
| `ATOR_FA` no projeto FB | Nenhuma permissão concedida entre `firebaseauth.users.get`, `datastore.entities.get/create/update` e `datastore.databases.get` |
| `ATOR_FA` na `FB-SA-01` | Nenhuma permissão concedida entre `iam.serviceAccounts.signJwt/signBlob/getAccessToken` |

A listagem IAM retornou HTTP 200 apesar do estado reportado da IAM API. Isso não comprova a disponibilidade de assinatura: a IAM Credentials API continua desligada. Foram nove requisições de metadados concluídas e uma tentativa inicial de metadados Firebase interrompida por identidade incorreta. Não houve consulta de documento, métrica ou usuário Auth, escrita, chave criada, API ativada ou assinatura.

A tentativa inicial revelou um risco da versão local de `firebase-tools`: seu cache de access token pode reutilizar um token para outro refresh token no mesmo processo quando os escopos coincidem. O probe final exige processo separado e igualdade do vínculo de refresh em memória. A fonte local foi apenas inspecionada, sem alteração de terceiro.

## Caminho concreto proposto

Uma ponte Apps Script dedicada, executada como um ator explicitamente identificado, pode manter o OAuth Google somente no servidor e chamar IAM Credentials `signJwt` para um signatário FB fixo. O Google usa a chave privada gerenciada da conta de serviço; o payload não precisa de chave exportada. A REST exige `projects/-/serviceAccounts/{ID_UNICO_OU_EMAIL}`, literalmente `-`, e `iam.serviceAccounts.signJwt` sobre essa conta. Escopo permitido: `iam` ou `cloud-platform`. [Referência oficial signJwt](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt).

Fluxo preparado para integração futura:

1. Broker Gestão isolado recebe a requisição e encaminha uma operação autenticada, fechada e idempotente para a ponte.
2. A ponte verifica identidade e estado Auth FA, projeção FA atual, identidade FB reconciliada, orçamento do projeto consultado e lease/fence FB.
3. O backend confirma a lease por CAS e revalida a fonte antes de assinar. Somente então monta o token Firebase com UID e claims derivados do servidor.
4. IAM Credentials assina o JWT usando a conta fixa. Nenhum OAuth access/refresh token é devolvido ao Worker ou à PWA.
5. O navegador troca o custom token e exige a confirmação atual do lease antes de acessar recursos.

A ponte não deve oferecer assinatura arbitrária, URLs/projetos fornecidos pelo cliente, claims/UID livres ou credenciais administrativas ao Worker. Os limites, autenticação entre servidores, nonce, validade, repetição e fences pertencem ao contrato do gateway; este documento não implementa nem aprova um endpoint público.

`FB-SA-01` é uma candidata existente para auditoria. Antes de adotá-la, é obrigatório conferir seus grants: poder assinar JWT também pode permitir obter OAuth em nome da conta por troca JWT. Uma conta signatária com grants amplos transforma `signJwt` em capacidade ampla de impersonação. Não é suficiente restringir apenas o formato do custom token no cliente. `roles/iam.serviceAccountTokenCreator` inclui poderes adicionais; um grant mínimo para o caminho escolhido deve conceder somente `signJwt` no recurso específico, com o signatário sem direitos desnecessários. [Permissões de contas de serviço](https://docs.cloud.google.com/iam/docs/service-account-permissions).

Um custom token Firebase usa RS256, `iss`/`sub` do signatário, audiência Identity Toolkit, UID definido pelo servidor e validade máxima de uma hora. A expiração desse token não encerra uma sessão Firebase já criada; lease, revogação e verificação atual continuam necessárias. [Contrato Firebase](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

## Permissões mínimas por operação

| Operação de runtime | Principal / recurso | Permissão IAM e escopo |
| --- | --- | --- |
| Validar assinatura pública do token FA | Broker/ponte; certificados públicos | Sem IAM administrativo. Validar projeto, emissor, audiência, tempo, UID e rotação. |
| Conferir estado/revogação Auth | Ator da ponte, FA e FB separadamente | `firebaseauth.users.get`; `identitytoolkit`. `targetProjectId` fixo e `localId` único. Sem listagem/importação/criação/remoção de usuários. |
| Ler projeção/coerência FA | Ator da ponte, banco FA fixo | `datastore.entities.get`; `datastore`. Só acrescentar `entities.list` se a operação reconciliada exigir query/lista. |
| Ler lease/fence FB | Ator da ponte, banco FB fixo | `datastore.entities.get`; `datastore`. |
| Criar lease/fence FB condicionado | Ator da ponte, banco FB fixo | `datastore.entities.create` com precondição `exists:false`; `datastore`. |
| Atualizar lease/fence por CAS ou invalidar | Ator da ponte, banco FB fixo | `datastore.entities.update` com precondição de versão; `datastore`. Sem delete. |
| Abrir/rollback de transação, se utilizado | Ator da ponte, banco correspondente | `datastore.databases.get`; `datastore`. Não confundir com `databases.getMetadata`. |
| Assinar token FB | Ator da ponte sobre signatário FB fixo | `iam.serviceAccounts.signJwt`; `iam`. Não precisa `signBlob`, `actAs` ou `getAccessToken` para a chamada REST direta proposta. |

A operação administrativa `accounts.lookup` exige `firebaseauth.users.get` e aceita os escopos `identitytoolkit` ou `cloud-platform`; a verificação real de revogação precisa do registro atual de usuário, além da validação criptográfica. [REST Auth lookup](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup).

No Firestore, get/batchGet, list, begin/rollback e commit têm permissões diferentes. Commit sem precondição de existência pode exigir create e update. IAM não autoriza por coleção como Security Rules e chamadas administrativas não são protegidas pelo deny do cliente. Portanto, grants de banco não impedem por si uma escrita administrativa em ledger, espelho ou migração: a ponte precisa de allowlist e CAS próprios, sem operações genéricas. [Tabela oficial IAM Firestore](https://docs.cloud.google.com/firestore/native/docs/security/iam).

O provisionador FB futuro poderá precisar `serviceusage.services.enable`, alteração de policy da conta/projeto e criação de papel customizado, conforme o desenho escolhido. Essas permissões não pertencem ao runtime. Nada foi provisionado nesta etapa.

## Escopos e ação nativa indispensável

O Apps Script atual possui `userinfo.email`, `datastore`, `spreadsheets`, `drive`, `forms`, `script.external_request` e `script.scriptapp`. Não possui `iam`, `identitytoolkit` ou `cloud-platform`. Seu uso atual de `ScriptApp.getOAuthToken()` para FA não autoriza IAM/lookup administrativo FB. A credencial CLI do diagnóstico não é prova de escopo concedido ao Apps Script.

Para uma ponte dedicada, a proposta mínima é `iam`, `identitytoolkit`, `datastore`, `script.external_request` e `userinfo.email`, todos com o prefixo `https://www.googleapis.com/auth/`. Se for adotado o script existente, seus escopos usados precisam ser preservados e revisados; este diagnóstico não modifica manifesto.

Depois que o gateway, grants e manifesto estiverem preparados e revisáveis, a entrada nativa proposta é `autorizarPonteGestaoSemChaveV1()`. **Essa função ainda não foi implementada nem está pronta no editor.** Seu único objetivo inicial deve ser conferir o usuário efetivo contra alias/hash esperado e pedir/checkar os escopos exatos com `getAuthorizationInfo(AuthMode.FULL, scopes)` e/ou `requireScopes`. A saída deve conter somente alias, completude do consentimento e gates de metadados; nenhuma assinatura, token impresso, escrita de dados ou gatilho.

A escolha de executar uma Web App como o desenvolvedor determina a identidade OAuth efetiva. `getOAuthToken()` representa o usuário efetivo e os escopos autorizados; esse token nunca deve ser transmitido ao cliente. [ScriptApp](https://developers.google.com/apps-script/reference/script/script-app), [escopos](https://developers.google.com/apps-script/concepts/scopes), [execução Web App](https://developers.google.com/apps-script/guides/web).

O consentimento OAuth nativo do proprietário continua sendo uma interação humana técnica inevitável se novos escopos forem introduzidos. A autorização de negócio já recebida não substitui esse consentimento do Google; não há pedido repetido nem função para executar agora.

## Cloudflare WIF: viabilidade ainda não comprovada

O Worker Etiquetas atual valida token de usuário/App Check e usa credenciais de IA; não tem uma identidade administrativa Google ou emissor OIDC nativo demonstrado para o broker Gestão. Não deve ser reutilizado como host ou identidade de Gestão.

WIF exigiria um JWT de workload renovável, emissor/JWKS confiáveis, audiência do provider, subject imutável e condição que vincule tenant e Worker autorizados. Só depois vêm STS, provider/pool e grant/impersonação Google. URL de Worker, token da API Cloudflare, token Firebase do usuário ou OIDC do GitHub Actions não demonstram essa identidade ambiente no Worker em runtime. Não existe prova local desse emissor/provider; STS FB está desligado. Não criar issuer com segredo estático para apresentar isso como WIF nativo sem chave. [WIF](https://docs.cloud.google.com/iam/docs/workload-identity-federation), [provedores externos](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers), [condições e sujeitos](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).

## Gates e independência dos projetos

- FA e FB têm política/ledger de leituras separados. A pausa vigente de FA não deve ser herdada pelo orçamento FB. FB pode continuar suas operações próprias aprovadas.
- Uma operação do broker que exija leitura atual FA continua impedida pela pausa FA; isso é uma dependência de dados, sem pausar o projeto FB por associação.
- Nenhuma métrica foi consultada neste diagnóstico. Grants ou OAuth não autorizam ultrapassar limites ou limpar pausas.
- Os registros Auth históricos (60 FA, 0 FB) são provas anteriores. O broker exige reconciliação FB explícita; este plano não importa nem cria usuário.
- Recursos Gestão continuam default deny até reconciliação de seus contratos; implementar identidade e lease não concede acesso a recursos nem aprova writes de ledger/migração.

Bloqueios atuais comprovados para a proposta Apps Script → IAM Credentials: API de assinatura desligada, escopos nativos ausentes e ausência dos grants FB testados para `ATOR_FA`. Ainda faltam verificar o efetivo executor nativo, auditar grants do signatário e firmar o gateway. Este plano entrega diagnóstico local e separa os gates; não comprova broker operacional, custo real ou publicação.
