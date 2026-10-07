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
- [x] Executar 863 testes de domínio, 81 de regras e build. Atualizar cache do PWA.
- [x] Confirmar por leitura da API as regras efetivamente ativas no Firebase.
- [ ] Conceder e confirmar acesso dos grupos aos materiais de apoio e edição ao gestor.
- [ ] Integrar o código, conferir workflow e versão servida pelo Pages.
- [ ] Iniciar o liberador no Apps Script e confirmar a publicação viva dos 76 Forms.
- [ ] Validar uma participação autenticada e isolamento entre grupos no dispositivo.

## Operação

TrainingReleaseDefaults.gs e o manifesto são privados e enviados diretamente ao Apps Script autorizado. O liberador não modifica escopos, não habilita o runtime de pontuação e não escreve créditos.

iniciarDisponibilizacaoTreinamentosSahmtV2 cria um gatilho temporário de cinco minutos, verifica até cinco Forms por rodada e persiste progresso. Conclui somente após conferir 76 Forms vivos, encerra após 40 execuções ou 24 horas e preserva outros gatilhos. consultarDisponibilizacaoTreinamentosSahmtV2 consulta o progresso. Contagens persistidas sozinhas não confirmam publicação viva.

Acesso por grupo exige login Google verificado, perfil ativo e lista vigente. Revogação no app e na elegibilidade é imediata; acesso externo ao Form depende da rodada de reconciliação. Falha de fechamento permanece como pendência explícita.

A execução remota pelo cliente local retornou HTTP 403. O início pelo Editor usa o consentimento Google da conta executora, sem nova aprovação da tarefa. Homologação real e ativação da pontuação permanecem separadas; não fabricar flags de homologação.
