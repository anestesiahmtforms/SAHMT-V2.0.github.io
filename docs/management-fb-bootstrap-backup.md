# Backup inicial FB sem métrica completa: integração limitada

Versão 1 — 8 de outubro de 2026. A autorização humana recente distingue FB de FA e permite o backup inicial FB. Este caminho não importa a pausa de FA nem inventa uma observação de zero leituras. O teto FA atualizado pertence ao caminho medido central e não é alterado por este helper.

## Escopo e limite

O arquivo aprovado `backup-scope-FB.json` tem 44 raízes. A captura abrange somente essas árvores no mesmo `readTime`, com `showMissing:true`, incluindo subcoleções sob pais inexistentes. Um resultado vazio desse escopo não prova que não há outras coleções no banco.

`scripts/lib/management-fb-bootstrap-budget.js` é puro: não obtém credencial, relógio, métrica ou documento. Fornece páginas de 1 item, até 250 reservas locais/tentativas, 100 documentos, 2 MiB e 120 segundos. A decisão humana deve valer no dia de cota atual de Los Angeles; a janela preparada dura no máximo 15 minutos desde captureStartedAt, sem modificar a hora real da decisão humana. Uma reserva de 1 antecede cada tentativa de `listDocuments` ou `listCollectionIds`, sem devolução nem retry implícito.

Isso limita as operações locais autorizadas. **Não é uma medição do uso total de FB, teto certificado de cobrança ou interrupção global exata.** O resultado registra `totalUsageKnown:false`, `measuredTotalReads:null` e `exactGlobalCutoff:false`. Não tratar falha IAM, erro HTTP ou série velha como observação fresca; este é um modo de autorização separado, não fallback automático do avaliador medido.

## Policy específica

Criar somente sob o lock FB um arquivo separado `bootstrap-read-policy-FB.json`, vinculado à decisão humana real; não sobrescrever/resetar uma autorização já utilizada no mesmo dia. Campos obrigatórios:

- `schemaVersion:1`, `mode:"FB_INITIAL_BACKUP_WITHOUT_COMPLETE_METRIC"`, `projectId:"sahmt-gestao-5ae66"`, `databaseId:"(default)"`.
- `authorizedPurpose:"MANAGEMENT_INITIAL_FB_BACKUP_ONLY"`, `authorizationSource:"EXPLICIT_HUMAN_CONTINUE_FB"`, `authorizationId` hexadecimal único (32–64 caracteres).
- `scopeSha256` calculado por `fbBootstrapScopeSha256(scope)`; raízes ordenadas, únicas e explícitas.
- `humanDecisionAt` real, `authorizedUntil` fixo e `captureStartedAt` anterior à credencial, em ISO com milissegundos. `captureReadTime` fixo entre esse início e 10 segundos antes.
- `quotaDayStart` calculado pelo helper central, `maximumReservedReads:250`, `reservedReads:0`, `reservationAttempts:0`, `status:"AUTHORIZED"`.
- `totalUsageKnown:false`, `observationSource:"NO_COMPLETE_CURRENT_OBSERVATION"`, `exactGlobalCutoff:false`, `renewalClearsPause:false`, `pausedRequiresReview:false`.

O preflight sem reserva recusa estado já iniciado antes de qualquer credencial. Todos os campos devem ser gravados com write exclusivo e policy atômica; uma autorização iniciada, expirada ou terminada precisa de revisão, sem reset automático no próximo dia.

## Ordem na CLI central

1. Validar destino/escopo e caminhos privados; adquirir o lock FB exclusivo já existente, compartilhado entre capture e preflight. Arquivos de policy, checkpoint e receipt são independentes de FA.
2. Ler a policy de bootstrap e chamar `assessFbBootstrapReadBudget` sem reservation **antes** de obter credenciais. Não chamar o avaliador FA, ler policy FA ou exigir métrica FA. Verificar que a credencial in-memory corresponde ao ator FB esperado, em processo isolado.
3. Obter as opções de `fbBootstrapCaptureConfiguration` e usar o capturador existente. Em `reserveReads`, serializar leitura da policy, decisão e gravação atômica de `nextPolicy`; checar `signal` antes/depois. Só devolver `allowed:true` depois da persistência.
4. Manter proteção DPAPI/AES, fila de checkpoints, dreno e retenção do lock se qualquer policy/pause não puder persistir, conforme CLI existente. Nenhum conteúdo privado ou token vai para receipt/log.
5. Em COMPLETE ou INCOMPLETE, chamar `finishFbBootstrapReadBudget`, gravando o estado terminal com todos os débitos conservados e `pausedRequiresReview:true`. Até COMPLETE consome a autorização inicial; isso não pausa o projeto FB para outros trabalhos autorizados.
6. Receipt deve nomear modo/authorizationId/hash do escopo, uso global desconhecido, reservas locais e snapshot completo ou incompleto. Somente snapshot COMPLETE entra no planner; INCOMPLETE mantém checkpoint privado e não migra nada.

Uma falha antes de iniciar também deve consumir/pausar a autorização preparada conforme o tratamento de segurança da CLI. O helper terminal permite conservar débitos após expiração. Em queda abrupta, manter lock e estado iniciado para revisão; não resumir/recriar a autorização silenciosamente.

## Ensaio local

A suíte `tests/management-fb-bootstrap-budget.test.js` exercita FA negado, escopo, propósito/decisão explícitos, expiração/dia, readTime fixo, reservas e sequência, consumo terminal, páginas pequenas, captura sintética vazia e órfãos, transporte falho e ausência de snapshot utilizável. Os doubles não usam identidade, credencial ou banco reais.

A implementação não executou captura de produção, alterou CLI central, retirou trava FA nem publicou IAM, Rules ou runtime. A integração e execução real pertencem ao agente raiz nesta continuação autorizada.
