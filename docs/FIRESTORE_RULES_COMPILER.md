# Firestore Rules: falha de compilação/publicação em 2026-10-13

## Correção

A Rules API retornava HTTP 503 em `rulesets.create` para o arquivo completo, embora uma tentativa da CLI passasse pela validação de fonte. Um ruleset mínimo sem release era criado e removido com HTTP 200.

A documentação oficial descreve falhas HTTP 503 do compilador associadas à complexidade de expressões e à duplicação de árvores de escopo: <https://firebase.google.com/docs/rules/rules-language#function>.

Os validadores específicos foram movidos do escopo global para o `match` da coleção que os utiliza. Funções compartilhadas de identidade, perfil e autorização permaneceram globais. Não houve alteração de condições `allow`, caminhos, parâmetros nem corpos das funções nesta reorganização. A comparação lexical confirmou todas as funções e as 190 instruções de acesso; também não encontrou novas capturas de variáveis de caminhos. A fonte local passou de 124 para 29 funções globais, preservando as 124 funções existentes.

Não se tratava de evidência de limite de leituras do Firestore, exigência de billing ou significado da declaração de ciência. A reorganização resolveu a criação do ruleset completo com HTTP 200. Não temos acesso ao diagnóstico interno do compilador para afirmar qual limite interno foi atingido.

## Verificações

- Testes estruturais: 4 aprovados; 2 deles falhavam antes da reorganização.
- Fonte completa local: 85 testes Rules aprovados.
- Integração sintética de ciência no emulador: 1 teste aprovado.
- Artefato restrito da publicação: 84 testes aprovados. O teste de `firstLoginCohort` não integra esse artefato, pois a política correspondente permanece somente na fonte local.
- Validação real: HTTP 200, zero erros; permanecem 11 avisos relacionados aos validadores legados de escala sem uso.
- Criação real dos dois candidatos reorganizados: HTTP 200, sem ativação durante a prova.
- A leitura imediata do release após cada criação retornou HTTP 500; leituras posteriores confirmaram que o release anterior continuava intacto. Não se repetiu nenhuma criação automaticamente.

## Publicação restrita

Publicado apenas no FA (`sahmt-17a16`), mantendo o perfil e a configuração existentes e aplicando o contrato de ciência e as três permissões de leitura do rodízio já preparadas. As mudanças locais de `firstLoginCohort` e obrigatoriedade do campo de configuração `occurrences` não foram incluídas no artefato ativo.

- Release atualizado em `2026-10-13T14:56:17.968760Z`, HTTP 200.
- Ruleset: `9103ed2d-4ccb-43ae-983a-7bedc955e8f1`.
- SHA-256 do conteúdo ativo: `6cdc9d238670b871d56a27393cecf2a46730f52f677fc203926fef073dfd436a`.
- Leitura independente do release, fonte e executável: HTTP 200; conteúdo e ruleset correspondentes.
- Backup local ignorado pelo Git: `.local-preview/checklist-scoped-release/remote/`.
- Reversão: apontar o release `cloud.firestore` ao ruleset anterior `3b1515b7-10d8-4d47-bf40-bdae7aecd314`; não excluir histórico nem documentos.

Os testes não são prova de um usuário ter registrado ciência em produção. Essa confirmação exige a ação real do usuário autenticado após a atualização da PWA.

## Manutenção

Manter validadores de coleção dentro do respectivo `match`. Evitar recolocar dezenas de funções específicas no escopo global. `npm run test:rules` inclui a verificação estrutural. `SAHMT_FIRESTORE_RULES_FILE` permite testar o artefato exato de uma publicação restrita nas três suítes de Rules, sem substituir a fonte local.
