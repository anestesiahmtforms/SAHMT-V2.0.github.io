# Cadastros institucionais — operação

Enquetes e Consultas reúne Pesquisas Institucionais, Cadastro Profissional e Cadastro Epidemiológico. O acesso ao menu mantém as restrições de Governança já existentes.

O Cadastro Profissional é identificado, vinculado à conta Google verificada e ao perfil ativo. A implantação em FC usa o login e o Firestore de `indicadores---sahmt`. O profissional pode atualizar seu registro e administradores ativos podem consultar os cadastros. A edição usa controle de versão. Na primeira atualização de um cadastro antigo, os campos substituídos são preservados no registro administrativo.

O usuário escolhe o assunto e seleciona ou fotografa o comprovante. O envio começa ao selecionar o arquivo e a confirmação só aparece após o armazenamento. O servidor arquiva em **Ficha Funcional dos Membros da Equipe**, no ramo **Cadastro dos Anestesistas** ou **Cadastro dos Substitutos do Serviço**. No ramo, cria a pasta da conta e separa os assuntos em Currículo Lattes, CRM e RQE, Diplomas e certificados e Documentos cadastrais. Fotos são preparadas em JPEG, até 1600 pixels e 2 MB. PDFs têm limite de 5 MB. Pastas e arquivos permanecem privados.

Em FC a autorização do Drive é provisionada no servidor pela conta proprietária `anestesiahmtforms@gmail.com`. A pasta continua sob essa conta e seu compartilhamento não é alterado. A autorização administrativa é feita fora do app. Os segredos e destinos ficam no Worker do FC. A implantação usa o plano gratuito.

A avaliação epidemiológica usa somente Residentes e Equipe, incluindo Substitutos em Equipe. A classificação vem do cadastro interno. Não há campo de grupo ou dados identificadores no formulário. As medidas do cálculo opcional de IMC são usadas localmente; apenas a faixa é enviada. O instrumento é institucional e não produz diagnóstico.

Respostas epidemiológicas ficam no FE. O controle autenticado de participação fica separado, sem referência à resposta ou grupo. Comentários recebem outro identificador e não carregam grupo ou identidade; qualquer divulgação exige revisão humana. Metadados de commit e infraestrutura ainda podem correlacionar operações: não se promete anonimato absoluto.

O painel epidemiológico é restrito à conta administrativa configurada no servidor, após encerramento e publicação do ciclo. Não existe consulta individual às respostas de saúde. Grupos com menos de cinco respostas e distribuições com células ou complementos entre um e quatro são protegidos. Não se publicam total combinado ou cruzamentos de características.

Clima e Estresse também usam apenas Residentes e Equipe. Os agregadores incluem registros históricos de Substitutos em Equipe, sem alterar respostas ou participação. Versões anteriores ao controle autenticado permanecem fora destes indicadores. A classificação interna de Substituto é preservada para as demais funções do app.

## Comandos de administração

`node scripts/registration-admin.mjs status` mostra somente situação de ciclos e snapshots. `open` cria a coleta epidemiológica de 2026 se ausente, sem reabrir ciclos encerrados. `close` encerra com precondição de versão e backup privado. `publish` cria o agregado somente após encerramento, sem sobrescrever snapshot existente. `migrate-groups` regenera snapshots antigos de clima e estresse somente com o ciclo fechado, backup privado e precondição de versão; não altera respostas nem participação.

A administração usa a conta FE verificada pelo helper da CLI. O Worker mantém apenas leitura pontual e criação no FE, sem nova permissão de listagem. As coleções privadas são negadas ao SDK cliente.

## Verificação e implantação

`node --test tests/registration.test.js tests/registration-drive.test.js` verifica esquema, isolamento, revogação, concorrência, supressão, OAuth e recuperação de upload. O teste de navegador `tests/registration.browser.test.js` usa exclusivamente dados sintéticos no preview local. As regras de FB e FE são testadas nos emuladores.

O Worker FC exige `FC_REGISTRATION_SERVICE_ACCOUNT_JSON`, da identidade `registration-worker@indicadores---sahmt.iam.gserviceaccount.com`, com leitura e escrita no Firestore de FC. O upload exige os segredos `FC_REGISTRATION_DRIVE_CLIENT_JSON` (com `clientId`, `clientSecret`, `rootFolderId`, `teamParentId`, `substituteParentId`) e `FC_REGISTRATION_DRIVE_REFRESH_TOKEN`. Antes de publicar o app, verificar um envio controlado após habilitar `FC_PROFESSIONAL_REGISTRATION_ENABLED` no Worker FC. Em seguida, usar a mesma variável no Worker FF para a verificação das convocações e `VITE_FC_PROFESSIONAL_REGISTRATION=true` na publicação do PWA.
