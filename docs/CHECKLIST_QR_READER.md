# Checklist — correção do leitor QR — 01/10/2026

Base: `3d3530309df32fe2252d6c505288ed927a9bec76`, main atual conferida antes da edição. Trabalho no checkout isolado; a pasta original permanece com suas três alterações locais.

## Falhas reproduzidas e correção

A câmera pode mostrar vídeo e ainda assim não concluir a leitura: a confirmação anterior exigia duas capturas iguais separadas por no máximo 1000 ms. Em leituras de 2000 ms, esse estado reiniciava continuamente. O scanner usa agora 5000 ms, preservando a exigência de duas capturas iguais, reinício por ambiguidade/código desconhecido e a identificação exclusiva no catálogo da data.

O primeiro processamento usa 640 px, seguido de tentativa em 1280 px quando o código não é reconhecido. As duas capturas usam o mesmo recorte da moldura visível. Isso conserva a leitura de etiquetas pequenas/desgastadas que exigem a maior resolução. Na medição Node desktop, os 28 QR legados tiveram correspondência exata com seu catálogo em 640 px: média 195 ms/máximo 333 ms, contra 551/780 ms em 1280 px; redução aproximada de 65% na tentativa inicial. Esses tempos não representam a câmera de um iPhone ou Android físico. O caso pontilhado rotacionado e apagado que falhou em 640 foi recuperado em 1280, com leitura de 1723 ms no computador.

Fechamentos enfileirados e callbacks antigos não encerram uma nova sessão. Sessão, UID, rota, data, DOM e checklistWrite são conferidos antes e depois dos awaits. Streams recebidos após cancelamento são descartados; nenhum callback antigo altera o vídeo ou as mensagens de outro leitor. O foco automático é opcional e não bloqueia a decodificação, mesmo se a consulta de capacidades falhar ou a configuração não concluir. Somente vídeo com pixels disponíveis (`readyState >= 2`) é capturado.

A carga do ZXing valida as APIs esperadas, tem prazo de 10 segundos e permite retry depois de erro. Os avisos de permissão, carregamento e QR fora do catálogo estão visíveis dentro do bloco; Voltar funciona também após falha da câmera ou do decoder. QR válido continua abrindo o banner completo do arsenal pelo fluxo existente `fromQr: true`. Links contidos no QR servem somente de identificador cadastrado, nunca de destino de navegação.

Permissões, Firestore Rules, manutenção, assinaturas, IDs, filas IndexedDB e integrações de produção permanecem como encontrados. Somente o PWA é publicado. Cache do shell: v159; pendências e cache da escala preservados.

## Verificação

- Testes de domínio incluem o vendor ZXing realmente distribuído, QR fictícios quadrados/pontilhados/apagados/rotacionados, imagem uniforme e QR parcial; não dependem só de decodificadores simulados.
- Regressões do scanner usam funções reais extraídas, streams/DOM fictícios e relógio controlado. O conjunto inicial contra a versão anterior reproduziu 15 falhas; cobre fechamento tardio, câmera/decoder pendentes, revogação/mudança de contexto, prontidão do vídeo, fallback, erro e retry, confirmação lenta e Voltar.
- Os 28 QR legados foram lidos somente como imagens de identificação de equipamento, sem dados de pacientes, sem registros operacionais e sem gravações de produção.
- Build usa as variáveis existentes do repositório, sem ativar IA, APIs, Apps Script ou gatilhos.

A validação física em Safari/iPhone e Android, câmera real e sessão autenticada ainda depende da conferência no aparelho. Uma imagem legível não garante vínculo no catálogo: o leitor agora informa explicitamente quando o QR foi decodificado mas não está cadastrado/vigente na data. Não foram alterados cadastros por suposição.
Resultado final local:

- `npm run test:domain`: 235/235, incluindo 27 cenários/subtestes do scanner.
- `npm run test:label-ai-worker`: 12/12; sem chamadas de IA de produção.
- `npm run build`: sucesso; aviso preexistente de chunk Firebase acima de 500 kB.
- 11/11 cenários Edge headless com CPU 6×, sem BarcodeDetector, ZXing real carregado pelo loader real e vídeo produzido por `canvas.captureStream`: cinco leituras em retrato/paisagem e seis verificações de encerramento/sessão/permissão/câmera tardia. Duas capturas reais confirmam o QR e abrem o banner via `fromQr`; tracks terminam e srcObject fica vazio. Status e Voltar visíveis, sem overflow horizontal.
- Maior intervalo observado entre duas confirmações nessa emulação: 4,125 s; a configuração anterior de 1 s reiniciaria a confirmação. Essa condição artificial mede a regressão, não o desempenho de um telefone físico.
- Auditoria de produção somente GET, com máscara de campos de stations: 28 QR vinculados inequivocamente, zero ausentes/duplicados; 23 arsenais ativos e cinco inativos, todos dentro da vigência. Estados e permissões preservados. Nenhuma gravação de dados de produção nessa correção.

As provas privadas/locais ficam ignoradas em `.local-preview/qr-reader` e nos logs de teste/build. O GitHub Actions valida novamente domínio, Rules, Worker e Functions antes de publicar o Pages. Não foi feito deploy de Rules ou de outras integrações nesta atualização do leitor.
