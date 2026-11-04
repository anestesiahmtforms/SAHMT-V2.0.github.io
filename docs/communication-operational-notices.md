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
