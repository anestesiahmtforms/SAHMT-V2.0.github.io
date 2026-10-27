# Estresse e fadiga — instrumento SAHMT e implantação FE

## Instrumento e fontes

Versão institucional 1.0, ciclo 2026. Fonte: [Forms SAHMT 2025](https://docs.google.com/forms/d/e/1FAIpQLSeSkJiYZGkuuu_g1CFpWGiSh47xk9l9D600dWXjb8c7hdOFHw/viewform), lido sem enviar respostas ou alterar o formulário. O original tinha 30 perguntas, 3 blocos e coleta de e-mail. A nova pesquisa não solicita e-mail ou login e não altera os documentos originais.

O usuário aprovou expressamente a mudança de 1–5 para **0–5**, com seis frequências: Nunca, Quase nunca, Raramente, Às vezes, Muitas vezes, Sempre. O período foi padronizado para os **últimos 7 dias**. Os 30 itens são obrigatórios para cálculo; lacunas nunca viram zero. Total 0–150; blocos 0–50; todos os itens na mesma direção.

Faixas fornecidas pelo usuário: 0–30 leve; 31–60 moderada; 61–90 alta; 91–150 muito alta. São faixas institucionais de orientação, não pontos de corte clínicos validados. A adaptação não é diretamente comparável à série de 2025 pontuada de 1–5. A pergunta opcional de estresse percebido 0–10 é independente, sem somar ao total e sem classificação clínica automática.

Grupo e atividade é obrigatório: Equipe, Residentes, Secretárias e Substitutos. Não há “Prefiro não informar” no grupo. A participação continua voluntária. Não coletar nome, e-mail, UID, IP, matrícula, idade, turno ou texto livre neste instrumento.

## Melhorias editoriais

O catálogo completo está em `stress-domain/schema.js`; o exportador produz uma versão para leitura/impressão. Preservou-se a estrutura de 3 blocos × 10 itens, reformulando linguagem, duplicidades e atribuições causais:

- Bloco físico: cabeça pesada, moleza, bocejos, lentidão corporal, sonolência, olhos cansados, movimentação, ficar em pé, necessidade de repouso e recuperação insuficiente. O item duplicado de cefaleia foi substituído por cansaço persistente após descanso.
- Bloco mental: esforço de atenção, interação por cansaço, irritabilidade, foco, preocupações que interrompem a concentração, memória, lapsos que exigem conferência, dificuldade de relaxar, energia para demandas e esgotamento.
- Sintomas físicos: cefaleia, ombros, costas, respiração, boca seca, voz, tontura, pálpebras, membros e mal-estar. Não se afirma que sintomas físicos tenham causa psicológica ou sejam necessariamente causados por fadiga.

Não há alegação de diagnóstico de estresse, burnout, doença, capacidade laboral ou afastamento. Mesmo pontuações baixas não descartam risco ou necessidade de avaliação. As orientações privilegiam descanso, apoio, organização do trabalho, acesso confidencial a cuidados e passagem segura de atividades quando necessário.

## Orientações institucionais

Os quatro PDFs foram consultados: [leve](https://drive.google.com/file/d/1msVZKfPWeLgN75ZGJw1Evl7aGYJ5oGWs/view), [moderada](https://drive.google.com/file/d/1xftCX1bepYxB0IfQVjFw7HaKNWm98qqc/view), [alta](https://drive.google.com/file/d/1CbFv9GVvSCoh7oh7AW0Ox2T77Csa3Ucb/view), [muito alta](https://drive.google.com/file/d/12I4imeELj7N7jrZ9fjZgzvBFW6Lo3m-M/view). O texto integrado usa as orientações fornecidas e esclarece que encaminhamento à neurologia, afastamento e reabilitação exigem indicação clínica individual — não são automáticos pela soma.

O resultado e a orientação da faixa aparecem imediatamente no aparelho, mesmo se a gravação ainda estiver em andamento ou falhar. O status de recebimento é separado da pontuação. Todos recebem o mesmo pacote de orientações e a mesma URL `/stress-orientacoes.html`, com os quatro materiais de referência, sem código de faixa na URL ou carregamento automático de PDF específico. Documentos Drive podem exigir suas permissões originais; as orientações principais ficam disponíveis no próprio FE sem login.

Referências conceituais: [AANA — fadiga, sono e jornadas](https://www.aana.com/file-download/patient-safety-fatigue-sleep-and-work-schedule-effects/), [NIOSH — fatores de estresse e burnout](https://www.cdc.gov/niosh/healthcare/risk-factors/stress-burnout.html). Essas fontes sustentam medidas de prevenção e organização do trabalho; não validam o índice adaptado nem as faixas do SAHMT.

## Segurança e sigilo

FE `outros-48120`, banco padrão existente, plano Spark; sem Cloud Functions ou novo faturamento. Coleções isoladas: `stressResponses`, `stressCycles`, `stressReports`. O questionário de clima e suas coleções permanecem separados. A configuração de deploy existente compila/publica ambos os instrumentos.

Cada resposta contém somente ciclo, versão, grupo, as 30 respostas numéricas e o estresse percebido opcional. ID aleatório de 128 bits, sem relação com a identidade. Escore e faixa não são aceitos como entrada: são recalculados a partir dos itens. Respostas incompletas, valores inválidos, campos extras e identificadores são negados pelas regras Firebase. Clientes não leem ou excluem respostas individuais; atualização só se exatamente idêntica. Não há garantia de uma resposta por pessoa nem de elegibilidade; o acesso público pode consumir quota por abuso.

A interface individual não importa Auth, Analytics ou persistência local. O envio usa `credentials: omit`, sem token ou referrer. O painel autentica separadamente no FE e lê somente `stressReports`, com a permissão agregada já concedida ao proprietário FE. O acesso administrativo por IAM pode ler dados brutos; restringir custódia, retenção, backups e exportações. Não usar os dados para punição, identificação de pessoas ou avaliação de desempenho.

Não há anonimato absoluto: Firestore, Hosting, Google e infraestrutura podem reter IP, horários, metadados e registros administrativos. O login do FA e os dados do aparelho podem permitir correlações. As limitações da auditoria de infraestrutura constam também em `CLIMATE-FE-DEPLOYMENT.md`; nenhum log foi apagado nesta implantação.

## Painel e proteção complementar

O painel é um snapshot final após fechamento. Mínimo de 5 envios para divulgação geral e por grupo. Secretárias permanecem sempre protegidas, pois são duas no universo institucional. Se os participantes nos grupos ocultados somarem 1–4, outro grupo elegível é ocultado, para impedir que geral menos grupos visíveis revele o grupo pequeno.

O geral mostra média total, médias das três dimensões e estresse percebido quando seguro. Gráficos comparam médias gerais, médias por grupo e dimensões. Não são armazenados no relatório nem exibidos histogramas por faixas ou percentuais de alta/muito alta, pois sua combinação com médias pode reconstruir células pequenas mesmo quando cada margem isolada parece segura. As faixas individuais continuam sendo calculadas e orientadas no aparelho. Dados protegidos nunca são representados como zero.

Por grupo, publicam-se apenas média total e médias das dimensões, nunca histogramas por faixa, percentuais de alta/muito alta ou rankings de respostas. Isso evita reconstrução de uma matriz grupo × faixa usando os totais gerais. O estresse percebido opcional recebe proteção própria pela quantidade de contribuintes e complementos; sua média geral é ocultada se a diferença para os grupos visíveis isolar 1–4 respondentes.

Oportunidades são propostas organizacionais baseadas nas médias de dimensões. Limiar de priorização proposto: 40% da escala de dimensão (20/50), explicitamente gerencial, sem significado diagnóstico. A gestão deve validar causas, escolher responsáveis e prazos e reavaliar em outro ciclo; a regra não prova causalidade.

## Operação e publicação

URLs: formulário `/stress.html`, orientações `/stress-orientacoes.html`, painel `/stress-painel.html`. Botão no FA: Governança → Enquetes e Consultas → Avaliação de estresse e fadiga. A sessão do FA não é transmitida no link.

```powershell
npm run build:climate
npm run test:stress
npm run test:climate-rules
firebase deploy --project outros-48120 --account anestesiahmtforms5@gmail.com --config firebase.climate.json --only firestore,hosting
node scripts/stress-admin.mjs open
node scripts/stress-admin.mjs status
```

`open` cria uma única vez o ciclo, sem reabrir um ciclo existente. Ao fim da coleta:

```powershell
node scripts/stress-admin.mjs close
node scripts/stress-admin.mjs publish
```

`publish` exige fechamento e proteção mínima de amostra, cria snapshot somente se ainda não existir e não expõe respostas no terminal. Não substituir snapshots publicados por versões sucessivas nem reabrir o ciclo; novas aplicações exigem novo ciclo. Definir institucionalmente responsáveis e prazos de guarda/descarte antes de uso continuado.

Os testes cobrem limites de todas as faixas, missing ≠ zero, estresse separado, validação e privacidade de payload, regras reais no emulador, reenvios idênticos, fechamento, permissões de relatórios, supressão complementar, histogramas protegidos, gráficos e resultado imediato antes da rede em quatro larguras de tela.
