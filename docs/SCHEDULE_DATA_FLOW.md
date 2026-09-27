# Fonte e sincronização de escala e férias

## Decisão de arquitetura

A planilha nativa [`ESCALA/FÉRIAS 2026`](https://docs.google.com/spreadsheets/d/1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM/edit) é a referência editável e de planejamento. O Firestore continua servindo os dados ao PWA para manter leitura rápida em Android/iOS, autenticação e autorização no modelo V2. O fluxo será unidirecional: planilha → validação → Firestore. O PWA não deve ler a planilha a cada abertura, nem usar o PDF como entrada.

A planilha foi consultada sem edição em 27/09/2026. A leitura delimitada encontrou o estado anterior à cópia compacta:

- Aba `ESCALA`: 307 datas distintas e 17 posições (`pos1`–`pos17`), mais o campo de marcações. As linhas de escala ocupam as colunas `J:AB`; metadados/auditoria da planilha ficam nas outras colunas.
- Aba `FÉRIAS`: 52 períodos com início, fim, siglas e rótulo (`J:M`).
- A planilha está em `pt_BR` e usa o fuso `America/Sao_Paulo`. A última modificação informada pelo Drive foi 27/09/2026 às 13:17 UTC.

O formato de trabalho aprovado para a cópia compacta é uma linha de cabeçalho e dados abaixo dela: `ESCALA` com `date`, `pos1`–`pos17`; `FÉRIAS` com `start`, `end`, `siglas`, `label`. Colunas auxiliares e auditoria não fazem parte do contrato. O conector localiza os cabeçalhos pelo nome e não depende de letras/posições fixas de coluna. Datas vazias da escala permanecem sem registro; em férias, períodos sem siglas são ignorados e mostrados na prévia para classificação.

## Modelo operacional

- `scheduleDays/{YYYY-MM-DD}` contém as posições ordenadas e os destaques usados pela Home e por Eventos. Existem 307 documentos da migração da aba `ESCALA` V1. Comparação somente de leitura em 27/09 confirmou as mesmas 307 datas, posições e marcações em todos os documentos; nenhuma data está ausente ou sobrando. Na nova fonte compacta, férias vêm da aba `FÉRIAS`; destaques de liberação e eventos existentes no Firestore são preservados durante atualizações de posições.
- `vacations/{id}` contém um período, uma lista de siglas e estado ativo. A última consulta documentada encontrou zero documentos; os 52 períodos da planilha não foram copiados para Firestore.
- Datas são normalizadas para `YYYY-MM-DD`; as chaves por data permitem continuar a grade no ano seguinte sem substituir o histórico. As siglas compostas da escala são preservadas como estão nas posições; férias são listas explícitas de siglas.
- Não importar metadados pessoais/auditáveis da planilha (`actorEmail`, `actorName`, UIDs, deviceId etc.) para os documentos operacionais, salvo decisão de produto e necessidade comprovada.

## Fluxo de publicação pretendido

1. A equipe edita os dados nas abas `ESCALA` e `FÉRIAS`; a planilha não fica pública. Cabeçalhos seguem os contratos compactos acima.
2. `ScheduleSourceSync.gs` lê os cabeçalhos por nome, valida datas reais, duplicatas, posições, siglas e intervalos. Lê `scheduleDays` e `vacations` com projeção de campos e paginação. `previewScheduleSourceToFirestore` compara mudanças sem alterar a planilha ou o Firestore.
3. A publicação é idempotente e versionada. Só altera/cria os documentos correspondentes às linhas aprovadas. Dias de escala ausentes não são apagados. Férias criadas pelo conector e removidas da aba são desativadas (sem exclusão física), com IDs listados na prévia.
4. Depois da escrita, o conector relê o Firestore e informa o resultado. O PWA continua lendo apenas `scheduleDays` e `vacations`.

## Situação e limites

- A planilha foi lida em modo somente leitura; nenhum valor foi modificado. A comparação foi feita com os campos operacionais, sem copiar os dados para arquivo versionado.
- O PDF anexado anteriormente nunca foi importado nem armazenado no Firestore; `vacations` estava vazia na consulta registrada. O PDF está fora do processo daqui em diante e não será publicado no repositório.
- O conector Apps Script está implementado como publicação manual em duas etapas, sem gatilho: prévia e publicação explícita. O código foi enviado ao projeto Apps Script em 27/09/2026. Exige e-mail em `SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS`, planilha privada, autorização IAM, nova prévia após qualquer alteração e validação pós-escrita. Essas propriedades/permissões e a homologação ainda precisam ser concluídas. Editar a planilha, por si só, não atualiza o PWA.
- As 52 linhas `FÉRIAS` não estão no Firestore: 51 têm datas e siglas explícitas; a linha 48, 23–29/11/2026, está rotulada `CONGRESSO` e não tem siglas, portanto não é publicada como férias sem classificação.
- O editor direto de posições foi removido da Home e das Rules do cliente. Perfis `scheduleWrite` ainda liberam siglas no cartão de contato, mas não criam/alteram posições; novas posições entram pela publicação manual da planilha via IAM Apps Script.
- Nenhuma carga ou alteração do Firestore foi feita a partir desta planilha.

## Próximos passos

1. Decidir como classificar a linha `CONGRESSO` sem siglas (23–29/11/2026); ela não deve entrar como férias.
2. Fechar o desenho de publicação planilha → Firestore, com autorização restrita, prévia, detecção de concorrência e confirmação.
3. Implementar e homologar o conector antes da primeira carga de férias ou de uma rotina de atualização contínua.
