# Inventário nativo somente leitura de Gestão

Arquivo local separado: `apps-script/ManagementMigrationInventory.gs`. A pasta dos
módulos originais neste worktree é `apps-script-v2`, com 12 arquivos .gs. O helper
não foi publicado e não modifica módulos, manifesto, propriedades, cursores ou
checkpoints existentes. O registro histórico de 16 módulos do editor precisa de
uma conferência atual própria; os quatro módulos adicionais não são presumidos.

## Função preparada

`consultarInventarioMigracaoGestaoSahmtV2` observa apenas o projeto Apps Script
conhecido e o usuário executor. Não invoca funções de produtores, Firestore,
Cloud Monitoring, Auth, Drive, Forms ou Sheets; não obtém token, instala/remove
trigger ou escreve propriedades. O único output é o retorno e log sanitizado.
A execução nativa fica para a composição responsável quando o editor estiver
pronto. A definição local da função não é uma captura de produção.

A revisão pinada deriva de 228 funções e 13 constantes dos 12 módulos atuais.
O helper compara `Function.prototype.toString` com SHA256 da fonte real, normaliza
apenas finais de linha e trim externos e verifica digests das constantes por
serialização ordenada. Compara também o hash do projeto Apps Script informado no
contexto original e o roteamento real de `SAHMT_V2_CONFIG` / `firestoreDocumentsUrl_`.
Não chama o resolver para descobrir o alvo: sua fonte precisa coincidir exatamente
com a implementação revisada que usa projectId e databaseId da configuração.
Mudança legítima na fonte exige revisão e pins próprios; não atualizar hashes
somente para remover um gate. Esses hashes não autenticam sozinhos uma captura.

Divergência, módulo/função ausente, accessor dinâmico, alvo inesperado, falha nativa
ou handler desconhecido deixa writerState UNKNOWN, configuração não verificada e
complete false. O alvo conhecido FB é relatado somente como mudança para revisão.
Um alvo desconhecido nunca expõe seu valor bruto. O helper não declara STOPPED,
mesmo com lista vazia: os caminhos manuais continuam presentes no código.

## Limites de cobertura

`scope: APPS_SCRIPT_CURRENT_PROJECT_ONLY`, `triggerVisibility: CURRENT_USER_ONLY`.
`complete`, `destinationNativeTriggersAbsent`, `otherTriggerOwnersInventoried`,
`unknownManualOrSimpleProducersInventoried` e
`globalNativeProducerAbsenceCertified` permanecem false.

`ScriptApp.getProjectTriggers()` enumera os gatilhos instaláveis do projeto e do
**usuário atual**. Não enumera gatilhos de outros proprietários. [API ScriptApp](https://developers.google.com/apps-script/reference/script/script-app#getProjectTriggers())

A API Trigger informa handler, origem e evento, sem campo de estado suspenso ou
habilitado. Presença é emitida como PRESENT, executionState UNVERIFIED e
potentiallyExecutable true. Não preencher enabled false a partir dessa leitura.
IDs nativos, IDs de Forms/Sheets e nomes de handlers desconhecidos não são lidos
ou emitidos; jobRef é somente um número local da observação. [API Trigger](https://developers.google.com/apps-script/reference/script/trigger)

O estado RUNNING_FA_ONLY significa **capacidade configurada dos produtores
conhecidos na fonte revisada**, não confirmação de execução corrente. Cada job
conhecido recebe alvo FA somente após todas as verificações; o helper não garante
que foi executado, que não há requisição já em andamento, que não existem
produtores adicionais ou que FB está globalmente parado.

Não converter diretamente esse packet em producerInventory completo. A composição
confiável ainda precisa conferir fontes publicadas atuais, demais módulos,
proprietários de gatilhos, PWA, Functions, broker e quaisquer produtores
configurados. A configuração verificada e seu digest são uma parcela dessa prova;
não constituem registry aprovado, autorização, contexto fresco ou corte FA.

## Propriedades e saída segura

Somente três propriedades declaradas são lidas individualmente:

- SAHMT_V2_EVALUATION_ENABLED;
- SAHMT_V2_EVALUATION_HOMOLOGATED;
- SAHMT_V2_TRAINING_RELEASE_JOB.

Flags viram NOT_CONFIGURED, EXPLICIT_TRUE, EXPLICIT_FALSE ou UNKNOWN. Do checkpoint
só sai um status permitido ou UNKNOWN; nenhum ID, digest privado, URL, e-mail,
gabarito, token ou documento bruto é emitido. Ausência e flags false não provam
STOPPED nem desativam processo algum. Não consulta evaluationRuntime para completar
a evidência, porque isso exigiria leitura Firestore.

As contagens firestoreDocumentReadsIssued, firestoreWritesIssued,
metricsRequestsIssued, authReadsIssued, authWritesIssued, propertyWrites,
triggerWrites, financialWrites, externalRequestsIssued e allSideEffects são zero.
allSideEffects designa mutações ou chamadas externas de negócio; o log e as
leituras nativas de configuração/gatilhos continuam ocorrendo.

A data observedAt vem do início real da consulta e a duração precisa ficar abaixo
de 30 segundos. Não preencher uma data corrente para reutilizar observação velha.
A configuração/hash são gerados somente quando projeto, fontes, constantes,
propriedades e gatilhos conhecidos foram conferidos nessa chamada.

A suíte `tests/management-migration-native-inventory.test.js` avalia os módulos e
o helper em VM com stubs adversariais. Não usa API, dados reais nem publicação e
não certifica o código que está no editor nativo.
