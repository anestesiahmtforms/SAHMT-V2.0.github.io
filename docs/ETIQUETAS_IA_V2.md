# Leitura de Etiquetas por IA no V2

## Arquitetura

O PWA mantém Firebase Authentication, App Check e Firestore no plano Spark. A leitura assistida usa o Cloudflare Worker `sahmt-label-ai`; a chave `OPENAI_API_KEY` fica somente como Secret no Worker.

1. A pessoa captura ou seleciona uma etiqueta. O aparelho preserva o enquadramento atual, reduz a imagem e prepara os recortes numéricos em memória.
2. Ao tocar em **LER ETIQUETA**, o PWA obtém o Firebase ID Token da sessão ativa e um token da instância App Check já inicializada. Envia `imageDataUrl` e `numericImageDataUrls` por HTTPS ao Worker.
3. O Worker valida assinatura, algoritmo, emissor, audiência, validade e identidade dos dois JWTs com os JWKS públicos oficiais. Em seguida consulta `users/{uid}` pelo Firestore REST usando o ID Token do próprio usuário, para que as Security Rules continuem valendo. Exige perfil ativo e acesso habilitado com `labelsWrite`, `labelsManage`, `admin` ou o perfil `administrador_app`.
4. O Worker envia a imagem à OpenAI Responses API usando GPT-6 Luna, `store:false` e Structured Outputs. O resultado é validado e devolvido como rascunho; a pessoa confere e salva pelo formulário normal.
5. O Worker não grava etiquetas nem imagens no Firestore, Storage, cache ou outbox. A gravação continua sendo uma ação humana explícita no PWA.

A função Firebase `readLabelImage` não é mais chamada nem necessária para Etiquetas. Cloud Functions e plano Blaze não são requisitos deste fluxo. Outras funções Firebase, se existirem para módulos diferentes, seguem seus próprios requisitos.

## Regras de leitura

O prompt e os três formatos atuais permanecem: etiqueta padrão, Consulta Pré-anestésica e SADT. A regra numérica é conservadora: extrai apenas dígitos visíveis e deixa vazio quando houver dúvida, inclusive entre 0 e 8. A IA não salva automaticamente. Se a leitura falhar, o registro manual, nova captura e nova tentativa continuam disponíveis.

O CORS aceita somente `https://anestesiahmtforms.github.io`. O Worker não registra conteúdo de imagem, base64, tokens, dados clínicos nem chave OpenAI. `store:false` não deve ser interpretado como garantia de ausência de qualquer retenção operacional pela OpenAI; antes de usar dados reais, confirme autorização institucional e controles contratuais aplicáveis.

## Configuração e homologação

Consulte [`LABEL_AI_WORKER.md`](LABEL_AI_WORKER.md) para configuração do App Check no Firebase, variáveis públicas do GitHub Actions, deploy do Worker e roteiro de testes. O endpoint público `/health` é um teste de disponibilidade, não comprova que a última versão do código esteja implantada nem valida uma sessão real.

## Estado deste checkout

O código do Worker, testes automatizados e integração PWA ficam versionados no repositório. Em 30/09/2026, uma consulta somente de leitura ao Wrangler confirmou tráfego de 100% na versão implantada `2f609917-ffa3-46ab-aea3-fc573541ffac`, criada em 29/09 às 06:28:58 de Brasília, e a presença do Secret `OPENAI_API_KEY`, sem leitura do valor. `GET /health` retornou HTTP 200, serviço `sahmt-label-ai`, projeto `sahmt-17a16` e modelo `gpt-6-luna`.

As variáveis atuais do GitHub Actions são `VITE_LABEL_AI_ENABLED=true`, endpoint `https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract` e site key App Check presente. O proprietário confirmou leitura de uma etiqueta no iPhone em 29/09; a origem fictícia ou real dessa imagem não foi estabelecida neste registro. Não houve novo teste autenticado com imagem fictícia, câmera física, gravação ou conferência Android nesta auditoria. Esses metadados não comprovam que qualquer mudança posterior no código foi implantada, nem substituem os testes de Auth, App Check, permissão e confirmação humana de cada registro. Nenhuma variável, segredo ou implantação foi alterada durante esta verificação.
