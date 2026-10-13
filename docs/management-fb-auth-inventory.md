# Captura Auth somente leitura do FB

O capturador `scripts/management-fb-auth-inventory.mjs` consulta somente `GET https://identitytoolkit.googleapis.com/v1/projects/sahmt-gestao-5ae66/accounts:batchGet`, paginado em até 1.000 contas por página. Não consulta Firestore, não cria ou modifica usuários e não altera configuração de projeto.

O acesso usa a conta já autenticada na Firebase CLI (`fa-owner@example.invalid`), o escopo OAuth `cloud-platform` e requer a permissão `firebaseauth.users.get` no FB. O script não verifica nem concede permissões, ativa APIs ou configura faturamento; se a permissão não existir, a consulta falha com diagnóstico sanitizado.

O índice local FA é aberto em memória a partir do arquivo DPAPI já existente. O relatório e a saída no terminal contêm somente contagens. O índice FB protegido por DPAPI contém os UIDs, `disabled` e a categoria derivada de `providerUserInfo`; e-mails, nomes, identidade do provedor, hashes, salts, tokens e payloads não são retidos.

O índice FA protegido pode incluir um marcador categórico calculado durante a leitura a partir do e-mail do registro Authentication. O DPAPI guarda somente o marcador, nunca o e-mail. Somente os dois marcadores candidatos definidos podem compor `homologation`; marcadores ausentes não inferem participação com base em `disabled`, e marcador duplicado vai para revisão. A conta estrutural fica em uma categoria separada. A comparação operacional classifica UID equivalente, ausente, conflito de estado/provedor ou revisão. UIDs extras do FB e categorias ambíguas ficam em revisão. O número de contas candidatas não é inferido de participantes anteriores.

O comando para uma futura leitura, ainda sujeito a autorização específica, é `node .\scripts\management-fb-auth-inventory.mjs`, executado na raiz do checkout. A implementação atual não foi executada contra o Firebase real.
