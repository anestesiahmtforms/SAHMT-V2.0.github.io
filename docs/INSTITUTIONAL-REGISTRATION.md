# Cadastros institucionais — operação

Enquetes e Consultas reúne Pesquisas Institucionais, Cadastro Profissional e Cadastro Epidemiológico. O acesso ao menu mantém as restrições de Governança já existentes.

O cadastro profissional é identificado, vinculado à conta Google verificada e ao perfil ativo no FB. O profissional pode atualizar seu registro; administradores ativos podem consultar os cadastros. Há controle de versão para evitar sobrescrita entre sessões. Os campos combinam os dois modelos institucionais consultados.

Comprovantes são destinados ao arquivo funcional institucional. O servidor define o ramo pela classificação interna, cria a pasta da conta e separa os assuntos em Currículo Lattes, CRM e RQE, Diplomas e certificados e Documentos cadastrais. Não aceita destino ou identidade escolhidos pelo cliente. Fotos são preparadas em JPEG, até 1600 pixels e 2 MB; PDFs têm limite de 5 MB. Pastas e arquivos permanecem privados.

Antes do primeiro envio, um administrador deve usar CONECTAR DRIVE INSTITUCIONAL e concluir a autorização Google com a conta proprietária indicada. Essa ação não troca a conta autenticada no SAHMT. O código OAuth é trocado no servidor e o refresh token é cifrado com AES-GCM no FB. Configuração OAuth, destinos e chave de cifra ficam em segredos do Worker; não entram no repositório. Não rotacionar a chave sem migrar a credencial cifrada. Não é necessário Blaze.

A avaliação epidemiológica usa somente Residentes e Equipe, incluindo Substitutos em Equipe. A classificação vem do cadastro interno. Não há campo de grupo ou dados identificadores no formulário. As medidas do cálculo opcional de IMC são usadas localmente; apenas a faixa é enviada. O instrumento é institucional e não produz diagnóstico.

Respostas epidemiológicas ficam no FE. O controle autenticado de participação fica separado, sem referência à resposta ou grupo. Comentários recebem outro identificador e não carregam grupo ou identidade; qualquer divulgação exige revisão humana. Metadados de commit e infraestrutura ainda podem correlacionar operações: não se promete anonimato absoluto.

O painel epidemiológico é restrito à conta administrativa configurada no servidor, após encerramento e publicação do ciclo. Não existe consulta individual às respostas de saúde. Grupos com menos de cinco respostas e distribuições com células ou complementos entre um e quatro são protegidos. Não se publicam total combinado ou cruzamentos de características.

Clima e Estresse também usam apenas Residentes e Equipe. Os agregadores incluem registros históricos de Substitutos em Equipe, sem alterar respostas ou participação. Versões anteriores ao controle autenticado permanecem fora destes indicadores. A classificação interna de Substituto é preservada para as demais funções do app.

## Comandos de administração

`node scripts/registration-admin.mjs status` mostra somente situação de ciclos e snapshots. `open` cria a coleta epidemiológica de 2026 se ausente, sem reabrir ciclos encerrados. `close` encerra com precondição de versão e backup privado. `publish` cria o agregado somente após encerramento, sem sobrescrever snapshot existente. `migrate-groups` regenera snapshots antigos de clima e estresse somente com o ciclo fechado, backup privado e precondição de versão; não altera respostas nem participação.

A administração usa a conta FE verificada pelo helper da CLI. O Worker mantém apenas leitura pontual e criação no FE, sem nova permissão de listagem. As coleções privadas são negadas ao SDK cliente.

## Verificação e implantação

`node --test tests/registration.test.js tests/registration-drive.test.js` verifica esquema, isolamento, revogação, concorrência, supressão, OAuth e recuperação de upload. O teste de navegador `tests/registration.browser.test.js` usa exclusivamente dados sintéticos no preview local. As regras de FB e FE são testadas nos emuladores.

Publicar o Worker com `REGISTRATION_DRIVE_CLIENT_JSON` e `REGISTRATION_DRIVE_KEY` provisionados exclusivamente como segredos; publicar FE usando `firebase.climate.json` e FA/FB pelo fluxo existente de Pages. O envio ao Drive só deve ser considerado ativo depois da autorização Google efetiva e de uma confirmação real de upload.
