# Registro de Indicadores — apresentação mensal

A rota existente **Governança → Registros → Registro de Indicadores** abre um painel mensal, com unidade e calendário de mês/ano. A abertura procura a competência mais recente com informações registradas; rascunhos vazios posteriores não substituem o último mês com dados. Uma seleção explícita no calendário conserva esse período ao alternar unidades. Competências vazias permanecem disponíveis para preenchimento e não aparecem como zero.

O painel utiliza os treze campos da aba **ANESTESIAS** da referência institucional: técnicas anestésicas, procedimentos anestésicos e cirúrgicos, bloqueios com risco de intoxicação, diabéticos/hiperglicêmicos, intoxicação por anestésicos locais e cefaleia pós-punção dural. Os totais reutilizam os agrupamentos já existentes no motor QMENTUM. Dados ausentes, zero e não aplicável continuam distintos; a origem manual/importada e os totais derivados são identificados.

O botão **INDICADORES OBRIGATÓRIOS QMENTUM**, ao final do painel, abre a seleção dos dezoito indicadores atuais. Selecionar um indicador substitui a seleção por seu modal, mostrando primeiro resultado e barras horizontais dos doze meses do ano selecionado. Os percentuais, estados de validação, metas validadas e a tabela de valores preservam o motor anterior. Meses sem resultado não recebem percentual inventado. Voltar retorna à seleção, preservando foco/rolagem; voltar novamente retorna ao painel mensal. Análises trimestrais, ciência, sugestões e pontuação mantêm seus fluxos existentes.

Gestores com concessão FC `manager` têm a alternativa **Entrada manual**. O salvamento continua pelo comando mensal confiável, com controle de versão, revisão, histórico imutável e restrição por unidade. A apresentação não cria concessões de acesso nem altera as regras de Gestão para usuários comuns.

## Persistência

Todos os dados permanecem no Firestore **FC**, projeto `indicadores---sahmt`, banco `(default)`, em `qmentumUnits/{unit}/months/{YYYY-MM}`. Não foi criado outro banco ou namespace de entradas. A consulta do último período lê lotes de até doze documentos, ordenados por `period`, com limite total de 120 competências e validação de sessão/projeto em cada etapa. Definições e históricos existentes não são regravados pela leitura.

A referência de janeiro a junho de 2026 já estava registrada no FC; esta atualização não reimporta nem sobrescreve as competências. Uma divergência entre abas foi conferida com o usuário, que determinou manter o registro canônico existente. Resultados institucionais e relatórios de comparação ficam fora do repositório e das fixtures públicas.

## Próxima etapa: prints

A extração de prints será definida com os exemplos e as orientações do usuário. Esta etapa prepara os campos, o calendário, os gráficos e a alternativa manual, sem interpretar imagens ausentes nem instalar OCR ou sincronização automática da planilha.

## Verificação

Testes cobrem último mês com dados, troca de ano/unidade, ausência versus zero, origem e totais, consultas FC limitadas/autorizadas, preservação de rascunhos em falhas, calendário mensal separado da data do registro, seleção modal e retorno, percentuais horizontais e salvamento no período selecionado. Os testes de navegador usam dados sintéticos e são executados em Chromium/WebKit no CI; nenhuma fixture contém os valores institucionais.
