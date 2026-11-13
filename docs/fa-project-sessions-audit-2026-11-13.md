# Auditoria da entrada coordenada por FA — 13/11/2026

## Evidências e escopo

Revisão do fluxo do PWA, consulta somente de leitura dos cadastros Firebase Auth e configuração administrativa quando permitida. O arquivo JSON ao lado contém apenas contagens; nenhuma credencial, resposta clínica ou cadastro individual foi gravado. Não houve importação, exclusão ou alteração de usuários, permissões IAM, regras Firestore ou planos de cobrança nesta auditoria.

FA é a identidade de origem. FB–FJ possuem 52 contas; os 49 vínculos Google presentes em FA foram localizados nos destinos com o mesmo UID. FK possui 29 contas, todas com UID e vínculo Google correspondentes a FA, para o público restrito já provisionado. Os três cadastros de FA sem provedor Google não permitem comprovar esse vínculo pelo diretório; não foram vinculados por suposição de e-mail. A configuração administrativa de FB retornou HTTP 403 com a credencial disponível; sua listagem de contas foi permitida e conferida.

## Fluxos encontrados

| Instância | Autenticação usada pelo PWA |
| --- | --- |
| FA | Entrada Google e restauração persistida do Firebase SDK. |
| FB, FC, FD, FE | Credencial Google obtida na entrada FA estabelece as sessões dos destinos; depois o SDK restaura cada sessão. Mesmo UID e mesmo identificador Google são obrigatórios. |
| FF | Participa da mesma conexão inicial; a recuperação própria do módulo foi substituída pela recuperação central em FA. |
| FG, FH, FJ | Sessões automáticas de curta duração emitidas pelos serviços dos módulos a partir da sessão FA, com o mesmo UID. São criadas ao usar os módulos e encerradas ao sair das rotas consumidoras. Não exigem login Google do usuário no módulo. |
| FI | O serviço central de controle valida diretamente a sessão FA e sua atestação App Check. Não exige login interativo separado. |
| FK | Incluído na conexão inicial Google em FA, com elegibilidade pelo perfil e grupo autorizados em FA. Restauração pelo mesmo SDK dos demais destinos Google. |

Portanto, existe entrada única para o usuário, mas os destinos não possuem todos o mesmo mecanismo nem iniciam todas as sessões simultaneamente. As sessões temporárias FG/FH/FJ e o serviço FI não foram substituídos.

## Falhas corrigidas

1. FK possuía confirmação Google dentro da página. Removida; uma sessão ausente retorna à recuperação central de FA.
2. FF também possuía confirmação isolada. O módulo agora aguarda a coordenação compartilhada e direciona a recuperação para FA.
3. A recuperação central só aparecia mediante abertura manual em Sincronização. Agora aparece nas telas de entrada de FA quando existe destino aplicável pendente.
4. O coordenador aguardava todas as restaurações antes de começar as conexões novas. Agora cada destino pode iniciar sua conexão assim que sua própria restauração terminar, preservando o limite de duas trocas simultâneas.
5. FK era solicitado para todos os usuários, inclusive grupos não provisionados. Agora o coordenador usa o mesmo verificador de perfil e categoria do menu Funcional. Grupos excluídos não recebem credenciais FK e não deixam a coordenação permanentemente pendente. Falha de verificação permanece pendente, sem conceder acesso.
6. FF tolerava UID diferente se o identificador Google fosse igual. O diretório atual comprovou igualdade dos UIDs e a exceção foi removida tanto da conferência prévia quanto da sessão cliente.
7. FK aguardava a atualização remota e as participações antes de mostrar os formulários. Agora mostra o perfil disponível primeiro e atualiza apenas os cartões em segundo plano, preservando formulários abertos.
8. A atualização FK forçava renovação do token FA em cada abertura. Agora usa a renovação normal do SDK.
9. Um primeiro acesso sem snapshot legível podia falhar antes de solicitá-lo ao serviço. A ausência inicial não impede os formulários autenticados e a geração em segundo plano.

## Verificação e limites

Suíte de regressão da autenticação compartilhada, testes de Comunicação e novos cenários de FK: login com uma única credencial FA; restauração lenta de outro projeto; grupo não elegível; verificação de grupo indisponível; UID divergente; troca de usuário; saída global; falta do primeiro snapshot; atualização lenta ou com falha; navegação durante atualização. Compilação das aplicações independentes executada com FK habilitado.

Uma sessão FA persistida, criada antes da habilitação de um destino, não contém uma credencial Google reutilizável para criar essa nova sessão. Nessa situação a confirmação necessária fica centralizada em FA. A aplicação não guarda a credencial Google para evitar essa confirmação futura.

Não foi realizada uma nova entrada real no iPhone nem uma medição de latência nesse aparelho. Os testes verificam o comportamento do código e a compilação; a auditoria administrativa confirma os vínculos existentes, sem representar login real de cada usuário.
