# Governança local de identidades FA–FB–FC — 12/10/2026

## Papéis separados

- Administrador funcional: alias privado `ADMIN-FUNC-01`. Seu papel `administrador_app` vale para a PWA no FA; não concede automaticamente administração em FB ou FC.
- Proprietários técnicos: um proprietário por projeto, usados para operar a infraestrutura do próprio projeto. Propriedade Google Cloud/Firebase não se converte em perfil administrativo da PWA.
- Contas antigas de treinamento: dois registros identificados por UID no índice protegido do FA. Permanecem preservados, fora do piloto e não bloqueiam a integração; nenhuma exclusão foi autorizada.

Nenhum UID ou endereço pessoal é armazenado neste documento ou no código público. A configuração de proteção em execução continua exigindo pares UID/e-mail em propriedade privada do Gateway. A política permanece fail-closed se os pares não estiverem completos e confirmados.

## Evidência de identidade e autorização

- FA: `ADMIN-FUNC-01` existe no Authentication, UID confirmado no FA e comparado com o FB; `users/{uid}` existe, `role=administrador_app`, `active=true`, `access=true`. `permissions.admin` e claims administrativos não estão presentes. O código atual da PWA reconhece `role=administrador_app` como administrador no FA.
- FA: as permissões de destino lidas em `users/{uid}` mostram `trainingsRead=true`; `trainingsManage`, `managementIndicatorsRead` e `managementIndicatorsWrite` estão ausentes. A propriedade `admin` também está ausente.
- FB: `ADMIN-FUNC-01` existe no Authentication com o mesmo UID do FA e conta habilitada. Um GET em `users/{uid}` retornou 404; `accounts:lookup` não revelou claims administrativos. Portanto, a equivalência de UID está confirmada, mas não há evidência de perfil ou privilégio administrativo local no FB.
- FC: inventário não executado porque a sessão do proprietário FC não está autenticada neste ambiente. UID, estado, provedor, perfil e privilégios seguem pendentes.
- Proprietários técnicos dos três projetos: seus papéis de infraestrutura foram informados pelo administrador, mas não foram tratados como privilégios PWA. UID/Authentication de FB e FC não foram confirmados nesta rodada.

O UID de `ADMIN-FUNC-01` foi comparado em FA e FB. No FA, o estado `disabled` não veio como booleano nem em `accounts:batchGet` nem em `accounts:lookup`; por isso, a classificação automática conservadora mantém essa identidade em `REVIEW`, apesar do perfil ativo e autorizado. Nenhum campo de perfil foi gravado.

## Classificação FA sem escrita

Última prévia protegida: 60 contas e 60 perfis correspondentes; 0 perfis tinham `firstLoginCohort` persistido. Proposta: 53 `OPERATIONAL`, 1 `STRUCTURAL`, 2 `HOMOLOGATION` (excluídos do piloto), 4 `REVIEW`. A identidade `ADMIN-FUNC-01` é um dos administradores em `REVIEW` por estado Auth desconhecido. Os outros três casos em `REVIEW` incluem os estados Auth desconhecidos e um perfil sem evidência suficiente. Nenhum administrador é reclassificado estrutural por ser administrador.

## Contas antigas e referências observadas

No FA, os dois registros antigos têm `disabled=false`, perfis `active=true` e `access=false`; um perfil tem `role=administrador_app`, o outro `role=gestor`. Isso não prova ausência de dados e não autoriza exclusão.

Scanner local corrigido para emitir consultas fixas por campo e registrar explicitamente três campos de coleção-grupo que não foram consultados. Resultados agregados reais:

- FA: 95 consultas, 48 coleções consultadas. Candidato 1: 1 referência operacional e 23 de auditoria; candidato 2: 2 referências operacionais.
- FB: 98 consultas, 49 coleções consultadas. Candidato 1: nenhuma referência nas consultas realizadas; candidato 2: 1 referência operacional.
- Em FA e FB ficaram sem consulta `notificationReads.uid`, `history.createdByUid` e `history.updatedByUid`; coleções/caminhos fora da allowlist também não foram cobertos. FC não foi consultado.

Assim, não há base para uma proposta simples de exclusão. Essa lacuna de cobertura não bloqueia o piloto de FA–FB–FC; impede apenas concluir uma futura retirada segura.

## Autorização independente por destino

O runtime local agora deriva FB somente de `trainingsRead` ou `trainingsManage`, e FC somente de `managementIndicatorsRead` ou `managementIndicatorsWrite`. `role=administrador_app` e `permissions.admin` no FA permanecem locais ao FA e não são replicados como autorização para os destinos. No estado atual, a PWA pode solicitar FB para `ADMIN-FUNC-01` (há `trainingsRead`) e não solicitar FC (permissão FC ausente). O broker ainda reautoriza cada destino no servidor.

Para o piloto administrativo completo, a concessão de `trainingsManage` e das permissões FC necessárias deve ser uma alteração explícita do perfil FA, revisada e aprovada antes de qualquer escrita. FC requer inventário e verificação próprios primeiro.

## Estado das ativações

Todos os flags de PWA, Worker e Gateway continuam desligados. Nenhum usuário, perfil, regra, IAM ou serviço externo foi alterado. Nenhuma implantação ocorreu.
