# Execução local — Diretrizes

## Entregas

- Leitor PDF.js no app, com worker local sob demanda, canvas por página, texto extraído, rolagem, progresso e fechamento com cancelamento.
- Transporte FA → Worker → Apps Script com validação Google da identidade, admissão, HMAC bidirecional, nonce e expiração.
- Comprovante por UID/documento/versão/checksum, progresso em lotes, retomada e concessão idempotente.
- Registro privado de concessões para evitar varrer todos os leitores em cada conclusão.
- Guardas de publicação legada antes de fechar ou modificar configurações READY.
- Preparação de recuperação, transição retomável e reversão, sem execução remota.
- Compilador de política privada a partir dos PDFs, recusando saída no repositório, com propriedades limitadas a 8.000 bytes e partes de 7.000 bytes para políticas maiores.

## Decisões de execução

- Ruling: usar um link explícito depois da resposta de liberação — evita bloqueio de popup após operação assíncrona — acrescenta um toque para abrir o Google Form fora do leitor.
- Ruling: confirmar progresso a cada cinco páginas e na conclusão — reduz escritas — páginas ainda não confirmadas podem precisar ser reapresentadas após fechamento.
- Ruling: preservar páginas já confirmadas mesmo após renovar sessão expirada — a validade curta protege o pedido, sem invalidar o progresso da mesma versão.
- Ruling: distinguir falha transitória de API de revogação comprovada — rede indisponível não deve fechar o formulário para todos — audiência insegura comprovada continua exigindo fechamento.
- Ruling: manter o formato legado até 8.000 bytes e usar manifesto com SHA-256 e partes determinísticas para pacotes maiores; setup e rollback usam o mesmo formato.

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

## Extensão local à Gestão de Documentos em 17/10/2026

O mesmo leitor e bloqueio individual agora cobrem Protocolos, ROPs, Diretrizes e administrativos/Organograma. Os grupos do catálogo são conferidos exatamente, sem bypass administrativo. A apresentação das pastas foi preservada. Sem Form associado, concluir registra leitura e não solicita concessão. Nenhum vínculo de catálogo, identificador ou Form real foi criado.

A política privada suporta crescimento por partes com hash, manifesto publicado por último e validação fechada em caso de parte ausente/adulterada. O compilador exporta {policy,properties}; somente values de properties são Script Properties. Setup e rollback conservam compatibilidade com políticas antigas e armazenamento dividido.

Validação da extensão: 96 testes focados e de regressão documental/material/modal aprovados; suíte do leitor com navegador móvel real aprovada, incluindo modo sem Form; transporte sem Form aprovado. Build Vite aprovado; check:fa-runtime confirmou 96 fontes alcançáveis e zero módulos/chunks aposentados. Estes resultados são locais e não atestam concessão real de Google Forms.

## Conferência das fontes e criação de editáveis

Foram examinadas 43 pastas de conteúdo na organização atual do Drive, além das referências ROPs do catálogo. Nas 19 pastas sem fonte editável foi adicionada uma cópia DOCX identificada como EDITÁVEL PARA REVISÃO. As outras fontes existentes não foram substituídas. A releitura confirmou 19 arquivos no destino correto, MIME DOCX e tamanho correspondente ao arquivo local, preservando os IDs de PDFs e Forms anteriores. O inventário detalhado, recibos de upload e material de recuperação ficam fora do Git.

Os PDFs de origem somam 98 páginas. Dezessete conversões usaram texto incorporado; duas exigiram OCR local (Organograma e Ebook Planejamento Anestesiologia 2026) e incluem páginas originais de referência. Todas as cópias são rascunhos para revisão; OCR não representa validação de conteúdo. A comparação automática encontrou fragmentação de palavras na extração de uma diretriz e não constitui certificação de transcrição literal. Os editáveis foram renderizados no Word local e conferidos visualmente; o PDF oficial permanece inalterado.

Os grupos e a organização visual anteriores foram preservados. O gestor mantém o botão Editar abaixo do cartão mesmo quando o leitor está solicitado. A designação futura de revisores por documento e a geração/publicação de novo PDF após aprovação não foram ativadas nem implementadas por esta extensão; não confundir a cópia editável com esse fluxo de aprovação.

Limite real identificado: o PDF Ebook Planejamento Anestesiologia 2026 tem 6.625.860 bytes, acima do limite de 6 MiB do transporte atual. Deve ser otimizado e conferido, com versão/checksum atualizados, antes de incluí-lo na política ativa. Não aumentar limites nem substituir o PDF automaticamente.

O leitor ampliado continua local e desligado; não houve publicação de PWA/Worker/Apps Script, instalação de segredos, alteração de Forms, compartilhamentos, perfis, IAM ou Rules nesta extensão. A única escrita real foi a adição dos 19 DOCX às pastas existentes.

Verificação final da extensão: 294 testes aprovados, zero falhas, build Vite aprovado, `FA_RUNTIME_CLEANUP_VERIFIED` e `git diff --check` sem erros. Inclui regressão do botão Editar para o gestor, grupo restrito sem bypass, continuidade sem Form e política dividida com integridade de hash. As 17 conversões sem OCR mantiveram a contagem de páginas na renderização final, após correção de paginação. Os 19 uploads tiveram destino, tipo e tamanho confirmados por leitura de metadados do Drive.
