# Sessões e navegação de Gestão — PWA 237

## Sintomas e conferência

O usuário relatou retorno à Home ao entrar em Gestão de Documentos, falha genérica de sessão Firebase e reaparecimento do painel FA–FB–FC–FD–FE durante a navegação. A conferência administrativa pontual confirmou as contas indicadas em FA e FB: mesmos UIDs, contas Google ativas e perfis com acesso; o administrador continua com a função `administrador_app`. Essa conferência não alterou contas ou permissões.

Foram encontrados fluxos reproduzíveis no cliente: a revalidação com falha redirecionava `auth-limited` para Home, o painel de conexões se mostrava automaticamente durante a restauração, e a entrada em FB podia ocorrer antes de terminar a conexão inicial. A mensagem genérica `auth-error` também cobre falhas de importação do módulo de autenticação; o erro específico do iPhone não foi lido nesta sessão, pois o controle do navegador está desabilitado.

## Alterações

- Validação temporariamente indisponível mantém a rota e apresenta a recuperação de acesso, com os dados e ações restritos. Quando o perfil é confirmado, a pasta solicitada é reaberta a partir do catálogo autorizado.
- Uma falha de gravação do cache local não impede usar um perfil recém-confirmado pelo servidor. O mesmo tratamento mantém a aplicação imediata de um bloqueio de acesso informado pelo servidor.
- A área escolhida fica na rota `#/management/area-…`. Falhas e revalidações não descartam essa escolha.
- O painel de conexões abre somente por solicitação de recuperação na área Sincronização. A restauração silenciosa de sessões não inicia o botão Google nem exibe o painel.
- O login Google habitual reaproveita sua credencial transitória para conectar os destinos existentes, com a mesma identidade. Continuam os controles de conta previamente cadastrada, UID e identidade Google; a credencial não é persistida.
- A entrada em FB consulta a sessão já restaurada do SDK e, quando uma conexão inicial ainda está em andamento, espera por ela com prazo e limpeza dos observadores. Não consulta Firestore nem aguarda projetos não relacionados se FB já está pronto.
- Se a sessão de FB realmente estiver ausente, a recuperação explícita usa a entrada FA e retorna à pasta original após conectar FB.
- Falha reconhecida de importação na inicialização pode abrir uma recuperação única dos arquivos. A página estática `tools/refresh-app.html` atualiza e ativa os shells instalados de FA e FB e retoma a rota. O protocolo não apaga Auth, IndexedDB, filas, cache de registros ou rascunhos e não recarrega outras janelas.

## Validação

As suítes locais de domínio e autenticação passaram: 1.073 e 145 testes, respectivamente. Os testes específicos cobrem troca de identidade, restauração tardia, prazo, remoção dos observadores e recuperação de arquivos sem repetição automática. A regressão de navegador isolada manteve Gestão de Documentos na transição autorizado → validação indisponível → autorizado e confirmou que o painel exige abertura explícita. Outra regressão ativou ambos os shells, preservando o armazenamento e um rascunho aberto em outra janela. Todos os acessos externos foram bloqueados nesses testes de navegador.

Publicação via revisão no GitHub e checks completos. Não houve alteração de dados dos treinamentos nem retomada do lote Apps Script nesta correção.
