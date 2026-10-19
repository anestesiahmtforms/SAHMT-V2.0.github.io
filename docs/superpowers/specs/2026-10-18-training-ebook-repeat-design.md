# Fluxo de treinamento com e-book e ciclos limitados

**Data:** 2026-10-18  
**Estado:** rascunho para revisão administrativa; ainda não é autorização de alteração remota.

## Objetivo

Cada treinamento começa pela leitura do material no contêiner do app. O formulário só é liberado quando o servidor confirma a leitura completa da versão vigente. Treinamentos amarelos podem ser refeitos, em ciclos completos, no máximo duas vezes adicionais; a maior nota fica registrada e uma repetição não gera novos créditos.

## Escopo

Inclui a experiência PWA de abrir e-book, concluir leitura, responder ao formulário, mostrar estado por versão e apresentar confirmação após o processamento do servidor. Inclui os contratos necessários no Apps Script e na projeção de participação para controlar tentativas e preservar a pontuação.

Não inclui leituras ou escritas reais durante esta etapa, edição remota de Google Forms, publicação, migração de respostas, alteração de acesso ou revisão da arquitetura de autenticação. O primeiro-login e o login Google atual permanecem intocados.

## Jornada

1. O participante toca no cartão do treinamento. O app abre o e-book em contêiner central, de leitura, com rolagem/paginação apropriada para celular.
2. O servidor entrega a versão aprovada e registra sessão vinculada a UID, formulário, número do ciclo, versão do treinamento e checksum do PDF.
3. O app só habilita **Continuar para avaliação** depois de receber confirmação do servidor de que todas as páginas foram visitadas dentro da sessão válida e a versão continua vigente.
4. O formulário é aberto a partir do botão e da permissão liberados após essa confirmação. O link independente não deve contornar o controle individual de acesso do Form.
5. Depois do envio, a tela mostra uma confirmação somente quando receber a participação processada para o mesmo UID/formulário/versão. Se o primeiro envio gerar créditos, o banner apresenta “Parabéns, [nome]” e “Você ganhou créditos!”. Em repetição sem créditos novos, a mensagem informa que a melhor nota foi atualizada, sem alegar novos créditos.

## Regras por versão

- Uma versão publicada contém exatamente cinco questões avaliativas pontuadas. Campos de identificação/e-mail, ciência e sugestões/contribuições são preservados e não contam entre as cinco.
- Para formulários com mais de cinco questões avaliativas, a proposta padrão é manter as cinco primeiras na ordem atual e listar as demais em uma prévia explícita antes de qualquer futura edição de Forms. Nenhuma edição remota é feita por este pacote.
- A primeira submissão validada por pessoa e versão é a única elegível para créditos daquela versão. Uma repetição não cria outro award.
- Uma tentativa subsequente só pode começar se o estado confirmado da versão atual estiver amarelo e houver menos de três ciclos iniciados. O limite é três ciclos no total: o ciclo inicial e até dois adicionais.
- Cada ciclo adicional repete leitura completa e questionário. O servidor rejeita ciclo duplicado, salto de ciclo, versão antiga, leitura de outro usuário e tentativas além do limite.
- O histórico mantém cada ciclo. A melhor nota numérica do participante naquela versão é preservada; as respostas e notas anteriores não são substituídas. A projeção usa a melhor nota e a conclusão do ciclo mais recente para calcular a cor.
- Nova versão publicada de material ou questões zera a contagem de ciclos para a nova versão e deixa o botão azul para todos até nova conclusão. A primeira resposta da nova versão pode gerar os créditos correspondentes novamente. Histórico e awards da versão anterior permanecem.

## Estado visual

| Estado confirmado da versão vigente | Botão | Permite iniciar ciclo |
| --- | --- | --- |
| Sem participação/leitura válida, ou versão revisada | Azul | Sim, ciclo 1 |
| Ciclo enviado incompleto, nota abaixo de 50%, ou leitura iniciada sem envio | Amarelo | Sim, somente se ainda houver ciclo disponível |
| Etapas completas e melhor nota igual ou superior a 50% | Verde | Não |
| Amarelo no terceiro ciclo | Amarelo | Não; informar limite de ciclos atingido |
| Dados pendentes, cache, falha ou resposta de outro UID/versão | Estado não confirmado; nunca verde | Não até confirmação |

A ausência de teste avaliativo só se aplica a atividades cuja configuração atual não exige teste; não deve ser inferida pela falta de nota.

## Integridade e dados

- Reusar o mecanismo de leitura e-book existente (sessão, páginas visitadas, UID, versão/checksum e comprovação no servidor), estendendo-o para chavear cada ciclo sem reaproveitar comprovante anterior.
- A autorização para responder ao Form é individual e vinculada ao comprovante do ciclo, UID e versão; o acesso direto continua bloqueado para quem ainda não concluiu a leitura.
- Limite de ciclos, estado amarelo e ausência de créditos em repetição são validados no servidor, nunca apenas no navegador.
- Guardar um registro imutável por ciclo, com identificadores estáveis e resultado processado; manter o award idempotente por UID/escopo/versão.
- Não armazenar respostas ou e-mails no cache local além do que o fluxo existente já exige. Nenhum token, URL assinada ou corpo de resposta vai para logs.
- O banner de parabéns usa nome do perfil atual escapado como texto; não altera permissões ou pontuação.

## Desempenho e indisponibilidade

- Reutilizar observadores/cache em memória que já estejam ativos para a sessão; evitar listener duplicado para o mesmo UID e atividade.
- Carregar PDF de forma sob demanda, sem incluí-lo no precache do shell. Encerrar a sessão e soltar memória/iframe ao fechar o contêiner ou trocar de usuário.
- Falha de rede não libera o Form nem conta visita/nota como confirmada. Preservar progresso confirmado do servidor e oferecer retomar o ciclo em andamento, sem criar outro ciclo implicitamente.
- Não fazer leituras reais no Firestore durante implementação ou validação local. Testes devem usar mocks/emuladores locais conforme o conjunto existente.

## Critérios de aceite

1. O cartão abre e-book antes do formulário em desktop e celular; o link de leitura não aparece no Form do participante.
2. Visitar todas as páginas, mas não confirmar no servidor, não libera o Form. UID, versão, checksum, sessão ou ciclo divergente são recusados.
3. A conclusão e envio do Form atualizam o estado somente após confirmação de servidor; submissões duplicadas não duplicam award.
4. Azul → amarelo/verde reflete leitura, envio, completude e nota; 49,99% é amarelo, exatamente 50% completo é verde.
5. Só amarelo permite ciclos 2 e 3; verde não; ciclo 4 é bloqueado; cada novo ciclo exige nova leitura.
6. Repetições não criam créditos extras, preservam maior nota e não sobrescrevem histórico; versão nova volta a azul e habilita nova pontuação por versão.
7. A mensagem de sucesso diferencia créditos novos de atualização de melhor nota.
8. Login e demais rotas funcionam sem mudança; feature permanece desativada até a configuração de cada atividade estar validada.
9. Testes e build locais usam dados sintéticos; nenhum serviço real é consultado ou modificado.

## Decisões submetidas à revisão

1. Confirmar que, nos Forms com mais de cinco questões avaliativas, a prévia deve propor as cinco primeiras pela ordem atual (campos de ciência/sugestões permanecem fora da contagem) e exigir confirmação administrativa antes de remover as demais.
2. Confirmar a mensagem alternativa nas repetições: “Parabéns, [nome]” e “Sua melhor nota foi atualizada”, já que não há créditos novos.
3. O banner aparece após confirmação de processamento no app; o app não tenta ler o conteúdo interno da página de confirmação do Google Forms.
