# Simulação privada da separação de Gestão — v2

Preparação local em 8 de outubro de 2026. V1 permanece preservada, com seu bloqueio
registrado. V2 usa os mesmos backups selecionados, abertos somente em memória,
e acrescenta o contrato estreito de autoria arquivada e a revisão Auth opt-in.
Nenhum documento Firestore, conta Auth, permissão, Rules, gatilho, serviço,
publicação ou estado do aplicativo foi alterado por este ensaio.

## Escopo e classificação

FA `sahmt-17a16`: 365 documentos em 43 árvores selecionadas, readTime
`2026-10-09T01:04:07.736Z`. FB `sahmt-gestao-5ae66`: zero documentos em 44 árvores
selecionadas, readTime `2026-10-09T01:00:13.416Z`. COMPLETE é relativo ao escopo
capturado; não é exportação global. Auth tem horário próprio e não é atômico com
Firestore. As capturas não certificam contexto fresco para uma escrita futura.

| Proposta documental | Quantidade | Prova local |
| --- | ---: | --- |
| COPY OWNED | 52 | 12 áreas conferidas no catálogo, 5 documents e 35 scopedDocuments vinculados às áreas capturadas. |
| COPY MIXED | 82 | 40 configurações e 40 atividades Forms com ID/área/escopo/versão correspondentes, 1 designação e 1 histórico com vínculo de área. |
| KEEP_FA MIXED | 47 | 40 requests, 4 vídeos e 3 registros de progresso/recibo/conclusão preservados. |
| KEEP_FA SOURCE_ONLY | 184 | 60 perfis, 60 ACLs, 31 contatos, 31 eventMembers, 1 accessRequest e 1 appConfig. |
| REBUILD | 0 | Nenhum saldo, crédito ou estado derivado reconstruído. |

O plano v2 tem **134 operações propostas e 231 registros mantidos em FA**, sem
conflitos estruturais. `readyForReview:true` refere-se ao planejamento offline.
`productionAuthorized:false` permanece. Coleção, título, e-mail ou categoria
PERFORMANCE isolados não autorizam COPY. Não se comprovou ausência de documentos
fora das árvores selecionadas.

## Autoria histórica preservada

Um UID histórico sem perfil/Auth correspondente aparece em nove campos dos cinco
documents: cinco `createdByUid` e quatro `updatedByUid`. Os nove valores permanecem
iguais aos originais. A exceção existe somente em `manifest.historicalAttributions`,
pinada por path, campo, UID e `documentDigest` de origem; o hash do manifesto
vincula esses metadados ao plano.

O ator tem `ARCHIVED_UNRESOLVED`, `active:false`, `access:false` e `memberId:null`.
Não entra em `identityMappings`, não vira conta, membro, role, lease ou concessão.
A validação aceita somente autoria top-level de documents/scopedDocuments raiz
classificados COPY. Campo diferente, UID já mapeado, duplicata, metadado não
consumido, grants, propriedades escondidas e schema divergente são recusados.

Os 60 mappings válidos de perfis/UID permanecem iguais aos de v1. A identidade
arquivada não permite resolver um login ou criar uma conta fictícia.

## Diagnóstico e seleção Auth

A conferência privada relacionou os 60 UIDs Auth aos 60 perfis capturados. Entre
os 53 conflitos estritos de v1, todos têm `providerData:[]`, zero Google, zero
provedores múltiplos/password/outros, `disabled:false` e `emailVerified:false`.
Não há material de senha presente nos registros brutos examinados. O snapshot
não contém `isAnonymous`; providerData vazio não prova login anônimo.

Esses 53 perfis têm flags active/access verdadeiros na captura de FA. Esses flags
não comprovam identidade Google nem acesso atual. Nenhum desses 53 é UID requerido
pelos dados COPY. Os três UIDs conhecidos requeridos são Google; o quarto UID
não vazio é exclusivamente a autoria arquivada descrita acima.

A opção `deferUnlinkedSource:true` recebe lista explícita dos três UIDs requeridos
e uma atestação privada exaustiva dos 53 candidatos. Ela foi derivada em memória
do packet bruto protegido: pin canônico da lista inteira, relação `localId`/UID,
hashes individuais bruto/normalizado e flags negativos de provider/senha/status.
O hash raw é diferente do plaintextSha256 do envelope, que cobre o packet inteiro.
Digests e flags não demonstram sozinhos autoridade, ausência atual de credenciais,
frescor ou associação correta; a revisão privada permanece obrigatória.

| Resultado Auth offline | Quantidade/estado |
| --- | --- |
| Google CREATE proposto | 7 |
| DEFER_UNLINKED_SOURCE | 53, sem importRecord, conta FB, provider ou permissão |
| CONFLICT | 0 no subconjunto examinado |
| identityMappings | 60 preservados |
| selectedImportReady | true, somente seleção estrutural offline |
| ready / allSourceUsersReconciled | false / false |
| Importações executadas | 0 |

O modo estrito de v1 segue preservado. Prova ausente/extra/duplicada, UID requerido
sem Google, senha/provedor adicional, metadata inesperada, colisão ou destino
existente bloqueiam a seleção inteira. `selectedImportReady` não é gatilho de
importação e não significa que os 53 possam entrar em FB.

Preservar os 60 mapas e oferecer Gestão somente após identidade Google FA válida,
revogação conferida e direitos atuais é uma estratégia coerente. O broker atual
exige usuário FB pré-existente. Provisionamento FB sob primeiro login ainda
precisa de adaptador próprio revisado, pinagem e exclusão de criação concorrente;
esta prévia não o implementa. Um UID de login diferente não pode ser vinculado
automaticamente por nome/e-mail. Nenhum provider Google foi fabricado.

## Ensaio do executor com adaptadores em memória

O helper usou o backup real privado e transporte double com Map local. Contexto,
aprovação, relógio e métrica do double são explicitamente sintéticos e autorizam
somente esse Map. Não comprovam aprovação operacional, frescor, IAM, atomicidade
remota ou corte global da cota. As reservas sintéticas foram cumulativas entre
os três ensaios e não equivalem a leituras Firestore realizadas.

| Ensaio | Resultado | Leituras de pares no Map | Commits no Map | Reserva sintética |
| --- | --- | ---: | ---: | ---: |
| Criação | COMPLETE | 134 | 134 pares atômicos create-only | 536 |
| Reexecução com snapshot/plan atualizados | COMPLETE, 134 SKIPPED_VERIFIED_IDENTICAL | 134 | 0 | 268 |
| Proveniência adulterada no Map | STOPPED, MIGRATION_DESTINATION_DATA_OR_PROVENANCE_CONFLICT | 2 | 0 | 4 |

Total de 808 leituras máximas sinteticamente reservadas; 268 documentos virtuais
(134 dados + 134 migrationOrigins). Todo commit validou ambas as precondições
`exists:false` antes de alterar o Map. Hashs dos dados e da proveniência conferem;
reexecução não mudou o Map; os nove campos históricos conferem exatamente.
FA e o snapshot FB original permanecem com seus hashes iniciais.

O primeiro ensaio identificou uma borda de dados tipados válidos: mapValue:{} sem
fields. O planejador foi corrigido com acesso opcional a sourceCollection/sourceId
e recebeu regressões de mapa vazio top-level, mapa aninhado e array aninhado. O
ensaio completo só foi gravado após a correção estabilizada.

Resultados reais desta preparação: **zero APIs, leituras/escritas Firestore,
importações Auth, concessões, alterações ACL ou execuções de runtime/gatilho**.
Os 40 requests (37 READY e 3 CONFIGURATION_PENDING) permanecem na fonte e não
receberam segundo consumidor. Treinamentos cancelados continuam parados.

## Provas privadas

Pasta ignorada pelo Git: `.local-preview/management-split`. Os artifacts com dados
foram gravados com wx em novos nomes v2, AES-GCM e chave protegida DPAPI CurrentUser;
a abertura e o digest foram conferidos. Nenhuma prova v1 foi substituída.

- management-split-manifest-v2.dpapi.json
- management-split-plan-v2.dpapi.json
- management-split-review-v2.dpapi.json
- management-split-auth-plan-v2.dpapi.json
- management-split-simulation-v2.dpapi.json
- management-split-receipt-v2.json: somente agregado, sem documentos/UIDs/e-mails.
- management-split-auth-conflict-receipt-v2.json: diagnóstico agregado; corrige a
  contagem do receipt Auth v1 excluindo string vazia de identidade, sem substituir
  o receipt antigo.
- prepare-private-split-v2.mjs: helper sem SDK, credenciais ou transporte de rede.

Manifesto SHA256:
`8877c1892918c6f326f079989cd8eba693c0595ade60df2833e7da2015a40cf0`.
Plano SHA256:
`434c65db846cee23c355798d0b1a7aebbb67738de824c281480959394efe5bba`.
Review SHA256:
`b514247e6d18fd114a29f8e96c3abfb2b45c3b1aa0839a5f809fe57dc732d975`.
Simulação SHA256:
`faa3cac16fd77b15661ed74f4191914b56541cc399295879a84aeca86bf39d5c`.

Esses digests canônicos descrevem o plaintext protegido. Os hashes dos arquivos
cifrados diferem e são registrados separadamente na conferência de entrega.

## Antes de uma migração real

Continuam necessários contexto realmente fresco/pinado, orçamento por projeto,
revisão de identidade/ACL, exclusão de concorrência FB, transporte REST/IAM,
checkpoint durável e Rules/broker/cliente/host integrados e validados. Os débitos
não podem ser liberados por timeout ou aumento de métrica presumidamente absorvido.
As projeções de direitos/audiência continuam separadas dos perfis preservados.

Corte de produtores exige journal, pendências drenadas e a validação humana
prevista. Login Google e fluxo em dispositivo/participante real não foram
validados por este ensaio. Gestão/Desempenho não foram ativados por ele.