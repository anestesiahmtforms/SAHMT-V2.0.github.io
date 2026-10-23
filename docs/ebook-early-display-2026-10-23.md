# PDF antes da gravação da sessão — versão 228

O usuário observou aproximadamente 11 segundos até o PDF aparecer. Não foi possível decompor esse tempo no iPhone; o fluxo anterior aguardava autorização, Drive, gravação transacional e retorno do Apps Script para só então desenhar a página.

## Novo fluxo

1. `open` valida identidade, perfil, público, catálogo, versão e checksum do PDF. Entrega o material sem criar recibo ou pontuação.
2. O navegador começa a desenhar e, em paralelo, chama `start` com um comprovante HMAC de autorização válido por 45 segundos, vinculado à identidade, documento, política e versão do treinamento.
3. `start` cria/retoma o recibo sem reenviar o PDF nem repetir as consultas de catálogo e Drive. A versão do treinamento é revalidada na transação. O comprovante não autoriza concluir nem concede acesso ao Forms.
4. `progress` e `complete` continuam verificando as permissões atuais. Só após sessão confirmada e todas as páginas apresentadas o botão de concluir é habilitado. Falha de registro mantém o PDF visível e o formulário bloqueado, com tentativa manual.

O protocolo antigo de `start` permanece aceito para versões instaladas anteriormente. A liberação do Forms e as regras de pontuação não foram modificadas.

O bloqueio global do Apps Script cobre a admissão do nonce e é liberado antes de operações de leitura e transações Firestore. A ação `complete` mantém a serialização das alterações de permissões dos Forms. Cada gravação de recibo usa a transação existente.

## Medição e limites

O leitor guarda apenas em atributos locais do diálogo o tempo até a primeira página e até o registro. O Apps Script registra operação e duração, sem identidade, URL ou conteúdo do material. Não há envio automático dessa medição nem polling.

Esta versão retira a transação do caminho crítico da primeira apresentação, mas não promete um tempo fixo: rede, inicialização do Apps Script, Drive e desenho ainda variam. Não armazena PDFs privados no GitHub nem modifica seus bytes.

## Leitura e pontos atuais

A evidência atual é apresentação/rolagem das páginas e confirmação explícita, não prova de compreensão. Não há tempo mínimo por página. O recibo é vinculado ao UID, material, checksum e versão. A leitura libera individualmente o Forms; sozinha não cria crédito. A resposta validada no Forms é que gera os créditos conforme configuração, incluindo ciência e nota, com revisão administrativa para sugestões.

## Validação

Testes do serviço cobrem entrega sem gravações, comprovante expirado/adulterado, troca de identidade/política, revisão do treinamento e revogação antes de concluir. O teste de navegador comprova PDF visível com registro atrasado, botão bloqueado até a confirmação, erro de registro sem liberar formulário, zoom e leitura completa. O teste de transporte cobre as duas etapas com identidade e resposta autenticadas.
