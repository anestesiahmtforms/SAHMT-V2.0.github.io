# Execução local — Diretrizes

## Entregas

- Leitor PDF.js no app, com worker local sob demanda, canvas por página, texto extraído, rolagem, progresso e fechamento com cancelamento.
- Transporte FA → Worker → Apps Script com validação Google da identidade, admissão, HMAC bidirecional, nonce e expiração.
- Comprovante por UID/documento/versão/checksum, progresso em lotes, retomada e concessão idempotente.
- Registro privado de concessões para evitar varrer todos os leitores em cada conclusão.
- Guardas de publicação legada antes de fechar ou modificar configurações READY.
- Preparação de recuperação, transição retomável e reversão, sem execução remota.
- Compilador de política privada a partir dos PDFs, recusando saída no repositório e propriedade acima de 8.000 bytes.

## Decisões de execução

- Ruling: usar um link explícito depois da resposta de liberação — evita bloqueio de popup após operação assíncrona — acrescenta um toque para abrir o Google Form fora do leitor.
- Ruling: confirmar progresso a cada cinco páginas e na conclusão — reduz escritas — páginas ainda não confirmadas podem precisar ser reapresentadas após fechamento.
- Ruling: preservar páginas já confirmadas mesmo após renovar sessão expirada — a validade curta protege o pedido, sem invalidar o progresso da mesma versão.
- Ruling: distinguir falha transitória de API de revogação comprovada — rede indisponível não deve fechar o formulário para todos — audiência insegura comprovada continua exigindo fechamento.
- Ruling: guardar política completa em propriedade compacta limitada a 8.000 bytes — respeita o limite por propriedade do Apps Script — pacotes maiores exigem outra organização antes da instalação.

## Revisão e correções

Uma revisão independente identificou interferência do reconciliador legado, fechamento sem recuperação após erro transitório, cobertura contabilizada após falha de renderização e perda de progresso na renovação. Todos receberam correções e testes de regressão. A revisão complementar distinguiu revogação real de falha transitória na verificação final do perfil; corrigido e testado com reprodução antes da alteração.

## Verificação

Verificação concluída em 17/10/2026:

- 270 testes focados e de regressão aprovados, zero falhas. Inclui renderização real de PDF em navegador local com viewport móvel e cenário de falha de página.
- Build Vite aprovado.
- `check:fa-runtime`: FA_RUNTIME_CLEANUP_VERIFIED, 96 arquivos alcançáveis, zero módulos/chunks aposentados e flags secundárias fixadas em false.
- Bundle Worker validado com Wrangler `--dry-run`, 223,40 KiB, binding BROKER_STATE presente, DIRETRIZES_READING_ENABLED=false. Não criou implantação.

A homologação real de Google Forms, acesso aos PDFs privados, quotas e iPhone permanece separada das evidências locais.

## Estado externo

Nenhuma implantação, alteração de permissão real, configuração de segredo, escrita em perfil ou alteração de Rules foi realizada. Todas as flags novas permanecem desligadas. O pacote não é prova de bloqueio atual dos links diretos do Forms.
