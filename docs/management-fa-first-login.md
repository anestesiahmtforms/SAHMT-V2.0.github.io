# Primeiro login Google no FA — preparação local

Esta implementação continua desativada por padrão. Nenhuma chamada real a Google/Firebase, alteração de dados, IAM ou serviço foi executada nesta etapa. `signInGoogle()` em `src/auth.js` preserva `signInWithPopup` como padrão; quando a flag específica de primeiro login estiver ligada, executa primeiro o fluxo verificado pelo servidor e só usa o popup se o Gateway confirmar `ALREADY_LINKED`.

## Fluxo preparado

1. A ação explícita de primeiro acesso carrega Google Identity Services e obtém um ID token assinado com nonce aleatório de 256 bits. Não executa `signInWithPopup` antes da decisão do servidor.
2. `src/management-fa-first-login-transport.js` envia apenas token Google e nonce por HTTPS POST para `/v1/auth/first-login`. Exige origem fixa, `no-store`, sem cookies, redirects, URL com credenciais ou logs de tokens.
3. O Cloudflare Worker encaminha a rota separada ao broker somente quando `firstLoginEnabled:true`; o default e a composição local continuam desligados. A rota compartilha admissão/limite de concorrência e supervisão do Worker existente, sem usar o Worker de Etiquetas.
4. `scripts/lib/google-id-token-verifier.js` verifica assinatura RS256, issuer, audience/azp, expiração, `iat`, nonce, `sub` e `email_verified` com chaves públicas Google obtidas por HTTPS e limites de tamanho/tempo.
5. O broker não recebe UID nem autorização do navegador. Ele calcula SHA-256 do nonce, encaminha e-mail/sub já verificados e validade curta para a operação autenticada `FIRST_LOGIN_FA_SIGN` do Gateway. O digest completo não vai no corpo; seus 128 bits iniciais compõem o nonce hexadecimal de 32 caracteres do envelope HMAC. O nonce original nunca chega ao Apps Script.
6. O Apps Script consome esse nonce no ledger existente, sob `LockService.getScriptLock()` e `PropertiesService`, antes dos efeitos Google. A retenção específica dessa operação é limitada a cinco minutos, além da janela do envelope e do skew. Duas tentativas simultâneas com o mesmo nonce não podem assinar duas vezes. Falha de persistência/readback ou capacidade nega o pedido.
7. Sem aceitar UID, o Gateway consulta `accounts:lookup` do FA pelo e-mail verificado, exige uma única conta existente e habilitada, e projeta só UID, e-mail e provedores necessários. Descarta da resposta upstream quaisquer hashes, salts, tokens, claims e demais campos.
8. O Gateway lê, por GET com field mask, somente `active`, `access` e `firstLoginCohort` do perfil FA. Exige `active:true`, `access:true` e `firstLoginCohort:"OPERATIONAL"`. `STRUCTURAL`, `HOMOLOGATION`, classificação ausente/desconhecida e conta inativa são negadas. Essa verificação deriva de cada cadastro FA na hora da tentativa; não existe lista independente de e-mails/UIDs.
9. O Gateway confirma o estado de provedores: retorna `ALREADY_LINKED` somente se o único provedor for Google e seu `sub` coincidir; provedor divergente ou outro provedor é negado. Para primeiro vínculo, assina um custom token FA de 300 segundos com o UID resolvido pelo FA e `claims:{}`.
10. O navegador só então usa `signInWithCustomToken`, confirma o UID, vincula a credencial Google, recarrega o usuário e confere o `sub`. Se o Gateway detectar conta já vinculada, o coordenador chama o fluxo atual `signInWithPopup`. Negativas, falhas de rede e resultados incertos não fazem fallback ao popup, evitando criação de conta por um caminho não autorizado.

O campo `firstLoginCohort` é uma classificação de autorização no próprio perfil FA, não uma lista paralela. Ela não concede privilégios administrativos: o custom token não carrega claims; o perfil/Rules atuais continuam governando permissões. O Gateway não escreve perfil, não promove admin e não altera provedores.

## Código e adaptadores locais

- PWA: `src/auth.js` conecta, sob flag desligada por padrão, `src/management-google-login.js`, `src/management-fa-google-identity.js`, `src/management-fa-first-login.js`, `src/management-fa-first-login-state.js` e `src/management-fa-first-login-transport.js`.
- Worker: rota `/v1/auth/first-login` em `worker-management-auth/worker.js`, handler em `scripts/lib/management-fa-first-login-http.js`; exige `firstLoginEnabled` explicitamente true.
- Broker/verificador: `scripts/lib/management-fa-first-login.js` e `scripts/lib/google-id-token-verifier.js`.
- HMAC cliente/protocolo: `scripts/lib/management-gateway-client.js` e `scripts/lib/management-gateway-protocol.js`.
- Apps Script: operação fechada `FIRST_LOGIN_FA_SIGN` em `apps-script-management-gateway/Gateway.gs`.
- Manifesto local pede escopo OAuth `datastore` para leitura do perfil FA. Isso não significa que OAuth foi consentido ou que o executor tenha autorização Firestore.

Todos os adaptadores de integração aceitam mocks/injeção. O fluxo PWA está conectado localmente sob flag desligada por padrão; broker, Worker e Gateway não foram conectados a endpoint ou credencial operacional.

## O que ainda impede um piloto

1. Os perfis FA atuais não foram consultados/alterados nesta etapa; a disponibilidade e correção de `firstLoginCohort` são desconhecidas. Sem esse campo exatamente `OPERATIONAL`, o Gateway nega por padrão. A marcação dos usuários operacionais, estruturais e de homologação deve ser conferida contra a fonte FA e autorizada separadamente.
2. Segundo a configuração informada pelo administrador, o signer FA dedicado existe, a IAM Credentials API está ativada no FA e no projeto executor, e a prova sintética de `signJwt` retornou HTTP 200. Esses estados não foram reconsultados nesta etapa. Isso comprova assinatura sintética, não leitura real do perfil FA nem disponibilidade do fluxo operacional.
3. O Apps Script precisa de autorização efetiva para consultar usuários do Authentication FA e ler a projeção do Firestore FA. O escopo `datastore` está no manifesto local; o escopo sozinho não concede acesso ao documento. A chamada Firestore anterior relatada retornou 403 relacionado à leitura de FA. Não repetimos a chamada; sua viabilidade sem billing permanece bloqueadora até diagnóstico/autorização em uma etapa própria.
4. O Worker ainda não tem endpoint, segredos, runtime real nem rota Cloudflare configurada. A cópia de homologação HMAC foi encerrada. O broker ainda não possui composição operacional com projeções Firestore/orçamento e armazenamento de leases conectados ao Gateway; as flags seguem desligadas.
5. O OAuth Web Client ID/audience e as restrições de origem Google ainda precisam ser escolhidos e configurados. O ID usado nos testes é sintético.
6. `signInWithCustomToken` pode criar um usuário se ele for apagado entre a verificação de Auth e o uso do token. Não há transação atômica entre Auth, Firestore, assinatura e vínculo. Para piloto deve-se pausar exclusão/alteração cadastral do UID escolhido durante a janela de 5 minutos e conferir novamente a conta imediatamente antes.
7. A revogação feita depois da leitura final do perfil e antes do uso do custom token não pode ser atômica com os serviços Google. A janela é curta, mas não zero. Se isso não for aceitável, o primeiro-login JIT com custom token não atende ao requisito; mantenha o fluxo desligado.
8. Requisições a Authentication/Firestore/IAM são REST POST/GET para endpoints Google oficiais; nenhuma gravação de Auth/Firestore ocorre no servidor, mas a operação `signInWithCustomToken` e `linkWithCredential` do cliente altera o provedor da identidade FA após a aprovação do servidor. Isso é uma ação de produção futura que exige autorização própria.
9. As quotas gratuitas e a disponibilidade do Apps Script/Cloudflare dependem dos limites vigentes das contas. Os mocks não certificam quota, latência, throughput ou custo real.

## Sequência futura, cada ação sujeita a autorização

1. Validar e autorizar a classificação `firstLoginCohort` nos perfis FA, sem incluir structural/homologation. Não criar lista paralela de e-mails.
2. Resolver primeiro a leitura do perfil FA sem assumir que o escopo `datastore` basta; a leitura real anterior relatada retornou 403. Não repetir a chamada sem autorização específica e sem confirmar que não haverá solicitação de billing.
3. Confirmar os grants OAuth/IAM já existentes do executor; não recriar signer nem ampliar papel sem necessidade comprovada.
4. Configurar propriedades privadas do Apps Script somente depois da política protegida de identidades ser preenchida com pares UID/e-mail confirmados. Manter Gateway `enabled:false` e First Login desligado.
5. Configurar OAuth Client/audience e segredos do Worker; publicar somente depois de aprovação específica, manter o endpoint disabled e verificar CORS, no-store, nonce, supervisão e limites de concorrência.
6. Manter UI/flag PWA desligada; testar a rota primeiro com conta sintética sem serviços reais.
7. Para piloto, obter autorização específica para uma conta operacional FA, pausar mudanças/exclusão do UID, habilitar apenas a operação e flag necessárias, confirmar que o perfil continua ativo/acessível, executar um primeiro vínculo, conferir UID/provedor/perfil inalterado e então testar o login repetido pelo `signInWithPopup` existente.
8. Desligar flags/endpoint e retirar segredos se o resultado não corresponder; não apagar/migrar usuários automaticamente. Revisar o resultado agregado antes de qualquer expansão.

## Testes locais

```powershell
node --test tests/management-fa-first-login.test.js tests/management-fa-first-login-transport.test.js tests/management-gateway-client.test.js tests/management-gateway-protocol.test.js tests/management-appscript-gateway.test.js worker-management-auth/worker.test.js
```

Esses testes usam tokens, usuários, documentos e chaves sintéticos. Não chamam Google/Firebase nem alteram serviços.
