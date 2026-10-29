# Correção de validação QR do Checklist — 29/10/2026

A câmera pode decodificar o QR e ainda falhar ao consultar catálogo ou histórico. As capturas enviadas confirmaram esse bloqueio após a leitura, mas a mensagem anterior não identificava qual consulta falhou. O leitor agora identifica a etapa e o código do erro, mantém a câmera para nova tentativa e limita o tempo de consulta.

A busca de QR preserva correspondência exata por código ou ID e recusa duplicidades. Links cadastrados não são enviados como IDs de documento. Se o Firestore rejeitar a consulta com `failed-precondition`, o catálogo é percorrido em páginas de 100 documentos, sem filtros ou ordenação que dependam de índices de campos.

O histórico mantém a consulta rápida que retorna um registro. Em caso de `failed-precondition`, percorre todas as páginas da estação; se o índice de `stationId` também estiver indisponível, percorre a coleção pelo índice interno de nomes de documento. Filtra a estação e datas até o dia solicitado e escolhe data, timestamp e ID mais recentes. Não há mais limite de 500 registros nem seleção a partir de páginas incompletas. Somente o registro mais recente é mantido em memória durante a paginação. Essa recuperação pode exigir mais leituras que a consulta rápida quando os índices estiverem indisponíveis.

Permissões negadas e falhas de rede não acionam consultas mais amplas. Fechamento, troca de usuário/rota/data/permissão e timeout invalidam a leitura antes de novas páginas. O scanner aguarda até 12 segundos pelo catálogo e até 20 segundos pelo histórico. Nenhum banner é aberto com resultado parcial ou após cancelamento. Cadastro, regras de acesso, assinaturas e registros de produção não são alterados.

Validação local: 89 testes passaram. Incluem o ZXing distribuído com QR sintético, câmera lenta, QR com link, recuperação de catálogo e histórico sem índices, duplicidade em páginas distintas, 1.205 registros, páginas finais completas/vazias, falha de rede intermediária, cancelamento e timeout. O teste integrado exercita scanner, resolvedor de catálogo e leitor de histórico reais com transporte Firestore simulado: duas capturas abrem o arsenal com o último NÃO correto e encerram a câmera. Verificação de sintaxe dos arquivos alterados passou. Os testes estão em `test:domain` no workflow existente.

Cache do shell: v283. A câmera física e a consulta autenticada de produção não puderam ser verificadas neste ambiente; a confirmação de publicação é feita pelo workflow do GitHub Pages.
