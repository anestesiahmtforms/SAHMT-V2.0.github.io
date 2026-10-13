# Ciência do Checklist — confirmação informativa

O comando “Dar ciência do Checklist” registra a leitura do relatório por qualquer perfil ativo, verificado e previamente autorizado por `checklistSign`. A ação não declara execução das verificações, conformidade dos equipamentos nem assunção de responsabilidade operacional. Ela independe do carregamento do nome do rodízio; exige relatório do dia confirmado no servidor e ausência de gravações locais pendentes.

A declaração é “Declaro que tomei ciência das informações deste relatório.” O recibo pendente usa o ID diário `day_UID`, preserva a revisão visualizada, o nome do perfil, a hora de servidor (`acknowledgedAt`), `recordKind: ACKNOWLEDGEMENT` e a posição informativa do rodízio observada no clique. Rules validam a autoria e os campos permitidos; não concedem privilégios nem gravam pontuação. O validador confere novamente perfil, revisão e rodízio atuais. Se algum deles mudou ou não pôde ser confirmado, conserva a ciência como `NEEDS_REVIEW` sem criar pontos. Quando a validação confiável passa, a transferência diária é idempotente. As coleções e nomes técnicos antigos permanecem para compatibilidade; `signedAt` é apenas um campo temporal legado. Registros históricos não são reclassificados.

O rodízio informativo usa as mesmas fontes Firestore de Eventos: `scheduleDays/{day}`, seus marcadores `highlights.events`, férias ativas e o nome no diretório `eventMembers`. Não consulta planilhas na abertura. O validador de ciência usa esses mesmos marcadores para determinar o indicado na apuração, preservando o resolvedor anterior somente para pedidos legados. A leitura não permite editar posições nem acessar lançamentos completos de Eventos.

## Pontuação mantida

- Ciência do próprio indicado: zero ponto adicional.
- Ciência de outro elegível: +1 para ele e −1 para o indicado.
- O ledger mantém uma única transferência por dia, mesmo com novas revisões.
- A gravação da ciência no Firestore é imediata; pontos só são atribuídos após apuração confiável. Uma revisão ou posição alterada antes da validação permanece auditável e exige revisão; não há pontuação pendente exibida como definitiva.

## Publicação coordenada pendente

Publicar nesta ordem: regras do Firestore, código `ChecklistValidation.gs` no projeto Apps Script e sua validação operacional, então PWA. Não publicar somente o PWA: as regras antigas recusam `recordKind`. O workflow Pages não implanta regras nem Apps Script. A sessão desta alteração não tem conta Firebase autorizada nem autenticação Apps Script, portanto não comprova implantação ou execução do validador em produção. Não ativar Blaze ou Cloud Functions. A rotina de apuração existente depende de IAM e runtime habilitados; esta alteração não reativa a homologação cancelada de Gestão/Desempenho.

Alterações de posições feitas exclusivamente na planilha ainda precisam chegar a `scheduleDays`; usar os dados de Eventos dispensa a planilha no clique, mas não cria publicação automática das edições externas.
