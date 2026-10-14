# Integração de pontuação FA/FC → FB — evidência de 14/10/2026

## Aplicações reais já confirmadas

- FC: 57 identidades elegíveis presentes com o mesmo UID FA, após criação de apenas uma identidade ausente. Nenhuma conta existente foi sobrescrita. Uma identidade já existente usa exclusivamente Custom Token e não tem e-mail cadastrado no destino; ela foi preservada.
- Origem: 61 identidades; uma sem perfil aprovado, uma inativa e duas antigas de homologação fora do lote operacional.
- Administração FA: 54 perfis receberam apenas `permissions.occurrencesWrite=true` e a data de atualização. Os três perfis protegidos e os demais campos foram preservados. Nenhuma conta Authentication foi alterada por essa operação.
- Recibos, pré-condições e cópias anteriores permanecem fora do Git, nas pastas privadas `indicators-user-release` e `occurrence-access-release` em LOCALAPPDATA/SAHMT. Esta conferência utilizou esses recibos, sem repetir os inventários reais.

## Implementação local

- Desempenho pode selecionar FB explicitamente, conservando identidade/perfil FA e sem fallback de dados para FA quando FB falha.
- Checklist permanece no FA. A confirmação e seu evento de pontuação são gravados juntos. A entrega ao FB usa recibo idempotente; falha na confirmação da entrega não duplica os pontos.
- Ocorrências permanece no FC. O servidor verifica relatório, auditoria, autoria e reivindicação de dois pontos. Conteúdo narrativo não é enviado ao FB.
- O crédito e o recibo são gravados juntos no FB; o resumo de desempenho é publicado antes da confirmação no FC. Falhas mantêm a reivindicação recuperável.
- Worker e Apps Script usam HMAC específico, nonce com consumo protegido por lock e expiração. A notificação usa o token FC apenas para uma leitura exata do registro de autoria; o Apps Script revalida a evidência e o perfil FA.
- A rota reutiliza a admissão do Worker. Timeout ou resultado remoto não confirmado mantém a reserva até sua expiração. Nenhum novo serviço ou acionador periódico foi instalado.
- Os validadores de Gestão/Treinamentos passam a respeitar o projeto escolhido para o domínio. Seus cursores são separados por projeto; documentos e materiais de treinamento também acompanham o domínio.
- A regra candidata FB valida sessão customizada, vínculo, revogação e expiração. O marcador privado de corte é obrigatório. Papel administrativo FA sozinho não concede administração FB.
- Regras, propriedades operacionais e flags dessa nova pontuação **não foram ativadas em produção**.

## Configuração privada futura

| Componente | Configuração | Estado padrão |
|---|---|---|
| Apps Script operacional | `SAHMT_V2_EVALUATION_PROJECT_ID=sahmt-gestao-5ae66` | Ausência conserva FA |
| Apps Script operacional | `SAHMT_V2_OCCURRENCE_SCORING_ENABLED` | Ausência/desligado |
| Apps Script operacional | `SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET` | Não instalado |
| Worker | `OCCURRENCE_SCORING_ENABLED` | false |
| Worker | `OCCURRENCE_SCORING_HMAC_SECRET`, `OCCURRENCE_SCORING_SCRIPT_URL` | Segredo e endpoint privados |
| PWA | `VITE_EVALUATION_DATA_PROJECT` | FA |
| PWA | `VITE_OCCURRENCE_SCORING_ENABLED` | false |
| FB | `managementRuntime/domainCutover` | Sem ativação por este trabalho |

O endpoint da pontuação é `/v1/evaluation/occurrence`, no broker já aprovado. O segredo nunca pertence a uma variável VITE. A ativação ainda depende das permissões reais do executor para as coleções de pontuação e da publicação coordenada dos componentes.

## Limites e pendências concretas do corte completo

Esta entrega não certifica que toda Gestão já opera no FB. `src/data.js` ainda contém rotas FA de Gestão/Treinamentos; caches e fila precisam acompanhar o destino. A autorização do Gateway ainda não carrega as relações completas de áreas/grupos e a regra candidata cobre Desempenho, não o domínio Gestão inteiro. Essas pendências impedem habilitar o corte completo ou excluir as cópias FA.

As transações de origem e destino são distintas: não existe atomicidade entre projetos. Evidência, perfil ativo, recibo idempotente e recuperação limitam esse intervalo; a confirmação da origem ocorre somente depois da gravação durável no destino. Uma nova revogação administrativa continua sujeita ao intervalo de renovação da sessão autorizada.

Não houve exclusão de dados FA, mudança de regras remotas, publicação ou alteração de faturamento nesta continuação.

## Verificações locais

- 567 testes focados de regressão, pontuação, identidades, broker e frontend aprovados antes do último ajuste de admissão.
- 13 testes das regras candidatas FB aprovados no emulador, incluindo vínculos divergentes, revogação, leitura própria, grupos, negação de escrita direta de pontos e administração específica.
- 17 testes do transporte de Ocorrências e Worker aprovados depois da inclusão da admissão; parte deles também integra a suíte anterior, portanto os totais não devem ser somados.
- Suíte final `npm run test:secondary-domain`: 52 testes aprovados, incluindo três verificações adicionais dos validadores legados e isolamento dos cursores FA/FB. Também há sobreposição com as suítes anteriores.
- Sintaxe dos 20 arquivos Apps Script verificada. Build Vite concluído; aviso existente de tamanho de bundle, sem erro de compilação.

## Reversão

Antes de ativar: publicar componentes ainda desligados; conferir permissões e cópia equivalente; só então selecionar FB. Em falha, desligar a notificação de Ocorrências e preservar reivindicações/recibos para retomada. Não excluir créditos do FB nem retornar a escrever pontuação no FA depois de um corte com novas gravações sem reconciliação. As permissões de Ocorrências têm backup individual anterior; qualquer restauração deve usar pré-condição de versão para não apagar edições administrativas posteriores.
