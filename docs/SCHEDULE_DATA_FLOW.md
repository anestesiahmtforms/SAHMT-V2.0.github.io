# Fonte e sincronização de escala e férias

## Decisão de arquitetura

A planilha nativa [`ESCALA/FÉRIAS 2026`](https://docs.google.com/spreadsheets/d/1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM/edit) é a referência editável e de planejamento. O Firestore continua servindo os dados ao PWA para manter leitura rápida em Android/iOS, autenticação e autorização no modelo V2. O fluxo será unidirecional: planilha → validação → Firestore. O PWA não deve ler a planilha a cada abertura, nem usar o PDF como entrada.

A leitura somente de cabeçalhos em 27/09/2026 confirmou a cópia compacta na planilha oficial:

- Aba `ESCALA`, colunas A:R: `date`, `pos1`–`pos17`. A primeira linha de dados foi lida e contém data e siglas nas posições esperadas.
- Aba `FÉRIAS`, colunas A:D: `start`, `end`, `siglas`, `label`. As células `siglas` são listas JSON de texto, por exemplo `["LC","RA"]`; períodos sem siglas usam `[]`.
- Os metadados da planilha indicam título `ESCALA/FÉRIAS 2026`, idioma `pt_BR` e fuso `America/Sao_Paulo`.

O Apps Script localiza os cabeçalhos pelo nome e não depende de letras/posições fixas de coluna. Datas vazias da escala permanecem sem registro; em férias, listas vazias são ignoradas e mostradas na prévia para classificação. O leitor foi ajustado para interpretar as listas JSON observadas e continua aceitando listas simples separadas por vírgula ou ponto e vírgula.

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

- A planilha foi lida em modo somente leitura; nenhum valor foi modificado. Nesta conferência, foram lidos os metadados, cabeçalhos e amostras limitadas das abas; os dados completos não foram copiados para arquivo versionado.
- O PDF anexado anteriormente nunca foi importado nem armazenado no Firestore; `vacations` estava vazia na consulta registrada. O PDF está fora do processo daqui em diante e não será publicado no repositório.
- O conector Apps Script está implementado como publicação manual em duas etapas, sem gatilho: prévia e publicação explícita. O código foi enviado ao projeto Apps Script em 27/09/2026. Exige e-mail em `SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS`, planilha privada, autorização IAM, nova prévia após qualquer alteração e validação pós-escrita. Essas propriedades/permissões e a homologação ainda precisam ser concluídas. Editar a planilha, por si só, não atualiza o PWA.
- A consulta de Firestore registrada anteriormente encontrou zero documentos em `vacations`; a cópia compacta da aba `FÉRIAS` tem 52 linhas de dados. A linha 48, 23–29/11/2026, guarda `[]` e rótulo `CONGRESSO`, portanto não é publicada como férias sem classificação.
- O editor direto de posições foi removido da Home e das Rules do cliente. Perfis `scheduleWrite` ainda liberam siglas no cartão de contato, mas não criam/alteram posições; novas posições entram pela publicação manual da planilha via IAM Apps Script.
- Nenhuma carga ou alteração do Firestore foi feita a partir desta planilha.

## Próximos passos

1. Revisar a prévia de publicação contra o Firestore, confirmando o tratamento de `CONGRESSO` e as 51 férias com siglas.
2. Fechar IAM e allowlist da conta executora; manter o sincronizador desativado até revisar o alcance do papel no projeto.
3. Executar primeiro a prévia manual; publicar somente após conferir contagens e mudanças, e validar por releitura do Firestore.
