# Unificação Firebase no FA — plano de implementação

> Para execução: tratar cada etapa como entrega verificável; usar testes antes da alteração de código correspondente. Este plano não autoriza a virada produtiva.

**Objetivo:** operar a PWA com Authentication e Firestore somente no FA, preservando os dados e regras aprovados de FB/FC.

**Arquitetura:** um inventário tipado e uma migração idempotente reconciliam os bancos; a aplicação e os gravadores externos passam a usar FA após barreira de escrita e delta final. FB/FC ficam somente para conservação e retorno controlado.

**Tecnologias:** Vite, Firebase Auth/Firestore, Firestore Rules, Node.js, Apps Script, Cloudflare Worker, emuladores Firebase.

**Especificação:** `docs/UNIFICACAO_FA_ESPECIFICACAO.md`.

## Restrições globais

- Projeto de destino explícito: `sahmt-17a16`, banco `(default)`; nunca usar o projeto padrão implícito do terminal.
- Nenhuma escrita produtiva, alteração de Rules/IAM/gatilhos, merge ou publicação antes de autorização específica.
- Nenhum segredo ou dump privado no Git; FB/FC preservados; plano Spark e custo zero.
- Nenhuma mudança visual além da retirada de mensagens técnicas secundárias obsoletas.
- Não copiar dados ou permissões sem comparação semântica; não recalcular pontuação como efeito da cópia.

## Revisão prioritária

1. Documento com mesmo ID em FA e FB, mas conteúdos distintos: bloquear o conjunto e registrar conflito, sem escolher por `updatedAt`.
2. Evento pontuado no FB e entregue de novo por Forms/Checklist/FC: manter a chave original de deduplicação e um lançamento só.
3. Relato de FC com autoria restrita: separar exposição do relato, identidade e auditoria nas Rules do FA.
4. Cliente antigo ou fila offline escrevendo depois da virada: rejeitar/escalonar sem perda silenciosa ou escrita em FB/FC.
5. Falha no meio da migração: retomar por checkpoint sem sobrescrever documento alterado nem duplicar pontos.

## Etapa 1 — inventário, autoridade e custos

**Arquivos:** criar `docs/UNIFICACAO_FA_MATRIZ.md`, `docs/UNIFICACAO_FA_CAPACIDADE.md`; reutilizar ferramentas de inventário em `scripts/` apenas após conferir método e escopo.

- [ ] Mapear coleções/subcoleções, IDs, tipos, anexos, índices e Rules de FA/FB/FC; separar dados atuais, históricos, homologação e derivados.
- [ ] Mapear todos os escritores/leitores em `src/`, `apps-script-v2/`, `apps-script-management-gateway/`, `worker-management-auth/`, `functions/`, Forms, Sheets, gatilhos e filas. Confirmar quais fluxos ainda usam FA legado.
- [ ] Obter somente leituras autorizadas para contagens, relações, conflitos, exclusões e métricas de uso; registrar ausência de permissão sem estimar como fato.
- [ ] Calcular consumo da operação diária e da migração/retorno para Spark; estabelecer teto e margem de lote antes de qualquer escrita.

**Aceite:** matriz com origem autoritativa e regra de reconciliação por conjunto; conflitos e limites objetivos destacados.

## Etapa 2 — cópia privada e ferramenta de migração

**Arquivos:** revisar `scripts/management-migration.mjs` e `scripts/lib/management-migration-*.js`; criar ferramenta FA de inventário/migração e testes isolados em `tests/` com nomes específicos após o mapa da etapa 1.

**Interface pretendida:** `dry-run --source FB|FC --destination sahmt-17a16 --manifest <privado>`; modo de aplicação separado, com lista fechada de caminhos, checkpoint, lotes limitados e precondições.

- [ ] Primeiro teste: colisão e documento alterado após leitura falham sem escrita.
- [ ] Implementar serialização tipada, manifesto privado com hashes, paginação e ponto de corte; testar restauração em emulador.
- [ ] Implementar reconciliação determinística de IDs/referências e tombstones, com retomada idempotente; testar reexecução e falha parcial.
- [ ] Conferir paridade do livro-razão, totais, percentuais, ajustes e pendências por UID/período/categoria sem novo crédito.

**Aceite:** dry-run íntegro e restaurável; aplicação produtiva continua bloqueada.

## Etapa 3 — autenticação, módulos e Rules locais

**Arquivos:** `src/management-domain-store.js`, `src/evaluation-store.js`, `src/occurrence-data.js`, `src/occurrences-ui.js`, `src/firebase-project-auth-browser.js`, `src/firebase-project-auth.js`, `src/management-lease-access.js`, `src/management-firebase-app.js`, `src/indicators-firebase-app.js`, `src/main.js`, `src/router.js`, `firestore.rules`, `firestore.indexes.json`; testes correspondentes.

- [ ] Fixar FA como autoridade de Gestão/Desempenho/Ocorrências no build de migração, sem fallback silencioso; preservar o fluxo existente de login e primeiro acesso FA.
- [ ] Substituir claims de FC e leases FB por verificação da identidade/perfil/permissões FA e Rules por ação; testar usuários comum, gestor, admin, inativo e não cadastrado.
- [ ] Consolidar Rules e índices no FA sem remover regras de Eventos, Etiquetas, Escala ou Checklist; testar leitura, listagem, autoria, auditoria e pontuação negadas.
- [ ] Cobrir restauração, troca de conta, logout, revogação, Safari/iPhone e operação offline com pendências preservadas.

**Aceite:** testes de emulador aprovados e nenhuma chamada operacional do cliente para FB/FC no build de migração.

## Etapa 4 — escritores externos e entregas atrasadas

**Arquivos:** `apps-script-v2/`, `apps-script-management-gateway/`, `worker-management-auth/occurrence-score-relay.js`, `worker-management-auth/runtime.js`, `src/occurrence-scoring-delivery.js`, `src/outbox.js`, fluxos Forms/planilhas e testes relacionados.

- [ ] Identificar endpoints que continuam necessários para primeiro login FA, Forms, planilhas e leitura de Etiquetas; manter esses serviços.
- [ ] Redirecionar apenas gravadores migrados para FA, com validação do token FA, autorização por ação e deduplicação estável.
- [ ] Testar eventos duplicados, atrasados, fora de ordem e falhas de rede; confirmar que pendências são retomadas uma vez.

**Aceite:** nenhum escritor operacional dos módulos migrados aponta para FB/FC e as integrações não migradas continuam intactas.

## Etapa 5 — pré-virada e autorização produtiva

**Arquivos:** criar `docs/UNIFICACAO_FA_VIRADA_E_REVERSAO.md`; ajustar `.env.example`, `.github/workflows/pages.yml` e service worker apenas depois dos testes anteriores.

- [ ] Medir e registrar baseline de abertura, gravação e pontuação; validar capacidade e índices.
- [ ] Ensaiar barreira de escrita, delta final, cliente antigo, filas offline e retorno com novos registros FA.
- [ ] Produzir relatório de prontidão: inventário, conflitos, backups/restauração, capacidade, testes, janela, barreira, versão antiga e reversão.
- [ ] **Parar e pedir autorização específica** para dados, Rules/IAM/gatilhos, merge e publicação.

**Aceite:** decisão produtiva baseada em evidência; nenhum serviço ou dado remoto modificado durante a preparação.

## Etapa 6 — somente após autorização específica

- [ ] Controlar escritores antigos, conciliar delta e aplicar lotes com verificação pós-escrita.
- [ ] Atualizar Rules/índices e serviços em ordem coordenada; publicar a PWA preservando o endereço e as filas.
- [ ] Validar fluxos autenticados e destinos de rede, registrar contagens e desempenho; manter FB/FC preservados.
- [ ] Em falha, controlar escritas, preservar o delta FA e executar reversão reconciliada; nunca restaurar backup antigo por cima do FA.
