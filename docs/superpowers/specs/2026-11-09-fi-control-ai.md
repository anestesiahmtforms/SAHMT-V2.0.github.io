# Proposta de IA para o SAHMT

Data: 09/11/2026. A proposta original abaixo foi aprovada. A situação e as alterações de escopo estão em [Central FI](../../FI-CENTRAL.md).

## Objetivo e requisitos definidos pelo proprietário

Disponibilizar pesquisa exclusivamente interna para aproximadamente 60 usuários e análise mensal dos indicadores com plano de ação para a administração. Incluir avaliação periódica do funcionamento técnico do app com propostas de melhoria de desempenho.

O proprietário definiu **FI — Operacional como a instância responsável pelo módulo de IA**. Pesquisa, orquestração das chamadas ao modelo, relatórios de IA e execução mensal pertencem a esse módulo em FI. FD continua sendo fonte dos indicadores consolidados.

Regras de acesso solicitadas:

| Conteúdo | Público autorizado na pesquisa |
| --- | --- |
| Conteúdos gerais do app | Usuários autenticados, ativos e autorizados a acessar o conteúdo |
| Documentos administrativos restritos | Somente membros efetivos do grupo EQUIPE |
| Registros operacionais | O próprio usuário, quando autor ou integrante formalmente vinculado ao registro por identidade, sigla ou nome cadastrados |
| Eventos notificados no módulo próprio | Somente o envolvido identificado pelo módulo |
| Análise mensal e plano de ação dos indicadores | Administração |

Integrar EQUIPE não concede acesso aos registros ou notificações de terceiros. Residente, substituto e cargo administrativo isolado não satisfazem a exigência de membro efetivo para documentos restritos. As permissões de administração da análise mensal são independentes desse requisito documental.

Essas regras definem o acesso na pesquisa e no módulo de IA. Não redefinem permissões administrativas de leitura, edição ou auditoria dos fluxos operacionais já existentes. Qualquer alteração nesses fluxos exigiria escopo próprio.

## Situação encontrada no repositório

O PWA usa Firebase Authentication, Firestore, GitHub Pages e Workers Cloudflare. A divisão FA–FJ mantém FA como entrada/autenticação e FD como indicadores/consolidado. FI já possui responsabilidades operacionais; o novo módulo de IA será incorporado nessa instância, preservando seus fluxos existentes. A integração de leitura de etiquetas já utiliza OpenAI, com a chave protegida no Worker e modelo configurado como `gpt-6-luna`.

O acesso documental atual distingue `GENERAL` e `RESTRICTED` e utiliza cadastros de autorização. As categorias institucionais são descritivas e não concedem, por si, permissão operacional. Existe classificação de pesquisas institucionais que reúne substitutos e equipe; ela não será usada como autorização para documentos administrativos.

A presença de código e relatos no repositório não confirma os recursos efetivamente implantados, o saldo da API ou a disponibilidade de conteúdo integral pesquisável.

## Abordagens e recomendação técnica

1. **Aproveitar OpenAI por servidor Cloudflare, com recuperação interna autorizada.** Reutiliza tecnologias já presentes. Exige saldo/créditos de API e controle de consumo. É a recomendação técnica desta proposta; o proprietário ainda não selecionou expressamente o provedor.
2. **Usar um provedor com camada gratuita.** Depende de cotas, modelos e condições de tratamento de dados; requer outro adaptador e validação de qualidade. Evita depender dos créditos Business, mas não garante disponibilidade contínua nem custo total zero.
3. **Hospedar um modelo local.** Evita cobrança de inferência por consulta quando executado na própria infraestrutura, mas exige equipamento disponível, operação e manutenção. Não é a recomendação inicial para este PWA.

A opção recomendada aproveita as tecnologias existentes, com serviço próprio de IA vinculado a FI — Operacional. Isso não implica mover o fluxo de leitura de etiquetas para FI nem copiar sua chave para o frontend. A leitura de etiquetas mantém seu fluxo específico. O sistema não acessará a internet para responder pesquisas dos usuários.

## Responsabilidades de FI e das fontes

FI será responsável pelos endpoints de pesquisa e síntese por IA, validação do contexto do solicitante, índices/cache/históricos protegidos que forem necessários, controle de consumo, relatórios mensais, planos de ação propostos e agendador do módulo. O vínculo exato com o Worker e os recursos de FI precisa ser confirmado na implantação atual, sem criar automaticamente um novo projeto Firebase ou alterar os serviços operacionais existentes.

FA continua responsável pela entrada/autenticação. FD fornece os indicadores numéricos consolidados. Os demais módulos permanecem donos de seus documentos e registros. O módulo de IA em FI não concede acesso global aos projetos e não transforma FI em réplica irrestrita de todas as bases. A disponibilidade de uma credencial de serviço não substitui a autorização do usuário.

Cada consulta a uma fonte mantém sua política de acesso e o mapa oficial de identidades. O processamento administrativo mensal recebe somente os dados permitidos ao serviço administrativo; consultas interativas de usuários comuns não podem reutilizar esse contexto privilegiado.

## Pesquisa interna e autorização

O servidor valida a sessão, o perfil ativo, o acesso ao módulo e a autorização atual. A identidade da sessão determina quem pesquisa; parâmetros enviados pelo navegador não podem escolher outro usuário ou elevar privilégios.

Os vínculos entre os projetos Firebase precisam usar o mapa de identidades existente. Um nome, e-mail ou UID de um projeto não será presumido equivalente a outro sem vínculo validado. Siglas e nomes serão resolvidos por cadastro oficial, incluindo eventuais aliases históricos verificáveis. Correspondência aproximada ou mera menção em texto livre não concede acesso. Vínculos ausentes ou ambíguos impedem a liberação do registro.

O serviço consulta as fontes proprietárias dos módulos e recupera somente resultados autorizados. Cada resultado conserva origem, identificador, público, vínculos e versão. O índice, caso necessário, precisa manter esses atributos e ter acesso protegido. Não haverá download de um índice global contendo dados restritos para o navegador.

Para documentos administrativos restritos, a categoria EFETIVO validada no servidor será um requisito obrigatório, além dos demais controles aplicáveis. A associação entre essa categoria e os cadastros documentais atuais será implementada explicitamente, sem conceder outros privilégios.

A proteção inclui documentos legados sem `audienceGroup`: a classificação administrativa e de organogramas identificada no catálogo atual deve ser aplicada também no servidor, antes da indexação e da recuperação. A ausência da marca `RESTRICTED` não torna um documento administrativo geral. Documentos com classificação desconhecida ou contraditória ficam fora da pesquisa até resolução autorizada; a implementação não poderá confiar apenas no agrupamento visual do frontend.

A IA recebe apenas trechos já filtrados. A resposta apresenta fontes internas que o usuário pode abrir e informa quando os dados são insuficientes. Títulos, trechos, links, contagens, sugestões de pesquisa e resumos obedecem à mesma autorização. A IA não decide quem pode acessar um documento.

Históricos e caches pessoais serão separados por identidade e escopo de permissão, com expiração e revalidação após mudança de acesso. Resultados gerais podem ser reutilizados somente quando públicos para o mesmo público interno autorizado. Revogação de acesso precisa impedir reutilização indevida de respostas antigas.

Relatos anônimos e campos pessoais de terceiros mantêm as proteções do módulo de origem. A busca não poderá revelar a autoria de um relato anônimo por associação indireta.

## Análise mensal dos indicadores e plano de ação

FD consolida indicadores usando fontes autorizadas e fornece esses resultados ao módulo de IA em FI. O cálculo de valores, totais, taxas, denominadores e metas continua determinístico no sistema de indicadores. FI orquestra a interpretação por IA e armazena uma proposta de análise, sem inventar valores ou interpretar fonte indisponível como zero.

O relatório informa período, atualização das fontes, cobertura, resultados, comparação com metas/histórico, desvios e oportunidades. As ações propostas incluem evidência, prioridade, responsável sugerido, prazo sugerido, indicador e critério de sucesso. Responsáveis e prazos sugeridos precisam ser revisáveis pela administração.

Propõe-se gerar em FI uma análise por competência e versão dos dados, armazenada para consulta administrativa no módulo de IA. Execuções repetidas não devem duplicar relatórios nem cobranças desnecessariamente. Correções geram nova versão explícita. Falhas preservam a última versão válida e sinalizam a competência pendente.

Decisão técnica proposta, ainda não definida pelo proprietário: executar após o fechamento de cada mês, no primeiro dia do mês seguinte, às 03h de America/Sao_Paulo. O fechamento precisa considerar o horário real de disponibilidade das fontes. O agendador pertence ao serviço de IA em FI; será uma função do app, não uma automação deste chat.

O acesso ao relatório, à geração manual e à aprovação do plano será validado como administrativo no servidor. Integrar EQUIPE não concede essas funções automaticamente.

## Avaliação técnica do funcionamento

Propõe-se reunir erros, latência, falhas de sincronização, tempos de carregamento e consumo por fonte para produzir uma avaliação técnica mensal separada dos indicadores institucionais. A periodicidade mensal desta avaliação é uma proposta; a periodicidade mensal dos indicadores foi definida pelo proprietário.

Cada sugestão de ajuste deve apontar a métrica ou evidência que a motivou, a mudança proposta e como validar o efeito. A análise não deve atribuir causalidade a uma variação sem comparação adequada. Ajustes de código seguem revisão, testes e publicação controlada; não há autorização para alterações autônomas em produção.

## Consumo e funcionamento quando a IA estiver indisponível

Antes da ativação, verificar elegibilidade, resgate, validade e saldo dos créditos Business na organização correta da API. Sessenta usuários do PWA não equivalem a sessenta licenças pagas Business. Confirmar também o consumo já existente da leitura de etiquetas e as cotas de Cloudflare e Firebase.

Propõe-se limite de tamanho de pergunta e contexto, limite de saída incluindo raciocínio quando aplicável, cotas por usuário e orçamento compartilhado. O controle de orçamento deve acontecer no servidor, com reserva para chamadas concorrentes e reconciliação do consumo. Alertas de faturamento, isoladamente, não serão tratados como bloqueio rígido.

Não haverá troca automática para um provedor pago, recarga ou aquisição de créditos. Sem saldo ou com orçamento esgotado, a síntese por IA será interrompida de forma controlada. A busca convencional autorizada deverá permanecer disponível quando implementada. Não é possível prometer custo total zero sem conferir saldo, uso e infraestrutura.

Começar com dados sintéticos e indicadores agregados. O tratamento de conteúdo real precisa respeitar as políticas institucionais já adotadas pelo projeto, com minimização dos dados enviados e sem registro de conteúdo sensível em logs.

## Critérios de aceite para a implementação

- Membro efetivo autorizado encontra documento restrito; residente e substituto não encontram título, trecho, link ou conteúdo desse documento.
- Cargo administrativo isolado não satisfaz a condição EFETIVO na pesquisa documental; acesso à análise mensal segue a autorização administrativa própria.
- Um usuário encontra seus registros e os registros em que tenha vínculo oficial; não encontra registros de terceiros.
- Homônimos, siglas ambíguas e nomes citados apenas em texto livre não concedem acesso.
- Eventos notificados são recuperados somente para os envolvidos definidos pelo módulo, inclusive quando o autor da notificação for outra pessoa.
- Alterar UID, grupo, filtros ou identificadores na requisição não amplia o escopo.
- Contas inativas e permissões revogadas são rejeitadas, inclusive para resultados em cache.
- Pedidos à IA para ignorar restrições não alteram a recuperação de dados.
- A análise mensal é administrativa, versionada e idempotente; fontes incompletas são identificadas.
- O orçamento é respeitado com chamadas concorrentes; falha da IA não impede os demais fluxos do app.
- O módulo de IA, seus relatórios e seu agendador pertencem a FI; FD mantém a fonte numérica de indicadores e os fluxos operacionais existentes em FI continuam funcionando.
- Testes de autorização, integração entre identidades e regressão dos módulos afetados passam antes da publicação; homologação usa dados fictícios.

## Pontos a verificar antes de ativar

Antes de implementar os adaptadores, investigar: classificação dos documentos administrativos legados; disponibilidade, formato e volume do texto integral das fontes; campos oficiais de autoria, participação e envolvimento em cada módulo; mapa de UIDs e aliases entre módulos. Metadados e links, isoladamente, não comprovam a disponibilidade do conteúdo para indexação.

Antes da ativação, verificar também implantação e permissões atuais, saldo de API, cotas e armazenamento e horário de fechamento dos indicadores. Essas investigações técnicas podem ser feitas no repositório e na configuração autorizada, sem presumir os vínculos. Nenhuma credencial deve ser colocada no chat, nos arquivos do frontend ou no Git.

## Referências examinadas

- [Repositório SAHMT](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io)
- [Integração existente de etiquetas](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/blob/main/docs/LABEL_AI_WORKER.md)
- [Arquitetura FA–FJ](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/blob/main/docs/ECOSYSTEM_AUDIT_20261108.md)
- [Acesso documental](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/blob/main/src/document-access.js)
- [Categorias institucionais](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/blob/main/src/member-categories.js)
- [Classificação institucional e grupos de pesquisas](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/blob/main/src/institutional-group.js)
- [Créditos de API incluídos em assinaturas elegíveis](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)

As condições de créditos foram consultadas em 09/11/2026. A proposta não comprova elegibilidade ou saldo da conta.
