# Simulação local de Auth FA → FB e FA → FC

`prepareAuthMigrationSimulation()` em `scripts/lib/management-auth-import-plan.js` combina duas prévias puras: FA `sahmt-17a16` → FB `sahmt-gestao-5ae66` e FA → FC `indicadores---sahmt`. Cada destino usa seu campo de vínculo (`fbUid` ou `fcUid`) e exige igualdade com `faUid`; o UID não é remapeado.

## Entrada e identificação de administradores

A função recebe snapshots completos de Firebase Auth FA, FB e FC, mappings locais e uma captura completa dos documentos `users/{uid}` do FA (`sourceProfileSnapshot.profiles`). Um perfil é membro do grupo de administradores da PWA somente quando `active === true`, `access === true` e (`role === 'administrador_app'` ou `permissions.admin === true`). Perfil ausente, inválido, duplicado, órfão ou sinal administrativo com acesso inativo impede afirmar que o grupo está reconciliado. O resultado informa apenas quantidades; não transporta UIDs, e-mails, nomes ou linhas individuais.

O grupo elegível é comparado com as contas Auth planejadas em FB e FC. Isso não copia privilégios nem Custom Claims, não altera Firestore Rules e não concede IAM. `effectivePrivilegesCopied` e `cloudIamPermissionsGranted` permanecem `false`. A política de permissões da aplicação precisa ser revisada separadamente antes de qualquer concessão.

## Classificação e proteção

Por destino, os totais distinguem `create`, `alreadyEquivalent`, `conflict` e `manualReview`. Uma conta existente equivalente é mantida sem proposta de escrita; qualquer diferença ou colisão permanece bloqueante. Contas com provedor `password`, provedor não Google, provedores Google ambíguos ou identidade sem evidência segura ficam em revisão manual. Um subconjunto explicitamente revisado pode ser pré-provisionado sem provedor para uso posterior por Custom Token, mas o plano continua `ready:false` até existir um fluxo seguro de primeiro login/vinculação Google no FA. A evidência privada exige que as capturas normalizada e bruta continuem iguais e que o registro não tenha provedor, material de senha, estado inesperado ou metadados desconhecidos. Senhas, hashes, salts, tokens e claims não são copiados para o lote. O relatório agrega somente contagens e códigos de categoria, sem identificadores pessoais.

A simulação é local e sem efeitos: `previewOnly: true`, `writeEnabled: false`, sem SDK Firebase, credenciais, rede, importação ou alteração de serviço. O resultado não é autorização para importar. `prepareManagementClosedAuthImport()` mantém o lote FB; `prepareManagementClosedFcAuthImport()` prepara o contrato local FC. Nenhum deles executa escrita remota. O helper FC mantém o mesmo plano pinado, UID preservado, `allowOverwrite:false`, whitelist sem senha/hash/claims/tokens, tratamento de parcial e pós-conferência.

## Duas candidatas à retirada após a homologação

O grupo de candidatas está fixado em duas identidades específicas. O planejador as resolve usando o e-mail principal exato no snapshot Auth FA, exige correspondência com um único UID e confere que esse endereço não aparece em outra identidade da origem. UID/e-mail ausente, duplicado, divergente ou relacionado a mais de uma conta retira os registros envolvidos do lote e os mantém em revisão. Não há quantidade derivada de `disabled` nem de participação anterior em treinamento.

A conta estrutural é confirmada por UID e digest `sourceRecordSha256`, e o registro precisa conter o e-mail estrutural esperado. A identidade estrutural nunca é candidata. O inventário FA persiste somente um marcador categórico dentro do índice DPAPI, nunca o e-mail; a prévia exige que o UID estrutural validado corresponda a esse marcador. Os dois marcadores candidatos também devem ser únicos; duplicidade resulta em `REVIEW`.

As duas candidatas confirmadas e quaisquer identidades ambíguas relacionadas ficam fora do lote inicial. Todos os outros usuários, inclusive antigos participantes, administradores, auxiliares e profissionais, permanecem na simulação operacional. Nenhum usuário é excluído ou alterado. O relatório sempre mantém exclusão automática desligada.

O verificador `prepareManagementRetirementImpact()` recebe snapshots Auth, índices completos dos perfis e um índice agregado de referências por UID para FA, FB e FC. Produz contagens de presença por UID/e-mail, perfis e dependências nas categorias operacional, treinamento, auditoria e outras. Se algum projeto não tiver cobertura completa, falhará sem relatório conclusivo. Referências históricas são apenas contabilizadas e nunca entram em exclusão automática. Esta camada local não consulta o Firebase e não implementa ainda um scanner de coleções; a lista de coleções e campos de referência deve ser definida antes da futura leitura real.

## Primeiro login Google no FA

O login atual usa `signInWithPopup()` com `GoogleAuthProvider` diretamente no FA. Depois do retorno, a aplicação consulta `users/{uid}` usando o UID retornado; se o perfil não existe, consulta `accessRequests/{uid}` e pode mostrar o pedido pendente. Não há no cliente nem no Gateway uma reconciliação entre o UID Google recém-autenticado e um UID FA pré-cadastrado sem provedor. Portanto o código local não garante preservar o UID das contas sem provedor durante o primeiro login. A migração não deve assumir que só o e-mail informado no navegador autoriza essa associação.

O broker FB agora aceita uma conta alvo sem provedor somente quando a solicitação já passou pela validação de token Google/FA, autorização FA ativa e correspondência exata do UID no FB; o registro FB precisa estar habilitado e sem outro provedor. Um binding ausente pode ser derivado pelo mesmo UID validado no servidor; binding presente e divergente continua negado. Isso permite a sessão complementar depois do login FA, mas não resolve a criação/vinculação inicial do provedor Google no FA. Essa etapa requer desenho e aprovação própria com prova de identidade Google validada no servidor, vínculo único e protegido contra replay, sem promoção automática de permissões.

## Testes

`tests/management-auth-import-plan.test.js` cobre UID igual no destino FC, contas existentes sem sobrescrita, grupos temporário/estrutural, digest da identidade protegida, autorização por `users/{uid}`, privacidade do resumo e revisão custom-token-only. `tests/management-closed-auth-import.test.js` cobre lote providerless sem senha/hash/claims. `tests/management-closed-fc-auth-import.test.js` cobre o lote FC e sua reconciliação. `tests/management-auth-broker.test.js` cobre sessão FB custom-token-only com UID FA igual, rejeição por UID divergente e falhas FB/FC independentes. Toda a cobertura usa fixtures e adapters sintéticos; não comprova o estado atual dos projetos reais nem o primeiro login FA.

## Etapas ainda dependentes de autorização

Qualquer leitura dos projetos reais para obter snapshots, conferência de conflitos/UIDs reais, backup, importação/criação de contas, espelhamento de privilégios, alteração de Rules/IAM, publicação de Gateway/Worker e ativação da integração exigem autorização específica. A presente implementação não executa nenhuma dessas operações.
