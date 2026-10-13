# Transporte da ponte dedicada de Gestão

Preparação local de 10 de outubro de 2026. FA: sahmt-17a16; FB: sahmt-gestao-5ae66;
FC: indicadores---sahmt. Não há deployment, identidade de runtime confirmada,
credencial, secret gerado, IAM, conta importada ou ligação à PWA.

## Interfaces

createManagementGatewayClient({enabled:false, protocol, fetchImpl, endpoint,
policy, claimResponseNonce, clock, newRequestId, newNonce}) oferece:

- lookupAuthUser({projectId,uid}, context), limitado a FA, FB e FC pinados.
- signFbCustomToken({uid,claims,issuedAtSeconds,expiresAtSeconds}, context).
- signFcCustomToken({uid,claims:{},issuedAtSeconds,expiresAtSeconds}, context),
  com signer/identidade FC independentes e sem claims de permissão.
- dispose(), cancelando esperas da própria instância sem apagar estado durável.

O protocolo autenticado é injetado pelo host. O cliente exige armazenamento durável
para a aceitação única de respostas; não cria cache de nonce em memória como substituto.
Seu endpoint privado deve ser a URL HTTPS de um deployment Apps Script dedicado,
no formato script.google.com/macros/s/DEPLOYMENT/exec, sem query ou fragmento.
Nenhum endpoint, projeto, UID ou signer é escolhido pelo navegador. Este cliente
é a chamada privada Worker→Apps Script; o endpoint público Cloudflare Worker ainda
não existe neste checkout. O adaptador servidor agora fica em
`worker-management-auth/apps-script-gateway-adapter.js`; `worker.js` o injeta no
factory confiável do broker, sem configurar bindings de produção.

## Transporte e limites

O POST usa somente JSON do envelope assinado, com cache desabilitado, cookies
omitidos, referrer omitido e redirect manual. O Content Service do Apps Script
redireciona sua resposta a uma URL temporária. O cliente aceita no máximo um 302/303
para script.googleusercontent.com/macros/echo, com os parâmetros user_content_key
(e lib opcional), então faz GET sem o corpo ou headers originais.
[Content Service](https://developers.google.com/apps-script/guides/content)

HTTPS, host, path, porta, usuário, senha, fragmento, duplicação de parâmetros e tamanho
da URL são verificados. Outro redirect ou resposta implicitamente redirecionada nega.
A URL temporária permanece somente em memória e não deve aparecer em logs.
As formas reais do redirect e da resposta ainda precisam ser conferidas no deployment;
um formato diferente é negado, sem fallback ou ampliação automática de hosts.
O Apps Script Content Service usa uma URL temporária de conteúdo e a documentação
orienta clientes HTTP a seguir esse redirect. Como não há deployment deste Gateway,
o status e os headers concretos ainda não foram comprovados aqui; o cliente aceita
somente 302/303 e um GET para o host/path/query restritos citados acima.

O prazo é absoluto: menor entre policy.maxRequestMs e o deadline do caller, no máximo
120 segundos. Cada await é seguido por conferência de clock, cancelamento e prazo
monotônico. Body tem limite de bytes, chunks e UTF8. JSON é autenticado e vinculado ao
pedido antes de ser usado. Timer, dispose e AbortSignal negam respostas tardias.
Não há retry, segundo POST, uso de erro bruto ou liberação de nonce após falha.

A policy exige maxRequestMs, maxResponseBytes (1024 a 65536) e maxResponseChunks
(1 a 512). Seus valores devem caber na policy do protocolo/host; não são defaults
produtivos certificados. GET de redirect e chaves públicas também usam quota do host.
Timers locais e testes Node não comprovam limites de CPU ou clock de Worker publicado.

Para o Cloudflare Free, o Worker permanece sem rota e sem bindings. A composição
faz até duas chamadas externas para cada operação de Gateway (POST e GET do redirect),
mais os serviços externos do fluxo principal. O limite publicado para Workers Free
é 50 subrequests externos por invocação. A Durable Object SQLite tem limites gratuitos
diários de requests, duração, linhas e armazenamento; exceder uma quota Free faz as
operações daquele tipo falharem, não é uma garantia de disponibilidade contínua.

## OAuth e autorização

### Modelo de acesso do Apps Script

Um futuro Web App pode ser configurado para executar como proprietário; nesse
modo o código roda com a autoridade do proprietário mesmo quando a chamada vem
de outro serviço. Para o Worker chamar sem sessão Google interativa, a publicação
precisaria permitir acesso anônimo. O Worker não enviaria OAuth Google; envia
somente o envelope HMAC por HTTPS. A configuração exata de acesso pode estar
limitada por políticas da conta e ainda precisa ser verificada manualmente antes
de qualquer implantação.

Essa URL deve ser tratada como pública. HMAC autentica quem conhece o segredo,
não a identidade Google da origem nem os direitos do usuário. O segredo fica em
Cloudflare Secret binding e Apps Script Script Property; ele nunca vai ao
frontend nem é colocado no TOML. Gateway valida formato, assinatura,
audience/projeto/operação, TTL e nonce antes de obter OAuth ou chamar serviços.
O endpoint também pode ser chamado diretamente por terceiros: HMAC impede o
efeito privilegiado, mas não impede tentativas de uso que consumam execução,
lock ou cotas Apps Script. Esse risco residual de disponibilidade não é eliminado
pela assinatura e precisa ser aceito/mitigado antes da publicação. Não há
retry automático, e qualquer falha de validação, estado ou transporte nega.

O Worker usa redirect manual: POST autenticado somente para `script.google.com`,
validando Location antes de um GET sem corpo nem headers originais para
`script.googleusercontent.com`. Não se deve mudar para redirect automático,
porque Cloudflare alerta que cabeçalhos podem ser encaminhados entre hosts.

A alternativa privilegedGateway do adaptador Google Auth é exclusiva do provider
getAdminAccessToken. Nesse modo, fetchImpl consulta apenas certificados públicos.
A ponte devolve o usuário Auth filtrado (com marcador fechado de identidade protegida
somente para FA) ou keyId/signedJwt, nunca o token OAuth Google, e-mail, hash/salt,
atributos livres ou credencial administrativa. O adaptador mantém validação RSA,
identidade Google, revogação e igualdade exata do custom token. Antes de assinar para
FC, o broker verifica que a conta Auth já existe, está ativa e tem o mesmo UID; isso
evita que `signInWithCustomToken` abra uma conta FC automaticamente.

UID/claims/times vêm do núcleo de servidor confiável. O host Apps Script valida o
protocolo, ator, op, signatário e TTL antes da operação administrativa. Quem controla
o Worker/secret continua pertencendo à base de confiança; HMAC não é WIF nem elimina
o poder do signatário. Os direitos IAM e a rotação do secret precisam de revisão.

Um token assinado é provisório. Sua assinatura não confirma autorização FA, vínculo,
lease, CAS/fence ou leitura final FB e não aprova sua entrega à PWA. O núcleo exige
essas etapas antes de entregar o token. A integração local do broker, Worker, cliente
Apps Script e coordenador PWA usa flags desligadas e mocks. Ela não comprova
deployment, autorização nativa ou funcionamento em conta/dispositivo real.

## Validação

As suítes de cliente e adaptador usam respostas, relógios e RSA sintéticos, sem
rede, OAuth, APIs Google, escrituras ou contas reais. A composição com o protocolo e
Apps Script em VM também é local; não comprova deployment, autorização nativa,
login único ou Safari/iPhone. Operações Auth/IAM não são leituras Firestore, e o
orçamento separado continua obrigatório antes de qualquer futura operação de dados.
