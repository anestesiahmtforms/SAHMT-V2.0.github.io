# Piloto operacional FA / FB / FC — 12/10/2026

## Evidência real desta execução

- Gateway operacional atualizado para versão 2; 51 funções operacionais preservadas, cinco escopos OAuth.
- Identity Toolkit API e Firestore API do executor `sahmt-auth-gateway` estavam desativadas. Foram habilitadas sem conta de faturamento. IAM Credentials já estava habilitada.
- Após a habilitação, lookup FB passou a retornar `OK`. FC revelou incompatibilidade com `emailVerified` omitido. Agora o campo omitido é normalizado para `false`; tipos inválidos continuam bloqueados.
- Tokens OAuth obtidos exclusivamente por `ScriptApp.getOAuthToken()` são tratados como opacos, com limites de tamanho e caracteres, sem inferir seu tipo pelo número de pontos.
- Lookup FA, FB e FC: POST 302, resposta final HTTP 200, HMAC válido, código `OK`, UID do piloto correspondente nos três projetos.
- `READ_FA_AUTHORIZATION`: POST 302, HTTP 200, HMAC válido, código `OK`. A leitura ocorreu pelo executor Apps Script, e não apenas pela Firebase CLI.
- Segurança real: requisição válida `OK`; reutilização do mesmo envelope `GATEWAY_REPLAY_DENIED`; assinatura adulterada `GATEWAY_ADMISSION_DENIED`.
- Executor iniciou e reverteu transação vazia FB com HTTP 200; nenhum documento foi gravado nesse teste.
- Billing API: FA, FB, FC e projeto executor sem faturamento vinculado.

## Configuração privada de identidades

As três identidades protegidas foram novamente correspondidas por UID e e-mail através do Authentication FA. Os valores ficam fora do Git e do frontend.

O Gateway aceita `SAHMT_FA_PROTECTED_IDENTITIES_JSON` nas propriedades. Na ausência exata dessa propriedade (`null`), a implantação pode fornecer o mesmo JSON por `mgwDeploymentProtectedIdentityPolicyJson_()`, em arquivo Apps Script privado gerado dos dados verificados. A validação é idêntica; uma propriedade existente inválida não é ignorada nem substituída. Sem ambas as fontes, o FA continua bloqueado. A implantação atual contém esse arquivo privado; nenhum UID real consta no código público de preparação.

## Limites operacionais

O fluxo FB preserva 13 idas ao Gateway, incluindo revalidações antes e depois da concessão. A latência real excedia a janela antiga de 18/20 segundos. Foram alinhados:

- Broker independente por destino: 60 s; limpeza: 10 s.
- Worker HTTP: 80 s; supervisão: 10 s; reserva Durable Object máxima: 90 s.
- Navegador piloto: 90 s. Home e autenticação principal não aguardam essa conexão.
- Envelope individual Gateway mantém validade de 20 s; não foram adicionados retries nem cache de autorização.
- Primeiro login especial permanece desativado, com seu contrato anterior de tempo preservado.

Validação: 189 testes Gateway; 210 testes broker/runtime/SQLite; 55 testes da composição e diagnóstico do navegador. Essas contagens são de suítes focadas, não uma soma de testes únicos do projeto. Build isolado Vite concluído.

## Estado do piloto

- Broker: `https://sahmt-auth-broker.anestesiahmtforms.workers.dev`.
- PWA isolada: `https://sahmt-auth-pilot.anestesiahmtforms.workers.dev`.
- Allowlist server-side singleton do administrador aprovado, armazenada como segredo Worker.
- Gateway: operações necessárias aos destinos e concessões habilitadas; `FIRST_LOGIN_FA_SIGN=false`.
- Worker: FA→FB e FA→FC habilitados somente no piloto; primeiro login especial e provisionamento automático FC desligados.
- PWA pública utilizada pela equipe não substituída.
- Regras Firestore FB/FC continuam bloqueando dados. Autenticação secundária não comprova autorização de leitura/escrita dos módulos nem migração de dados.

## Verificação humana ainda indispensável

O administrador efetuou o login Google na janela correta e forneceu relatório sanitizado: FA conectado com Google vinculado; FB/FC ainda não inicializados; coordenador `OPTIN_UNAVAILABLE`. O controle do navegador continua indisponível para essa janela.

A causa foi reproduzida localmente: a composição consultava flags não exportadas pelos módulos Firebase secundários. Corrigida para utilizar os getters reais, que preservam as flags e validam as configurações. A regressão executa a composição real com dependências externas simuladas; 29 testes focados passaram. Build concluído e piloto isolado atualizado para `01863a48-de39-484f-9d7d-26000bf01363`. HTML, manifesto de assets e chunk corrigido foram conferidos via HTTP 200 e SHA-256 idêntico ao build local. A PWA da equipe permanece inalterada.

O segundo relatório confirmou inicialização de FB/FC, ambos desconectados, com `BROKER_UNAVAILABLE`. Uma solicitação sintética inválida ao Worker retornou HTTP 503 antes de consultar serviços Google. A mesma sequência foi reproduzida no workerd local: OPTIONS seguido de POST reutilizava um stub de Durable Object pertencente ao contexto de outra requisição. A correção resolve um novo stub a cada admissão, liberação e validação de nonce, mantendo o namespace e o cache de configuração.

O broker foi temporariamente desativado durante a correção e reativado somente após os testes. A regressão cobre preflight seguido de POSTs sequenciais e concorrentes, nonce entre requisições e consumo atômico de nonce concorrente. Resultado: 99 testes Worker/runtime/HTTP e 74 testes navegador/transporte/diagnóstico aprovados. As falhas de importação e inicialização agora são isoladas por destino; nenhum token ou lease é solicitado para um alvo sem Auth disponível. O diagnóstico transmite somente códigos de uma lista fechada e status HTTP, inclusive negações JSON limitadas a 4 KB, sem dados pessoais ou tokens.

Versões publicadas: broker `c926273d-e145-48f1-841c-12d52c7bb7fb`; PWA isolada `2981d6c8-3ec4-4a77-9b69-7d5369c01102`; Gateway permanece v2. A verificação real retornou OPTIONS 204 e dois POSTs sintéticos inválidos consecutivos 403 `FA_TOKEN_REJECTED`, todos com CORS correto. Nenhuma identidade ou serviço Google foi acessado nessas provas de rejeição. HTML, manifesto e chunks de composição/diagnóstico tiveram SHA-256 confirmado no endpoint publicado.

Foi solicitada nova atualização da janela administrativa e relatório. FA Google está comprovado pelo relatório do usuário; sessões autenticadas FB/FC ainda aguardam observação real. Nenhuma alteração nesta correção foi aplicada à PWA pública, IAM, usuários ou regras de dados.

Após o login, conferir o painel sem identificadores: FA/FB/FC conectados, correspondência de UID, resultado do coordenador; depois logout global e reconexão. Até isso ocorrer, não declarar o login ponta a ponta aprovado.

### Investigação do token FA — observação de 18:50 UTC

O usuário forneceu novo relatório com FA conectado pelo Google, FB/FC desconectados e HTTP 403 `FA_TOKEN_REJECTED`. O broker foi temporariamente desativado durante a correção. A verificação do endpoint público de certificados retornou HTTP 200, quatro chaves RSA de 2048 bits e certificados válidos; nenhum token de usuário foi coletado.

A causa foi reproduzida no workerd: `fetch` rejeita a opção `redirect: 'error'` antes de iniciar a consulta. O adaptador server-side foi ajustado para `redirect: 'manual'`, preservando a exigência de HTTP 200, URL exata e resposta não redirecionada. HTTP 301/302/307 permanece recusado, sem seguir o destino. O verificador do primeiro login especial recebeu a mesma correção local; sua flag permanece desligada.

Foram acrescentados testes no runtime real workerd para certificados X.509 sintéticos, validade temporal, chave pública RSA, cache entre requisições e redirecionamentos. A composição completa Worker → protocolo HMAC → Gateway em VM → operações Google simuladas → SQLite nonce/lease passou em duas requisições consecutivas, com mesmo UID em FB/FC e isolamento de falhas dos signers. Essa prova é local, sem login Firebase real.

### FC isolado e contenção do ledger de nonce — observação de 19:07 UTC

O relatório real do administrador confirmou FA conectado pelo Google e FB conectado com UID correspondente ao FA. FC permaneceu indisponível com `FA_TOKEN_REJECTED`. A validação local mostrou que esse código também cobre a consulta Auth FA e sua revalidação; não é prova, isoladamente, de token inválido.

Uma prova real com duas consultas `AUTH_USER_LOOKUP_FA` simultâneas produziu um `OK` e um `GATEWAY_ADMISSION_DENIED`, ambos autenticados por HMAC. Acrescentado o motivo fechado `GATEWAY_LOCK_BUSY`, uma prova limitada de quatro consultas revelou dois `OK` e duas recusas por bloqueio ocupado. Assim, foi confirmada contenção na admissão do nonce, antes de OAuth/API Google para as requisições recusadas.

A correção mantém cada espera de `tryLock` limitada pelo `lockTimeoutMs` existente, com no máximo cinco esperas, cinco segundos totais e sempre antes da expiração original assinada. O relógio é revalidado entre esperas e após adquirir o bloqueio. Não há retry HTTP ou de operações Google. A posse do bloqueio, o consumo único do nonce, a confirmação de persistência e o bloqueio de replay permanecem obrigatórios. Configuração, segredos e permissões não foram alterados.

Após a correção no Gateway v4, as quatro consultas simultâneas retornaram HTTP 200, `OK`, HMAC válido e UID correspondente, em 2,1 a 3,9 segundos. Isso comprova a correção do conflito reproduzido, mas não substitui a observação da sessão Firebase FC no navegador.

A prova real com duas cópias simultâneas do mesmo envelope retornou exatamente um `OK` e um `GATEWAY_REPLAY_DENIED`, ambos HMAC válidos. O nonce não foi aceito duas vezes após a espera pelo bloqueio.

O diagnóstico de falhas parciais foi preservado até o painel, mesmo quando o outro destino conecta. Apenas `{stage, code}` de listas fechadas é transmitido, condicionado ao piloto no servidor; nenhum identificador ou token é incluído. Motivos do Gateway só são aceitos após validação HMAC, vínculo da resposta, expiração e nonce. O erro principal mantém seu contrato anterior.

Verificação local: 170 testes da suíte completa Gateway (incluindo os 24 testes focados de lock/relógio/persistência); 301 testes de cliente/adaptador/broker/transporte/coordenador/painel; 12 testes workerd com fluxo completo, concorrência, falhas independentes e timeout. Todas as suítes passaram, além de sintaxe e build isolado. A suíte anterior de diagnóstico passou em 466 testes; as contagens históricas se sobrepõem e não devem ser somadas.

Gateway v4 preserva as 51 funções, manifesto e demais arquivos remotos. Primeiro login especial e provisionamento automático seguem desligados. A PWA da equipe, usuários, IAM e regras Firestore não foram alterados nesta correção. A confirmação final de FC, logout global e reconexão ainda depende do relatório da janela administrativa do piloto.

Publicações desta correção: broker `083b2a30-a3cc-4f20-9819-8c04382247b0`; PWA isolada `d9372671-1304-4af6-963c-4742dd698dee`; Gateway v4. HTML em `/`, manifesto e três chunks alterados retornaram HTTP 200 com SHA-256 idêntico ao build. Preflight do broker retornou 204; token sintético inválido foi recusado com HTTP 403 e CORS correto. Foi solicitado o novo relatório do administrador, preservando o login FA existente.

## Reversão

1. Desabilitar imediatamente o broker: `npx wrangler deploy --config .local-preview/operational-pilot/wrangler.json` (todas as flags operacionais falsas).
2. Desativar Gateway com a função privada existente `desativarPilotoAdministrativoV1` no editor, ou suspender a implantação pela API Apps Script. O endpoint e a implantação ficam no registro privado ignorado pelo Git.
3. Encerrar as sessões na PWA isolada; uma desativação do broker impede novas trocas, mas não revoga por si só ID tokens já emitidos.
4. Preservar usuários, perfis, dados históricos e IAM salvo autorização específica para restaurar os backups. Backups IAM e configuração permanecem locais protegidos.

Evidências sanitizadas e metadados privados de implantação estão em `.local-preview/operational-pilot/`; segredos/configuração privada no diretório local SAHMT fora do repositório. Nunca anexar esses arquivos privados a commits ou relatórios públicos.
