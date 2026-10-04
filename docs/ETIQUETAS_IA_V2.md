# Leitura de Etiquetas por IA no V2

## Arquitetura

O PWA mantém Firebase Authentication, App Check e Firestore no plano Spark. A leitura assistida usa o Cloudflare Worker `sahmt-label-ai`; a chave `OPENAI_API_KEY` fica somente como Secret no Worker.

1. A pessoa captura ou seleciona uma etiqueta. O aparelho preserva o enquadramento atual, reduz a imagem e prepara os recortes numéricos em memória.
2. Ao tocar em **CAPTURAR E LER ETIQUETA**, o PWA fecha a câmera e inicia a leitura da imagem recortada. Obtém o Firebase ID Token da sessão ativa e um token da instância App Check já inicializada. Envia `imageDataUrl` e `numericImageDataUrls` por HTTPS ao Worker. A seleção de uma foto alternativa ainda exige confirmar seu enquadramento com esse mesmo botão.
3. O Worker valida assinatura, algoritmo, emissor, audiência, validade e identidade dos dois JWTs com os JWKS públicos oficiais. Em seguida consulta `users/{uid}` pelo Firestore REST usando o ID Token do próprio usuário, para que as Security Rules continuem valendo. Exige perfil ativo e acesso habilitado com `labelsWrite`, `labelsManage`, `admin` ou o perfil `administrador_app`.
4. O Worker envia a imagem à OpenAI Responses API usando GPT-6 Luna, `store:false` e Structured Outputs. O resultado é validado e devolvido como rascunho; a pessoa confere e salva pelo formulário normal.
5. O Worker não grava etiquetas nem imagens no Firestore, Storage, cache ou outbox. A gravação continua sendo uma ação humana explícita no PWA.
6. Após conferir e salvar o rascunho, a confirmação do Firestore fecha o formulário e retorna à tela inicial de Etiquetas. O botão **ABRIR CÂMERA** mostra **✓ Feito!** em verde na sua parte interna direita, sem aviso de sucesso no modal ou na página. A confirmação fica visível por 3,4 segundos, esmaece durante 0,6 segundo e desaparece ao completar 4 segundos. A confirmação **✓ Confirmado** do **REGISTRO MANUAL** segue o mesmo prazo; **✕ Pendente** não desaparece por tempo. O prazo começa no retorno confirmado do Firestore, não depende de planilha, não reinicia ao renderizar e não apaga o aviso de um registro mais recente. Falhas preservam os dados no formulário e não mostram Feito. O indicador é da sessão atual e é limpo ao iniciar outra captura ou trocar de conta. Respostas atrasadas de leitura ou salvamento não substituem nem fecham uma nova entrada ou edição.

A função Firebase `readLabelImage` não é mais chamada nem necessária para Etiquetas. Cloud Functions e plano Blaze não são requisitos deste fluxo. Outras funções Firebase, se existirem para módulos diferentes, seguem seus próprios requisitos.

## Regras de leitura

O prompt e os três formatos atuais permanecem: etiqueta padrão, Consulta Pré-anestésica e SADT. A regra numérica é conservadora: extrai apenas dígitos visíveis e deixa vazio quando houver dúvida, inclusive entre 0 e 8. A IA não salva automaticamente. Se a leitura falhar, o registro manual, nova captura e nova tentativa continuam disponíveis.

O CORS aceita somente `https://anestesiahmtforms.github.io`. O Worker não registra conteúdo de imagem, base64, tokens, dados clínicos nem chave OpenAI. `store:false` não deve ser interpretado como garantia de ausência de qualquer retenção operacional pela OpenAI; antes de usar dados reais, confirme autorização institucional e controles contratuais aplicáveis.

## Configuração e homologação

Consulte [`LABEL_AI_WORKER.md`](LABEL_AI_WORKER.md) para configuração do App Check no Firebase, variáveis públicas do GitHub Actions, deploy do Worker e roteiro de testes. O endpoint público `/health` é um teste de disponibilidade, não comprova que a última versão do código esteja implantada nem valida uma sessão real.

## Estado deste checkout

O código do Worker, testes automatizados e integração PWA ficam versionados no repositório. A implantação do código atualizado no Cloudflare precisa ser confirmada separadamente. Até configurar `VITE_APP_CHECK_SITE_KEY` e habilitar `VITE_LABEL_AI_ENABLED=true` no build publicado, a IA permanece desligada e o registro manual funciona normalmente. Uma homologação autenticada com App Check, perfil autorizado e imagem de teste ainda é necessária antes de considerar a leitura pronta para produção.
