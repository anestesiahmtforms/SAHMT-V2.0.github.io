# Avaliação de hospedagem do broker de Gestão

Diagnóstico de 8 de outubro de 2026, baseado somente no código local do worktree `management-firebase-split` e em documentação oficial consultada nesta data. FA: `sahmt-17a16`; FB: `sahmt-gestao-5ae66`. Não houve acesso à conta Cloudflare, leitura de secrets, API de dados, métrica, criação de serviço/chave, alteração IAM/escopo, publicação ou teste remoto.

## Conclusão

**Spark permite a autenticação customizada; o broker silencioso ainda não tem hospedagem comprovada.** O Apps Script existente pode ser candidato após uma adaptação de servidor e transporte, mas não executa o núcleo Node atual diretamente. O Worker Cloudflare já existente oferece uma base local mais próxima para HTTPS/CORS/RS256. Ele também precisa de identidade privilegiada Google, revogação, adaptadores e orçamento durável antes de poder atuar como broker. Nenhuma evidência desta análise demonstra necessidade de Blaze. [Planos Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

A próxima preparação recomendada é uma prova local de transporte/runtime Cloudflare isolada do fluxo Etiquetas, seguida de desenho revisável da identidade privilegiada e do ledger. Uma ponte Apps Script pode manter a credencial Google no servidor e usar assinatura IAM gerenciada, mas acrescenta um protocolo autenticado entre servidores que ainda precisa ser implementado e revisado. Se essa hospedagem não passar pelos gates abaixo, a alternativa sem broker é reconexão Google explícita em FB. Isso exige uma decisão de experiência e autorização de dados própria; não é recuperação silenciosa já entregue.

## Evidência local

| Arquivo | Evidência | Consequência |
| --- | --- | --- |
| `apps-script-v2/appsscript.json` | V8, Execution API `MYSELF`; escopos de datastore, Sheets, Drive, Forms, external_request e scriptapp. Sem escopos `iam`, `identitytoolkit` ou `cloud-platform`. | O manifesto atual não fornece o token OAuth exigido por assinatura IAM e consulta administrativa Auth. Não foi verificada a concessão IAM real. |
| `apps-script-v2/Config.gs` | `firestoreRequest_` usa `UrlFetchApp.fetch` e `ScriptApp.getOAuthToken()`; projeto FA fixo. | Transporte de worker administrativo; não há adaptação isolada FA/FB nem orçamento do broker nessa função. Não reutilizar indiscriminadamente. |
| `apps-script-v2/*.gs` | Busca local não encontrou `doGet`, `doPost`, ContentService/HtmlService, verificador RS256, lookup Auth ou signer IAM. | Os arquivos atuais não contêm um endpoint web de broker. Isso não é inventário dos deployments remotos. |
| `scripts/lib/management-auth-broker.js` | Importa `node:crypto`; usa Buffer, performance, AbortController e timers. | Núcleo desligado com adaptadores injetados. Testes Node não comprovam outro runtime. |
| `worker-label-ai/worker.js` | HTTPS fetch handler, CORS de origem exata, resposta no-store, WebCrypto RS256 e App Check. Lê perfil FA com o token do próprio usuário. | Padrões reaproveitáveis, não um broker administrativo. Não há lookup de revogação/desativação Auth, signer FB, CAS/fence ou ledger de reservas. |
| `worker-label-ai/wrangler.toml` | Worker `sahmt-label-ai`, compatibility date `2026-09-28`; sem binding durável. | Configuração versionada; plano atual da conta e deployment não foram consultados. |
| `docs/LABEL_AI_WORKER.md` | Registra publicação anterior e confirmação do usuário no iPhone para Etiquetas. | Evidência histórica de outro fluxo; não comprova login FB ou versão publicada atual. |

## Apps Script: equivalência e pontos ainda não demonstrados

### Verificar a prova FA

A verificação precisa conferir assinatura RS256 com chave pública rotativa e `kid`, audiência/emissor exatos de FA, UID e tempos. A orientação Firebase aceita biblioteca JWT de terceiros quando o ambiente não possui Admin SDK. Decodificar o JWT ou chamar Firestore com ele não implementa a verificação de servidor exigida pelo broker. [Verificação oficial](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

Apps Script V8 não oferece Node/WebCrypto, performance nem timers assíncronos. Utilities fornece digest, HMAC e assinatura RSA com chave privada; não documenta verificação RSA equivalente. Portanto é necessário um verificador compatível auditado ou um componente confiável externo. Esta avaliação não escolheu nem adicionou biblioteca. [V8](https://developers.google.com/apps-script/guides/v8-runtime), [Utilities](https://developers.google.com/apps-script/reference/utilities/utilities)

A revogação exige estado Auth atual além da assinatura. `accounts.lookup` administrativo permite projeto/UID exatos com `firebaseauth.users.get` e escopo identitytoolkit/cloud-platform; `UserInfo` expõe desativação e watermark `validSince`. Um adaptador REST deve reproduzir a comparação de `auth_time`/watermark e as negações do Admin, com testes de fronteira, projeto e usuário. A documentação do lookup de usuário final, isolada, não foi tratada como prova de equivalência a `verifyIdToken(token,true)`. [Lookup](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup), [UserInfo](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/UserInfo), [Revogação Firebase](https://firebase.google.com/docs/auth/admin/manage-sessions)

### Assinar para FB sem exportar chave

`signJwt` ou `signBlob` podem usar chave privada gerenciada pelo Google. Exigem a respectiva permissão na conta de serviço escolhida e escopo iam/cloud-platform. `signJwt` pode assinar o payload do custom token; aceitar sua saída no Auth FB ainda precisa ser demonstrado. O payload deve seguir o formato Firebase, com UID derivado no servidor, audiência IdentityToolkit, emissor/sub da conta de serviço FB e validade máxima de uma hora. [IAM signJwt](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt), [IAM signBlob](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob), [Custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens)

Gate: conferir conta de serviço existente, API IAM/Credentials habilitada, ator e IAM mínimo sobre FA/FB, e renovar o consentimento do servidor se os escopos mudarem. Nada disso foi alterado aqui. Assinatura permite produzir outros artefatos de identidade; conceder Token Creator amplo exige avaliar o poder resultante, não somente o nome da função. [Pré-requisitos IAM](https://docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct), [Poder das permissões de assinatura](https://docs.cloud.google.com/iam/docs/service-account-permissions)

### Prazo, CAS e transporte

A referência atual de UrlFetchApp **já documenta `timeoutSeconds`**, com padrão 360 segundos. Logo, ausência de timeout não é uma conclusão válida. Uma porta síncrona pode limitar cada chamada pelo restante do deadline, conferir expiração depois da resposta e preservar uma janela única de limpeza. Ainda falta demonstrar comportamento real do timeout, arredondamento em segundos, retorno tardio e limpeza antes do limite do host; o núcleo Node com timers e clock monotônico não é copiado diretamente. [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)

Timeout não prova que um commit remoto falhou. O CAS/fence durável em FB, a guarda de orçamento anterior à limpeza e a reconciliação de resultado desconhecido continuam obrigatórios. LockService serializa código participante do mesmo script, mas não substitui a transação do lease/fence em FB nem coordena escritores externos. O contrato [management-auth-broker-contract.md](management-auth-broker-contract.md) permanece a referência de negação.

Content Service redireciona a resposta a uma URL temporária; TextOutput não documenta setter de headers HTTP. Não existe prova local de POST com JSON/Authorization e preflight legível pela PWA GitHub Pages. Não se conclui que todo CORS do Apps Script seja impossível. JSONP não serve para tokens sensíveis. [Content Service](https://developers.google.com/apps-script/guides/content), [TextOutput](https://developers.google.com/apps-script/reference/content/text-output)

Duas opções de ensaio: (1) fachada Cloudflare recebe POST/OPTIONS e chama Apps Script servidor a servidor; (2) página HtmlService usa google.script.run e uma ponte de mensagens com origem/source/nonce fixos. A segunda exige prova de embedding, armazenamento e Safari; google.script.run só está disponível na página HtmlService. Nenhuma opção foi implementada. Executar como proprietário deve conservar seu OAuth exclusivamente no servidor. Não usar URL, JSONP ou postMessage com destino curinga para tokens. [Comunicação HtmlService](https://developers.google.com/apps-script/guides/html/communication), [Web Apps](https://developers.google.com/apps-script/guides/web)

## Alternativa Cloudflare no plano gratuito

O runtime oferece WebCrypto e suporte a `node:crypto`; datas de compatibilidade a partir de 2026-08-04 habilitam a compatibilidade Node por padrão. A data local está nessa faixa. Isso reduz a adaptação necessária para o núcleo, mas o bundle/Admin SDK e todos os adaptadores precisam de prova específica. [Crypto Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [Compatibilidade](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)

`performance.now()` e Date.now no Worker publicado só avançam após I/O. O prazo do protocolo deve ser conferido a cada await e por timer de rede; não usar uma medição CPU local como prova de deadline publicado. Abort continua sem desfazer commit. [Relógios Workers](https://developers.cloudflare.com/workers/runtime-apis/performance/)

Um Worker separado na mesma conta gratuita pode isolar Gestão de Etiquetas; uma rota nova no Worker existente evita outro deployment, mas compartilha falhas, quota e configuração. **Separado é a recomendação arquitetural futura, não autorização para criar agora.** Não copiar o Secret OpenAI para Gestão, nem inferir acesso Google administrativo dele.

O bloqueio central é a identidade privilegiada Google: o Worker atual não tem conta de serviço nem acesso administrativo a FA/FB. Um Firebase ID token do usuário não permite assinar tokens FB, consultar toda a projeção ou gravar o lease privilegiado. As opções futuras são identidade federada Google devidamente configurada, ou gateway Apps Script com credencial Google mantida no servidor. A viabilidade concreta da federação não foi demonstrada nesta conta; não prometer autenticação automática do Worker em IAM.

Caminho híbrido candidato: PWA → Worker com origem exata/FA verificado/App Check → gateway Apps Script autenticado → REST Auth/Firestore/IAM. Cada chamada entre servidores precisaria de autenticação própria, nonce e prazo, corpo limitado, operação/projetos fixos, anti-replay durável e permissão servidor derivada de FA. O gateway não pode virar signer de payload arbitrário nem aceitar direitos declarados pelo cliente. Timeout do Worker exige o mesmo fence contra execução tardia do gateway. Esse caminho preserva a possibilidade de chave IAM gerenciada, mas ainda exige implementação, escopos/IAM e ensaio de plataforma.

Durable Objects SQLite estão disponíveis no Workers Free e são candidatos ao ledger serializado de reservas, separado do Firestore. Não estão provisionados no wrangler atual. Quota esgotada deve negar concessão. KV é eventualmente consistente e não substitui o ledger concorrente exigido. [Durable Objects Free](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Consistência KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

## Custos, limites e orçamento

| Recurso | Limite/documentação atual | Gate operacional |
| --- | --- | --- |
| Firebase Spark | Custom Authentication disponível; Functions/serviços Google pagos não fazem parte dessa opção. | Conservar faturamento desligado; nenhum upgrade é necessário só para usar custom Auth. |
| Apps Script Gmail | 20.000 URL Fetch/dia, 50.000 operações Properties/dia, 6 min/execução, 30 execuções simultâneas/usuário; Properties 500 KB/store e 9 KB/valor. | Compartilha quota do ator com workers atuais. Cache não é ledger durável; retenção/fence precisa caber sem apagar pendências. |
| Cloudflare Workers Free | 100.000 requests/dia da conta, 10 ms CPU/request, 50 subrequests/request. | Medir CPU criptográfica/bundle e contagem incluindo redirecionamentos; tempo de rede não certifica CPU. Conta/uso atuais não conferidos. |
| Durable Objects Free | SQLite disponível, 100.000 requests/dia; esgotamento gratuito faz operações falharem. | Serialização/armazenamento/retention a implementar; disponibilidade sujeita à quota. |
| IAM | Documentação informa IAM sem cobrança adicional; outros produtos podem ter preço próprio. | Conferir acesso real/API/quotas; isto não comprova habilitação nem licença para ativar outros serviços. |
| Firestore FA e FB | Políticas locais separadas: FA 45.000 explicitamente aprovado em 8/10; FB 35.000. Tráfego do app incluído, com dia LA e sem pausa herdada. | Medição fresca completa, margens, pausa humana persistida e reservas cumulativas duráveis antes de reads/CAS/limpeza. |

Fontes das quotas: [Apps Script](https://developers.google.com/apps-script/guides/services/quotas), [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [IAM](https://docs.cloud.google.com/iam/docs/billing-questions). A quota gratuita de Firestore não aumenta porque o host está no Cloudflare.

No caminho de sucesso do núcleo atual há três verificações FA com revogação, três projeções FA, três consultas Auth FB, duas leituras de lease FB, um CAS e uma assinatura. Falha após escrita acrescenta reserva e invalidação/fence. Isso é contagem de etapas do código, **não contagem certificada de chamadas REST/leituras**: projeções, transações, rotação de chave e retries custam unidades adicionais. Não usar 929 leituras/Form nem uma métrica antiga para dimensionar autenticação. A métrica atrasada requer débito não refletido e margem conservadora; não instala corte exato global do app.

## Alternativa sem broker: credencial Google e reconexão

O SDK permite extrair OAuthCredential do resultado de um login Google e passá-la a signInWithCredential de outra instância Auth. Esse é um ensaio possível durante a mesma interação, não garantia de aceitação cruzada. É necessário conferir provedor Google/client IDs/audiências aceitas, origem e redirect autorizados em FB, usuário Google previamente reconciliado e UID esperado; falha deve bloquear FB. Não usar Firebase ID/refresh token FA como credencial Google. [GoogleAuthProvider](https://firebase.google.com/docs/reference/js/auth.googleauthprovider), [signInWithCredential](https://firebase.google.com/docs/reference/js/auth), [Configuração do provedor](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs)

Persistência restaura sessões Firebase por instância; não documenta recuperação de uma credencial Google de um resultado antigo. Com FA restaurado e FB ausente, este caminho ainda exige credencial Google nova ou broker. Guardar access token para sempre não resolve expiração. [Persistência](https://firebase.google.com/docs/auth/web/auth-state-persistence)

Reconexão Google explícita em FB evita o signer custom e pode permanecer em Spark. Ela não elimina importação/reconciliação de UID, espelho vigente, sincronização de direitos, revogação, orçamento ou Rules específicas. O login Google não concede acesso por si. A decisão de aceitar uma interação extra pertence à experiência aprovada; esta avaliação não mudou o coordenador.

Safari/iPhone continua gate real: popup precisa de interação e pode ser bloqueado; redirect em hospedagem externa precisa de uma solução oficial para armazenamento de terceiros. Mudar só authDomain para GitHub Pages não implementa proxy transparente. A prova do fluxo Etiquetas no iPhone não valida login cruzado ou recuperação FB. [Boas práticas redirect](https://firebase.google.com/docs/auth/web/redirect-best-practices)

## Gates para uma implementação produtiva

1. Escolher host e transporte após prova local específica; conservar Gestão bloqueada até homologação.
2. Demonstrar verificador FA equivalente com revogação/desativação, signer FB e ator Google servidor com IAM/escopos mínimos. Nunca exportar OAuth administrativo à PWA.
3. Implementar projeção versionada/coerente, ledger de orçamento durável entre instâncias e CAS/fence transacional. Não liberar reserva enquanto houver chamada com resultado desconhecido.
4. Definir e provar TTL do lease, prazo de propagação, todos os escritores de revogação e identidade reconciliada. Não assumir atomicidade entre Auth/FA/FB.
5. Demonstrar timeout/limpeza/reinício/concorrência no host escolhido, limites gratuitos e falhas fechadas, sem retries ampliando prazo.
6. Após orçamento e gates de dados, conferir Rules FB próprias, backups/rollback e login real autorizado em Safari/PWA instalada e navegadores desktop. A ativação e o corte dos escritores antigos não fazem parte deste diagnóstico.

O diagnóstico entrega caminhos gratuitos condicionais e bloqueios específicos. Não entrega endpoint, IAM, chave, serviço novo, migração, disponibilidade de Gestão ou validação por participante real.

## Ensaio local Cloudflare concluído em 8 de outubro de 2026

**6/6 checks passaram no workerd local** via Wrangler cacheado `dev --local`, loopback `127.0.0.1:8793`, inspector `127.0.0.1:9793`, compatibility date `2026-09-26` e flag `nodejs_compat` explícita. Versões efetivas: Node `v24.19.0`, Wrangler `4.144.0`, workerd `1.20260926.1`, Miniflare `5.20260926.1-alpha`. O registro UTC foi de `2026-10-09T00:20:06.787Z` a `2026-10-09T00:20:20.246Z`; em São Paulo, ainda era 8 de outubro. As dependências foram reaproveitadas do cache existente; nenhuma instalação ocorreu.

| Ensaio local | Resultado observado |
| --- | --- |
| Rota normal do transporte e núcleo desligados | POST retorna HTTP503 `BROKER_HTTP_DISABLED`, `no-store`; núcleo retorna `BROKER_DISABLED`, antes de qualquer adapter. |
| Compatibilidade das APIs Node | Imports dos dois núcleos, `node:crypto`, SHA256, Buffer UTF8, randomUUID e timers executaram no workerd. |
| Fluxo completo com doubles em memória | Transporte interno200, hash/grant gerados pelo núcleo, verificação/fonte/alvo repetidos, reservas e CAS exclusivamente sintéticos; resposta sanitizada sem strings de token ou identidade. |
| Origem divergente | Transporte interno403 `BROKER_ORIGIN_DENIED`, antes de todos os adapters. |
| JSON com identidade extra | Transporte interno400 `BROKER_BODY_INVALID`, antes de verificar/assinar/escrever em memória. |
| Adapter que nunca resolve | Transporte interno504 `BROKER_HTTP_DEADLINE_EXCEEDED`, supervisão `BROKER_COMPLETION_UNCONFIRMED` e reconciliação necessária. |

Evidências locais ignoradas pelo Git, na pasta `.local-preview/management-split/runtime-smoke`: `proof.json`, `README.md`, `entry.js`, `wrangler.toml`, `run-smoke.mjs`, `isolate-preload.cjs`, `stdout.log`, `stderr.log` e `wrangler.log`. Hash SHA256 dos núcleos usados: broker `edccce0ac11df51a997757db6a1941a88d79f00f4a510da113791ba26fbbc702`; HTTP `0c3709b58e9b55f01e11ba71f82a1305f7d7a8b1fe69286e1e4eca89ad0bffaa`. Ambos foram conferidos sem mudança após a execução. O entry sintético foi `6116622df672142877f1c3a14cbbbbb4a85aca21efe424c60cf628fd5d62d619`.

O ambiente filho excluiu credenciais, isolou o perfil Wrangler, desativou métricas/telemetria/relatório de erros/banner e leitura de .env; não houve bindings, Auth/Firestore reais, login, whoami ou publicação. Os IDs FA/FB apareceram somente como labels fixos do contrato nos doubles, não como seleção de recursos. A árvore de processo própria foi encerrada após conferir PID/comando/config/porta; as duas portas estavam livres na conferência posterior. Nenhum Worker Etiquetas foi iniciado ou alterado.

**Aviso observado:** Miniflare tentou obter um `Request.cf` de referência no startup. O proxy local sem listener `127.0.0.1:9` bloqueou essa tentativa, houve ECONNREFUSED e o runtime usou placeholder. Os logs preservam o aviso. Esses guardas/proxy são isolamento deste CLI local; não certificam egress de um Worker publicado.

**Limites:** o listener usou HTTP. As rotas sintéticas reconstruíram internamente uma URL HTTPS `.invalid` e devolveram um envelope HTTP200 com o status interno, para omitir placeholders. Não houve teste de TLS ou CORS em navegador. O ensaio demonstra compatibilidade local do bundle/controle de fluxo; não comprova assinatura/verificação RS256 real, aceitação custom Auth Firebase, IAM, revogação/propagação real, orçamento/ledger durável, CAS remoto, Safari/PWA, CPU publicada, plano/uso real da conta ou equivalência de timers publicados. A ativação continua sujeita aos gates anteriores.

### Conferência local do SDK usado pelo adapter browser

**17 checks de exports/prototype/assinaturas passaram**, sem instanciar apps/Auth/Firestore, sem login, leitura de documento ou chamadas de rede. Versões instaladas: Firebase `12.19.0`, `@firebase/auth` `1.13.6`, `@firebase/firestore` `4.17.2`. O registro local está em `.local-preview/management-split/runtime-smoke/sdk-export-proof.json`; o checker isolado é `check-sdk-exports.mjs`.

As funções usadas por `src/management-session-browser.js` existem: `getApps`, `initializeApp`, `initializeAuth`, `getAuth`, `onAuthStateChanged`, `getIdToken`, `signInWithCustomToken`, `signOut`, `initializeFirestore`, `getFirestore`, `memoryLocalCache`, `doc` e `getDocFromServer`; `inMemoryPersistence` também existe. As declarações instaladas aceitam `initializeAuth(app,{persistence})`, `initializeFirestore(app,{localCache:memoryLocalCache()})`, refresh boolean de `getIdToken` e referência de `getDocFromServer`.

`authStateReady` é **método da instância Auth**, não export de topo de `firebase/auth`. Sua assinatura é `authStateReady(): Promise<void>` e o método de aridade zero está nos prototypes das implementações Node e browser instaladas, conferidos sem construção/chamada. O adapter já usa `faAuth.authStateReady()` e `fbAuth.authStateReady()`, portanto nenhuma incompatibilidade concreta de export/assinatura foi encontrada. Essa conferência não homologa persistência, restauração de sessão, fallback de instâncias existentes ou fluxo real em navegador.
