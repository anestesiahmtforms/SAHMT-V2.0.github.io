# Feed de atividades de aprendizagem V2

## Estado e origem

Esta especificação registra o destino arquitetural e o estado implementado da lacuna descrita em [`UI_PARITY.md`](UI_PARITY.md). O código publicado acrescenta CRUD versionado, feed no shell Treinamentos, link HTTPS e ciência explícita imutável sem pontos. As Firestore Rules e os três índices compostos foram implantados no projeto `sahmt-17a16`; consulta autenticada à API Firestore confirmou os três índices `READY` em 26/09/2026. Os casos específicos de autorização e a navegação autenticada ainda precisam de homologação. A V1 coloca atividades elegíveis no contêiner `training-activities` por `core/views/treinamentos.js` e as apresenta com `core/activity-ui.js`. A aba dinâmica `ATIVIDADES` tinha zero IDs em `A2:A1000` no snapshot delimitado descrito em [`V1_INVENTORY.md`](V1_INVENTORY.md), portanto não há catálogo dinâmico desse snapshot para migrar. A capacidade de cadastrar e usar atividades continua sendo requisito funcional, mesmo com a fonte vazia.

As tarefas V2 existentes em `activities` pertencem a áreas de Gestão: atribuem responsáveis/participantes, registram interações e podem gerar claims de pontos. Elas não serão reaproveitadas como catálogo de aprendizagem. Vídeos de treinamento continuam em `trainings`, com seu próprio recibo, progresso e validação.

## Contrato funcional

- Mostrar o feed dentro da rota Treinamentos e do shell único V2; a faixa de atalhos para miniapps da V1 é substituída pela navegação do shell.
- Selecionar somente atividades publicadas para o perfil ativo, sua audiência e sua janela. A rota exige `trainingsRead`; a gestão do catálogo exige `trainingsManage`.
- Abrir recurso externo é uma ação de navegação e, mesmo se futuramente registrada como `OPENED`, nunca conclui atividade nem gera pontos por si só.
- Ciência explícita grava um recibo idempotente e imutável. Uma leitura de recurso, clique, checkbox ou resposta declarada no cliente nunca gera pontuação.
- Pontos só podem vir de regra versionada e evidência revalidada por serviço confiável; o cliente não escolhe nem grava saldo, regra, categoria ou pontos.
- Perfis, permissões, contatos e dados clínicos não entram no documento do catálogo ou nos recibos.

## Modelo Firestore-alvo

Coleções novas implantadas no Firebase do projeto:

### `learningActivities/{activityId}`

Documento versionado e publicado por `trainingsManage`, sem campos de usuário:

- `id`, `version`, `title`, `description`, `category`;
- `sourceKind` e `resourceUrl` (URL HTTPS validada; sem conteúdo HTML/script ou credenciais). Fontes externas `EXTERNAL_LINK`, `GOOGLE_FORM`, `SHEET`, `DOCUMENT`, `PDF`, `QUIZ` e `SURVEY` abrem apenas o recurso; a conclusão dessas origens não é observada. `ACKNOWLEDGEMENT` não tem URL e exige ciência explícita. `TRAINING_VIDEO` continua na coleção/módulo próprios;
- `showInTraining`;
- `audienceType` (`ALL`, `ROLE` ou `USER`) e `audienceValue` (`''` para `ALL`);
- `startAt`, `endAt`, `status` (`DRAFT`, `ACTIVE`, `INACTIVE`);
- `completionKind` (`NONE`, `ACKNOWLEDGEMENT` ou `TRUSTED_EVIDENCE`);
- `recurrenceMode` (`ONCE` ou `ONCE_PER_VERSION` no primeiro incremento);
- `createdByUid`, `createdAt`, `updatedByUid`, `updatedAt`.

O leitor consulta por público, estado e `showInTraining`, mescla no cliente no máximo os buckets necessários e filtra a janela para montar a tela. A consulta deve ter índices explícitos e escopo limitado. Não guardar telefone, e-mail, sigla, lista de membros, token de sessão ou payload de Forms nesse catálogo. `USER` referencia UID apenas como destino da audiência; não cria nem altera `users/{uid}`.

### `learningActivityReceipts/{receiptId}`

Recibo individual append-only:

- `id`, `activityId`, `activityVersion`, `uid`, `evidenceKind`, `status`, `createdAt`;
- `status` começa em `CONFIRMED` somente para ciência explícita sem pontos ou em `PENDING_VALIDATION` quando uma fonte confiável ainda precisa confirmar evidência.
- Para `ACKNOWLEDGEMENT`, `receiptId` é determinístico a partir de UID, atividade, versão e janela de recorrência; Rules verificam os mesmos campos, `request.auth.uid`, versão publicada e autoria/timestamp de servidor. Repetir a ação devolve o recibo existente e não duplica confirmação.
- A pessoa lê apenas os próprios recibos. Administração lê recibos somente se o contrato de relatório justificar; Rules negam update/delete e escrita de saldo.

Não criar um `completionRule` genérico que marque qualquer atividade como concluída. Adicionar cada fonte exige adaptador próprio que valide sua evidência e a recorrência antes de alterar o estado de confirmação.

## Suporte por fonte

| Fonte V1 | Tratamento V2 |
|---|---|
| `EXTERNAL_LINK` + `NONE` | Abrir URL HTTPS em aba externa; abertura não registra conclusão nem ponto. |
| `GOOGLE_FORM`, `SHEET`, `DOCUMENT`, `PDF`, `QUIZ`, `SURVEY` + `NONE` | Abrir URL HTTPS da origem. O V2 não lê respostas/resultados externos, não registra conclusão e não credita pontos. |
| `ACKNOWLEDGEMENT` | Atividade interna sem URL; botão explícito de ciência cria recibo idempotente sem pontos. `EXTERNAL_LINK` também pode pedir ciência explícita, sem afirmar que o recurso foi concluído. |
| `TRAINING_VIDEO` | Usar `trainings` e o validador de treinamento existentes; não duplicar neste feed. |
| Google Form, Quiz, Survey, arquivo/documento | Abertura externa está suportada, sem validação do envio/resultado e sem recibo. Evidência validada permanece bloqueada até adaptador de origem, identidade, evento, versão e recorrência confiável. |
| Renovação, Checklist, Management | Reusar a tela/domain V2 correspondente; não marcar como concluído no feed até adaptador validar evidência em serviço confiável. |
| `INTERNAL_FORM`, `CUSTOM` ou tipos desconhecidos | Não publicar como confirmáveis até existir contrato e adaptador explícitos; falhar fechado. |

As recorrências V1 `PER_EVENT`, `PER_VALIDATED_RENEWAL`, `DAILY`, `WEEKLY`, `MONTHLY`, `ANNUAL` e `CUSTOM` ficam indisponíveis no primeiro incremento. Cada uma precisa de chave de evento/janela estável, deduplicação e regras validadas. `ONCE` e `ONCE_PER_VERSION` são as únicas formas de recibo previstas inicialmente.

## Sequência de implementação e aceitação

1. **Implementado, implantado e coberto no Emulator:** catálogo/recibos, Rules e consultas; os testes em `tests/firestore-rules.test.js` verificam leitura por perfil ativo, permissão, público e estado; criação/edição somente por `trainingsManage`, autoria preservada, versão incremental e exclusão negada; recibos próprios, idempotência, audiência, versão, janela, imutabilidade e bloqueio de usuário sem acesso. O workflow 36495355811 passou em 28/09/2026. Ainda falta homologar esses fluxos com contas reais; isso não é coberto pelo Emulator.
2. **Implementado e publicado:** CRUD versionado somente no painel `trainingsManage`; valores fora dos tipos/recorrências suportados permanecem indisponíveis.
3. **Implementado e publicado:** cards junto aos treinamentos com estados vazio/erro, janela filtrada e ações diretas; revisão responsiva e navegação autenticada ainda pendentes.
4. **Implementado e publicado:** links externos tipados sem conclusão rastreada e ciência imutável sem pontos. Repetição usa recibo determinístico; homologar que perfil sem permissão, usuário fora do público e conta sem perfil não leem nem gravam.
5. Adaptadores de evidência e pontuação continuam pendentes; implementá-los um a um depois de fonte e critérios verificados. Não habilitar tipo só porque aparece no enum V1.
6. Não migrar linhas de atividades até leitura delimitada confirmar novos registros e o proprietário aprovar origem, mapeamento e destino. O snapshot consultado tinha zero IDs.

Critério de aceite de paridade: o feed aparece na mesma página de Treinamentos, as atividades elegíveis têm título/descrição/recurso e ação correspondente à sua evidência; a decisão sobre atividades vazias, links e ciência não replica Apps Script, planilhas, login secundário nem conclusões não verificadas.
