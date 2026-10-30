# Complete document reading implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user authorized implementation and automatic parameter selection; no additional planning approval is required.

**Goal:** Exigir percurso completo e tempo automático antes da ciência em todos os treinamentos de Gestão de Documentos.

**Architecture:** Plano determinístico de trechos por versão; leitor mede exposição e envia lotes; serviço valida tempo, sequência e sessão antes de aceitar READ/ACK/QUIZ/SUBMIT. Migração aditiva prepara os 66 planos sem tocar nos resultados.

**Tech Stack:** JavaScript, parse5 existente, Firebase FB, Cloudflare Worker, Vite/GitHub Pages.

**Spec:** docs/superpowers/specs/2026-10-30-complete-document-reading-design.md

## Global Constraints
- Preservar pontuação, duas tentativas, maior nota, sugestões, grupos e auditorias.
- 200 palavras/minuto; ilustração 5s; material mínimo 15s; lotes de 20s, teto de 60s; inatividade de 120s.
- Não importar novamente os arquivos nem incluir conteúdo privado no Git.

## Review Focus
- Repetição/perda de resposta ou duas abas não duplicam tempo.
- Publicação, revogação ou saída do leitor impedem créditos atrasados.
- Texto longo, tabelas, imagens e referências continuam alcançáveis.
- Cliente antigo ou tentativa iniciada anteriormente não contorna a política.
- A migração e implantação não alteram serviços paralelos ou resultados históricos.

### Task 1: Política e domínio
**Files:** worker-training/reading-plan.js, worker-training/reading-state.js, worker-training/service.js, worker-training/worker.js, tests/html-training-reading.test.js.
**Interfaces:** buildReadingPlan(sections) -> plano; operações READING_START e READING_PROGRESS -> state; OPEN -> readingPlan opcional.
- [ ] Escrever e executar testes falhando para cálculo, clique precoce, tempo impossível, repetição, troca de sessão, retomada, versão e preservação de pontos.
- [ ] Implementar plano e comprovação transacional; integrar publicação e bloqueios de etapas.
- [ ] Executar testes novos e suíte HTML; esperado zero falhas.
- [ ] Commit do domínio.

### Task 2: Leitor
**Files:** src/html-training-reading.js, src/html-training.js, src/html-training.css, tests/html-training-reading-client.test.js, tests/html-training-reading.browser.test.js.
**Interfaces:** mountReadingTracker({frame,plan,credits,onProgress,...}) -> cleanup/flush; consumir readingPlan de OPEN.
- [ ] Escrever testes falhando para visibilidade, tempo de uma única região, pausa, continuação e desmontagem.
- [ ] Implementar medição por intervalos visíveis e trava de avanço, sem recriar o iframe a cada lote.
- [ ] Verificar desktop/celular, referências e retomada com serviço real em memória.
- [ ] Commit do leitor.

### Task 3: Preparação e implantação
**Files:** scripts/prepare-reading-plans.mjs, worker-training/wrangler.toml, package.json, public/service-worker.js.
- [ ] Preparar e conferir planos vinculados às versões atuais; simulação antes da gravação condicional.
- [ ] Executar regressão HTML, Worker, build FA/FB e revisão independente.
- [ ] Publicar interface pelo fluxo existente; publicar Worker preservando secrets/variáveis; habilitar controle após planos conferidos.
- [ ] Conferir publicação e bloqueios; registrar limitações de verificação autenticada sem criar participação real.
