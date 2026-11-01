# Desempenho FC exclusivo

Decisão do usuário em 01/11/2026: pontuação de ações FC permanece exclusivamente em FC, sem envio automático para FB. O módulo começa com novas pontuações após a ativação. Histórico e saldos existentes em FB são preservados. Sincronização futura não faz parte desta implementação.

## Limites

- Projeto FC: `indicadores---sahmt`, banco `(default)`, UIDs e sessões Google/Firebase existentes.
- Fontes iniciais: Ocorrências e participações QMENTUM, com suas regras e evidências atuais. O navegador nunca fornece uma pontuação confiável.
- Coleções novas: `fcPerformanceRuntime`, `fcPerformanceAwards`, `fcPerformanceLedger`, `fcPerformanceSummaries`, `fcPerformanceReference` e `fcPerformanceSourceReceipts`. Inventário real não encontrou conflito com esses nomes; nenhum documento de desempenho foi criado ainda.
- Cada lançamento guarda origem FC, identificador imutável da ação, UID, modalidade e versão. Recibos impedem duplicação. Não existe cliente, fila, gatilho ou exportação automática para FB.
- Usuário aprovado consulta seu saldo e lançamentos. Evidências de Ocorrências anônimas continuam restritas; consulta de terceiros exige as permissões FC apropriadas. Escritas de pontos somente pelo servidor.
- A ativação define um marco temporal no servidor. Fontes anteriores ao marco não são importadas ou recreditadas automaticamente; pendências anteriores precisam de inventário próprio.

## Backend

Reutilizar o núcleo de cálculo/recibos validado, com roteamento FC fixo e fechado: dados de origem, identidades e pontuação usam apenas FC. As funções herdadas que selecionam FA/FB ou exigem a liberação de migração FB recebem adaptadores FC específicos. O pacote final deve rejeitar qualquer URL Firestore de outro projeto.

Revisões e participações QMENTUM, recuperação de Ocorrências e ciclo trimestral são mapeados separadamente. Nenhum gatilho novo será instalado antes da transição aprovada. Gemini só pode executar com prova atual de camada gratuita e cobrança desabilitada; não reutilizar uma chave/prova sem verificação.

## PWA

Adicionar a rota “Desempenho FC” na área de Registros, com resumo, total, histórico e estado das confirmações. Reutilizar a sessão FC e as mesmas UIDs. A página de Desempenho FB e seus saldos permanecem no banco e fluxo existentes.

## Corte e reversão

O roteamento do PWA sozinho não impede o processador central de gerar pontos FB. Preparar mudança restrita nos processadores FC centrais, controlada por propriedade, e desabilitar o transporte automático central de pontuação FC no corte. Não desligar processos das outras estações. Inventariar pendências/recibos antigos antes do marco para não perder ou duplicar créditos.

Publicação, regras Firestore e modificações no projeto central exigem o resultado concreto e a aprovação de produção prevista no pedido original. A reversão deve coordenar os processadores e preservar os lançamentos legítimos já feitos em FC; não somar novamente em FB como efeito de rollback.

## Plano de implementação

1. Inventário FC e colisões de coleções: concluído, sem escrita.
2. Testes e adaptadores de roteamento local, recibos, limites temporais e ausência de chamadas FB/FA.
3. Repositório/UI FC, regras de leitura por UID e isolamento; testes de troca/expiração da sessão.
4. Pacote Apps Script derivado da versão real, configuração desativada, rotinas FC e patch central com guardas.
5. Preparação real dos recursos e verificação sem ativação; validar dados identificáveis, outras estações, cache e reversão.
6. Apresentar alterações/risco/validações para aprovação; somente então executar o corte e verificar integrado no PWA.

Proposta anterior de conceder acesso FC ao ledger FB foi abandonada por esta decisão. Não aplicar esse IAM nem criar sincronização automática.
