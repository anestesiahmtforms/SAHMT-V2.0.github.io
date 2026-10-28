# Histórico vacinal em FB

Destino: Governança → Grupos de Gestão → Gestão de Pessoas → Meu Histórico Vacinal. Integração nativa preserva as atividades existentes e retorna um nível pelo botão Voltar. Anos 2026–2028; quatro categorias obrigatórias e quatro vacinas. A informação é autodeclarada, sem conclusão clínica ou validação automática de comprovante.

## Situação da implantação

Código, rotas do serviço, tela e painel integrados e testados. As versões de produção FA/FB foram geradas e o verificador de dependências de FA passou. O usuário autorizou publicar imediatamente para testar com seu login, dispensando por enquanto a etapa de OAuth do Drive. Configuração de produção: `VACCINATION_ENABLED=true`, `DOCUMENT_UPLOADS_ENABLED=false`. Cadastro e painel liberados; anexos são mostrados como indisponíveis, sem afirmar envio ao Drive. Não houve criação de cliente OAuth nem concessão de permissão adicional ao Drive. A conexão dos anexos permanece pendente de uma etapa separada.

Os 53 vínculos privados de usuários foram gravados em `professionalDocumentFolders` em FB e relidos com sucesso: 53 profissionais, 212 subpastas, zero alterações de permissões e zero arquivos enviados. Mapas e backup anteriores estão somente em `.local-preview/professional-folders/`, ignorada no Git. A pasta principal privada é `1ETtQoCK4DBQ06gwecJbb0Ac5SneAnRGK`, propriedade de `anestesiahmtforms@gmail.com`. As cinco contas proprietárias são excluídas das pastas e dos indicadores.

## Segurança e armazenamento

- SDK do navegador não lê/grava `occupationalVaccinations`, `professionalDocumentFolders`, `professionalDocumentUploads` ou `professionalDocumentUploadLimits`; testes sobre as regras publicadas confirmaram essa negação inclusive para administradores. Nenhuma alteração das regras publicadas foi necessária.
- As operações passam pelo serviço Cloudflare já existente, que verifica token Google Firebase FB, perfil vigente, identidade e papel em cada operação. Administrador é somente `administrador_app` ou `permissions.admin === true`; `peopleManage`/`managementManage` não dão consulta a terceiros.
- Firestore guarda cadastro/referências/diário; Drive guarda os bytes. Nenhum cache persistente de dados ou fotos no navegador. Mudança de conta, negação HTTP 401/403 e encerramento do módulo eliminam dados e prévias da tela.
- Destino é resolvido no servidor por UID/e-mail e contexto fechado; cliente não escolhe UID, e-mail ou folderId. Hierarquia, proprietário único e `shared === false` são verificados nos três níveis antes do envio; arquivos compartilhados ou com privacidade desconhecida são recusados.
- Reenvio usa UUID/hash/ID reservado do Drive e reconciliação após falha parcial. Mudança de mapeamento impede reusar um diário com destino antigo; mapeamento/perfil são reconferidos na confirmação.
- Fotos produzidas no aparelho em JPEG de até 1600 pixels e 2 MiB; PDFs até 5 MiB. Limite de 30 novas solicitações de upload/dia/profissional. Texto permanece legível na prévia antes de confirmar. Limites de consulta do adaptador: máximo 1000 documentos; atingir o limite falha explicitamente, sem relatório parcial silencioso.
- O painel mostra participação e duas coberturas autodeclaradas (entre cadastrados elegíveis e entre respondentes), com denominadores claros. Quem não respondeu não é classificado como não vacinado. Grupos sem categoria cadastrada/resposta ficam em Não informado; o cadastro usa um retrato atual dos perfis ativos/com acesso, não um denominador histórico congelado.

## Conexão Drive pendente

O serviço existente tem somente o secret `FB_TRAINING_SERVICE_ACCOUNT_JSON`, que autentica Firestore e não o Drive. Não criar outra chave de conta de serviço nem reutilizar um token de CLI como credencial permanente. Meu Drive requer operação como a conta proprietária; OAuth deve ser concedido pelo proprietário.

Cliente adicional sugerido: OAuth de computador para a preparação administrativa, com retorno loopback local e PKCE. O refresh token fica exclusivamente no secret do servidor `PROFESSIONAL_DRIVE_OAUTH_JSON`, no formato `{clientId,clientSecret,refreshToken,ownerEmail}`. `ownerEmail` deve ser `anestesiahmtforms@gmail.com`. Escopos necessários para este adaptador: Drive e identidade `openid`/e-mail. A permissão Google pode ser ampla na conta; o código limita os destinos à árvore privada autorizada.

Conferir o estado de publicação/audiência do aplicativo OAuth antes de conceder acesso offline. Em modo de teste, autorizações com escopo Drive podem expirar em sete dias. Não modificar a configuração global do login já existente sem conferir seu impacto. Não declarar conexão permanente sem verificar esse estado e a renovação do token. Não colocar JSON de cliente, refresh token, arquivo de credenciais ou mapas pessoais no Git/frontend/logs.

Depois do consentimento manual: validar o proprietário via UserInfo, validar privacidade/hierarquia das pastas, guardar o secret por stdin sem imprimir valores, publicar o Worker preservando secrets e treinos, ativar flags independentemente e testar com um pequeno documento sintético privado. Não criar resposta de saúde falsa de um profissional real. Publicar FA/FB, confirmar o botão e os chunks e realizar somente leituras autenticadas iniciais em produção.

## Flags e comandos

`VACCINATION_ENABLED` controla `/v1/vaccination`; `DOCUMENT_UPLOADS_ENABLED` controla `UPLOAD` em `/v1/professional-documents`. Listas autenticadas de documentos funcionam sem OAuth/sem upload. A falta de conexão não impede os registros; o painel de registros tolera indisponibilidade temporária dos comprovantes, mas negação de acesso apaga dados sensíveis.

```
npm ci
npm run test:vaccination
npm run test:vaccination-rules
npm run test:html-training
npm run test:domain
```

Para conferir o mapa privado (simulação por padrão):

```
node scripts/prepare-professional-document-folders.mjs --folders PRIVATE_SUBFOLDER_MAP --identities PRIVATE_IDENTITY_MAP
```

`--apply` já executado para os 53 vínculos; novas execuções são idempotentes e não devem criar pastas novamente. Nenhuma cobrança/Blaze/Apps Script foi ativada.

Prévia de desenvolvimento sintética:

```
node node_modules/vite/bin/vite.js --config vite.vaccination-preview.config.mjs --configLoader native
```

Abrir `/tests/fixtures/vaccination-preview.html`, `?role=admin` para cenário administrativo, ou `?entry` para retorno de Gestão de Pessoas. Esses parâmetros são somente do fixture e não autorizam nada em produção. Teste `npm run test:vaccination-browser`; no computador atual usar `SAHMT_TEST_BROWSER_CHANNEL=msedge`.

## Verificação final realizada

- 44 testes de vacinação/documentos/Drive/importador/serviço, incluindo workerd.
- 5 testes de navegador, com 320/390/768/1440 pixels e casos de revogação.
- 2 testes de regras sobre uma cópia das regras realmente publicadas em FB, cujo conteúdo é igual ao arquivo local.
- 86 testes de treinamentos e 1082 testes de domínio existentes.
- Build completo FA/FB e simulação de empacotamento do Worker aprovados. Aviso de chunk grande já existente no projeto, sem falha de build.
- Revisão independente Astra; três achados materiais corrigidos e reconferidos: privacidade atual das pastas, limpeza após revogação e destino antigo em reenvio.

As pesquisas anônimas de clima/estresse em FE continuam separadas e não foram alteradas. Vacinação é identificada e não deve reutilizar as coleções ou afirmações de anonimato dessas pesquisas.

## Envio manual para o administrador

Por solicitação do usuário para testar com a conta proprietária, o painel administrativo inclui Abrir pasta no Drive. Abre a pasta principal privada em outra guia com acesso Google normal, sem transmitir a sessão Firebase. O usuário escolhe a pasta do profissional e a categoria e envia pelo Drive. Isso não habilita o upload automático, não cria registro de anexo no app e não amplia permissões das pastas.
