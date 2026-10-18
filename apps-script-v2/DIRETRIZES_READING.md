# Gestão de Documentos: leitor e liberação individual

## Estado da entrega

Implementação local, desligada por padrão. Nenhuma permissão real foi retirada ou concedida por este trabalho. A audiência já existente nos Google Forms continua válida até a transição real. Não afirmar que links diretos estão bloqueados antes de homologar essa transição.

Leitor PDF.js com worker empacotado localmente, páginas sequenciais, texto alternativo extraído do PDF, rolagem, progresso, FECHAR no rodapé e link oficial após liberação verificada. Somente a etapa de leitura é atestada: telemetria de navegador não comprova compreensão e pode ser simulada. Proprietários e editores mantêm acesso técnico ao Forms.

## Preparação automática local

`npm run test:diretrizes-reading` executa testes de protocolo, backend simulado e navegador local (Microsoft Edge instalado). `npm run build` produz o pacote sem ativar o recurso. `npm run check:fa-runtime` confirma o isolamento FA.

`node scripts/prepare-diretrizes-reading.mjs <entrada-privada.json> <politica-fora-do-git.json>` deriva MD5 e quantidade de páginas diretamente dos PDFs locais. Não acessa APIs nem gera segredos. Não sobrescreve arquivos nem aceita saída dentro do repositório.

Entrada privada: objeto com `pilotUids` (UIDs reais confirmados) e `entries`. Cada entrada exige `documentId`, `pdfId`, `filePath` absoluto e `version` inteira positiva. Quando houver formulário, informar `formId` e usar `documentId` igual a `evaluation_` seguido do formId. Para leitura sem formulário, usar `formId:null` e o ID real do catálogo. `pdfDocumentId` identifica o registro PDF pareado quando não segue o padrão `pdf_` + ID do formulário; `sourceFileId` identifica o original quando o registro principal aponta para ele. `category` e `audienceGroup` devem coincidir exatamente com ambos os registros do catálogo. As categorias aceitas são Diretrizes, Protocolos, ROPs, Documentos administrativos e Organograma; os grupos são GENERAL e RESTRICTED. Os valores antigos sem esses campos continuam limitados a DIRETRIZES/GENERAL.

`expectedChecksum` opcional deve coincidir com o arquivo. Não usar UIDs fictícios em configuração remota. O compilador recusa identidades/arquivos ausentes, IDs duplicados, PDFs acima de 6 MiB ou 300 páginas. Os IDs vêm do catálogo aprovado, nunca do título. As pastas visuais e as permissões atuais não são reclassificadas automaticamente. Um administrador também precisa pertencer ao grupo exato do documento.

A política gerada tem `version:1`, `pilotUids` e `documents`, indexado pelo ID do catálogo. Cada documento contém `formId`, `pdfId`, `checksum` MD5, `pages`, `version` e `enforced:false`. O servidor compara o checksum com o Drive e, ao entregar bytes, calcula novamente o digest. O checksum identifica a versão; não é uma assinatura de segurança.

O pacote de saída contém `policy` e `properties`. Pacotes pequenos usam uma única propriedade. Para políticas maiores, `properties` contém partes de até 7.000 bytes em `SAHMT_READING_POLICY_<sha256>_<índice>` e um manifesto em `SAHMT_READING_POLICY_JSON`. Instalar todas as partes antes do manifesto, que é o último valor a ser trocado. O servidor verifica o SHA-256; parte ausente, alterada ou de outra versão bloqueia o serviço. Cada propriedade permanece abaixo de 8.000 bytes; no máximo 64 partes. Versões antigas não são apagadas automaticamente, para preservar recuperação; antes de novas instalações verificar a capacidade total de Script Properties e remover somente partes comprovadamente sem referência, com o serviço desligado e recuperação guardada.

## Propriedades privadas no Apps Script operacional

- `SAHMT_READING_ENABLED`: `NO` inicialmente.
- `SAHMT_READING_HMAC_SECRET`: segredo dedicado de 32 bytes em base64url, 43 caracteres. Instalar somente no servidor e no Worker; não reutilizar segredo temporário de homologação.
- `SAHMT_READING_POLICY_JSON`: valor gerado em `properties`, após instalar as partes quando existirem. Manter somente contas aprovadas no piloto.
- `SAHMT_READING_OPERATOR_EMAIL`: conta executora autorizada para as funções manuais; o código exige correspondência entre usuário ativo e efetivo.

As propriedades `SAHMT_READING_RECOVERY_FILE_ID`, `SAHMT_READING_CUTOVER_CURSOR` e `SAHMT_READING_CUTOVER_SHA256` são controladas pelas funções de instalação. Não preenchê-las artificialmente. O marcador de transição depende de todo o catálogo, incluindo suas versões; mudar uma versão invalida a prontidão.

Preservar o manifesto e seus escopos atuais. Reutilizam-se Drive, Forms, Firestore, chamadas externas e identidade do operador já presentes no Apps Script operacional. A cópia temporária de conversão não substitui o receptor operacional e não deve receber segredos desse serviço.

## Configuração do Worker e PWA

Worker: `DIRETRIZES_READING_ENABLED=false`, `DIRETRIZES_READING_HMAC_SECRET`, `DIRETRIZES_READING_SCRIPT_URL` (Web App operacional `/exec`), `DIRETRIZES_READING_FA_API_KEY` (chave Web pública do projeto FA). `DIRETRIZES_READING_PILOT_ORIGIN` opcional aceita uma origem HTTPS exata de homologação. Preservar o binding `BROKER_STATE`: ele limita concorrência antes das chamadas externas. A rota é `/v1/diretrizes/reading`.

PWA: `VITE_DIRETRIZES_READING_ENABLED=false` e `VITE_DIRETRIZES_READING_ENDPOINT` vazio inicialmente. Somente endpoint público e flag no frontend. Flag solicitada com endpoint inválido falha fechada nos cartões, sem fallback para o Google Form. PDF.js e seu worker carregam sob demanda, fora do caminho de login FA.

O Worker verifica o token Firebase junto ao Google, projeto/issuer FA, validade, provedor Google, e-mail verificado, conta habilitada e revogação. Envia ao Apps Script somente identidade validada e pedido autenticado por HMAC. O Apps Script revalida perfil e autorização no FA e o vínculo catálogo/PDF/Form. Não aceitar e-mail livre do navegador como identidade. Documentos sem formulário registram `READING_COMPLETED`, sem criar URL ou solicitar permissões de Forms. Os nomes técnicos de flags, rotas e funções Diretrizes foram preservados por compatibilidade; cobrem somente as categorias configuradas em Gestão de Documentos.

## Persistência e custos

`documentReadingReceipts/{hash}`: UID, e-mail verificado, documento, formulário, versão/checksum, sessão, páginas apresentadas e instantes do servidor. `documentReadingGrants/{hash}`: registro privado de concessões justificadas por comprovantes. Ambos escritos somente pelo servidor; o deny padrão das regras atuais bloqueia acesso direto pelo cliente. Não publicar novas Rules automaticamente.

Sessões duram duas horas. O navegador envia progresso a cada cinco novas páginas e envia a cobertura inteira ao concluir. Não há cron, polling de perfis ou escrita por segundo. Fechar antes de um lote de cinco páginas pode exigir reapresentar as últimas páginas ainda não confirmadas; nenhuma conclusão já confirmada é descartada. O registro de concessões evita uma varredura dos perfis de todos os leitores a cada conclusão.

Uma leitura inicia verificações pontuais de perfil, grupo, catálogo, PDF e comprovante. A conclusão acrescenta transações e chamadas de permissões do Forms. Apps Script, Drive e Firestore continuam sujeitos às suas cotas gratuitas. Não existe dependência de Functions/Blaze nem habilitação de faturamento neste pacote. O tamanho máximo é um limite operacional a homologar no Worker Free; arquivos maiores precisam de otimização ou outra estratégia antes da ativação.

Falha transitória de API ou propagação preserva o comprovante e não fecha o formulário dos demais leitores; a conclusão pode ser repetida explicitamente. Divergência comprovada de audiência ou revogação confirmada durante a concessão exige fechamento e reconciliação pelo operador. Indisponibilidade de leitura do Firestore não é tratada como prova de revogação.

## Sequência de homologação e transição

1. Preparar a política privada com os PDFs exatos e uma conta participante aprovada. Conferir novamente metadados reais e vínculo catálogo/versão, sem criar ou alterar contas.
2. Instalar os arquivos locais no Apps Script operacional, preservando todos os demais arquivos, instalar propriedades privadas e preparar Worker/PWA isolados, com flags desligadas. Não substituir a PWA pública nesta etapa.
3. Executar `prepararBloqueioIndividualDiretrizesV1`: lê catálogo e permissões, valida o suporte do Forms e salva recuperação privada no Drive. Nenhuma escrita em Forms. Concede somente ao operador acesso ao arquivo por herança normal de criação, sem compartilhamento público adicional.
4. Na janela de transição aprovada, executar `instalarBloqueioIndividualDiretrizesV1`: fecha cada formulário, remove somente permissões de respondente publicadas, preserva proprietário/editores, verifica ausência de respondentes e reabre. Se retornar `READING_CUTOVER_PENDING`, a mesma função retoma do cursor privado; não iniciar outro backup. Em falha, o formulário corrente fica fechado e o serviço permanece desligado.
5. Somente após `READING_CUTOVER_VERIFIED`, habilitar receptor, Worker e PWA isolada. A allowlist permanece restrita à conta aprovada. A rotina antiga de publicação não pode ampliar audiência de formulários registrados nessa política, mesmo com recurso desativado.
6. Com uma conta participante sem privilégios técnicos: confirmar negação no link direto, ler todas as páginas, concluir, verificar liberação para essa mesma conta e negar uma segunda conta. Testar sessão expirada, material alterado, falha de rede, troca de usuário e retomada. Não usar proprietário como prova de bloqueio.
7. Após evidência real, ampliar `pilotUids` somente para os usuários ativos aprovados e publicar a PWA conforme autorização. Não é necessário alterar o marcador de transição quando apenas a allowlist é ampliada, mantendo o mesmo catálogo.

Não executar os passos remotos apenas porque testes locais passaram. A criação de recuperação, edição de permissões e publicação são ações externas distintas.

## Atualização de material e revogação

### Atualização automática DOC/DOCX/Google Docs → PDF

`ManagementPdfSync.gs` mantém pares explícitos de IDs privados, sem localizar arquivos por título. A fonte editável pode ter todo o texto substituído, desde que o mesmo arquivo/ID seja preservado. Excluir o original e enviar um novo arquivo cria outro ID e exige atualizar o vínculo; o sistema não adivinha essa associação. Organograma e Ebook Planejamento são exceções PDF-only por decisão administrativa e não entram na configuração do monitor.

Propriedades: `SAHMT_DOCUMENT_PDF_SYNC_CONFIG` recebe `{version:1,operatorEmail,workspaceFolderId,pairs:[{sourceId,pdfId,folderId}]}`; o diretório de trabalho deve ser privado, somente proprietário, fora das pastas publicadas. A configuração só existe no servidor. `SAHMT_DOCUMENT_PDF_SYNC_ENABLED` inicia ausente/desligada; o instalador validado altera para YES e instala somente `atualizarPdfsGestaoAlteradosV1`. O arquivo privado `InstallManagementPdfSync.gs`, gerado fora do repositório com os IDs reais, oferece `configurarAtualizacaoAutomaticaPdfsGestaoV1` para preparar essa configuração e executar o instalador em uma ação. Preserva outras propriedades, arquivos e acionadores.

O acionador consulta o feed incremental `Drive changes` a cada cinco minutos; não varre o Firestore e não reconverte em cada abertura do app. A fila é persistida antes de avançar o cursor. A rotina aguarda dois minutos sem edição e processa no máximo três arquivos por execução, com limite de tempo; alterações simultâneas em muitos documentos podem demorar vários ciclos. Fontes inalteradas não são exportadas, e a instalação não converte retroativamente todas as fontes aprovadas. Alterações durante a instalação ou conversão continuam pendentes para nova conferência.

Conversão de Word usa uma cópia temporária privada em Google Docs e exportação PDF; Google Docs nativo usa exportação direta. O temporário é eliminado e pendências de limpeza são retomadas por ID. O PDF mantém o mesmo ID, link, pasta e permissões. Antes de substituí-lo, salva-se uma cópia do PDF anterior no diretório privado e uma intenção durável. ETag e checksum da mesma leitura v2 do Drive protegem o PUT condicional; HTTP 412 não recebe fallback sem condição. Versão de fonte, pasta, tipo, assinatura PDF, tamanho e checksum são reconferidos. Falha preserva o arquivo anterior ou mantém recuperação pendente sem afirmar atualização. As cópias não validam automaticamente a fidelidade de diagramas complexos do Word após conversão do Google.

Limites: fonte Word de até 20 MiB, exportação PDF de até 10 MiB. O leitor e-book mantém seu limite independente de 6 MiB. Uma fonte modificada gera novo material; comprovantes antigos não justificam a leitura da nova versão. Se houver política do leitor para o PDF, a publicação fecha somente os Forms associados antes da troca de bytes. Eles permanecem fechados e a política precisa ser revalidada com novo checksum/páginas/versão pelo procedimento abaixo. Nenhuma pontuação, resposta histórica, permissão de perfil ou recibo é apagado ou recalculado automaticamente. A versão nova não é liberada fingindo que a aprovação de leitura anterior continua válida.

`verificarAtualizacaoAutomaticaPdfsGestaoV1` retorna estado agregado, número de vínculos/baselines/acionadores e zero leituras Firestore. `desativarAtualizacaoAutomaticaPdfsGestaoV1` desliga o monitor e remove somente seu acionador. A reversão de um PDF usa o `lastBackupId`/`pending.backupId` privado correspondente, com serviço desligado, conferência do destino e revalidação da política de leitura; não restaurar todos os PDFs indiscriminadamente. Não excluir cópias de recuperação automaticamente.

Estado em 17/10/2026: 42 pares privados tiveram identidade/tipo/pasta conferidos por leitura real. A API Drive v2 respondeu HTTP 200 com ETag para a conferência de precondição. Os arquivos ManagementPdfSync e o instalador privado foram acrescentados ao Apps Script operacional e relidos, preservando integralmente os 33 arquivos anteriores e seu manifesto; nenhuma versão Web App foi publicada. A única tentativa de executar o instalador pela Execution API retornou HTTP 403. O navegador está desabilitado nas configurações de Work. Portanto o acionador e a ativação NÃO estão confirmados: o operador precisa executar `configurarAtualizacaoAutomaticaPdfsGestaoV1` no arquivo InstallManagementPdfSync.gs. Esperado: `PDF_SYNC_INSTALLED`, documents=42, intervalMinutes=5, firestoreReads=0, pdfWrites=0. Não afirmar monitor ativo antes dessa execução e da conferência do status. Testes locais: 53 aprovados, incluindo 18 específicos da sincronização e 35 do backend de leitura. Nenhuma conversão real ou substituição de PDF foi realizada durante a instalação do código.

Atualização posterior, após a retirada administrativa da duplicação de Transporte de Pacientes Instáveis: o pacote atual contém **41 pares**, e esse passa a ser o valor esperado em `PDF_SYNC_INSTALLED`. A pasta sobrevivente e seus três arquivos foram conferidos. O catálogo FA recebeu o título correto nos dois registros mantidos; somente os dois metadados de catálogo que apontavam para o conteúdo excluído foram retirados, com cópia privada de recuperação e precondições de updateTime. Respostas, pontuação e histórico não foram excluídos. A referência do monitor ao PDF descartado foi trocada pelo PDF efetivamente mantido e o vínculo da pasta excluída foi removido. O instalador privado foi atualizado remotamente, preservando os outros 34 arquivos. Se a configuração antiga já estiver instalada, o mesmo ponto de entrada faz a migração restrita, salva recuperação privada, conserva estados dos demais documentos e filtra somente a fila obsoleta; configuração divergente bloqueia a mudança. Quatro cenários locais de migração passaram. A execução manual continua necessária; não foi repetida a chamada de ativação pela API que retornou 403.

Antes de atualizar versão ou retirar uma autorização de respondente, executar `fecharFormulariosLeituraDiretrizesV1`: desativa o receptor e tenta fechar todos os formulários registrados. O fechamento do Forms bloqueia também o link direto; desativar apenas a flag do app não revoga uma permissão Google existente.

Preparar política revisada com `enforced:false`, novo checksum/versão quando o conteúdo muda, e allowlist atualizada. Preparar novo backup, executar transição e reabrir somente após verificação. A recuperação anterior permanece em arquivo privado e o novo backup referencia seu ID. Conclusões de outra versão não se transferem. Neste pacote, revogações fora desse procedimento não são sincronizadas automaticamente com ACL do Forms: o novo serviço recusa a conta revogada, mas uma permissão Google já concedida só deixa de valer após retirada ou fechamento confirmado. Essa janela deve ser aceita ou resolvida antes de uma liberação ampla.

## Reversão

Desabilitar as flags do Worker/PWA; executar `reverterBloqueioIndividualDiretrizesV1` como operador. A função desativa o receptor, fecha os Forms, restaura somente a audiência individual restrita do backup e estados de publicação, verificando a preservação de editores. Não restaura permissões amplas anyone/domain/group. Falhas deixam o formulário corrente fechado, código seguro `READING_RECOVERY_PENDING`, e permitem repetir a mesma reversão. Comprovantes não são excluídos e nenhuma pontuação é recalculada.

## Evidências separadas

### Documentos de questões com gabarito

Preparação iniciada em 17/10/2026 para 57 pastas e 58 Forms, incluindo as referências ROPs do catálogo localizadas fora da árvore reorganizada. Uma pasta contém dois Forms e precisa de comparação antes de consolidar seus documentos; não escolher pelo título. O inventário não inclui a pasta de Transporte anteriormente excluída. O documento de questões é separado do DOC de material de apoio e não participa da lista do monitor DOC→PDF.

`ManagementQuestionExport.gs` e o arquivo privado `ManagementQuestionExportTargets.gs` estão instalados no Apps Script operacional, preservando os outros 35 arquivos. Executar `exportarQuestoesGabaritosGestaoV1` uma vez no editor; o ponto de entrada retoma sem duplicação e agenda continuação somente quando necessária. O exportador lê definições/gabaritos, sem ler respostas ou alterar Forms/Firestore. Cria uma fonte JSON privada, somente proprietário, com metadados e conteúdo reais. Prefere Forms API no runtime; oferece alternativa nativa FormApp quando a API não está disponível. As origens ficam explicitamente identificadas para não usar uma versão nativa como revisionId da Forms API. O retorno pronto é `QUESTION_BANK_EXPORT_READY` com `privateReportUrl`.

O acesso direto da ferramenta à Forms API encontrou SERVICE_DISABLED no projeto consumidor da credencial; a alternativa de projeto de quota não entregou a definição. Execution API permanece bloqueada por 403 e o navegador está desabilitado em Work. Portanto a extração real ainda depende da execução manual; documentos com gabaritos reais não foram gerados nem colocados no Drive nesta etapa. Não confundir instalação do exportador com criação dos DOCX ou sincronização ativa.

`scripts/lib/management-question-document.js` prepara o modelo e lê o formato DOCX estruturado. Cada questão traz enunciado, alternativas, pontos existentes e RESPOSTA CORRETA conforme a chave exata do Forms. Gabaritos ausentes ou inconsistentes são explicitamente sinalizados. O preparo de alteração preserva IDs, pontos e obrigatoriedade; detecta banco desatualizado, outro formulário, formato inválido e gabarito incompleto. Não aplica alterações: exige integração posterior com designação atual do gestor e aprovação da versão imutável do documento. Questões com imagens e origem nativa têm bloqueios específicos para não presumir compatibilidade de uma gravação em lote. Não existe publicação ou atualização automática de Forms ativada por este pacote.

Os gabaritos devem ficar em uma subpasta de revisão com acesso limitado, junto à organização de cada documento, mantendo material dos participantes separado. Nenhum gestor adicional foi designado ou recebeu permissão de edição do Forms. Testes locais do exportador e modelo/parser: 16 aprovados, zero falhas.

Testes locais e build não provam instalação remota, entrega de PDFs privados, propagação de ACL no Google nem navegação autenticada no iPhone. Registrar essas evidências na homologação, com códigos e contagens, sem tokens, URLs temporárias, envelopes, e-mails ou UIDs nos logs operacionais.
