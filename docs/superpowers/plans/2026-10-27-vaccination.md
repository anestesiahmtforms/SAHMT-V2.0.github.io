# Vaccination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Cadastro vacinal em FB com documentos no Drive e painel administrativo.
**Architecture:** UI nativa com sessão FB; serviço existente Cloudflare valida identidade e perfis; Firestore para dados estruturados/referências, Drive para bytes. Mapa de pastas privado, sem credencial no browser.
**Tech Stack:** JavaScript, Vite, Firebase Auth/Firestore REST, Cloudflare Workers, Google Drive REST, Node test, Playwright.
**Spec:** ../specs/2026-10-27-vaccination-design.md

## Global Constraints
- Somente administrador consulta terceiros; não estender peopleManage/managementManage.
- Sem ativar Blaze, Apps Script ou faturamento. Não ativar envio sem OAuth e validação.
- Quatro vacinas; anos 2026–2028; quatro categorias obrigatórias. Sem interpretações clínicas.
- Imagens até 1600 pixels, JPEG; PDF até 5 MiB; metadados somente no Firestore.
- Acesso por página/contexto e UID resolvidos no servidor, nenhum folderId aceito do cliente.

## Review Focus
- Conta trocada durante operação: cancelar resposta e remover dados da tela.
- Repetição após falha: mesmo requestId/hash, mesmo arquivo, conflito para outro conteúdo.
- Perfil revogado ou gestor comum: bloquear relatório, links e dados de terceiros.
- Categoria desconhecida e ausência de resposta: não contar como não vacinado.
- Falha parcial Drive/Firestore: não mostrar sucesso, permitir reconciliação idempotente.

### Task 1: Domain and record service (Astra)
Files: src/vaccination-domain.js, worker-training/vaccination-service.js, tests/vaccination-{domain,service}.test.js.
Interfaces: createVaccinationService({store,now}).execute(BOOTSTRAP|SAVE|REPORT,input,identity). Domain shared constants, validation, buildVaccinationReport.
- [ ] RED: own access, manager denial, malformed data, stale expectedVersion and denominator cases.
- [ ] GREEN: implement validation, profile authorization, transactions and reports.
- [ ] Verify: node --test tests/vaccination-domain.test.js tests/vaccination-service.test.js.

### Task 2: Secure context-based Drive upload
Files: worker-training/professional-documents.js, worker-training/drive.js, worker-training/worker.js, tests/professional-documents.test.js, tests/vaccination-worker.test.js.
Interfaces: createProfessionalDocumentService({store,drive,now}).execute(LIST_OWN|UPLOAD|LIST_ADMIN,input,identity); createDriveClient({credentials,fetchImpl}); worker /v1/vaccination and /v1/professional-documents.
- [ ] RED: foreign identity/folder injections, MIME and size limits, private own list, admin-only links, upload retry and partially saved results.
- [ ] GREEN: private UID/category mapping, content validation, generated Drive IDs and journal, safe transport.
- [ ] Verify: node --test tests/professional-documents.test.js tests/vaccination-worker.test.js.

### Task 3: Form, camera and admin indicators
Files: src/vaccination.js, src/vaccination.css, src/vaccination-client.js, src/document-image.js, src/main.js; tests/vaccination.browser.test.js.
Interfaces: mountVaccination(root,{user,profile,clientFactory}) returns cleanup; capture produces JPEG, max side 1600; all requests bound to current FB identity.
- [ ] RED: required groups/fields, stored-year retrieval, save errors, account invalidation, image dimension/readability preview, manager report absence.
- [ ] GREEN: responsive form, capture/file upload, local compression, result/save confirmation, aggregate charts and actionable operational counts.
- [ ] Verify: Node domain/transport and Playwright 320/390/768/1440 layouts; Vite FA/FB build and runtime checker.

### Task 4: Configuration, review and deployment readiness
Files: scripts/prepare-professional-document-folders.mjs, docs/VACCINATION-FB.md, tests as required, service worker version only for publication.
- [ ] Write dry-run importer for private UID->folder map; no personal folder data in Git.
- [ ] Run existing training and navigation regressions; confirm rules deny browser raw vaccination/document collections.
- [ ] Independent Astra review and resolve material findings; record precise tests and blockers.
- [ ] Present built app with preview and explicit OAuth/activation instructions; do not report live collection/upload without readback.
