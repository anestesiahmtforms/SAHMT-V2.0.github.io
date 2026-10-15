# Capacidade e limite de custo

FA e FB foram consultados pela API de faturamento: HTTP 200, sem faturamento vinculado. Ambos usam Firestore Native `(default)`, `southamerica-east1`. Nenhum setter de billing ou ativação Blaze integra as ferramentas desta consolidação.

A [cota gratuita oficial do Firestore](https://firebase.google.com/docs/firestore/quotas) é diária, renovada pelo horário do Pacífico; o limite não deve ser confundido com janela móvel de 24 horas. Consultar a documentação antes de alterar os limites internos. Não usar exportação gerenciada, PITR, TTL ou Cloud Functions como requisito da cópia.

Medição de 15/10/2026 16:34:26 UTC, desde 07:00 UTC:

| Recurso | FA | FB |
| --- | ---: | ---: |
| Leituras | 13.982 | 3.698 |
| Gravações | 28 | 63 |
| Exclusões | 0 | 0 |
| Armazenamento de dados e índices (bytes) | 5.210.801 | 6.005.626 |

Os pontos de monitoramento têm atraso de alguns minutos. Isso confirma margem para a cópia pequena neste dia, sem provar o consumo futuro de 55 pessoas. A ferramenta exige nova evidência com até 30 minutos, mesmo dia de cota, leituras abaixo de 35.000 e gravações estimadas abaixo de 15.000; acima disso interrompe. A cópia conferida envolve 424 gravações mais controles, leituras e verificações; nenhum documento de origem é excluído.

Os 28 índices FB já existem entre os 48 índices FA, todos READY no levantamento. Não criar índices adicionais nem substituir definições em massa.

As [cotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas) continuam relevantes a Forms/relatórios. A consolidação retira o caminho de autenticação secundária de Gestão/Desempenho; não transforma a rotina em serviço sem cotas nem comprova, por si só, tempos de resposta no iPhone.
