# Avaliação integrada: implantação e homologação

## Componentes separados

O PWA consulta somente Firestore. Forms e Apps Script são processadores de escrita; não são dependências da abertura da tela. Rota `training`, flag `trainings` e permissões existentes permanecem. O nome apresentado é **Desempenho**. Em Gestão, **Avaliação dos Gestores** consulta exclusivamente GOVERNANCE; não altera o máximo ou percentual da equipe.

O projeto continua Firebase Spark. Não há implantação de Cloud Functions paga, habilitação de Blaze, novo compartilhamento Drive ou ampliação IAM nesta alteração. O escopo `https://www.googleapis.com/auth/forms` foi autorizado diretamente pelo proprietário em 03/10/2026. Consentimento de execução e autorização para alterar o manifesto são etapas diferentes.

As coleções históricas `scores`, `trainings`, progresso e seus materiais permanecem. Nenhum ponto histórico é reinterpretado ou importado em massa. Os novos lançamentos usam `evaluationAwards` e `evaluationLedger`, separados por categoria e corrigidos com versão esperada e motivo. Transferências do Checklist são pares diários indivisíveis; uma assinatura própria vale zero. Assinaturas incompletas aceitas seguem a mesma regra de transferência.

## Preparação do executor

1. Abra o [Apps Script da integração](https://script.google.com/home/projects/1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD/edit) com a conta autorizada.
2. Em **Configurações do projeto → Propriedades do script**, configure `SAHMT_V2_EVALUATION_ALLOWED_EMAILS` com a conta executora autorizada. Não inclua contas de participantes. A conta também precisa ter as permissões Firestore já aprovadas para o executor; o manifesto não concede IAM.
3. Selecione **configurarModeloAvaliacaoSahmtV2** no editor e clique em **Executar**. Conclua o consentimento solicitado pelo Google para Forms. A função protege o original, verifica que a cópia não tem respostas, preserva questões/gabaritos/pesos e mantém a cópia sem publicação. Se o acesso à API Google Forms estiver indisponível, a função para e apresenta erro explícito; não publica o modelo.
4. Execute **reconcileEvaluationLinks** para prévia e projeções dos vínculos. A função percorre todas as origens de Gestão e suas subpastas/conteúdos acessíveis. PDF e arquivos binários não oferecem inspeção dos links internos: vínculo manual e pendência explícita; nunca remoção de vínculos com base em leitura incompleta.
5. Após cadastrar designações e configurações na interface, execute **processEvaluationRequests**. Esta função pode processar preparação de metadados sem habilitar a pontuação; pedidos de aprovação ou correção financeira continuam pendentes até homologação e ativação. Não altere as flags para contornar essa proteção.
6. Execute **reconcileChecklistResponsibilities** para preparar a projeção de responsabilidade da data corrente. Esta preparação não assina relatórios nem concede pontos. Dados insuficientes resultam em `NEEDS_REVIEW`.

O formulário original [CONHECENDO AS ROPS](https://docs.google.com/forms/d/1NFqJHXOiHInHtQlmZMOTKHgjgmeYB4TxJ9s2p8xRTmc/edit) é somente referência; nenhuma resposta real deve ser inserida, alterada ou importada automaticamente. O [modelo reutilizável](https://docs.google.com/forms/d/1z-T7EL_FN1blDQa9Cn8SybHV_pJOr1dnVObVtHXtcmc/edit) permanece não publicado até material, audiência, vigência e critérios reais estarem completos.

## Configuração das atividades

Em Desempenho, administrador configura ID verdadeiro do formulário, matéria estável, versão elegível, modalidades, IDs verdadeiros dos itens, materiais, público e vigência. O processador confere e-mail VERIFIED, uma resposta por conta, edição pós-envio bloqueada, acesso, gabarito e pesos. Alias público/curto sem resolução nunca é tratado como ID verdadeiro.

O administrador designa um gestor específico por área. Histórico da designação preserva anterior/atual, vigência, autor e horário. Duplicar/renomear um formulário não cria crédito. Nova aplicação exige nova versão com mudança efetiva. Nota ausente fica pendente e é revisitada periodicamente, inclusive após correção tardia no Google Forms. Correção administrativa prevalece até resolução explícita de divergência com a fonte.

## Homologação obrigatória antes dos gatilhos

Use cópia de teste, material fictício e três contas distintas: participante, gestor designado e administrador independente. Não use pacientes ou respostas originais. Na inspeção de 03/10/2026, produção tinha somente dois perfis cadastrados: ainda não demonstra esse cenário com três identidades.

Verifique ciência afirmativa/negativa, sugestão pendente/aprovada/recusada/self-review bloqueada, nota ausente/corrigida, duplicidade de origem e versão, troca de gestor sem transferência de histórico, MATERIAL/QUESTIONS/ambos e segundo componente, correção zero/concorrente, governança sem alteração do desempenho, assinatura própria/substituição/incompleta/estorno e desconexão/reconexão. Dados de cache ou saldo com revisão divergente devem mostrar espera, nunca zero inventado.

A primeira homologação financeira é executada no projeto local `demo-sahmt-v2`, usando o mesmo motor Apps Script e transações do emulador Firestore. Os bloqueios de produção permanecem intactos. A captura técnica de respostas autorizadas da cópia de teste não concede pontos e fica em coleção privada; jamais se ativam os saldos reais apenas para iniciar o primeiro teste.

Somente após evidência dessa homologação configurar `SAHMT_V2_EVALUATION_HOMOLOGATED=true`, `SAHMT_V2_EVALUATION_ENABLED=true` e `evaluationRuntime/state.homologationVerified=true`; não basta alterar uma flag. `installEvaluationTriggers` e consumidores financeiros revalidam operador e esses gates. Não habilitar gatilhos por mera publicação do código.

## Sequência de publicação

1. Revisar diff, testes de domínio/Rules/Worker/Functions em projeto `demo-sahmt-v2` e build. Preservar o checkout original com suas modificações.
2. Publicar Rules e acrescentar somente os índices necessários, sem apagar índices existentes. Conferir o release de Rules em `sahmt-17a16` e o estado READY dos índices.
3. PR revisado com CI aprovado; publicar main/PWA e conferir o service worker/cache e os arquivos servidos. GitHub não implanta Apps Script.
4. Fazer backup do Apps Script em uso antes do push. Antes de homologar, enviar novas definições/manifesto/projeção e preservar **ChecklistValidation** remoto. A versão nova desse consumidor só substitui a operacional após homologação; esta diferença deve aparecer no registro de implantação. O leitor operacional do PWA também permanece exatamente na base deste release: `checklist-responsibility-reader.js`. O leitor Spark em `checklist-responsibility-projection.js` está preparado e testado, mas não é importado pelo fluxo ativo. Ele só entra junto à projeção contínua CONFIRMED e à homologação. Publicar esse leitor antes deixaria usuários comuns bloqueados diante de uma projeção ainda ausente. Nenhuma nova Function é implantada nesta transição.
5. Revalidar OAuth/modelo, homologar com contas distintas e somente então ativar os gatilhos e o novo consumidor Checklist. Registrar separadamente código remoto, Rules, índices, configuração, execução e homologação real.

## Limites de verificação

Testes VM/emulador e navegador com fixtures não comprovam consentimento OAuth, resposta real no Forms, execução Apps Script com IAM nem câmera/iPhone físico. Esses estados devem constar como pendentes até confirmação real. Scripts privados de auditoria e backups ficam em `.local-preview/`, fora do Git.

## Reaplicação e evidência de governança

Uma resposta por conta com edição bloqueada significa que uma nova aplicação com participantes anteriores exige cópia do formulário, novo ID e versão efetiva, mantendo a mesma matéria (`creditScopeId`). Não apagar respostas nem reinterpretá-las por uma versão nova. A configuração permanece pendente quando o mesmo Form já respondido tenta ser reaplicado.

A pontuação de governança compara conteúdo real dos componentes, independentemente de renumeração, renomeação, cópia administrativa ou troca de designação. Um novo arquivo Drive com conteúdo efetivamente novo é elegível; cópia idêntica, duplicação de URL e reordenação dos mesmos materiais não são alteração. Créditos e autores de revisões aprovadas permanecem históricos.

## Registro de preparação em produção — 03/10/2026

- Base Git preservada: `dd381642b8e52c8433ebba24560bb4ad65de5335`. As três modificações do checkout original permaneceram intactas.
- Rules publicadas no projeto `sahmt-17a16` e confirmadas pela leitura do release `cloud.firestore`: ruleset `3b3023ee-3eef-4b62-843c-6da6f172f774`, hash SHA-256 normalizado `4ce32f513c83f797ccccbafc4625ae63914c7dfa452fd17089f2fcaf06163074`. O CLI recebeu erros HTTP 503/409 intermitentes; a leitura independente confirmou a fonte efetivamente ativa. Não se assumiu sucesso pelo upload.
- Quatro novos índices confirmados READY: evaluationLedger(uid/category/createdAt), evaluationAwards(uid/category), evaluationRequests(status/createdAt) e checklistSignatureRequests(status/validatedAt). Nenhum índice existente foi apagado.
- Novas definições Apps Script e manifesto com Forms enviados e conferidos por pull independente. ChecklistValidation operacional foi preservado. Publicação de definições não confirma OAuth de execução, gatilhos ou modelo.
- Execução de configurarModeloAvaliacaoSahmtV2, reconciliação manual, configuração de matérias/designações/audiência e homologação com três contas distintas continuam etapas de execução. Nenhum gatilho novo foi ativado neste preparo.
- Leitor Spark e consumidor novo do Checklist permanecem preparados para corte posterior à homologação. O código operacional anterior foi preservado neste release. Sua execução autenticada, inclusive o consentimento necessário após a alteração do manifesto, não foi comprovada por essa preservação.

Materiais nativos com imagens, desenhos ou outros elementos sem bytes estáveis verificáveis ficam pendentes para revisão humana. URLs temporárias, IDs internos, título, ordem dos materiais ou mudanças de algoritmo de fingerprint não comprovam alteração efetiva. O conteúdo textual de todas as abas acessíveis de Docs é considerado.

## Ensaio isolado antes da ativação

1. Configure uma cópia privada de teste com título começando por `[HOMOLOGAÇÃO SAHMT]`. O original e o modelo reutilizável são recusados como fontes do ensaio. Cadastre e autorize três perfis reais independentes: participante comum, gestor designado e administrador/revisor. A configuração READY da cópia deve incluir exatamente esses três UIDs, os IDs reais dos itens, vigência e primeira elegibilidade.
2. Nas propriedades do Apps Script, defina `SAHMT_V2_EVALUATION_HOMOLOGATION_FORM_ID` com o ID verdadeiro dessa cópia. Faça respostas autorizadas somente dentro da vigência, sem pacientes. Não importe histórico do formulário original.
3. Execute `capturarHomologacaoAvaliacaoSahmtV2`. A função confere identidade VERIFIED, uma resposta por conta, edição bloqueada, papéis independentes e vigência. Grava somente um snapshot técnico privado em `evaluationHomologationInputs`. Não grava créditos, débitos, resumos, flags ou gatilhos. O retorno contém somente ID/contagens/pendências. O cliente PWA não tem acesso a essa coleção.
4. Exporte esse snapshot com a credencial administrativa já autorizada, para arquivo privado ignorado pelo Git. Execute o replay apenas com `--project demo-sahmt-v2`, em Firestore Emulator local. O script `scripts/evaluation-homologation.js --capture <arquivo-privado>` recusa projeto real, host externo, token de produção e requisição Google sem snapshot capturado. Os bloqueios financeiros são satisfeitos apenas no emulador, nunca por alteração das flags reais.
5. Execute `npm run test:evaluation-integration` para cenários fictícios e transações reais do emulador. Preserve os hashes dos fontes avaliados e o relatório agregado. Registre separadamente fixtures locais, captura de respostas Google reais, execução remota do Apps Script e validação autenticada no PWA: um estado não comprova os outros.
6. Somente com evidência real aprovada, configure os bloqueios de homologação e ative os gatilhos. O leitor Spark e o novo consumidor do Checklist devem entrar juntos com projeção contínua confiável; mantenha a revisão de origem e a fila offline existentes.
Execução manual observada às 14:43 de 03/10/2026: configurarModeloAvaliacaoSahmtV2 iniciou, mas a consulta de metadados Forms recebeu HTTP 403. A configuração real do modelo não foi validada. O diagnóstico distingue API desativada, escopo insuficiente e acesso negado; não é motivo para ativar pontuação ou ampliar IAM.

Diagnóstico remoto confirmado às 15:01 de 03/10/2026: forms.googleapis.com não está ativada no projeto consumidor Apps Script 134600706457, diferente do número Firebase 1072832154794. A ativação deve ocorrer no projeto consumidor correto. Caso ele seja padrão gerenciado e inacessível, revisar o vínculo GCP e consentimento antes de qualquer mudança; não ativar outra API, conceder IAM amplo ou habilitar Blaze por tentativa. Leitura atual de acesso: quatro identidades Google em Authentication, mas somente dois perfis users/{uid}; lista de emails de grupo não equivale a perfil com permissões SAHMT. Nenhum perfil foi criado nesta auditoria.
