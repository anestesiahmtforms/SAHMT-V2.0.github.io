# Fonte e atualização da escala e das férias

## Direção recomendada — aguarda validação do PDF

O Firestore é a fonte operacional única consultada pelo SAHMT V2. A planilha V1 não é uma dependência de execução, destino de sincronização ou arquivo de backup adicional do V2. A V1 permanece sem alterações; o fluxo de atualização proposto usa o PDF offline que a equipe já mantém, sem criar outra planilha.

As coleções continuam distintas porque representam registros diferentes, embora consulta, edição e importação pertençam à mesma área Escala no PWA:

- `scheduleDays/{YYYY-MM-DD}` guarda as posições e marcações de cada dia. Os 307 dias de escala V1 existentes em 2026 já foram carregados nesta coleção. Uma futura grade de gestão semanal poderá editar vários documentos diários de uma só vez; ela não criará uma segunda fonte de escala.
- `vacations/{id}` guarda um período por documento, com início, fim, siglas, rótulo e estado ativo. A Home consulta os períodos que cobrem a data e destaca as siglas coincidentes.

## Fluxo proposto para o PDF offline

1. Uma pessoa autorizada a editar escala seleciona o PDF atualizado na tela integrada de Escala. O arquivo é lido localmente no navegador; não é armazenado no Firestore nem enviado para uma nova planilha.
2. O importador extrai dias, posições, períodos de férias e siglas. Se o PDF for imagem, OCR pode auxiliar a extração, mas o resultado não é considerado correto sem validação humana.
3. Antes de gravar, o PWA mostra uma prévia comparando o conteúdo extraído ao Firestore: novos, alterados, iguais, inválidos e ausentes. Datas, ordem das posições, siglas e intervalos precisam passar pelas validações do domínio.
4. O usuário confirma as alterações propostas. Itens ausentes no PDF não são apagados nem desativados automaticamente; cada possível cancelamento exige decisão explícita.
5. As alterações são gravadas em pequenos lotes com identidade idempotente, versão/autoria e confirmação final por releitura do Firestore. Um conflito com edição concorrente é mostrado para revisão, nunca sobrescrito silenciosamente.

O PDF pode ser atualizado periodicamente sem se tornar a fonte que o app consulta em tempo real. Depois de uma importação confirmada, a Home e Eventos leem exclusivamente as coleções Firestore. Não se propõe sincronização bidirecional ou execução de Apps Script.

## Estado verificado em 27/09/2026

- O checkout contém as sete imagens JPG da galeria offline V1 (`segunda` a `sábado` e férias); não contém um PDF offline para validar o formato ou a extração.
- `scheduleDays` contém 307 documentos e a carga foi relida contra a fonte V1, conforme [`RELEASE_STATUS.md`](RELEASE_STATUS.md).
- A coleção Firestore `vacations` foi consultada em modo de leitura e contém zero documentos.
- A prévia local ignorada pelo Git contém 52 candidatos de férias, mas ainda depende de revisão: não leu notas/cancelamentos e um item não possui lista explícita de siglas.
- O esquema e as Rules de `vacations` já existem. O PWA ainda não tem uma interface de gestão/importação de férias.

## Dependências antes de implementar e carregar

- Receber o PDF offline atual para confirmar se há texto selecionável ou se será necessária leitura OCR e para definir um parser correspondente ao layout real.
- Reconciliar os 52 candidatos com o PDF vigente e confirmar cancelamentos, alterações e o item sem siglas explícitas.
- Implementar a área única de gestão e prévia do importador, protegida pela permissão existente `scheduleWrite`.
- Só então carregar os períodos aprovados, sem sobrescrever documentos divergentes e sem alterar a V1.
