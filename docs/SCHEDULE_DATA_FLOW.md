# Fonte e sincronização de escala e férias

## Decisão de arquitetura

A planilha nativa [`ESCALA/FÉRIAS 2026`](https://docs.google.com/spreadsheets/d/1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM/edit) é a referência editável e de planejamento. O Firestore continua servindo os dados ao PWA para manter leitura rápida em Android/iOS, autenticação e autorização no modelo V2. O fluxo será unidirecional: planilha → validação → Firestore. O PWA não deve ler a planilha a cada abertura, nem usar o PDF como entrada.

A nova leitura somente de metadados e da aba `FÉRIAS` em 27/09/2026 confirmou que a estrutura compacta foi substituída por uma grade de apresentação mensal:

- Aba `ESCALA` continua com `date` e `pos1`–`pos17`.
- Aba `FÉRIAS` agora apresenta doze meses em dois blocos paralelos. Cada bloco usa `SEMANA`, `PERÍODO` e até cinco colunas `SIGLA`; o título informa o ano (`2026`). Os intervalos são texto, por exemplo `31 A 06/09`, e a semana de 23–29/11 usa `CONGRESSO` sem siglas.
- A grade lida contém 52 períodos: 51 com siglas e um `CONGRESSO`. Os 51 intervalos com siglas são períodos únicos de sete dias, não se sobrepõem e cobrem 05/01/2026 a 03/01/2027. Não foram encontrados erros de formato nas siglas ou datas. Em 27/09, o proprietário confirmou que a inclusão de `BA` em 23–29/03 procede e que a semana `CONGRESSO` não tem férias por contingência; as 51 linhas com siglas estão aprovadas para a prévia.
- A comparação com o snapshot privado anterior encontrou 51 intervalos correspondentes. Na semana 23–29/03/2026, a grade atual acrescenta `BA` à sigla `WE`; os outros 50 intervalos correspondentes mantêm o mesmo conjunto de siglas. Quatro rótulos mudaram junto com as anotações de apresentação; o `CONGRESSO` segue fora da publicação.
- Os metadados da planilha indicam título `ESCALA/FÉRIAS 2026`, idioma `pt_BR` e fuso `America/Sao_Paulo`.

O leitor Apps Script aceita a grade mensal atual e o formato tabular normalizado anterior. Na grade, remove da sigla somente a anotação terminal entre parênteses, preserva a anotação no rótulo, interpreta datas que atravessam mês/ano e mantém a semana `CONGRESSO` na lista de exceções da prévia, sem publicá-la como férias.

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
- O conector Apps Script é uma publicação manual em duas etapas, sem gatilho: prévia e publicação explícita. Em 27/09, `userinfo.email` foi incluído no manifesto e enviado ao projeto; após configurar `SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS`, a prévia real leu 307 dias, 51 férias e excluiu `CONGRESSO`, sem gravar no Firestore. Ela propôs atualizar os 307 dias e criar 51 férias. A leitura do destino encontrou 307/307 documentos com posições equivalentes à última fonte capturada; o comparador antigo dependia de `JSON.stringify` de mapas REST, cuja ordem das propriedades não é contratual. A comparação foi corrigida para verificar os pares ordenados posição/sigla e enviada ao Apps Script às 12:51; o script também vincula a publicação a uma impressão digital do estado-alvo, para abortar se o Firestore mudar depois da prévia. Essa proteção foi enviada ao projeto às 12:58. As prévias antigas não devem ser publicadas. Gere outra após a última sincronização e confirme zero atualizações de escala e 51 criações de férias antes de publicar. A rotina ainda depende de IAM Firestore e verificação após a escrita. Editar a planilha, por si só, não atualiza o PWA.
- A estrutura atual da aba `FÉRIAS` não foi publicada no Firestore. A consulta anterior de `vacations` encontrou zero documentos; as 51 linhas com siglas aprovadas aguardam a nova prévia após a correção do comparador de escala.
- O editor direto de posições foi removido da Home e das Rules do cliente. Perfis `scheduleWrite` ainda liberam siglas no cartão de contato, mas não criam/alteram posições; novas posições entram pela publicação manual da planilha via IAM Apps Script.
- Nenhuma carga ou alteração do Firestore foi feita a partir desta planilha.

## Próximos passos

1. Corrigir/autorizar a identidade OAuth do Apps Script API no mesmo projeto Cloud usado pelo script e revisar IAM e allowlist.
2. Executar nova prévia com a correção já sincronizada; confirmar `unchangedScheduleDays: 307`, `updateScheduleDays: 0`, `createVacations: 51` e `CONGRESSO` fora do conjunto de escrita.
3. Publicar somente após conferir a prévia e validar todos os documentos pela releitura do Firestore.
