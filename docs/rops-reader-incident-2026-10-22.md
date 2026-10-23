# ROP e-book: falha de validação da sessão no Cloudflare

## Causa

O runtime Workerd aceita `redirect: 'manual'` ou `redirect: 'follow'` nas requisições. O leitor enviava `redirect: 'error'` na consulta ao Firebase Authentication e na busca do resultado do Content Service. A construção da requisição falhava antes de buscar o PDF.

O diagnóstico por etapas localizou `READING_RELAY_IDENTITY_LOOKUP_FAILED`. Uma assinatura deliberadamente inválida reproduziu esse erro remotamente, sem usuário real, criação de identidade, acesso ao Apps Script ou leitura Firestore.

## Correção

As duas requisições usam `manual`. A consulta de identidade exige HTTP 200. O POST ao Apps Script permite somente um redirecionamento validado para o Content Service; o GET resultante também exige HTTP 200 e não transporta credenciais nem payload. Respostas assinadas continuam sujeitas a HMAC, nonce, validade e validação dos campos.

Erros passam a indicar etapas fixas, sem expor tokens, identidades ou respostas privadas. O Apps Script distingue falhas de quota, backoff, permissão e execução. A implantação preserva os bindings existentes, segredos e configuração de cobrança.

## Evidências e limites

- Reproduzido em Workerd local: `error` gera TypeError; `manual` é aceito, sem rede.
- Após publicar a correção no Worker, o mesmo teste remoto passou de HTTP 503 para HTTP 401 `READING_IDENTITY_DENIED`, a rejeição correta de uma assinatura inválida.
- Testes isolados cobrem identidade, redirecionamentos, assinatura da resposta, controle de leitura e liberação individual de formulário.
- A abertura com a sessão real no iPhone exige confirmação separada; rejeitar uma assinatura inválida não prova o fluxo completo de leitura.

## Limpeza em FA

O usuário autorizou eliminar o conteúdo remanescente de Gestão e Desempenho em FA **depois** de concluir o funcionamento em FB. Antes da exclusão, conferir a origem efetiva e as dependências de cada coleção. Preservar QMENTUM, registros operacionais, autenticação, perfis compartilhados e evidências de origem usadas pelo desempenho em FB. Esta correção não executa exclusões.
