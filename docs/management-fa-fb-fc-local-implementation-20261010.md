# FA + FB + FC: relatório técnico de implementação local

Data: 10/10/2026
Escopo: desenvolvimento e testes locais no worktree `management-firebase-split`.

## Estado resumido

| Área | Estado local | Limite da evidência |
| --- | --- | --- |
| Worker separado | Entry point em `worker-management-auth/`, nome `sahmt-auth-broker`; nenhum vínculo/importação do Worker Etiquetas | Shell de Worker fail-closed, sem runtime ou deploy |
| Contrato Worker HTTP | `POST /v1/management/session`, JSON FA + IDs fixos FB/FC; resposta sem token FA, `Cache-Control: no-store` | Exercitado com handler local e doubles |
| Apps Script Gateway | HMAC por direção/operação, body hash, request ID e nonce, claims duráveis com `LockService`/Properties, expiração, redirect limitado e sanitização | VM e transportes simulados; identidade executora e redirect real não observados |
| Tokens | Verificação FA e emissão independente FB/FC exercitadas com verificadores/signers sintéticos | Nenhuma assinatura real via IAM Credentials foi executada |
| Sessões PWA | Opt-in só aparece se três flags/configurações estiverem ligadas; Auth FB/FC só carrega depois de clique na Gestão | Flags locais seguem desligadas; não homologado em navegador/produção |
| Firebase | FA, FB e FC continuam no Spark; nenhuma chamada a projeto Firestore nesta etapa | Nenhuma inspeção remota foi feita neste turno |

O caminho local completo está preparado para revisão, mas **a arquitetura não está tecnicamente pronta para ativação**: falta compor o runtime real do Worker e confirmar se IAM Credentials pode assinar sem associar billing. O código e os testes não mudam os planos nem os serviços hospedados.

## Contrato HTTP local

O app envia ao Worker dedicado apenas:

```http
POST /v1/management/session
Content-Type: application/json
Origin: https://anestesiahmtforms.github.io
```

```json
{
  "faIdToken": "<ID token FA>",
  "sourceProjectId": "sahmt-17a16",
  "targetProjectIds": {
    "FB": "sahmt-gestao-5ae66",
    "FC": "indicadores---sahmt"
  }
}
```

O contrato fixa método, origin, path, projetos, tamanho e formato JSON; recusa
cookies/Authorization, destinos arbitrários, query/hash, redirects do fetch,
respostas redirecionadas, ausência de `no-store`, body/chunks fora do limite e
tokens/respostas com UID ou projeto diferente. Não envia token FB/FC a Apps Script
nem aceita token de FA como token de destino.

Resposta de sucesso contém `schemaVersion`, `sourceProjectId`, `faUid` e somente
os alvos pedidos. A política do servidor decide cada destino separadamente:

- FB exige `admin`, `trainingsRead` ou `trainingsManage` e vínculo de identidade
  FA→FB confirmado.
- FC exige `admin`, `managementIndicatorsRead` ou `managementIndicatorsWrite`;
  não exige permissão, vínculo, Auth ou lease de FB.

O cliente pode pedir FB, FC ou ambos, mas essa seleção nunca concede autorização.
Cada destino retorna `READY`, `DENIED` ou `UNAVAILABLE`; uma falha não invalida o
outro. FC não herda claims/permissões FB.
O coordenador confirma o UID FA atual antes e depois da chamada e antes de cada
login secundário. Resposta atrasada após troca de usuário não autentica o usuário
anterior. Falha de FC preserva a sessão FB; nenhum erro secundário interrompe o
login FA ou a Home.

O Gateway Apps Script usa envelope independente: namespace/operação/projeto fixos,
HMAC-SHA256 e hash do body, direção separada, IDs/nonce aleatórios de 128 bits,
issued/expiry com TTL curto, claim atômico de nonce e request ID antes da execução,
e retenção do tombstone após falha/timeout. Para resposta do `ContentService`, o
cliente segue no máximo um redirect esperado para `script.googleusercontent.com`
por GET sem envelope nem cabeçalhos de autenticação; redirecionamento POST,
host/path/URL divergente, repetição, erro HTTP, cache, corpo inválido ou excesso
de bytes são rejeitados. O fetch do navegador ao Worker usa `redirect: error`.

## Worker exclusivo e trabalho pendente

`worker-management-auth/worker.js` e seu `wrangler.toml` são independentes de
`worker-label-ai/`. Há um helper SQLite Durable Object para admissão e
supervisão, com concorrência local padrão 8 e máximo configurável 32. Ele guarda
somente IDs aleatórios de slot e expirações. A migração Wrangler descreve o
binding, mas não cria namespace sem deploy. O export padrão continua sem
`buildRuntime`, segredo, endpoint, rota, Workers.dev ou deploy, e responde 503.
Ainda faltam composição real dos adapters/credenciais, quotas do Gateway e prova
IAM sem billing; mocks locais não certificam esses serviços.

## Identidades e permissões IAM que seriam necessárias

Identidade executora do Apps Script **a confirmar**: num Web App implantado como
“executar como eu”, é a conta que criou/atualizou o deployment; como “executar
como usuário”, é cada usuário. O Gateway precisa do primeiro modelo para ter um
principal estável. Antes de propor IAM, deve-se confirmar a conta efetiva no
deployment do Gateway e comprovar que o token OAuth do Apps Script contém apenas
os scopes planejados. Atualmente não existe deployment para identificar esse
principal; `pilot-admin@example.invalid` é o gestor do app, mas isso não prova a identidade
executora do Apps Script.

No desenho de assinatura remota, há duas service accounts de signer, uma em cada
projeto destino, sem chaves JSON:

| Recurso alvo | Conta de serviço proposta | Única permissão necessária |
| --- | --- | --- |
| Projeto `sahmt-gestao-5ae66` (FB) | Conta dedicada `firebase-custom-token-signer` criada nesse projeto | `iam.serviceAccounts.signJwt` apenas na service account FB |
| Projeto `indicadores---sahmt` (FC) | Conta dedicada `firebase-custom-token-signer` criada nesse projeto | `iam.serviceAccounts.signJwt` apenas na service account FC |

O principal que recebe esses vínculos seria a conta Google efetiva do deployment
Apps Script, individualmente em cada recurso signer; **não** o Worker Cloudflare,
browser, gestor geral, projeto inteiro nem uma conta padrão ampla. Preferência:
papel customizado mínimo com somente `iam.serviceAccounts.signJwt`, vinculado à
service account correspondente. `roles/iam.serviceAccountTokenCreator` inclui
`signBlob`, emissão de access/ID tokens e delegação; não é o privilégio mínimo.
O projeto destino também precisaria da API IAM Service Account Credentials
habilitada. Não baixar/guardar chaves privadas. Scopes OAuth Apps Script exigidos
pelo método incluem `https://www.googleapis.com/auth/iam` ou
`https://www.googleapis.com/auth/cloud-platform`; o scope amplo deve ser avaliado
com cuidado. Essas concessões não foram feitas.

**Correção após rastrear o registro histórico:** o HTTP 403 com mensagem de
billing veio de uma chamada marcada `firestoreStatus` no diagnóstico de
`sahmt-17a16`; não há evidência de que tenha sido uma chamada IAM Credentials
`signJwt`. O número de projeto citado pela mensagem foi `1072832154794`, associado
ao FA. O screenshot preserva status e mensagem segura, mas não o verbo/caminho da
requisição Firestore, então não permite nomear o método REST exato. Em registro
separado, o inventário somente de metadados de FB mostrou
`iamcredentials.googleapis.com` desligada e nenhuma tentativa `signJwt`. Portanto
o 403 anterior **não demonstra** que `signJwt` exige billing. As páginas oficiais
descrevem `signJwt` com API habilitada, OAuth scope e `iam.serviceAccounts.signJwt`,
e publicam custo zero para IAM; não encontrei requisito documental geral de billing
para esse método. Ainda não há prova operacional sem billing em FB nem FC: a API
estava desligada em FB e não foi feita uma chamada de teste nesta tarefa. A
compatibilidade com Spark é tecnicamente plausível, mas precisa de teste controlado
após aprovação específica para habilitação de API/IAM. Não associar billing.

## Limites e custos esperados

- **Firebase Spark**: Auth customizado é incluído sem custo; cada projeto Firestore
  tem seu próprio banco gratuito elegível, com 50.000 leituras/dia, 20.000
  gravações/dia, 20.000 exclusões/dia e 1 GiB. Cota Firestore renova no horário
  Pacific; excesso pode suspender o uso do produto no Spark. Este trabalho local
  não consumiu leituras Firestore.
- **Cloudflare Workers Free**: 100.000 requisições/dia compartilhadas pela conta,
  10 ms de CPU por chamada e 128 MB; sem cobrança de duração no Free. Se o desenho
  precisar de produto/limite pago, não aprovar mudança de plano automaticamente.
- **Apps Script**: por conta consumer, URL Fetch 20.000/dia, Properties
  50.000 leituras/gravações por dia e 500 KB por store; por Workspace, URL Fetch
  100.000/dia e Properties 500.000/dia. Propriedade individual tem limite 9 KB,
  execução máxima é 6 min. Limites podem mudar; usuários concorrem à quota do
  proprietário do script no modo “executar como eu”.
- **IAM Credentials**: API sem custo de uso publicado, porém a chamada pode ter
  pré-requisito de billing/serviço habilitado no projeto; isso ainda não foi
  resolvido nos projetos sem billing.

Os limites acima são quotas públicas, não capacidade validada do broker. HMAC,
admissão e armazenamento durável podem consumir quota de Apps Script; leitura e
gravação Firestore para autorizar FB pertencem ao projeto correspondente. A
arquitetura local ainda não mediu carga real, concorrência ou taxa de chamadas.

## Opt-in da PWA

Foram adicionadas as flags de build:

```text
VITE_FIREBASE_PROJECT_AUTH_ENABLED=false
VITE_MANAGEMENT_FIREBASE_ENABLED=false
VITE_INDICATORS_FIREBASE_ENABLED=false
VITE_FIREBASE_PROJECT_AUTH_ENDPOINT=
VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN=
```

Com qualquer flag desligada, a seção não aparece e nenhum Auth secundário é
carregado. Com flags ligadas, endpoint HTTPS e origin explicitamente pinados e
compatíveis, Gestão mostra botões para conectar FB, FC ou ambos. Cada botão
envia somente os alvos selecionados. A importação do módulo do navegador e o
bootstrap dos Auth secundários ocorrem somente depois do clique. Não há popup
Google adicional. FA continua sendo a fonte da sessão e da identidade; logout
global/troca de UID usam o ciclo secundário já preparado. Nenhuma ativação ocorreu.

As chaves `apiKey`/`appId` dos aplicativos Firebase Web são identificadores
públicos e não são segredo IAM. Não incluir bearer token, chave HMAC, OAuth token,
service-account key ou segredo de Worker nas variáveis `VITE_*`; o build de uma
integração habilitada pode embutir a configuração Web pública.

## Verificações locais

Os testes abaixo usam mocks, VM Apps Script e tokens/signer sintéticos. Eles não
acessam Firestore/Auth remoto nem provam IAM ou deployment:

- `node --test tests/firebase-project-broker-transport.test.js tests/firebase-project-auth-optin.test.js worker-management-auth/worker.test.js tests/management-auth-broker.test.js`
- `node --test tests/firebase-projects.test.js tests/indicators-firebase-app.test.js tests/firebase-project-auth.test.js tests/firebase-secondary-session-lifecycle.test.js tests/management-session.test.js tests/management-session-browser.test.js`
- `npm run test:management`
- `npm run test:domain`
- `npm run build`

Os resultados históricos da validação anterior (382 testes direcionados, 2.290
test:management e 915 test:domain) não são desta rodada. Veja os resultados
atuais em `docs/management-fa-fb-fc-continuation-status-20261010.md`.

O contrato GAS dedicado cobre HMAC errado, direção/audiência/projetos/body/timestamps,
expiração/TTL, replay de nonce e request ID através de VM, lock concorrente,
retention/tombstones, redirecionamento esperado, redirect malicioso/repetido,
timeout e sanitização de erro. A integração FA→FB+FC no teste de composição é
sintética: não é teste com usuário real nem token assinado pelo Google.

## Aprovação específica ainda necessária antes de serviços

Após este relatório, qualquer próximo passo hospedado precisa de autorização
específica para: implementar/publicar runtime do Worker; escolher implantação e
identidade do Gateway; ativar/implantar Apps Script; habilitar API/conceder IAM
por service-account alvo; e, por último, ativar flags de produção. Nenhuma dessas
ações está autorizada por este pedido.

## Fontes oficiais consultadas

- [Firebase Spark e planos](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Cota de operações do Firestore](https://firebase.google.com/docs/firestore/pricing)
- [Limites dos Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Preço Workers](https://developers.cloudflare.com/workers/platform/pricing/)
- [Quotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
- [Implantação e identidade de Web Apps Apps Script](https://developers.google.com/apps-script/guides/web)
- [IAM Credentials `signJwt`](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt)
- [Permissões de service accounts](https://docs.cloud.google.com/iam/docs/service-account-permissions)
- [Permissões suportadas por papéis customizados](https://cloud.google.com/iam/docs/custom-roles-permissions-support)
- [Preço IAM](https://cloud.google.com/iam/pricing)
