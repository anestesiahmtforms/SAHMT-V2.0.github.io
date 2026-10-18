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

Esses resultados não demonstram o estado da API no projeto consumidor do Apps
Script. O runtime instalado ainda requer homologação de API em arquivo isolado
antes de habilitar uma revisão real. O manifesto foi preservado: a documentação
da API aceita o escopo Drive já declarado; não foi acrescentado consentimento.
Não foi ativada API, faturamento ou Blaze para contornar o bloqueio.

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

A prova nativa real anterior e estes testes não comprovam a publicação CAS real
por este novo adaptador. Essa verificação permanece bloqueada e separada.

## Retorno seguro

Desabilitar `enabled` na configuração privada impede outra aplicação. Não se
excluem arquivos de recuperação nem se reabre o Form após falha. Para desfazer
conteúdo já publicado, conferir o snapshot anterior e preparar outra revisão
aprovada com CAS sobre a versão atual; nunca restaurar todo o formulário por
cópia, pois isso trocaria IDs ou poderia perder respostas.

O sincronizador DOC→PDF permanece independente e ativo nos 40 pares existentes.
Este adaptador não modifica seus estados, acionadores ou propriedades.
