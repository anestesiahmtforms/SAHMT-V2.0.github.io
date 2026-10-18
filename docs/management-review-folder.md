# Pasta protegida de revisão do documento

## Organização

Cada pasta de conteúdo conserva o PDF de leitura e seu formulário. A subpasta
**Revisão do documento** reúne o material editável e o DOCX de questões/gabarito.
A mudança do pai de um arquivo não troca seu ID. O app continua usando os mesmos
links de PDF e formulário.

O arquivo do material fica restrito aos proprietários e gestores que têm acesso
de edição à pasta de revisão. Mover um arquivo para essa pasta não remove
necessariamente seus acessos diretos anteriores. É preciso conferir e remover
esses acessos separadamente.

Organograma e Ebook Planejamento conservam somente o PDF de material, conforme
a decisão administrativa. Seus editáveis de material não devem ser recriados.

## Proteção em lotes

O código público é `apps-script-v2/ManagementReviewAccess.gs`. Os identificadores
reais ficam somente em `ManagementReviewAccessConfig`, no Apps Script privado.
O código não contém listas de usuários ou conteúdo dos documentos.

`protegerEditaveisGestaoV1` exige a identidade interativa e efetiva do proprietário.
O acionador de continuação exige o mesmo proprietário efetivo; não depende da
disponibilidade de `Session.getActiveUser()` em execução automática.

Antes de remover uma permissão, cada lote:

1. Confere o ID, o proprietário, o tipo, o conteúdo e a pasta atual do editável.
2. Confere a pasta de revisão com herança limitada e somente proprietários/editores.
3. Grava as permissões originais e as remoções propostas em um JSON privado.
4. Remove somente leitores antigos que não pertencem à pasta de revisão.
5. Relê as permissões e confirma que os gestores conservaram acesso.

Editores inesperados, acessos herdados não removíveis ou alterações no documento
interrompem o lote. O código não remove esses acessos automaticamente. Falhas
de rede e interrupções permitem retomada sem repetir remoções já concluídas.
Somente o acionador dedicado `continuarProtecaoEditaveisGestaoV1` é gerenciado.

O trabalho tem orçamento de 120 segundos por lote e continuação após um minuto.
Esses lotes consultam o Drive; não consultam Firestore nem alteram Forms ou PDFs.
O parâmetro privado opcional `parallelFiles` aceita de 1 a 8 arquivos. Cada rodada
envia no máximo uma alteração de permissão por arquivo; nunca são feitas duas
alterações simultâneas no mesmo arquivo. Esse limite segue a restrição da
[API de permissões do Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/update).
O registro operacional contém contagens, códigos seguros e o link privado de
recuperação. O JSON privado contém as informações necessárias para restauração
administrativa das permissões; não deve ir para Git.

Um `statusFileId` opcional permite gravar somente o resultado e as contagens em
outro arquivo privado, sem copiar os ACLs ou conteúdos. Isso permite acompanhar
o trabalho quando a credencial da ferramenta não pode ler o novo arquivo de
recuperação criado pelo Apps Script. A identidade efetiva e a privacidade dos
dois arquivos continuam obrigatórias.

## Vínculo DOC → PDF

O modelo de par conserva `sourceId`, `pdfId` e `folderId` (pasta do PDF), com
`sourceFolderId` opcional para o editável protegido. O resolvedor privado
`gpdfTrustedReviewLayout_` aceita somente os inventários exatos já conferidos.
Na configuração final, não é aceito o editável na antiga pasta de leitura.

O instalador privado `configurarRevisaoProtegidaPdfsGestaoV1` preserva o cursor,
os estados de publicação e a fila compatível. Faz cópia privada das propriedades
antes da atualização. Um vínculo alterado só reaproveita um estado anterior se
o conteúdo for equivalente, o PDF não tiver mudado e não houver publicação
pendente. A configuração de 40 pares ocupa menos de 8 KB por propriedade;
os IDs adicionais das pastas ficam no resolvedor privado.

O sincronizador usa o feed incremental do Drive, sem varredura do Firestore.
Mudanças no DOC, inclusive substituição integral do texto, geram nova versão
no **mesmo PDF**, com cópia anterior e atualização condicional por ETag. Uma
alteração em andamento aguarda estabilização. A política de leitura deve ser
revalidada quando mudar o material vinculado ao formulário.

Arquivos antigos de provas ou versões alternativas não recebem vínculo de PDF
por mera semelhança de título. A configuração usa apenas os 40 pares confirmados.

## Execução e verificação

No projeto privado **SAHMT V2.0 – Integração Spark**, atualizar o editor e executar
uma vez `protegerEditaveisGestaoV1`, em `ManagementReviewAccess.gs`.

- `REVIEW_ACCESS_PROGRESS`: aguardar as continuações automáticas.
- `REVIEW_ACCESS_PAUSED`: verificar `category`; a continuação foi removida.
- `REVIEW_ACCESS_PROTECTED_SYNC_SCHEDULED`: proteção concluída; aguardar a etapa PDF automática.
- `REVIEW_ACCESS_PROTECTED_SYNC_PENDING`: acessos concluídos, configuração PDF pendente.
- `REVIEW_ACCESS_AND_PDF_SYNC_READY`: proteção e instalação PDF concluídas.

Para confirmar a instalação, verificar o resultado aninhado `pdfSync`: deve
informar `enabled=true`, 40 documentos, 40 fontes protegidas, 40 estados e um
acionador de sincronização. A instalação não exporta novos PDFs. A comprovação
da conversão de uma revisão real deve ser feita depois com alteração autorizada.

Não executar novamente enquanto houver continuação automática em andamento.
Não confundir a instalação do código com a execução efetiva do trabalho.
Com `deferPdfInstall=true`, a configuração dos PDFs usa uma execução nova após
concluir a proteção, para não disputar o limite de duração com as remoções de
permissões. A validação completa dos pares ocorre antes de habilitar o sincronizador.

## Retorno seguro

`desativarAtualizacaoAutomaticaPdfsGestaoV1` desliga somente a sincronização PDF.
Os PDFs existentes continuam disponíveis. Para interromper a proteção em lotes,
remover somente o acionador `continuarProtecaoEditaveisGestaoV1`.

As fontes e PDFs conservam os IDs. O JSON privado permite restaurar, mediante
decisão administrativa, somente as concessões removidas registradas. As cópias
privadas de código e propriedades permitem voltar à configuração anterior.
Nenhuma restauração deve ampliar automaticamente o acesso a gabaritos.

## Evidência da execução em 17/10/2026

O Apps Script retornou `REVIEW_ACCESS_AND_PDF_SYNC_READY` às 23:35:38
(America/Sao_Paulo). A conferência independente terminou às 23:35:59:

- 66 editáveis nas pastas previstas, todos sem leitores antigos externos à revisão.
- Todos os acessos dos gestores preservados.
- 57 pastas de revisão com acesso limitado e nomes conferidos.
- 40 pares DOC→PDF ativos, com 40 estados de publicação e um acionador.
- IDs, conteúdo dos editáveis e checksums dos 40 PDFs preservados.
- Nenhuma escrita de conteúdo em PDF ou formulário; nenhuma leitura do Firestore.

Código consolidado instalado sem publicar Web App ou modificar o manifesto.
Os lotes terminaram sem agendar outra continuação de proteção. O arquivo de
recuperação dos acessos e as cópias anteriores de código/configuração permanecem
privados. Seus IDs não constam deste repositório.

Validação local: 46 testes unitários e 8 verificações do instalador privado,
incluindo retomada, falhas, acesso do gestor, preservação dos estados e limite
da propriedade. Não foi publicada alteração da PWA nesta etapa.

A confirmação desta execução cobre organização, proteção e instalação do
sincronizador. A conversão de uma revisão posterior do material deve ser
confirmada pelo resultado `PDF_SYNC_UPDATED` e pelo checksum do PDF correspondente;
nenhum documento de produção foi editado apenas para provocar esse teste.
