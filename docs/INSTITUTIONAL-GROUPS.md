# Pesquisas institucionais: sessão, grupos e participação

O profissional usa seu login normal no FA. Em Enquetes e Consultas → Pesquisas institucionais, o app abre o formulário hospedado no FE dentro de um iframe. Não existe segundo login nem seleção de grupo. Ao entrar na pasta, o cabeçalho do app deixa de exibir o nome e mostra o grupo. O aviso informa: “Você acessou pelo grupo X. Seus dados pessoais não serão exibidos neste ambiente. Os resultados são apresentados apenas de forma agregada por grupo.” Uma nova entrada após envio confirmado bloqueia o formulário; sair antes de enviar não consome a participação. O servidor consulta o cadastro de Gestão: EFETIVO → Equipe; RESIDENTE_1/2/3 → Residentes; SUBSTITUTO → Substitutos. Cargos ADMINISTRADOR/GESTOR não atribuem filiação. Secretárias deixou de ser aceita como grupo.

A comunicação entre FA e FE exige a origem exata e a referência da janela correspondente; cada solicitação usa um desafio aleatório temporário, que nunca vai para os dados analíticos. O token Firebase do FA fica no app e vai somente para o endpoint fixo do servidor. O iframe recebe grupo e situação da própria participação, envia as respostas pelo app e recebe somente o recibo. O app não persiste respostas, rascunhos ou recibos no aparelho.

## Controle no servidor

/v1/institutional-surveys aceita BOOTSTRAP e SUBMIT autenticados no projeto FA. A assinatura e a situação da conta são conferidas pelo Firebase; perfil ativo/com acesso e filiação são conferidos no cadastro de Gestão. O servidor ignora o grupo enviado pelo cliente e aplica o grupo cadastrado.

Uma transação no FE cria dois documentos independentes: surveyParticipation tem somente UID, pesquisa, ciclo e completed=true; climateResponses/stressResponses têm somente versão, ciclo, grupo, respostas e medida opcional de estresse. Não há nome, e-mail, UID, IP ou referência ao registro de participação nos campos analíticos. Comentários de clima ficam em outro documento com ID aleatório próprio, sem grupo ou referência à resposta. O registro de participação não guarda ID da resposta, resumo das respostas, grupo ou horário explícito.

A mesma conta não consegue criar uma segunda resposta na mesma pesquisa/ciclo, mesmo usando outro ID aleatório, aba ou aparelho. Uma falha de rede pode ser reenviada: se a primeira transação tiver sido confirmada, o servidor retorna que a participação já estava registrada, sem alterar a resposta anterior. Inválidos e ciclos fechados não consomem a participação. As regras do FE negam gravações e leituras diretas de respostas e participação por clientes. Relatórios continuam restritos ao leitor autorizado.

Essa arquitetura não oferece anonimato absoluto. A mesma requisição autenticada chega ao servidor que recebe as respostas. Os metadados automáticos do commit do Firestore e registros de infraestrutura podem permitir correlação por operadores com privilégios técnicos. A separação descrita vale para os campos dos documentos e para a aplicação; não é uma afirmação de desvinculação criptográfica.

## Histórico e indicadores

Clima 1.4 e estresse 1.2 identificam a etapa com controle autenticado. Registros anteriores, sem controle por conta, não podem ser vinculados retroativamente a usuários. Permanecem preservados fora dos novos indicadores; não devem ser reclassificados, associados a contas ou apagados. O limite de um envio passa a valer nesta nova etapa, com chave por conta/pesquisa/ciclo, independente de futuras revisões do texto.

Indicadores são publicados somente após o encerramento, com os três grupos e proteção de grupos pequenos. Contagens da etapa autenticada representam participações únicas por conta; não são inferências sobre respostas legadas. Clima mantém proteção por item e não publica totais de pontuação que permitam reconstruir grupos pequenos. Estresse mantém supressão complementar, inclusive na medida opcional.

## Implantação e acesso mínimo

O Worker existente precisa de três permissões no banco padrão do FE: datastore.databases.get (transações), datastore.entities.get (documentos conhecidos) e datastore.entities.create (criação com precondição de inexistência). Não precisa de listar, editar, excluir, gerenciar IAM ou criar chaves. A concessão utiliza uma role personalizada e condição restrita ao banco padrão. Não há nova conta de serviço, chave, Apps Script, Cloud Functions ou ativação de Blaze.

Referências oficiais para revisar o escopo: [permissões por método](https://firebase.google.com/docs/firestore/security/iam) e [condições por banco](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions). O código do servidor limita as coleções acessadas; a condição IAM é por banco, não por coleção.

Publicar somente após autorizar e aplicar o acesso do servidor, validar os testes e gerar os builds. Implantar Worker, depois FE (hosting e regras) e app FA/FB. Preservar status dos ciclos ao atualizar a versão. Não criar respostas sintéticas em produção nem afirmar que foi testado login real de participante quando a validação usou fixtures.

## Validação

Testes: 20 submissões concorrentes produzem um único par resposta/participação; reenvio não altera respostas; grupos falsificados são substituídos pelo cadastro; conta revogada, vínculo ausente, entrada inválida e ciclo fechado não gravam participação. Regras negam acesso direto a respostas/participação. Ponte valida origem, janela, desafio e descarte ao sair. Navegador local simula duas origens e duas abas usando o mesmo serviço de domínio, sem autenticação Google adicional.
