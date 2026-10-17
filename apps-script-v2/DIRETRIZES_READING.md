# Diretrizes: leitor e liberação individual

## Estado da entrega

Implementação local, desligada por padrão. Nenhuma permissão real foi retirada ou concedida por este trabalho. A audiência já existente nos Google Forms continua válida até a transição real. Não afirmar que links diretos estão bloqueados antes de homologar essa transição.

Leitor PDF.js com worker empacotado localmente, páginas sequenciais, texto alternativo extraído do PDF, rolagem, progresso, FECHAR no rodapé e link oficial após liberação verificada. Somente a etapa de leitura é atestada: telemetria de navegador não comprova compreensão e pode ser simulada. Proprietários e editores mantêm acesso técnico ao Forms.

## Preparação automática local

`npm run test:diretrizes-reading` executa testes de protocolo, backend simulado e navegador local (Microsoft Edge instalado). `npm run build` produz o pacote sem ativar o recurso. `npm run check:fa-runtime` confirma o isolamento FA.

`node scripts/prepare-diretrizes-reading.mjs <entrada-privada.json> <politica-fora-do-git.json>` deriva MD5 e quantidade de páginas diretamente dos PDFs locais. Não acessa APIs nem gera segredos. Não sobrescreve arquivos nem aceita saída dentro do repositório.

Entrada privada: objeto com `pilotUids` (UIDs reais confirmados) e `entries`. Cada entrada exige `documentId`, `formId`, `pdfId`, `filePath` absoluto e `version` inteira positiva. O documentId precisa ser `evaluation_` seguido do formId. `expectedChecksum` opcional deve coincidir com o arquivo. Não usar UIDs fictícios em configuração remota. O compilador recusa identidades/arquivos ausentes, IDs duplicados, PDFs acima de 6 MiB ou 300 páginas. Os IDs vêm do catálogo aprovado, nunca do título.

A política gerada tem `version:1`, `pilotUids` e `documents`, indexado pelo ID do catálogo. Cada documento contém `formId`, `pdfId`, `checksum` MD5, `pages`, `version` e `enforced:false`. O servidor compara o checksum com o Drive e, ao entregar bytes, calcula novamente o digest. O checksum identifica a versão; não é uma assinatura de segurança.

O JSON compacto é limitado a 8.000 bytes para caber em uma propriedade do Apps Script. O compilador recusa pacotes maiores em vez de produzir configuração que não possa ser instalada.

## Propriedades privadas no Apps Script operacional

- `SAHMT_READING_ENABLED`: `NO` inicialmente.
- `SAHMT_READING_HMAC_SECRET`: segredo dedicado de 32 bytes em base64url, 43 caracteres. Instalar somente no servidor e no Worker; não reutilizar segredo temporário de homologação.
- `SAHMT_READING_POLICY_JSON`: JSON validado pelo compilador. Manter somente contas aprovadas no piloto.
- `SAHMT_READING_OPERATOR_EMAIL`: conta executora autorizada para as funções manuais; o código exige correspondência entre usuário ativo e efetivo.

As propriedades `SAHMT_READING_RECOVERY_FILE_ID`, `SAHMT_READING_CUTOVER_CURSOR` e `SAHMT_READING_CUTOVER_SHA256` são controladas pelas funções de instalação. Não preenchê-las artificialmente. O marcador de transição depende de todo o catálogo, incluindo suas versões; mudar uma versão invalida a prontidão.

Preservar o manifesto e seus escopos atuais. Reutilizam-se Drive, Forms, Firestore, chamadas externas e identidade do operador já presentes no Apps Script operacional. A cópia temporária de conversão não substitui o receptor operacional e não deve receber segredos desse serviço.

## Configuração do Worker e PWA

Worker: `DIRETRIZES_READING_ENABLED=false`, `DIRETRIZES_READING_HMAC_SECRET`, `DIRETRIZES_READING_SCRIPT_URL` (Web App operacional `/exec`), `DIRETRIZES_READING_FA_API_KEY` (chave Web pública do projeto FA). `DIRETRIZES_READING_PILOT_ORIGIN` opcional aceita uma origem HTTPS exata de homologação. Preservar o binding `BROKER_STATE`: ele limita concorrência antes das chamadas externas. A rota é `/v1/diretrizes/reading`.

PWA: `VITE_DIRETRIZES_READING_ENABLED=false` e `VITE_DIRETRIZES_READING_ENDPOINT` vazio inicialmente. Somente endpoint público e flag no frontend. Flag solicitada com endpoint inválido falha fechada nos cartões, sem fallback para o Google Form. PDF.js e seu worker carregam sob demanda, fora do caminho de login FA.

O Worker verifica o token Firebase junto ao Google, projeto/issuer FA, validade, provedor Google, e-mail verificado, conta habilitada e revogação. Envia ao Apps Script somente identidade validada e pedido autenticado por HMAC. O Apps Script revalida perfil e autorização no FA e o vínculo catálogo/PDF/Form. Não aceitar e-mail livre do navegador como identidade.

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

Antes de atualizar versão ou retirar uma autorização de respondente, executar `fecharFormulariosLeituraDiretrizesV1`: desativa o receptor e tenta fechar todos os formulários registrados. O fechamento do Forms bloqueia também o link direto; desativar apenas a flag do app não revoga uma permissão Google existente.

Preparar política revisada com `enforced:false`, novo checksum/versão quando o conteúdo muda, e allowlist atualizada. Preparar novo backup, executar transição e reabrir somente após verificação. A recuperação anterior permanece em arquivo privado e o novo backup referencia seu ID. Conclusões de outra versão não se transferem. Neste pacote, revogações fora desse procedimento não são sincronizadas automaticamente com ACL do Forms: o novo serviço recusa a conta revogada, mas uma permissão Google já concedida só deixa de valer após retirada ou fechamento confirmado. Essa janela deve ser aceita ou resolvida antes de uma liberação ampla.

## Reversão

Desabilitar as flags do Worker/PWA; executar `reverterBloqueioIndividualDiretrizesV1` como operador. A função desativa o receptor, fecha os Forms, restaura somente a audiência individual restrita do backup e estados de publicação, verificando a preservação de editores. Não restaura permissões amplas anyone/domain/group. Falhas deixam o formulário corrente fechado, código seguro `READING_RECOVERY_PENDING`, e permitem repetir a mesma reversão. Comprovantes não são excluídos e nenhuma pontuação é recalculada.

## Evidências separadas

Testes locais e build não provam instalação remota, entrega de PDFs privados, propagação de ACL no Google nem navegação autenticada no iPhone. Registrar essas evidências na homologação, com códigos e contagens, sem tokens, URLs temporárias, envelopes, e-mails ou UIDs nos logs operacionais.
