# Catálogo de avaliações por grupo

## Escopo aprovado

Disponibilizar 76 Forms preparados: Diretrizes (18), Protocolos (13) e ROPs do segundo semestre (31) para Acesso geral; Documentos Administrativos (14) para Acesso restrito. São 74 matérias únicas: duas cópias compartilham a deduplicação de créditos.

Preservar as páginas e os originais. A lista documentAccessEmails, os gabaritos e o manifesto permanecem privados. Novos perfis recebem somente consulta aos treinamentos, gestão e notificações, conforme autorização anterior. Perfis existentes são preservados.

## Implementação e implantação

- [x] Conferir checkout, conta executora, conteúdos atuais e relatórios privados de preparo.
- [x] Reconciliar os 45 documentos e 31 ROPs, fontes, grupos, questões e materiais.
- [x] Cadastrar os e-mails aprovados, perfis antes do primeiro login e designação do gestor com leitura de confirmação.
- [x] Consultar pelo grupo próprio e validar novamente nas regras e no executor. Preservar públicos antigos por UID.
- [x] Publicar Forms por estágio fechado, ACL de respondentes, verificação de conteúdo e confirmação transacional. Preservar editores e bloquear reabertura após divergência semântica.
- [x] Criar TrainingRelease.gs com manifesto fixado por hash, verificadores reais e lotes temporários.
- [x] Implementar ajuste dos 84 materiais por ondas sequenciais, limitação da pasta clone e projeção dos tópicos em Gestão somente após READY.
- [x] Executar 877 testes de domínio, 81 de regras e build. Atualizar cache do PWA.
- [x] Confirmar por leitura da API as regras efetivamente ativas no Firebase.
- [ ] Conceder e confirmar acesso dos grupos aos materiais de apoio e edição ao gestor.
- [x] Integrar o catálogo (PR 18), conferir workflow e versão servida pelo Pages; preservar layout e parâmetros de build da CI.
- [x] Publicar o liberador final no Apps Script e receber registro do início nativo; ajustes de retomada conservam o progresso existente.
- [ ] Iniciar o liberador no Apps Script e confirmar a publicação viva dos 76 Forms.
- [ ] Validar uma participação autenticada e isolamento entre grupos no dispositivo.

## Operação

TrainingReleaseDefaults.gs e o manifesto são privados e enviados diretamente ao Apps Script autorizado. O liberador não modifica escopos, não habilita o runtime de pontuação e não escreve créditos.

iniciarDisponibilizacaoTreinamentosSahmtV2 cria um gatilho temporário de cinco minutos e persiste progresso. Primeiro fecha os Forms, depois ajusta os 84 materiais (70 gerais e 14 restritos) e somente então publica até cinco Forms por rodada e cadastra os tópicos em Gestão. As ondas de permissões operam em arquivos distintos, com uma alteração por arquivo em cada onda e confirmação antes da próxima. O prazo interno é de 160 segundos por execução. Conclui somente após conferir 76 Forms vivos, encerra após 80 execuções ou 24 horas e preserva outros gatilhos. consultarDisponibilizacaoTreinamentosSahmtV2 consulta o progresso. Contagens persistidas sozinhas não confirmam publicação viva.

O gestor wx2064@gmail.com recebe edição dos materiais; participantes recebem leitura conforme a lista vigente. A herança pública é limitada somente na pasta clone das ROPs, sem modificar a pasta original ou conceder acesso à pasta que contém relatórios privados. Este ajuste foi confirmado especificamente pelo usuário após a rejeição da revisão automática. Não são enviadas notificações de compartilhamento.

Acesso por grupo exige login Google verificado, perfil ativo e lista vigente. Revogação no app e na elegibilidade é imediata; acesso externo ao Form depende da rodada de reconciliação. O verificador de materiais bloqueia publicação diante de divergência, mas a remoção de um grant direto de material após o fim do preparo requer executar novamente o liberador. Falha de fechamento permanece como pendência explícita.

A execução remota pelo cliente local retornou HTTP 403. O início pelo Editor usa o consentimento Google da conta executora, sem nova aprovação da tarefa. Homologação real e ativação da pontuação permanecem separadas; não fabricar flags de homologação.
