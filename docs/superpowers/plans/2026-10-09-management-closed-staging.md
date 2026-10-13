# Cópia fechada de Gestão em FB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Criar e conferir a cópia preparatória de 134 registros em FB sem ativar Gestão.

**Architecture:** O snapshot auditado permanece pontual e histórico. Um módulo puro prepara/valida o lote atômico e um helper privado coleta metadados, reserva leituras, persiste DPAPI e executa somente FB. O executor produtivo atual permanece intacto.

**Tech Stack:** Node.js, Firestore REST commit/batchGet, Windows DPAPI.

**Spec:** docs/management-closed-staging-spec-20261009.md

## Global Constraints

- FA sahmt-17a16 intacto; FB sahmt-gestao-5ae66/(default), Spark, billing desabilitado e Rules deny-all.
- 134 documentos +134 proveniências; 231 KEEP_FA; nenhum Auth/grant/ponto/runtime/ativação.
- Autoridade humana sem redatar, sem expiração por minutos, execução única no mesmo dia LA.
- Sem sobrescrita, exclusão ou retry; conflitos e resultado incerto preservam checkpoint.

## Review Focus

- Mudança de conteúdo, manifesto, UID/ACL ou plano deve recusar antes de credenciais.
- Um par existente/parcial recusa todo o commit; nenhuma criação parcial.
- Resposta batchGet incompleta, duplicada ou fora do readTime recusa.
- Resposta de commit incerta preserva intenção e impede retry.
- Rules alteradas ou produtor FB observado impedem a escrita; ausência global não é inventada.

### Task 1: Preparar e validar o lote

**Files:** Create scripts/lib/management-closed-staging.js; tests/management-closed-staging.test.js.
**Interfaces:** prepareManagementClosedStagingBatch(input), validateManagementClosedStagingRead(input), validateManagementClosedStagingCommit(input).

- [x] Escrever testes para hashes/plano, roots proibidas, 268 paths, preconditions, duplicatas, readTime, conflitos, receipt de commit e limitação de bytes.
- [x] Implementar funções puras reutilizando prepareSplitPlan e validadores typed existentes.
- [x] Executar testes focados já autorizados na solicitação de migração e revisar independentemente.

### Task 2: Executar cópia preparatória privada

**Files:** Create .local-preview/management-split/stage-management-FB-stage2.mjs (ignored).
**Interfaces:** --preflight local; --stage execução única com autoridade, metadados e pins exatos.

- [x] Abrir e revalidar rascunho/prova DPAPI, autoridade humana e arquivo privado; recusar namespace já consumido.
- [x] Registrar consumed/ledger WX e checkpoints DPAPI; verificar owner, Spark/Rules e token userinfo.
- [x] Reservar 268 leituras antes de batchGet e persistir intenção antes de commit com 268 creates.
- [x] Conferir 268 caminhos após commit, preservar readTime real, fechar recibo agregado e budget.
- [x] Atualizar status com o resultado real e pendências de reconciliação/ativação.

## Registro de execução

- Módulo puro e 38 testes focados concluídos; regressão dedicada 189/189 e revisão independente concluídas.
- Stage1 preservado: HTTP400 no precheck, zero writes; diagnóstico confirmou readTime futuro por relógio local adiantado.
- Stage2 COMPLETE: commit 2026-10-10T00:39:38.364990Z, 134 documentos +134 proveniências, 268 caminhos conferidos, FB deny-all.
- Reservas locais536 em stage2 e270 anteriores,806 cumulativas (850 com a captura vazia separada); não equivalem ao consumo global.
- Recibo e checkpoints protegidos fora do Git; FA/Auth/app/billing inalterados.
- Reconciliação e ativação produtiva permanecem etapas posteriores; este plano de cópia fechada está concluído.
