# Autenticação e autorização na separação de Gestão

Documento de preparação, elaborado em 8 de outubro de 2026 com documentação oficial consultada nessa data e evidências de provisionamento enviadas diretamente pelo usuário nesta conversa. A proposta de autenticação ainda precisa ser validada; as provas visuais abaixo não demonstram login na PWA, migração ou publicação.

## Identidade da preparação

| Referência | Projeto e conta | Evidência / pendência |
| --- | --- | --- |
| FA | `sahmt-17a16`, conta indicada pelo usuário `anestesiahmtforms@gmail.com` | ID, proprietário IAM esperado, Auth Google/domínio, Rules, banco São Paulo e faturamento desabilitado conferidos por API. |
| FB | Projeto **SAHMT Gestao**, ID `sahmt-gestao-5ae66`, criado pelo usuário; conta indicada `anestesiahmtforms2@gmail.com` | Projeto criado pelo usuário. ID, proprietário IAM esperado, Auth Google/domínio, Rules, banco São Paulo e faturamento desabilitado conferidos por API; intermediário não hospedado. |
| Banco e Rules FB | `(default)` criado pelo usuário, com tela inicial vazia e aba Regras exibindo `allow read, write: if false` | Confirmação visual; não houve inventário via API, teste de Rules, importação ou demonstração de acesso da PWA. |
| Região FB | `southamerica-east1` (São Paulo), aprovada e selecionada pelo usuário no assistente | Região provisionada ainda não conferida via API; o banco já foi criado e não deve ser recriado. |
| App Web FB | `appId` `1:613953519880:web:63b48dfa78ffd1f7ef6cbd`, registrado pelo usuário; `firebaseConfig` recebido em texto | Configuração completa fica em arquivo privado ignorado. O registro não comprova OAuth Google, sessões entre projetos ou integração publicada. |
| Repositório | `https://github.com/anestesiahmtforms/SAHMT-V2.0.github.io.git` | Remote conferido nesta base. |
| Base local | `C:\Users\SAHMTIA\.codex\worktrees\management-firebase-split\FIRESTORE`, branch `codex/management-firebase-split` | Checkout e branch conferidos para esta preparação. |

Na arquitetura proposta, a PWA continua sendo a entrada única. Gestão utilizará FB; Desempenho permanecerá no contexto de FA e consultará as duas origens por meio de suas respectivas sessões. Essa integração ainda não foi implementada ou publicada. O histórico FA continua preservado para auditoria e reversão.

Os acessos de homologação anteriormente cancelados não autorizam acesso na nova arquitetura. A importação e a sincronização devem conservar apenas os direitos efetivos atuais, sem transformar usuário comum em gestor, administrador ou participante autorizado. A autorização geral para avançar já foi recebida; a ativação depende da reconciliação de direitos e da validação do pacote de produção.

## Proposta de sessão

A API Firebase suporta mais de um projeto dentro da mesma aplicação, com uma instância de `FirebaseApp` para cada um. Cada instância deve ter os próprios objetos Auth e Firestore; registrar dois projetos não cria uma sessão compartilhada. [Configurar múltiplos projetos](https://firebase.google.com/docs/projects/multiprojects)

| Caminho | O que permite | Limitação e decisão |
| --- | --- | --- |
| Reutilizar a credencial Google | Após um login Google explícito em FA, obter `GoogleAuthProvider.credentialFromResult(result)` e trocar a credencial Google por uma sessão FB com `signInWithCredential(authFB, credential)`. | Candidato a ensaio. A aceitação depende da configuração OAuth de FB; não presumir que qualquer token do client ID FA será aceito. Se somente FA for restaurado após uma recarga, a credencial Google da autenticação inicial pode não estar disponível. |
| Intermediário de autenticação, ou broker | A sessão FA prova a identidade a um serviço confiável; ele valida essa prova, a permissão e o vínculo estável e devolve um custom token assinado para FB. A PWA troca esse token por uma sessão FB. | Proposta escolhida para validar a recuperação da segunda sessão em segundo plano. Exige um ambiente confiável, transporte e IAM comprovados. A hospedagem no Apps Script existente ainda não foi demonstrada. |
| Reconexão Google explícita | Quando FB estiver sem sessão e o intermediário não estiver disponível, solicitar uma autenticação Google ao usuário antes de abrir Gestão. | Alternativa a apresentar para decisão, caso a recuperação silenciosa não seja viável dentro das restrições Spark. Não ativar essa mudança de experiência implicitamente. |

`GoogleAuthProvider.credential()` aceita Google ID token ou Google access token. O método recebe a instância Auth de destino; isso permite preparar a troca de credencial em FB. O Google ID token tem uma audiência OAuth, portanto a configuração do provedor deve ser conferida antes de tratar a reutilização entre projetos como comprovada. [GoogleAuthProvider](https://firebase.google.com/docs/reference/js/auth.googleauthprovider), [Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

O SDK pode persistir e restaurar uma sessão Firebase. A restauração deve ser aguardada nas duas instâncias antes de decidir se FB precisa de autenticação. Ela não equivale a executar novamente o login Google. Usar o Firebase ID token ou refresh token de FA como credencial Firestore de FB é incorreto: eles pertencem ao projeto emissor. A API de renovação verifica a correspondência entre projeto e refresh token. [Persistência Auth](https://firebase.google.com/docs/auth/web/auth-state-persistence), [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth)

## Contrato do intermediário a validar

Fluxo proposto, ainda sem serviço publicado:

1. A PWA aguarda a sessão FA e solicita um ID token FA atual ao SDK.
2. Envia a prova em uma requisição HTTPS ao intermediário, sem token em URL, logs ou relatório de auditoria.
3. O intermediário valida assinatura, algoritmo, emissor, audiência exata `sahmt-17a16`, validade e UID. Verifica também usuário desativado e revogação; o equivalente Admin é `verifyIdToken(token, true)`.
4. Obtém o vínculo de membro e os direitos efetivos de FA. Não aceita UID, área ou privilégio declarados pelo navegador como fonte da concessão.
5. Confere o usuário FB previamente reconciliado e atualiza seu espelho de autorização por um caminho privilegiado.
6. Gera um custom token com o UID FB previsto, assinado pela conta de serviço do projeto FB.
7. A PWA chama `signInWithCustomToken(authFB, customToken)`, confere o UID retornado e acessa FB usando seus próprios tokens.
8. Falha de validação, vínculo, permissão, atualização do espelho ou assinatura mantém Gestão indisponível. A operação não autentica uma conta alternativa nem muda o projeto FA.

O Admin SDK oferece verificação de Firebase ID tokens e geração de custom tokens. A verificação padrão de assinatura não verifica revogação automaticamente; isso deve ser solicitado explicitamente. Custom tokens são assinados por uma conta de serviço e trocados no cliente. O Firebase ID token FA aparece apenas como prova recebida e validada pelo intermediário. [Verificação de ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Criar custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [Gerenciar sessões](https://firebase.google.com/docs/auth/admin/manage-sessions)

Manter o UID histórico exige conferir colisões antes da troca. Uma resposta bem-sucedida com o UID errado deve encerrar a sessão FB e bloquear a operação. E-mail pode ajudar a detectar inconsistências, mas não identifica o membro histórico. Se o vínculo confiável estiver ausente, é necessário reconciliá-lo antes de conceder acesso.

### Hospedagem compatível com Spark

A proposta usa Firebase Spark em FA e FB e não depende de Cloud Functions. Custom Authentication está disponível nesse plano; Cloud Functions é uma capacidade do Blaze. O fato de Authentication ser compatível com Spark não fornece, por si só, a hospedagem do intermediário. [Planos Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

Avaliar o Apps Script existente como ambiente de servidor requer um ensaio separado, ainda sem alterar produção. A opção de assinatura IAM `signBlob` usa uma chave gerenciada pelo Google; exige a permissão `iam.serviceAccounts.signBlob` sobre a conta de serviço FB e escopo OAuth apropriado no servidor. Isso evita distribuir uma chave privada ao navegador, mas exige conferir concessões mínimas, disponibilidade da API e execução dentro das restrições de conta. Não afirmar viabilidade sem essa conferência. [IAM signBlob](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob)

O Apps Script não utiliza o Admin SDK Node diretamente. Para uma implementação REST, é necessário demonstrar verificação criptográfica e revogação equivalentes, além de assinatura e transporte. Decodificar o payload JWT ou confiar apenas no e-mail não atende ao contrato. O token administrativo obtido com `ScriptApp.getOAuthToken()` permanece no servidor. [Web Apps Apps Script](https://developers.google.com/apps-script/guides/web)

O Content Service redireciona suas respostas para um endereço temporário. O transporte da PWA precisa ser validado quanto a CORS, redirecionamento, timeout e ausência de vazamento. JSONP não serve para entregar tokens: a orientação oficial limita esse mecanismo a informação não sensível. O intermediário precisa responder dados de autenticação por HTTPS em um canal que a aplicação consiga ler com segurança. [Content Service](https://developers.google.com/apps-script/guides/content)

As quotas atuais publicadas para uma conta Gmail incluem 20.000 chamadas URL Fetch por dia, seis minutos por execução e 30 execuções simultâneas por usuário. A quantidade real de chamadas por autenticação/sincronização deve ser medida, incluindo verificações de revogação e escrita do espelho. Falhas e esgotamento devem negar o acesso dependente desse fluxo. [Quotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas)

## Preservar UID e vínculo de membro

`Auth.importUsers()` suporta usuários de outro projeto Firebase e registros Google com `uid` e `providerData` contendo o UID do provedor `google.com`. Isso permite preparar FB com o mesmo UID Firebase de FA antes do primeiro login. A API processa até 1.000 usuários por chamada, não verifica duplicações de identificadores e pode substituir um UID existente. A própria importação, portanto, não é uma operação segura de reconciliação sem preflight. [Importar usuários](https://firebase.google.com/docs/auth/admin/import-users)

Procedimento proposto para importação sem substituição:

1. Obter backup privado verificável de Auth FA e do estado Auth FB, com data, projeto de origem, hashes e contagens. Registros privados e claims não aparecem no terminal nem no repositório público.
2. Construir um plano por UID FA, UID Google e identificador estável do membro. Conferir duplicações na origem, inconsistências de vínculo e usuários desativados.
3. Consultar o destino antes de planejar criação: UID, identidade do provedor Google e outros identificadores exclusivos precisam ser reconciliados.
4. Classificar cada entrada em criar, existente equivalente ou conflito. Usuário existente equivalente é ignorado sem reimportação; conflito interrompe o lote e requer reconciliação, sem override.
5. Registrar explicitamente `sourceProjectId`, UID FA, UID FB, identificador estável, UID do provedor, resultado e hash do registro no manifesto privado de migração.
6. Após os gates de backup/reconciliação e validação do pacote, importar somente entradas ausentes sob a autorização recebida. Conferir ausência novamente imediatamente antes da escrita e impedir outros fluxos que criem usuários FB durante a janela; a checagem prévia não torna `importUsers()` atomicamente protegido contra uma corrida.
7. Validar o resultado individual, o vínculo Google e as relações de dados. Reexecutar o plano deve produzir apenas existentes equivalentes, sem substituir usuário nem criar outro membro.

Não importar permissões de homologação canceladas por reutilização indiscriminada de claims antigas. Copiar um perfil desativado não deve reativá-lo. O vínculo auditado continua necessário mesmo quando UID FA e FB forem iguais.

Se houver UID FB diferente, ele só pode ser aceito após reconciliação explícita e mapa auditado `FA UID ↔ FB UID ↔ identificador estável do membro`. Nenhum histórico é reassociado somente por nome ou e-mail. O UID Google do provedor também deve ser mantido como referência de identidade federada, distinguindo-o do UID Firebase.

## Permissões efetivas e revogação

FA continua sendo a fonte inicial dos direitos. O inventário precisa identificar todos os escritores que concedem, alteram ou revogam administrador, gestor e acesso a áreas. Replicar apenas a aparência da UI ou uma fotografia antiga das claims não atende a esse requisito.

Rules FB devem consultar um espelho local, com escrita exclusiva de serviço privilegiado, e validar o próprio token FB. As Rules permitem consultar documentos no banco por `get()`/`exists()` e não fazem chamadas a serviços externos. O espelho é a projeção controlada de FA; não é uma autorização que o cliente pode publicar para si. [Condições Rules Firestore](https://firebase.google.com/docs/firestore/security/rules-conditions)

Contrato sugerido para o espelho, sujeito ao inventário do modelo existente:

| Campo lógico | Finalidade |
| --- | --- |
| Projeto de origem, UID FA, UID FB e identificador estável | Garantir que o direito pertence ao membro reconciliado. |
| Status ativo e direitos/áreas efetivos | Replicar a elegibilidade atual, incluindo desativações. |
| Versão do direito e hash da fonte | Detectar divergência e impedir concessão com uma versão antiga. |
| Data de confirmação e `validUntil` | Limitar uso de uma projeção sem renovação confiável. |
| Evidência de revogação | Bloquear acesso com sessão anterior conforme a política aprovada. |

As Rules devem negar alterações do espelho por usuários comuns e gestores de conteúdo. Uma conta autenticada FB sem direito vigente não acessa Gestão. Autorizações devem distinguir administração de conteúdo, atuação de gestor por área e acesso de participante conforme os direitos efetivos existentes.

Concessões: confirmar FA, projetar o direito em FB pelo serviço privilegiado e liberar somente a versão reconciliada. Revogações: bloquear a projeção FB primeiro quando o escritor possuir controle sobre ambos os projetos, concluir a alteração FA e registrar o resultado. Não existe transação atômica entre os dois projetos; falhas parciais exigem reconciliação e não devem provocar concessão automática.

Para alterações feitas por caminhos FA que ainda não sincronizem FB, haverá atraso de propagação. O prazo máximo aceitável, o intervalo de sincronização e a validade do espelho precisam ser definidos e medidos antes da ativação. Se nenhum mecanismo confiável garantir esse prazo, o acesso continua bloqueado. Expiração do espelho deve causar negação nas Rules usando o horário do servidor, mesmo que o cliente conserve uma sessão FB.

Claims modificadas aparecem em um novo ID token, portanto não garantem revogação imediata. Um custom token curto também não limita a duração da sessão que nasce da sua troca: Firebase emite ID token e refresh token. A revogação Auth é por projeto e precisa ser executada e conferida nos dois quando esse for o efeito desejado. [Custom claims](https://firebase.google.com/docs/auth/admin/custom-claims), [Gerenciar sessões](https://firebase.google.com/docs/auth/admin/manage-sessions)

Logout deve encerrar ambas as instâncias Auth, cancelar ouvintes e operações pendentes de Gestão e impedir que uma resposta tardia do intermediário restaure FB após a saída. Troca de conta FA invalida qualquer sessão ou tarefa FB associada ao membro anterior. Dados locais precisam estar separados por projeto e membro para impedir reapresentação de conteúdo da conta anterior.

## Safari, iPhone e recarga

Firebase documenta limitações do fluxo `signInWithRedirect` causadas pelo armazenamento de terceiros em Safari 16.1+, Firefox 109+ e Chrome 115+. É necessário adotar uma das soluções oficiais. Para hospedagem externa, existem alternativas de popup, proxy, helpers hospedados no domínio ou autenticação do provedor independente. GitHub Pages não oferece o proxy de servidor descrito no guia; alterar apenas `authDomain` não demonstra a correção. Popup também pode ser bloqueado e precisa ser validado em dispositivos reais. [Boas práticas de redirect](https://firebase.google.com/docs/auth/web/redirect-best-practices)

A proposta de intermediário permite recuperar FB sem iniciar outro popup Google, desde que FA tenha uma sessão válida e o intermediário esteja disponível. Essa inferência arquitetural ainda precisa de prova no navegador e no transporte escolhidos. Se FA estiver sem sessão, permanece necessário o login Google normal da PWA.

Não usar Google One Tap automático como garantia: o fluxo aprimorado para navegadores ITP não suporta auto sign-in e outros contextos podem exigir interação. O suporte oficial GIS varia conforme navegador e plataforma, inclusive no iOS. [Auto sign-in Google](https://developers.google.com/identity/gsi/web/guides/automatic-sign-in-sign-out), [Navegadores suportados](https://developers.google.com/identity/gsi/web/guides/supported-browsers)

## Provisionamento comprovado e próximos passos de configuração FB

O usuário já criou o projeto FB, o banco `(default)` e o app Web, com as provas visuais registradas acima; nossas ferramentas não realizaram essas ações. A lista separa as conferências concluídas das etapas restantes. A autorização geral para continuar já foi recebida; antes da mudança produtiva, completar e apresentar o pacote revisável, pendências, rollback e as validações exigidas.

1. Concluído por API em FA: ID `sahmt-17a16`, proprietário esperado, Google Auth, domínio, banco e Rules publicados, faturamento desabilitado. Esses metadados não comprovam sessão ou direitos de participante.
2. Concluído por API em FB: ID `sahmt-gestao-5ae66`, proprietário esperado e faturamento desabilitado. Captura Auth protegida retornou zero contas; documentos ainda não capturados.
3. Conferir a região efetivamente provisionada do banco existente. `southamerica-east1` (São Paulo) foi **aprovada e selecionada pelo usuário** no assistente e confirmada via API nos dois projetos. A localização de uma instância provisionada não pode ser alterada. [Localizações Firestore](https://firebase.google.com/docs/firestore/locations)
4. Conservar o banco `(default)` fechado enquanto migração e Rules específicas são preparadas. A tela inicial vazia e a aba Regras com `allow read, write: if false` foram comprovadas visualmente; Rules publicadas também foram preservadas por API; captura de documentos e testes de negação por SDK ainda pendentes. [Iniciar Firestore](https://firebase.google.com/docs/firestore/quickstart)
5. Conferir o app Web já registrado, `1:613953519880:web:63b48dfa78ffd1f7ef6cbd`, e a configuração recebida no arquivo privado ignorado. Impedir que a configuração FB substitua a inicialização FA; não presumir integração após o registro. [Configuração Web](https://firebase.google.com/docs/web/setup)
6. Google Auth e domínio FB já habilitados pelo usuário e conferidos por API. Login real da PWA/OAuth continua pendente. Habilitar o provedor não concede acesso aos documentos: as Rules e o espelho permanecem responsáveis pelos direitos. [Google sign-in Firebase](https://firebase.google.com/docs/auth/web/google-signin)
7. Definir o responsável pelo intermediário e pela sincronização, com IAM mínimo e conta de serviço FB capaz de assinar seus custom tokens. Demonstrar assinatura, validação FA, revogação e transporte sem credenciais administrativas no cliente.
8. Executar backup/preflight e importação controlada de identidades antes de permitir logins que criem usuários FB. Preparar espelho de direitos e Rules específicas, conferir testes e comparar com os direitos efetivos FA.
9. Registrar evidências de configuração e rollback. Apresentar resultados e pendências antes da alteração produtiva. A autorização geral já foi dada; interromper escritores antigos somente após validação humana da migração.

Não cadastrar credenciais administrativas em configuração Web. Firebase API keys públicas identificam projeto/app; Rules e IAM fazem autorização. As restrições da API key e os domínios devem ser conferidos, sem usá-los como substitutos das Rules. [API keys Firebase](https://firebase.google.com/docs/projects/api-keys)

## Critérios de validação e bloqueios de produção

| Cenário | Resultado necessário |
| --- | --- |
| Login Google com usuário autorizado | Uma interação inicial; UID FA e FB correspondem ao vínculo reconciliado; Gestão abre somente com espelho vigente. |
| Usuário comum e conta sem vínculo | Rules negam o acesso previsto como restrito, inclusive em requisição direta fora da UI. |
| Recarga com duas sessões persistidas | Sessões restauradas sem criar usuários ou solicitar nova credencial desnecessariamente. |
| Recarga com sessão FA e FB ausente | Intermediário validado cria a sessão FB do membro certo em segundo plano; falha deixa Gestão indisponível. |
| Conta Google diferente / troca de conta | Não reaproveitar sessão FB da conta anterior; resposta tardia não restaura o vínculo antigo. |
| Logout durante requisição ao intermediário | As duas sessões encerradas; nenhuma resposta posterior reabre FB. |
| ID token falso, expirado, de outro projeto, revogado ou usuário desativado | Negação antes de assinar custom token ou renovar direitos. |
| Revogação e alteração de área em FA | Direito FB negado dentro do prazo de propagação aprovado; espelho vencido nega acesso. |
| Falha de rede, intermediário, IAM ou quota FB | Nenhuma concessão otimista; contexto operacional FA continua utilizável. |
| Reexecução da importação | Usuários equivalentes preservados; conflitos interrompem sem override; nenhum novo UID para o mesmo membro. |
| Safari iPhone e PWA instalada | Login, recarga, recuperação FB, logout, troca de conta e falhas validados com conta real autorizada. |
| Chrome, Edge e Firefox | Mesmo contrato de identidade e autorização, com armazenamento de terceiros bloqueado quando aplicável. |

Emuladores e mocks verificam contratos e negações, mas não validam OAuth Google real, IAM, entrega de tokens pelo Apps Script ou armazenamento no iPhone. Uma build bem-sucedida tampouco comprova esses cenários.

Bloqueiam a ativação: backup/rollback dos documentos sem prova; vínculos de identidade sem reconciliação; direitos FA não reconciliados; intermediário ou transporte sem validação; atraso de revogação indefinido; Rules específicas e testes de negação pendentes; cenários de dispositivo pendentes. IAM, região, Google Auth/domínio e faturamento dos dois projetos foram confirmados via API. A autorização geral para continuar foi dada pelo usuário; a validação humana da migração antes do corte dos escritores antigos continua necessária.

Este documento registra o provisionamento feito pelo usuário e prepara a execução posterior. Sua atualização não alterou projetos ou Rules, não importou usuários, não habilitou acesso da PWA, não migrou ou publicou o módulo e não reativou a liberação de treinamentos cancelada.

## Coordenador de sessões preparado localmente

`src/management-session.js` é um coordenador puro, desligado por padrão. Não é importado pela UI e não inicializa Firebase, rede, armazenamento ou um servidor de autenticação. As suas provas de unidade verificam o contrato local; não demonstram OAuth real, login no iPhone, transporte do intermediário ou Rules publicadas.

A factory `createManagementSession({enabled, adapters, now, onState, onInvalidate, beforeSignOut})` fornece `restore`, `updateContext`, `connect`, `signOut`, `snapshot` e `refresh`. `enabled` precisa ser o booleano `true`; a ausência do parâmetro conserva `disabled` sem chamar adaptadores. `restore` aguarda conjuntamente `restoreFa` e `restoreFb`; chamadas a `connect` durante a restauração não trocam tokens.

Os adaptadores devolvem contextos normalizados, não documentos brutos. FA inclui `restored`, `online`, `user.uid`, `profile` com UID, identificador estável do membro, ativo e acesso, direito efetivo `managementAllowed`, metadados `fromCache:false` e `hasPendingWrites:false`, e o vínculo explícito `binding`. FB inclui a sessão restaurada e `mirror`. O vínculo e o espelho conservam `sourceProjectId`, `destinationProjectId`, `faUid`, `fbUid` e `memberId`; nesta etapa somente UIDs FA/FB iguais são aceitos, conforme o plano de importação preparado. Os adaptadores devem traduzir os direitos e campos reais para esse contrato; `managementAllowed` não é uma nova concessão que o navegador possa gravar.

O espelho exige identidade equivalente, ativo, direito vigente, confirmação do servidor sem cache/escrita pendente, `confirmedAtMs` e `validUntilMs` como inteiros de milissegundos. Confirmação no futuro, intervalo inválido e validade vencida negam acesso. `snapshot` confere novamente a validade quando consultado, mesmo sem evento de Auth. O relógio cliente e esse gate são auxiliares; a expiração e os direitos devem ser impostos pelas Rules com o horário do servidor. O módulo não define um prazo de propagação ou renovação implícito.

FA offline, perfil ausente, revogado, sem direito efetivo, vínculo incompatível ou espelho conhecido revogado/vencido permanecem bloqueados. Sessões equivalentes e vigentes são reutilizadas. FB ausente somente pode usar a ponte injetada; sem `exchangeFaToken`, o resultado é `BROKER_UNAVAILABLE`, sem uma segunda janela Google ou criação automática alternativa.

O núcleo de broker está preparado com [contrato próprio](management-auth-broker-contract.md), mas o transporte e os adaptadores reais ainda não existem. `getFaIdToken({expectedUid,forceRefresh:true})` recebe a identidade esperada; `exchangeFaToken({faIdToken,...binding})` recebe um corpo em memória, nunca URL, armazenamento ou log; `signInFb({customToken,expectedUid})` deve trocar o custom token e retornar sessão e espelho confirmados. O broker precisa derivar e verificar UID, vínculo e permissão no servidor; o vínculo enviado pelo cliente é somente uma expectativa a comparar. Tokens e erros brutos não aparecem no estado nem em `onState`.

Épocas invalidam resultados de restauração, token ou broker após mudança de contexto/logout. Uma fila serial ordena mutações Auth FB e limpeza de login tardio antes de uma nova tentativa. Uma mutação antiga que tenha tocado Auth obriga observar FB novamente, mesmo se já houver um snapshot posterior em memória; falha de limpeza bloqueia e cancela a tentativa seguinte. Todos os adaptadores de mutação devem conferir `expectedUid` e toda mutação FB deve passar por esse coordenador quando ele for integrado. Observações da sessão podem alimentar `updateContext`; elas não constituem permissão sem perfil/vínculo/espelho atuais.

`signOut` invalida imediatamente operações e chama `beforeSignOut({faUid,fbUid})` para a integração futura verificar/preservar ações pendentes. Se o callback não retornar `true`, nenhuma saída é solicitada e a decisão continua com o adaptador. O coordenador não importa nem modifica outbox, rascunhos ou IDs das requisições. Quando liberado, tenta encerrar FA e FB independentemente; falha em uma saída não impede tentar a outra e nunca produz logout declarado completo. Requisições tardias não restauram a sessão após a saída.

**Diferença de provedor que bloqueia copiar Rules:** as Rules FA existentes exigem `request.auth.token.firebase.sign_in_provider == 'google.com'` em caminhos específicos. A sessão FB criada por `signInWithCustomToken` usa provedor `custom`, mesmo se o usuário tiver Google em `providerData`. Rules FB próprias deverão validar o UID vinculado, espelho vigente e o contrato autenticado do intermediário. Esta preparação não relaxa nem publica Rules FA/FB e não assume que um login custom já satisfaça a regra Google existente. [Custom authentication](https://firebase.google.com/docs/auth/web/custom-auth), [Criar custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).


## Verificação de infraestrutura e captura Auth posterior

Ambos os projetos foram conferidos por API nesta continuação: proprietário esperado, banco Standard/Native em São Paulo, Google Auth e domínio da PWA, faturamento desabilitado e Rules preservadas. Capturas Auth criptografadas e verificadas contêm FA 60 contas e FB zero. Esses fatos substituem as pendências de infraestrutura/contas das seções anteriores; ainda não comprovam sessão da PWA, UID→membro, revogação, broker ou migração. A captura paginada de Auth declara atomicSnapshot:false e consistentWithFirestore:false. Nenhum usuário foi importado. Ver provas privadas e restrições de recuperação DPAPI no runbook.
