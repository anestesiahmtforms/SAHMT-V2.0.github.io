# Feed de atividades de aprendizagem V2

## Estado e origem

Esta especificação fecha o destino arquitetural da lacuna registrada em [`UI_PARITY.md`](UI_PARITY.md); não afirma que a coleção ou as telas já existam. A V1 coloca atividades elegíveis no contêiner `training-activities` por `core/views/treinamentos.js` e as apresenta com `core/activity-ui.js`. O fluxo inclui abrir um recurso externo, registrar ciência e exibir estados/resultado de evidência. A aba dinâmica `ATIVIDADES` tinha zero IDs em `A2:A1000` no snapshot delimitado descrito em [`V1_INVENTORY.md`](V1_INVENTORY.md), portanto não há catálogo dinâmico desse snapshot para migrar. A capacidade de cadastrar e usar atividades continua sendo requisito funcional, mesmo com a fonte vazia.

As tarefas V2 existentes em `activities` pertencem a áreas de Gestão: atribuem responsáveis/participantes, registram interações e podem gerar claims de pontos. Elas não serão reaproveitadas como catálogo de aprendizagem. Vídeos de treinamento continuam em `trainings`, com seu próprio recibo, progresso e validação.

## Contrato funcional

- Mostrar o feed dentro da rota Treinamentos e do shell único V2; a faixa de atalhos para miniapps da V1 é substituída pela navegação do shell.
- Selecionar somente atividades publicadas para o perfil ativo, sua audiência e sua janela. A rota exige `trainingsRead`; a gestão do catálogo exige `trainingsManage`.
- Abrir recurso externo é uma ação de navegação e, mesmo se futuramente registrada como `OPENED`, nunca conclui atividade nem gera pontos por si só.
- Ciência explícita grava um recibo idempotente e imutável. Uma leitura de recurso, clique, checkbox ou resposta declarada no cliente nunca gera pontuação.
- Pontos só podem vir de regra versionada e evidência revalidada por serviço confiável; o cliente não escolhe nem grava saldo, regra, categoria ou pontos.
- Perfis, permissões, contatos e dados clínicos não entram no documento do catálogo ou nos recibos.

## Modelo Firestore-alvo

Coleções novas, ainda não implantadas:

### `learningActivities/{activityId}`

Documento versionado e publicado por `trainingsManage`, sem campos de usuário:

- `id`, `version`, `title`, `description`, `category`;
- `sourceKind` e `resourceUrl` (URL HTTPS validada; sem conteúdo HTML/script ou credenciais);
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
| `ACKNOWLEDGEMENT` | Botão explícito de ciência; recibo idempotente sem pontos. |
| `TRAINING_VIDEO` | Usar `trainings` e o validador de treinamento existentes; não duplicar neste feed. |
| Google Form, Quiz, Survey, arquivo/documento/renovação, Checklist, Management | Bloqueados até cada adaptador validar origem, identidade, evento, versão e recorrência em serviço confiável. Reusar a tela/domain V2 correspondente quando existir; não aceitar declaração do navegador como prova. |
| `INTERNAL_FORM`, `CUSTOM` ou tipos desconhecidos | Não publicar como confirmáveis até existir contrato e adaptador explícitos; falhar fechado. |

As recorrências V1 `PER_EVENT`, `PER_VALIDATED_RENEWAL`, `DAILY`, `WEEKLY`, `MONTHLY`, `ANNUAL` e `CUSTOM` ficam indisponíveis no primeiro incremento. Cada uma precisa de chave de evento/janela estável, deduplicação e regras validadas. `ONCE` e `ONCE_PER_VERSION` são as únicas formas de recibo previstas inicialmente.

## Sequência de implementação e aceitação

1. Criar coleções, índices, validação de documento e Firestore Rules; cobrir allow/deny por identidade, público, estado, vigência, versão, autoria e imutabilidade.
2. Adicionar CRUD versionado somente no painel `trainingsManage`; valores fora dos tipos/recorrências suportados ficam indisponíveis, sem fallback confirmável.
3. Renderizar cards do feed junto do catálogo de Treinamentos, com estado vazio, carregamento, erro, janela e botões de ação direta no mesmo shell.
4. Liberar apenas link externo sem conclusão e ciência imutável sem pontos. Repetição não duplica recibos; perfil sem `trainingsRead`, usuário fora do público e conta sem perfil não lê nem grava.
5. Implementar adaptadores de evidência e pontuação um a um, depois de fonte e critérios verificados. Não habilitar um tipo só porque aparece no enum importado da V1.
6. Não migrar linhas de atividades até uma leitura delimitada confirmar novos registros e seu proprietário aprovar origem, mapeamento e destino. O snapshot consultado tinha zero IDs.

Critério de aceite de paridade: o feed aparece na mesma página de Treinamentos, as atividades elegíveis têm título/descrição/recurso e ação correspondente à sua evidência; a decisão sobre atividades vazias, links e ciência não replica Apps Script, planilhas, login secundário nem conclusões não verificadas.
