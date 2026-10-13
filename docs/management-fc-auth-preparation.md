# Preparação da autenticação FA + FB + FC

Data: 10/10/2026. Preparação isolada no worktree `management-firebase-split`;
sem ativação ou publicação.

## Resumo executivo

- **FA** (`sahmt-17a16`) continua como login principal Google.
- **FB** (`sahmt-gestao-5ae66`) mantém a sessão de Gestão já desenhada.
- **FC** (`indicadores---sahmt`) entra como terceiro destino de Auth, usando token
  customizado próprio, assinado para FC e vinculado ao mesmo UID FA.
- O coordenador local pede ao broker os tokens FB e FC em uma única troca e tenta
  os dois `signInWithCustomToken` em paralelo. Uma falha/timeout em FC não encerra
  nem substitui as sessões FA/FB. A conexão é assíncrona e opt-in; ela não pode
  ser aguardada pelo bootstrap nem pela Home.
- O token ID de FA nunca é enviado a `signInWithCustomToken` de FC. O broker
  valida FA no servidor e emite um custom token distinto para cada projeto.
- **Ainda não é uma integração operacional**: o endpoint real não está hospedado,
  o contrato local prevê respostas FB/FC independentes, e o signer FC existe
  somente no código local. Não há conta/grant nem ponte Firestore operacional.
  A configuração Web FC foi fornecida pelo usuário e está no `.env.local`
  ignorado pelo Git. O coordenador permanece sem chamada pela PWA. A configuração
  mantém `VITE_INDICATORS_FIREBASE_ENABLED=false`. Esta limitação é explícita;
  não habilitar o flag até o broker produzir o contrato pareado e passar a
  homologação.

## Onde está o broker

No estado verificado deste checkout, **não há broker FA/FB publicado/hospedado**.
`scripts/lib/management-auth-broker.js` e `scripts/lib/management-broker-http.js`
são código local desabilitado e não abrem porta. O core agora aceita apenas os
destinos allowlisted FB/FC, preserva a concessão FB quando a assinatura FC falha
e o HTTP expõe resultados por destino. O teste anterior no `workerd`
foi uma simulação local com doubles; não é deployment. `worker-label-ai` é o
Worker de Etiquetas, com outro propósito e identidade, e não deve ser reutilizado
como broker administrativo.

`apps-script-management-gateway/Gateway.gs` também é preparação local sem
deployment/editor/segredo real. É um gateway de assinatura/Auth que agora
contém operações locais fechadas para FB e FC; não fornece por si só a aplicação
HTTP pública nem a leitura de autorização/lease necessária ao broker.
O broker público recomendado já foi escolhido para preparação: um único Worker
Cloudflare, com esse Apps Script como ponte privada, sem serviço paralelo. Ainda
falta hospedá-los e conectar a autorização/lease Firestore; nenhum serviço foi
criado ou publicado.

## Alternativas de hospedagem para aprovação

| Alternativa | Segurança e confiabilidade | Custo e compatibilidade com Spark | Avaliação |
| --- | --- | --- | --- |
| Cloudflare Worker + Apps Script Gateway | Worker fica como único endpoint público; Apps Script recebe somente envelopes assinados HMAC, valida nonce/prazo e usa OAuth gerenciado pelo Google para chamar APIs e `signJwt`. Não exige chave privada de service account. O código local tem lookup Auth FA/FB, assinatura FB/FC e contrato HTTP multi-destino; ainda falta deploy, autorização/lease adaptada, configuração do FC e teste real de quotas/redirect. | Pode operar nos planos gratuitos sem associar billing aos projetos Firebase. Worker Free tem 100 mil requests/dia e 10 ms CPU por invocação. Apps Script tem quotas por usuário (incluindo URL Fetch), até 6 min por execução e limite de concorrência. | **Melhor candidata sob a restrição sem billing**, condicionada a testes do redirect HTTP, quotas, nonce, autorização FA/FB e provisionamento auditado do signer FC. Não está pronta. |
| Cloudflare Worker sozinho | Endpoint público barato; segredo server-side. | Para obter assinatura Google sem exportar chave, seria necessário provar uma identidade federada suportada pelo Worker. Armazenar uma chave de service account como Secret evitaria navegador, mas criaria uma credencial privada exportada de longa duração, opção que não recomendo. | Não selecionar sem prova de IAM sem chave. |
| Apps Script como endpoint público único | Já existe preparação local de `doPost`, HMAC, nonce e OAuth gerenciado. | Não exige billing Firebase; tem quotas e a Content Service redireciona a resposta a uma URL temporária, o que precisa de tratamento/validação para cliente PWA externo. | Pode simplificar infra, mas o Worker front reduz o acoplamento CORS e mantém uma única URL pública estável. |
| Cloud Run ou Firebase/Cloud Functions | Runtime gerenciado e IAM natural; Cloud Run combina com o core Node. | Mesmo que o free tier cubra uso pequeno, Google Cloud exige billing no projeto host; Functions no projeto Firebase exige billing e muda Spark para Blaze. | Fora da restrição atual de não associar billing a nenhum projeto. |

**Recomendação atualizada, aprovada para preparação local:** usar Cloudflare Worker como única superfície pública
do broker e reutilizar/estender o Apps Script Gateway como ponte privilegiada
privada. O Worker guarda somente o segredo HMAC compartilhado com o Gateway; o
Apps Script guarda sua cópia em Script Properties, valida assinatura/prazo/nonce
e usa OAuth gerenciado para chamadas Google. A chave privada do signer permanece
gerenciada pelo Google; nada administrativo vai para o navegador. Isso não é um
"segundo broker": Apps Script só atende operações fechadas assinadas; a lógica
de sessão/contrato público permanece no Worker.

Essa é uma **recomendação aprovada para preparação, ainda não ativada**. Antes de
IAM ou publicação, precisamos provar localmente o Worker→Apps Script HTTP
(incluindo redirect de Content Service), integrar o broker às leituras de
autorização/lease, avaliar quotas sob volume esperado e revisar a guarda anti-replay.
Se esses testes não passarem, não colocar chave de service account em Worker
Secret como atalho; voltar à decisão de hospedagem.

Não configurar IAM, criar projeto host, armazenar segredo remoto nem publicar
nesta etapa. A arquitetura já foi aprovada para preparação. Próximos gates:
(1) testes locais do Worker→Apps Script HTTP e redirect de Content Service;
(2) apresentar identidades, APIs, escopos e grants exatos de `signJwt` para FB e
FC; (3) solicitar autorização específica antes de conceder IAM; (4) executar uma
prova controlada de assinatura sem emitir tokens de usuário; (5) apresentar
resultados de segurança/quotas; (6) pedir autorização separada antes de qualquer
publicação ou ativação.

## Plano Spark e impacto

Firebase documenta Custom Authentication junto do uso gratuito do plano Spark.
Não é necessário mudar FA, FB ou FC para Blaze só para usar Auth customizado.
O IAM Credentials API tem preço listado como gratuito. Ainda assim, isso não
torna o broker gratuitamente hospedado: qualquer host externo conserva seus
próprios limites/custos. Nenhum serviço de Cloud Functions, cobrança, upgrade
ou compra foi habilitado. Manter os três projetos em Spark é compatível com o
desenho, desde que o host e as quotas do Auth/IAM sejam revisados separadamente.

## Signer FC e permissões

O signer deve ser uma service account dedicada do projeto FC; seu JWT customizado
usa `iss` e `sub` dessa conta e é assinado com a chave gerenciada pelo Google via
IAM Credentials `signJwt`. A chave privada não deve ser exportada nem armazenada
no repo, Worker secrets, Apps Script properties ou navegador. O broker recebe
somente o `signedJwt` de curta validade em memória, usa-o para criar o token
customizado FC e entrega esse custom token à sessão Auth FC.

Com a arquitetura Worker + Apps Script, quem chama IAM Credentials é a identidade
OAuth sob a qual o Web App Apps Script executa (a conta que implantou, se
configurado para executar como deployer). Essa identidade precisa receber apenas
`iam.serviceAccounts.signJwt` nas contas signer FB e FC. Se uma custom role com
essa permissão não estiver disponível/aceita, a alternativa documentada é
`roles/iam.serviceAccountTokenCreator` vinculada somente às contas signer; essa
role inclui permissões adicionais, então requer revisão explícita. Não conceder
Owner/Editor nem permissão ampla no projeto. Habilitar
`iamcredentials.googleapis.com` em FC pode ser necessário; a pessoa que habilita
APIs precisa de `serviceusage.services.enable`. Isso não concede automaticamente
permissões de assinatura ao broker.

O principal Apps Script e signer FC ainda não foram confirmados, e o Worker/Gateway
não está hospedado. Por isso o grant IAM não pode ser configurado com segurança
nesta etapa. Não criar signer/grant agora. A preparação completa de IAM deve
confirmar principal real, projeto alvo, API, conta signer, condição/escopo por
recurso e prova `signJwt` controlada antes de emitir tokens.

## Mesmo usuário e permissões

O contrato planejado conserva o **mesmo UID string** nos três projetos: FA é a
fonte e os custom tokens FB e FC devem usar exatamente `faUid`. Isso cria
identidades Firebase separadas por projeto, mesmo quando seus UIDs coincidem.
Firebase pode criar o registro Auth do usuário em um destino na primeira troca
do custom token se aquele UID ainda não existir; portanto o broker precisa
validar/reconciliar o UID e decidir explicitamente se essa criação é permitida
antes de emitir o token. Não há importação de Auth FC implementada aqui.

UID igual não replica `providerData`, sessão, perfis ou permissões. Direitos de
Gestão permanecem no caminho FA → lease FB. Em FC, a sessão planejada identifica
o usuário ativo do FA, mas não copia permissões FA/FB nem cria claims de acesso.
Mesmo após login Auth FC, as Rules atuais negam qualquer leitura/gravação do
Firestore FC. Qualquer política de dados FC será analisada separadamente.

## Contrato proposto para o broker

O cliente chama um endpoint único com `POST`, HTTPS e corpo JSON fechado:

```json
{
  "schemaVersion": 1,
  "sourceProjectId": "sahmt-17a16",
  "faIdToken": "<token de sessão FA>",
  "targetProjectIds": {
    "FB": "sahmt-gestao-5ae66",
    "FC": "indicadores---sahmt"
  }
}
```

O HTTP local aceita um ou ambos os destinos, sempre com IDs fixos da allowlist;
não exige FB quando o pedido é FC-only. O core verifica assinatura, `aud`, `iss`,
expiração, `auth_time`, Google provider, UID e estado ativo/revogado no FA. Depois
aplica as permissões que vieram da projeção FA validada no servidor:

- **FB:** exige `trainingsRead`, `trainingsManage` ou `admin`, além do vínculo
  FA→FB. Só então executa a reconciliação Auth e a lease/política FB antes de
  emitir o token dedicado. `managementRead` ou acesso a FC, por si só, não abre FB.
- **FC:** exige `managementIndicatorsRead`, `managementIndicatorsWrite` ou
  `admin`. Não exige vínculo, Auth, leitura ou lease de FB. `trainingsRead` ou
  acesso a FB, por si só, não abre FC. A assinatura FC usa somente o UID validado
  e não recebe claims/permissões de FB.

Cada resultado pode ser `READY`, `DENIED` ou `UNAVAILABLE`. Um erro em FC não
retira uma sessão FB já confirmada; uma falha operacional em FB é devolvida como
resultado FB indisponível e não cancela uma sessão FC autorizada. Se nenhum
destino estiver disponível, o broker nega o pedido inteiro. A emissão concede
apenas sessão de Authentication; FC não herda permissões de FB. A conta de Auth
FC pode ser criada no primeiro `signInWithCustomToken`, mas nenhuma
coleção/documento Firestore será criada. O token não abre as Rules deny-all do
Firestore.

A resposta tem somente os destinos solicitados, sem token de FA ou credenciais
administrativas. Cada destino recebe seu estado isolado:

```json
{
  "schemaVersion": 1,
  "sourceProjectId": "sahmt-17a16",
  "faUid": "<uid validado>",
  "targets": {
    "FB": {"projectId": "sahmt-gestao-5ae66", "status": "READY", "uid": "<uid>", "customToken": "<token FB>"},
    "FC": {"projectId": "indicadores---sahmt", "status": "UNAVAILABLE", "code": "FC_TOKEN_SIGN_FAILED"}
  }
}
```

Os tokens são de uso único pelo cliente, TTL curto, nunca registrados em logs,
traces, analytics ou erros. Resposta parcial é válida: erro FC não invalida a
sessão FB; timeout não bloqueia FA nem a Home. O cliente confere project ID e
UID antes de cada `signInWithCustomToken`, autentica FB/FC em paralelo e mantém
estado independente. O primeiro `signInWithCustomToken` pode criar uma conta
Auth FC para o UID validado; isso ainda precisa de decisão explícita antes da
ativação produtiva. Nenhum `projectId`, UID, role, claim ou
permissão confiável é aceito como autoridade do browser.

Para adicionar outro destino no futuro, uma mudança revisada acrescenta um item
à allowlist server-side, config Web, signer/permissões próprios, política de
autorização e testes de falha isolada. O coordenador e o contrato local recebem
lista de destinos por nome; o host real ainda precisa implementar/receber essa
versão e nunca aceitar destinos dinâmicos fornecidos pelo usuário.

## Configuração Web FC: identificada e aplicada localmente

O usuário forneceu o objeto copiado do app Web já registrado; nenhum app novo foi
criado. Os valores foram escritos em `.env.local`, arquivo ignorado pelo Git.
O Project ID foi conferido contra a allowlist `indicadores---sahmt` e a validação
local retornou config completa. `VITE_INDICATORS_FIREBASE_ENABLED` continua
`false`, então a instância Auth não é inicializada.

## Configuração manual no Firebase Console

1. Nenhuma ação adicional é necessária para o app Web: o objeto oficial já foi
   incorporado localmente. Não registrar outro app. Esses valores identificam o
   app e são configuração pública, não credencial administrativa.
2. Manter o domínio `anestesiahmtforms.github.io` em Authentication → Settings →
   Authorized domains; as capturas recebidas anteriormente já mostram esse
   domínio listado. Confirmar que continua presente no app/projeto correto.
3. Authentication deve continuar habilitado. Google provider pode continuar
   como está; a sessão de destino será criada por custom token, não por um
   segundo popup Google. Não alterar regras/domínios de outros projetos.
4. Depois da escolha do broker, habilitar IAM Credentials API em FC se estiver
   desligada e criar/revisar a service account signer dedicada. Só então conceder
   a permissão mínima ao principal runtime verificado. Não baixar chave JSON.
5. Não criar coleções/documentos nem alterar Firestore Rules. Banco continua
   `(default)` e fechado.

Os valores Web FC estão localmente em `.env.local` pelas variáveis
`VITE_INDICATORS_FIREBASE_*`; `.env.example` lista os nomes sem copiar o valor da
chave. `VITE_INDICATORS_FIREBASE_ENABLED` permanece `false`.

## Implementação local preparada e evidências

- `src/firebase-projects.js`: registry exato FA/FB/FC e validação de projeto
  antes de inicializar instâncias nomeadas separadas.
- `src/indicators-firebase-config.js` e `src/indicators-firebase-app.js`:
  config Web FC por ambiente e Auth lazy em persistência de memória; não inicializa
  Firestore.
- `scripts/lib/management-gateway-protocol.js`, `management-gateway-client.js`,
  `management-google-auth-adapter.js` e `apps-script-management-gateway/Gateway.gs`:
  operação FC allowlisted, envelope HMAC fixado ao projeto FC, conta signer
  distinta e JWT sem claims. Essa parte é código local e permanece desativada;
  não cria conta nem prova permissões IAM.
- `src/firebase-project-auth.js`: chamada única ao contrato `exchangeTargets`,
  valida projeto/UID dos dois tokens, sign-in paralelo e estados sanitizados.
  Agora aceita lista explícita de destinos allowlisted do registro (padrão FB+FC),
  permitindo expansão incremental. Cada login de destino tem timeout isolado;
  FC lento/falhando mantém FB conectado e uma conclusão tardia de FC limpa apenas
  a sessão FC criada pela tentativa antiga. Troca FA enquanto a resposta do
  broker está pendente impede login em FB/FC para o usuário anterior. A chamada
  ainda não está ligada à PWA porque a rota/servidor compatível não existe.
- `src/firebase-secondary-session-lifecycle.js` e `src/auth.js`: o logout global
  tenta encerrar FA, FB e FC em paralelo; falha de uma sessão secundária não
  impede logout FA nem limpeza do outro destino. Troca/saída FA reconcilia apenas
  apps FB/FC já inicializados, encerra UID divergente e não inicializa Auth na
  limpeza. A reconciliação não bloqueia o perfil FA. Respostas tardias do broker
  e logins tardios de destino continuam invalidados/limpos pelo coordenador.
  O logout só informa sucesso quando FA, FB e FC confirmam a saída; pode ser
  repetido se houver falha secundária.
- Testes focados do cliente: `node --test tests/firebase-secondary-session-lifecycle.test.js
  tests/firebase-projects.test.js tests/indicators-firebase-app.test.js
  tests/firebase-project-auth.test.js tests/management-session.test.js
  tests/management-session-browser.test.js` — 207/207 passaram, incluindo logout
  secundário, troca de UID, Auth ausente sem inicialização, falha isolada de FC,
  fluxo legado FA+FB, flag `false`, timeout FC, resposta broker tardia e limpeza
  de login tardio. Separadamente, `vite.loadEnv` carregou o `.env.local` e a
  configuração normalizada foi válida para FC, sem inicializar app/Auth. A chave
  Web não aparece no `dist` desta build porque o coordenador ainda não é usado
  pela PWA; ela é configuração pública, não credencial administrativa.
  O conjunto combinado com os testes da sessão existente FA+FB foi 199/199. Os
  testes do broker/gateway passaram 651/651 e cobrem assinatura FC e resposta
  parcial HTTP sem token FC quando o signer falha. São doubles e respostas
  sintéticas; não provam endpoint HTTP real, identidade Apps Script ou IAM.
- O coordenador de login FB+FC ainda não está conectado ao fluxo de login da PWA.
  Portanto, o gerenciamento local/logout está implementado e coberto, mas o
  circuito integrado das três sessões não pode ser homologado em navegador ainda.
- `npm run build` passou. Vite emitiu avisos de chunk grande e
  import estático/dinâmico do outbox. A build não inclui o coordenador novo porque
  ele ainda não é importado pela PWA; esse fato evita tratá-la como integração
  concluída.
- Nenhum deploy, regra, dado, coleção, service account, IAM, configuração de
  produção ou plano de cobrança foi alterado.

## Gates antes da publicação

1. Hospedar o único broker Worker e a ponte Apps Script já escolhida; confirmar
   principal de runtime e comportamento do redirect antes de qualquer endpoint
   produtivo.
2. Integrar o contrato local preparado ao Worker/Gateway real para validar uma
   vez o FA e responder com resultados independentes FB/FC. FB mantém a validação
   e lease atuais; FC recebe o mesmo UID sem claims e com falha isolada. Nunca
   aceitar projetos, UIDs ou claims arbitrários do cliente. Respostas/tokens não
   podem aparecer em logs.
3. Aprovar e provisionar IAM do signer FC sem chave privada exportada. Confirmar
   que a execução se mantém em Spark e dentro das quotas do host.
4. Integrar o coordenador à conexão opt-in da PWA sem torná-lo dependência do
   bootstrap/Home; logout global e reconciliação por troca FA estão conectados,
   mas o login FB+FC do coordenador segue fora do fluxo principal.
5. Testar endpoint e login em Auth emulator/sintéticos, depois em sessão
   autorizada de navegador; verificar UID igual, identidades e falhas independentes.
6. Manter Rules FC deny-all e nenhuma leitura/gravação FC. Apresentar resultados
   para aprovação antes de qualquer publicação/ativação produtiva.

## Referências oficiais

- [Custom tokens Firebase](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Login web com custom token](https://firebase.google.com/docs/auth/web/custom-auth)
- [Planos Spark e autenticação customizada](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [IAM Credentials signJwt](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt)
- [Papéis de service accounts](https://docs.cloud.google.com/iam/docs/service-account-permissions)
- [Preço do IAM](https://cloud.google.com/iam/pricing)
- [Registro/configuração de app Web](https://firebase.google.com/docs/web/setup)
- [Limites do Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Quotas do Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
- [Preços do Cloud Run](https://cloud.google.com/run/pricing)
- [Firebase Hosting e requisitos de billing para Functions/Run](https://firebase.google.com/docs/hosting/serverless-overview)
