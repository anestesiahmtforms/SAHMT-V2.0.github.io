# Escala de férias 2027 em FE

Primeira etapa: somente estrutura visual, conforme pedido do usuário.

- Acesso: Governança → Enquetes e Consultas (FE) → ESCALA DE FÉRIAS 2027.
- Origem visual: https://anestesiahmtforms.github.io/ferias2027/ (repositório `anestesiahmtforms/ferias2027`).
- Referência Drive preservada: https://drive.google.com/drive/folders/1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl.
- Layout: doze cartões mensais; semana, período e três colunas de siglas. Quantidade de linhas por mês conforme `apps-script/SpreadsheetControl.gs` da origem.
- Períodos e reservas vazios; atualização e gestão administrativa desativadas. O espaço de gestão administrativa segue o acesso de administrador de FE.
- A entrada segue a permissão existente de Enquetes e Consultas. Não concede acesso adicional a Governança ou aos demais painéis.
- Nenhuma API, Apps Script, sessão própria, automação, reserva, regra de escolha, pontuação ou registro do aplicativo original foi importado.
- O módulo não consulta Drive, Firestore ou outras instâncias e não grava dados. A referência ao Drive é apenas metadado para a próxima etapa; arquivos e permissões da pasta não foram alterados.
- O aplicativo de férias original permanece independente.

Implementação: `src/vacations-2027-ui.js`, `src/vacations-2027.css`, integração em `src/management-hub.js`.
