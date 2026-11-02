# Coleta manual de FD por atividade

Pedido: reduzir leituras em FA, FB, FC e FE. Atualizações sem urgência; administrador escolhe atividade e momento. Manter apresentação atual, preparando controles reutilizáveis para a reorganização visual futura.

- Remover cron FD e manter scheduled sem coleta, inclusive durante propagação de remoção.
- Exigir ator Google autorizado em FA/FD e atividade explícita em REFRESH. Chamadas antigas sem atividade recusadas antes da leitura de fontes.
- Botão Sincronizar e atualizar por fonte/atividade, com última coleta e intervalo mínimo escolhido pelo administrador. Intervalo nunca agenda execução.
- Abrir/recarregar lê somente resumos FD e validações atuais de acesso. Não eliminar controles de revogação.
- Atualizar só métricas da fonte escolhida, mantendo datas e resultados das demais. Dependências obrigatórias: definições QMENTUM e estados de treinamentos.
- FA: filtrar date por ano no Firestore e paginar por date/__name__, sem varredura de outros anos ou coleções.
- Preservar resultados se consulta falhar ou for incompleta, sem substituir por valores parciais/zeros. Lease por atividade e transação de merge para concorrência.
- Conservar limite diário de quatro tentativas por grupo e intervalo mínimo de10 minutos; administrador pode alongar intervalo até30 dias pelos controles atuais.
- Nenhuma mudança em pontuação, login, billing ou dados de negócio. Backup protegido e conferência de bindings/segredos na publicação.

Verificação:41 testes de domínio/serviço/isolamento e3 verificações de navegador em320–1440px passaram. Consultas FA com filtro anual aceitas pelas três coleções, limitadas a1 documento por consulta de conferência. Sem índices adicionais.
