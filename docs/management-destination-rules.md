# Rules isoladas de Gestão em FB

## Estado e limite deste preparo

`firestore.management.rules` é uma Rules separada para FB `sahmt-gestao-5ae66`, banco `(default)`. **Não foi publicada e não está referenciada por firebase.json.** As Rules padrão de FA, configurações de deploy, UI e main não foram alteradas por esta preparação.

O contrato de recursos/escopos de Gestão ainda precisa ser reconciliado com as permissões efetivas de FA. Por isso, a única leitura preparada é o **get do próprio lease de autorização**, condicionado ao broker. Todas as listas, escritas de cliente, recursos de Gestão/Desempenho e descendentes ficam negados. Um lease de entrada válido não concede nenhum recurso nesta versão.

A coleção local escolhida e alinhada com os browser adapters é **`managementAuthorizationLeases/{uid}`**. Trata-se de **projeção nova, controlada exclusivamente pelo servidor**, ainda sem criação de documentos reais. O path não significa que uma coleção correspondente tenha sido encontrada ou criada em produção.

## Compatibilidade com broker e sessão

Fonte do contrato: `scripts/lib/management-auth-broker.js:296`–`:310`, `src/management-session.js` e `docs/management-auth-broker-contract.md`.

A sessão FB deve vir da troca do custom token emitido para a identidade reconciliada. As Rules exigem `firebase.sign_in_provider == custom` e as claims exatas:

| Claim | Vínculo obrigatório |
| --- | --- |
| managementSourceProjectId | FA sahmt-17a16 |
| managementMemberId | memberId do lease |
| managementSourceVersion | sourceVersion atual do lease |
| managementSourceHash | sourceHash atual do lease |
| managementPolicyVersion | policyVersion atual do lease |
| managementSourceAuthTimeMs | autenticação FA posterior/igual ao watermark e anterior/igual à confirmação |

Firebase fornece ao mecanismo de Rules a identidade autenticada do projeto de destino e as claims do ID token. O browser não escolhe esses valores como autoridade. O emulador usa tokens mock e não comprova assinatura, IAM ou troca real de token. [Auth nas Rules](https://firebase.google.com/docs/rules/rules-and-auth).

Login Google direto em FB não satisfaz este contrato, mesmo com e-mail verificado. Claims administrativas ou permissões enviadas pelo navegador não acrescentam concessões. Não copiar de FA o predicado que exige Google diretamente: a sessão prevista em FB usa provider custom.

### Schema do lease

O documento possui exatamente os 22 campos normalizados emitidos pelo broker:

- schemaVersion, sourceProjectId, destinationProjectId;
- faUid, fbUid, memberId;
- leaseVersion, grantId, sourceVersion, policyVersion, sourceHash;
- active, revoked, managementAllowed, role, permissions;
- memberAreaIds, managerAreaIds, documentGroups;
- sourceAuthValidAfterTimeMs, confirmedAtMs, validUntilMs.

As Rules conferem UID/path/identidade, versões/hash/política, estados e tempos, tipo normalizado de permissões, limites das listas, grupos permitidos e duplicações. sourceVersion e os tempos precisam ser inteiros dentro do limite seguro do contrato JS. As listas de áreas ficam limitadas a 1000; grupos a GENERAL/RESTRICTED, sem repetição. O servidor continua responsável pela origem íntegra de todos os elementos, seu hash e vínculo com direitos atuais.

O mapa de permissões tem exatamente as 14 chaves booleanas normalizadas do broker: admin, managementRead, managementManage, managementActivityWrite, managementIndicatorsRead, managementIndicatorsWrite, managementPlansManage, documentsManage, equipmentManage, qualityManage, trainingsManage, financeRead, financeWrite e financeManage. Esses campos são legíveis ao próprio titular do lease, mas **não são usados para liberar recursos nesta versão**.

Campos extras, inclusive token, e-mail, snapshots privados ou createdAt, bloqueiam a leitura. O adaptador pode usar o updateTime documental como revisão CAS, sem colocá-lo dentro deste payload. Os adapters devem conservar esse schema ou atualizar o contrato/Rules juntos antes de produção.

## Matriz implementada

| Caminho/ação | Anônimo ou Google direto | Custom sem lease compatível | Custom com lease próprio válido | Admin ou gestor com lease válido |
| --- | --- | --- | --- | --- |
| get do próprio managementAuthorizationLeases/{uid} | NEGAR | NEGAR | PERMITIR | PERMITIR somente próprio |
| get do lease de outra pessoa | NEGAR | NEGAR | NEGAR | NEGAR |
| list/query dos leases, mesmo filtrada por próprio UID | NEGAR | NEGAR | NEGAR | NEGAR |
| create/update/delete de lease | NEGAR | NEGAR | NEGAR | NEGAR |
| users e quaisquer espelhos de autorização | NEGAR | NEGAR | NEGAR | NEGAR |
| managementAreas, activities, interactions/reviews | NEGAR | NEGAR | NEGAR | NEGAR |
| documentos/scopedDocuments, materiais e Forms | NEGAR | NEGAR | NEGAR | NEGAR |
| indicadores, planos, equipamentos e manutenção | NEGAR | NEGAR | NEGAR | NEGAR |
| evaluationAwards/Ledger/Summaries/Reference/Requests/Runtime | NEGAR | NEGAR | NEGAR | NEGAR |
| evaluationManagerReviewEvents e demais eventos | NEGAR | NEGAR | NEGAR | NEGAR |
| fences, provenance, migração e paths não classificados | NEGAR | NEGAR | NEGAR | NEGAR |
| qualquer subcoleção, inclusive sob um lease | NEGAR | NEGAR | NEGAR | NEGAR |

O catch-all é denyall e não acrescenta uma autorização alternativa. Nenhuma escrita de ledger, espelho, provenance ou migração é aprovada para cliente.

Rules de cliente não controlam os acessos privilegiados do servidor/Admin SDK: orçamento, IAM mínimo, CAS/fence, revogação e autorização dos escritores continuam requisitos independentes. [Condições e fronteira de servidor](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Get do lease: falhas e expiração

O get próprio é permitido apenas se o documento existir, estiver ativo/não revogado, managementAllowed for true, identidade e claims coincidirem e `confirmedAtMs <= request.time.toMillis() < validUntilMs`. A confirmação não pode estar no futuro; o prazo deve ser posterior a ela. O horário FA autenticado precisa alcançar sourceAuthValidAfterTimeMs.

Lease ausente, expirado, revogado ou incompatível produz negação da leitura. O browser não consegue distinguir essas causas lendo o lease e não recebe bootstrap de permissão. Deve tratar PERMISSION_DENIED como bloqueio, conservar as pendências anteriores e pedir nova troca ao broker somente no fluxo autorizado. Diagnóstico e reconciliação de ausência/revogação pertencem ao servidor.

A expiração é conferida pelo horário do servidor em uma requisição avaliada. Isso **não remove snapshots já recebidos, não apaga cache e não promete fechar um listener exatamente quando o tempo passa**. O controlador de sessão deve manter seu timer, bloquear e soltar listeners no vencimento, rejeitar cache como prova atual e exigir confirmação do servidor para reentrada.

No primeiro ensaio, um getDocFromServer reutilizando imediatamente o mesmo SDK/target após alteração do lease retornou o snapshot anterior antes da reavaliação. A suite final testa o novo pedido com contexto SDK independente e claims iguais. Não apresentar comportamento do cache como nova concessão do servidor nem afirmar revogação remota de dados já disponibilizados.

O broker atual não inclui grantId ou leaseVersion nas claims. Assim, renovar um lease com mesma versão/hash/política pode permitir a sessão antiga equivalente. A suite comprova esse limite. Isolamento/revogação individual de uma sessão ou dispositivo requer desenho adicional; a Rules não inventa essa capacidade.

Não existe leitura cruzada de Firestore FA nas Rules FB. Mudança/revogação em FA precisa alcançar versão/hash/watermark/tombstone do lease FB; atraso de propagação continua um gate de produção. A expiração limita a janela de entrada conforme a política do servidor, sem provar sincronização entre projetos.

## Access calls e orçamento

O get próprio usa `resource.data`, o documento solicitado. **Não há get()/exists()/getAfter() adicional de Rules nesta versão.** Os recursos negados não invocam consultas de autorização.

O get continua sendo uma leitura do cliente quando servido pelo backend. Listeners, retomadas, retries e operações do broker precisam entrar no orçamento operacional próprio do projeto por dia: FA 45.000 aprovado em 8/10 e FB 35.000 local, com as margens já estabelecidas e sem pausa herdada. Esta Rules não instala esse corte global e não mede consumo.

Quando os recursos forem liberados, consultar o lease via get()/exists() nas Rules poderá acrescentar leituras inclusive para pedidos negados. Há limites de 10 access calls para uma operação/query e 20 para leitura múltipla/transação/batch, além do limite individual; calls em cache podem não contar. Orçar conservadoramente antes de adicionar paths, sem tratar cache como garantia. [Limites e cobrança de access calls](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits).

Queries não são filtradas pelas Rules. As listas de leases ficam negadas explicitamente; nenhuma consulta where(uid==próprio) contorna essa decisão. [Rules e consultas](https://firebase.google.com/docs/firestore/security/rules-query).

## Gates para abrir recursos

1. Reconciliar os schemas/membros/UIDs/permissões e a origem canônica dos registros, preservando direitos revogados e elegibilidade aprovada.
2. Definir por coleção quem lê documento próprio, de área ou equipe, e quem pode criar pedidos válidos; conservar limite servidor nas pontuações e espelhos.
3. Revalidar os escopos existentes de FA e relação vigente no lease. managementAllowed sozinho não é permissão de recurso; admin ou papel sozinho não define migração.
4. Fixar campos públicos e privados. Configs Forms, respostas, fingerprints internos e controles runtime não podem virar catálogo público.
5. Testar queries restritas, terceiros, grupos geral/restrito, revogação, expiração, criação/alteração maliciosa e custo de calls em emulador.
6. Confirmar writers/versionamento de autorização, watermark, CAS/fences, orçamento, backups/rollback e validação real antes da publicação.

Não alterar elegibilidade de ROPs apenas por mudança de ACL da pasta Drive. A equivalência entre ACL externa e elegibilidade do aplicativo continua exigindo a decisão e o vínculo já aprovados, não uma inferência da migração.

## Ensaio local realizado

Foi usado Java 21 e o jar Firestore Emulator 1.22.0 já disponíveis, em **127.0.0.1:8187**, projeto sintético **demo-sahmt-management-rules**. Não foi executado Firebase CLI, não houve obtenção de credenciais, chamada de API produtiva, leitura de documentos reais ou download de emulador. Rules foram compiladas e aplicadas somente ao emulador.

Suite: `tests/management-destination.rules.test.js`. Resultado final: **12/12 testes passaram**, com dados/claims sintéticos. Cada teste tem prazo de 30 segundos e a suite rejeita qualquer FIRESTORE_EMULATOR_HOST diferente da porta localhost exclusiva.

Cobertura: get próprio, terceiros/admin, listas filtradas, todas as escritas, Google direto/provider ausente, claims ausentes/divergentes, watermark, schema inválido/extra, revogação, expiração, recursos/subcoleções denyall e renovação por grant sem isolamento individual.

Com o emulador exclusivo iniciado:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8187'
node --test --test-concurrency=1 tests/management-destination.rules.test.js
```

Este foi **ensaio no emulador**, não apenas inspeção estática. Ele não comprova publicação, identidade real, assinatura do broker, IAM, sincronização de revogação, orçamento produtivo ou Safari/iPhone. [Testes oficiais de Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator).
