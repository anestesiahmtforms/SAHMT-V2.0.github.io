# Desempenho FB exclusivo — preparação em 02/11/2026

Estado: candidato local preparado e compilado; não publicado e não ativado.

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
- Pasta Drive: 1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj, vazia na listagem do conector.
- Worker candidato: sahmt-fb-performance, desativado por padrão. Identidade própria fb-performance-reader, somente datastore.entities.get/list no FB.
- Apps Script candidato: apps-script-fb/FbPerformance.gs e domínio gerado por scripts/build-fb-performance.mjs. Grava somente fbPerformanceRuntime, fbPerformanceReference, fbPerformanceAwards, fbPerformanceLedger e fbPerformanceSummaries no projeto FB.

## Inventário e comportamento

O livro evaluationAwards contém 11 créditos: 10 Checklist/CHECKLIST_SIGNATURE e 1 OCCURRENCE/FC_OCCURRENCE_VERIFIED com origem FC. Não há scores ou htmlTrainingScores existentes na consulta completa. Nenhum desses 11 créditos participa do novo saldo. Eles não foram apagados nem alterados nesta preparação.

O leitor do PWA passa a consultar o serviço próprio quando VITE_FB_PERFORMANCE_ENABLED=true. As atividades, solicitações, permissões, revisão de gestores e autenticação existentes são mantidas. GOVERNANCE continua na avaliação existente. Em PERFORMANCE, o saldo e histórico vêm exclusivamente da nova projeção. Treinamentos HTML locais integram esse mesmo saldo com eventos após o marco; o painel anterior de soma é suprimido para evitar duplicidade. Nenhum cartão novo é adicionado na Home.

O processador próprio verifica a primeira emissão de cada crédito após o marco, valida a origem nativa e publica resumos com revisão. Resultados incompletos não são publicados como saldo confirmado. As respostas de provas não são copiadas para o livro de pontos.

O candidato central foi construído a partir de leitura autenticada do código central ao vivo, preservando os cortes FC anteriores e os arquivos não envolvidos. Só altera EvaluationLedger e EvaluationChecklistDelivery e acrescenta FbCentralCutover. A barreira fica inativa até executar pararCreditosExternosFbV1. A ciência do Checklist permanece aceita como registro, mas sem criar lançamento em FB.

## Preparação concluída

- Inventário real somente leitura, sem identificadores pessoais no relatório.
- Candidato central criptografado com Windows DPAPI em .local-preview/fb-performance/central-candidate.dpapi.json.
- Pacote Apps Script gerado em .local-preview/fb-performance/apps-script-bundle.json.
- Bundle Worker e compilação independente FA/FB/enquetes concluídos.
- Nenhum teste manual ou escrita artificial de negócio realizado.
- Nenhuma chave, permissão IAM, runtime, gatilho ou deploy de produção criado para FB nesta etapa.

## Acessos pendentes comprovados

1. O perfil Cloudflare disponível enumera só a conta central 1851e9f4cd5f026371beaa2c5a85f1b8. A consulta da conta FB retorna HTTP 403. O perfil sahmt-fb-isolation precisa concluir a autorização oficial com a conta FB.
2. A credencial Firebase da conta FB funciona para Firestore, IAM e billing, mas Apps Script e Drive administrativo retornam HTTP 403. A autorização administrativa Google FB foi iniciada e aguarda conclusão. As sessões novas ficam protegidas por DPAPI.
3. O controle de navegador informa Local browser use is disabled in Work settings. A aba do Chrome logada não pode ser lida por esse controle.
4. Conferir Workers Free da conta FB antes do primeiro deploy. O preparador exige o registro .local-preview/fb-performance/workers-free-confirmed.json com accountId e workersFreeConfirmed=true; não aceita um plano presumido.

## Ordem para concluir o corte já autorizado

1. Concluir as duas autenticações de FB, conferir e-mail/conta/Free e API Apps Script habilitada.
2. Executar node scripts/build-fb-performance.mjs e node scripts/prepare-fb-performance.mjs --apply. O script cria a identidade somente leitura, publica Worker desativado, cria/upload do Apps Script na pasta exata e confere conteúdo e localização por leitura posterior.
3. Conferir as regras publicadas: coleções fbPerformance* devem permanecer inacessíveis ao cliente; o leitor usa exclusivamente a identidade de serviço. Não abrir regra genérica para essas coleções.
4. Upload do candidato central somente se o hash remoto continuar igual ao inventariado. Conferir arquivos e manter as implantações existentes.
5. Executar pararCreditosExternosFbV1 no central e conferir FB_EXTERNAL_CREDITS_STOPPED. Ativar o runtime próprio com ativarDesempenhoFbV1 na conta FB; a função configura effectiveFrom com drenagem de sete minutos e cria somente um acionador de quinze minutos. Pode ser necessária a concessão inicial de permissões do executor pelo Google; não presumir que autorizar o upload autoriza o runtime.
6. Após o marco, executar executarDesempenhoFbV1; confirmar um saldo inicial zero para todos os perfis elegíveis e nenhuma importação.
7. Ativar somente o Worker FB e publicar VITE_FB_PERFORMANCE_ENABLED=true pelo GitHub Desktop. Conferir versão/revisão pública e fontes do saldo. A autorização de publicação do usuário já é suficiente; não pedir nova aprovação de corte.

## Reversão

Desativar fbPerformanceRuntime/current.enabled e o flag do leitor PWA; retirar somente o acionador executarDesempenhoFbV1. Manter os créditos FB legítimos já gerados e o marco temporal. Restaurar o modo central apenas por decisão operacional explícita, pois isso voltaria a permitir pontos externos. Não executar exclusões de dados, versões ou regras alheias ao corte.
