# Plataforma de Indicadores SAHMT — FD

## Escopo e acesso

A plataforma fica em `https://rotinas-8a617.web.app`, incorporada em Governança → Resultados dos Indicadores no PWA existente. Quatro ambientes separados: Grupos de Gestão, Registros e Qualidade Assistencial, Pesquisas e Bem-estar, Operação Assistencial. O acesso existente à Governança foi preservado; esta primeira versão exige administrador ativo em FA e administrador ou permissão de indicadores em FD. Nenhum usuário comum recebeu acesso adicional.

O FD guarda apenas snapshots analíticos, análises mensais, planos trimestrais e auditoria separada. Fontes continuam em seus projetos, sem migração de registros. A sessão Google FA é verificada pelo Firebase e os perfis ativos em FA e FD são conferidos no servidor em cada operação. O iframe não recebe token, nome, e-mail ou UID. Origens e janela de origem são verificadas nos dois sentidos. Respostas usam `no-store`; a interface não cria cópia em armazenamento local.

## Catálogo e critérios

Há 61 modelos de indicador: 32 de gestão (incluindo atividades e planos de cada uma das 12 áreas), 19 de registros/qualidade (18 definições QMENTUM e notificações), seis resultados de pesquisas por grupo e quatro operacionais.

Cada modelo tem objetivo, fórmula, unidade, origem e periodicidade. Gráficos de janeiro a dezembro e tabela mensal mantêm lacunas e proteções. Ausência não é zero; zero só é válido com observação/denominador adequado. Mês atual é parcial e mês futuro não participa de análises trimestrais. Metas não aprovadas permanecem pendentes; não se inventa limiar de conformidade. As definições QMENTUM são recalculadas com o motor existente, exigindo contagens, definição aprovada e competência encerrada. Taxas somente informadas ou dados inconsistentes não são tratados como validados.

Medições de grandezas diferentes não são promediadas: acompanha-se a proporção de medições na meta. Duplicatas por indicador/competência e estação/dia são resolvidas por timestamp e versão; empates contraditórios não produzem valor.

## Análise e melhoria

Análise automática mensal é descritiva e baseada no valor, qualidade e comparação disponível; não afirma causas nem faz diagnóstico. O gestor pode registrar uma avaliação crítica de um mês completo e válido, com decisão de monitorar, investigar ou manter. Revisões usam versão otimista e referência ao snapshot utilizado.

Propostas surgem somente após três competências completas, consecutivas e válidas do mesmo trimestre civil, com definições compatíveis. Percentuais são ponderados pelos numeradores e denominadores; contagens são somadas. Proposta automática exige aprovação humana. Fluxo: Proposta → Aprovada → Em execução → Concluída → Reavaliar. O acompanhamento guarda função/área responsável, prazo, evidências e efetividade. Efetividade só pode ser declarada após execução e com acompanhamento documentado. Os campos orientam a não inserir nomes, siglas pessoais ou pacientes; identificadores comuns, contatos e links são recusados. A revisão humana continua necessária para evitar identificação indireta em texto livre.

## Proteção dos dados

Nas fontes operacionais, apenas campos necessários são projetados pela consulta do servidor. Nomes, siglas profissionais, pacientes, prontuários, medicamentos e descrições não fazem parte do conector FA. Identificadores de estação/conta usados para deduplicação ficam somente em memória do compilador e não são gravados nos resultados. Documentos arquivados, inativos, com exclusão em planilha ou sincronização pendente não entram nos cálculos.

Grupos e populações menores que cinco e células/complementos pequenos são suprimidos. Isso reduz exposição, sem constituir garantia de anonimato absoluto. A autenticação, auditoria e infraestrutura continuam identificadas e protegidas. A interface não oferece dados de profissionais individuais nem rankings.

Pesquisas FE usam exclusivamente relatórios agregados publicados. Respostas originais não têm datas e não são ligadas à participação. Por isso os resultados de clima, estresse e epidemiologia aparecem por ciclo, com Equipe (incluindo substitutos) e Residentes; não se fabrica distribuição mensal nem plano trimestral automático desses resultados. Os meses mostram ausência de base cronológica.

Vacinação é retrato anual autodeclarado; não reconstrói meses históricos nem comprova imunização. Treinamentos acompanham a conclusão de progressos iniciados, sem chamar isso de cobertura integral da equipe. Checklists representam respostas registradas, sem denominador fictício de estações esperadas. Volumes de notificações/eventos não são incidência nem prova de qualidade clínica.

## Serviço, atualização e custo

Worker dedicado `worker-indicators`, com credencial própria somente como segredo de servidor. A identidade anterior das pesquisas/treinamentos permanece sem alterações. O IAM dedicado permite leitura nas fontes FA/FB/FC, somente leitura pontual de snapshots no FE e leitura/criação/atualização no FD. IAM é capacidade de projeto, não uma restrição por coleção; a lista de coleções e campos é fixada no conector. Nenhuma origem é escolhida pelo cliente. Não há permissão de exclusão nem novo faturamento/Blaze.

Atualização automática diária: quatro execuções separadas, uma por plataforma, às 04h, 05h, 06h e 07h de Brasília (07–10 UTC). Em 1º de janeiro encerra a referência do ano anterior; nos demais dias atualiza o ano corrente. O botão Atualizar recompila o processo selecionado; há intervalo mínimo de dez minutos, até quatro compilações por plataforma/dia e bloqueio de concorrência. A leitura é limitada por execução/coleção, paginada e projetada; truncamento torna a fonte indisponível em vez de publicar total parcial. Esta é uma base inicial dentro de quotas gratuitas, com capacidade finita, não promessa de escala ilimitada ou tempo real.

Históricos de snapshots e auditoria preservam versões sem dados individuais. Acompanhar consumo e retenção à medida que o volume crescer. A última atualização de cada plataforma é exibida. Uma fonte indisponível é sinalizada, sem virar zero.

## Operação e validação

`node scripts/prepare-indicators-platform.mjs` imprime apenas o plano de infraestrutura; `--apply` provisiona a identidade dedicada e as permissões, preservando políticas existentes. Credenciais e backups ficam em `.local-preview/indicators/`, ignorado pelo Git. Nunca publicar esses arquivos nem regenerar chaves sem necessidade.

`node scripts/indicators-platform-admin.mjs status 2026` mostra situação e quantidade de modelos, sem registros individuais. `refresh 2026 [management|records|surveys|operations|all]` recompila com a credencial privada local autorizada.

Testes: `npm run test:indicators-platform`, `npm run test:indicators-platform-rules` e `npm run test:indicators-platform-browser` (preview sintético local). Build FD: `npm run build:indicators-platform`. Publicação FD: configuração `firebase.indicators-platform.json`, projeto fixo `rotinas-8a617`. Regras preservam os blocos de categorias existentes e negam acesso direto a todas as coleções analíticas, mesmo para administradores. Publicação do Worker usa `worker-indicators/wrangler.toml`; o segredo é `INDICATOR_SERVICE_ACCOUNT_JSON`. FA/FB continuam no fluxo Pages existente.

Não criar índices, permissões, contas ou cobrança adicionais para corrigir uma ausência de dados. Conferir primeiro fonte, período, validação, amostra e logs técnicos sem expor conteúdo sensível.
