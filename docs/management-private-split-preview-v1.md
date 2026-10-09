# Simulação privada da separação de Gestão — v1

Preparação local de 8 de outubro de 2026. Os backups selecionados COMPLETE foram
abertos somente em memória com `openPrivateJson`; nenhum documento Firestore,
API, importação Auth, escrita produtiva ou gatilho foi executado nesta simulação.

## Entradas verificadas

| Captura | Escopo selecionado | Resultado |
| --- | --- | --- |
| FA `sahmt-17a16` | 43 árvores, 365 documentos, readTime `2026-10-09T01:04:07.736Z` | COMPLETE, consistente no escopo declarado; hash `7fc60a90f12b4eb01998962bb5e7ac71aa857b6b3e5289d728c5907517d69114`. |
| FB `sahmt-gestao-5ae66` | 44 árvores, 0 documentos, readTime `2026-10-09T01:00:13.416Z` | COMPLETE no escopo declarado; hash `2d044b2139c023f9a385e16b838791dc6b169d6e6ba6ad9f2a624a66e6e9f941`. |

COMPLETE refere-se às árvores selecionadas, com subcoleções descobertas e tipos
preservados. Não significa exportação de todas as coleções do projeto. As duas
capturas têm horários próprios e não formam uma transação entre projetos. Auth
foi capturado separadamente e não é atômico com o snapshot de documentos.

## Classificação por vínculos

A classificação cobre os 365 documentos e seus hashes individuais. Os 12 IDs das
áreas coincidem com o catálogo do aplicativo. Os 40 registros documentais têm
`managementAreaId` apontando a essas áreas capturadas. Os 40 pares de configuração
privada/atividade Forms têm o mesmo Form ID, área, escopo e versão; designação e
histórico possuem vínculo de área. Coleção, nome, categoria PERFORMANCE, e-mail
ou título sozinhos não decidem a migração.

| Classificação | Proposta | Quantidade |
| --- | --- | ---: |
| OWNED | 12 áreas + 5 documents + 35 scopedDocuments | 52 COPY |
| MIXED Gestão demonstrada | 40 configurações + 40 atividades Forms + 1 designação + 1 histórico | 82 COPY |
| MIXED mantida na fonte | 40 evaluationRequests + 4 trainings + 3 registros de progresso/recibo/conclusão | 47 KEEP_FA |
| SOURCE_ONLY | 60 users, 60 ACL de documentos, 31 contacts, 31 eventMembers, 1 accessRequest e 1 appConfig | 184 KEEP_FA |

Resultado da classificação: **134 cópias propostas, 231 mantidos em FA e zero
REBUILD**. Nenhum documento foi copiado. A proposta é bloqueada antes de criar
operações executáveis, conforme o próximo bloco.

Nesta captura selecionada não há auditLogs, evaluationAwards ou evaluationLedger:
a conferência de cadeias registra zero. Isso não comprova ausência fora do escopo.
Uma próxima versão com créditos deve conferir a cadeia inteira por awardId,
lastLedgerId/correctsId, modalidades, origem e correções administrativas. AuditLogs
com action/resourceId exigem adapter específico; o planejador atual não prova essa
relação por um rótulo ou dependência arbitrária no manifesto.

## Bloqueios encontrados

1. **UID histórico sem vínculo demonstrado.** `prepareSplitPlan` recusa
   `UID_NOT_MAPPED`. Um ator aparece em createdByUid dos cinco documents e em
   updatedByUid de quatro deles. Ele não corresponde a nenhum dos 60 perfis ou
   60 registros Auth capturados e não tem literal identificador correspondente
   nos produtores locais examinados. A autoria foi preservada; nenhum membro,
   conta, permissão ou remapeamento foi inventado. Precisa de um vínculo auditável
   ou tratamento de ator histórico revisado antes da cópia desses documentos.
2. **Auth contém estados diferentes.** A prévia encontra sete contas Google
   elegíveis para CREATE e 53 conflitos por provedor Google ausente/ambíguo.
   Não importa parcialmente nem atribui Google aos registros sem essa prova.
   Os 60 perfis têm UID exato no path; isso preserva identidade histórica e não
   comprova que todos possam entrar com Google. Um adapter revisado precisará
   tratar os estados existentes mantendo UID e disabled sem criar privilégios.
3. **Projeções e contexto ainda necessários.** Perfis e ACLs permanecem fonte
   autoritativa em FA. A revisão privada registra 60 propostas de lease/permissão
   e 60 propostas de audiência, sem copiar permissions como concessão estática.
   A criação no destino exige sessão/Rules/IAM/broker, contexto fresco de fonte,
   destino, identidade e ACL, além de exclusão de criação concorrente em FB.
4. **Fila e produtores preservados.** Os 40 evaluationRequests (37 READY,
   3 CONFIGURATION_PENDING) ficam em FA, com status/hashes preservados. Não são
   executados, duplicados ou enviados a segundo consumidor. O futuro corte dos
   produtores exige journal, drenagem de pendências e validação humana prevista.

Foram propostos memberIds estáveis derivados exclusivamente de um namespace do
projeto e UID exato, sem nome/e-mail. Ainda são propostas locais, não registros
publicados. UID e autoria dos documentos permanecem iguais. O dry run não prova
ACL atual de Drive/Forms e não retoma os treinamentos cancelados.

## Artefatos privados v1

Todos ficam em `.local-preview/management-split`, ignorada pelo Git. Os quatro
artefatos com dados foram gravados com `wx`, AES-GCM e chave protegida por DPAPI
CurrentUser, sem plaintext em disco; abertura e digest foram conferidos novamente.

| Arquivo | Conteúdo |
| --- | --- |
| `management-split-manifest-v1.dpapi.json` | Classificação completa, hashes, razões, vínculos, dependências e mapa proposto de identidades. |
| `management-split-plan-v1.dpapi.json` | Recibo de bloqueio offline, `readyForReview: false`, zero operações. Não é plano executável nem saída aprovada de migração. |
| `management-split-review-v1.dpapi.json` | Provas de relações, identidade, ACL, projeções/pendências e digests do código de domínio examinado. |
| `management-split-auth-plan-v1.dpapi.json` | Prévia estrutural de Auth bloqueada; zero contas importadas. |
| `management-split-receipt-v1.json` | Resumo somente de contagens, códigos, hashes, horários e nomes de artefatos, sem documentos ou identificadores pessoais. |
| `prepare-private-split-v1.mjs` | Helper local que mantém os snapshots em memória e impede sobrescrever os artefatos v1. Não tem transporte Firebase ou credenciais. |
| `inspect-historical-actor-v1.mjs` | Conferência agregada de autoria ausente, sem imprimir seu UID ou conteúdo de documento. |

Manifesto: `f4ba024145bd4f67a85478cda9e674a9d93180c99d17585b9d32d5a6c98fd242`.
Recibo de plano bloqueado: `bf68da7baf779b3399fbebc078868b4f3c56d08e2b261f6e676d3f3a8bc62359`.
Hash do mapa proposto: `08605dfc5885b8c58cbac9aabdebd6fcca9295ecc1546f502500f4686839b50e`.

Uma correção futura gera outra versão privada, sem substituir v1. A liberação de
um orçamento não resolve estes bloqueios. Os módulos Gestão/Desempenho permanecem
sem ativação por este trabalho; FA, documentos originais, Forms e histórico foram
preservados.