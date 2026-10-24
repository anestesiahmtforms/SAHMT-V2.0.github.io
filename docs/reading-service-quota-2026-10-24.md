# Indisponibilidade do leitor de Gestão

Em 24/10/2026, a inspeção pontual do Cloud Logging confirmou erros diários de
UrlFetch do executor do Apps Script, inclusive nas reconciliações de avaliação
a cada 5 minutos e de vínculos a cada 15 minutos. Os registros de leitura
mostravam `READING_BACKEND_FAILED`: a classificação anterior descartava a
exceção nativa sem status HTTP. A inspeção não leu documentos Firestore.

O limite é do executor do Apps Script, distinto da cota Firestore. A renovação
é controlada pelo Google. Esta correção não renova a cota, não comprova a
abertura de um PDF real enquanto o serviço estiver bloqueado e não demonstra
qual tarefa consumiu originalmente a maior parte da cota.

## Alteração

- Identificar especificamente a exceção diária de UrlFetch em português/inglês
  e o erro interno tipado, sem confundir 403, 429 Firestore ou limite curto.
- A camada `ReadSafety` já instalada no servidor passa a usar uma pausa por
  executor de uma hora após a falha real. Durante a pausa, chamadas Firestore
  que passam por essa camada não chegam ao UrlFetch. Não há timer de consulta:
  a próxima operação após a pausa pode tentar novamente e renovar a pausa se
  o Google continuar bloqueando. O prazo não é previsão de renovação da cota.
- Cache de usuário reduz consultas adicionais às propriedades. Nenhuma
  permissão, identidade, PDF, token ou resposta é armazenada nesse estado.
- A pausa aplica-se a essa camada Firestore, não a todo uso de UrlFetch por
  qualquer script da conta. Não é um contador global de faturamento.
- A UI informa o limite correto. A abertura `open` também é identificada nos
  registros sanitizados, sem imprimir mensagens privadas ou dados do pedido.
- `conferirServicoLeituraGestaoFbV1`, em `ServiceQuota.gs`, é diagnóstico
  manual restrito ao operador existente: no máximo uma consulta pública de
  certificados, sem ler Firestore e sem ignorar a pausa conhecida.

Permanece a conferência atual de autorização por documento, versão e usuário.
Nenhum formulário é liberado por causa da indisponibilidade; pendências,
políticas, recibos, UIDs e material permanecem preservados. Cache do shell v240.

## Validação

Regressões cobrem pausa, retomada sob demanda, limites distintos, autorização
do diagnóstico, protocolo assinado, erro sanitizado e ausência de repetição
automática no leitor. O teste de navegador usa PDF sintético, bloqueia acessos
externos e mantém o formulário indisponível diante da cota. A instalação do
servidor deve preservar as outras fontes e implantações; somente a implantação
de leitura FB recebe a nova versão.

Referência: <https://developers.google.com/apps-script/guides/services/quotas>.
