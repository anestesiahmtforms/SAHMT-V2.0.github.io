# Leituras PDF de Gestão suspensas por decisão do usuário

> Registro histórico da suspensão de 24/10. Em 25/10, o usuário determinou a exclusão definitiva do modelo antigo. O leitor e os preparadores citados abaixo foram removidos do código local. A suspensão remota registrada aqui não comprova a implantação dessas exclusões no Apps Script ou no PWA publicado.

Em 24/10/2026, o usuário determinou interromper as leituras de PDF em Gestão e
não continuar mesmo após a recuperação do Apps Script. Não testar para retomar,
reinstalar o leitor, reativar sincronização ou executar os preparadores de leitura
sem nova autorização explícita do usuário.

Suspensão aplicada no projeto Apps Script existente às 23:26 (São Paulo), pela
função administrativa `suspenderLeiturasPdfGestaoV1`, de `ManagementPdfPause.gs`.
O comando usa a autorização existente do operador e não utiliza URL Fetch.

Resultado confirmado no registro da execução:

```json
{"code":"MANAGEMENT_PDF_READING_PAUSED","readingEnabled":false,"pdfSyncEnabled":false,"scheduledContinuations":0,"automaticContinuation":false,"firestoreReads":0,"firestoreWrites":0,"formWrites":0}
```

Propriedades persistentes: `SAHMT_READING_ENABLED=NO`,
`SAHMT_DOCUMENT_PDF_SYNC_ENABLED=NO`,
`SAHMT_MANAGEMENT_PDF_READING_PAUSED=YES`. Não há prazo de expiração.
Removidos somente os agendamentos de `continuarLeituraDocumentosGestaoFbV1`,
`retomarLeituraDocumentosGestaoFbV1` e `atualizarPdfsGestaoAlteradosV1`.
Documentos, políticas, recuperação, respostas e demais acionadores preservados.

A configuração do servidor bloqueia também clientes já instalados; não foi
necessário publicar outra versão do PWA. O teste local
`node --test tests/management-pdf-pause.test.js` verifica autorização, escopo da
remoção dos acionadores, idempotência e preservação das propriedades restantes.
