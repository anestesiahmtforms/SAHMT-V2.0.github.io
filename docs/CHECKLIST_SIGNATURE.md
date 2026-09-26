# Assinatura interna do Checklist

## Fluxo Spark atual

1. O comando aparece para `checklistSign` no Checklist do dia, apenas online e depois que as respostas locais pendentes/recusadas forem resolvidas.
2. O PWA apresenta o total de estações e calcula um fingerprint SHA-256 dos IDs, nomes e respostas mais recentes das estações ativas vigentes. Esse fingerprint é um claim do cliente, não uma revisão validada.
3. A pessoa declara que revisou o relatório, informa justificativa/contexto e cria `checklistSignatureRequests/{day}_{fingerprint}_{uid}` com status `PENDING_VALIDATION`. A gravação é imutável e repetível com o mesmo ID. Firestore Rules exigem sessão verificada, perfil ativo com `checklistSign`, data de São Paulo do servidor, UID próprio, digest hexadecimal e campos/status exatos.
4. A solicitação não grava `checklistSignatures`, não atribui responsável, não concede pontos e não afirma que a revisão está correta. Esses resultados exigem validação confiável da escala, férias, substituições, contatos, perfis, estações e respostas atuais.

## Validação pendente

O Apps Script V2 atual consome apenas `syncQueue` para relatórios e ainda **não** lê nem valida `checklistSignatureRequests`. Enquanto esse consumidor não for implementado, autorizado e ativado, os pedidos permanecem pendentes. Não implantar Cloud Functions nem habilitar Blaze para contornar essa pendência.

O consumidor futuro deve reler os documentos operacionais pelo Firestore REST usando identidade IAM privilegiada, reproduzir a escolha da primeira posição disponível, confirmar UID ativo e único, férias, substituições, estações e a resposta mais recente, recalcular o fingerprint e verificar declaração/justificativa. Só então poderá criar `checklistSignatures/{day}_{trustedRevision}` e os lançamentos de pontos em um único commit REST com precondições idempotentes, além de atualizar o pedido. Assinatura incompleta não pontua. Pedido divergente deve permanecer auditável como recusado/necessitando revisão, sem escrita em `scores`.

A conta que executará o Apps Script contorna Firestore Rules por IAM e deve ser tratada como operador privilegiado. Atribua o menor papel viável, monitore auditoria e não coloque credenciais no PWA. O algoritmo de responsável não pode ser movido para JavaScript do cliente como fonte de autorização.

## Compatibilidade e histórico

- `functions/index.js` mantém a callable `checklistSignature` e seus testes como implementação histórica/referência; o PWA não a chama.
- `checklistSignatures` e `scores` continuam sem escrita cliente nas Rules. A interface não apresenta ponto definitivo para um pedido pendente.
- O fingerprint do pedido usa somente campos operacionais atuais e não é assinatura criptográfica de usuário nem prova de reprodução/trabalho. O validador deve recomputar seus dados de origem; não deve confiar no fingerprint informado.
- Respostas locais pendentes nunca compõem a solicitação. Revisão histórica continua somente leitura.

## Homologação ainda necessária

O workflow GitHub precisa compilar a regra nova e um operador precisa validar o consumer Apps Script com dados fictícios/emulador e, depois, com uma ação produtiva controlada. A homologação de navegador/aparelho, leitura IAM, corrida de pedidos, replay, revisão alterada, responsável substituto, relatório incompleto e pontuação idempotente ainda não foi concluída. A carga V1 de escala permanece sujeita às revisões de dados já registradas em `RELEASE_STATUS.md`.
