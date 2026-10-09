# Transporte da ponte dedicada de Gestão

Preparação local de 9 de outubro de 2026. FA: sahmt-17a16; FB: sahmt-gestao-5ae66.
Não há deployment, credencial, secret gerado, IAM, conta importada ou ligação à PWA.

## Interfaces

createManagementGatewayClient({enabled:false, protocol, fetchImpl, endpoint,
policy, claimResponseNonce, clock, newRequestId, newNonce}) oferece:

- lookupAuthUser({projectId,uid}, context), limitado aos dois projetos pinados.
- signFbCustomToken({uid,claims,issuedAtSeconds,expiresAtSeconds}, context).
- dispose(), cancelando esperas da própria instância sem apagar estado durável.

O protocolo autenticado é injetado pelo host. O cliente exige armazenamento durável
para a aceitação única de respostas; não cria cache de nonce em memória como substituto.
Seu endpoint privado deve ser a URL HTTPS de um deployment Apps Script dedicado,
no formato script.google.com/macros/s/DEPLOYMENT/exec, sem query ou fragmento.
Nenhum endpoint, projeto, UID ou signer é escolhido pelo navegador.

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

O prazo é absoluto: menor entre policy.maxRequestMs e o deadline do caller, no máximo
120 segundos. Cada await é seguido por conferência de clock, cancelamento e prazo
monotônico. Body tem limite de bytes, chunks e UTF8. JSON é autenticado e vinculado ao
pedido antes de ser usado. Timer, dispose e AbortSignal negam respostas tardias.
Não há retry, segundo POST, uso de erro bruto ou liberação de nonce após falha.

A policy exige maxRequestMs, maxResponseBytes (1024 a 65536) e maxResponseChunks
(1 a 512). Seus valores devem caber na policy do protocolo/host; não são defaults
produtivos certificados. GET de redirect e chaves públicas também usam quota do host.
Timers locais e testes Node não comprovam limites de CPU ou clock de Worker publicado.

## OAuth e autorização

A alternativa privilegedGateway do adaptador Google Auth é exclusiva do provider
getAdminAccessToken. Nesse modo, fetchImpl consulta apenas certificados públicos.
A ponte devolve o usuário Auth filtrado ou keyId/signedJwt, nunca o token OAuth Google,
email, hash/salt, atributos livres ou credencial administrativa. O adaptador mantém
validação RSA, identidade Google, revogação e igualdade exata do custom token.

UID/claims/times vêm do núcleo de servidor confiável. O host Apps Script valida o
protocolo, ator, op, signatário e TTL antes da operação administrativa. Quem controla
o Worker/secret continua pertencendo à base de confiança; HMAC não é WIF nem elimina
o poder do signatário. Os direitos IAM e a rotação do secret precisam de revisão.

Um token assinado é provisório. Sua assinatura não confirma autorização FA, vínculo,
lease, CAS/fence ou leitura final FB e não aprova sua entrega à PWA. O núcleo exige
essas etapas antes de entregar o token. As projeções/versionamento, os leitores
Firestore, o CAS/fence e o host Worker ainda não estão integrados.

## Validação

As suítes de cliente e adaptador usam respostas, relógios e RSA sintéticos, sem
rede, OAuth, APIs Google, escrituras ou contas reais. A composição com o protocolo e
Apps Script em VM também é local; não comprova deployment, autorização nativa,
login único ou Safari/iPhone. Operações Auth/IAM não são leituras Firestore, e o
orçamento separado continua obrigatório antes de qualquer futura operação de dados.
