# Nome do responsável na confirmação do Checklist

O Relatório diário exibe o responsável para todas as contas com acesso ao Checklist. Essa informação descreve a primeira posição disponível da escala, considerando férias e substituições. Não é o autor de uma resposta individual.

## Caminho de leitura

- Administradores preservam o listener operacional existente.
- Demais leitores acompanham apenas checklistResponsibilities/{dia}, permitido pelas Rules já publicadas, inclusive sem checklistSign.
- O campo display contém nome, sigla, posição, digest das fontes e validade de dez minutos. Não contém e-mail ou permissões. Dados de cache ou expirados recebem a indicação de atualização pendente.
- O estado de exibição é independente de checklistResponsibilityLive. O leitor, os requisitos e o validador de assinatura continuam no caminho operacional original. A exibição não concede autorização, assinatura ou pontos.
- O histórico usa somente a projeção previamente aceita; não calcula datas passadas com o cadastro atual.

## Produtor e ativação nativa

ChecklistResponsibilityDisplay.gs calcula a mesma seleção no servidor com consultas mascaradas a escala, férias, eventos, contatos e perfil único ativo. Atualiza somente display, preservando snapshot, revision, fingerprint, assinaturas e versões financeiras.

Após publicar o módulo e o escopo monitoring.read, executar somente ativarExibicaoResponsavelChecklist no editor Apps Script autorizado. A função confere operador, métricas frescas e margem antes de ler o Firestore; prepara a projeção atual e, somente após CONFIRMED, instala seu próprio gatilho a cada cinco minutos. Aceitar o novo consentimento de leitura do Monitoring quando solicitado. Não ativar evaluationRuntime, validadores financeiros ou a liberação cancelada de treinamentos.

O resultado esperado é ENABLED, lastProjectionStatus CONFIRMED e displayTriggerEnabled true. Resultado PAUSED_REQUIRES_REVIEW é uma pausa efetiva; não repetir a função automaticamente. statusExibicaoResponsavelChecklist consulta apenas propriedades locais.

## Leituras

A guarda usa somente read_ops_count do projeto FA no dia America/Los_Angeles e o limite aprovado de 45.000. Mantém margens de 5.000 para o app, 2.000 para atraso e reserva cumulativa de 2.500 por rodada, incluindo até quatro tentativas. A reserva não é um teto certificado para índices, tráfego simultâneo ou o app inteiro. O contador conservador pode pausar o produtor após poucas rodadas mesmo com consumo medido menor. A renovação diária não limpa uma pausa; a função nativa manual faz nova avaliação sem apagar reservas do dia.

Métricas atrasadas, incompletas, regressão de relógio, fontes ambíguas ou ausência de margem param o produtor e removem somente seu próprio gatilho. O cliente identifica resumo expirado. O prazo operacional da rodada é fixo em 120 segundos e conferido entre chamadas e após o commit. UrlFetch é síncrono e não cancela uma RPC já enviada; retorno tardio mantém a pausa, não repete escrita e não instala o gatilho.

## Rollback

Remover somente o gatilho refreshExibicaoResponsavelChecklist e desabilitar seu estado próprio. Reverter o PR da interface se necessário. Preservar dados de autoria, snapshot de assinatura e reservas. GitHub Pages não publica Apps Script; código remoto e ativação precisam de provas separadas.

## Diagnóstico do Monitoring

Se a ativação parar em CRD_MONITORING_UNAVAILABLE, preservar a pausa e executar somente diagnosticarMonitoringResponsavelChecklist no mesmo módulo. A função confere o consentimento granular e a identidade do token, comparando apenas se coincide com o operador; consulta o Monitoring sem e com projeto de quota explícito. Não consulta o Firestore nem modifica propriedades, reservas, pausa ou gatilhos.

O resumo contém HTTP, status de autorização, motivos restritos e mensagem de erro redigida, sem token, e-mail, URL de autorização ou corpo de documento. HTTP 200 neste diagnóstico confirma apenas acesso ao serviço: não mede o orçamento diário completo nem autoriza retomada. A ativação continua exigindo métrica fresca, margem e projeção CONFIRMED.
