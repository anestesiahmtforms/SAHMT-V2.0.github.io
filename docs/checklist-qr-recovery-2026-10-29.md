# Correção de validação QR do Checklist — 29/10/2026

O catálogo pode registrar um link no campo `qrCode`. A consulta anterior também passava esse link para `documentId()`, que rejeita barras em consultas de coleção. Agora esses valores são pesquisados apenas por correspondência exata de `qrCode`, mantendo o limite de dois resultados para recusar duplicidades. IDs simples continuam sendo aceitos.

Após duas capturas iguais, a interface informa que está validando o arsenal e consultando o checklist. Cada consulta tem prazo de 12 segundos. QR desconhecido ou falha transitória mantém a câmera disponível para nova tentativa após dois segundos; acesso negado encerra a câmera. Nenhum checklist é aberto sem concluir a validação e a consulta do histórico. Sessão, permissão, rota e data são verificadas novamente antes de consultar o histórico e antes de abrir o banner.

Validação local: 80 testes passaram, incluindo o ZXing distribuído com QR sintético, captura lenta, QR com link, código desconhecido confirmado, recuperação após indisponibilidade, histórico sem resposta e resultado tardio, revogação de acesso e atualização do service worker. `node --check` passou para os arquivos JavaScript alterados. Os cinco novos cenários de regressão (URL, QR desconhecido confirmado, falha transitória, consulta travada e revogação durante consulta) reproduziram falhas antes da correção. Cache do shell: v282.

A câmera física e a sessão autenticada no aparelho não foram verificadas neste ambiente. O build e os demais testes do repositório ficam a cargo do workflow existente de publicação do GitHub Pages.

A captura enviada durante a correção confirmou falha na validação após a decodificação do QR. Foi acrescentada recuperação específica quando o índice da consulta histórica estiver ausente/em construção: uma consulta de igualdade por `stationId`, limitada a 501 registros, usa o índice automático. Só seleciona um resultado se todo o histórico couber em 500 registros, ordenando data, timestamp e ID como na consulta original. Se houver truncamento, o app bloqueia a abertura e informa que o histórico precisa de atualização no servidor. Falhas de permissão, conexão ou outras pré-condições não acionam essa alternativa. A ausência do índice em produção não pôde ser confirmada sem acesso administrativo ao Firestore.

Os testes de consulta estática e recuperação de histórico agora também integram `test:domain`, executado no workflow de publicação.
