# Registro mensal por dois prints

Gestores com concessão FC `manager` podem usar **Entrada por prints** no Registro de Indicadores. A competência selecionada permanece fixa durante a operação. O gestor escolhe a tabela de técnicas e o painel de indicadores, ou usa **Usar Drive → Sincronizar alterações** para consultar as pastas institucionais configuradas no servidor. Cada imagem deve ser PNG/JPEG de até 2 MB.

A leitura prepara uma prévia editável. **Procedimentos anestésicos** usa o **Total geral** da tabela; **procedimentos cirúrgicos** usa o **Total de registros** do painel. São totais independentes. A distribuição individual das técnicas contabiliza cada componente das associações; **Outra Técnica** contribui para sedação e bloqueio regional. Esses componentes não substituem o total anestésico do relatório.

Os eventos e DM/hiperglicêmicos alimentam os campos existentes. Nenhum caso de intoxicação é convertido em manejo efetivo, nenhum paciente diabético é convertido em controle glicêmico efetivo e dados ausentes, incluindo cefaleia, permanecem pendentes. Os dezoito indicadores e seus critérios não são alterados.

A gravação exige **Confirmar importação**. Valores manuais divergentes exigem uma escolha explícita entre manter o manual ou usar a fonte. Campos não fornecidos são preservados. Rascunhos locais precisam ser salvos antes de abrir outra importação. Uma confirmação repetida devolve o recibo anterior, sem duplicar o lançamento. Competências fechadas permanecem protegidas e alterações concorrentes exigem nova conferência.

## Fontes e persistência

Tudo permanece no FC `indicadores---sahmt`, banco `(default)`, na unidade existente. Meses e históricos continuam em `qmentumUnits/{unit}/months/{period}`. Configuração, prévias, baselines e recibos são privados no servidor; não foi aberto acesso direto dos clientes nem criado outro banco. As fontes nunca são alteradas ou removidas.

A configuração vincula os dois papéis de origem às pastas, fixa o ano dos nomes antigos `MM.png` e aceita `AAAA-MM.png` para novos anos. Períodos anteriores a julho de 2026 são excluídos deste fluxo. Arquivos duplicados ou pares incompletos bloqueiam a prévia correspondente. A consulta usa metadados e hashes para ignorar conteúdo igual; não há agendador automático. Uma simples mudança de metadados, com bytes idênticos, atualiza apenas a referência da fonte, sem nova revisão mensal.

A leitura usa OCR do Drive através de documentos temporários privados, descartados após a extração. Rótulos, linhas e totais precisam ser reconhecidos sem ambiguidade; colunas achatadas, técnicas desconhecidas e totais incompatíveis não são adivinhados. Nessas situações, o gestor pode corrigir a origem ou usar a entrada manual. A prévia conserva o texto extraído, a identidade das fontes, as correções confirmadas e o responsável no registro privado de auditoria.

O total anestésico explícito e sua origem são opcionais no esquema de entradas para preservar os documentos antigos. Janeiro–junho não são regravados. Quando ausente nos registros anteriores, o agrupamento histórico permanece como antes.

## Validação e instalação

O código exige sessão FC ativa, perfil liberado, papel de gestor, unidade autorizada e módulo habilitado tanto no relay quanto no servidor. A imagem é validada por tipo, assinatura e tamanho. O backend usa domínio HMAC específico e proteção contra replay. Antes de aplicar, confere o snapshot da fonte; mês, histórico, baseline, recibo e condições de autorização são confirmados juntos com controle de versão no FC. Uma alteração posterior do Drive aparece na próxima consulta.

O Apps Script recebe `QmentumPrintCore.gs` e `QmentumPrints.gs`, o motor compatível `QmentumCore.gs` e a nova rota no dispatcher existente. A implantação FC é atualizada preservando as outras implantações. O Worker recebe somente a nova rota autenticada; seus bindings e segredos existentes são preservados. As pastas e qualquer prévia com números institucionais ficam fora do repositório. A publicação normal calcula a próxima versão do app; não dispara campanha obrigatória de atualização.
