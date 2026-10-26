# Publicação dos treinamentos HTML em FB

O modelo HTML substitui o leitor PDF/e-book e o fluxo de Forms da área Gestão
de Documentos. A autenticação existente de FA/FB/FC/FD/FE permanece preservada.

## Conteúdo e administração

Em 25/10/2026, o administrador autorizou publicar os 66 materiais e indicar os
gestores posteriormente. Todos foram publicados em FB na versão 2 com gestão
somente dos administradores. Os grupos de acesso anteriores foram preservados:
52 materiais gerais e 14 restritos. Há 545 questões no banco, cinco selecionadas
por material, e 22 instrumentos de auditoria ROP.

As pendências de revisão institucional permanecem no editor, com o registro da
decisão administrativa de publicar antes da revisão. Nenhuma pendência foi
marcada como concluída automaticamente. Publicação não cria tentativas ou pontos.

## Funcionamento

- Até duas tentativas concluídas por usuário/item; a segunda repete as etapas.
- Maior nota preservada, ciência pontuada uma vez e sugestão com decisão manual
  única; correções administrativas substituem a concessão anterior.
- Texto e imagens em FB, com cache por conta/item/versão. Banco e gabaritos
  permanecem no serviço; o leitor recebe somente as cinco questões públicas.
- Editor e auditoria limitados a administrador ou gestor designado. Auditoria
  não concede pontos de treinamento.
- Resultados HTML projetados separadamente em Desempenho, preservando o ledger
  e os resultados históricos.

## Verificação

O serviço real passou em 13 verificações com sessão Google de FB: autenticação,
origens, catálogo, privacidade das questões, texto e imagens preservados, editor,
auditoria e desempenho. A publicação dos 66 itens foi conferida por nova leitura.
Testes locais cobrem concorrência, revogação, tentativas, pontuação e o runtime
workerd da Cloudflare. A interface foi conferida em desktop e celular, e os
builds independentes de FA e FB foram gerados com o endpoint real.

## Estado das dependências

O serviço Cloudflare `sahmt-html-training` está ativo com identidade exclusiva de
FB e credencial armazenada como secret. Nenhuma chave é incluída no PWA/Git.
As regras de FB não foram abertas para acesso direto às novas coleções.

A sincronização automática de revisões do PWA com os Google Docs de referência
ainda está pendente: existe a fila persistente, sem processador de sincronização.
O editor informa o estado pendente. A remoção do leitor antigo está no código
desta versão; a limpeza do projeto Apps Script remoto ainda exige aplicação
separada, mantendo a suspensão das leituras PDF.

Materiais, imagens, gabaritos e relatórios detalhados ficam em FB ou em
`.local-preview/`, ignorada pelo Git, e não no repositório público.
