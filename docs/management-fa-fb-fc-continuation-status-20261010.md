# FA + FB + FC — relatório de continuidade local

Data: 10/10/2026
Escopo autorizado: código, documentação e testes locais no worktree isolado.
Projetos alvo: FA `sahmt-17a16`, FB `sahmt-gestao-5ae66`, FC `indicadores---sahmt`.

## Resultado executivo

O trabalho existente foi preservado e ampliado. O fluxo local agora representa
FB e FC como destinos independentes: pode pedir só FB, só FC ou ambos; o servidor
deriva a autorização separadamente para cada destino. O helper local de admissão
e supervisão do Worker usa Durable Object SQLite e falha fechado.

**A integração não está homologada nem garante custo zero ainda.** `signJwt` é a
primeira opção: a documentação descreve assinatura com chave gerenciada, exige
`iam.serviceAccounts.signJwt` na conta signer e não publica cobrança pelo uso da
IAM API. O registro antigo 403 é uma falha Firestore no FA, e não uma tentativa
IAM; o método REST exato não foi preservado. Nenhuma prova real de IAM foi feita
em FB ou FC e não se pode afirmar que habilitar a API ou invocá-la funcionará
sem billing nesses projetos. A arquitetura também depende de leituras de
autorização Firestore no fluxo do broker; esse caminho precisa ser provado dentro
do Spark, sem contornar a mensagem de billing.

## O que foi resolvido localmente

- O broker aceita alvos individuais ou ambos, sempre com IDs de projeto fixos.
- FB requer no servidor `admin`, `trainingsRead` ou `trainingsManage` e vínculo
  FA→FB confirmado.
- FC requer `admin`, `managementIndicatorsRead` ou
  `managementIndicatorsWrite`; não depende da permissão, vínculo, Auth ou lease
  FB. A autorização do navegador nunca é aceita como concessão.
- O resultado por alvo diferencia `READY`, `DENIED` e `UNAVAILABLE`; erros e
  signers de um destino não são herdados pelo outro.
- O ciclo local de sessão continua com login principal FA, Auth FB/FC carregado
  somente sob opt-in, logout global, troca de usuário, invalidação de resposta
  tardia e cleanup isolado.
- A PWA local mostra opções independentes de conexão Educação (FB), Resultados
  (FC), ou ambos; cada opção só aparece quando seus flags de destino estão
  habilitados e só inicializa Auth após clique. Com o ambiente atual, a UI não
  aparece porque flags gerais/FB estão ausentes e FC está `false`.
- O contrato local mantém HMAC-SHA256, audience/direção/projeto/operação pinados,
  hash do corpo, nonce e request ID aleatórios, expiração curta, claim anti-replay
  atômico no Gateway, retenção de tombstones após timeout e redirect do Apps
  Script limitado a uma URL Google de resposta validada. Logs/erros externos são
  sanitizados nos testes.
- O Worker de autenticação é separado do Worker de Etiquetas. O Durable Object
  local guarda só ID aleatório de slot e expiração; não guarda ID token, UID, IP
  ou payload. Admissão/supervisão usam TTL limitado e negam se storage ou
  `waitUntil` não estiver disponível.
- Flags no `.env.example` permanecem `false`; no ambiente local desta rodada,
  `VITE_INDICATORS_FIREBASE_ENABLED=false`, os flags gerais/FB estão ausentes e
  endpoint/origin do broker não estão configurados (fail-closed). Nenhuma regra, coleção, dado,
  permissão IAM, API ou serviço Firebase/Cloudflare foi alterado nesta etapa.

## Verificações mínimas e bloqueios para publicação

1. Descobrir, com autorização específica, a identidade efetiva do Web App Apps
   Script. O Gateway deve executar como uma identidade estável e explicitamente
   identificada; o email do gestor não prova a identidade de execução.
2. Provar habilitação e chamada `signJwt` sem billing em FB e FC. Se o Console ou
   API exigir conta de faturamento em qualquer etapa, interromper o caminho sem
   associá-la. Não exportar chave JSON.
3. Provar que as leituras estritamente necessárias para autenticação e
   autorização do broker (FA e FB) funcionam sem billing, com escopos/roles
   mínimos e dentro dos limites diários já definidos para cada projeto. O erro
   403 antigo foi chamado Firestore do FA; o screenshot não contém URL nem método,
   então não se pode dizer qual endpoint/método foi recusado.
4. Completar a composição hospedada do Worker: adapters reais de verificação FA,
   leitura de projeção/permissões, lease FB, signers independentes, fetch HMAC ao
   Gateway, orçamento de leituras, redaction e reconciliação.
5. Conferir redirect real do `ContentService`, escopos OAuth efetivos e quotas
   do principal do Apps Script. O contrato/VM local não observa deployment real.
6. Fazer a verificação técnica mínima com contas internas autorizadas e uma
   pequena carga controlada; revisar regras de acesso FB e FC em processo
   separado antes de liberar o uso geral. Nenhuma policy de Firestore foi
   ativada aqui.

## IAM `signJwt`: requisito e prova proposta

A API `iamcredentials.googleapis.com` deve estar habilitada no projeto da conta
signer. O Apps Script precisa de access token OAuth com scope
`https://www.googleapis.com/auth/iam` (ou o scope mais amplo
`cloud-platform`, que não é preferido). O chamador necessita somente
`iam.serviceAccounts.signJwt` no recurso da service account signer específica.
Não conceder `roles/iam.serviceAccountTokenCreator` se uma role customizada com
somente essa permissão puder ser usada.

Desenho mínimo a validar, ainda não criado:

| Projeto destino | Signer dedicado | Grant no recurso | Executor que receberia o grant |
| --- | --- | --- | --- |
| FB `sahmt-gestao-5ae66` | service account dedicada FB | `iam.serviceAccounts.signJwt` apenas nessa conta | identidade estável do Apps Script, após confirmação |
| FC `indicadores---sahmt` | service account dedicada FC | `iam.serviceAccounts.signJwt` apenas nessa conta | mesma identidade estável do Apps Script, após confirmação |

Roteiro para futura prova real, somente após autorização separada para habilitar
API/conceder IAM/executar a prova:

1. Fazer apenas inspeções read-only de projeto, API enabled state, signers já
   existentes, identidade executora e grants efetivos. Sem habilitar nada nessa
   fase.
2. Aprovar individualmente API, criação/uso de cada signer e grants mínimos em
   FB e FC. Não associar billing.
3. Enviar `signJwt` com claims sintéticos não utilizáveis por usuário, sem
   `uid` real, email, Firestore, token customizado Firebase ou dados de negócio.
4. Verificar apenas resposta HTTP, `kid`, assinatura usando chave pública do
   signer e redaction do resultado. Não enviar o JWT a Firebase Auth.
5. Em qualquer resposta pedindo billing, parar imediatamente, registrar somente
   serviço/operação/status seguro e não tentar uma alternativa com chave privada.
6. Revogar os grants de prova e documentar resultado. A ativação continua
   desligada até autorização posterior.

## Custo zero e alternativa se IAM não passar

Uma rota integralmente gratuita **é plausível, não certificada**: Firebase Spark
para os três projetos, Workers Free com Durable Objects SQLite, e Apps Script
dentro das quotas consumer. A IAM API publica uso sem custo, mas a habilitação/
chamada específica ainda não foi provada sem billing. O erro Firestore do FA é
um segundo ponto de incerteza independente. Se qualquer recurso exigir billing,
esta arquitetura não pode ser homologada sob a diretriz atual; pare nesse ponto.

Alternativa sem custom token: autenticar cada projeto diretamente com Google
Sign-In no navegador. Isso produz identidades Firebase separadas por projeto;
mesmo email/Google UID pode ser usado como chave de associação de negócio, mas
UIDs Firebase não são garantidos iguais. Cada projeto precisa da sua política de
permissões e projeção. O token FA não serve como token FB/FC. O login secundário
pode exigir consentimento/popup ou passos de recuperação e não garante uma única
ação de login em todos os browsers. Portanto, é um redesenho de identidade e UX,
não substituto direto do broker. A Home/FA pode continuar operacional se essa
etapa falhar, desde que o fluxo secundário continue opt-in.

## Estimativa para 55 pessoas

Com uma troca de sessão por pessoa/dia, a ordem de grandeza esperada é pequena
frente às quotas publicadas: 55 requests Worker/dia, cerca de 110 chamadas ao
Durable Object (admissão/liberação), e poucas dezenas a poucas centenas de
requests UrlFetch do Gateway, conforme o número real de leituras e assinaturas
por alvo. Isto é estimativa de arquitetura, não medição nem limite garantido.

O Worker Free publica 100.000 requests/dia e 10 ms CPU por invocation. Durable
Objects SQLite Free têm 100.000 requests/dia, 5 milhões de linhas lidas/dia,
100.000 escritas/dia, 5 GB por conta e 1 GB por objeto; exceder limite Free faz
a operação falhar. Apps Script consumer publica 20.000 UrlFetch/dia e 50.000
leituras/gravações Properties/dia, com máximo de 30 execuções simultâneas por
usuário. A quota Spark de Firestore é independente em cada projeto e segue como
risco principal porque o número de leituras reais de autorização por troca ainda
não foi medido; o valor histórico FA 403 não pode ser convertido em custo ou
contagem de leituras.

O Durable Object local tem limite configurado por padrão de 8 trocas simultâneas
(máximo do helper: 32). Acima do limite, nega fechado com resposta de capacidade;
55 logins simultâneos não estão comprovados. Para uso normal distribuído entre
55 profissionais, o volume diário estimado parece folgado, mas deve-se validar
rajada, duração de Apps Script e quotas antes de mudar o limite.

## Ações manuais futuras e aprovação necessária

| Serviço | Ação manual eventual | Autorização específica necessária |
| --- | --- | --- |
| Firebase FB/FC | Inspecionar estado IAM; habilitar IAM Credentials API se autorizada; criar/selecionar signer dedicado; conceder apenas `iam.serviceAccounts.signJwt` por signer | Sim, para API, criação de signer e cada grant; parar se billing for exigido |
| Firebase FA/FB | Confirmar como as leituras de autorização serão atendidas sem billing e quais identidades/roles/escopos mínimos são necessários | Sim para qualquer grant, enablement ou leitura remota de diagnóstico |
| Google Apps Script | Confirmar conta executora; adicionar scope `iam`; configurar Script Properties com segredo HMAC e configuração allowlisted; implantar Web App “executar como proprietário” | Sim, para alterar escopos/propriedades e implantar; não fazer nesta etapa |
| Cloudflare | Criar/deploy do Worker dedicado, binding SQLite Durable Object/migração, URL fixada, segredo HMAC e fail-closed route | Sim, para criação de namespace, segredo, endpoint e deploy; não tocar Worker Etiquetas |
| PWA | Inserir endpoint público aprovado e flags de cada destino depois da prova real | Sim, autorização de ativação separada |

Nenhuma dessas ações externas foi executada. O presente pedido autoriza apenas
preparação e testes locais.

## Publicação direta e reversão

Não será criado ambiente separado de homologação. O caminho mínimo proposto é:

1. Fechar implementação e testes automatizados locais; revisar diff, build,
   flags desligadas e configuração fail-closed.
2. Obter autorizações específicas pendentes para API/IAM e executar a prova
   sintética de `signJwt`; parar se houver exigência de billing.
3. Após prova técnica real aprovada, submeter a publicação da infraestrutura
   dedicada do broker e do Gateway para autorização específica. Não tocar no
   Worker Etiquetas.
4. Fazer a verificação mínima real: sessão FA, tokens independentes FB/FC,
   logout/troca, isolamento de falhas e funcionamento da Home; então apresentar
   a ativação geral da PWA para autorização separada.

Reversão: manter flags da PWA desligadas até a autorização de ativação; em
incidente, desligá-las primeiro. A infraestrutura deve permitir desabilitar o
runtime/rota do Worker e restaurar a versão anterior do Gateway sem alterar
dados ou regras. Antes de qualquer publicação, registrar os IDs exatos da versão
anterior do Worker, deployment do Apps Script e artefato PWA para que o rollback
seja executável; ainda não existem IDs de publicação deste trabalho. Nenhuma
publicação ou ativação foi feita nesta etapa.

## Testes desta rodada

- Testes direcionados do broker, HTTP, Firestore adapters/Gateway, protocolo e
  cliente HMAC, OAuth/signers simulados, opt-in, destinos separados, ciclo de
  sessão e Worker/DO local: **941/941 passaram**.
- UI de Gestão e opções independentes de destino: **2/2 passaram**.
- `npm run test:management`: **2.295 aprovados, 0 falhas, 2 skips**.
- `npm run test:domain`: **916/916 passaram**.
- `npm run build`: build Vite concluído. Avisos de variáveis `VITE_*` não definidas
  no ambiente local e avisos existentes de imports/chunks; não houve ativação de
  flags nem publicação.

Os testes são locais e usam tokens, chaves, signers, Auth/Firestore e SQL
sintéticos. Não comprovam IAM, quotas remotas, redirect/deployment GAS ou login
real. Nenhum documento remoto/coleção foi consultado ou alterado e nenhuma regra
Firestore foi modificada nesta rodada.

## Fontes oficiais

- [IAM Credentials `signJwt`](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt)
- [Preço IAM](https://cloud.google.com/iam/pricing)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firestore pricing and free quotas](https://firebase.google.com/docs/firestore/pricing)
