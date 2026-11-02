# Desempenho FD e FE — design

## Intenção

Adicionar ao PWA SAHMT dois módulos independentes, **Desempenho FD** e **Desempenho FE**, usando as mesmas UIDs e o login automático já existentes. Cada módulo guarda pontos somente no projeto Firebase correspondente e oferece ao próprio usuário o saldo e o histórico. Nenhum ponto será enviado automaticamente a FB e nenhum histórico anterior à ativação será importado.

## Regras confirmadas pelo usuário

- **FD:** ciência de um indicador vale 1 ponto. Uma sugestão vale 2 pontos somente depois da aprovação por outra pessoa.
- Limite FD: uma ciência e uma sugestão por pessoa, indicador e ano.
- **FE:** cada participação aceita em uma pesquisa vale 1 ponto, independentemente do conteúdo ou das respostas.
- Limite FE: um ponto por pessoa, pesquisa e ciclo.
- Pontuações novas começam após um marco de ativação no servidor.
- Não há sincronização automática para FB nem importação de histórico.

## Recursos de destino

| Estação | Firebase | Cloudflare account informada | Pasta Drive informada para Apps Script |
| --- | --- | --- | --- |
| FD | `rotinas-8a617` | `434b7325287b58f36d214c9403819db2` | `19IYxC1Bbc_ZBIE8EPOegCrMpiN4q4hDR` |
| FE | `outros-48120` | `fb3d38f501820ddf90764aadaa94fc89` | `150uuRybtq-xkA8hlIRlJ11Pe5K00-0Jx` |

As pastas serão destinos separados para os projetos/artefatos Apps Script respectivos, se essa camada for necessária ao executor aprovado. Propriedade e permissões serão verificadas antes de criar arquivos. Os IDs, contas e billing atuais ainda precisam de conferência autenticada antes da implantação.

## Estado atual e integrações

- O PWA já configura sessões automáticas Google/Firebase para FD (`rotinas-8a617`) e FE (`outros-48120`) usando UIDs existentes.
- O app já tem **Desempenho FC** como exemplo visual e de leitura por projeto dedicado.
- O serviço de Indicadores FD mantém snapshots agregados e registra ações administrativas com `actorUid`; não oferece ainda ciência ou sugestão por usuário para cada indicador. O serviço atual restringe o acesso de leitura a administradores FA e perfis/permissões FD.
- O serviço de pesquisas FE já grava `surveyParticipation` por UID, tipo de pesquisa e ciclo, separado do documento de respostas. Os tipos atuais são clima, estresse e epidemiologia. O serviço aceita respostas autenticadas no PWA e não requer que o módulo de pontos leia conteúdo das respostas.
- Nenhuma regra de pontuação FD/FE ou livro de desempenho desses projetos foi encontrado.

## Abordagens consideradas

1. **Livro e módulo próprios por projeto, com ingestão server-side dos eventos — recomendado.** Mantém FD e FE isolados, reaproveita a arquitetura e os guardas do Desempenho FC, conserva os destinos Apps Script indicados e não confia no cliente para atribuir pontos. Os eventos são idempotentes e cada script só escreve no seu projeto.
2. **Atribuir pontos diretamente pelo cliente Firebase.** Foi descartado: o cliente poderia fabricar pontuação e as regras analíticas atuais de FD negam gravação direta.
3. **Apenas telas vazias/desligadas.** Foi descartado como resultado final porque não creditaria as ações que o usuário pediu.

## Comportamento proposto

### Desempenho FD

- Exibir indicadores agregados que o usuário já esteja autorizado a consultar. Não expor snapshots brutos, respostas de pesquisas, identidade de terceiros ou ranking nominal.
- A ciência e a sugestão serão vinculadas ao UID autenticado, ao identificador estável do indicador e ao ano. A interface não envia pontos.
- A ciência elegível recebe 1 ponto por submissão única.
- A sugestão começa pendente. Um revisor autorizado diferente do autor pode aprová-la ou recusá-la; aprovação gera 2 pontos, recusa gera zero. O autor não pode aprovar a própria sugestão.
- Sugestões devem continuar sujeitas às validações de texto já usadas no serviço FD, sem nomes, contatos, links ou dados de pacientes.
- A interface do indicador deve oferecer as ações aos perfis FD que tenham permissão explícita de leitura. Não conceder permissões novas em massa como parte deste design.

### Desempenho FE

- Exibir somente o saldo e o histórico do usuário autenticado no projeto FE.
- Uma participação de ciclo identificada pelo servidor gera um ponto por pesquisa, independentemente das respostas.
- O executor usa somente o marcador `surveyParticipation` ou um recibo separado sem conteúdo de respostas. Não copia, calcula nem exibe respostas individuais no livro de pontos.
- O escopo inicial se limita às pesquisas atualmente aceitas pelo serviço (`climate`, `stress` e `epidemiological`). Cadastro profissional, cadastro epidemiológico administrativo e escala final de ano não são tratados como pesquisas pontuáveis neste design.
- Marcadores anteriores ao marco de ativação não geram créditos.

### Apresentação comum

- Reutilizar o padrão visual do Desempenho FC: total confirmado, percentual relativo ao maior saldo confirmado do grupo autorizado, e até 200 lançamentos recentes do próprio usuário.
- Ocultar informações pessoais, nomes e IDs de origem na tela.
- Mostrar estados de carregamento, preparação, pendência, offline e acesso bloqueado sem tratar ausência de dados como erro de autenticação.
- Abrir as telas por rotas novas `fd-performance` e `fe-performance`, sem alterar os destinos de FA, FB ou FC.

## Dados e segurança

- Coleções próprias por projeto, com prefixos `fdPerformance*` em FD e `fePerformance*` em FE; nunca compartilhar o mesmo ledger.
- Recibos idempotentes são derivados do projeto, UID, modalidade, indicador/ano ou pesquisa/ciclo. Reenvios não repetem créditos.
- O servidor confere projeto, UID atual, perfil ativo, acesso, permissão e marco temporal. O cliente não decide o valor dos pontos.
- O livro FE armazena apenas modalidade de pesquisa, ciclo, UID e metadados mínimos de crédito; não guarda respostas nem referência ao documento de resposta.
- Não apagar ou reescrever saldos existentes, não copiar perfis ou UIDs e não criar permissões de acesso cruzado FD↔FE.
- Nenhuma cobrança ou plano pago é permitido. Se a arquitetura exigir billing, a ativação para e uma alternativa gratuita é apresentada.

## Implantação e reversão

- Confirmar contas e identidades autenticadas, Worker(s), Apps Script(s), permissões atuais das pastas Drive e ausência de billing.
- Preparar backend e UI desativados, regras Firestore aditivas e coleções novas sem tocar nos dados existentes.
- Preservar código e contratos dos Workers centrais; encaminhar somente rotas comprovadamente necessárias para cada estação.
- Criar os projetos Apps Script de FD e FE nas pastas indicadas apenas após confirmar propriedade, autorização e necessidade técnica do executor. Cada implantação deve provar o projeto, a conta executora e o Firebase fixo de destino.
- Usar flags independentes e marco de ativação por projeto. Instalar os processadores sem duplicar acionadores; validar ciclos e recibos com provas sem dados clínicos/operacionais artificiais.
- Antes da troca em produção, mostrar o plano concreto de implantação, os resultados das verificações, os IDs finais, o período de drenagem quando necessário e a reversão. Aguardar uma única aprovação final para o corte.
- A reversão desativa novas entradas/créditos e restaura somente encaminhamentos/configuração que pertençam ao corte. Não apaga pontos legítimos já creditados nem mexe em FB.

## Critérios de aceitação

1. Um usuário autenticado vê cada módulo somente com sua própria UID e o projeto correto.
2. Em FD, a mesma pessoa recebe no máximo 1 ponto de ciência e 2 por uma única sugestão aprovada por outro revisor, para o mesmo indicador/ano.
3. Em FE, uma resposta aceita gera exatamente 1 ponto por usuário/pesquisa/ciclo, sem inspecionar o conteúdo da resposta.
4. Reenvios, mudanças de sessão, UIDs duplicadas em projetos diferentes ou requests com projeto/rota incorretos não duplicam nem transferem créditos.
5. Saldo, ledger e percentual são confirmados no Firebase correto; nenhuma gravação acontece em FA/FB por efeito desses módulos.
6. Login automático permanece, e as telas antigas de FA/FB/FC continuam funcionando.
7. O PWA publicado é validado pelo SHA/versão e pelo fluxo autenticado real.
8. Billing permanece desligado; nenhuma pontuação histórica é importada.

## Decisões ainda sujeitas a revisão no documento

- O acesso FD se mantém limitado a perfis com permissão existente `managementIndicatorsRead` ou `managementIndicatorsWrite`; não há concessão em massa.
- O relatório FE não inclui ações fora dos três tipos de pesquisa atuais.
- A camada exata de recebimento/execução (Worker e Apps Script por estação ou adaptação mínima dos serviços atuais) será definida após inventário autenticado, priorizando isolamento, idempotência e nenhum efeito em outras estações.

Este documento descreve o desenho para aprovação. Nenhum código de produto, regra Firestore, Worker, Apps Script, gatilho ou dado de produção foi alterado para FD/FE.
