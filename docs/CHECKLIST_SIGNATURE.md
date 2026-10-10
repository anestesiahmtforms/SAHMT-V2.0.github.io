# Ciência do Checklist — alteração preparada em 10/10/2026

O comando “Dar ciência do Checklist” registra a leitura do relatório por qualquer perfil ativo, verificado e previamente autorizado por `checklistSign`. A ação não declara execução das verificações, conformidade dos equipamentos nem assunção de responsabilidade operacional. Ela independe do carregamento do nome do rodízio; exige relatório do dia confirmado no servidor e ausência de gravações locais pendentes.

A declaração é “Declaro que tomei ciência das informações deste relatório.” O recibo imutável identifica o UID autenticado, a revisão visualizada, a data de servidor (`requestedAt`) e `recordKind: ACKNOWLEDGEMENT`. O validador acrescenta nome, email e `acknowledgedAt`. As coleções e nomes técnicos antigos são preservados para compatibilidade; `signedAt` permanece como campo temporal legado, sem mudar a natureza da ciência. Registros antigos não são reclassificados.

O rodízio informativo usa as mesmas fontes Firestore de Eventos: `scheduleDays/{day}`, seus marcadores `highlights.events`, férias ativas e o nome no diretório `eventMembers`. Não consulta planilhas na abertura. O validador de ciência usa esses mesmos marcadores para determinar o indicado na apuração, preservando o resolvedor anterior somente para pedidos legados. A leitura não permite editar posições nem acessar lançamentos completos de Eventos.

## Pontuação mantida

- Ciência do próprio indicado: zero ponto adicional.
- Ciência de outro elegível: +1 para ele e −1 para o indicado.
- O ledger mantém uma única transferência por dia, mesmo com novas revisões.
- A gravação da ciência no Firestore é imediata; pontos só são definitivos após apuração confiável. Uma revisão alterada antes da validação permanece auditável e exige nova conferência; a interface não promete pontos pendentes.

## Publicação coordenada pendente

Publicar nesta ordem: regras do Firestore, código `ChecklistValidation.gs` no projeto Apps Script e sua validação operacional, então PWA. Não publicar somente o PWA: as regras antigas recusam `recordKind`. O workflow Pages não implanta regras nem Apps Script. A sessão desta alteração não tem conta Firebase autorizada nem autenticação Apps Script, portanto não comprova implantação ou execução do validador em produção. Não ativar Blaze ou Cloud Functions. A rotina de apuração existente depende de IAM e runtime habilitados; esta alteração não reativa a homologação cancelada de Gestão/Desempenho.

Alterações de posições feitas exclusivamente na planilha ainda precisam chegar a `scheduleDays`; usar os dados de Eventos dispensa a planilha no clique, mas não cria publicação automática das edições externas.
