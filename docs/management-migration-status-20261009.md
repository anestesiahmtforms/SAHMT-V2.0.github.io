# Continuação da migração de Gestão em 9 de outubro de 2026

Esta é a evidência de preparação no branch `codex/management-firebase-split`.
O projeto FA é `sahmt-17a16`; FB é `sahmt-gestao-5ae66`. Não houve cópia produtiva,
importação Auth, concessão de acesso/pontos ou ativação da PWA em FB nesta etapa.

## Resultado concreto

- Revisão dos backups protegidos: 134 cópias propostas e 231 registros mantidos
  em FA. São dados históricos das capturas, não uma leitura atual do catálogo.
- CLI `scripts/management-migration.mjs`: revisão local sem credenciais; cópia
  exige cápsula protegida, pins, evidência fresca e destino fechado.
- REST: leitura consistente de pares, criação atômica com `exists:false` em ambos,
  conferência de documento/proveniência, sem sobrescrita ou repetição automática.
- Persistência: checkpoints e reservas cifrados com DPAPI, lock exclusivo,
  atualização atômica e retenção obrigatória diante de falha ou commit incerto.
- Orçamento de FB separado, finito e ligado ao plano. Não usa a pausa ou a
  medição de FA como seu consumo. Não representa limite exato do app.
- Proposta privada de permissões: 60 perfis, um administrador geral designado,
  uma exceção preservada e 58 intenções de usuário comum. Nenhum grant efetivo.
- Ponte dedicada de Auth e adaptador Firestore do broker preparados e
  desativados, com deadlines, revogação, CAS/fence e reservas anteriores às APIs.

## Verificações atuais e limites

Em 9/10 às 12:38:36 UTC, o preflight somente de metadados de FB verificou sete
checks: projeto/principal, banco Standard/Native `(default)` em São Paulo,
faturamento desabilitado, Google e domínio da PWA, além das Rules publicadas
iniciais fechadas. Nenhum documento foi lido por esse preflight.

Às 12:38:33 UTC, a avaliação somente de Monitoring de FA confirmou 1.696 leituras,
com último ponto às 12:36:00 UTC. Esse valor é **histórico**. A tentativa de nova
captura detectou a métrica vencida e parou antes de carregar credenciais ou ler
documentos. A pausa de FA ficou retida para revisão sob o limite de 45.000.
Não houve nova consulta de documentos da origem nesta continuação.

A conta Cloudflare reconheceu a sessão OAuth e o Worker de Etiquetas existente.
A API de subscriptions respondeu 403; o plano efetivo de hospedagem do novo
broker não foi confirmado. Não houve deploy, criação de secret, ajuste de
faturamento ou alteração do Worker existente.

Após a nova confirmação humana de continuar, a avaliação às 13:33:29 UTC retornou
1.698 leituras, mas o último ponto era 13:05:00 UTC (`fresh:false`). Foi apenas uma
consulta de Monitoring; nenhuma captura foi admitida e a pausa permaneceu. O valor
não prova margem atual. A captura atual de Uso da origem continua pendente.

## Validação local

1.581 testes dos módulos de Gestão e dependências passaram com fixtures/adaptadores locais; o build
passou. As 12 verificações de `management-destination.rules.test.js` passaram em
emulador Firestore no projeto demo. A revisão independente não encontrou novo
bloqueante para disponibilizar este pacote desativado em PR preparatório.

Essas provas não confirmam migração real, IAM/assinatura do broker, login FB,
revogação entre projetos, fluxo de dispositivo autenticado ou operação em Safari.
Logs e recibos protegidos ficam em `.local-preview/management-split`, fora do Git.


O helper `ManagementMigrationInventoryNative.gs` foi acrescentado ao editor
Apps Script em 9/10 às 13:40 UTC. O readback confirmou 17 arquivos e preservação
exata dos 16 anteriores, inclusive manifesto e escopos. A função
`consultarInventarioMigracaoGestaoNativaSahmtV2` foi executada pelo usuário às 13:43:16 UTC e confirmou 232 funções, sem divergência e sem leituras Firestore. Sua
cobertura é limitada aos 12 módulos conhecidos e gatilhos do usuário executor;
`complete:false` não pode ser convertido em inventário global completo.

## Próximas condições de operação

1. Conferir a captura atual de Uso → Leituras de FA e admitir uma nova captura
   completa sob margem confiável. A renovação da cota não remove uma pausa.
2. Obter observações atuais dos produtores configurados: Apps Script, PWA e
   Functions. Inventário do usuário executor não certifica ausência global de
   gatilhos; nenhum gatilho é removido por inferência.
3. Reconciliar deltas de dados/Auth/ACL e produzir a cápsula a partir das capturas
   reais. Não criar horários ou booleanos convenientes para passar nos gates.
4. Executar e conferir a cópia fechada; completar identidade, direitos e host do
   broker; validar as sessões e a experiência autenticada antes de ativar FB.
5. Obter validação humana da migração antes de interromper escritores antigos FA.

FA permanece preservado. Desempenho permanece em FA e a consolidação preparada
exige origem confiável para não duplicar eventos migrados. O rollout anterior de
75 treinamentos continua cancelado; nenhuma janela ou gatilho é rearmado.
