# Serviço de treinamentos HTML — FB

Projeto fixo: `sahmt-gestao-5ae66`. Origem autorizada: `https://anestesiahmtforms.github.io`.
O serviço valida o token Firebase Google de FB e o perfil vigente em cada operação.
Não altera o login sequencial das cinco instâncias.

## Situação em 25/10/2026

- Implementação local de catálogo, leitura, ciência, avaliação, duas tentativas, sugestões, editor, auditorias ROP e Desempenho.
- 66 treinamentos **publicados em FB**, versão 2, com 545 questões no banco, cinco selecionadas por item e 22 modelos de auditoria. Conteúdo e gabaritos continuam privados, conforme perfil/grupo.
- Importação confirmada por leitura dos 229 documentos gravados em três coleções novas. Nenhuma pontuação, usuário, histórico ou arquivo do Drive alterado.
- Publicação dos 66 treinamentos autorizada pelo usuário em 25/10, com gestão temporária somente dos administradores e designação individual de gestores posteriormente. As pendências de revisão foram preservadas; a decisão administrativa de publicar antes da revisão foi registrada sem declarar revisão concluída. Nenhuma participação ou pontuação foi criada por essa publicação.
- Serviço Cloudflare publicado, configurado e **ativo**, em `https://sahmt-html-training.anestesiahmtforms.workers.dev`. Integração no build publicado do PWA ainda pendente.
- Identidade exclusiva `html-training-worker` criada com o papel customizado de cinco permissões abaixo; chave armazenada como secret da Cloudflare. A leitura de um rascunho com essa identidade foi confirmada. Nenhuma chave administrativa vai ao cliente.
- Validação autenticada real concluída em 25/10/2026 às 20:39 (São Paulo), com 13 verificações aprovadas: sessão FB, negação anônima e de origem estrangeira, catálogo dos 66 rascunhos, ausência de gabarito no leitor, conteúdo ROP e maior material ilustrado preservados, editor/banco/auditoria e consulta do desempenho próprio. Zero gravações em treinamentos ou pontuações. Prova em `.local-preview/html-training-live-verification.json`.
- A primeira prova detectou uma incompatibilidade de `fetch`: workerd rejeita `redirect: 'error'`. Corrigido para `manual`, mantendo recusa de respostas de redirecionamento. A correção foi publicada; 73 testes passaram, incluindo reprodução no workerd, e a repetição real foi aprovada.
- Sincronização automática com o Drive ainda **não implementada**: existe somente a fila persistente `htmlTrainingSync`. `PENDING` não significa sincronizado.
- Retirada do leitor PDF realizada no código local; aplicação remota do pacote Apps Script e publicação do PWA ainda pendentes.

## Validação e importação

```sh
npm run test:html-training
npm run test:html-training-browser
node scripts/validate-html-training-package.mjs
npm run import:html-trainings
# Somente após conferir o resultado da simulação:
npm run import:html-trainings -- --apply
```

O importador exige a conta CLI `anestesiahmtforms2@gmail.com`, confere as regras publicadas de FB com `firestore.independent-fb.rules`, verifica hashes e usa criações condicionadas à ausência dos documentos.
Uma nova execução preserva materiais já importados. Conflitos são recusados; não há exclusão ou sobrescrita de dados anteriores.
Pacote e relatórios ficam exclusivamente em `.local-preview/`, ignorada pelo Git.

## Publicação pendente

1. OAuth do Wrangler confirmado na conta Cloudflare existente, incluindo `workers_scripts:write`; account ID `1851e9f4cd5f026371beaa2c5a85f1b8`.
2. Identidade de serviço exclusiva de FB preparada. Nunca usar uma chave de FA nem colocar credenciais no cliente/Git.
3. Publicado inicialmente com `HTML_TRAINING_ENABLED=false`; após validação real, `true`. `FB_WEB_API_KEY` e secret `FB_TRAINING_SERVICE_ACCOUNT_JSON` configurados e conferidos.
4. Identidade de serviço, CORS, negação sem autenticação e acesso com sessão Google real de FB conferidos. A tela local de conferência usa o módulo real do frontend, com gravações bloqueadas.
5. Configurar o endereço completo `/v1/training` em `VITE_HTML_TRAINING_ENDPOINT` no build; publicar a integração somente após validação.
6. Implementar e testar atualização de Docs com controle de revisão e preservação de imagens antes de habilitar sincronização das referências. Até lá, manter o estado pendente visível.

Para validação assistida sem controlar o navegador do usuário, `node scripts/validate-html-training-live.mjs` abre um servidor temporário em `localhost:9031` (domínio já autorizado em FB). O usuário entra com Google em uma sessão Firebase de memória. O servidor exige perfil administrador ativo, testa somente leituras e reverte a ativação do serviço se algum teste falhar. A tela permite conferir o catálogo/editor e bloqueia gravações no servidor. Relatório e URL temporária ficam somente em `.local-preview/`. Esse utilitário não é parte do fluxo público do PWA.

O script `scripts/deploy-html-training-service.mjs` faz apenas conferências por padrão. O usuário autorizou especificamente identidade, função IAM, vínculo, chave persistente e secret após o bloqueio inicial da revisão automática; a aplicação foi concluída em 25/10. A primeira chave foi revogada após uma falha inicial de leitura; a segunda foi validada e guardada no secret. A função tem somente `datastore.databases.get` e `datastore.entities.create/get/list/update`, sem exclusão, IAM ou alteração de regras. O OAuth de runtime solicita apenas o escopo `datastore`; o acesso ao Drive exige implementação e autorização próprias. Não repetir provisionamento de chave para atualizar somente código: usar o deploy normal do Wrangler, que preserva secrets.

Rascunhos não são visíveis aos participantes. Os materiais publicados respeitam seus grupos de acesso existentes. O banco completo e gabaritos nunca são enviados ao leitor.
Somente gestor designado e administrador acessam editor e auditorias. A conclusão da auditoria não concede pontos de treinamento.
