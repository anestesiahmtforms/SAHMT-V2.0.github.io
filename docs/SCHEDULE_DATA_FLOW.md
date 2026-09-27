# Fonte e sincronização de escala e férias

## Decisão de arquitetura

A planilha nativa [`ESCALA/FÉRIAS 2026`](https://docs.google.com/spreadsheets/d/1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM/edit) é a referência editável e de planejamento. O Firestore continua servindo os dados ao PWA para manter leitura rápida em Android/iOS, autenticação e autorização no modelo V2. O fluxo será unidirecional: planilha → validação → Firestore. O PWA não deve ler a planilha a cada abertura, nem usar o PDF como entrada.

A planilha foi consultada sem edição em 27/09/2026. A leitura delimitada encontrou:

- Aba `ESCALA`: 307 datas distintas e 17 posições (`pos1`–`pos17`), mais o campo de marcações. As linhas de escala ocupam as colunas `J:AB`; metadados/auditoria da planilha ficam nas outras colunas.
- Aba `FÉRIAS`: 52 períodos com início, fim, siglas e rótulo (`J:M`).
- A planilha está em `pt_BR` e usa o fuso `America/Sao_Paulo`. A última modificação informada pelo Drive foi 27/09/2026 às 13:17 UTC.

## Modelo operacional

- `scheduleDays/{YYYY-MM-DD}` contém as posições ordenadas e as marcações usadas pela Home e por Eventos. Existem 307 documentos da migração da aba `ESCALA` V1. Comparação somente de leitura em 27/09 confirmou as mesmas 307 datas e as mesmas posições em todos os documentos; 10 datas têm marcações `highlights.siglas` diferentes da planilha. Nenhuma data está ausente ou sobrando.
- `vacations/{id}` contém um período, uma lista de siglas e estado ativo. A última consulta documentada encontrou zero documentos; os 52 períodos da planilha não foram copiados para Firestore.
- Datas são normalizadas para `YYYY-MM-DD`; as chaves por data permitem continuar a grade no ano seguinte sem substituir o histórico. As siglas compostas da escala são preservadas como estão nas posições; férias são listas explícitas de siglas.
- Não importar metadados pessoais/auditáveis da planilha (`actorEmail`, `actorName`, UIDs, deviceId etc.) para os documentos operacionais, salvo decisão de produto e necessidade comprovada.

## Fluxo de publicação pretendido

1. A equipe edita os dados nas abas `ESCALA` e `FÉRIAS`; a planilha não fica pública.
2. O conector valida datas reais, linhas duplicadas, posições, siglas, intervalos e tamanho. Mudanças, itens iguais, inválidos e possíveis remoções aparecem numa prévia, sem escrita inicial.
3. A publicação é idempotente e versionada. Só altera/cria os documentos correspondentes às linhas aprovadas. Linhas ausentes não apagam documentos; cancelamentos requerem ação explícita.
4. Depois da escrita, o conector relê o Firestore e informa o resultado. O PWA continua lendo apenas `scheduleDays` e `vacations`.

## Situação e limites

- A planilha foi lida em modo somente leitura; nenhum valor foi modificado. A comparação foi feita com os campos operacionais, sem copiar os dados para arquivo versionado.
- O PDF anexado anteriormente nunca foi importado nem armazenado no Firestore; `vacations` estava vazia na consulta registrada. O PDF está fora do processo daqui em diante e não será publicado no repositório.
- Ainda não há sincronização automática da planilha com o Firestore. Editar a planilha, por si só, não atualiza o PWA. O conector e sua autorização precisam ser implementados/homologados antes de prometer atualização em tempo real.
- As 52 linhas `FÉRIAS` não estão no Firestore: 51 têm datas e siglas explícitas; a linha 48, 23–29/11/2026, está rotulada `CONGRESSO` e não tem siglas, portanto não é publicada como férias sem classificação.
- O editor existente de escala no PWA grava no Firestore diretamente; antes de usar a planilha como fonte oficial contínua, esse caminho precisa ser alinhado ao mesmo fluxo para evitar divergência.
- Nenhuma carga ou alteração do Firestore foi feita a partir desta planilha.

## Próximos passos

1. Revisar as marcações divergentes nas 10 datas encontradas e decidir como classificar a linha `CONGRESSO`.
2. Fechar o desenho de publicação planilha → Firestore, com autorização restrita, prévia, detecção de concorrência e confirmação.
3. Implementar e homologar o conector antes da primeira carga de férias ou de uma rotina de atualização contínua.
