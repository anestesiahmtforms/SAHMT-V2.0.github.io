# Variante do inventário para a fonte nativa preservada

`apps-script/ManagementMigrationInventoryNative.gs` é uma variante local separada.
Sua função pública é `consultarInventarioMigracaoGestaoNativaSahmtV2`. Não altera
`ManagementMigrationInventory.gs` nem os 12 módulos originais. A variante foi adicionada isoladamente ao editor em 9/10/2026, com backup cifrado e readback dos 17 arquivos.
Os nomes da variante são distintos dos nove nomes do helper anterior e dos nomes
observados nos 16 arquivos nativos. A publicação isolada, backup, readback e
ativação humana ficam a cargo da composição responsável.

## Fonte observada e correspondência

A captura atual protegida contém 16 arquivos: 15 .gs e o manifesto. A revisão
abrange os mesmos 12 módulos conhecidos. Dez deles coincidem com o código local
após normalizar LF; ChecklistValidation e FormsEvaluation diferem.

As fontes atuais desses dois módulos são byte a byte iguais aos seis backups
históricos da preparação PR28. O receipt de helpers registra o consumidor legado
preservado e conferido; o receipt de retirada registra preservação dos outros 15
módulos, restauração do manifesto e propriedades intactas. O receipt privado
`native-current-inventory-review-20261009.json` liga esses fatos ao SHA256 do
plaintext do backup DPAPI atual e ao hash da variante preparada. Dados privados
continuam no backup protegido e na memória do diagnóstico; não entram no Git.

O inventário anterior recusou corretamente quatro funções Checklist divergentes.
A nova variante é pinada à fonte real preservada, com **232 funções/13 constantes**
nos 12 módulos conhecidos. Inclui quatro helpers adicionais de apresentação
simplificada em FormsEvaluation. O pinset anterior permanece inalterado; esta
revisão não substitui código para fazer um gate passar.

## Diferenças concretas do consumidor legado

- installChecklistValidationTrigger e validatePendingChecklistSignatureRequests
  não chamam evaluationAssertOperator_.
- readTrustedChecklistSnapshot_ usa leitores diretos, sem os wrappers de
  transaction/evaluationGet_/evaluationQuery_.
- validateChecklistSignatureRequest_ usa criação de assinatura e scores em commit
  direto; não usa evaluationRunTransaction_, evaluationApplyChecklistTransfer_ ou
  gravação da projeção de responsabilidade.
- FormsEvaluation acrescenta consultarPadraoFormulariosSahmtV2,
  formsPresentationStableModel_, formsPresentationSafeError_ e
  formsPresentationPrivateArtifact_; nenhuma função anterior foi removida.

Config, as 13 constantes conhecidas e o roteamento FA/default continuam iguais.
A variante observa essa configuração. **Não aprova a semântica antiga de
pontuação/assinatura**, não ativa o consumidor, não muda público ou elegibilidade,
não zera contadores e não acrescenta uma guarda de cota ao produtor.

## Mesmas limitações do inventário original

Somente o projeto Apps Script conhecido, o usuário executor e a fonte conhecida
estão no escopo. complete permanece false sempre. Quatro arquivos ficam fora da
cobertura conhecida: três módulos adicionais e o manifesto; os demais donos de
gatilhos, PWA, Functions e brokers exigem evidências próprias.

getProjectTriggers cobre apenas gatilhos instaláveis do usuário atual; Trigger não
fornece estado habilitado/suspenso. Por isso presença continua potencialmente
executável com executionState UNVERIFIED, sem inventar enabled false. [ScriptApp](https://developers.google.com/apps-script/reference/script/script-app#getProjectTriggers()), [Trigger](https://developers.google.com/apps-script/reference/script/trigger)

Os campos de ausência global, outros proprietários e complete permanecem false.
Falta de fonte/estado, mudança/dinâmica, handler desconhecido e falha nativa
mantêm writerState UNKNOWN. Lista vazia não produz STOPPED. O único estado positivo
RUNNING_FA_ONLY designa capacidade configurada da fonte conhecida; não certifica
execução em andamento nem ausência global de escritores FB.

A única saída é retorno/log sanitizado. Não chama produtores, Firestore, métricas,
Auth ou rede; não obtém token e não escreve propriedade/gatilho. Os testes públicos
usam uma fixture mínima da forma legada e comprovam recusas e limites; essa fixture
não substitui o pin real. O diagnóstico local em VM compara o pin com a captura
protegida em memória, sem consultar estado nativo ou dados de negócio.
