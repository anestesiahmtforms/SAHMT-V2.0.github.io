# Núcleo controlado de migração Gestão

## Estado da entrega

O módulo `scripts/lib/management-migration-executor.js` executa um plano local por unidades, através de adaptadores injetados. Não possui cliente Firebase, credenciais, rede, filesystem ou CLI de produção. Sua entrega não migrou documentos, publicou Rules, ativou runtime, rearmou treinamento ou conectou Gestão à interface.

As negações, reexecuções e falhas são verificadas por 60 testes sintéticos em `tests/management-migration-executor.test.js`. A atomicidade em produção depende do transporte real cumprir o contrato abaixo; os testes não comprovam IAM, Firestore real ou participante/dispositivo autenticado.

## Escopo e entradas

A função `executeManagementMigration` aceita:

- `sourceSnapshot`: backup tipado completo/consistente de FA, `sahmt-17a16`.
- `destinationSnapshot`: captura completa/consistente de FB, `sahmt-gestao-5ae66`, incluindo as coleções alvo e `migrationOrigins`.
- `manifest`: classificação, hashes e mapa explícito membro/UID do planejador.
- `plan`: saída de `prepareSplitPlan`, sem bloqueios.
- `approval`: cápsula de contexto autorizado e hashes exatos.
- `adapters`: seis adaptadores descritos adiante.
- `now`, `signal`, `limits`: relógio, cancelamento e limites locais.

O núcleo refaz o planejamento a partir dos snapshots e compara o plano completo, além do digest de seu corpo. Trocar somente o digest de um plano adulterado não permite executá-lo. Os argumentos de dados são copiados antes da primeira espera, para impedir mudança durante um adaptador assíncrono.

A autorização geral já dada pelo usuário cobre a preparação desta separação. A cápsula restringe essa autorização ao conjunto concreto revisável e ao contexto fresco: não serve como uma nova solicitação repetitiva de permissão. A validação humana antes de cortar os escritores antigos de Gestão em FA continua sendo uma etapa independente do pedido original.

### Cápsula de autorização

`approval` exige:

- `schemaVersion: 1`, `authorized: true`, `purpose: "MANAGEMENT_MIGRATION_CREATE_ONLY"`.
- `sourceProjectId: "sahmt-17a16"`, `destinationProjectId: "sahmt-gestao-5ae66"`, `databaseId: "(default)"`.
- `requestId` estável e sem dados pessoais.
- `approvedAt`, `expiresAt`: janela de contexto de no máximo 15 minutos.
- `pins`: `planSha256`, `sourceSnapshotSha256`, `manifestSha256`, `destinationSnapshotSha256`, `aclSha256`, `identitySha256`.

O digest de identidades usa exatamente `snapshotDigest(manifest.identityMappings)`. ACL é um artefato externo protegido e revisado, cujo digest deve coincidir com a prova fresca. Esses objetos não são assinaturas nem um mecanismo de autenticação: somente um executor confiável pode emitir e conferir a cápsula. Não devem ser aceitos de um navegador não confiável como autorização administrativa.

## Adaptadores obrigatórios

Todos recebem `(payload, {signal})`. O núcleo não inicia reintentos. O transporte e a persistência devem respeitar o cancelamento e não completar operações locais tardias sobre checkpoints mais novos.

| Adaptador | Contrato |
|---|---|
| `freshContext` | Retorna um contexto já verificado e com lease; não faz leituras Firestore nesta chamada. As leituras usadas para preparar essa prova devem ter orçamento próprio antes de acontecerem. |
| `reserveReadBudget` | Reserva e persiste margem cumulativa de FB antes da próxima etapa; retorna a prova abaixo. Não limpa pausa nem interpreta renovação como autorização. |
| `pauseReadBudget` | Grava a trava quando uma prova de orçamento é recusada; retorna `persisted`, projeto, `pausedRequiresReview: true` e `renewalClearsPause: false`. |
| `readDestinationPair` | Lê documento e proveniência juntos em uma visão consistente, normaliza documentos tipados e retornos ausentes como `null`. |
| `commitCreatePair` | Cria exatamente documento e proveniência no mesmo commit atômico, com precondição `exists: false` nos dois. Não aceita overwrite, delete, transform, gatilho ou terceiro documento. |
| `checkpoint` | Persiste atomicamente o estado protegido antes de cada commit e após a resposta; confirma `persisted`, `runId` e `state`. Nunca armazena documento bruto em log público. |

### Contexto fresco

A prova de contexto exige os mesmos projetos, banco e `pins`, `verifiedAt` com até 300 segundos de idade, `expiresAt` no futuro, e as confirmações:

- `manifestVerified`, `aclVerified`, `identityVerified`.
- `sourceSnapshotVerified`, `destinationSnapshotVerified`, `sourceStillMatchesBackup`.
- `destinationWriterState: "STOPPED"`, `destinationClientAccess: "DISABLED"`.
- `destinationNativeTriggersAbsent: true`, `firestoreReadsIssued: 0`.

Essas confirmações requerem evidência real no executor futuro. Não basta marcar os booleanos manualmente. O núcleo reavalia o contexto antes de ler e antes de criar, e novamente depois de persistir a intenção se houver espera. FA permanece preservado; não se corta seu escritor como parte do núcleo.

### Orçamento

O modo anterior, com medição do total do projeto, exige em cada prova de reserva:

- Projeto FB, propósito `MANAGEMENT_MIGRATION_CREATE_ONLY`, pausa falsa e renovação incapaz de limpá-la.
- Limite 35.000 e dia de cota `America/Los_Angeles`, iguais ao dia calculado pelo relógio.
- Decisão humana registrada no dia atual.
- Métrica `firestore.googleapis.com/document/read_ops_count`, completa e fresca, com `verifiedAt` e `latestPoint` de até 300 segundos.
- Contagens inteiras não negativas: `reads`, `reservedReads`, `appTrafficReserve >= 5000`, `metricLagReserve >= 2000` e `maximumReads`.
- Reserva com ID único e quantidade cumulativa que aumenta pelo custo reservado a cada etapa.
- `reads + reservedReads + appTrafficReserve + metricLagReserve < 35000`.
- `localReservationOnly: true`, `exactGlobalCutoff: false`.

Os padrões reservam duas leituras para a leitura do par e mais duas antes do commit. Isso é uma decisão conservadora do núcleo sintético, não um teto certificado de uma integração real. O adaptador deve aumentar `limits.readReservation` e `limits.commitReservation` para cobrir os custos reais de sua unidade. Leituras de contexto, ACL, identidade, reconciliação, orquestração e eventuais verificações de FA precisam de sua própria reserva prévia. Não se somam as métricas alternativas de Firestore.

Ao recusar uma prova, o núcleo solicita uma pausa persistente e interrompe. Se gravar a pausa falhar, retorna `readPausePersisted: false`, mantém bloqueio e não tenta outra unidade. O operador precisa resolver a persistência antes de nova execução. A margem local não fornece corte automático global no PWA diante de tráfego simultâneo e atraso de métrica.

### Autorização independente de FB para a cópia

A continuação autorizada usa `USER_AUTHORIZED_BOUNDED_FB_MIGRATION`, validado
por `management-migration-destination-budget.js`. Esse modo é exclusivo da cópia
preparada em FB; não remove a pausa de FA nem depende da métrica de FA. O executor
confere `runId`, os seis pins, path, etapa, prazo fixo e persistência da reserva
antes de permitir I/O. Não aceita esse modo como orçamento do broker contínuo.

Para 134 pares, a CLI limita a reserva local a 804 unidades: 536 para as duas
etapas de cópia e 268 para pós-conferência. O total efetivo do projeto FB continua
**desconhecido**; isso não é medição faturável, teto global ou garantia de cota.
A janela da CLI dura no máximo 180 segundos e não se estende por retries.
Falha preserva reservas, checkpoint protegido e lock para revisão.

Os adaptadores REST, a composição local e o contexto fresco agora estão
preparados, mas não foram usados para copiar produção. Ver o [uso da
CLI](management-migration-cli.md), o [transporte
REST](management-migration-firestore-rest.md) e os [gates de
contexto](management-migration-context.md). Reexecução após interrupção exige
reconciliação concreta; apagar o lock ou criar uma nova autorização para ocultar
um commit incerto não é uma retomada válida.
### Transporte de leitura e commit

`readDestinationPair` deve retornar:

```js
{
  readTime: "RFC3339",
  consistent: true,
  document: null,    // ou {path, fields, createTime, updateTime}
  provenance: null  // ou {path, fields, createTime, updateTime}
}
```

Paths e tipos são revalidados localmente. A captura precisa ser fresca. Documento presente sem proveniência, proveniência órfã ou campos/digests divergentes interrompem a migração.

O payload de `commitCreatePair` contém somente duas `writes`, cada uma com `update.name`, `update.fields` e `currentDocument: {exists: false}`. Um futuro adaptador REST deve usar [documents.commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), cujas escritas são atômicas. O método [documents.batchWrite](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchWrite) não garante atomicidade e não atende este contrato.

A resposta normalizada deve ter `atomic: true`, `committed: true`, `commitTime` fresco e exatamente dois `writeResults`, com paths e `updateTime`. O adaptador REST precisa derivar esses paths da correspondência entre writes enviadas e resultados da API, não de um campo fictício na resposta original.

IAM, principal autorizado, projeto, credencial, endpoints exatos, codificação dos segmentos, ausência de gatilhos e manutenção do isolamento de FB continuam sendo verificações externas obrigatórias. Este núcleo não permite acesso administrativo pelo token de FA no navegador nem decide hospedagem/faturamento.

## Idempotência, dependências e interrupção

O ID de `migrationOrigins` vem do planejador e depende de projeto FA, banco e path original. Dados empresariais, IDs e autoria permanecem tipados. Datas nativas originais são preservadas na proveniência.

Cada operação é ordenada depois de suas dependências explícitas, referências tipadas e relações de IDs conhecidas. Um ciclo pede outro lote revisado e é recusado antes de qualquer adaptador. A atomicidade cobre cada par, não todo o conjunto; o isolamento de FB protege unidades incompletas de exposição prematura.

Reexecução exige novas capturas/provas e plano correspondente. Só retorna `SKIPPED_VERIFIED_IDENTICAL` quando os dados e a proveniência conferem exatamente. Um plano `SKIP` cujo par desapareceu não o recria. Um plano create-only que encontra um par idêntico criado por outra execução pode dispensar a escrita após conferir o par.

`KEEP_FA` e `REBUILD` permanecem classificações do dry run. O núcleo não reconstrói totais, gera créditos, executa `evaluationRequests`, ativa `evaluationRuntime`, aciona gatilhos, importa Auth ou mexe em outbox. `COPY` de uma fila `evaluationRequests` é recusado mesmo se o planejador a classificar como Gestão.

Estados retornados:

| Estado | Interpretação |
|---|---|
| `COMPLETE` | Todas as unidades confirmadas ou dispensadas após equivalência; checkpoint final persistido. Não significa módulo disponível/validado por participante. |
| `STOPPED` | Nenhuma tentativa de commit incerta na unidade atual; motivo e progresso anteriores preservados. |
| `UNKNOWN_COMMIT_OUTCOME` | Houve tentativa de escrita sem prova suficiente de resultado. Não reenviar automaticamente; reconciliar ambos os documentos sob orçamento fresco. |
| `COMMITTED_CHECKPOINT_INCOMPLETE` | O par teve confirmação de commit, mas o checkpoint posterior falhou; receipt preserva essa confirmação. |

Receipts contêm paths, IDs determinísticos, hashes e estados, sem campos de documento, tokens, e-mails ou respostas privadas. Também informam `completedPaths`, `checkpointPersisted`, `readPausePersisted` e `requiresFreshReviewBeforeResume` quando há falha. Checkpoints devem ser protegidos e ignorados pelo Git.

O checkpoint de intenção é exigido antes do commit. Mesmo que uma resposta se perca, a próxima avaliação consegue procurar o par pelos IDs determinísticos. Não se limpam checkpoints antigos nem ações locais pendentes.

## Limites e verificações locais

Padrões: 100 unidades, duração 180 segundos, timeout 20 segundos por adaptador. Máximos configuráveis: 1.000 unidades, 300 segundos, timeout 30 segundos. Nenhum reintento estende a janela. Os adaptadores locais de pausa e checkpoint podem persistir o estado incompleto após cancelamento/fim da janela, com timeout, sem fazer transporte Firestore.

Comando local:

```powershell
node --test tests/management-migration-executor.test.js
```

Resultado observado nesta entrega: **47 testes aprovados**, zero falhas. Abrangem plano adulterado, hashes, autorização/contexto expirados, alteração de ACL/identidades, isolamento/gatilhos, pausa persistente, métrica antiga/incompleta, margem e reservas cumulativas, ordem de dependências, ciclos, pares inconsistentes, reexecução, atomicidade sintética, timeout e checkpoint parcial.

## Trabalho restante antes de migração real

1. Capturas Firestore protegidas de FA/FB com orçamento realmente fresco.
2. Manifesto completo, ACL e identidade reconciliada, incluindo dados mistos e histórico.
3. Provar os adaptadores REST/IAM/persistência e o isolamento sem gatilhos de FB.
4. Montar a cápsula exata a partir da autorização válida e das provas frescas.
5. Realizar a migração controlada e reconciliação completa, sem créditos adicionais.
6. Rules, cliente, produtores e broker confiável de sessão ainda precisam de implementação/validação própria.
7. Validar o fluxo real e obter a validação humana prevista antes de cortar os escritores de Gestão antigos em FA.
