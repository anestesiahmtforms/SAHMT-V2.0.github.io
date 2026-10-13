# Importação fechada das identidades Google de Gestão

## Objetivo autorizado

Avançar a migração para FB preservando o UID de cada conta Google já revisada. A importação de identidade fica separada de direitos e da ativação do app. O destino continua com Rules deny-all; FA não é alterado. Os 53 registros sem vínculo Google continuam adiados, sem criação de conta fictícia.

## Execução concreta

Um núcleo puro recompõe o plano com prepareAuthImportPlan e os snapshots, mappings e prova privada pinados. Apenas propostas CREATE Google sem conflito são importáveis. O request REST accounts:batchCreate usa sanityCheck:true e allowOverwrite:false, preservando UID, vínculo Google e campos da whitelist, sem senha, claims ou tokens. A API é parcial: erros por índice e resultado de transporte incerto exigem conferência posterior e retenção da intenção; nunca se afirma atomicidade nem se repete a gravação automaticamente.

O helper privado verifica os registros Google atuais FA e todos os usuários atuais FB antes da escrita, recompõe o plano e recusa qualquer alteração de identidade, status ou conflito. Essas consultas são de Authentication, sem Firestore. Owner, principal, região, billing-off e Rules fechadas de FB são conferidos por metadados. A autorização humana permanece no horário original, sem janela adicional de aprovação. A intenção completa e respostas privadas ficam em DPAPI; não são impressos e-mails, UIDs, tokens ou registros. Uma única importação limitada é conferida por export Auth FB posterior.

A conferência exige todos os selecionados com UID e vínculo exatos e preserva todo usuário pré-existente FB. A ausência de erro HTTP não prova importação completa. Resultado parcial ou incerto preserva checkpoints e impede novo envio. Login da PWA, grants, broker e sessão real permanecem desligados. Não há exclusões, rollback automático, mudança de FA, faturamento ou compra de serviços.

## Referências técnicas

- API REST: https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/batchCreate
- Imports Admin e riscos de colisão: https://firebase.google.com/docs/auth/admin/import-users

## Validação

Testes locais já autorizados para a migração: tradução whitelist, preservação de UID/provider, rejeição de senha/claims/body extras, plano/hash alterado, colisões, índice duplicado/fora do lote, resposta parcial/incerta e conferência pós-importação. Revisão independente antes da execução real.
