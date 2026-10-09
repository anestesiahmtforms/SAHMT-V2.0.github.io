# Autoria histórica na separação de Gestão — contrato v1

## Escopo

O planner local `scripts/lib/management-split-plan.js` aceita uma exceção explícita para preservar a autoria de documentos cujo UID original não tem identidade corrente resolvida. A exceção não identifica uma pessoa, não cria usuário Auth, membro, vínculo de acesso, lease, crédito ou projeção de perfil. O UID continua sendo a atribuição original opaca da origem FA.

Este adapter é exclusivamente uma preparação offline. Não acessa credenciais, APIs, banco ou diretórios atuais e não autoriza a aplicação do plano. A classificação, snapshots, proveniência e demais gates do planner continuam necessários. O manifesto e plano privados v1 permanecem preservados; qualquer reavaliação deve produzir artefatos v2 separados.

## Representação explícita no manifesto

`historicalAttributions` é opcional. Quando ausente, o contrato legado permanece igual; quando presente, deve ser um array. Um array vazio não libera UIDs desconhecidos. Cada registro exige exatamente as seguintes chaves:

```json
{
  "path": "documents/document-demo",
  "sourceSha256": "HASH_DO_DOCUMENTO_ORIGINAL",
  "field": "createdByUid",
  "sourceUid": "uid-archived-demo",
  "actor": {
    "sourceProjectId": "sahmt-17a16",
    "sourceUid": "uid-archived-demo",
    "status": "ARCHIVED_UNRESOLVED",
    "active": false,
    "access": false,
    "memberId": null
  }
}
```

O exemplo é sintético. `sourceSha256` real deve ser exatamente `documentDigest` do registro tipado inteiro da captura original, incluindo caminho e tempos da origem. O próprio backup continua pinado por `backupSha256`; a entrada de classificação também deve conter o hash correto. Os valores do exemplo não são uma identidade ou um hash reais.

`actor` é metadado arquivado do manifesto. `ARCHIVED_UNRESOLVED` indica que o plano não resolveu uma identidade corrente; não comprova exclusão do usuário nem revogação de sua conta histórica. `active: false`, `access: false` e `memberId: null` impedem representá-lo neste contrato como membro ativo ou como autorização. Nenhuma destas propriedades é transformada em grants de Auth ou Rules.

## Critérios de aceitação

Todos devem ser verdadeiros:

- Caminho existente na captura original, com exatamente duas partes, em `documents/{id}` ou `scopedDocuments/{id}`.
- Campo top-level exatamente `createdByUid` ou `updatedByUid`.
- Campo presente na origem, tipado como `stringValue`, com o mesmo UID não vazio de `sourceUid` e `actor.sourceUid`.
- Hash exato do documento original e `actor.sourceProjectId` igual ao projeto de origem validado, FA `sahmt-17a16`.
- UID ausente de `identityMappings`. Um UID já mapeado não pode receber classificação histórica paralela.
- Registro e ator com todas as chaves exigidas e nenhuma chave extra; ator sem atividade, acesso ou membro.
- Par caminho/campo único. Dois campos do mesmo documento, ou o mesmo UID em dois documentos, exigem registros separados.
- Cada registro consumido precisamente pela verificação de autoria top-level de uma entrada `COPY`. Entradas `KEEP_FA` não consomem a exceção.

O adapter rejeita registros extras não consumidos, duplicados, campos ausentes ou divergentes, hash divergente, caminho não permitido e UIDs já mapeados. Objetos inválidos, com chaves adicionais ou propriedades não enumeráveis/getters são recusados; os registros precisam de propriedades de dados compatíveis com JSON. Não há correspondência por e-mail, nome ou similaridade.

## Limites da exceção

A exceção não se aplica a campos aninhados, subcoleções, arrays de UIDs ou aliases `createdBy` / `updatedBy`. UIDs desconhecidos em `uid`, beneficiário, gestor, responsável, aprovador, participante e outros campos reconhecidos pela validação original continuam gerando `UID_NOT_MAPPED`, mesmo que o mesmo UID tenha uma autoria histórica aceita em outro campo.

Atribuição histórica não entra em `identityMappings`, não resolve elegibilidade e não pode ser usada como titular de benefício, responsável corrente, gestor designado ou aprovador. Consumidores de autenticação e autorização devem continuar usando a projeção canônica de membro e o lease corrente, nunca a mera presença de um UID na autoria de um documento.

## Resultado e preservação

Os campos tipados, IDs e UID original permanecem inalterados nas operações propostas. O adapter não modifica o snapshot ou o manifesto recebido. A proveniência já existente preserva projeto, caminho, hash e tempos originais; o `manifestSha256` do plano também vincula os metadados arquivados.

Não é criado registro adicional em `users`, Auth, diretório de membros, ledger ou leases. A repetição de uma cópia idêntica continua exigindo o mesmo conteúdo e proveniência verificada; não cria novo crédito ou nova identidade. O planner permanece `OFFLINE_DRY_RUN`, com `productionAuthorized: false`.

## Verificação local

A suite `tests/management-split-plan.test.js` inclui casos sintéticos de aceitação nas duas coleções, preservação e determinismo, compatibilidade sem o campo opcional, rejeição de esquema/hash/UID/caminho/campo, registros duplicados ou não consumidos, funções correntes e autoria aninhada ainda bloqueadas, além de reexecução com proveniência.

A suite não valida acesso de participante real, permissões Drive/Form, importação Auth, aplicação cloud, estado atual de perfis ou associação do ator a uma pessoa. Esses gates continuam independentes da preservação histórica.
