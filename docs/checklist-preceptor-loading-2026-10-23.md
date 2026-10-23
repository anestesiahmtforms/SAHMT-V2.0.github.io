# Conferência do Preceptor — versão 226

A janela de conferência fazia um import tardio de `checklist-signature.js`. Esse adaptador apenas encaminhava a prévia e a gravação para `data.js`, módulo que o próprio Checklist já havia carregado e que faz parte do pré-cache. O adaptador não estava no pré-cache e podia depender de um arquivo com hash antigo que deixou de existir na hospedagem após uma atualização.

A tela agora obtém as duas funções diretamente de `data.js` e mantém a referência da função de gravação durante a confirmação. O adaptador intermediário foi removido. A assinatura não introduz um novo download de módulo no momento de confirmar.

O fluxo mantém verificação do usuário, conteúdo do relatório, escalado e estado atual antes da gravação. Não foram alterados pontuação, permissões, regras Firestore ou contratos de registro. Falhas de transporte de módulos recebem uma orientação em português; a tela não recarrega automaticamente nem apaga rascunhos.

Os testes de ciclo da tela cobrem troca de usuário/revisão, conclusão existente, catálogo pendente, perda de escalado e o acesso direto às funções. O teste do service worker confirma que `data.js` e suas dependências estáticas são pré-carregados. A mensagem na captura identifica uma falha de carregamento de JavaScript, mas não permite afirmar sozinha qual versão/arquivo falhou no iPhone.
