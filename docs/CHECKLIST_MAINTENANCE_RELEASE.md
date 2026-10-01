# Checklist: calendários de manutenção — 01/10/2026

## Escopo

Base: `57e4df0a8760378fe66d78c9dd691b6380c3dd77`, main do SAHMT V2. Checkout isolado; as três alterações locais da pasta FIRESTORE original foram preservadas.

O banner usa três calendários: **Preventiva Anual**, **Elétrica Anual** e **Calibração Semestral**. O administrador abre **Editar Manutenção**, escolhe as datas e salva. Campos vazios removem a programação correspondente. Datas futuras permanecem como cadastradas; não há reagendamento automático.

Uma data anterior ao dia atual em São Paulo destaca somente seu item em vermelho. A situação do arsenal apresenta o aviso amarelo **MANUTENÇÃO EM ATRASO**. O aviso não altera a condição Conforme/Não Conforme registrada no Checklist. O nome duplicado foi retirado; Fazer Checklist manual fica após a situação, Editar Manutenção após as datas e Ativar/Desativar Arsenal antes de Voltar. O rodapé permanece visível em telas pequenas; conteúdo longo pode rolar internamente.

## Persistência e autorização

`stations/{id}.maintenance` aceita um mapa com exatamente `preventiveAnnual`, `electricalAnnual` e `calibrationSemiannual`; cada valor é uma data ISO válida de ano positivo com quatro dígitos, ou string vazia. O campo continua opcional. Texto legado de até 1000 caracteres permanece válido para compatibilidade com abas antigas; não é interpretado como calendário nem apagado por ativação, desativação ou edição do catálogo. O novo formulário salva o mapa quando o administrador cadastra as datas.

Somente a autorização existente `checklistManage` permite atualizar a manutenção. Leitores comuns consultam as datas com controles desabilitados. Versão, autoria, timestamps, lista de campos e exclusão negada foram preservados. As transações usam o estado atual da estação e conservam os calendários ao editar/ativar/desativar. Callbacks atrasados não alteram nem fecham outro banner; UID e permissão são conferidos antes e depois das operações.

## Regras publicadas e confirmadas

Comando executado: `npx.cmd firebase deploy --only firestore:rules --project sahmt-17a16 --non-interactive`.

- Projeto: `sahmt-17a16`; banco `(default)`.
- Release: `projects/sahmt-17a16/releases/cloud.firestore`.
- Ruleset ativo: `d7a1f816-8559-45bf-bd6e-5d99fe319361`.
- Atualização: `2026-10-01T21:31:11.572064Z`.
- Confirmação por GET da API Rules: `2026-10-01T21:31:18.660Z`.
- SHA-256 do conteúdo normalizado LF: `11453afb3b75a51929e254a436fe0058c108f0c060931a5abc0f847d573badf3`, idêntico ao arquivo validado.

Foi publicado o arquivo atual da main. Além do esquema de manutenção, esse arquivo já continha aliases de valores em validações de Eventos: nome do perfil, documento anterior/posterior e chaves alteradas. São as mesmas comparações, permissões e vínculos de histórico, com menos expressões. A tentativa de preservar esses trechos antigos de produção reproduziu a falha preexistente do limite de 1000 expressões ao editar Outros; a versão atual passou toda a suíte. Não houve edição de código de Eventos nesta tarefa nem ampliação de acesso.

O compilador confirmou sucesso; manteve avisos preexistentes de funções de escala não usadas. Nenhum índice, Functions, Worker, Apps Script, gatilho ou configuração de IA foi publicado/ativado por esta operação.

## Verificação

- `npm run test:domain`: 162 testes passaram, incluindo calendários, preservação e corridas de callbacks.
- `npm run test:rules`: 48 testes passaram no emulador, incluindo leitura comum, edição recusada, calendário válido/inválido, autoria/versão/exclusão e preservação ao ativar/desativar.
- `npm run test:label-ai-worker`: 12 testes passaram; sem chamadas de IA de produção.
- `npm run build`: sucesso. Aviso de chunk Firebase acima de 500 kB já existente.
- 16 cenários móveis Chromium emulados: 320×568, 375×667, 390×844 e paisagem 844×390, administrador/leitor, conteúdo curto/longo. Banner centralizado, Voltar visível, calendários sem exceder a largura; vermelho e amarelo medidos. Salvamento/reabertura nessa verificação usa dados fictícios e serviço simulado.
- Cache do shell incrementado para v156, preservando cache da escala e ações IndexedDB.

As evidências locais ficam em `.local-preview/`, sem credenciais nem dados reais de pacientes. A suíte completa do GitHub Actions acompanha o push à main e publica o PWA somente após os checks.

## Complemento do banner — 01/10/2026

O banner foi organizado em três blocos: nome centralizado, situação e checklist manual; calendários e edição da manutenção; ativação/desativação. O texto “ARSENAL ANESTÉSICO” foi removido. Voltar permanece no rodapé, fora dos blocos.

Fazer Checklist Manual, Editar Manutenção, Salvar Manutenção e Ativar/Desativar Arsenal são renderizados somente quando o perfil tem acesso administrativo (`can('admin')`) e a autorização existente de gestão do Checklist. Usuários comuns, inclusive perfis com gestão delegada sem acesso administrativo, veem somente a situação e os calendários desabilitados. O preenchimento por QR continua seguindo `checklistWrite`.

Os callbacks validam também a origem QR/manual, a rota, o banner atual e o UID capturado; perder acesso administrativo bloqueia o fluxo manual, inclusive durante a importação dos dados. Uma resposta antiga não fecha um novo banner. Os calendários têm largura mínima de 155px e fonte de 16px, com redução de margens nas telas estreitas para mostrar o ano completo.

Essa atualização altera somente o banner, suas regressões e a versão do cache do shell (v157). O esquema de manutenção, as transações, as Rules publicadas acima e as integrações de produção permanecem os mesmos. Não houve nova implantação das Rules nesta atualização visual.

Verificação deste complemento:

- Domínio: 178/178 testes; banner/catálogo: 42/42 incluídos na suíte.
- Rules: 48/48 no emulador; Worker: 12/12 sem IA de produção.
- Build com as variáveis atuais do repositório: sucesso; aviso de tamanho do chunk Firebase preexistente.
- 16/16 cenários móveis Chromium com perfis comum/administrador e conteúdo curto/longo, nas dimensões já listadas; mais um caso de QR comum salvo pelo wrapper real com backend fictício. Nome e banner centralizados, campos dentro dos blocos e Voltar visível/clicável. Datas completas conferidas visualmente em 320 e 390px.
- Persistência/reabertura usa serviço simulado. Safari/iPhone/Android físicos e login/gravação reais continuam com as limitações abaixo.

## Conferência que depende de dispositivo e sessão reais

O acesso automatizado ao navegador do usuário não iniciou por erro `apply deny-read ACLs`. Não foi possível realizar login/interação autenticada no PWA de produção nem testar Safari/iPhone/Android físicos. Deploy e conteúdo ativo das Rules foram confirmados independentemente dessa limitação.

Na conferência autenticada do app atualizado:

1. Com administrador, abrir o arsenal, Editar Manutenção, escolher as três datas e Salvar Manutenção; fechar/reabrir e recarregar para confirmar persistência.
2. Em arsenal reservado para conferência, verificar ativação/desativação preservando as datas e um vencimento anterior a hoje produzindo vermelho/aviso amarelo; restaurar a programação/situação correta.
3. Limpar um calendário, salvar e confirmar que somente essa data foi removida.
4. Com leitor comum, confirmar consulta das datas e ausência de edição; verificar calendário nativo, centralização e Voltar no aparelho.
## Respostas no banner, autoria e compromisso — 01/10/2026

Base deste complemento: `e92151af6bd85945be936a91dbc80228b8d1a86e`. O primeiro bloco agora contém nome do arsenal, situação centralizada, Conforme/Não Conforme lado a lado e, no final, nome resumido de quem efetivamente checou e data/hora em São Paulo. O texto exibido na não conformidade, imediatamente acima da autoria, é: **Me comprometo a comunicar imediatamente à equipe e ao setor responsável pela manutenção.**

O QR já usava este banner completo; a regressão confirma scanner → resolução validada → banner com origem QR. Administradores com checklistManage e checklistWrite têm as duas respostas disponíveis diretamente; o botão manual intermediário foi substituído por essas respostas. Usuários comuns respondem somente após QR validado, com checklistWrite. Consulta direta comum permanece sem botões de resposta ou administração. Rota, banner, sessão, data, validade do arsenal e revogação continuam verificados antes/depois das operações assíncronas. Não foi ampliada nenhuma permissão de leitura ou escrita.

Novos registros podem armazenar `createdByName`, opcional, até 120 caracteres e exatamente igual ao displayName do perfil autenticado. As Rules preservam o vínculo por createdByUid, timestamps do servidor, imutabilidade e compatibilidade com payloads legados sem nome. O nome do responsável definido pela escala não é usado como autoria da checagem. Registro pendente identifica horário local e sincronização pendente/falha; não é apresentado como confirmação do servidor. Se um nome legado não estiver disponível, não há inferência; a consulta de perfil continua sujeita às permissões existentes de users.

IDs, reconciliação, conteúdo da fila offline e projeções de assinatura/relatório foram preservados. A sincronização de um payload com nome pode ser recusada se o displayName do perfil mudar antes de confirmar a operação, pois o contrato exige igualdade com o perfil vigente; nenhuma fila é apagada ou reescrita silenciosamente. Esse risco é separado da autoria por UID e da indicação de registro pendente.

Calendários recebem limites de largura e tamanho lógico, mantendo o ano completo dentro do bloco. O rodapé Voltar continua visível. Conteúdo extenso pode rolar internamente para conservar texto legível e controles acessíveis em telas pequenas. Cache do shell: v158; IndexedDB e pendências preservados.

Verificações deste complemento:

- `npm run test:domain`: 203/203.
- `npm run test:rules`: 50/50, incluindo nome válido, falsificação recusada, compatibilidade legada e permissões existentes.
- `npm run test:label-ai-worker`: 12/12, sem IA de produção.
- `npm run build`: sucesso, com as variáveis existentes do repositório; aviso de chunk Firebase preexistente.
- 32/32 cenários móveis Chromium emulados: 320×568, 375×667, 390×844 e 844×390, administrador/comum, conteúdo curto/longo, botão direto/QR; mais dois salvamentos QR comuns SIM/NAO e um caso local pendente. Calendários contidos, compromisso antes da autoria e rodapé visível.
- Script de complemento legado revisado e nove verificações puras com dados fictícios; sem chamadas de produção nesse teste.

A auditoria somente de leitura identificou oito checklists antigos sem nome, todos vinculados inequivocamente a um UID com perfil válido. A operação de complemento usa somente createdByName, backup privado ignorado pelo Git, precondição updateTime e verificação profunda de todos os demais campos. Em eventual conflito, interrompe e permite retomada sem sobrescrever nomes existentes. Assinaturas não incluem esse campo nem updateTime do documento; createdAt, version, condition e demais respostas não mudam. Se um gatilho de escrita existente estiver ativo, ele pode produzir um job com a mesma projeção; nenhum gatilho é criado ou ativado por esta operação.

A API Cloud Functions retornou SERVICE_DISABLED nos GETs v1/v2 de auditoria. Isso não permite afirmar a ausência de Functions históricas; a API permaneceu como encontrada. Nenhum Worker, Apps Script, IA ou integração foi ativado por este complemento.

Persistência, QR/câmera e calendário nativo em Safari/iPhone/Android físicos, além de interação autenticada no PWA de produção, não foram testados: o controle do navegador do usuário falhou ao inicializar por apply deny-read ACLs. Os testes de fluxo usam conta/dados fictícios e backend simulado; a verificação das Rules publicadas e dos assets do Pages é independente desse limite.

Publicação deste complemento confirmada:

- Ruleset ativo: `projects/sahmt-17a16/rulesets/54198dd9-e61c-4b2d-a052-85abe5866d9f`.
- Release atualizada em `10/01/2026 23:47:16`; GET confirmado em `10/01/2026 23:47:54`.
- SHA-256 normalizado: `9f992d0eb4c514f3ac400070e3238fe6e7f98514d2194393c00d343dc8790c9a`, igual ao arquivo testado.
- Complemento legado: 8/8 registros verificados em `10/01/2026 23:47:59`, máscara exclusiva `createdByName`, zero outros campos alterados.
- Somente Firestore Rules foram implantadas pelo Firebase; o PWA segue a publicação da main por GitHub Actions.
