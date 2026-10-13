# Revisão local de uma captura completa em quarters

Esta ponte prepara uma revisão de integridade e de diferenças. Não faz captura,
migração, reancoragem de manifesto, classificação de ACL, importação Auth,
concessões ou alteração de políticas. Não carrega credenciais ou chama APIs.

## Comandos

No worktree `management-firebase-split/FIRESTORE`:

~~~powershell
node scripts/management-quarter-review.mjs FA --review-complete capture-FA-STAMP.dpapi.json
node scripts/management-quarter-review.mjs FA --review-complete capture-FA-STAMP.dpapi.json --out quarter-review-FA-NOME.dpapi.json
~~~

Substitua STAMP/NOME pelo arquivo real aprovado. O primeiro comando não grava
artefatos. O segundo cria exclusivamente um novo envelope privado Windows DPAPI;
não sobrescreve arquivos existentes. Nenhum comando aceita snapshot em JSON puro.

## Entradas locais protegidas

Todos os arquivos ficam em `.local-preview/management-split`, ignorados pelo Git:

- Cápsula especificada e recibo com o mesmo basename.
- HEAD `quarter-head-FA.json` e checkpoint protegido indicado pelo recibo.
- Baseline fixo `capture-FA-20261009010412736-reviewed.dpapi.json`.
- Recibo histórico `management-split-receipt-v2.json` e escopo `backup-scope-FA.json`.

A presença do lock de captura impede a revisão. Links, travessia de caminhos,
diretório sem ignore, mudanças nos bytes das entradas durante a revisão ou pins
divergentes também impedem a saída. A CLI não escreve HEAD, checkpoints ou
políticas, nem limpa pausas ou locks existentes.

Só aceita `COMPLETE` com snapshot consistente e escopo completo selecionado.
Confronta snapshot, recibo, plano, histórico de lotes e estado persistido contra
os hashes do HEAD. Confere cobertura de coleções/discovery, paginação encerrada,
contagens e reservas. O teto local de 1.500 por lote é conferido pelos limites de
entradas do histórico e pelos page proofs; o cumulativo não ultrapassa lotes×1.500.
Essas reservas não são uma medição do total faturável do projeto.

O hash do checkpoint é o estado persistido real. Para o hash de conteúdo,
exclui somente `lastObservedAt` conforme o contrato do HEAD. Não inventa horários
para conciliar o tick final; `readTime`, `startedAt`, `finishedAt` e conteúdo
permanecem vinculados às evidências reais.

## Saídas e diferenças

`reviewManagementQuarterSnapshot` em
`scripts/lib/management-quarter-snapshot-review.js` retorna:

- `summary`: contagens, pins e horários, sem paths de documentos, nomes, UIDs,
  e-mails, conteúdo, respostas ou tokens.
- `protectedReview`: snapshot e delta privado de paths/hashes/timestamps,
  com classificação `UNREVIEWED`.

A comparação usa path e `documentDigest` completo. Identifica adições, remoções,
mudanças e preservação/regressão de timestamps; não transporta uma classificação
antiga para um documento diferente. Também não altera nenhum manifesto.

`--out` grava primeiro um temporário protegido, confere decriptação/hash e
imutabilidade das entradas, e publica por hard link exclusivo. Remove apenas
seu temporário ou um arquivo final comprovadamente criado por essa execução
diante de falha; um arquivo concorrente existente é preservado.

Todos os resultados mantêm `productionAuthorized:false`, `migrationReady:false`,
`operationalFreshnessEvaluated:false` e efeitos operacionais zero. Hashes
demonstram integridade local; não demonstram autoridade, consumo atual ou
ausência global de produtores.

## Uso posterior

O envelope `LOCAL_MANAGEMENT_QUARTER_SNAPSHOT_REVIEW` contém `sourceSnapshot`
para uma revisão privada futura do plano. O novo hash do snapshot não reancora
`manifest.backupSha256` nem autoriza transporte. Auth/ACL, identidade e produtores
continuam dependendo de seus contratos separados.

O `readTime` original de 14:44:36.804 UTC permanece histórico. O prazo de uma hora
permite concluir aquela captura; não transforma a captura completa em uma
observação atual da cópia, cujo contrato exige cinco minutos. Nunca substitua
`readTime` pelo fim da captura ou pelo horário desta revisão.

## Testes e limites

~~~powershell
node --test tests/management-quarter-snapshot-review.test.js
~~~

A suite usa capturas sintéticas em memória e fixtures isoladas sob
`.local-preview`, com cleanup exato sem remoção recursiva. Windows cobre
decriptação/selagem DPAPI reais de dados sintéticos; o teste de symlink de arquivo
regular é executado no CI Linux e explicitamente limitado no Windows.
Nenhuma fixture comprova a validação do snapshot produtivo ou de um usuário real.

## Limite observado na captura atual

O estado comunicado pelo operador em 9 de outubro terminou `INCOMPLETE`, com
`CHECKPOINT_TIMEOUT`, lock retido e pausa preservada: 365 documentos, 43 coleções
e descoberta conferida para 151 de 365 pais. As reservas conservadoras cumulativas
foram 1.342. Nenhuma cópia produtiva para FB ocorreu. Contagem completa de
documentos não comprova a cobertura completa das árvores selecionadas, e este
consumidor continuará negando essa cápsula.

O prazo do readTime original terminou às 15:44:36.804 UTC. O grant bounded das
quarters 3/4 não estende esse prazo. A CLI atual não permite recomeçar sobre o HEAD
incompleto ou retomar fora da janela. Uma futura recuperação precisa de sequência,
artefatos, lock e autoridade separados, com readTime real novo e avaliação FA
fresca que considere app, atraso e trabalho anterior. Preservar todos os registros
antigos; não resetar HEAD, limpar lock/pausa, reconstruir COMPLETE a partir dos
documentos parciais ou redatar a captura.

A preparação local desta unidade passou 40 testes focados: 39 aprovados, nenhuma
falha e uma limitação explícita de symlink de arquivo no Windows. Inclui quatro
quarters sintéticas produzidas pelo core e roundtrip DPAPI real de dados
sintéticos. A agregação anterior de 1.906 testes não inclui esta nova unidade.