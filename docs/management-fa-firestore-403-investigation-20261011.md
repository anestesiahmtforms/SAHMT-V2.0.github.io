# FA Firestore 403: investigação e prontidão local

Data: 11/10/2026
Escopo: inspeção local, consulta somente de metadados já autorizada e testes com mocks. Nenhuma leitura de documento foi concluída nesta rodada; não houve escrita, alteração IAM, publicação ou mudança de billing.

## Resultado

O caminho de leitura de perfil do primeiro login FA está corretamente formado no código local:

- `GET https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/%28default%29/documents/users/{uid}`
- Projeção limitada a `active`, `access` e `firstLoginCohort`.
- O Apps Script obtém o bearer token por `ScriptApp.getOAuthToken()` e envia-o por `UrlFetchApp.fetch`; os erros são sanitizados e a resposta é validada antes de usar os campos.
- O manifesto local declara o escopo `https://www.googleapis.com/auth/datastore`, além dos escopos usados pelas outras operações do Gateway.

O endpoint `documents.get` aceita `datastore` ou `cloud-platform`; o verbo GET e a máscara de campos são compatíveis com a API REST. O acesso REST com OAuth de serviço é autorizado por IAM, enquanto as Firestore Security Rules controlam as requisições de clientes Firebase autenticados. As Rules locais não substituem as permissões IAM do principal usado pelo Apps Script.

## Evidência externa somente de metadados

Uma execução somente de leitura do preflight FA confirmou o projeto, o banco `(default)`, localização `southamerica-east1`, modo Native/Standard, `billingEnabled=false`, API/metadata checks disponíveis e que o principal consultado pelo Firebase CLI tem Owner no projeto. Nenhuma leitura ou escrita de documento foi emitida. Essa identidade é a sessão do Firebase CLI e não prova, por si só, qual principal efetivo o Apps Script usará em uma implantação.

Não foi possível fazer um GET controlado do endpoint `documents.get`: antes de emitir HTTP, a renovação local da sessão Firebase CLI foi recusada porque as credenciais expiraram. A tentativa foi interrompida sem retry e sem request ao Firestore. `gcloud` não está instalado neste ambiente.

## O que o 403 histórico não prova

O registro anterior identifica FA e `firestoreStatus:403`, além de uma mensagem da API mencionando billing. Ele não guarda host, verbo, caminho REST nem método Google específico. Portanto, não é possível demonstrar se a resposta veio de `documents.get`, de consulta, de métrica/monitoramento ou de outra operação. O status 403 sozinho não identifica a causa. A inspeção de metadados atual indica billing desligado, mas não reproduz nem explica retrospectivamente a chamada histórica.

Para atribuir a causa com rigor seria necessário um único registro sanitizado da chamada que falhou: serviço/host, verbo, caminho com projeto e UID substituídos por marcadores, escopo/audience, fingerprint não reversível do principal, status e somente campos estruturados seguros (`status`, `reason`, `domain`). Não registrar token, corpo, cabeçalhos de autorização ou documento. Se a leitura real não estiver especificamente autorizada, não executá-la.

## Compatibilidade de custo

Uma leitura pontual `documents.get` não exige Blaze por desenho. O Firestore no Spark tem quota gratuita diária para o banco padrão; a documentação publica 50.000 leituras/dia para uso sem custo. Uma chamada isolada de diagnóstico fica dentro da quota, mas isso não atesta o comportamento de um endpoint que historicamente respondeu 403 nem deve ser tratado como leitura executada. As APIs e recursos pagos devem permanecer desligados.

## Testes locais desta rodada

- 330 testes direcionados para Gateway, contrato Firestore, orçamento e erros: passaram, sem chamadas Google/Firebase.
- `npm run test:management`: 2.542 passaram, 0 falharam, 2 ignorados.
- `npm run build`: passou (355 módulos). Permanecem avisos de variáveis HTML ausentes no ambiente de build, mistura de imports estáticos/dinâmicos e chunk acima de 500 KB; nenhum bloqueou a compilação.
- Sintaxe dos módulos alterados: passou.

## Conclusão operacional

Não há evidência atual de que o GET do perfil exija faturamento. O formato da requisição, escopo local, database ID e metadados do projeto são coerentes. O diagnóstico exato do 403 histórico continua bloqueado pela ausência de endpoint/método na evidência e pela sessão local expirada, não por uma falha local demonstrada. A próxima evidência útil é confirmar o principal efetivo do Web App e, somente com autorização explícita para uma leitura limitada, executar uma única leitura sintética/permitida que registre apenas status e erro estruturado sanitizado.

Isso não conclui a prontidão de produção: o Worker continua sem runtime operacional implantado, o Apps Script operacional não está publicado neste trabalho e a configuração de identidades/flags de produção ainda está pendente.
