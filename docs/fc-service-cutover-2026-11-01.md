# Corte dos serviços FC e prints privados

Estado em 01/11/2026: Desempenho FC publicado no PR #146, merge
`12eef8669858f4805b0d1a9afd0d07093d8f0c0f`, PWA V2.6. O usuário confirmou
abertura com a sessão normal, 0 pontos e 0%. Há 58 resumos iniciais confirmados,
um acionador FC a cada 15 minutos, apenas ações posteriores a
`2026-11-01T21:03:40.652Z`, sem histórico importado nem sincronização para FB.
O corte seguinte preserva esse desempenho já ativo.

O usuário decidiu: “Sim, deixar as cópias apenas em FC”. Nenhuma permissão foi
concedida a FA ou às contas de gestão anteriores. O plano de preservar esses
leitores foi retirado. Os 20 PNG finais pertencem a
`anestesiahmtforms3@gmail.com`; os originais FA continuam preservados.

## Alterações propostas

| Recurso | Atual | Após aprovação |
| --- | --- | --- |
| Worker FC, conta `57b8b02c577b6f61e96a61ce44142d2e` | Três flags HTTP `false` | `FC_INTEGRATION_ENABLED`, `QMENTUM_WRITE_ENABLED`, `OCCURRENCE_SCORING_ENABLED` em `true`; mesmo código, namespace e segredos |
| PWA | Três clientes usam o endereço central | Origem `https://sahmt-fc-integration.anestesiahmtforms3.workers.dev` |
| Worker central `sahmt-auth-broker`, conta `1851e9f4cd5f026371beaa2c5a85f1b8` | Executa os handlers antigos FC | Módulo adicional encaminha somente as três rotas FC para clientes em cache |
| `qmentumUnits/sahmt/printConfig/current` | Duas pastas FA | Somente `folders.TECHNIQUES` e `folders.INDICATORS` passam às pastas FC, com precondição `updateTime` |

As rotas são `/v1/qmentum/write`, `/v1/qmentum/prints` e
`/v1/evaluation/occurrence`. A ponte usa destino HTTPS fixo, mantém o bearer
original, não envia cookies ou segredos centrais e não repete pedidos em
falha/redirect. FC valida projeto Firebase, permissões, HMAC, antirreplay e
idempotência. UID igual em outro projeto não autoriza a operação.

O Worker central publicado difere do checkout. Seu snapshot real protegido
será preservado byte a byte em `central-base.js`. `fc-compat-entry.js` importa
esse módulo, reexporta suas classes e envolve seu `fetch`. As demais rotas
continuam no módulo original. Nunca substituir esse snapshot pelo `worker.js`
central do checkout. O metadata acrescenta `global_fetch_strictly_public` para
o encaminhamento público entre contas, preservando os demais bindings e os
segredos por `keep_bindings`. Nenhum recurso pago é habilitado.

Clientes atualizados usam FC diretamente; apenas os clientes antigos conservam
a conta central no trajeto. A ponte deve ser retirada em uma liberação posterior,
após comprovar a atualização dos aparelhos.

## Referências e privacidade

| Campo | Original preservado | Destino privado FC |
| --- | --- | --- |
| `folders.TECHNIQUES` | `1wKCX9ZHPgZ3FPmHU_N12dNbAQ97BeelA` | `1GVmQD2T2ITlSDqtS-KsrHs0_QorJk_xK` |
| `folders.INDICATORS` | `1-wPMVdon2pCjjariPqYZ6tsweinaf3bA` | `1rpKUFmZ1sNZ1w31305kx48jW1WbEqSuI` |

O backend lê as imagens com a conta FC. Um link direto do Drive exige essa
conta; o acesso operacional no PWA é mediado pelo serviço FC e suas permissões.
Imagens, OCR e script não recebem compartilhamento público. Não migrar dados
de negócio do Firestore.

## Execução após aprovação

1. Relê código, bindings, configuração de prints, ACL e checksums. Aborta em
   caso de diferença em relação ao candidato protegido. Confirma Workers Free
   e Firebase sem billing; não habilita planos pagos.
2. Ativa as três flags no Worker FC. Verifica CORS, rotas, rejeição sem token
   e token de outro projeto, conservando código, namespace e segredos.
3. Publica o wrapper central com `FC_COMPAT_FORWARD_ENABLED=true` e
   `FC_COMPAT_PRINTS_READY=false`. Prints ficam temporariamente indisponíveis;
   QMENTUM write e Ocorrências seguem para FC. Confere as outras rotas.
4. Drena sete minutos de execuções antigas de prints. Não altera pausas de cota
   nem gatilhos das outras estações.
5. Atualiza somente os dois campos de referência, com máscara e precondição de
   `updateTime`; confere os demais campos e registra o `updateTime` novo.
6. Libera `FC_COMPAT_PRINTS_READY=true`, confere leitura real pelo executor FC
   e publica o PWA com a origem FC. Se o patch falhar, mantém prints bloqueados
   até concluir a recuperação. A atualização usa o fluxo normal do shell.
7. Confere SCAN/PREVIEW e uma ação identificável autorizada no PWA, permissões,
   ausência de crédito duplicado/FB e as outras estações. PREVIEW pode criar a
   prévia operacional e OCR temporário; não aplica indicadores históricos.
   Registra evidências e consumo.

## Reversão coordenada

Republicar primeiro a configuração anterior do PWA, mantendo o serviço FC,
a ponte central e as referências FC durante a atualização dos aparelhos.
Confirmar que os clientes ativos voltaram ao endereço central antes de bloquear
prints, drenar e restaurar os dois campos originais com precondição nova. Só
então restaurar o módulo central anterior. A conta FC não lê os originais FA:
um aparelho ainda preso ao endereço FC precisará atualizar o shell para voltar
a usar os prints. Uma reversão do frontend não reescreve bundles já instalados;
o rollback completo pode exigir essa janela de atualização. Não desligar o
serviço FC antes dessa conferência.

Se falhar apenas o wrapper, preferir corrigi-lo mantendo FC saudável. Preservar
créditos, recibos e gravações legítimas. Não reativar pontuação FC em FB, apagar
os 58 resumos ou interromper o acionador do Desempenho FC.

Backups protegidos incluem os Workers reais, metadata, candidato com os dois
módulos centrais, configuração de prints e patch inverso. Segredos não entram
no Git, PWA ou registros.

## Verificação e autorização

Os testes locais cobrem troca de endereços, sessão preservada, respostas
assinadas, rejeição entre projetos, rotas centrais preservadas, drenagem e
ausência de retry/fallback. A preparação verifica as 20 cópias privadas e os
Workers reais sem alterar produção. A validação integrada dos três serviços e
das novas referências continua pendente até o corte autorizado; o usuário já
confirmou o funcionamento real do Desempenho FC.

O pedido original exige resultado, testes e reversão antes da troca em
produção. A aprovação do PR #146 cobriu o Desempenho FC. A aprovação deste corte
deve abranger o wrapper central, a ativação HTTP FC, a publicação do PWA e as
duas referências Drive.

## Repetição em outra estação

Inventariar identidades, recursos e cotas; separar a conta executora e preservar
projeto/UID. Validar tokens do destino. Preparar cópias e referências com
rollback por precondição. Prever clientes em cache antes de retirar acessos
antigos. Isolar rotas por configuração fixa; nunca selecionar projeto por UID,
query ou localStorage. Conferir o snapshot publicado, obter aprovação do corte
e só retirar a ponte após comprovar a atualização dos clientes.
