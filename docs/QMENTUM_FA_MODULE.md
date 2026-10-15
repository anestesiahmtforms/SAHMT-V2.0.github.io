# Indicadores obrigatórios QMENTUM — implementação local em FA

## Estado em 15/10/2026

Branch `codex/qmentum-fa`, worktree `C:\Users\SAHMTIA\.codex\worktrees\unificacao-fa\FIRESTORE`.
Implementação anterior recuperada da outra worktree, sem modificá-la. O novo módulo usa exclusivamente o Auth e o Firestore existentes de `sahmt-17a16`, banco `(default)`. O adaptador verifica explicitamente o projeto tanto no Firestore como no Auth, o token FA, o UID do perfil e `active/access`. Não há login adicional, lease, fallback FB/FC, Worker novo ou chave administrativa.

Entrada: **Gestão → Coordenação Clínica → INDICADORES OBRIGATÓRIOS QMENTUM**. Não foi criado outro botão na Home. A pausa de Gestão/Desempenho para usuários comuns permanece. Inicialmente, a rota administrativa também exige administrador; os papéis específicos do QMENTUM continuam sendo conferidos independentemente pelas Rules. Ser administrador não cria concessão nem autoriza uma unidade automaticamente.

**Instalação autorizada em 15/10/2026, mantida desligada:** quatro documentos de configuração, dois índices novos e três arquivos de backend foram instalados. O manifesto e os 24 demais arquivos Apps Script foram preservados; somente o ciclo existente recebeu um passo opcional de participação QMENTUM. Nenhum novo acionador foi instalado. IA e importação histórica permanecem desligadas. As Rules QMENTUM foram criadas/compiladas pelo serviço, mas sua ativação recebeu HTTP 400. Um controle com conteúdo idêntico às Rules anteriores foi aceito, preservando as permissões existentes. As variantes de reorganização e compactação também foram recusadas; não demonstraram uma correção e não foram incorporadas. A configuração continua `enabled=false`, e a publicação da PWA permanece suspensa. A versão 195 está preparada; não confundir testes em emulador com gravação real autenticada. Evidência sanitizada: `artifacts/qmentum/installation-state.json`. PR #42 contém o módulo e os testes.

## Entrega e persistência

`src/qmentum-*`: catálogo QM01–QM18, motor determinístico, gráficos SVG com tabela acessível, entrada mensal, histórico, importador XLSX, exportação CSV e interface no padrão visual de Eventos. Apenas a área central rola; HOME e rodapé do modal ficam acessíveis. Há data/competência, rascunho isolado por UID/unidade/mês, revisão, fechamento, reabertura justificada, controle de versão e proteção contra concorrência. O calendário não duplica meses.

As únicas metas iniciais são 95% e 98%, originárias da planilha, ainda não aprovadas. Não há meta inferida. Ausência, zero, não aplicável, taxa informada, provisório, seguimento pendente e inconsistência são distintos. D=0 nunca gera 100%. Períodos são ponderados por N/D compatíveis, sem média simples de taxas. QM14 não substitui procedimentos únicos por episódios. Mortalidade com seguimento pendente não é zero validado. Somatórios legados e fórmulas originais permanecem identificados.

Namespace FA:

| Caminho | Controle |
| --- | --- |
| `qmentumConfig/current` | habilitação e definição vigente; criação pelo operador |
| `qmentumAccess/{uid}` | papel collector/reviewer/manager e unidades; cliente não concede acesso |
| `qmentumDefinitions/{version}` | versões imutáveis e comprovantes de validação |
| `qmentumUnits/{unit}/months/{AAAA-MM}` | entrada mensal única e resultados |
| `.../history/{version}` | cópia imutável no mesmo commit |
| `.../validation/{version}_{grupo}` | 12 comprovantes atômicos de validação |
| `qmentumUnits/{unit}/imports/{hash}/cells/{parte}` | lote e proveniência em partes |
| `qmentumUnits/{unit}/quarterlyAnalyses/{signature}` | análise gerada, versões e revisão |
| `qmentumQuarterlyJobs/{id}` | fila privada do backend |
| `qmentumEvidence/{indicatorId}` | evidências verificadas, validade, URLs e sínteses privadas |
| `qmentumQuarterlyQuota/{dia}` | reserva durável de chamadas gratuitas |
| `qmentumAnalysisReviewRequests/{id}` | pedido imutável; conclusão exclusivamente pelo backend |

Um salvamento mensal usa 14 documentos: mês, histórico e 12 comprovantes. Essa distribuição respeitou, nos testes, os limites de expressões e acessos das Rules. N/D, razão, estado e versões essenciais são validados nas Rules. Metadados derivados recebidos do cliente **não são certificados**: repositório, UI e backend recalculam a partir das entradas e definições imutáveis antes de utilizá-los. Teste específico comprova descarte de meta/origem/pendência adulteradas. Definições clínicas aprovadas significam validação institucional, não acreditação comprovada.

`firestore.qmentum.rules` é a composição local do arquivo FA atual com os blocos exclusivos QMENTUM. O gerador localiza funções por coleção, sem ampliar a árvore global ou abrir curingas recursivos. Preserva os blocos de Ocorrências, Gestão, Desempenho e operações atuais. **Antes de publicar**, recompor sobre o release FA realmente instalado, preservando também o gate de consolidação que existe no release remoto. Não publicar cegamente um arquivo que contenha apenas o fragmento QMENTUM.

`firestore.qmentum.indexes.json` contém os índices adicionais e isenções de mapas grandes. Mesclar com os índices FA atuais; não remover índices dos outros módulos. As consultas são limitadas por unidade/ano (12 meses), histórico (30 versões) e análises (10 versões); nenhum listener global é criado.

Para recompor sobre uma cópia privada do release real, sem substituir o arquivo-base do repositório: `node scripts/build-qmentum-rules.mjs --base "CAMINHO_DA_COPIA_REAL_FA.rules" --out "CAMINHO_DA_COMPOSICAO_PRIVADA.rules"`. O comando apenas gera o arquivo; não publica.

## Fonte real, ano e unidade

Unidade **SAHMT**, ID local estável `sahmt`, confirmada pelo usuário. Ano **2026** confirmado para os bytes da fonte histórica. Fonte Drive informada: `15Ggyw33Hr4p3_p74vBxk_xpvTEpfG-L0HY6Q8bvtdFo`.

A exportação XLSX já preservada localmente foi analisada sem modificar o Drive:

- SHA-256 `d0857e203e2ea566debb7eb8dfea29b52e6d6115d2e0ac214c115f4285bd5fb1`.
- Abas `ANESTESIAS`, `TAXA ` (espaço final), `OUTROS INDICADORES`.
- Seis meses com entradas, janeiro a junho de 2026; julho–dezembro não viraram zero.
- 17 divergências/pontos de revisão conservados, sem correção silenciosa.
- Os dois indicadores excluídos ficam apenas na preservação da fonte, fora do catálogo e relatórios ativos.
- Arquivo, valores brutos/tipos/formatos, fórmulas, fórmulas compartilhadas e caches preservados fora do Git.

Pasta privada: `%LOCALAPPDATA%\SAHMT\qmentum-fa-20261015`.
Contém `import-preview.json`, `source-map.json`, XLSX identificado pelo hash, `quarterly-dry-run.json`, `manifest-private.json` e `bootstrap-private-preview.json`. O plano privado prepara uma unidade e **uma concessão de gestor para o administrador funcional já identificado**; não concede acesso a outras pessoas nem grava perfis gerais.

```powershell
node scripts/prepare-qmentum.mjs --file "$env:LOCALAPPDATA\SAHMT\qmentum-source\INDICADORES-QMENTUM-export.xlsx" --out "$env:LOCALAPPDATA\SAHMT\qmentum-fa-20261015" --year 2026 --unit sahmt --manifest "$env:LOCALAPPDATA\SAHMT\qmentum-fa-20261015\manifest-private.json"
```

Esse comando é exclusivamente local. O hash conhecido recebe 2026; atribuição divergente é rejeitada. Outros arquivos continuam exigindo ano explícito. A ativação real exige prévia, backup e confirmação administrativa. Reimportação do mesmo lote é idempotente; competências manuais ou de outro lote não são sobrescritas. Falha parcial permite retomar o mesmo arquivo. A fonte original não é alterada.

## Análise trimestral e IA

`src/qmentum-quarterly.js` calcula trimestres civis em America/Sao_Paulo. A prévia histórica produziu **36 tarefas**, das quais duas têm estado `NO_DATA`, sem chamada clínica inútil. Dados parciais e taxas informadas sem N/D não são convertidos em uma taxa trimestral falsa. Mudança em outro indicador do mesmo documento não regenera todos os indicadores: a assinatura depende dos dados relevantes, mantendo versões de origem na auditoria.

`server/qmentum-quarterly-worker.js` oferece executor com store transacional injetável e adaptador Gemini. `apps-script-v2/QmentumCore.gs` é gerado do mesmo motor por `build-qmentum-backend.mjs`; `QmentumQuarterly.gs` é o executor concreto para o Apps Script operacional existente. Ambos estão **somente locais**. O manifesto existente não foi alterado.

O processamento tem fila persistente, debounce de dois minutos, lock, reserva diária, no máximo seis chamadas/dia, duas tarefas por ciclo, três tentativas por tarefa, backoff e CAS. Verifica os dados antes e depois da IA e usa precondições dos meses existentes/ausentes ao publicar. Não publica uma resposta antiga como atual. Não há fallback pago ou template rotulado como IA. O resumo mensal é identificado como determinístico.

Somente dados agregados e evidências selecionadas vão à IA: sem nome institucional, profissionais, UIDs, comentários livres ou prontuários. Saída: dois parágrafos de até 340 caracteres, sem URLs, números não presentes no contexto ou alegação de significância/causalidade. A exibição foi testada para até 15 linhas por parágrafo em largura padrão; ampliação de texto preserva conteúdo e rolagem, sem line-clamp.

As referências recuperadas anteriormente são **candidatas à revisão**, não autorização automática para declarar evidência clínica válida. `node scripts/prepare-qmentum-evidence.mjs --read-public` conferiu 11 fontes públicas para os 18 indicadores e gerou `evidence-candidates-private.json`, sem enviar métricas privadas. Disponibilidade HTTP não é validação científica: redirecionamentos, HTTP de erro e pertinência clínica continuam identificados para revisão; nenhum registro foi promovido automaticamente a VERIFIED. O executor só usa `qmentumEvidence` com `status=VERIFIED`, versão, prazo e metadados completos. Sem evidência válida: `EVIDENCE_PENDING`, sem texto clínico inventado. Fonte indisponível pode usar a cópia verificada ainda vigente. URLs e sínteses ficam no catálogo privado; não há lista bibliográfica no painel.

Gemini fica configurável, sem modelo obsoleto fixo no código. Conferir a disponibilidade real do modelo gratuito para a conta antes da ativação. As páginas oficiais consultadas em 15/10/2026 indicam que a geração gratuita e as quotas dependem do modelo/conta; o conteúdo do plano gratuito pode ser utilizado para melhoria de produtos. Grounding não é presumido gratuito e não é enviado no request:

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/structured-output

Propriedades futuras, exclusivamente privadas do Apps Script:

| Propriedade | Condição |
| --- | --- |
| `QMENTUM_QUARTERLY_ENABLED` | ausente/false até autorização |
| `QMENTUM_GEMINI_API_KEY` | chave da conta/projeto confirmado, nunca no PWA/Git/Firestore legível |
| `QMENTUM_GEMINI_MODEL` | modelo realmente disponível em free tier |
| `QMENTUM_AI_FREE_TIER_PROOF_JSON` | `{projectId:"sahmt-17a16",billingEnabled:false,termsAccepted:true,accountModelVerified:true,model:"modelo confirmado",expiresAt:epochMs}` após conferência externa |

O registro de conferência **não é uma trava do provedor contra faturamento**: a garantia depende de manter a conta/projeto da chave sem billing. Expiração bloqueia o executor; não há habilitação automática. Nenhuma chave ou prova foi criada/instalada. Não foi executada chamada real à IA porque falta configuração aprovada.

Após configuração e autorização, `instalarAgendadorQmentumV1()` instala **um acionador horário**, idempotente. `executarCicloQmentumV1()` reconcilia meses persistidos, fila e revisões, funcionando com o app fechado. Antes da instalação, não há automação externa ativa; não existe setInterval fingindo execução em segundo plano. Inicialmente há limite de três unidades e 120 competências por unidade, com bloqueio explícito acima disso. Para SAHMT com seis meses, a reconciliação horária representa aproximadamente 1.000 leituras/dia, além de usos normais e processamento; conferir a cota total antes de instalar. Não é polling da planilha de Eventos/Etiquetas/Checklist.

Propostas são pendentes de revisão humana. Revisor/gestor pode enviar confirmação pelo painel; as Rules só permitem criar pedido pendente. O executor valida novamente perfil, unidade, assinatura e dados antes de registrar `REVIEWED` e histórico. A proposta não vira ação executada ou protocolo aprovado automaticamente. A transformação em plano acompanhado deve ser deliberada pelo gestor nos Planos de Ação existentes, sem criação automática de obrigações.

## Validação e ativação futura

Comandos locais:

```powershell
npm run build:qmentum-backend
npm run test:qmentum
npm run test:qmentum-rules
npm run test:domain
npm run build
```

Teste de navegador sintético: iniciar Vite local na porta 5184 e executar `npm run test:qmentum-browser`. Bloqueia qualquer request externo e cobre quatro tamanhos, foco/rolagem, 18 botões, dois gráficos, persistência simulada, calendário, texto, painel trimestral sem modal aninhado e VOLTAR. Screenshots em `.local-preview/qmentum` não entram no build.

Ordem após autorização específica:

1. Comparar Rules/índices e fonte Apps Script com as versões remotas; guardar cópias. Instalar somente os blocos e arquivos novos, sem retirar funções existentes.
2. Criar a configuração privada planejada da unidade SAHMT e concessão do administrador, inicialmente `enabled=false`. Definições iniciais ficam não aprovadas; resolver critérios e as 17 divergências antes de fechamento validado.
3. Ativar para o administrador e provar um fluxo real controlado: salvar → recarregar → revisar → fechar → reabrir → histórico, sem dados demonstrativos misturados ao histórico oficial.
4. Autorizar separadamente a importação de janeiro–junho/2026 com a prévia preservada e backup. Nenhuma conta é criada pelo importador.
5. Se a IA for desejada, confirmar free tier, billing desligado, termos e modelo; cadastrar somente a chave privada, evidências revisadas e prova com validade. Fazer uma chamada real limitada. Só então instalar o acionador horário.
6. Publicar o build aprovado e verificar a versão servida. A liberação a usuários comuns permanece uma decisão separada.

**Reversão:** desabilitar `qmentumConfig/current.enabled`; executar `desativarAgendadorQmentumV1()` para bloquear IA e remover somente seu acionador; retirar o acesso ao módulo na publicação seguinte. Preservar entradas, históricos, fontes e versões. Restaurar Rules/fonte anteriores somente após conferir o delta; não apagar módulos atuais nem reabrir FB/FC.

## Ciência e sugestões da análise crítica

- A ciência registra 1 ponto em Desempenho; uma sugestão aprovada registra mais 2. São acumuláveis: total 3. A sugestão pendente ou não aprovada não pontua.
- Os botões aparecem na análise trimestral revisada e compatível com os dados atuais. Não pontuam uma tela vazia, um pedido de IA nem uma análise desatualizada.
- `qmentumParticipations/{analysisId}_{uid}_{modality}` recebe somente pedido imutável, sem campo de pontos. Ciência e sugestão são independentes. Uma sugestão por pessoa/versão da análise.
- `qmentumParticipationReviews/{participationId}` recebe parecer imutável de gestor autorizado da unidade, diferente do autor. Aprovação não exige implementação da sugestão.
- `QmentumParticipation.gs` revalida, em transação FA, o perfil, a concessão de unidade, a configuração, a análise revisada e os seis meses relevantes. Usa `evaluationApplyAwards_`, não escreve saldo do navegador. Modalidades existentes `ACKNOWLEDGEMENT` (1) e `SUGGESTION` (2).
- O crédito é único por pessoa, unidade, indicador, trimestre e modalidade; regenerar a análise não multiplica os pontos. O ledger mantém auditoria de versões e preserva correções administrativas.
- O processamento se integra a `reconciliarAvaliacaoSahmtV2`, antes da publicação do saldo. Não instala um novo timer nem depende de IA habilitada. A execução desse ciclo existente precisa ser conferida no ambiente remoto; até sua execução, a interface mostra validação pendente.
- Contas revogadas, análise desatualizada e pedidos inválidos não pontuam. Erros técnicos mantêm o pedido pendente para recuperação. Nenhum UID, texto de sugestão ou token é registrado em logs operacionais.
- Gestão/Desempenho continuam inativos para usuários comuns nesta liberação. A regra de pontuação fica preparada para os participantes que receberem acesso ao módulo futuramente.

Recursos mantidos no Spark: um banco FA existente, nenhum Storage pago, Cloud Function, TTL, banco adicional ou backup gerenciado. O original XLSX fica em arquivo/Drive existente, fora de documento Firestore único. Confirmar os limites totais atuais antes de produção: https://firebase.google.com/docs/firestore/quotas e https://firebase.google.com/docs/firestore/manage-data/transactions .
