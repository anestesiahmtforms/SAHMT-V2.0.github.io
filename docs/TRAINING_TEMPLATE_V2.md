# Padronização dos formulários de treinamentos

Modelo aprovado: link de resposta terminado em `1FAIpQLSfAOV83k80v9cqwCynyj4eTZcgKYZIh0gOR53Coo_FZiXEIjg/viewform`.

## Evidência de origem

- Auditoria de 16/10/2026: 76 formulários inspecionados, sem falhas.
- Conferência posterior: nenhum dos 76 possuía respostas. Isso é revalidado após fechar cada formulário e antes de alterar perguntas.
- Planejador preserva as 986 questões pontuadas, seus IDs, gabaritos, pesos e ordem relativa. Não copia as questões do modelo para outras matérias.
- Participante recebe três seções: ciência, avaliação e sugestão em texto único. A revisão do gestor fica exclusivamente no app.
- IDs dos formulários, seus vínculos de resposta, matéria, versão de crédito, públicos, gestor e permissões são preservados. A versão técnica da configuração avança para atualizar os IDs dos campos auxiliares.

## Execução

No projeto operacional da integração, executar uma vez `iniciarPadronizacaoTreinamentosGestaoV2`, do arquivo `TrainingTemplateMigration.gs`.

A função inicia um trabalho finito com continuação temporária a cada minuto. O acionador é removido ao concluir ou falhar. Acionadores antigos de preparação dos mesmos treinamentos são registrados na cópia de recuperação e interrompidos para não reconstruir o modelo anterior. Acionadores de Checklist, avaliação e planilhas não são removidos.

Cada formulário é fechado antes da conferência final. Recebimento de uma resposta, alteração concorrente, falha de banco ou divergência interrompe o trabalho. O formulário afetado permanece fechado. Só é restabelecido o recebimento que já existia, com configuração READY. Nenhum formulário fechado passa a ser publicado por essa migração.

`trainingTemplateMigrations/{formId}` é um recibo privado, vinculado ao manifesto e aos fingerprints dos itens. Ele permite ao verificador de publicação reconhecer o novo layout sem abandonar a validação de identidade, matéria, pontuação e fonte. Não há regra de acesso nova para clientes.

## Recuperação

O registro inicial contém `privateRecoveryUrl`, com estado, metadados anteriores completos, configuração, atividade e disponibilidade anterior de cada formulário. Os relatórios de origem também permanecem privados no Drive. Os originais dos materiais não são editados.

Em falha, o acionador do trabalho para. Antes de restaurar um formulário, conferir novamente se existem respostas e se houve edição posterior. Não apagar respostas nem reaplicar cegamente pedidos de criação. Se houver respostas novas, manter o histórico e tratar a recuperação como nova versão preservando o formulário anterior. Caso contrário, reconstruir os itens pelos IDs e pela ordem da cópia anterior, restaurar configurações com pré-condição de versão e somente então restabelecer a disponibilidade anterior. Preservar timestamps ao restaurar o banco; JSON de recuperação não deve ser enviado diretamente como dados de perfil.

Não reativar os preparadores antigos: seus contratos de 14 campos auxiliares são do modelo anterior. Publicações posteriores usam os recibos confirmados do novo modelo.

## Limites

Os dados reais e os gabaritos dos relatórios e planos ficam fora do Git. A atualização do código Apps Script não executa a migração nem cria um novo Web App. O suporte visual ao texto único da sugestão está preparado localmente no PWA e requer sua publicação separada; o cliente anterior ainda mostra o texto no campo Proposta.

## Resultado real de 16/10/2026

- Trabalho encerrado com estado `COMPLETED`, 76 de 76 formulários únicos `CONFIRMED`.
- Comparação dos metadados anteriores e posteriores: 986 questões pontuadas antes e depois, sem diferenças nos itens pontuados (IDs, alternativas, gabaritos, pesos e ordem).
- Todos os 76 formulários terminaram com duas quebras de página, correspondentes a três seções para participantes.
- Nenhum campo com marcador de revisão pelo gestor permaneceu nos formulários resultantes.
- Havia 40 configurações anteriores, das quais 36 READY; outros 36 formulários não tinham configuração. Padronização não cria configuração nem liberação onde ela não existia.
- A cópia privada de recuperação contém os estados anteriores e os metadados de leitura após cada alteração. O estado COMPLETED é gravado após a rotina de remoção do acionador temporário; não foi feita uma consulta independente ao inventário de acionadores.
- Nenhuma publicação do PWA ou nova versão do Web App foi realizada nesta execução.
