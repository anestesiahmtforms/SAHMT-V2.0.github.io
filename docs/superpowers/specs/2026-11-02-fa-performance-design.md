# Desempenho FA exclusivo

## Objetivo e decisões confirmadas

Criar Desempenho FA no projeto sahmt-17a16, aproveitando o Apps Script central 1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD e a conta Cloudflare 1851e9f4cd5f026371beaa2c5a85f1b8. Pasta indicada: 1QaZ3-QOGXZruz-Rk8WkJdcG_mckSMS5-. Não habilitar billing. Preservar autenticação e login integrado FA/FB/FC/FD/FE.

Saldo começa em zero na ativação, sem importação de histórico. Somente administrador vê o botão e abre a consulta. Nenhuma soma ou transferência de pontos para FB ou demais instâncias.

Atraso: múltiplo 0 desconta 0,5; múltiplos 1 a 6 descontam respectivamente 1 a 6. Aplicar somente ao tipo normalizado ATRASO; o campo em OUTROS não gera desconto. O valor financeiro existente é independente e permanece com sua própria regra.

Checklist mantém a regra atual: conferência assumida por pessoa diferente do responsável gera +1 ao conferente e −1 ao responsável; assinatura própria gera zero. Uma obrigação por dia, sem duplicar pontos em novas revisões ou tentativas da mesma ciência.

## Abordagens

1. Reutilizar o livro evaluationAwards: exigiria mudar roteamento compartilhado com Gestão/FB e aumentaria o risco de misturar créditos. Não recomendado.
2. Livro FA dedicado no mesmo Firebase e processador adicional no Apps Script existente, com leitor dedicado na conta Cloudflare FA: recomendado. Permite reversão localizada e preserva os serviços operacionais.
3. Novo projeto Firebase ou nova conta executora: desnecessário para o pedido, que já disponibiliza a infraestrutura FA.

## Implementação proposta

Coleções próprias faPerformanceRuntime, faPerformanceReference, faPerformanceAwards, faPerformanceLedger e faPerformanceSummaries, sem acesso de escrita pelo navegador. Worker leitor somente leitura em FA, valida token do Firebase FA e perfil ativo com role administrador_app ou permissions.admin=true em cada consulta. Não alterar Workers de login ou seus segredos.

Interface dedicada em rota fa-performance, com botão na área Checklist apenas para administradores. Exibir saldo, créditos de Checklist, descontos por atraso, datas, origem e estado de confirmação. Saldos negativos são válidos. Proposta de apresentação: priorizar saldo absoluto; percentual apenas quando existir referência positiva, sem converter saldo negativo em zero.

O marco effectiveFrom é persistido uma vez. Para Checklist, exigir ciência solicitada e validada após o marco, com snapshot e responsável validados. Para atraso, exigir criação no servidor após o marco e data do evento igual ou posterior ao dia do marco. Registros sem timestamp confiável não são pontuados automaticamente. Usar a pessoa escalada como sujeito do desconto, não o autor do cadastro; sigla ambígua fica pendente até resolução segura.

Editar múltiplo, corrigir pessoa ou cancelar atraso reconcilia o lançamento existente por ID, com diferença registrada no histórico, sem duplicação. Pagar ou encerrar financeiramente o evento não remove automaticamente o desconto. Exclusão deve ser distinguida de falha de leitura: nenhuma reversão com consulta incompleta. Novo processamento usa snapshot consistente das fontes e publicação de revisão confirmada somente após todos os resumos.

Inicialização não deve bloquear ciência, eventos ou login se o processador de desempenho estiver indisponível. Rotina própria a cada 15 minutos, com limites de leitura/escrita e sem gatilhos duplicados. Adicionar arquivos específicos ao Apps Script remoto a partir de leitura do HEAD e verificação de hash; conservar manifest, arquivos não envolvidos, propriedades e acionadores de outras funções. Não mover o projeto central.

## Integração antiga e limpeza

Eliminar a entrega de Checklist para FB nos caminhos ainda utilizados, preservando a aceitação da ciência. Inventariar implantações versionadas: modificar HEAD não altera versões já publicadas. A nova projeção não depende do livro antigo.

Só remover trechos comprovadamente sem chamadas ativas. O Apps Script central ainda serve funcionalidades de outros módulos; sua presença no projeto FA não prova obsolescência. Não retirar autenticação, pontuação nativa FB, fluxos FC/FD/FE ou funções de Gestão por semelhança de nome.

## Conferência e publicação

Validar cálculo 0..6, atribuição ao membro correto, ausência de histórico, repetição, edição/reversão, ciência própria/terceiro, saldo negativo e bloqueio de usuário comum. Conferir dependências e login integrado sem criar pontuação artificial em produção. Primeiro ciclo real precisa confirmar resumos iniciais zerados antes de habilitar o leitor público. Publicar pelo GitHub Desktop e conferir revisão do PWA.

## Reversão

Esclarecimento confirmado durante execução: a correção de eventos admitidos não expira; mesmo anos depois, uma edição reconcilia a pontuação. Os 15 minutos representam somente o intervalo de processamento, nunca um prazo para editar. Eventos anteriores ao marco continuam excluídos quando editados.

Desabilitar somente o leitor e runtime FA e retirar seu acionador. Preservar o marco e registros emitidos para retomada. Restaurar apenas arquivos efetivamente alterados a partir de backup protegido, condicionado ao hash atual, sem sobrescrever alterações concorrentes. Não restaurar entrega externa de pontos automaticamente.

## Evidência inicial

Leitura em 02/11/2026: billingEnabled=false, 58 perfis habilitados, 42 eventos (24 sem createdAt) e 5 ciências de Checklist. Consultas completas nos limites utilizados, sem escrita e sem identificação pessoal no relatório. Histórico excluído conforme confirmação do usuário.
