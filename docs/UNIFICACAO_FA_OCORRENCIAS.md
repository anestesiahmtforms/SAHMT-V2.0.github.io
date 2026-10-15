# Ocorrências no FA — execução de 15/10/2026

## Dados e identidade

- Origem FC: quatro documentos, nas coleções `occurrenceReports`, `occurrenceAudit`, `occurrenceScoreClaims` e `occurrenceCatalogs`; nenhum outro conjunto produtivo foi encontrado no inventário de raízes.
- Destino FA antes da cópia: zero documentos nessas coleções. Simulação sem conflitos; backup tipado privado restaurado e conferido 4/4 no emulador.
- Cópia real concluída e conferida 4/4, sem alteração de Authentication ou perfis e sem exclusão de origem.
- Reexecução isolada da ocorrência histórica sobre a cópia privada: livro-razão permaneceu com um lançamento após duas entregas; nenhum crédito adicional. Conteúdo narrativo não participa da evidência de pontuação.

## Operação definitiva

- PWA reutiliza Auth/Firestore FA. Nenhum login, lease ou token secundário é solicitado. Flags de inicialização FB/FC e do broker secundário ficam `false` no build, independentemente dos valores antigos das variáveis do repositório.
- Todos os perfis FA com UID correspondente, `active=true` e `access=true` podem registrar, conforme política vigente. Leitura de relatos e auditoria exigem suas permissões específicas; o papel administrativo sozinho não concede auditoria.
- Relato anônimo continua sem UID/e-mail; autoria e pedido de pontuação são documentos separados, protegidos. Os três documentos são criados atomicamente. O navegador não escreve no livro-razão.
- Novos pedidos indicam origem FA. Histórico FC mantém a origem verdadeira e suas chaves de deduplicação; não renomear recibos antigos para tentar “limpar” referências históricas.
- Apps Script operacional atualizado para versão 12, preservando manifesto, URLs e os outros 23 arquivos. A evidência e a pontuação são lidas/gravadas em FA.
- Worker atualizado no serviço existente: nove segredos e namespace Durable Object preservados. Admissão das ocorrências é independente do broker legado. O novo controle `MANAGEMENT_SECONDARY_AUTH_RETIRED=true` bloqueia rotas secundárias antigas; o primeiro login especial FA continua desligado.

## Rules e recuperação

As Rules FA publicadas receberam somente o bloco de Ocorrências, mantendo os controles de Gestão e os demais módulos. O bloco equivalente está versionado em `firestore.rules`. O gerador permite conferir a preservação do texto preexistente. No FC, um marcador de aposentadoria fecha os clientes antigos. Ambos os releases anteriores estão guardados na cópia privada.

Marcadores privados FA exigem cópia completa antes da ativação. Fonte Apps Script, versões de implantação, Rules, configuração/versões do Worker e dados foram guardados em `%LOCALAPPDATA%\SAHMT\fa-consolidation`, fora do Git.

Em falha, bloquear `occurrenceRuntime/faConsolidation` no FA, guardar o delta posterior à virada e reparar o fluxo. Não reabrir FC nem simplesmente voltar à versão antiga da PWA enquanto houver registros novos no FA. Uma recuperação para FC exige conferir e reconciliar esses registros e recibos primeiro. FB/FC permanecem conservados; não usar exclusão como procedimento de retorno.

## Evidência e limites

Testes de regras em emulador: perfil ativo, inativo, ausente, UID divergente, escrita pareada, anonimato, leitura de auditoria, falsificação de pontos e alteração de privilégios. Testes unitários cobrem reutilização da sessão FA, troca de usuário, revogação e ausência de inicialização secundária. Build aprovado. Publicação e teste no aparelho devem ser registrados separadamente.

Última medição antes desta cópia: FA com 19.264 leituras e 474 gravações no dia da cota; exclusões zero. Sem faturamento vinculado em FA/FC. Isso comprova margem para a cópia pequena, sem constituir garantia ilimitada para uso futuro.
