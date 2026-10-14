# Integração de pontuação FA/FC → FB — evidência de 14/10/2026

## Aplicações reais já confirmadas

- FC: 57 identidades elegíveis presentes com o mesmo UID FA, após criação de apenas uma identidade ausente. Nenhuma conta existente foi sobrescrita. Uma identidade já existente usa exclusivamente Custom Token e não tem e-mail cadastrado no destino; ela foi preservada.
- Origem: 61 identidades; uma sem perfil aprovado, uma inativa e duas antigas de homologação fora do lote operacional.
- Administração FA: 54 perfis receberam apenas `permissions.occurrencesWrite=true` e a data de atualização. Os três perfis protegidos e os demais campos foram preservados. Nenhuma conta Authentication foi alterada por essa operação.
- Recibos, pré-condições e cópias anteriores permanecem fora do Git, nas pastas privadas `indicators-user-release` e `occurrence-access-release` em LOCALAPPDATA/SAHMT. Esta conferência utilizou esses recibos, sem repetir os inventários reais.

## Implementação local

- Gestão, Treinamentos e Desempenho podem selecionar FB explicitamente, conservando identidade/perfil FA e sem fallback de dados para FA quando FB falha. Caches e filas são separados por destino; ações offline FA anteriores ficam preservadas para reconciliação.
- Checklist permanece no FA. A confirmação e seu evento de pontuação são gravados juntos. A entrega ao FB usa recibo idempotente; falha na confirmação da entrega não duplica os pontos.
- Ocorrências permanece no FC. O servidor verifica relatório, auditoria, autoria e reivindicação de dois pontos. Conteúdo narrativo não é enviado ao FB.
- O crédito e o recibo são gravados juntos no FB; o resumo de desempenho é publicado antes da confirmação no FC. Falhas mantêm a reivindicação recuperável.
- Worker e Apps Script usam HMAC específico, nonce com consumo protegido por lock e expiração. A notificação usa o token FC apenas para uma leitura exata do registro de autoria; o Apps Script revalida a evidência e o perfil FA.
- A rota reutiliza a admissão do Worker. Timeout ou resultado remoto não confirmado mantém a reserva até sua expiração. Nenhum novo serviço ou acionador periódico foi instalado.
- Os validadores de Gestão/Treinamentos passam a respeitar o projeto escolhido para o domínio. Seus cursores são separados por projeto; documentos e materiais de treinamento também acompanham o domínio.
- A regra candidata FB valida sessão customizada, vínculo, revogação e expiração. O marcador privado de corte é obrigatório. Papel administrativo FA sozinho não concede administração FB.
- O Gateway obtém vínculos de áreas no FB e o acesso documental autorizado no FA; somente o broker FB solicita esse contexto. Falha do FB não impede o FC. A autorização FB é renovada sob demanda, sem novo timer.
- Pontuações legadas validadas de treinamentos e tarefas entram no livro consolidado do FB com tarefa durável, recibo idempotente e resumo confirmado antes da conclusão. Existe preparação explícita de lotes históricos de até 20 IDs, com prévia padrão e sem crédito automático.
- Regras, propriedades operacionais e flags dessa nova pontuação **não foram ativadas em produção**.

## Configuração privada futura

| Componente | Configuração | Estado padrão |
|---|---|---|
| Apps Script operacional | `SAHMT_V2_EVALUATION_PROJECT_ID=sahmt-gestao-5ae66` | Ausência conserva FA |
| Apps Script operacional | `SAHMT_V2_OCCURRENCE_SCORING_ENABLED` | Ausência/desligado |
| Apps Script operacional | `SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET` | Não instalado |
| Worker | `OCCURRENCE_SCORING_ENABLED` | false |
| Worker | `OCCURRENCE_SCORING_HMAC_SECRET`, `OCCURRENCE_SCORING_SCRIPT_URL` | Segredo e endpoint privados |
| Worker | `MANAGEMENT_DOMAIN_ENABLED` | false |
| PWA | `VITE_MANAGEMENT_DATA_PROJECT`, `VITE_EVALUATION_DATA_PROJECT` | FA |
| PWA | `VITE_OCCURRENCE_SCORING_ENABLED` | false |
| FB | `managementRuntime/domainCutover` | Sem ativação por este trabalho |

O endpoint da pontuação é `/v1/evaluation/occurrence`, no broker já aprovado. O segredo nunca pertence a uma variável VITE. A ativação ainda depende das permissões reais do executor para as coleções de pontuação e da publicação coordenada dos componentes.

## Limites e pendências concretas do corte completo

As rotas locais da PWA, caches, fila, contexto de autorização e regras candidatas das 21 coleções do domínio foram preparados. Isso ainda não comprova operação publicada no FB. A exclusão total no FA continua bloqueada: notificações por área consultam `managementAreas` no FA, e `auditLogs` contém histórico operacional compartilhado. Não apagar essas coleções por nome. É necessário resolver a autorização compartilhada dos comunicados e comparar novamente os documentos, os escritores e as ações offline antes da retirada. Nenhuma permissão FA é inferida apenas do cadastro no FB.

As transações de origem e destino são distintas: não existe atomicidade entre projetos. Evidência, perfil ativo, recibo idempotente e recuperação limitam esse intervalo; a confirmação da origem ocorre somente depois da gravação durável no destino. Uma nova revogação administrativa continua sujeita ao intervalo de renovação da sessão autorizada.

Não houve exclusão de dados FA, mudança de regras remotas, publicação ou alteração de faturamento nesta continuação.

## Verificações locais finais desta continuação

- `npm run prepare:management-auth`: PASS; todas as cinco etapas concluídas.
- Gestão: 2.727 aprovados, zero falhas, dois testes ignorados pela configuração da suíte.
- Domínio: 951 aprovados. Plataforma Worker: 22 aprovados.
- Integração secundária: 79 aprovados, incluindo pontuação, recuperação histórica, autorização, cache, renovação de sessão e pacote de implantação.
- Regras candidatas FB: 20 aprovados no emulador local.
- Há sobreposição entre suítes; os totais não representam testes únicos e não devem ser somados.
- Gateway: 52 funções, nenhuma duplicada, cinco escopos preservados. Pacote operacional: 20 arquivos GS mais manifesto, sintaxe individual e consolidada aprovada.
- Build Vite concluído. Permanecem avisos de tamanho de bundle e importações estáticas/dinâmicas, sem erro de compilação.
- Fixtures históricas corrigidas preservando os hashes de produção: o inventário antigo continua recusando código diferente do originalmente revisado. Config.gs foi adicionado ao mock do release de treinamentos. Dois testes de CLI passaram após usar a instalação Git funcional; nenhuma proteção de arquivo privado foi removida.

## Pacote local único

- `.local-preview/management-auth-runtime`: Gateway completo, manifesto, Worker empacotado, configuração desligada e relatório com hashes.
- `.local-preview/secondary-domain-release`: Apps Script operacional completo, regras FB candidatas, 24 índices compostos necessários e manifesto de sequência/reversão.
- O subconjunto de índices deve ser mesclado com o inventário remoto; nunca substituir ou excluir índices existentes indiscriminadamente.
- O pacote não instala segredos e não executa publicação, importação ou exclusão. Estado externo: NOT_RECHECKED nesta continuação.

## Reversão

Antes de ativar: publicar componentes ainda desligados; conferir permissões e cópia equivalente; só então selecionar FB. Em falha, desligar a notificação de Ocorrências e preservar reivindicações/recibos para retomada. Não excluir créditos do FB nem retornar a escrever pontuação no FA depois de um corte com novas gravações sem reconciliação. As permissões de Ocorrências têm backup individual anterior; qualquer restauração deve usar pré-condição de versão para não apagar edições administrativas posteriores.
