# Desempenho FB exclusivo — preparação em 02/11/2026

Estado após 07:34: código revisado com Astra e enviado aos executores. Corte central executado pelo proprietário às 07:24:44, com drenagem até 07:31:44. Instalador FB concluído às 07:29:14: pasta correta, runtime FB_ONLY habilitado e um acionador. Primeiro ciclo confirmou revisão 1, 58 resumos zerados, nenhum crédito admitido e 11 registros antigos/externos excluídos. Worker próprio ativado com IAM somente leitura e billing desabilitado; conteúdo e flag conferidos por API. Envio pelo GitHub Desktop concluído; a primeira publicação do PWA foi interrompida pelo harness antigo de evaluation-data que não carregava a nova dependência estática. Ajuste do harness não altera saldos ou serviços.

## Instruções autorizadas

- Manter a estrutura atual de Gestão e hospedar Desempenho FB dentro do módulo FB.
- Novo saldo começa em zero. Não importar nenhum crédito anterior.
- Creditar somente atividades nativas de FB após effectiveFrom: ciência, teste, sugestões aprovadas, atividades de Gestão e treinamentos locais já validados.
- Recusar Checklist de FA, ocorrências FC, QMENTUM, FD, FE e demais entradas externas. O projeto em que um documento está armazenado não basta como evidência de origem.
- Publicar e ativar ao finalizar, sem nova confirmação de implantação e sem etapa de testes manuais. Billing não pode ser habilitado.

## Destinos fixos

- Firebase: sahmt-gestao-5ae66; billingEnabled=false confirmado por API.
- Conta executora esperada: anestesiahmtforms2@gmail.com.
- Cloudflare: 679464db2379db8562b62ae982f30471.
- Pasta Drive: 1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj. O instalador executado pelo proprietário move o próprio script e verifica a pasta; o grant administrativo drive.file recebeu appNotAuthorizedToFile ao tentar mover um arquivo criado pela Script API.
- Worker publicado e ativo: sahmt-fb-performance. Identidade própria fb-performance-reader, somente datastore.entities.get/list no FB.
- Apps Script criado na conta FB: 1c5MjrI-TDGO-ydKHGKJO9J-G2KOA4S7qZhNFdz65PMA0HOza3ItUYreh. Fonte em apps-script-fb/FbPerformance.gs e domínio gerado por scripts/build-fb-performance.mjs. Grava somente fbPerformanceRuntime, fbPerformanceReference, fbPerformanceAwards, fbPerformanceLedger e fbPerformanceSummaries no projeto FB.

## Inventário e comportamento

O livro evaluationAwards contém 11 créditos: 10 Checklist/CHECKLIST_SIGNATURE e 1 OCCURRENCE/FC_OCCURRENCE_VERIFIED com origem FC. Não há scores ou htmlTrainingScores existentes na consulta completa. Nenhum desses 11 créditos participa do novo saldo. Eles não foram apagados nem alterados nesta preparação.

O leitor do PWA passa a consultar o serviço próprio quando VITE_FB_PERFORMANCE_ENABLED=true. As atividades, solicitações, permissões, revisão de gestores e autenticação existentes são mantidas. GOVERNANCE continua na avaliação existente. Em PERFORMANCE, o saldo e histórico vêm exclusivamente da nova projeção. Treinamentos HTML locais integram esse mesmo saldo com eventos após o marco; o painel anterior de soma é suprimido para evitar duplicidade. Nenhum cartão novo é adicionado na Home.

O processador verifica tanto a primeira emissão quanto a data original da participação/score após o marco. Todas as coleções de origem usam o mesmo readTime. A referência fica PENDING antes de sobrescrever qualquer projeção e só é confirmada ao final; o leitor reconfirma referência e runtime. Estado pendente mantém polling, sem mostrar saldo parcial. Respostas de provas não são copiadas para o livro de pontos.

O candidato central foi construído a partir de leitura autenticada do código central ao vivo, preservando os cortes FC e arquivos não envolvidos. Só altera EvaluationLedger e EvaluationChecklistDelivery e acrescenta FbCentralCutover. O proprietário executou pararCreditosExternosFbV1: modo FB_ONLY, marco 2026-11-02T10:24:44.534Z, ativação não anterior a 2026-11-02T10:31:44.534Z. Acionadores e histórico não foram removidos. O guard no HEAD deixa a ciência do Checklist aceita sem pontos. Implantações antigas versionadas não foram alteradas por esse upload; a exclusão no novo saldo independe delas e é imposta pela projeção própria.

## Preparação concluída

- Inventário real somente leitura, sem identificadores pessoais no relatório.
- Candidato central criptografado com Windows DPAPI em .local-preview/fb-performance/central-candidate.dpapi.json.
- Pacote Apps Script gerado em .local-preview/fb-performance/apps-script-bundle.json.
- Bundle Worker e compilação independente FA/FB/enquetes concluídos.
- Nenhum teste manual ou escrita artificial de negócio realizado.
- Identidade IAM somente leitura, chave protegida por DPAPI e secret do Worker criados; Worker próprio ativado após conferência de 58 saldos na revisão 1. Runtime/acionador FB instalados, com effectiveFrom=2026-11-02T10:31:44.534Z e historyImported=0.

## Acessos e pendências atuais

- Cloudflare FB autenticada: anestesiahmtforms2@gmail.com e conta 679464db2379db8562b62ae982f30471 confirmados por API. Subdomínio anestesiahmtforms2 já existe; nenhum Worker existia no inventário.
- Consulta de assinaturas retorna 403; usuário confirmou visualmente Free — Current plan. Nenhuma API de assinatura ou billing foi alterada.
- Google FB autenticado e pasta permitiu canAddChildren=true.
- API Apps Script habilitada pelo usuário e projeto próprio criado; conteúdo revisado enviado e conferido por leitura posterior. A execução remota scripts.run recebeu 403; autenticação para upload não concede autorização de runtime.
- Regras publicadas: nenhuma regra para fbPerformance*, nenhum match genérico de coleções e default deny; leitura pelo cliente permanece negada.
- Guard central atualizado e conferido após o corte, incluindo correção administrativa de crédito v1 quando a configuração já avançou para v2. O upload preservou propriedades, acionadores e versões implantadas.
- Evidências atualizadas: 2026-11-02-fb-access-progress.json.

## Ordem para concluir o corte já autorizado

1. Autenticações, e-mail/conta/Free e API Apps Script já confirmados.
2. Pacote construído e node scripts/prepare-fb-performance.mjs --apply concluído. O instalador próprio finaliza a movimentação à pasta quando o grant administrativo não permite fazê-la; o relatório registra OWNER_INSTALLER_REQUIRED, sem afirmar localização ainda não verificada.
3. Conferir as regras publicadas: coleções fbPerformance* devem permanecer inacessíveis ao cliente; o leitor usa exclusivamente a identidade de serviço. Não abrir regra genérica para essas coleções.
4. Upload do candidato central somente se o hash remoto continuar igual ao inventariado. Conferir arquivos e manter as implantações existentes.
5. Corte central concluído. Executar instalarDesempenhoFbV1 na conta FB para mover o script, ativar o runtime com effectiveFrom após a drenagem e instalar um acionador de quinze minutos. Instalação repetida recupera acionador ausente e mantém o marco original.
6. Após o marco, executar executarDesempenhoFbV1; confirmar um saldo inicial zero para todos os perfis elegíveis e nenhuma importação.
7. Executar node scripts/activate-fb-performance.mjs --apply: exige marcador central, runtime, ciclo confirmado, pasta correta, resumos completos, origem dos créditos, IAM somente leitura e billing desabilitado antes de ativar somente o Worker FB. Publicar VITE_FB_PERFORMANCE_ENABLED=true pelo GitHub Desktop e conferir revisão pública. A autorização do usuário já é suficiente.

## Reversão

Desativar fbPerformanceRuntime/current.enabled e o flag do leitor PWA; retirar somente o acionador executarDesempenhoFbV1. Manter os créditos FB legítimos já gerados e o marco temporal. Restaurar o modo central apenas por decisão operacional explícita, pois isso voltaria a permitir pontos externos. Não executar exclusões de dados, versões ou regras alheias ao corte.
