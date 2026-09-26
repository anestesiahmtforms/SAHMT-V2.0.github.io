# Auditoria de consultas e índices Firestore

## Escopo e limite

Auditoria estática de `src/data.js`, `src/main.js`, `functions/index.js`, `apps-script-v2/SparkReportSync.gs` e `firestore.indexes.json`, atualizada em 26/09/2026. Ela confere as consultas do cliente, callables e consumidor Spark de relatórios contra os índices manuais declarados e os índices automáticos por campo. Rules e os 29 índices iniciais foram publicados no projeto autenticado `sahmt-17a16`; em 26/09/2026, o índice 30 legado de `syncQueue` e os dois índices novos de vigência de notificações foram confirmados `READY`. `syncQueue` não tem produtor/consumidor implantado na V2 e sua linha abaixo é somente registro histórico. A auditoria estática não substitui a homologação de consultas reais com perfil autorizado.

O Firestore cria índices automáticos por campo e pode mesclar índices para filtros compostos só de igualdade, com `orderBy` opcional. Consultas com faixa ou combinações de faixa/ordenação podem exigir índice manual. Consulte a [visão geral oficial de índices](https://firebase.google.com/docs/firestore/query-data/index-overview) e a [referência oficial para administrar índices](https://firebase.google.com/docs/firestore/query-data/indexing).

## Consultas que usam índices manuais

| Coleção | Consulta observada | Índice em `firestore.indexes.json` |
|---|---|---|
| `events` | `active == true`, intervalo de `date`, `date DESC` | `active ASC, date DESC` |
| `labels` | Administrador: `active == true`, intervalo de `date`, `date DESC`; pessoa: a mesma janela combinada com `createdByUid == UID` ou `staffSiglas ARRAY_CONTAINS sigla` | `active ASC, date DESC`; `active ASC, createdByUid ASC, date DESC`; `active ASC, staffSiglas ARRAY_CONTAINS, date DESC` |
| `vacations` | `active == true`, `start <= dia`, `end >= dia`, `start ASC` | `active ASC, start ASC, end ASC` |
| Coleções dos módulos listados em `moduleCollections` | `active == true`, ordenação própria | `active ASC` + `order`/data configurada para Eventos, Contatos, Gestão, Checklist, Treinamentos e Notificações |
| `checklists` | período/dia e `createdAt DESC` | Índices `date ASC, createdAt DESC` e `date DESC, createdAt DESC` |
| `checklists` | `stationId ==`, data anterior e data/criação descendentes | `stationId ASC, date DESC, createdAt DESC` |
| `indicators` | `managementAreaId ==`, `active == true`, `name ASC` | `managementAreaId ASC, active ASC, name ASC` |
| `indicatorMeasurements` | `indicatorId ==`, `period DESC` | `indicatorId ASC, period DESC` |
| `actionPlans` | `managementAreaId ==`, `openedAt DESC` | `managementAreaId ASC, openedAt DESC` |
| `equipmentEvents` | `managementAreaId ==`, `createdAt DESC` | `managementAreaId ASC, createdAt DESC` |
| `maintenanceRecords` | `managementAreaId ==`, `updatedAt DESC` | `managementAreaId ASC, updatedAt DESC` |
| `documents` | `managementAreaId ==`, `publishedAt DESC`; consulta de ativos acrescenta `active == true` | `managementAreaId ASC, publishedAt DESC` e `managementAreaId ASC, active ASC, publishedAt DESC` |
| `equipment` | `managementAreaId ==`, `tag ASC` | `managementAreaId ASC, tag ASC` |
| `trainings` | `order ASC, title ASC` (catálogo administrativo, incluindo inativos) | `order ASC, title ASC` |
| `activities` | `managementAreaId ==`, `dueAt` preenchido ascendente e `createdAt DESC`; atividades sem prazo são consultadas em seguida por `createdAt DESC` | `managementAreaId ASC, dueAt ASC, createdAt DESC` |
| `activityInteractions` | `activityId ==`, `createdAt DESC`; variante também filtra `uid ==` | Índices por `activityId, createdAt` e `activityId, uid, createdAt` |
| `notifications` | gestor: ativo e `startAt <= agora`, `endAt >= agora`, `priority DESC`; destinatário: os mesmos filtros junto a combinação OR de público | `active, startAt, endAt, priority`; `active, audienceType, audienceValue, startAt, endAt, priority` |
| `managementAreas` | ativo e `memberUids` ou `managerUids` contém UID | Dois índices `active ASC` + campo `CONTAINS` correspondente |
| `notificationGroups` | ativo e `memberUids` contém UID | `active ASC, memberUids CONTAINS` |
| `syncQueue` (legado, sem consumidor V2) | Consulta do consumidor antigo `status == pending`, `nextAttemptAt <= agora`, `nextAttemptAt ASC`, limite 40 | `status ASC, nextAttemptAt ASC` (índice histórico implantado e `READY` em 26/09/2026; sem uso no runtime V2) |

## Consultas cobertas por índices automáticos

A inspeção também encontrou consultas simples por documento e consultas sem combinação de faixa/ordenação: `users` por UID/sigla e lista ordenada por nome, `contacts` ativos, `stations` por QR, histórico `labels/{labelId}/history` ordenado por `version DESC`, `trainingProgress` por UID, `actionPlanItems` por `planId in` e recibos por `notificationId in`. A callable de assinatura também usa `stations(active, order)`, `vacations(active, start, end)`, `events(active, date)`, `contacts(active)`, `checklists(date, createdAt)` e `users(sigla)`; as consultas com composição/ordenação correspondem aos índices manuais já listados acima, e as demais são cobertas pelos índices automáticos. As listas limitadas de documentos, equipamentos, treinamentos e atividades agora ordenam no servidor antes de aplicar o limite, com índices explícitos para as consultas compostas. Atividades com prazo aparecem primeiro; as sem prazo são acrescentadas por data de criação quando houver espaço.

## Segurança e homologação

Índice disponível não concede acesso; cada consulta continua sujeita às Firestore Rules já publicadas. A suíte do Emulator testa autorização, mas não prova que consultas reais foram executadas no app. A CLI confirmou 32 índices `READY` no `(default)` `sahmt-17a16` em 26/09/2026. A consulta nova restringe os resultados à vigência no servidor; observar sua execução com perfil autorizado durante homologação.
