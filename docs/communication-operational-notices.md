# Avisos operacionais e liberação individual

O email Google verificado `marcio.henrique82@gmail.com`, com perfil FA ativo e acesso aprovado, abre o formulário simplificado da Central: título, descrição e ENVIAR. A categoria é AVISO URGENTE, a prioridade URGENT, o público ALL (somente usuários ativos) e o destino Home. A validade segue o padrão existente de sete dias. Os outros administradores continuam com a Central completa.

O identificador do aviso é criado antes do envio e preservado ao reconectar a sessão. O servidor fixa os parâmetros operacionais e reconhece a repetição do mesmo aviso, sem iniciar outro Push. Confirmar a conta Google apenas restaura o texto; não envia mensagens.

A ação SCHEDULE_RELEASE_NOTICE continua exigindo permissão scheduleWrite no perfil FA e uma marca de liberação já confirmada na escala. O servidor resolve uma única pessoa ativa pela sigla, usa audiência USER e publica:

- Título: LIBERAÇÃO
- Descrição: Você está Liberado! O SAHMT agradece por sua dedicação. BOM DESCANSO! 🤜🤛.

O Push usa a mesma mensagem e a mesma audiência individual. A Home mostra somente a liberação da própria sigla autenticada, incluindo os componentes de posições agregadas; as siglas normais da escala permanecem visíveis. A marca de liberação e o horário de outras pessoas não aparecem na Home.

## Publicação do serviço

A publicação do GitHub Pages distribui o formulário e a apresentação da escala. A atualização de `worker-communication/service.js` também precisa ser publicada no Worker existente `sahmt-ff-comunicacao`, na conta Cloudflare `7c4c3dcb7472c5daa58620efd358dfb1` (`anestesiahmtforms6@gmail.com`). Publicar somente o app não troca o texto gerado pelo serviço.

O fluxo de produção existente é:

```sh
node scripts/deploy-communication-production.mjs --apply
```

Ele depende do perfil local autorizado `sahmt-ff-isolation` e da credencial protegida já provisionada no Windows. Não copie essa credencial para o repositório. A conta precisa corresponder exatamente à configuração do Worker. Preserve os bindings e as filas existentes.

## Verificação sem envios reais

```sh
node --test tests/communication-operational-notices.test.js tests/schedule-release.test.js tests/communication-performance.test.js tests/communication-push-directory.test.js tests/communication-client-lifecycle.test.js
```

Os testes usam perfis e dispositivos sintéticos. Eles cobrem o formulário fixo, a proteção contra duplicação, a audiência individual, o texto e o Push, a exigência de autorização e a privacidade da marcação verde na Home.

## Correção do retorno da liberação

Administradores são reconhecidos pelo perfil FA (função administrador_app ou permissão admin), e Márcio pelo email Google verificado, além dos perfis com scheduleWrite. O perfil deve continuar ativo e autorizado. A liberação da própria pessoa é incluída na primeira página da caixa de entrada da Home, mesmo quando há muitos avisos destinados a terceiros.

A confirmação distingue aviso publicado, Push na fila, ausência de aparelho ativo, Push desativado e aceitação pelo FCM. Entrar na fila não confirma recebimento. O botão de uma sigla já liberada mostra CANCELAR LIBERAÇÃO, evitando uma retirada silenciosa ao clicar novamente.

O service worker avisa as janelas abertas independentemente de falha ao mostrar a notificação do sistema. A Home exibe páginas recebidas progressivamente e atualiza ao retornar ao aplicativo, sem consultas periódicas em segundo plano. Falhas de sessão ficam visíveis com acesso à Central.

O consumidor da fila usa max_batch_size 1. A configuração anterior com três mensagens podia exceder o orçamento compartilhado de 44 chamadas externas da execução. O teste communication-queue-budget passa pelo handler real, pela implementação de armazenamento e pelo envio simulado de três aparelhos, e reproduz a falha ao restaurar o lote anterior. As filas, os destinatários e os limites de gasto não são ampliados.

## Contagem diária e diagnóstico de limites

O limite legado de 200 operações misturava abertura da Home, consultas e envios de todos os usuários. Agora há um limite separado de 200 novas publicações por dia UTC e uma proteção geral de 2.000 operações por dia UTC. Permanecem 20 operações por minuto por UID e 44 chamadas externas por execução. Esses números são limites internos; o consumo do provedor depende também de documentos, consultas e aparelhos.

Somente a primeira publicação de um aviso consome o saldo de publicações. Rascunhos, edições, validações recusadas e repetição do mesmo envio não consomem outra publicação. A reserva é transacional. Ao iniciar o contador novo, uma agregação por firstPublishedAt inclui os avisos já publicados naquele dia, sem zerar o histórico. O contador antigo de operações é preservado e registra separadamente consultas e outras ações a partir da atualização.

A ação administrativa USAGE e a tela USO E LIMITES DIÁRIOS permitem consultar o consumo mesmo quando a proteção geral diária bloqueia outras operações; autenticação, perfil ativo e limite por minuto continuam obrigatórios. Márcio vê o saldo de publicações no formulário simplificado. Operações anteriores à separação são identificadas como sem classificação histórica.

Erros distinguem limite diário de publicações, proteção diária de operações, orçamento de trabalho por operação e limitação do provedor. Respostas de limite diário informam consumo, teto e horário de renovação. Nenhuma opção altera faturamento ou ativa plano pago.

## Entrega durante a preparação de destinatários

Cada página reserva suas pendências antes de enfileirar os aparelhos. O consumidor verifica essa reserva e pode entregar enquanto as páginas seguintes ainda são preparadas. Na implementação anterior, o estado queueing obrigava todo aparelho a repetir o processamento até terminar a paginação; com repetição imediata, as tentativas podiam se esgotar antes disso.

A reserva guarda os aparelhos e o próximo cursor. Se o produtor falhar ou perder a resposta do enfileiramento, ele reutiliza o mesmo plano sem aumentar novamente as pendências; trabalhos repetidos continuam usando o recibo individual existente. O total processado conta somente os aparelhos concluídos. Trabalhos legados sem referência à reserva continuam seguindo o fluxo anterior, sem reinterpretar seus contadores. Falhas aguardam 30 segundos antes de nova tentativa, mantendo o máximo existente de cinco repetições e o lote de um trabalho por execução.

Os testes simulam sete aparelhos, mais de uma página, consumidores que terminam antes da resposta do produtor, falhas antes e depois do enfileiramento e reservas inválidas. O handler real também percorre o fluxo completo com respostas HTTP sintéticas, conferindo o teto de 44 chamadas externas por execução. Isso verifica a correção sem enviar avisos reais e sem atribuir o incidente anterior a uma causa que não foi registrada em produção.
