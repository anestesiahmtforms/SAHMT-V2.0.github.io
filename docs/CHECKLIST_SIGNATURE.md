# Assinatura interna do Checklist

## Fluxo

1. O botão aparece para `checklistSign` apenas no relatório do dia atual. Ele fica indisponível offline, com relatório em cache ou enquanto houver respostas locais recusadas/pendentes.
2. Ao pedir revisão, a callable `checklistSignature` lê o perfil ativo, escala, férias, substituições, contatos, perfis UID, estações e respostas no Firestore. O SDK Admin executa as leituras dentro de uma transação; cliente não envia responsável nem snapshot como fonte de verdade.
3. O servidor reproduz a ordem de escala da V1, expande DC, exclui férias e membros substituídos e exige um único perfil ativo e autorizado para a primeira posição disponível. Dados ausentes ou ambíguos impedem a assinatura.
4. A revisão SHA-256 vincula data, responsável, estações vigentes, resposta mais recente de cada estação e horários. A interface apresenta responsável e pendências e exige declaração explícita.
5. Checklist incompleto ou assinatura por pessoa diferente do responsável exige justificativa. A callable verifica a revisão de novo e cria `checklistSignatures/{date}_{revision}` em modo imutável e idempotente. Se houve alteração desde a revisão, a transação falha e a pessoa precisa revisar novamente.
6. Na mesma transação, Checklist completo cria pontuação imutável em `scores` com IDs determinísticos: responsável recebe +1; se outra pessoa autorizada assina, ela recebe +1 e o responsável recebe −1. Repetição da assinatura não duplica ledger. Assinatura incompleta fica registrada para auditoria e não gera pontos.

## Limites atuais

- `firestore.rules` continua negando escrita de cliente em `checklistSignatures`; somente a callable Admin cria o recibo.
- Pontos de Checklist e conclusão de Treinamentos são calculados em callables e gravados em ledger imutável/idempotente; Atividades genéricas ainda dependem de adaptadores de evidência confiáveis específicos.
- As respostas de `checklists` mantêm `responsible*` nulos. O responsável assinado é derivado no servidor e preservado no snapshot da assinatura.
- A revisão cobre apenas registros confirmados no Firestore. A interface bloqueia quando detecta itens locais pendentes; uma cópia local nunca compõe um relatório assinado.
- Source e cliente foram integrados localmente. Em 25/09/2026, 15 testes passaram no Auth, Firestore e Functions Emulator: oito de assinatura, quatro de treinamento, duas conclusões de tarefa (individual pontuada e compartilhada sem pontos) e um cancelamento auditável. Os 33 testes de Firestore Rules e 62 testes de domínio também passaram. A tela já apresenta o responsável retornado pelo servidor ao revisar a assinatura; atribuir responsável individual a cada resposta continua pendente. Uso autenticado no navegador, revisão final de índices e assinatura real controlada ainda precisam ser validados antes da homologação.
- `npm audit --omit=dev` na pasta `functions/` aponta duas vulnerabilidades moderadas transitivas (`uuid` abaixo de 11.1.1 via `gaxios` 6.7.1). As versões diretas Admin/Functions foram atualizadas; não apliquei override de major transitiva sem validação de compatibilidade. Resolver ou revisar formalmente esse alerta antes do deploy.

## Execução local

Instale as dependências com `npm ci` na raiz e em `functions/`. A suíte automatizada de callable executa de forma isolada em `npx firebase emulators:exec --project demo-sahmt-v2 --only auth,firestore,functions "npm --prefix functions test"`. Para validar a interface em Vite, crie `.env.local` com `VITE_USE_FIREBASE_EMULATORS=true` e inicie `npx firebase emulators:start --only auth,firestore,functions --project demo-sahmt-v2`; essa flag, disponível só em Vite DEV, redireciona Auth, Firestore (SDK Lite e completo) e Functions para localhost. Use perfis e dados fictícios; nunca use dados de produção nos emuladores.

## Deploy

Implantar somente `functions:checklistSignature` depois da homologação local: `firebase deploy --only functions:checklistSignature`. Cloud Functions requer que o projeto esteja no plano Blaze; confirme faturamento e orçamento com o proprietário antes do primeiro deploy. Consulte a [documentação oficial de preço e implantação de Cloud Functions](https://firebase.google.com/docs/functions/faq-and-troubleshooting).
