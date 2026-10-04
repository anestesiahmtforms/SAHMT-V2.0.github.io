# Documentos por público: implantação separada e revisável

Base desta alteração: `main` em `3463c6286d3fd1a450fc462ba3c2c7fd0645e38e`.

## Coleções e autorização

`documents` mantém seu schema, seus IDs e suas regras existentes. A edição de um documento antigo continua nessa coleção. O seletor de público aparece apenas para os novos registros de `scopedDocuments`.

`scopedDocuments` usa os mesmos campos de documento e acrescenta `audienceGroup`, obrigatoriamente `GENERAL` ou `RESTRICTED`. A leitura comum exige simultaneamente perfil ativo, acesso aprovado, permissão `managementRead`, documento ativo e pertencimento ao grupo. Administradores e usuários com `documentsManage` conservam sua capacidade de gestão; `qualityManage` permanece limitado à área de qualidade. Nenhuma lista de e-mails concede permissões ao perfil.

`documentAccessEmails/{emailNormalizado}` tem exclusivamente:

| Campo | Valor |
| --- | --- |
| `id`, `email` | E-mail igual ao ID do documento, em minúsculas |
| `groups` | Lista sem repetições, com até dois valores: `GENERAL`, `RESTRICTED` |
| `active` | Booleano; ativo exige pelo menos um grupo |
| `version` | Inteiro positivo, incrementado a cada edição |
| `createdByUid`, `createdAt` | Autor e instante da criação, preservados nas edições |
| `updatedByUid`, `updatedAt` | Autor autenticado e timestamp do servidor |

A identidade do leitor vem do token Firebase com e-mail verificado e provedor Google. O campo `email` do perfil, campos do Forms e valores enviados pelo navegador não concedem participação em grupos. O usuário consulta apenas o cadastro correspondente ao próprio e-mail; listar o cadastro inteiro ou editar grupos exige `documentsManage`/administrador. Os e-mails reais e o plano de importação ficam fora do repositório.

## API de gravação

`saveManagementDocument(input, uid)` conserva a coleção `documents` quando `documentCollection` não é enviado, para manter os chamadores existentes. Novos cadastros da interface enviam `documentCollection: 'scopedDocuments'` e o público escolhido. Os documentos são identificados na interface por `coleção/id`, evitando colisões entre as duas coleções.

`saveDocumentAccessEmail({email, groups, active, version}, uid)` usa transação, versão esperada e timestamps do servidor. É uma API administrativa; não há cadastro automático de permissões nem exposição pública da lista de usuários. Para criar, a versão esperada é zero. Para alterar, deve ser a versão atual. Um usuário futuro pode ter seu e-mail registrado antes do primeiro login, mas precisa ter o perfil aprovado e `managementRead` quando entrar no app.

## Forms e pontuação

A descoberta do Apps Script passa a reconhecer `scopedDocuments`. Um registro inativo continua inativo na projeção de avaliação. A alteração não configura critérios, elegíveis, `READY`, pontuações, gatilhos ou homologação. A configuração de avaliação segue o fluxo já existente. Gabaritos e provas privadas não são incluídos no app ou nesta documentação.

O público dos documentos não é convertido automaticamente em elegibilidade de avaliação. `learningActivities` conserva `ALL`/`ROLE`/`USER`, e as avaliações conservam sua configuração de UIDs elegíveis. Antes de ativar uma avaliação restrita, os elegíveis devem ser conferidos contra o cadastro privado por e-mail e os perfis aprovados. A adoção de elegibilidade automática por grupo exige uma alteração separada com testes próprios; não se deve usar `ALL` para tentar representar um público restrito.

Para importar os novos materiais, prepare registros separados de documento de apoio e de formulário, com IDs estáveis, público explícito, `active: false` e auditoria do executor autenticado. Não publique URLs de edição de Forms para participantes. Use o link de resposta quando houver publicação aprovada. O documento de apoio pode usar sua URL de consulta do Drive. Preserve os originais e a equivalência de matéria/versão para cópias com conteúdo idêntico.

## Sequência de implantação após revisão

1. Revisar o PR, a lista privada de participantes, as categorias e os registros previstos. Conferir as permissões já aprovadas dos gestores, sem ampliá-las.
2. Publicar as regras e os dois índices de `scopedDocuments` antes do build do app; aguardar os índices ficarem prontos. Essa ordem evita que o novo cliente consulte coleções ainda bloqueadas pelas regras anteriores.
3. Cadastrar a lista privada por um executor com `documentsManage`, conferir versões e verificar contas fictícias de ambos os grupos. Alterar a lista não ativa documentos.
4. Cadastrar os materiais/Formulários como inativos e verificar os totais e URLs. Um Forms fechado não está disponível para responder; a ativação exige etapa separada de publicação e homologação.
5. Publicar o build aprovado e confirmar o comportamento em Android/iPhone com contas fictícias. Conferir documento geral, restrito, inativo, perfil revogado e reabertura da área após alteração de grupo.
6. Somente após revisão de conteúdo e homologação, realizar a ativação explicitamente aprovada de documentos/Formulários. Esta alteração não executa esses passos.

As permissões do Google Drive e Google Forms continuam independentes das regras do app. O bloqueio no app impede consultas futuras e listas não autorizadas; não apaga links ou conteúdo já vistos. Uma pasta compartilhada amplamente no Drive não se torna restrita apenas por selecionar `RESTRICTED` no Firestore.

## Verificação local e limites

- `npm run test:domain`: testes de domínio existentes e regressões do cadastro por grupos, identidade da coleção, consulta limitada e sessão substituída.
- `npm run test:rules`: emulador `demo-sahmt-v2`, incluindo privacidade da lista, grupo autorizado, login Google verificado, permissão de módulo, revogação, auditoria, versões, área de qualidade e preservação do legado.
- `npm run build`: build local; sem publicação de Pages.
- Não houve cadastro real, implantação de regras/índices, instalação de gatilhos ou teste autenticado em dispositivo físico nesta alteração.

Um usuário com acesso revogado é bloqueado nas próximas leituras pelo servidor. A lista da área é atualizada ao reabrir/recarregar; esta mudança não acrescenta observadores em tempo real de e-mails e documentos. O fluxo atual de observação do perfil continua responsável por revogação de sessão e módulo.
