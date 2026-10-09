# Rodízio da escala no Relatório diário

## Regra solicitada

O relatório mostra a primeira pessoa disponível da escala do dia. A busca começa na posição 1; se a pessoa estiver de férias ou tiver evento destacado, passa à próxima disponível, preservando a ordem das posições e os aliases já usados pela Escala.

A indicação recebe o título Rodízio da escala e aparece separada do botão Confirmação do Checklist. Não identifica responsável legal nem concede assinatura, permissões ou pontos. O estado informativo não alimenta checklistResponsibilityLive, checklistResponsibilities ou o validador operacional existente.

## Leitura direta no app

- Um documento scheduleDays/{dia}, com posições e highlights.events.
- Férias ativas que abrangem o dia, com limite de 101 documentos para detectar conjunto maior que 100.
- Somente eventMembers/{sigla} da pessoa selecionada, para obter o nome do diretório mínimo. O cadastro é atualizado junto aos contatos, sem ler telefones, e-mails ou perfis no relatório.

Não consulta events completos nem contacts. Destaques de liberação em highlights.siglas não excluem alguém do rodízio. Marcadores de evento atuais identificam o membro; marcadores antigos identificam a sigla ou grupo destacado. SUPORTE não identifica pessoa da escala.

A leitura acompanha alterações nas fontes. Uma troca de sigla descarta imediatamente o nome anterior. Dados locais ainda não confirmados recebem a indicação aguardando atualização; erro, fonte incompleta ou marcação inválida impedem apresentar um nome como atual. Os listeners são encerrados ao fechar, mudar a data ou trocar a sessão.

## Implantação

A proposta do PR #29 foi simplificada após a instrução de 9 de outubro de 2026. O cálculo informativo é realizado no cliente: não depende de Apps Script, Monitoring, gatilho nativo ou faturamento. Nenhuma ativação nativa deve ser executada para essa indicação.

A interface permanece em preparação até a confirmação da publicação. A leitura utiliza as permissões já existentes de Escala, férias e diretório de nomes. A indicação é carregada para administradores e usuários comuns, independentemente de checklistSign. Este PR não altera Rules nem perfis; as contas precisam ter leitura dessas fontes. O snapshot local histórico de 9 de outubro às 01:04:07Z tinha dois leitores de Checklist e ambos já possuíam essas leituras; isso não constitui conferência atual de permissões ou uso autenticado por pessoa real.

O cache da proposta é sahmt-v2-shell-v184. Código publicado, Rules publicadas e uso autenticado por pessoa real são evidências distintas. Não foram adicionados nem executados testes locais.
