# Prévia local de importação Auth

## Limite da implementação

`scripts/lib/management-auth-import-plan.js` é um planejador puro. Recebe snapshots completos e vínculos explícitos, calcula fingerprints e propõe registros Google ausentes. Não usa SDK, rede, credenciais ou relógio, não importa usuários e não concede permissões. `readTime` validado não certifica frescor operacional nem captura atômica. O modo estrito `STRICT_GOOGLE_ONLY` permanece o padrão; provedores ausentes, senha, provedores adicionais, colisões ou vínculos divergentes continuam conflitos.

Os UIDs FA/FB devem ser iguais. A comparação de e-mail detecta colisões; ela não vincula identidades. Conta equivalente existente resulta em `SKIP`, sem sobrescrita. Um conflito bloqueia todos os `importRecords` selecionados. Campos importáveis seguem a whitelist Google existente; claims, senha e tokens não são importados.

## Opt-in de revisão privada

A assinatura é:

```js
prepareAuthImportPlan(sourceNormalized, destinationNormalized, identityMappings, {
  expectedFingerprints, // opcional; os três pins existentes continuam obrigatórios se informado
  deferUnlinkedSource: true,
  requiredSourceUids: [/* todos os UIDs Auth requeridos por vínculos/atores atuais de COPY */],
  expectedRawSnapshotSha256: authRawSnapshotDigest(sourcePacket.rawUsers),
  unlinkedSourceEvidence: {
    schemaVersion: 1,
    sourceSnapshotSha256: authSnapshotDigest(sourceNormalized),
    rawSnapshotSha256: authRawSnapshotDigest(sourcePacket.rawUsers),
    entries: [{
      faUid: 'uid-preservado',
      sourceRecordSha256: authSourceRecordDigest(normalizedRow),
      rawRecordSha256: authSourceRecordDigest(rawRow),
      providerCount: 0,
      passwordMaterialPresent: false,
      otherProviderIdentityPresent: false,
      disabled: false,
      emailVerified: false
    }]
  }
});
```

Essas opções são entradas de uma revisão privada offline controlada pelo operador. Não devem ser aceitas de navegador, requisição pública, claims ou flags de usuário. A aprovação do planejamento não autoriza um executor de produção.

Os snapshots normalizados omitem senha e outros campos brutos. Portanto, não se pode concluir ausência de credenciais lendo apenas o normalizado. O revisor deve verificar em memória o packet protegido original, relacionar cada `localId` bruto ao UID normalizado, conferir providers, status e todos os campos de senha/identidade, derivar os hashes canônicos e fixar a evidência em artifacts privados. Não se presume Google nem `isAnonymous`; a ausência de `isAnonymous` não fornece essa classificação. Nenhum material de senha deve ser impresso, incluído na prova ou copiado para FB.

`authRawSnapshotDigest` aceita apenas o array `rawUsers` completo e usa o mesmo JSON canônico dos demais digests. Seu hash difere do `plaintextSha256` do envelope de backup, que cobre o packet completo. `authSourceRecordDigest` aceita a linha normalizada ou bruta e retorna apenas SHA256. Os digests não demonstram sozinhos que a revisão foi correta: o planejador não recebe os registros brutos nem prova criptograficamente a associação/ausência de senha. Essa associação e a veracidade dos flags são responsabilidade do revisor privado; o helper apenas verifica estrutura, pins do normalizado, igualdade do pin bruto esperado e coerência da lista. Não são autoridade nem prova de acesso atual.

## Candidatos e conflitos

A lista de evidência deve ser exaustiva aos candidatos do snapshot normalizado: perfil com schema válido, `providerData` explicitamente `[]`, `disabled:false`, `emailVerified:false` e UID fora de `requiredSourceUids`. A lista é calculada antes de analisar destino e colisões, para que nenhum conflito seja escondido pela retirada de sua prova. Os arrays fonte/destino, UIDs requeridos e prova têm limite de 50.000 no opt-in. UIDs requeridos devem ser válidos, únicos e presentes em Auth; a lista explícita é obrigatória mesmo quando vazia.

Somente se a prova inteira for válida um candidato pode resultar em `DEFER_UNLINKED_SOURCE`. O adiamento exige também:

- vínculo membro/FA/FB válido e UID preservado;
- nenhuma colisão de UID/e-mail na fonte;
- nenhum usuário FB sob aquele UID, nenhum e-mail de perfil/provedor FB colidente;
- nenhum campo de senha ou metadata adicional no registro normalizado;
- nenhum conflito real no candidato.

Prova ausente, extra, duplicada, não exaustiva, fields extras, fingerprints incompatíveis, flags incompatíveis ou raw record hash reutilizado bloqueiam a seleção inteira e impedem o adiamento. UID de fonte duplicado torna a prova ambígua. Todo usuário Google real continua sujeito às regras estritas existentes, inclusive colisões e provedores adicionais. Um UID necessário a COPY sem Google verificado permanece conflito.

O chamador deve derivar `requiredSourceUids` de todos os vínculos atuais necessários a COPY. Um autor histórico ausente deve ter contrato histórico separado e preservado; não criar usuário, mapping ou vínculo Google fictício para incluí-lo nessa lista. O helper não recebe documentos COPY e não pode provar que a lista requerida fornecida é completa.

## Resultado

| Campo/ação | Significado |
| --- | --- |
| `identityMappings` | Cópia dos vínculos de schema válido; todos os 60 válidos ficam preservados. Maps inválidos continuam conflitos e seus campos extras não são expostos. |
| `DEFER_UNLINKED_SOURCE` | Sem `importRecord`, conta FB, provider ou permissão. Exige `VERIFIED_GOOGLE_LINK_AND_FRESH_IDENTITY_REVIEW`. |
| `counts.deferUnlinked` | Quantidade de contas efetivamente adiadas. |
| `selectedImportReady` | Subconjunto Google sem conflitos estruturais, apenas proposta offline. |
| `ready` | Falso enquanto houver algum adiado ou conflito. |
| `allSourceUsersReconciled` | Falso enquanto houver adiado ou conflito; quando verdadeiro, refere-se apenas à conciliação estrutural da prévia. |
| `deferredRequiresVerifiedGoogleLink` | Verdadeiro quando há adiados. |
| `selectionPolicy` | Modo, UIDs requeridos, pin raw esperado e digest da prova; escopo `PRIVATE_OFFLINE_REVIEW_ONLY`. |
| `importRecords` | Propostas Google CREATE somente se o subconjunto inteiro não tiver conflitos. Não usar como comando de importação. |

Na situação revisada de sete Google e 53 sem vínculo, são esperados `create:7`, `deferUnlinked:53`, `selectedImportReady:true`, `ready:false`, `allSourceUsersReconciled:false` e 60 mappings. Isso não declara migração concluída nem disponibilidade de login para os 53. O broker atual exige usuário FB pré-existente; não existe importação JIT automática nesse opt-in.

Nenhum consumidor de produção preparado deve disparar importação por `selectedImportReady`. Um executor futuro precisa de contrato/autorizações próprios, nova revisão de fonte/FB, preservação dos pins e exclusão de criação concorrente em FB, além de backups, rollback e conciliação separada das permissões. Capturas antigas não certificam esses gates. Recaptura remota deve respeitar as guardas de orçamento e pausa; este helper não faz leituras remotas.

## Verificação sintética

A suíte `tests/management-auth-import-plan.test.js` exercita o padrão estrito, sete/53 e 60 mappings, candidato requerido, fingerprints, prova incompleta/duplicada/extra, ausência de senha inferida indevidamente, status inválido, colisões, destinos existentes, não mutação, determinismo e ausência de campos privados nos artifacts. Apenas fixtures locais; não demonstra um login/importação real.
