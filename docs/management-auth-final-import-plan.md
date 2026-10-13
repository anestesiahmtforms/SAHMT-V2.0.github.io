# Plano controlado FA → FB e FA → FC

## Estado de entrada informado pelo operador

- A única lista de candidatas à retirada após o encerramento da homologação contém dois endereços definidos pelo administrador. Cada identidade precisa ser confirmada no snapshot FA por UID único e correspondência do e-mail principal; sem isso, fica em revisão.
- A conta estrutural `fa-owner@example.invalid` é protegida por UID validado e digest do registro Authentication. Ela nunca entra no grupo de candidatas, mesmo se aparecer um marcador conflitante.
- Qualquer outro usuário, incluindo participantes anteriores de homologação, administradores, auxiliares e profissionais, permanece preservado. `disabled` desconhecido não determina homologação.
- FB tem sete contas. Seus UIDs coincidem com correspondentes FA, mas equivalência de e-mail, nome, status e provedores ainda não foi verificada. A associação das contas às duas identidades candidatas só será conhecida após snapshots completos e conferência UID/e-mail.
- FC aparece vazio no Console, segundo conferência manual. O estado precisa ser recapturado antes de qualquer escrita.
- A tentativa autorizada mais recente de leitura automatizada do FB falhou em `AUTH_READ` / HTTP 400. Não existe nesta etapa um snapshot FB automatizado recente que permita fechar a prévia.

Esses números não permitem deduzir com segurança quantos registros serão criados em cada destino. A fonte FA continua sendo a autoridade; contagens manuais não substituem snapshots completos e frescos.

## Identidade e elegibilidade

1. Capturar novamente, de forma protegida, Auth FA, perfis FA `users/{uid}`, Auth FB e Auth FC; conferir cobertura completa, projeto, horário e hashes. Não incluir dados de senha no relatório.
2. Resolver somente as duas candidatas configuradas por correspondência única entre e-mail exato e UID do Authentication FA. Confirmar separadamente a conta estrutural por UID e `sourceRecordSha256`. Qualquer ausência, duplicidade ou colisão bloqueia a classificação e a migração dessas identidades.
3. Preservar o UID FA em cada destino (`fbUid`/`fcUid` igual a `faUid`). Nunca vincular por e-mail quando o UID divergir.
4. Comparar cada conta FB existente por whitelist de identidade: UID, e-mail, nome/foto quando aplicável, `disabled`, `emailVerified` e provedores. Equivalente = `SKIP`; divergência ou colisão = bloqueio/revisão, sem sobrescrita.
5. FC deve passar por captura de Auth completa mesmo após a conferência manual de vazio. Qualquer conta encontrada entra na mesma comparação por UID e campos.
6. As contas sem provedor Google podem ser pré-provisionadas como registros sem provedor, com o mesmo UID e sem senha/hash/salt, desde que a captura bruta e a evidência privada validem o registro providerless. Essas propostas seguem como `ready:false` até o primeiro-login/vínculo Google do FA ser resolvido. Provedor password ou outro provedor permanece em revisão.

O Firebase suporta importações sem parâmetros de hash quando não há senha a migrar, inclusive identidades OAuth e de autenticação customizada. `signInWithCustomToken()` também cria um registro se o UID ainda não existir; isso é provisionamento no primeiro login, não pré-carga de todos os usuários. [Importar usuários](https://firebase.google.com/docs/auth/admin/import-users), [Custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

## Implementação local atual

`prepareManagementClosedAuthImport()` existente mantém a preparação FB. Foi acrescentado `prepareManagementClosedFcAuthImport()` como contrato FC específico. Ambos são puros e não têm Firebase SDK, credencial, rede nem função de escrita. Cada um só produz lote a partir de plano pinado e sem conflitos, com `allowOverwrite:false`, `sanityCheck:true` e whitelist sem senha/hash/claims/tokens. A resposta parcial é reduzida a contagens e índices; o pós-check exige que todas as contas anteriores e todas as contas previstas permaneçam exatamente conciliadas.

O planejador e a preparação local de lotes agora admitem a proposta explícita `CREATE_CUSTOM_TOKEN_ONLY` para usuários providerless com evidência pinada. O lote carrega `providerUserInfo:[]` e preserva UID/status/perfil autorizado, sem credenciais, claims ou permissões. O broker FB aceita uma conta FB sem provedor apenas após validar a sessão Google/FA, a autorização FA e o UID exato habilitado no FB; outro provedor ou UID diferente continua sendo negado. Esse comportamento não resolve o login inicial dos 53 na origem FA, portanto a simulação e o importador mantêm a pendência de primeiro login e não consideram a migração pronta.

A conta estrutural protegida é reconhecida apenas por UID estável e digest do registro FA validado. Para qualquer destino, se faltar uma conta protegida, a preparação marca `PROTECTED_REQUIRES_EXPLICIT_APPROVAL` e não a inclui no lote automático. Se já existir e for equivalente, mantém `SKIP`; divergência é conflito. A checagem do UID real e do digest permanece pendente, assim como a comparação manual dos sete registros FB.

Claims administrativos não são levados pelo lote de Auth. Os perfis FA definem o grupo PWA: administrador somente com `active:true`, `access:true` e `role:'administrador_app'` ou `permissions.admin:true`. A projeção de direitos em Firestore FB/FC é uma etapa separada, exige modelo e regras de cada destino e não concede IAM Google Cloud. Sem projeção vigente, nenhuma conta deve ganhar acesso administrativo por estar autenticada.

## Execução futura e recuperação

1. Produzir backup privado e protegido de entradas fonte/destino, mappings, plano e intenção pinados. Somente as duas identidades candidatas confirmadas ficam fora do lote inicial; demais contas são preservadas.
2. Rever manualmente a contagem e as categorias agregadas; investigar qualquer conflito, conta desativada/estado desconhecido, providerless, e-mail duplicado, UID duplicado ou perfil administrativo inconsistente.
3. Fazer uma nova captura imediatamente antes da escrita. Se qualquer fingerprint mudar, descartar a aprovação e recomputar o lote.
4. A preparação local gera REST `accounts:batchCreate` com `hashAlgorithm:'BCRYPT'` (campo exigido pelo schema REST), `allowOverwrite:false` e `sanityCheck:true`; não inclui `passwordHash`, `passwordSalt`, salt, claims nem tokens. A chamada real ainda exige validação pelo Console/ensaio aprovado; não foi feita nesta etapa. A API pode retornar sucesso parcial e não é atômica. A alternativa Admin SDK `Auth.importUsers()` aceita identidades sem hash, mas a documentação avisa que UID existente pode ser substituído; portanto só é aceitável com exclusão de criação concorrente e verificação imediatamente anterior. [REST `batchCreate`](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/batchCreate), [Importar usuários](https://firebase.google.com/docs/auth/admin/import-users).
5. Após timeout, resposta parcial ou erro, não repetir automaticamente. Fazer nova leitura Auth do destino; classificar cada UID como equivalente, ausente ou conflito e preservar o índice local da tentativa. Só gerar nova intenção para os ausentes após reconciliação explícita.
6. Rodar pós-conferência completa: preservar os sete registros originais FB, confirmar cada UID/campo autorizado, conferir que FC não perdeu registros e validar desativação/status. Não apagar automaticamente registros parcialmente criados; eventual compensação é outra operação de escrita e exige autorização própria.
7. Manter login/broker e permissões de conteúdo desligados até a projeção administrativa e as regras próprias de FB/FC serem preparadas. Não alterar Rules nesta etapa.

## Sincronização futura

Centralizar mudanças no FA e enviar eventos idempotentes versionados para FB/FC. Para cada projeto, serializar criação e atualização por UID, preservar o estado desativado e impedir regressão de versão. Na revogação, bloquear/invalidar o acesso no destino antes de considerar o ciclo concluído. Em falha parcial, gravar um estado de reconciliação e retomar por comparação de estado; nunca criar duplicata, sobrescrever silenciosamente ou inferir sucesso por timeout.

O Spark não fornece por si só um processo confiável de sincronização Auth entre projetos. Não depender de gatilhos pagos; a execução recorrente exige um caminho gratuito, quota verificada e identidade de servidor aprovada. Nenhum sincronizador foi implementado ou ativado nesta etapa.

## Gates de autorização

Ainda exigirão aprovação específica: novas leituras reais dos snapshots; qualquer escrita de Auth em FB/FC; sincronização/desativação/exclusão; cópia de perfis/privilégios Firestore; alteração de IAM ou Rules; publicação do Gateway/Worker; ativação da integração. Nenhuma foi executada neste trabalho.

## Testes locais

- `tests/management-closed-fc-auth-import.test.js`: UID preservado, allowOverwrite falso, whitelist, colisões/UID divergente, parcial sanitizado, pós-check e preservação de contas anteriores.
- `tests/management-closed-auth-import.test.js` e `tests/management-auth-import-plan.test.js`: regressão FB, duas identidades candidatas UID/e-mail, conta estrutural protegida, demais contas preservadas, conflitos, fingerprints e subconjunto Google-only.
- Todas as provas usam fixtures e dados sintéticos; não consultam serviços Google/Firebase e não demonstram importação real.
