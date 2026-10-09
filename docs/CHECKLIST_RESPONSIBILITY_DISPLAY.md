# Nome do responsável na confirmação do Checklist

O PR #29 contém a proposta preparada para exibir o responsável no Relatório diário a todas as contas com acesso ao Checklist. A interface ainda não foi publicada. Essa informação descreve a primeira posição disponível da escala, considerando férias e substituições. Não é o autor de uma resposta individual.

## Estado confirmado em 9 de outubro de 2026

O diagnóstico nativo às 08:29:44 de São Paulo confirmou monitoringReadAuthorized true, authorizationRequired false e principalMatchesOperator true. As duas chamadas ao Monitoring, sem e com projeto de quota explícito, retornaram HTTP 403, PERMISSION_DENIED: o método exige faturamento no projeto 1072832154794, correspondente a FA, sahmt-17a16.

O diagnóstico não emitiu leituras de documentos do Firestore e retornou stateChanged false. Faturamento não foi autorizado nem ativado. A pausa original CRD_MONITORING_UNAVAILABLE permanece registrada e o gatilho de exibição continua desligado. Esse resultado não é uma medição do consumo atual.

A nova versão do módulo classifica a mensagem conhecida como BILLING_REQUIRED no diagnóstico e CRD_MONITORING_BILLING_REQUIRED na guarda. Isso melhora a identificação de uma futura falha; não altera o estado histórico nem libera a pausa. Não repetir a ativação ou o diagnóstico já conhecido, trocar a ligação GCP ou remover a guarda para contornar o bloqueio.

## Caminho de leitura proposto

- Administradores preservam o listener operacional existente.
- Demais leitores acompanham apenas checklistResponsibilities/{dia}, permitido pelas Rules já publicadas, inclusive sem checklistSign.
- O campo display contém nome, sigla, posição, digest das fontes e validade de dez minutos. Não contém e-mail ou permissões. Dados de cache ou expirados recebem a indicação de atualização pendente.
- O estado de exibição é independente de checklistResponsibilityLive. O leitor, os requisitos e o validador de assinatura continuam no caminho operacional original. A exibição não concede autorização, assinatura ou pontos.
- O histórico usa somente a projeção previamente aceita; não calcula datas passadas com o cadastro atual.

## Produtor e condição para ativação nativa

ChecklistResponsibilityDisplay.gs calcula a mesma seleção no servidor com consultas mascaradas a escala, férias, eventos, contatos e perfil único ativo. Atualiza somente display, preservando snapshot, revision, fingerprint, assinaturas e versões financeiras.

Uma nova execução de ativarExibicaoResponsavelChecklist depende de uma solução concreta para o acesso ao Monitoring e de nova reavaliação humana do bloqueio. A publicação do código ou a renovação da cota não autorizam essa retomada. Não há passo de ativação a executar agora.

Se a retomada for autorizada após a solução, a função nativa confere operador, métricas frescas e margem antes de ler o Firestore; prepara a projeção atual e, somente após CONFIRMED, instala seu próprio gatilho a cada cinco minutos. Não ativa evaluationRuntime, validadores financeiros ou a liberação cancelada de treinamentos.

O resultado esperado nessa futura ativação é ENABLED, lastProjectionStatus CONFIRMED e displayTriggerEnabled true. Resultado PAUSED_REQUIRES_REVIEW é uma pausa efetiva; não repetir a função automaticamente. statusExibicaoResponsavelChecklist consulta apenas propriedades locais.

## Leituras

A guarda usa somente read_ops_count do projeto FA no dia America/Los_Angeles e o limite aprovado de 45.000. Mantém margens de 5.000 para o app, 2.000 para atraso e reserva cumulativa de 2.500 por rodada, incluindo até quatro tentativas. A reserva não é um teto certificado para índices, tráfego simultâneo ou o app inteiro. O contador conservador pode pausar o produtor após poucas rodadas mesmo com consumo medido menor. A renovação diária não limpa uma pausa; a função nativa manual faz nova avaliação sem apagar reservas do dia.

Métricas atrasadas, incompletas, regressão de relógio, fontes ambíguas ou ausência de margem param o produtor e removem somente seu próprio gatilho. O cliente identifica resumo expirado. O prazo operacional da rodada é fixo em 120 segundos e conferido entre chamadas e após o commit. UrlFetch é síncrono e não cancela uma RPC já enviada; retorno tardio mantém a pausa, não repete escrita e não instala o gatilho.

## Rollback

Remover somente o gatilho refreshExibicaoResponsavelChecklist e desabilitar seu estado próprio. Reverter o PR da interface se necessário. Preservar dados de autoria, snapshot de assinatura e reservas. GitHub Pages não publica Apps Script; código remoto e ativação precisam de provas separadas.

## Diagnóstico do Monitoring

diagnosticarMonitoringResponsavelChecklist confere o consentimento granular e a identidade do token, comparando apenas se coincide com o operador; consulta o Monitoring sem e com projeto de quota explícito. Não consulta o Firestore nem modifica propriedades, reservas, pausa ou gatilhos. O bloqueio atual já foi identificado; uma repetição depende de uma mudança concreta que justifique nova avaliação.

O resumo contém HTTP, status de autorização, motivos restritos e mensagem de erro redigida, sem token, e-mail, URL de autorização ou corpo de documento. HTTP 200 neste diagnóstico confirmaria apenas acesso ao serviço: não mediria o orçamento diário completo nem autorizaria retomada. A ativação continua exigindo métrica fresca, margem e projeção CONFIRMED.
