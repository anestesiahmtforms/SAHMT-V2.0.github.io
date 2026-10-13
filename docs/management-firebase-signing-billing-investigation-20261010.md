# Investigação: assinatura de tokens FA + FB + FC sem billing

Data: 10/10/2026
Escopo: histórico local, documentação oficial e testes locais. Nenhuma consulta remota foi feita nesta revisão; nenhum billing, IAM, API, regra, usuário ou serviço foi alterado.

## Conclusão executiva

O HTTP 403 do registro de 09/10 **não é evidência de falha de `signJwt`**. O log visível classifica a chamada como `firestoreStatus: 403`, identifica `sahmt-17a16`, indica `billingEnabled: false` e mostra a mensagem de billing para o número `1072832154794` (projeto FA). O screenshot não preserva método HTTP nem caminho REST; não é possível nomear com rigor o método Firestore que recebeu a resposta. O número citado corresponde ao FA, não a FB/FC.

O inventário independente de metadados do FB, em 09/10, registrou `iamcredentials.googleapis.com` como `DISABLED`, sem permissão `iam.serviceAccounts.signJwt` para o ator examinado e sem qualquer chamada de assinatura. Para FC, esse inventário não foi feito. Portanto, o erro de Firestore e o bloqueio IAM são fatos diferentes.

A documentação atual do IAM define a operação `POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{SA}:signJwt`, exige scope OAuth `iam` ou `cloud-platform` e `iam.serviceAccounts.signJwt` no recurso da conta-alvo. A página de preços do IAM informa que o uso da API é gratuito. Não encontrei requisito geral documentado de associar billing para `signJwt`; isso torna a solução **provavelmente compatível** com Spark, mas não comprova que habilitar/usar a API será aceito nas configurações atuais de FB e FC. A prova conclusiva depende de habilitação da API e uma chamada controlada — operações que não foram autorizadas agora.

## O que o 403 permite afirmar

| Campo do registro histórico | Evidência e limite |
| --- | --- |
| Diagnóstico | Execução `MONITORING_DIAGNOSTIC`, somente leitura, `projectId: sahmt-17a16`. |
| Chamada recusada | `firestoreStatus: 403`; a resposta segura diz que o método exigia billing. `userInfoHttpsStatus: 200`. |
| Projeto apontado pela mensagem | `1072832154794`, correspondente ao projeto FA `sahmt-17a16`. A resposta não aponta FB nem FC. |
| Método REST | Não aparece no screenshot retido. O log chama a chamada de Firestore; sem URL/método redigidos, não dá para distinguir `documents:get`, `runQuery`, `batchGet`, operação de metadados ou outro método. |
| IAM Credentials | Não foi a origem demonstrada desse 403. O inventário separado do FB marcou a API como desativada e não executou `signJwt`. |

Não repetir essa chamada durante esta etapa local. Se futuramente for autorizada uma nova investigação, o logger deve guardar apenas serviço, verbo, host, caminho com IDs substituídos por marcadores, projeto consumidor, status e `reason`/`domain` seguros; nunca token, corpo do documento ou cabeçalhos sensíveis.

## Viabilidade de `signJwt` em Spark

O plano Spark inclui Firebase Authentication customizada sem custo; Firestore também mantém a cota gratuita diária por projeto. O modo de assinatura remota com `signJwt` não usa Blaze por definição do protocolo Firebase: o Google assina com chave privada gerenciada da service account, sem exportá-la. Para FB e FC, a conta signer precisa pertencer ao respectivo projeto e o OAuth principal do Apps Script precisa de `iam.serviceAccounts.signJwt` somente naquela conta. A API precisa estar habilitada no projeto da conta signer.

O IAM não cobra pelo uso da API segundo a tabela oficial. Porém, as provas atuais são incompletas: FB estava com `iamcredentials.googleapis.com` desligada; FC não tem inventário de API nesta auditoria; o principal efetivo do Apps Script ainda não está identificado; nenhuma chamada `signJwt` foi feita. Assim, recomendação técnica: **manter `signJwt` como primeira opção, condicional a prova sem billing**, e não migrar para Blaze como tentativa. Se habilitar a API ou chamar `signJwt` devolver erro de billing, parar e não associar conta; tratar a arquitetura abaixo como não viável sob a restrição atual.

## Alternativas

| Caminho | Segurança | Custo / Spark | Manutenção e compatibilidade | Recomendação |
| --- | --- | --- | --- | --- |
| IAM Credentials `signJwt` pelo Apps Script Gateway | Chave privada fica gerenciada pelo Google; grant mínimo por signer; Worker/PWA nunca recebem credencial administrativa. Exige principal Apps Script estável, HMAC e replay guard do Gateway. | IAM API publicada como gratuita; sem Blaze documentado. Apps Script e Worker têm quotas gratuitas próprias. Não comprovado em FB/FC até a prova controlada. | Reaproveita o desenho atual e cria um token independente para cada projeto. Mantém UID e claims FB derivados do broker; FC não herda claims FB. **Opção preferida se a chamada sem billing passar.** | Prova local concluída para protocolo; teste real aguarda aprovação específica. |
| Firebase Admin SDK em runtime Google gerenciado com identidade automática | Chave não exportada, identidade de runtime nativa e modelo operacional mais simples. | Cloud Functions Firebase requer Blaze; Cloud Run requer billing do host. Fica fora da diretriz de nenhum billing. | Excelente tecnicamente, incompatível com a exigência de custo/conta de faturamento zero. | Rejeitada para este desenho. |
| Chave JSON de service account em Worker/Apps Script | Funciona sem `signJwt`, mas a chave privada exportada vira segredo duradouro que precisa ser copiado, rotacionado e revogado. | Pode evitar um serviço adicional faturado, mas aumenta muito o risco operacional. | Fácil de implementar e fácil de expor em backup, log ou configuração errada. Contraria expressamente a restrição de não exportar chave. | Rejeitada. |
| Login Google direto em FB e FC, sem custom token | Evita assinatura IAM; cada Firebase valida o próprio provedor Google. O token OAuth/ID deve permanecer apenas no cliente e o fluxo de consentimento precisa ser tratado com cuidado. | Google Auth está disponível no Spark. | Não prova a mesma UID Firebase entre projetos; requer configurar provedores/client IDs em cada projeto e repensar reconciliação, autorização e sessão. Não atende hoje o contrato de mesmo UID / broker. A credencial recuperada de um login não é automaticamente um token FA reutilizável. | Alternativa de redesenho, não substituta drop-in. |
| Chave privada artesanal guardada como secret do Cloudflare | Segredo não vai ao navegador, mas a chave exportada fica sob operação do projeto e exige rotação/revogação. | Workers Free tem cota limitada; sem custo enquanto dentro dela. | Remove IAM, mas piora o modelo de segredo e foge da regra do usuário. | Rejeitada. |
| Cloudflare WIF direto | Só seria válido com emissor OIDC de workload comprovado, sujeito/audiência estáveis, trust condition e troca STS limitada. | Pode evitar billing Firebase, mas adiciona dependências e configuração de identidade federada. | Não há neste trabalho prova de uma identidade OIDC nativa do Worker que satisfaça esse contrato. Não presumir token de usuário Cloudflare como identidade do Worker. | Não recomendada sem prova independente. |

O Firebase aceita tokens customizados assinados no servidor e impõe um JWT com UID e expiração curta. Também é possível autenticar com credencial Google federada em cada projeto, mas isso cria/resolve identidades por projeto e muda o contrato de UID. [Custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [Google Sign-In no Firebase Web](https://firebase.google.com/docs/auth/web/google-signin), [vínculo de provedores](https://firebase.google.com/docs/auth/web/account-linking).

## Custo operacional esperado

- **Firebase FA/FB/FC:** permanecem no Spark; a autenticação customizada é listada como sem custo. Firestore mantém suas cotas gratuitas separadas por projeto. [Planos Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [quota Firestore](https://firebase.google.com/docs/firestore/pricing).
- **IAM Credentials:** uso da IAM API indicado como gratuito. Isso não substitui habilitar a API nem o grant no signer. [Preço IAM](https://cloud.google.com/iam/pricing).
- **Cloudflare Workers Free:** 100.000 requests por dia por conta, 10 ms de CPU por invocation e 128 MB; exceder a cota pode rejeitar requests, não liberar uma cobrança sem mudança de plano. [Limites](https://developers.cloudflare.com/workers/platform/limits/), [preços](https://developers.cloudflare.com/workers/platform/pricing/).
- **Apps Script:** quotas por usuário: URL Fetch 20.000/dia em conta consumer e 100.000/dia em Workspace; Properties 50.000/500.000 por dia, armazenamento total 500 KB, valor individual 9 KB e seis minutos por execução. Valores sujeitos a mudança. [Quotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas).
- **Desenvolvimento local:** sem infraestrutura ou custo adicional.

Essa comparação é uma estimativa de plano/quota publicada, não medição de carga da aplicação nem garantia de disponibilidade. A validação de criptografia em VM e signers sintéticos não equivale a chamada real da IAM Credentials.

## Componentes locais em andamento

O coordenador já restringe alvos a FB/FC, não guarda token FA após o broker, não aceita `uid` divergente, executa login secundário de modo isolado e limpa sessão tardia da tentativa obsoleta. O logout secundário usa somente Auth já inicializado, tenta FB/FC em paralelo e retorna estado parcial sem expor erro bruto. O teste novo cobre troca FA durante signin secundário pendente e confirma que as sessões da tentativa antiga são removidas sem tocar numa sessão nova.

Os demais testes existentes cobrem: sem inicializar Auth com flag falsa; isolamento de FC indisponível/timeout; troca FA enquanto broker aguarda; token/projeto/UID adulterado; atraso de resultados; limpeza global ainda que logout FA ou sessão secundária falhe; geração concorrente e erros sanitizados.

Execução após adicionar o cenário de troca durante o signin: **486/486 testes direcionados** passaram em transporte, Worker, broker, Gateway HMAC, credenciais simuladas, opt-in, isolamento e ciclo de sessão. A suíte ampla anterior continuou como evidência da rodada local anterior; nenhum dos testes alcança IAM ou Firebase remoto.

## Bloqueios antes de implantação

1. Identificar e aprovar a identidade efetiva do Apps Script Web App.
2. Só com nova autorização específica: conferir metadados de IAM em FB e FC, habilitar IAM Credentials se o usuário autorizar, conceder `iam.serviceAccounts.signJwt` por signer, e fazer uma prova controlada sem emitir token de usuário. Não associar billing.
3. Se IAM recusar enable/chamada por billing, encerrar esse caminho e apresentar a opção de login Google direto como redesenho. Não contornar com chave JSON.
4. Completar runtime durável do Worker e validar quotas, isolamento, supervisão e redirect contra endpoints reais antes de pedir autorização de publicação.

## Fontes oficiais

- [IAM Credentials `signJwt`](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt)
- [Preço IAM](https://cloud.google.com/iam/pricing)
- [Permissões de service accounts](https://docs.cloud.google.com/iam/docs/service-account-permissions)
- [Firebase Custom Tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Firebase Spark e Blaze](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firebase Google Sign-In Web](https://firebase.google.com/docs/auth/web/google-signin)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
