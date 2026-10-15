# SAHMT V2 — especificação de consolidação no FA

## Decisão e limite

FA (`sahmt-17a16`, Firestore `(default)`) será a única autoridade Firebase de identidade e dados operacionais da PWA. Gestão, Treinamentos e Desempenho saem da operação no FB (`sahmt-gestao-5ae66`); Ocorrências saem da operação no FC (`indicadores---sahmt`). FB e FC serão conservados para conferência e eventual retorno. Google Drive, Forms, Sheets, Apps Script e Workers necessários continuam integrados.

O administrador autorizou prosseguir com Gestão e Desempenho de FB para FA e concedeu autorização prévia às ações necessárias em 15/10/2026. A execução continua condicionada às evidências técnicas abaixo; isso não autoriza billing, perda de dados ou remoção da origem. Ocorrências/FC é uma etapa distinta, ainda não concluída.

## Referência verificada em 15/10/2026

- `origin/main`: `828ad33` (`Fix FC occurrence reconnects and token refresh latency`).
- O GitHub Pages público respondeu HTTP 200 com cache do service worker `v191`. O PR [#39](https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io/pull/39), de reaproveitamento de conexão secundária, está aberto e não foi mesclado; não integra a migração para FA.
- Worktree isolada: `codex/unificacao-fa-planejamento`.
- A worktree `management-firebase-split` está no commit `0dd7900` e contém alterações não commitadas de QMENTUM e da recuperação da autenticação secundária. Não devem ser sobrescritas nem presumidas como publicadas.
- `src/management-domain-store.js` e `src/evaluation-store.js` escolhem FA ou FB; o caminho FB exige sessão secundária e lease. `src/occurrence-data.js` exige claims do token customizado de FC. `worker-management-auth/occurrence-score-relay.js` usa FC. Há lógica antiga de Gestão/Treinamentos/Desempenho no `firestore.rules` do FA e regras separadas para FB/FC. A existência dessas regras não prova paridade de dados.
- Inventário consistente de Gestão/Desempenho em 15/10/2026 16:41:30 UTC: 424 documentos FB, zero nos conjuntos correspondentes FA, zero conflitos. Inclui 181 registros `migrationOrigins`; nenhuma raiz FB não classificada. Backup privado DPAPI restaurado no emulador e conferido 424/424. Isso não representa transferência produtiva.
- 60 perfis FA com UID íntegro; todos os 58 UIDs referenciados na cópia possuem perfil FA; um deles está inativo e permanece sem autorização adicional.
- Os 28 índices FB já existem no FA. As Rules FA efetivamente publicadas contêm a barreira `faDomainOpen_`; não substituir essas Rules pela versão base local. O manifesto do Apps Script permanece intacto.

## Invariantes

1. Manter todos os UIDs, usuários e perfis do FA; não importar Authentication de FB/FC sobre FA.
2. Preservar IDs, tipos Firestore, referências, status de exclusão, histórico, auditoria, anexos e ligações com Drive.
3. Conservar uma única autoridade de escrita por conjunto de dados; impedir duplicação de pontos e respostas de Forms.
4. As regras de negócio e a interface aprovadas permanecem; permissões continuam por ação/área, com sigilo de autoria das ocorrências.
5. Não depender de Auth, lease, token nem Firestore de FB/FC após a virada. O primeiro login especial no FA continua independente dessa remoção.
6. Manter Spark, sem Blaze, faturamento, Cloud Functions ou exportação gerenciada que exija billing.
7. Preservar filas offline e versões antigas da PWA; uma publicação de código não constitui prova de migração.

## Evidência obrigatória antes da virada

- Matriz por coleção e período: origem autoritativa, destino, quantidade, subcoleções, relações, leitores, escritores, conflitos, exclusões e regra de reconciliação.
- Cópia tipada e privada dos dados afetados nos três projetos, manifesto e hashes; demonstração de restauração local. Uma listagem paginada com escritores ativos não é snapshot consistente.
- Dimensionamento de leituras, gravações, armazenamento, índices e transferência para rotina, cópia, verificação e retorno no Spark, com margem de operação.
- Simulação sem escrita, conflitos resolvidos ou isolados, ferramenta idempotente com checkpoint e precondições, Rules/índices testados em emuladores, regressão das integrações externas e tratamento das versões antigas.
- Barreira de escrita e reconciliação do delta final, incluindo filas, Forms, pontuação e exclusões. Reversão deve conservar os registros criados após a virada.

## Critério de conclusão

O fluxo autenticado em FA lê e grava Gestão, Treinamentos, Desempenho e Ocorrências exclusivamente em FA, com permissões e pontuação conferidas. Nenhum cliente ou backend operacional consulta FB/FC nesses módulos. Testes locais, publicação autorizada e validação real são registrados separadamente. FB/FC permanecem preservados.
