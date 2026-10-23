# Limpeza final de Gestão e Desempenho em FA

## Validação do leitor

A PWA 223 e seus arquivos públicos foram conferidos após os checks e a implantação do GitHub concluírem. O usuário confirmou que o contador de leitura avançou no iPhone após encerrar as instâncias antigas do app. O backend do leitor permanece no projeto de Apps Script existente, com dados de Gestão e Desempenho em FB.

## Resíduos encontrados e tratamento

A primeira retirada já havia eliminado 417 documentos de negócio em FA. A contagem limitada por coleção encontrou mais 259 registros selecionados para revisão:

| Coleção em FA | Quantidade | Tratamento |
| --- | ---: | --- |
| `migrationOrigins` | 181 | Proveniência da migração antiga, arquivada em recuperação privada e removida |
| `trainingTemplateMigrations` | 76 | Comprovantes CONFIRMED ainda consultados pelo backend, copiados e conferidos em FB antes da remoção de FA |
| `managementRuntime/faConsolidation` | 1 | Controle da consolidação anterior, arquivado e removido |
| `managementRuntime/domainCutover` | 1 | Preservado: impede escritores antigos sem bloquear as áreas compartilhadas |

Os 76 comprovantes não são respostas dos participantes nem novos créditos. Suas cópias em FB preservam integralmente os campos. O backend da versão 37 passa a consultar essa coleção em FB quando a liberação independente está ativa. A configuração de autorização dos outros domínios permanece inalterada.

## Exclusão e conferência

- Recuperação privada salva e conferida antes do commit, fora do Git.
- Nenhum descendente encontrado nos 259 documentos inspecionados.
- Cópias dos 76 comprovantes em FB novamente verificadas por conteúdo antes da exclusão.
- Commit atômico de 258 exclusões em FA, cada uma com precondição de `updateTime` capturada.
- Contagem posterior: zero registros em `migrationOrigins`, zero em `trainingTemplateMigrations` e somente o controle preservado em `managementRuntime`.
- Total removido nas duas etapas: **675 documentos**.
- Usuários, configurações e áreas compartilhadas, QMENTUM e registros operacionais preservados. Nenhuma escrita em Forms ou pontuação nesta limpeza.

As áreas compartilhadas de FA ainda participam da autorização de comunicados. Não representam uma cópia operacional do módulo de Gestão. O controle de corte é mantido para impedir que clientes antigos recriem os dados removidos.
