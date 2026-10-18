# Publicação de questões revisadas

## Estado

O ciclo nativo DOC→Forms passou na prova real isolada descrita em
`management-revision-validation.md`. O adaptador de produção
`ManagementQuestionPublication.gs` acrescenta publicação condicional pela API
do Forms, com `requiredRevisionId`. Não usa alterações nativas item a item para
contornar um conflito de versão. A API rejeita a atualização quando a revisão
de origem já não é a atual, conforme o
[contrato de batchUpdate](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/batchUpdate#WriteControl).

O adaptador não instala acionador, não recebe pedidos do navegador e não altera
pontuações. A configuração privada inicial tem `enabled:false` e 57 vínculos
DOCX/Form, sem designação de gestor presumida. Não há aprovação instalada.

## Edição e designação são coisas diferentes

O administrador funcional tem edição em todas as pastas de revisão. Isso não
designa automaticamente todos os documentos ao administrador, nem torna uma
edição uma revisão aprovada para publicação ou pontuação. A atribuição futura
continua individual, conforme a escolha do administrador.

A conferência real de 18/10/2026 confirmou edição para o administrador nas 57
pastas, nos 66 materiais editáveis e nos 57 DOCX de questões: **123 arquivos**.
O acesso já existia e foi verificado, sem novas concessões. Conteúdos e permissões
anteriores foram preservados. PDFs e Forms não foram alterados nesta conferência.
Os identificadores e recibos de permissões permanecem somente na área privada.

## Contrato da aplicação

1. Configuração confiável associa exatamente DOCX, pasta restrita, pasta de
   leitura, Forms e designação atual (UID e versão). Sem designação, bloqueia.
2. O executor precisa ser o proprietário configurado. A entrada manual exige
   também a identidade ativa correspondente. O autor designado é revalidado no
   perfil FA, com `active:true` e `access:true`.
3. A aprovação privada fixa proprietário aprovador, documento, Form, gestor,
   versão da designação, SHA-256 dos bytes, snapshot anterior e validade de até
   24 horas. Um arquivo de aprovação precisa ser privado, do proprietário e
   selecionado por ID e SHA-256 em `gqpTrustedApproval_`.
4. O DOCX é relido. A pasta tem herança limitada; somente proprietário, gestor
   designado e administradores editores explicitamente configurados podem ter
   acesso de conteúdo. Os administradores adicionais não ganham aprovação ou
   autoria por estarem nessa lista.
5. `gqpDraft_` produz apenas a proposta, sem aprovação, fechamento ou gravação
   de Forms. Não deve ser confundido com aplicação. A revisão humana do conteúdo
   e a seleção imutável da aprovação continuam necessárias.
6. O banco é validado pelos mesmos controles da prova isolada. IDs, quantidade
   de questões, pontos, campos obrigatórios e campos auxiliares são preservados.
   Campos de ciência com uma única alternativa ficam fora do banco editável.
   Questões com imagens, navegação ou opção “Outro” exigem tratamento específico.
7. O estado de recuperação privado é gravado antes de fechar o Form. Perfil,
   designação e bytes são revalidados; a versão atual é lida novamente.
8. Um único `batchUpdate` altera somente título, descrição, alternativas e
   gabarito, com CAS obrigatório. Não cria, move ou remove itens. Não consulta,
   apaga ou recria respostas dos participantes.
9. Perda da resposta HTTP ou falha ao salvar o recibo são recuperadas pelo
   conteúdo esperado, sem reaplicar o batch. Conflito de conteúdo impede retry
   destrutivo. Cada aprovação conserva seu próprio arquivo de recuperação.
10. O Form permanece fechado e não publicado. A liberação de leitura deve ser
    revalidada para a nova versão antes de reabrir; não há reabertura automática
    nem alteração de audiência neste adaptador.

`publicarQuestoesAprovadasGestaoV1` é o único ponto manual de aplicação. Com a
configuração inicial retorna `QUESTION_PUBLICATION_DISABLED`, sem acessar
Firestore, conteúdo do Drive ou API do Forms. A criação de uma aprovação não
habilita a configuração por si só.

## Limites comprovados da credencial da ferramenta

A consulta à API do Forms retornou HTTP 403 com `SERVICE_DISABLED` no projeto
consumidor da credencial da ferramenta. O download dos DOCX de questões retornou
HTTP 403 com `appNotAuthorizedToFile`, embora seus metadados e permissões fossem
legíveis. Isso é diferente de falta de acesso do administrador no Drive.

Esses resultados da ferramenta, isoladamente, não demonstravam o estado da API
no projeto consumidor do Apps Script. A prova isolada descrita abaixo confirmou
o acesso real do runtime. O manifesto foi preservado: a documentação
da API aceita o escopo Drive já declarado; não foi acrescentado consentimento.
Não foi ativada API, faturamento ou Blaze para contornar o bloqueio.

A investigação posterior confirmou por leitura autenticada: a Forms API está
`ENABLED` no FA, com `billingEnabled:false`; está `DISABLED` no projeto Gateway,
também sem faturamento. O consumidor que recusou a chamada da ferramenta não é
nenhum desses projetos. Com `x-goog-user-project` apontando para FA, a recusa de
serviço desativado desaparece e a ferramenta encontra uma barreira de acesso
por arquivo (404). O mesmo cliente não pode baixar os DOCX criados por outro
aplicativo OAuth (`appNotAuthorizedToFile`). Não se trata de falta de edição do
administrador no Drive.

O servidor aceita um `apiQuotaProjectId` opcional, privado e validado como ID de
projeto, enviado somente no header documentado de
[projeto de quota](https://docs.cloud.google.com/docs/authentication/rest).
O teste usa o FA já habilitado. Isso não amplia os escopos ou as permissões dos
arquivos, não associa uma conta de faturamento e não habilita serviços.

Os snapshots de 17/10/2026 continuam sendo snapshots históricos dos Forms, não
uma leitura atual. A comparação com os DOCX locais e os checksums atuais do
Drive pode verificar a equivalência dos arquivos, mas não substitui a releitura
do Forms imediatamente antes de uma futura publicação.

## Evidência de 18/10/2026

- 57 DOCX locais correspondem aos checksums atuais dos arquivos do Drive.
- 651 questões foram validadas contra os snapshots históricos; nenhuma mudança
  de questão foi proposta nessa comparação.
- Duas fontes instaladas e relidas, conservando integralmente as 43 anteriores
  (45 ao todo), com manifesto e propriedades preservados.
- `enabled:false`, nenhuma designação inventada, nenhuma aprovação instalada,
  nenhum acionador criado e nenhuma implantação alterada.
- Zero alterações de conteúdo em Forms ou Firestore.
- 38 testes novos cobrem publicação CAS, revogação, permissões dos editores,
  conteúdo aprovado, campos de ciência, perda de resposta, recuperação e replay.

A prova nativa anterior foi complementada pela publicação CAS real descrita
abaixo. A configuração dos formulários de produção permanece desligada, sem
designação ou aprovação presumidas.

## Prova CAS isolada

`ManagementQuestionCasValidation.gs` confere a publicação REST com arquivos
descartáveis privados. A configuração expira em até 30 minutos, exige o
proprietário efetivo, IDs e marcadores exatos e rejeita qualquer colisão com os
57 bancos de questões e os 40 pares de material/PDF de produção.

Um agendamento temporário, executado uma única vez pela manutenção existente,
pode criar somente o acionador próprio dessa prova. O ponto temporário de
agendamento deve ser removido após a execução; não é um observador permanente
de questões e não altera o intervalo da manutenção PDF.

São reais as operações de Drive, Forms, gravação CAS, recuperação e leitura da
resposta sintética. Somente o perfil e a designação do gestor de teste são
sintéticos: a prova não usa perfis, pontuações ou respostas de profissionais.
O resultado precisa comprovar uma gravação, preservação dos IDs/pontos e da
resposta anterior, recuperação de resposta HTTP perdida sem segunda gravação,
replay sem escrita e rejeição HTTP 400 da revisão obsoleta. O formulário deve
terminar fechado e não publicado. Uma falha não habilita a configuração real.

### Resultado real da prova CAS em 18/10/2026

Às **00:58:13 (America/Sao_Paulo)**, o recibo privado retornou
`QUESTION_CAS_VALIDATION_PASSED`:

- Leitura e publicação pela API: HTTP 200.
- Uma questão alterada, com IDs, pontos e obrigatoriedade preservados.
- Gabarito atualizado e a resposta sintética anterior preservada: uma antes e
  uma depois, com a mesma evidência armazenada.
- Perda simulada da resposta após a gravação real: recuperação confirmada sem
  outro batch; total de uma gravação e repetição com zero escritas.
- Revisão obsoleta: rejeitada com HTTP 400, sem alterar o conteúdo atualizado.
- Forms de teste fechado e não publicado; zero leituras do Firestore e zero
  alterações de conteúdo de produção.

A primeira tentativa parou antes da publicação porque o recibo descartável foi
criado como `text/plain`, enquanto o teste exigia `application/json`. Os
metadados reais confirmaram os demais controles (pasta, proprietário e marcas).
A correção exige o MIME real, sem relaxar esses controles. A repetição usou
outro conjunto de arquivos e outro estado; a tentativa anterior foi preservada.

A revisão de código acrescentou revalidação da validade da aprovação antes de
fechar o Form e imediatamente antes do batch. A aprovação que expire durante
consultas, fechamento ou checagem final bloqueia a gravação. Nenhuma conclusão
de homologação atribui gestor, aprova conteúdo ou concede pontuação por si só.

## Auditoria somente de leitura dos bancos reais

`ManagementQuestionRuntimeAudit.gs` lê os Forms e os DOCX pela identidade
autorizada do Apps Script e compara enunciados, alternativas, pontos, IDs e
gabaritos. Não aplica revisões, não fecha formulários, não lê respostas de
participantes e não acessa o Firestore. O resultado público contém somente
contagens e categorias seguras; os vínculos e fingerprints ficam no recibo
privado do proprietário.

O processamento tem limite de 24 documentos ou 90 segundos por execução,
salvando cada documento conferido antes de avançar. A privacidade do recibo é
validada uma vez por lote limitado, sem repetir todas as chamadas de permissão
em cada checkpoint. Não há varredura permanente: configuração, estado e
acionadores são específicos desta auditoria temporária.

A janela inicial terminou com 29 documentos conferidos. Uma continuação
explicitamente configurada no servidor preservou os 29 registros e retomou
somente o sufixo ainda não lido. A continuação tem outra janela limitada de
20 minutos, versão única e configuração imutável dos vínculos; a manutenção
comum não zera o cursor nem reinicia trabalhos concluídos. Os testes cobrem
recibos inválidos, alteração de vínculos e prevenção de leituras duplicadas.

### Auditoria real concluída

Às **01:20:34 de 18/10/2026 (America/Sao_Paulo)**, o Apps Script retornou
`QUESTION_BANK_RUNTIME_AUDIT_READY`: 57 Forms, 57 DOCX e 651 questões, sem
divergências, sem falhas e sem continuação pendente. Os registros foram
conferidos contra os 57 vínculos exatos, sem duplicação de documentos ou Forms.
Não houve escrita de conteúdo nos Forms nem leitura ou escrita no Firestore.

Essa conferência substitui a limitação anterior dos snapshots históricos: os
enunciados, alternativas, pontos e gabaritos foram relidos das fontes reais.
Uma futura publicação ainda precisa reler a versão atual imediatamente antes
do batch, pois a auditoria não congela os documentos depois de terminar.

### Encerramento conferido

Às **01:21:48**, a releitura do código remoto confirmou 45 fontes: as 43 fontes
anteriores não relacionadas à publicação permaneceram idênticas, o publicador
corresponde ao código local testado e sua configuração privada tem 57 vínculos,
`enabled:false`, nenhuma designação inventada e o consumidor FA explícito.
As fontes, configurações e pontos de agendamento temporários da prova e da
auditoria foram removidos do projeto. Os próprios handlers já haviam removido
seus acionadores ao terminar. A manutenção PDF voltou ao código anterior exato.

As duas pastas descartáveis foram identificadas como encerradas e mantidas
privadas, sem exclusão de conteúdo. O formulário sintético terminou fechado.
Manifesto, implantações, PWA, usuários, Rules, IAM e faturamento foram preservados.

## Verificação local complementar

183 testes focados aprovados: banco DOCX, parser nativo, publicação condicional,
prova CAS isolada, auditoria de leitura e continuação, validação anterior de
revisão, proteção de pastas e sincronização PDF. Nenhuma alteração de frontend
foi feita nesta etapa; não houve publicação ou substituição da PWA.

## Retorno seguro

Desabilitar `enabled` na configuração privada impede outra aplicação. Não se
excluem arquivos de recuperação nem se reabre o Form após falha. Para desfazer
conteúdo já publicado, conferir o snapshot anterior e preparar outra revisão
aprovada com CAS sobre a versão atual; nunca restaurar todo o formulário por
cópia, pois isso trocaria IDs ou poderia perder respostas.

O sincronizador DOC→PDF permanece independente e ativo nos 40 pares existentes.
Este adaptador não modifica seus estados, acionadores ou propriedades.
